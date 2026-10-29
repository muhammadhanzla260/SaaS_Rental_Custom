import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgTable,
  primaryKey, text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { bytea, citext, createdAt, id, tenantId, updatedAt } from './columns';

/**
 * Tenant = one rental business. Global table: everyone can look a tenant up
 * by slug, but only the current tenant can update itself (see RLS migration).
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: citext('slug').notNull().unique(),
    status: text('status').notNull().default('trial'),
    plan: text('plan').notNull().default('growth'),
    /** Highest product phase this org runs live (console "Live · Phase 1"). */
    rolloutPhase: integer('rollout_phase').notNull().default(0),
    /** Set when the org is closed; the worker hard-deletes after purge_after (30-day grace). */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
    // Business profile
    name: text('name').notNull(),
    legalName: text('legal_name'),
    email: citext('email'),
    phone: text('phone'),
    website: text('website'),
    taxId: text('tax_id'),
    line1: text('line1'),
    line2: text('line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    addressCountry: text('address_country'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    // Branding
    logoFileId: uuid('logo_file_id'),
    logoDarkFileId: uuid('logo_dark_file_id'),
    brandColor: text('brand_color').notNull().default('#2C4FE0'),
    themeMode: text('theme_mode').notNull().default('light'),
    radius: text('radius').notNull().default('round'),
    // Regional
    country: text('country').notNull().default('US'),
    timezone: text('timezone').notNull(),
    currency: text('currency').notNull().default('USD'),
    locale: text('locale').notNull().default('en-US'),
    // Everything else (formats, booking defaults, hours, numbering, communication)
    settings: jsonb('settings').notNull().default({}),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('tenants_status', sql`${t.status} in ('trial','active','past_due','suspended','closed')`),
    check('tenants_plan', sql`${t.plan} in ('starter','growth','scale')`),
    check('tenants_theme_mode', sql`${t.themeMode} in ('system','light','dark')`),
    check('tenants_radius', sql`${t.radius} in ('sharp','soft','round')`),
    check('tenants_brand_color', sql`${t.brandColor} ~ '^#[0-9A-F]{6}$'`),
  ],
);

export const memberships = pgTable(
  'memberships',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').notNull().default('active'),
    title: text('title'),
    allLocations: boolean('all_locations').notNull().default(true),
    commissionRate: numeric('commission_rate', { precision: 7, scale: 4 }),
    /** Coach / crew vehicle ("Van 2 · white Transit"). */
    vehicle: text('vehicle'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('memberships_tenant_user').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
    check('memberships_role', sql`${t.role} in ('owner','admin','manager','sales','coach','crew','accountant','viewer')`),
    check('memberships_status', sql`${t.status} in ('active','disabled')`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    email: citext('email').notNull(),
    name: text('name'),
    role: text('role').notNull(),
    /** Empty = all locations. */
    locationIds: uuid('location_ids').array().notNull().default(sql`'{}'::uuid[]`),
    commissionRate: numeric('commission_rate', { precision: 7, scale: 4 }),
    vehicle: text('vehicle'),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    tokenSha256: text('token_sha256').notNull().unique(),
    invitedByUserId: text('invited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    check('invitations_role', sql`${t.role} in ('owner','admin','manager','sales','coach','crew','accountant','viewer')`),
  ],
);

/**
 * A location: a place rental equipment ships from (branch, warehouse, yard).
 * Its map pin drives travel-fee distance; its time zone comes from the pin.
 */
export const locations = pgTable(
  'locations',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    timezone: text('timezone').notNull(),
    phone: text('phone'),
    email: citext('email'),
    line1: text('line1'),
    line2: text('line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('US'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    loadingNotes: text('loading_notes'),
    settings: jsonb('settings').notNull().default({}),
    isPrimary: boolean('is_primary').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('locations_tenant_code').on(t.tenantId, t.code),
    // At most one primary location per organization.
    uniqueIndex('locations_one_primary').on(t.tenantId).where(sql`${t.isPrimary}`),
  ],
);

export const membershipLocations = pgTable(
  'membership_locations',
  {
    tenantId: tenantId(),
    membershipId: uuid('membership_id').notNull(),
    locationId: uuid('location_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.membershipId, t.locationId] }),
    foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
  ],
);

export const taxRates = pgTable(
  'tax_rates',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    locationId: uuid('location_id'),
    name: text('name').notNull(),
    rate: numeric('rate', { precision: 7, scale: 4 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    check('tax_rates_rate', sql`${t.rate} >= 0 and ${t.rate} <= 100`),
  ],
);

/** Human document numbers: Q-01042, INV-00001. Incremented with UPDATE ... RETURNING. */
export const numberSequences = pgTable(
  'number_sequences',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    prefix: text('prefix').notNull(),
    padding: integer('padding').notNull().default(5),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.scope] })],
);

/** Uploaded files. `storage = 'db'` keeps bytes here until object storage (R2) is set up. */
export const files = pgTable(
  'files',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    storage: text('storage').notNull().default('db'),
    storageKey: text('storage_key'),
    content: bytea('content'),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    purpose: text('purpose').notNull(),
    isPublic: boolean('is_public').notNull().default(false),
    uploadedByUserId: text('uploaded_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    check('files_storage', sql`${t.storage} in ('db','s3')`),
  ],
);
