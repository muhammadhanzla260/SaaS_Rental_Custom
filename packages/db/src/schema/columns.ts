import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (emails, slugs). Requires the citext extension. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Raw bytes (logos and small files when no object storage is configured). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const id = () => uuid('id').notNull().defaultRandom();
export const tenantId = () => uuid('tenant_id').notNull();
export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
