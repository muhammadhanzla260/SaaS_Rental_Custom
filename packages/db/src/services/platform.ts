import { eq, sql } from 'drizzle-orm';
import { onboardingPercent, onboardingProgressSchema } from '@rental/core';
import { withTenant, type Db } from '../client';
import { sha256Hex } from '../crypto';
import { tenants } from '../schema';
import { audit, diff, type Actor } from './audit';
import { OrgError } from './errors';
import { createWorkspace, type Tenant } from './organizations';
import { createInvitationTx } from './team';

/**
 * Platform console (super admin). Every function takes the admin's user id;
 * the SQL functions check it again (defence in depth), and every change is
 * written to the target org's audit log as actor "platform".
 */

export async function isPlatformAdmin(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.execute<{ ok: boolean }>(sql`select app_is_platform_admin(${userId}) as ok`);
  return !!row?.ok;
}

export type PlatformOrg = {
  id: string; slug: string; name: string; status: OrgStatus; plan: Plan; rolloutPhase: number;
  createdAt: Date; onboardedAt: Date | null; onboardingPercent: number; brandColor: string; logoFileId: string | null;
  timezone: string; currency: string; country: string; closedAt: Date | null; purgeAfter: Date | null;
  ownerName: string | null; ownerEmail: string | null; ownerPending: boolean; users: number; locations: number;
};
export type OrgStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'closed';
export type Plan = 'starter' | 'growth' | 'scale';

export async function listPlatformOrgs(db: Db, adminId: string): Promise<PlatformOrg[]> {
  const rows = await db.execute<{
    id: string; slug: string; name: string; status: OrgStatus; plan: Plan; rollout_phase: number; created_at: string;
    onboarded_at: string | null; onboarding: unknown; brand_color: string; logo_file_id: string | null; timezone: string;
    currency: string; country: string; closed_at: string | null; purge_after: string | null; owner_name: string | null;
    owner_email: string | null; owner_pending: boolean; users: number; locations: number;
  }>(sql`select * from app_platform_orgs(${adminId})`);
  return [...rows].map((r) => {
    const progress = onboardingProgressSchema.safeParse(r.onboarding ?? {});
    return {
      id: r.id, slug: r.slug, name: r.name, status: r.status, plan: r.plan, rolloutPhase: r.rollout_phase,
      createdAt: new Date(r.created_at), onboardedAt: r.onboarded_at ? new Date(r.onboarded_at) : null,
      onboardingPercent: onboardingPercent(progress.success ? progress.data : onboardingProgressSchema.parse({}), !!r.onboarded_at),
      brandColor: r.brand_color, logoFileId: r.logo_file_id, timezone: r.timezone, currency: r.currency, country: r.country,
      closedAt: r.closed_at ? new Date(r.closed_at) : null, purgeAfter: r.purge_after ? new Date(r.purge_after) : null,
      ownerName: r.owner_name, ownerEmail: r.owner_email, ownerPending: r.owner_pending, users: r.users, locations: r.locations,
    };
  });
}

const platformActor = (adminId: string, ip?: string | null): Actor => ({ type: 'platform', userId: adminId, ip: ip ?? null });

async function assertAdmin(db: Db, adminId: string) {
  if (!(await isPlatformAdmin(db, adminId))) throw new OrgError('Only the platform owner can do this.', 'forbidden');
}

export type PlatformOrgInput = {
  name: string; slug: string; country: string; timezone: string; currency: string;
  plan: Plan; status: 'trial' | 'active' | 'past_due';
  ownerName: string; ownerEmail: string;
};

/** New organization from the console. The owner joins through an invitation (link returned once). */
export async function platformCreateOrg(db: Db, adminId: string, input: PlatformOrgInput, ip?: string | null) {
  await assertAdmin(db, adminId);
  const actor = platformActor(adminId, ip);
  const tenant = await createWorkspace(
    db,
    null,
    { name: input.name, slug: input.slug, country: input.country, plan: input.plan, status: input.status, timezone: input.timezone, currency: input.currency },
    actor,
  );
  const invite = await withTenant(db, tenant.id, (tx) =>
    createInvitationTx(tx, tenant.id, actor, { email: input.ownerEmail, name: input.ownerName, role: 'owner' }),
  );
  return { tenant, ownerToken: invite.token };
}

/** Edit an organization (business, subscription). Slug changes keep the old one blocked for 90 days. */
export async function platformUpdateOrg(
  db: Db,
  adminId: string,
  tenantId: string,
  input: Pick<PlatformOrgInput, 'name' | 'slug' | 'timezone' | 'currency' | 'plan'> & { status: 'trial' | 'active' | 'past_due' | 'suspended' },
  ip?: string | null,
) {
  await assertAdmin(db, adminId);
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!before || before.status === 'closed') throw new OrgError('Organization not found.', 'not_found');
    if (input.slug !== before.slug) {
      const [taken] = await tx.execute<{ taken: boolean }>(sql`select app_slug_taken(${input.slug}) as taken`);
      if (taken?.taken) throw new OrgError('That workspace URL is already taken.', 'slug_taken');
    }
    if (input.slug !== before.slug) await tx.execute(sql`select app_release_slug(${adminId}, ${before.slug})`);
    const [after] = await tx
      .update(tenants)
      .set({ name: input.name, slug: input.slug, timezone: input.timezone, currency: input.currency, plan: input.plan, status: input.status })
      .where(eq(tenants.id, tenantId))
      .returning();
    const pick = (t: Tenant) => ({ name: t.name, slug: t.slug, timezone: t.timezone, currency: t.currency, plan: t.plan, status: t.status });
    await audit(tx, tenantId, platformActor(adminId, ip), { type: 'tenant', id: tenantId }, 'platform.org_updated', diff(pick(before), pick(after!)));
    return after!;
  });
}

/** Suspend (read-only for members; sends and charges pause) or reactivate. */
export async function platformSetStatus(db: Db, adminId: string, tenantId: string, status: 'suspended' | 'active' | 'trial', ip?: string | null) {
  await assertAdmin(db, adminId);
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!before || before.status === 'closed') throw new OrgError('Organization not found.', 'not_found');
    const [after] = await tx.update(tenants).set({ status }).where(eq(tenants.id, tenantId)).returning();
    await audit(tx, tenantId, platformActor(adminId, ip), { type: 'tenant', id: tenantId }, status === 'suspended' ? 'platform.org_suspended' : 'platform.org_reactivated', {
      status: { from: before.status, to: status },
    });
    return after!;
  });
}

export const DELETE_GRACE_DAYS = 30;

/**
 * Delete = close now, hard-delete after a 30-day grace (the worker purges).
 * The caller must type the slug exactly. Members lose access immediately.
 */
export async function platformCloseOrg(db: Db, adminId: string, tenantId: string, typedSlug: string, ip?: string | null) {
  await assertAdmin(db, adminId);
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!before) throw new OrgError('Organization not found.', 'not_found');
    if (typedSlug.trim() !== before.slug) throw new OrgError(`Type ${before.slug} exactly to confirm.`, 'invalid');
    const purgeAfter = new Date(Date.now() + DELETE_GRACE_DAYS * 86_400_000);
    const [after] = await tx.update(tenants).set({ status: 'closed', closedAt: new Date(), purgeAfter }).where(eq(tenants.id, tenantId)).returning();
    await audit(tx, tenantId, platformActor(adminId, ip), { type: 'tenant', id: tenantId }, 'platform.org_closed', {
      previousStatus: before.status, purgeAfter: purgeAfter.toISOString(),
    });
    return after!;
  });
}

/** Undo a delete during the grace period. */
export async function platformRestoreOrg(db: Db, adminId: string, tenantId: string, ip?: string | null) {
  await assertAdmin(db, adminId);
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!before || before.status !== 'closed') throw new OrgError('Only a closed organization can be restored.', 'invalid');
    const [after] = await tx
      .update(tenants)
      .set({ status: before.onboardedAt ? 'active' : 'trial', closedAt: null, purgeAfter: null })
      .where(eq(tenants.id, tenantId))
      .returning();
    await audit(tx, tenantId, platformActor(adminId, ip), { type: 'tenant', id: tenantId }, 'platform.org_restored', {});
    return after!;
  });
}

// --- support sessions (impersonation) -------------------------------------------

export async function startImpersonation(db: Db, adminId: string, tenantId: string, sessionToken: string, reason: string) {
  const r = reason.trim();
  if (r.length < 3) throw new OrgError('Say why you are opening this organization (at least 3 characters).', 'invalid');
  const [row] = await db.execute<{ id: string }>(
    sql`select app_platform_start_impersonation(${adminId}, ${tenantId}::uuid, ${sha256Hex(sessionToken)}, ${r.slice(0, 500)}) as id`,
  );
  return row!.id;
}

export async function endImpersonation(db: Db, adminId: string, sessionToken: string) {
  await db.execute(sql`select app_platform_end_impersonation(${adminId}, ${sha256Hex(sessionToken)})`);
}

export async function activeImpersonation(db: Db, userId: string, sessionToken: string, tenantId: string) {
  const [row] = await db.execute<{ id: string; reason: string; started_at: string }>(
    sql`select * from app_active_impersonation(${userId}, ${sha256Hex(sessionToken)}, ${tenantId}::uuid)`,
  );
  return row ? { id: row.id, reason: row.reason, startedAt: new Date(row.started_at) } : null;
}

export type PlatformAuditRow = {
  id: string; at: Date; tenantId: string; tenantName: string | null; tenantSlug: string | null; actorType: string;
  actorName: string | null; actorEmail: string | null; entityType: string; action: string; changes: unknown; ip: string | null;
};

/** Audit log across every organization (console). */
export async function listPlatformAudit(db: Db, adminId: string, opts: { limit?: number; tenantId?: string | null; platformOnly?: boolean } = {}): Promise<PlatformAuditRow[]> {
  const rows = await db.execute<{
    id: string; at: string; tenant_id: string; tenant_name: string | null; tenant_slug: string | null; actor_type: string; actor_name: string | null;
    actor_email: string | null; entity_type: string; action: string; changes: unknown; ip: string | null;
  }>(sql`select * from app_platform_audit(${adminId}, ${opts.limit ?? 200}::int, ${opts.tenantId ?? null}::uuid, ${opts.platformOnly ?? false})`);
  return [...rows].map((r) => ({
    id: r.id, at: new Date(r.at), tenantId: r.tenant_id, tenantName: r.tenant_name, tenantSlug: r.tenant_slug, actorType: r.actor_type,
    actorName: r.actor_name, actorEmail: r.actor_email, entityType: r.entity_type, action: r.action, changes: r.changes, ip: r.ip,
  }));
}
