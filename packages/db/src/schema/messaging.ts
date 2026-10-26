import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, updatedAt } from './columns';
import { orders } from './commerce';
import { tenants } from './org';

/** A workspace's own copy of a message template (no row = the built-in default). */
export const messageTemplates = pgTable(
  'message_templates',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    type: text('type').notNull(),
    channel: text('channel').notNull(),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull().default(''),
    buttonText: text('button_text').notNull().default(''),
    mode: text('mode').notNull().default('builder'),
    rawSource: text('raw_source').notNull().default(''),
    rawKind: text('raw_kind').notNull().default('html'),
    attachDocument: boolean('attach_document').notNull().default(false),
    attachAgreement: boolean('attach_agreement').notNull().default(false),
    tracking: boolean('tracking').notNull().default(false),
    autoPlainText: boolean('auto_plain_text').notNull().default(true),
    version: integer('version').notNull().default(1),
    updatedByName: text('updated_by_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('message_templates_type').on(t.tenantId, t.type, t.channel),
    check('message_templates_channel', sql`${t.channel} in ('email','sms')`),
    check('message_templates_mode', sql`${t.mode} in ('builder','raw')`),
  ],
);

/**
 * Every email and text: queued, scheduled, sent or skipped. The idempotency key
 * is unique per workspace, so the same message can never be sent twice (Odoo's
 * rental.email.log send_key rule). Rendered content is stored at send time.
 */
export const messages = pgTable(
  'messages',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    idempotencyKey: text('idempotency_key').notNull(),
    orderId: uuid('order_id'),
    locationId: uuid('location_id'),
    type: text('type').notNull(),
    channel: text('channel').notNull(),
    /** customer, contact (on-site contact) or office. */
    audience: text('audience').notNull().default('customer'),
    toAddress: text('to_address'),
    toName: text('to_name'),
    subject: text('subject'),
    html: text('html'),
    text: text('text'),
    status: text('status').notNull().default('queued'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    providerRef: text('provider_ref'),
    /** Extra fields for this one message (payment, invoice, reason, resend of ...). */
    meta: jsonb('meta').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('messages_idempotency').on(t.tenantId, t.idempotencyKey),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('messages_channel', sql`${t.channel} in ('email','sms')`),
    check('messages_status', sql`${t.status} in ('queued','sending','sent','delivered','bounced','failed','skipped','cancelled')`),
    index('messages_due_idx').on(t.status, t.scheduledFor),
    index('messages_order_idx').on(t.tenantId, t.orderId),
    index('messages_log_idx').on(t.tenantId, t.createdAt),
  ],
);

/**
 * Reports someone set to "Email weekly" (one per report per workspace). The
 * worker sends them together on Monday mornings in the workspace's time zone.
 */
export const reportSchedules = pgTable(
  'report_schedules',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    reportKey: text('report_key').notNull(),
    /** The period switch at the time it was scheduled (never 'custom'). */
    period: text('period').notNull().default('this_month'),
    locationId: uuid('location_id'),
    createdByUserId: text('created_by_user_id'),
    lastSentOn: date('last_sent_on', { mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.reportKey] }),
    check('report_schedules_period', sql`${t.period} in ('this_month','last_month','quarter','year')`),
  ],
);
