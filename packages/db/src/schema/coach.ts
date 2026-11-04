import { sql } from 'drizzle-orm';
import {
  boolean, check, doublePrecision, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { createdAt, id, tenantId, updatedAt } from './columns';
import { orders } from './commerce';
import { files, tenants } from './org';

/**
 * Coaches and crew on an order (Odoo coach_ids + coach_id). Coaches see the order in the coach
 * portal and run its checklist; one of them is the lead (named in the customer texts). Crew see
 * the order but tick nothing.
 */
export const orderStaff = pgTable(
  'order_staff',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    isLead: boolean('is_lead').notNull().default(false),
    assignedByUserId: text('assigned_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.orderId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('order_staff_role', sql`${t.role} in ('coach','crew')`),
    check('order_staff_lead', sql`not ${t.isLead} or ${t.role} = 'coach'`),
    uniqueIndex('order_staff_one_lead').on(t.tenantId, t.orderId).where(sql`${t.isLead}`),
    index('order_staff_user_idx').on(t.tenantId, t.userId),
  ],
);

/**
 * One order's coach checklist and en-route record. `state` holds the ticks and phase saves
 * (@rental/core CoachState: ticks, saved, reopened); everything with a time or a place has a column.
 */
export const coachChecklists = pgTable(
  'coach_checklists',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id').notNull(),
    state: jsonb('state').notNull().default({}),
    /** Arrival Checks: why a step could not be done. */
    overrideReason: text('override_reason'),
    /** Setup & Event Start: SOP / setup notes. */
    sopNotes: text('sop_notes'),
    damage: boolean('damage').notNull().default(false),
    damageNotes: text('damage_notes'),
    /** Damage was reported at close-out: the warehouse must check the equipment. */
    maintenanceFlag: boolean('maintenance_flag').notNull().default(false),
    // en route and live tracking
    enRouteAt: timestamp('en_route_at', { withTimezone: true }),
    enRouteByUserId: text('en_route_by_user_id'),
    tracking: boolean('tracking').notNull().default(false),
    lastLat: doublePrecision('last_lat'),
    lastLng: doublePrecision('last_lng'),
    lastFixAt: timestamp('last_fix_at', { withTimezone: true }),
    etaMinutes: integer('eta_minutes'),
    /** When Text 1 (en route) and Text 2 (5 minutes away) were queued. Each goes once. */
    text1At: timestamp('text1_at', { withTimezone: true }),
    text2At: timestamp('text2_at', { withTimezone: true }),
    // arrival and EVENT START
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    arrivedLat: doublePrecision('arrived_lat'),
    arrivedLng: doublePrecision('arrived_lng'),
    arrivedDistanceM: integer('arrived_distance_m'),
    eventStartedAt: timestamp('event_started_at', { withTimezone: true }),
    eventStartLat: doublePrecision('event_start_lat'),
    eventStartLng: doublePrecision('event_start_lng'),
    eventStartVarianceMin: integer('event_start_variance_min'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.orderId] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    index('coach_checklists_tracking_idx').on(t.tenantId).where(sql`${t.tracking}`),
  ],
);

/** Photo proof on a checklist: the load, setup and close-out photos, and damage photos. */
export const coachPhotos = pgTable(
  'coach_photos',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    orderId: uuid('order_id').notNull(),
    kind: text('kind').notNull(),
    fileId: uuid('file_id').notNull(),
    /** When the photo was taken (a phone that was offline sends the original time). */
    takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
    uploadedByUserId: text('uploaded_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id] }).onDelete('cascade'),
    check('coach_photos_kind', sql`${t.kind} in ('load','setup','closeout','damage')`),
    index('coach_photos_order_idx').on(t.tenantId, t.orderId),
  ],
);

/**
 * Live GPS while en route (every 25 s, only between Start En Route and Text 2 / arrival / Stop
 * Tracking). Deleted after 90 days.
 */
export const coachGpsPings = pgTable(
  'coach_gps_pings',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    orderId: uuid('order_id').notNull(),
    userId: text('user_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    accuracyM: integer('accuracy_m'),
    etaMinutes: integer('eta_minutes'),
    /** Recorded but not used (a jump or a coarse fix). */
    ignored: text('ignored'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    index('coach_gps_pings_order_idx').on(t.tenantId, t.orderId, t.at),
    index('coach_gps_pings_age_idx').on(t.at),
  ],
);

export type CoachChecklistRow = typeof coachChecklists.$inferSelect;
export type OrderStaffRow = typeof orderStaff.$inferSelect;
