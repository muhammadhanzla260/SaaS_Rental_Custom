import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { tenants } from './org';

/**
 * Platform owner support sessions: the owner opens an organization as a
 * read-only viewer. Bound to one login session; every one is audited.
 * Platform-level table: only reachable through SECURITY DEFINER functions.
 */
export const platformImpersonations = pgTable(
  'platform_impersonations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** sha256 of the admin's session token: the impersonation dies with that session. */
    sessionTokenSha256: text('session_token_sha256').notNull(),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('platform_impersonations_admin_idx').on(t.adminUserId, t.tenantId),
    check('platform_impersonations_reason', sql`length(${t.reason}) between 3 and 500`),
  ],
);

/** Workspace addresses that were released recently stay blocked for a while (no takeover). */
export const releasedSlugs = pgTable(
  'released_slugs',
  {
    slug: text('slug').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.slug] })],
);
