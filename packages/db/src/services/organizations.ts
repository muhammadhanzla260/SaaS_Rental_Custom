import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  CURRENCIES, detectRegion, locationSchema, parsePreferences, tenantPreferencesSchema,
  type BookingDefaults, type BrandStep, type BusinessProfile, type LocationInput, type LocationValues, type OnboardingStepKey,
  type ProfileStep, type Regional, type Role, type TenantPreferences, type WarehouseStep,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { objectKey, objectStore } from '../storage';
import { files, locations, memberships, tenants } from '../schema';
import { audit, diff, type Actor } from './audit';
import { createLocation, updateLocation } from './locations';

export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;

export type UploadedFile = { bytes: Buffer; mime: string; filename: string };

export const LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export { OrgError } from './errors';
import { OrgError } from './errors';

const addressColumns = (a: BusinessProfile['address']) => ({
  line1: a.line1 ?? null,
  line2: a.line2 ?? null,
  city: a.city ?? null,
  region: a.region ?? null,
  postalCode: a.postalCode ?? null,
  lat: a.lat ?? null,
  lng: a.lng ?? null,
});

/** Free when no live org uses it and it was not released in the last 90 days. */
export async function isSlugAvailable(db: Db, slug: string): Promise<boolean> {
  const [row] = await db.execute<{ taken: boolean }>(sql`select app_slug_taken(${slug}) as taken`);
  return !row?.taken;
}

export async function getTenantBySlug(db: Db, slug: string): Promise<Tenant | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export type UserTenant = {
  tenant_id: string; slug: string; name: string; role: Role; brand_color: string; logo_file_id: string | null;
  status: string; onboarded: boolean; locations: number;
};

/** Organizations a user belongs to (crosses tenants, so it uses a SECURITY DEFINER function). */
export async function listUserTenants(db: Db, userId: string): Promise<UserTenant[]> {
  const rows = await db.execute<UserTenant>(sql`select * from app_user_tenants(${userId})`);
  return [...rows];
}

export type WorkspaceInput = {
  name: string;
  slug: string;
  country: string;
  deviceTimezone?: string;
  plan?: 'starter' | 'growth' | 'scale';
  status?: 'trial' | 'active' | 'past_due';
  timezone?: string;
  currency?: string;
};

/**
 * Creates an organization at registration (or from the platform console).
 * Region is detected from the country and refined by the first location's
 * map pin during onboarding. With `owner` the person becomes its owner now;
 * without (console), the owner joins through an invitation.
 */
export async function createWorkspace(db: Db, owner: { userId: string; ip?: string | null } | null, input: WorkspaceInput, actor?: Actor): Promise<Tenant> {
  if (!(await isSlugAvailable(db, input.slug))) throw new OrgError('That workspace URL is already taken.', 'slug_taken');
  return db.transaction(async (tx) => {
    const region = detectRegion(input.country, null, input.deviceTimezone);
    const currency = input.currency ?? (CURRENCIES.some((c) => c.code === region.currency) ? region.currency : 'USD');
    const prefs: TenantPreferences = tenantPreferencesSchema.parse({ formats: region.formats });
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: input.slug,
        name: input.name,
        status: input.status ?? 'trial',
        plan: input.plan ?? 'growth',
        country: region.country,
        addressCountry: region.country,
        timezone: input.timezone ?? region.timezone,
        currency,
        locale: region.locale,
        settings: prefs,
      })
      .returning();
    if (!tenant) throw new Error('Tenant insert returned nothing');
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
    if (owner) await tx.insert(memberships).values({ tenantId: tenant.id, userId: owner.userId, role: 'owner' });
    const who: Actor = actor ?? { type: 'user', userId: owner?.userId ?? null, ip: owner?.ip ?? null };
    await audit(tx, tenant.id, who, { type: 'tenant', id: tenant.id }, 'tenant.created', {
      slug: input.slug, name: input.name, plan: tenant.plan, status: tenant.status, timezone: tenant.timezone, currency,
    });
    return tenant;
  });
}

/** Membership of the signed-in user in the tenant with this slug, or null. */
export async function resolveTenantMembership(db: Db, slug: string, userId: string) {
  const tenant = await getTenantBySlug(db, slug);
  if (!tenant || tenant.status === 'closed') return null;
  const membership = await withTenant(db, tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
      .limit(1);
    return rows[0] ?? null;
  });
  return { tenant, membership };
}

// --- settings updates ------------------------------------------------------

async function updateTenantTx(tx: Tx, tenantId: string, actor: Actor, action: string, values: Partial<typeof tenants.$inferInsert>): Promise<Tenant> {
  const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!before) throw new OrgError('Organization not found.', 'not_found');
  const [after] = await tx.update(tenants).set(values).where(eq(tenants.id, tenantId)).returning();
  if (!after) throw new OrgError('You cannot change this organization.', 'forbidden');
  const pick = (t: Tenant) => Object.fromEntries(Object.keys(values).filter((k) => k !== 'settings').map((k) => [k, t[k as keyof Tenant]]));
  const changes = diff(pick(before), pick(after));
  if (Object.keys(changes).length) await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, action, changes);
  return after;
}

function updateTenant(db: Db, tenantId: string, actor: Actor, action: string, values: Partial<typeof tenants.$inferInsert>) {
  return withTenant(db, tenantId, (tx) => updateTenantTx(tx, tenantId, actor, action, values));
}

const profileColumns = (p: BusinessProfile) => ({
  name: p.name,
  legalName: p.legalName ?? null,
  email: p.email ?? null,
  phone: p.phone ?? null,
  website: p.website ?? null,
  taxId: p.taxId ?? null,
  ...addressColumns(p.address),
  addressCountry: p.address.country,
});

export function updateProfile(db: Db, tenantId: string, actor: Actor, p: BusinessProfile) {
  return updateTenant(db, tenantId, actor, 'tenant.profile_updated', profileColumns(p));
}

export function updateRegional(db: Db, tenantId: string, actor: Actor, r: Regional) {
  return updateTenant(db, tenantId, actor, 'tenant.regional_updated', {
    country: r.country,
    timezone: r.timezone,
    currency: r.currency,
    locale: r.locale,
  });
}

async function readPrefs(tx: Tx, tenantId: string) {
  const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!row) throw new OrgError('Organization not found.', 'not_found');
  return parsePreferences(row.settings);
}

/** Replace sections of tenants.settings inside a transaction; audits what changed. */
async function writePrefsTx(tx: Tx, tenantId: string, actor: Actor | null, patch: Partial<TenantPreferences>) {
  const current = await readPrefs(tx, tenantId);
  const next = tenantPreferencesSchema.parse({ ...current, ...patch });
  await tx.update(tenants).set({ settings: next }).where(eq(tenants.id, tenantId));
  if (actor) {
    for (const section of Object.keys(patch) as (keyof TenantPreferences)[]) {
      if (section === 'onboarding' || section === 'setupDone') continue;
      const changes = diff(current[section] as Record<string, unknown>, next[section] as Record<string, unknown>);
      if (Object.keys(changes).length) await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, `tenant.${section}_updated`, changes);
    }
  }
  return next;
}

/** Replace one section of tenants.settings (formats, booking, hours, numbering, communication, brand). */
export function updatePreferences<K extends keyof TenantPreferences>(db: Db, tenantId: string, actor: Actor, section: K, value: TenantPreferences[K]) {
  return withTenant(db, tenantId, (tx) => writePrefsTx(tx, tenantId, actor, { [section]: value } as Partial<TenantPreferences>));
}

/** Brand & theme: columns (colour, appearance, corners) + brand settings (sidebar, fonts, logo variants, customer-facing details). */
export function updateBrand(db: Db, tenantId: string, actor: Actor, input: BrandStep, logos: { logoFileId?: string | null } = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const current = await readPrefs(tx, tenantId);
    const domainChanged = (input.brand.customDomain ?? null) !== (current.brand.customDomain ?? null);
    await updateTenantTx(tx, tenantId, actor, 'tenant.branding_updated', {
      brandColor: input.branding.brandColor,
      themeMode: input.branding.themeMode,
      radius: input.branding.radius,
      ...logos,
    });
    return writePrefsTx(tx, tenantId, actor, {
      brand: { ...input.brand, customDomainVerified: domainChanged ? false : current.brand.customDomainVerified },
    });
  });
}

// --- onboarding --------------------------------------------------------------

async function markStepTx(tx: Tx, tenantId: string, step: OnboardingStepKey, how: 'done' | 'skipped', nextIndex: number) {
  const p = (await readPrefs(tx, tenantId)).onboarding;
  const done = how === 'done' ? [...new Set([...p.done, step])] : p.done;
  const skipped = how === 'skipped' ? [...new Set([...p.skipped, step])] : p.skipped.filter((s) => s !== step);
  await writePrefsTx(tx, tenantId, null, { onboarding: { done, skipped, current: Math.max(0, Math.min(5, nextIndex)) } });
}

/** Remember where the person is ("Save & finish later" resumes here) or that a step was skipped. */
export function markOnboarding(db: Db, tenantId: string, step: OnboardingStepKey, how: 'done' | 'skipped', nextIndex: number) {
  return withTenant(db, tenantId, (tx) => markStepTx(tx, tenantId, step, how, nextIndex));
}

/** Step 1: business profile and region. */
export function saveProfileStep(db: Db, tenantId: string, actor: Actor, input: ProfileStep) {
  return withTenant(db, tenantId, async (tx) => {
    const t = await updateTenantTx(tx, tenantId, actor, 'tenant.profile_updated', {
      ...profileColumns(input.profile),
      timezone: input.timezone,
      currency: input.currency,
    });
    const prefs = await readPrefs(tx, tenantId);
    await writePrefsTx(tx, tenantId, actor, { formats: { ...prefs.formats, dateFormat: input.dateFormat, weekStartsOn: input.weekStartsOn } });
    await markStepTx(tx, tenantId, 'profile', 'done', 1);
    return t;
  });
}

/** Step 2: brand and theme. */
export async function saveBrandStep(db: Db, tenantId: string, actor: Actor, input: BrandStep, logos: { logoFileId?: string | null } = {}) {
  await updateBrand(db, tenantId, actor, input, logos);
  await markOnboarding(db, tenantId, 'brand', 'done', 2);
}

/**
 * Step 3: the first warehouse (location = warehouse) and the org's travel
 * defaults. Saving again updates the primary location instead of adding one.
 */
export async function saveWarehouseStep(db: Db, tenantId: string, actor: Actor, input: WarehouseStep & { taxPercent?: number }) {
  const primary = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select().from(locations).where(eq(locations.isPrimary, true)).limit(1);
    return row ?? null;
  });
  const loc: LocationValues = { ...input.location, isPrimary: true, isActive: true };
  const location = primary
    ? await updateLocation(db, tenantId, actor, primary.id, loc, input.taxPercent ?? 0)
    : await createLocation(db, tenantId, actor, loc, input.taxPercent ?? 0);
  await withTenant(db, tenantId, async (tx) => {
    const prefs = await readPrefs(tx, tenantId);
    await writePrefsTx(tx, tenantId, actor, { booking: { ...prefs.booking, ...input.travel } });
    await markStepTx(tx, tenantId, 'warehouse', 'done', 3);
  });
  return location;
}

/** Step 6: pick the plan and open the workspace. */
export function launchWorkspace(db: Db, tenantId: string, actor: Actor, plan: 'starter' | 'growth' | 'scale') {
  return withTenant(db, tenantId, async (tx) => {
    await markStepTx(tx, tenantId, 'launch', 'done', 5);
    // Launching puts the org live on everything released so far (Phase 1: catalog and booking).
    const [cur] = await tx.select({ rolloutPhase: tenants.rolloutPhase }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return updateTenantTx(tx, tenantId, actor, 'tenant.launched', { plan, onboardedAt: new Date(), rolloutPhase: Math.max(1, cur?.rolloutPhase ?? 0) });
  });
}

/** Home checklist: tick or untick an item by hand. */
export function setSetupItem(db: Db, tenantId: string, item: string, done: boolean) {
  return withTenant(db, tenantId, async (tx) => {
    const prefs = await readPrefs(tx, tenantId);
    const set = new Set(prefs.setupDone);
    if (done) set.add(item);
    else set.delete(item);
    await writePrefsTx(tx, tenantId, null, { setupDone: [...set] });
  });
}

/**
 * One-call setup used by tests, seeding and the Phase 5 migration: a
 * workspace with its first location and rental rules, already launched.
 */
export async function setupOrganization(
  db: Db,
  owner: { userId: string },
  input: { slug: string; name: string; country?: string; location: LocationInput; booking?: Partial<BookingDefaults>; taxPercent?: number },
) {
  const actor: Actor = { type: 'user', userId: owner.userId };
  const tenant = await createWorkspace(db, owner, { name: input.name, slug: input.slug, country: input.country ?? 'US' });
  const location = await createLocation(db, tenant.id, actor, locationSchema.parse({ ...input.location, isPrimary: true }), input.taxPercent ?? 0);
  if (input.booking) {
    await withTenant(db, tenant.id, async (tx) => {
      const prefs = await readPrefs(tx, tenant.id);
      await writePrefsTx(tx, tenant.id, null, { booking: { ...prefs.booking, ...input.booking } });
    });
  }
  // The org runs on the location's clock.
  const launched = await withTenant(db, tenant.id, (tx) =>
    updateTenantTx(tx, tenant.id, actor, 'tenant.launched', { timezone: location.timezone, onboardedAt: new Date() }),
  );
  return launched;
}

// --- files -------------------------------------------------------------------

export async function storeFile(
  tx: Tx,
  tenantId: string,
  userId: string | null,
  file: UploadedFile,
  purpose: string,
  isPublic: boolean,
): Promise<string> {
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  // With object storage configured the bytes go to the bucket first; the row only records where.
  const id = randomUUID();
  const store = objectStore();
  if (store) await store.put(objectKey(tenantId, id), file.bytes, file.mime);
  const [row] = await tx
    .insert(files)
    .values({
      tenantId,
      id,
      storage: store ? 's3' : 'db',
      storageKey: store ? objectKey(tenantId, id) : null,
      content: store ? null : file.bytes,
      filename: file.filename.slice(0, 200),
      mime: file.mime,
      sizeBytes: file.bytes.length,
      sha256,
      purpose,
      isPublic,
      uploadedByUserId: userId,
    })
    .returning({ id: files.id });
  return row!.id;
}

export async function saveLogo(db: Db, tenantId: string, userId: string, file: UploadedFile) {
  if (!(LOGO_MIME as readonly string[]).includes(file.mime)) throw new OrgError('Upload a PNG, JPG, WebP or SVG image.', 'invalid');
  if (file.bytes.length > LOGO_MAX_BYTES) throw new OrgError('The logo must be 2 MB or smaller.', 'invalid');
  return withTenant(db, tenantId, (tx) => storeFile(tx, tenantId, userId, file, 'logo', true));
}

export async function getFile(db: Db, tenantId: string, fileId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(files)
      .where(and(eq(files.tenantId, tenantId), eq(files.id, fileId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export { hashToken };
function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** Recent audit entries for the tenant, newest first, with the actor's name. */
export function listActivity(db: Db, tenantId: string, limit = 100) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.execute<{
      id: string; at: string; action: string; entity_type: string; changes: unknown; actor_type: string; actor_name: string | null;
    }>(sql`
      select a.id, a.at, a.action, a.entity_type, a.changes, a.actor_type, u.name as actor_name
      from audit_log a left join users u on u.id = a.actor_user_id
      order by a.at desc limit ${limit}`);
    return [...rows];
  });
}

/** Who changed a settings area last ("Last changed by Jordan Reyes · 2 days ago"). */
export function lastChange(db: Db, tenantId: string, actionPrefix: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.execute<{ at: string; actor_name: string | null; actor_type: string }>(sql`
      select a.at, a.actor_type, u.name as actor_name
      from audit_log a left join users u on u.id = a.actor_user_id
      where a.action like ${actionPrefix + '%'}
      order by a.at desc limit 1`);
    return row ? { at: new Date(row.at), actorName: row.actor_name ?? (row.actor_type === 'platform' ? 'Platform support' : 'System') } : null;
  });
}

export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Product photos and other public images (PNG, JPG, WebP up to 4 MB). */
export const DOCUMENT_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

/** A private document for the team (setup map): image or PDF, members only. Returns the file id. */
export async function saveDocument(db: Db, tenantId: string, userId: string, file: UploadedFile, purpose: string) {
  if (!(DOCUMENT_MIME as readonly string[]).includes(file.mime)) throw new OrgError('Upload an image (PNG, JPG, WebP) or a PDF.', 'invalid');
  if (file.bytes.length > DOCUMENT_MAX_BYTES) throw new OrgError('The file must be 10 MB or smaller.', 'invalid');
  return withTenant(db, tenantId, (tx) => storeFile(tx, tenantId, userId, file, purpose, false));
}

export async function saveImage(db: Db, tenantId: string, userId: string, file: UploadedFile, purpose: string) {
  if (!(IMAGE_MIME as readonly string[]).includes(file.mime)) throw new OrgError('Upload a PNG, JPG or WebP photo.', 'invalid');
  if (file.bytes.length > IMAGE_MAX_BYTES) throw new OrgError('The photo must be 4 MB or smaller.', 'invalid');
  return withTenant(db, tenantId, (tx) => storeFile(tx, tenantId, userId, file, purpose, true));
}
