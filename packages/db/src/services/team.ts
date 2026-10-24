import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { GRANTABLE, LOCATION_SCOPED_ROLES, type Role } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { invitations, locations, membershipLocations, memberships, users } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';
import { hashToken } from './organizations';

const INVITE_DAYS = 7;

export type MemberDetails = {
  /** Empty = all locations. Only meaningful for location-scoped roles. */
  locationIds?: string[];
  /** Sales commission, percent (e.g. 5 = 5%). */
  commissionPct?: number | null;
  vehicle?: string | null;
  /** Extra grantable permissions on top of the role. */
  permissions?: string[];
};

const cleanPermissions = (p: string[] | undefined) => (p ?? []).filter((x) => (GRANTABLE as readonly string[]).includes(x));
const commission = (role: Role, pct: number | null | undefined) => (role === 'sales' && pct != null ? String(pct) : null);

export function listTeam(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const members = await tx
      .select({
        id: memberships.id,
        role: memberships.role,
        status: memberships.status,
        title: memberships.title,
        allLocations: memberships.allLocations,
        commissionRate: memberships.commissionRate,
        vehicle: memberships.vehicle,
        permissions: memberships.permissions,
        createdAt: memberships.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(memberships.createdAt);
    const links = await tx.select().from(membershipLocations);
    const invites = await tx
      .select()
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .orderBy(desc(invitations.createdAt));
    return {
      members: members.map((m) => ({
        ...m,
        role: m.role as Role,
        locationIds: m.allLocations ? [] : links.filter((l) => l.membershipId === m.id).map((l) => l.locationId),
        commissionPct: m.commissionRate == null ? null : Number(m.commissionRate),
      })),
      invites: invites
        .filter((i) => i.expiresAt > new Date())
        .map((i) => ({ ...i, role: i.role as Role, commissionPct: i.commissionRate == null ? null : Number(i.commissionRate) })),
    };
  });
}

async function assertLocations(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.select({ id: locations.id }).from(locations).where(inArray(locations.id, ids));
  if (found.length !== new Set(ids).size) throw new OrgError('One of the chosen locations no longer exists.', 'invalid');
}

/** Returns the raw token once; only its hash is stored. */
export async function createInvitationTx(
  tx: Tx,
  tenantId: string,
  actor: Actor,
  input: { email: string; role: Role; name?: string | null } & MemberDetails,
) {
  const email = input.email.trim();
  const already = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  if (already.length) throw new OrgError(`${email} is already on the team.`, 'invalid');
  const scoped = LOCATION_SCOPED_ROLES.includes(input.role) ? [...new Set(input.locationIds ?? [])] : [];
  await assertLocations(tx, scoped);
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
      name: input.name?.trim() || null,
      role: input.role,
      locationIds: scoped,
      commissionRate: commission(input.role, input.commissionPct),
      vehicle: ['coach', 'crew'].includes(input.role) ? input.vehicle?.trim() || null : null,
      permissions: cleanPermissions(input.permissions),
      tokenSha256: hashToken(token),
      invitedByUserId: actor.userId ?? null,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    })
    .returning();
  await audit(tx, tenantId, actor, { type: 'invitation', id: inv!.id }, 'team.invited', { email, role: input.role });
  return { invitation: inv!, token };
}

export function createInvitation(db: Db, tenantId: string, actor: Actor, input: { email: string; role: Exclude<Role, 'owner'>; name?: string | null } & MemberDetails) {
  return withTenant(db, tenantId, (tx) => createInvitationTx(tx, tenantId, actor, input));
}

/** Several invitations at once (onboarding step 5). All or nothing. */
export function createInvitations(db: Db, tenantId: string, actor: Actor, rows: { email: string; role: Exclude<Role, 'owner'> }[]) {
  return withTenant(db, tenantId, async (tx) => {
    const out = [];
    for (const r of rows) out.push(await createInvitationTx(tx, tenantId, actor, r));
    return out;
  });
}

/** New link for an open invitation (the old link stops working). */
export function resendInvitation(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.select().from(invitations).where(and(eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt))).limit(1);
    if (!inv) throw new OrgError('Invitation not found.', 'not_found');
    const token = randomBytes(24).toString('base64url');
    const [after] = await tx
      .update(invitations)
      .set({ tokenSha256: hashToken(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) })
      .where(eq(invitations.id, id))
      .returning();
    await audit(tx, tenantId, actor, { type: 'invitation', id }, 'team.invite_resent', { email: inv.email });
    return { invitation: after!, token };
  });
}

export function revokeInvitation(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, id)).returning();
    if (!inv) throw new OrgError('Invitation not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'invitation', id }, 'team.invite_revoked', { email: inv.email });
  });
}

async function countOwners(tx: Tx) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.role, 'owner'), eq(memberships.status, 'active')));
  return row?.n ?? 0;
}

async function setMemberLocations(tx: Tx, tenantId: string, membershipId: string, ids: string[]) {
  await tx.delete(membershipLocations).where(eq(membershipLocations.membershipId, membershipId));
  if (ids.length) await tx.insert(membershipLocations).values(ids.map((locationId) => ({ tenantId, membershipId, locationId })));
  await tx.update(memberships).set({ allLocations: ids.length === 0 }).where(eq(memberships.id, membershipId));
}

export function updateMember(
  db: Db,
  tenantId: string,
  actor: Actor & { role: Role },
  membershipId: string,
  change: { role?: Role; status?: 'active' | 'disabled' } & MemberDetails,
) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
    if (!m) throw new OrgError('Team member not found.', 'not_found');
    const touchesOwner = m.role === 'owner' || change.role === 'owner';
    if (touchesOwner && actor.role !== 'owner' && (change.role !== undefined || change.status !== undefined)) {
      throw new OrgError('Only an owner can change owners.', 'forbidden');
    }
    const losesOwner = m.role === 'owner' && m.status === 'active' && ((change.role && change.role !== 'owner') || change.status === 'disabled');
    if (losesOwner && (await countOwners(tx)) <= 1) {
      throw new OrgError('The organization needs at least one owner. Make someone else an owner first.', 'last_owner');
    }
    if (m.userId === actor.userId && change.status === 'disabled') throw new OrgError('You cannot disable yourself.', 'invalid');
    const role = (change.role ?? m.role) as Role;
    const values: Partial<typeof memberships.$inferInsert> = {};
    if (change.role) values.role = change.role;
    if (change.status) values.status = change.status;
    if (change.commissionPct !== undefined || change.role) values.commissionRate = commission(role, change.commissionPct ?? (m.commissionRate == null ? null : Number(m.commissionRate)));
    if (change.vehicle !== undefined) values.vehicle = ['coach', 'crew'].includes(role) ? change.vehicle?.trim() || null : null;
    if (change.permissions !== undefined) values.permissions = cleanPermissions(change.permissions);
    const [after] = Object.keys(values).length
      ? await tx.update(memberships).set(values).where(eq(memberships.id, membershipId)).returning()
      : [m];
    if (change.locationIds !== undefined || (change.role && !LOCATION_SCOPED_ROLES.includes(role))) {
      const ids = LOCATION_SCOPED_ROLES.includes(role) ? [...new Set(change.locationIds ?? [])] : [];
      await assertLocations(tx, ids);
      await setMemberLocations(tx, tenantId, membershipId, ids);
    }
    await audit(tx, tenantId, actor, { type: 'membership', id: membershipId }, 'team.member_updated', {
      from: { role: m.role, status: m.status },
      to: { role: after!.role, status: after!.status },
      ...(change.locationIds !== undefined ? { locations: change.locationIds.length || 'all' } : {}),
    });
    return after!;
  });
}

export type InvitationPreview = {
  tenantId: string; invitationId: string; email: string; name: string | null; role: Role; expiresAt: Date;
  acceptedAt: Date | null; revokedAt: Date | null; tenantName: string; tenantSlug: string; tenantStatus: string;
};

/** Looks an invitation up by its token (crosses tenants via a SECURITY DEFINER function). */
export async function findInvitation(db: Db, token: string): Promise<InvitationPreview | null> {
  const rows = await db.execute<{
    tenant_id: string; invitation_id: string; email: string; name: string | null; role: Role; expires_at: string;
    accepted_at: string | null; revoked_at: string | null; tenant_name: string; tenant_slug: string; tenant_status: string;
  }>(sql`select * from app_find_invitation(${hashToken(token)})`);
  const r = rows[0];
  if (!r) return null;
  return {
    tenantId: r.tenant_id,
    invitationId: r.invitation_id,
    email: r.email,
    name: r.name,
    role: r.role,
    expiresAt: new Date(r.expires_at),
    acceptedAt: r.accepted_at ? new Date(r.accepted_at) : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
    tenantName: r.tenant_name,
    tenantSlug: r.tenant_slug,
    tenantStatus: r.tenant_status,
  };
}

export async function acceptInvitation(db: Db, token: string, user: { id: string; email: string }) {
  const inv = await findInvitation(db, token);
  if (!inv || inv.revokedAt) throw new OrgError('This invitation link is not valid.', 'not_found');
  if (inv.acceptedAt) throw new OrgError('This invitation has already been used.', 'invalid');
  if (inv.expiresAt < new Date()) throw new OrgError('This invitation has expired. Ask for a new one.', 'invalid');
  if (inv.tenantStatus === 'closed') throw new OrgError('This organization has been closed.', 'invalid');
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new OrgError(`This invitation is for ${inv.email}. Sign in with that email to accept it.`, 'forbidden');
  }
  return withTenant(db, inv.tenantId, async (tx) => {
    const [row] = await tx.select().from(invitations).where(eq(invitations.id, inv.invitationId)).limit(1);
    if (!row) throw new OrgError('This invitation link is not valid.', 'not_found');
    const [m] = await tx
      .insert(memberships)
      .values({
        tenantId: inv.tenantId,
        userId: user.id,
        role: inv.role,
        commissionRate: row.commissionRate,
        vehicle: row.vehicle,
        permissions: row.permissions,
        allLocations: row.locationIds.length === 0,
      })
      .onConflictDoUpdate({
        target: [memberships.tenantId, memberships.userId],
        set: { role: inv.role, status: 'active', commissionRate: row.commissionRate, vehicle: row.vehicle, permissions: row.permissions },
      })
      .returning();
    const ids = row.locationIds.filter(Boolean);
    const existing = ids.length ? await tx.select({ id: locations.id }).from(locations).where(inArray(locations.id, ids)) : [];
    await setMemberLocations(tx, inv.tenantId, m!.id, existing.map((l) => l.id));
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.invitationId));
    await audit(tx, inv.tenantId, { type: 'user', userId: user.id }, { type: 'invitation', id: inv.invitationId }, 'team.invite_accepted', {
      email: inv.email,
      role: inv.role,
    });
    return inv;
  });
}
