import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, updatedAt } from './columns';
import { locations, tenants } from './org';

/**
 * Outgoing mail per organization (location_id null) or per location.
 * Secrets are AES-256-GCM encrypted by the app (crypto.ts) and never sent
 * back to browsers once saved.
 */
export const mailAccounts = pgTable(
  'mail_accounts',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    locationId: uuid('location_id'),
    mode: text('mode').notNull().default('platform'),
    provider: text('provider').notNull().default('other'),
    host: text('host'),
    port: integer('port').notNull().default(587),
    security: text('security').notNull().default('starttls'),
    username: text('username'),
    secretEnc: text('secret_enc'),
    fromName: text('from_name'),
    fromEmail: text('from_email'),
    replyTo: text('reply_to'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    // One org-level account, and at most one per location.
    uniqueIndex('mail_accounts_org').on(t.tenantId).where(sql`${t.locationId} is null`),
    uniqueIndex('mail_accounts_location').on(t.tenantId, t.locationId).where(sql`${t.locationId} is not null`),
    check('mail_accounts_mode', sql`${t.mode} in ('platform','smtp')`),
    check('mail_accounts_security', sql`${t.security} in ('starttls','ssl','none')`),
  ],
);

export const smsAccounts = pgTable(
  'sms_accounts',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    provider: text('provider').notNull().default('none'),
    sendingNumber: text('sending_number'),
    accountId: text('account_id'),
    secretEnc: text('secret_enc'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('sms_accounts_org').on(t.tenantId),
    check('sms_accounts_provider', sql`${t.provider} in ('none','twilio','quo')`),
  ],
);

export const paymentAccounts = pgTable(
  'payment_accounts',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    locationId: uuid('location_id'),
    provider: text('provider').notNull().default('manual'),
    /** iPOS Pay terminal id (TPN). */
    merchantId: text('merchant_id'),
    publishableKey: text('publishable_key'),
    secretEnc: text('secret_enc'),
    /** 'test' or 'live', read from the key prefix. */
    keyMode: text('key_mode'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    uniqueIndex('payment_accounts_org').on(t.tenantId).where(sql`${t.locationId} is null`),
    uniqueIndex('payment_accounts_location').on(t.tenantId, t.locationId).where(sql`${t.locationId} is not null`),
    check('payment_accounts_provider', sql`${t.provider} in ('manual','stripe','ipos')`),
  ],
);
