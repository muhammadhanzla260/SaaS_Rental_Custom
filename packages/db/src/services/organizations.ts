import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  detectRegion, parsePreferences, tenantPreferencesSchema,
  type Branding, type BusinessProfile, type OnboardingInput, type Regional, type Role, type TenantPreferences,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { files, locations, memberships, numberSequences, tenants } from '../schema';
import { audit, diff, type Actor } from './audit';
import { locationValues, setTaxRate } from './locations';

export type Tenant = typeof tenants.$inferSelect;
export type Membership = typeof memberships.$inferSelect;

export type UploadedFile = { bytes: Buffer; mime: string; filename: string };

export const LOGO_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const LOGO_MAX_BYTES = 1024 * 1024;

export { OrgError } from './errors';
import { OrgError } from './errors';

const addressColumns = (a: OnboardingInput['profile']['address']) => ({
  line1: a.line1 ?? null,
  line2: a.line2 ?? null,
  city: a.city ?? null,
  region: a.region ?? null,
  postalCode: a.postalCode ?? null,
  lat: a.lat ?? null,
  lng: a.lng ?? null,
});

export async function isSlugAvailable(db: Db, slug: string): Promise<boolean> {
  const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows.length === 0;
}

export async function getTenantBySlug(db: Db, slug: string): Promise<Tenant | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

/** Organisations a user belongs to (crosses tenants, so it uses a SECURITY DEFINER function). */
export async function listUserTenants(db: Db, userId: string) {
  const rows = await db.execute<{
    tenant_id: string; slug: string; name: string; role: Role; brand_color: string; logo_file_id: string | null;
  }>(sql`select * from app_user_tenants(${userId})`);
  return [...rows];
}

/**
 * Creates the organisation, owner membership and first location in one
 * transaction. Region (time zone, currency, formats) is detected from the
 * business country and the location's map pin, not asked for.
 */
export async function createOrganization(
  db: Db,
  owner: { userId: string; ip?: string | null },
  input: OnboardingInput,
  logo?: UploadedFile | null,
): Promise<Tenant> {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
    if (existing.length) throw new OrgError('That web address is already taken.', 'slug_taken');

    const country = input.profile.address.country || input.location.address.country;
    const pin = input.location.address.lat != null ? input.location.address : input.profile.address;
    const region = detectRegion(country, pin, input.deviceTimezone);

    const prefs: TenantPreferences = tenantPreferencesSchema.parse({
      formats: region.formats,
      booking: input.booking,
    });
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: input.slug,
        name: input.profile.name,
        legalName: input.profile.legalName ?? null,
        email: input.profile.email ?? null,
        phone: input.profile.phone ?? null,
        website: input.profile.website ?? null,
        taxId: input.profile.taxId ?? null,
        ...addressColumns(input.profile.address),
        addressCountry: input.profile.address.country,
        brandColor: input.branding.brandColor,
        themeMode: input.branding.themeMode,
        radius: input.branding.radius,
        country: region.country,
        timezone: region.timezone,
        currency: region.currency,
        locale: region.locale,
        settings: prefs,
        onboardedAt: new Date(),
      })
      .returning();
    if (!tenant) throw new Error('Tenant insert returned nothing');

    await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
    const actor: Actor = { type: 'user', userId: owner.userId, ip: owner.ip };

    await tx.insert(memberships).values({ tenantId: tenant.id, userId: owner.userId, role: 'owner' });

    const [location] = await tx
      .insert(locations)
      .values({ tenantId: tenant.id, ...locationValues(input.location, region.timezone), isPrimary: true, isActive: true })
      .returning();
    if (!location) throw new Error('Location insert returned nothing');
    await setTaxRate(tx, tenant.id, location.id, input.booking.defaultTaxPercent);

    await tx.insert(numberSequences).values([
      { tenantId: tenant.id, scope: 'quote', prefix: prefs.numbering.quotePrefix },
      { tenantId: tenant.id, scope: 'invoice', prefix: prefs.numbering.invoicePrefix },
      { tenantId: tenant.id, scope: 'receipt', prefix: prefs.numbering.receiptPrefix },
    ]);

    let result = tenant;
    if (logo) {
      const fileId = await storeFile(tx, tenant.id, owner.userId, logo, 'logo', true);
      [result] = (await tx.update(tenants).set({ logoFileId: fileId }).where(eq(tenants.id, tenant.id)).returning()) as [Tenant];
    }

    await audit(tx, tenant.id, actor, { type: 'tenant', id: tenant.id }, 'tenant.created', {
      slug: input.slug,
      location: location.name,
      timezone: region.timezone,
      currency: region.currency,
    });
    return result;
  });
}

/** Membership of the signed-in user in the tenant with this slug, or null. */
export async function resolveTenantMembership(db: Db, slug: string, userId: string) {
  const tenant = await getTenantBySlug(db, slug);
  if (!tenant) return null;
  const membership = await withTenant(db, tenant.id, async (tx) => {
    const rows = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
      .limit(1);
    return rows[0] ?? null;
  });
  return membership ? { tenant, membership } : null;
}

// --- settings updates ------------------------------------------------------

async function updateTenant(
  db: Db,
  tenantId: string,
  actor: Actor,
  action: string,
  values: Partial<typeof tenants.$inferInsert>,
): Promise<Tenant> {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!before) throw new OrgError('Organization not found.', 'not_found');
    const [after] = await tx.update(tenants).set(values).where(eq(tenants.id, tenantId)).returning();
    if (!after) throw new OrgError('You cannot change this organization.', 'forbidden');
    const pick = (t: Tenant) => Object.fromEntries(Object.keys(values).map((k) => [k, t[k as keyof Tenant]]));
    const changes = diff(pick(before), pick(after));
    if (Object.keys(changes).length) await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, action, changes);
    return after;
  });
}

export function updateProfile(db: Db, tenantId: string, actor: Actor, p: BusinessProfile) {
  return updateTenant(db, tenantId, actor, 'tenant.profile_updated', {
    name: p.name,
    legalName: p.legalName ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    website: p.website ?? null,
    taxId: p.taxId ?? null,
    ...addressColumns(p.address),
    addressCountry: p.address.country,
  });
}

export function updateBranding(
  db: Db,
  tenantId: string,
  actor: Actor,
  b: Branding,
  logos: { logoFileId?: string | null; logoDarkFileId?: string | null } = {},
) {
  return updateTenant(db, tenantId, actor, 'tenant.branding_updated', {
    brandColor: b.brandColor,
    themeMode: b.themeMode,
    radius: b.radius,
    ...logos,
  });
}

export function updateRegional(db: Db, tenantId: string, actor: Actor, r: Regional) {
  return updateTenant(db, tenantId, actor, 'tenant.regional_updated', {
    country: r.country,
    timezone: r.timezone,
    currency: r.currency,
    locale: r.locale,
  });
}

/** Replace one section of tenants.settings (formats, booking, hours, numbering, communication). */
export async function updatePreferences<K extends keyof TenantPreferences>(
  db: Db,
  tenantId: string,
  actor: Actor,
  section: K,
  value: TenantPreferences[K],
) {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!row) throw new OrgError('Organization not found.', 'not_found');
    const current = parsePreferences(row.settings);
    const next = tenantPreferencesSchema.parse({ ...current, [section]: value });
    await tx.update(tenants).set({ settings: next }).where(eq(tenants.id, tenantId));
    if (section === 'numbering') {
      const n = next.numbering;
      for (const [scope, prefix] of [['quote', n.quotePrefix], ['invoice', n.invoicePrefix], ['receipt', n.receiptPrefix]] as const) {
        await tx
          .insert(numberSequences)
          .values({ tenantId, scope, prefix })
          .onConflictDoUpdate({ target: [numberSequences.tenantId, numberSequences.scope], set: { prefix } });
      }
    }
    const changes = diff(current[section] as Record<string, unknown>, next[section] as Record<string, unknown>);
    if (Object.keys(changes).length) {
      await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, `tenant.${section}_updated`, changes);
    }
    return next;
  });
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
  const [row] = await tx
    .insert(files)
    .values({
      tenantId,
      storage: 'db',
      content: file.bytes,
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
  if (file.bytes.length > LOGO_MAX_BYTES) throw new OrgError('The logo must be 1 MB or smaller.', 'invalid');
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
