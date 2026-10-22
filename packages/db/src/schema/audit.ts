import { inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Audit log for every entity. Partitioned by month, so it is created by the
 * hand-written migration (drizzle-kit cannot declare partitions) and is kept
 * out of drizzle.config.ts. This definition is only used for queries.
 */
export const auditLog = pgTable('audit_log', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull().defaultRandom(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorType: text('actor_type').notNull(),
  actorUserId: text('actor_user_id'),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  action: text('action').notNull(),
  changes: jsonb('changes'),
  ip: inet('ip'),
});
