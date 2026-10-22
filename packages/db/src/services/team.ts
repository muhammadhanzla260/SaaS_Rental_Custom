import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Role } from '@rental/core';
import { withTenant, type Db } from '../client';
import { invitations, memberships, users } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';
import { hashToken } from './organizations';

const INVITE_DAYS = 7;

export function listTeam(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const members = await tx
      .select({
        id: memberships.id,
        role: memberships.role,
        status: memberships.status,
        title: memberships.title,
        createdAt: memberships.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(memberships.createdAt);
    const invites = await tx
      .select()
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .orderBy(desc(invitations.createdAt));
    return { members, invites: invites.filter((i) => i.expiresAt > new Date()) };
  });
}

/** Returns the raw token once; only its hash is stored. */
export function createInvitation(db: Db, tenantId: string, actor: Actor, email: string, role: Exclude<Role, 'owner'>) {
  return withTenant(db, tenantId, async (tx) => {
    const already = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    if (already.length) throw new OrgError('This person is already on the team.', 'invalid');
    // Re-inviting replaces the previous open invitation.
    await tx
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(and(sql`lower(${invitations.email}) = lower(${email})`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    const token = randomBytes(24).toString('base64url');
    const [inv] = await tx
      .insert(invitations)
      .values({
        tenantId,
        email,
        role,
        tokenSha256: hashToken(token),
        invitedByUserId: actor.userId ?? null,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      })
      .returning();
    await audit(tx, tenantId, actor, { type: 'invitation', id: inv!.id }, 'team.invited', { email, role });
    return { invitation: inv!, token };
  });
}

export function revokeInvitation(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id)).returning();
    if (!inv) throw new OrgError('Invitation not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'invitation', id }, 'team.invite_revoked', { email: inv.email });
  });
}

async function countOwners(tx: Parameters<Parameters<typeof withTenant>[2]>[0]) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.role, 'owner'), eq(memberships.status, 'active')));
  return row?.n ?? 0;
}

export function updateMember(
  db: Db,
  tenantId: string,
  actor: Actor & { role: Role },
  membershipId: string,
  change: { role?: Role; status?: 'active' | 'disabled' },
) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
    if (!m) throw new OrgError('Team member not found.', 'not_found');
    const touchesOwner = m.role === 'owner' || change.role === 'owner';
    if (touchesOwner && actor.role !== 'owner') throw new OrgError('Only an owner can change owners.', 'forbidden');
    const losesOwner = m.role === 'owner' && m.status === 'active' && ((change.role && change.role !== 'owner') || change.status === 'disabled');
    if (losesOwner && (await countOwners(tx)) <= 1) {
      throw new OrgError('The organization needs at least one owner. Make someone else an owner first.', 'last_owner');
    }
    const [after] = await tx.update(memberships).set(change).where(eq(memberships.id, membershipId)).returning();
    await audit(tx, tenantId, actor, { type: 'membership', id: membershipId }, 'team.member_updated', {
      from: { role: m.role, status: m.status },
      to: { role: after!.role, status: after!.status },
    });
    return after!;
  });
}

export type InvitationPreview = {
  tenantId: string; invitationId: string; email: string; role: Role; expiresAt: Date;
  acceptedAt: Date | null; revokedAt: Date | null; tenantName: string; tenantSlug: string;
};

/** Looks an invitation up by its token (crosses tenants via a SECURITY DEFINER function). */
export async function findInvitation(db: Db, token: string): Promise<InvitationPreview | null> {
  const rows = await db.execute<{
    tenant_id: string; invitation_id: string; email: string; role: Role; expires_at: string;
    accepted_at: string | null; revoked_at: string | null; tenant_name: string; tenant_slug: string;
  }>(sql`select * from app_find_invitation(${hashToken(token)})`);
  const r = rows[0];
  if (!r) return null;
  return {
    tenantId: r.tenant_id,
    invitationId: r.invitation_id,
    email: r.email,
    role: r.role,
    expiresAt: new Date(r.expires_at),
    acceptedAt: r.accepted_at ? new Date(r.accepted_at) : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    tenantName: r.tenant_name,
    tenantSlug: r.tenant_slug,
  };
}

export async function acceptInvitation(db: Db, token: string, user: { id: string; email: string }) {
  const inv = await findInvitation(db, token);
  if (!inv || inv.revokedAt) throw new OrgError('This invitation link is not valid.', 'not_found');
  if (inv.acceptedAt) throw new OrgError('This invitation has already been used.', 'invalid');
  if (inv.expiresAt < new Date()) throw new OrgError('This invitation has expired. Ask for a new one.', 'invalid');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new OrgError(`This invitation is for ${inv.email}. Sign in with that email to accept it.`, 'forbidden');
  }
  return withTenant(db, inv.tenantId, async (tx) => {
    await tx
      .insert(memberships)
      .values({ tenantId: inv.tenantId, userId: user.id, role: inv.role })
      .onConflictDoUpdate({ target: [memberships.tenantId, memberships.userId], set: { role: inv.role, status: 'active' } });
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.invitationId));
    await audit(tx, inv.tenantId, { type: 'user', userId: user.id }, { type: 'invitation', id: inv.invitationId }, 'team.invite_accepted', {
      email: inv.email,
      role: inv.role,
    });
    return inv;
  });
}
