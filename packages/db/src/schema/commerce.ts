import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text,
  timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, id, tenantId, updatedAt } from './columns';
import { locations, tenants } from './org';

// --- catalog ---------------------------------------------------------------------------

export const productCategories = pgTable(
  'product_categories',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), unique('product_categories_slug').on(t.tenantId, t.slug)],
);

/**
 * A rentable item or add-on. Prices follow the Odoo product template: one price
 * per service mode (staffed / pick-up / drop-off), hours included, then either
 * an hourly rate or the overtime block ladder ($25 per 15 minutes by default).
 */
export const products = pgTable(
  'products',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    categoryId: uuid('category_id'),
    kind: text('kind').notNull().default('rental'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    sku: text('sku'),
    description: text('description'),
    status: text('status').notNull().default('active'),
    imageFileId: uuid('image_file_id'),
    priceStaffedCents: bigint('price_staffed_cents', { mode: 'number' }).notNull().default(0),
    pricePickupCents: bigint('price_pickup_cents', { mode: 'number' }),
    priceDropoffCents: bigint('price_dropoff_cents', { mode: 'number' }),
    baseHours: numeric('base_hours', { precision: 6, scale: 2, mode: 'number' }),
    hourlyRateCents: bigint('hourly_rate_cents', { mode: 'number' }),
    minHours: numeric('min_hours', { precision: 6, scale: 2, mode: 'number' }),
    overtimeBlockMinutes: integer('overtime_block_minutes').notNull().default(15),
    overtimeBlockCents: bigint('overtime_block_cents', { mode: 'number' }).notNull().default(2500),
    /** Cleanup buffer after return; null = the organization default (3 h). */
    turnaroundMinutes: integer('turnaround_minutes'),
    taxable: boolean('taxable').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    externalRefs: jsonb('external_refs').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('products_slug').on(t.tenantId, t.slug),
    foreignKey({ columns: [t.tenantId, t.categoryId], foreignColumns: [productCategories.tenantId, productCategories.id] }).onDelete('set null'),
    check('products_kind', sql`${t.kind} in ('rental','addon','service')`),
    check('products_status', sql`${t.status} in ('active','draft','archived')`),
    index('products_category_idx').on(t.tenantId, t.categoryId),
  ],
);

/** How many of a product each location owns (Odoo rental_quantity, per branch). */
export const inventoryPools = pgTable(
  'inventory_pools',
  {
    tenantId: tenantId(),
    productId: uuid('product_id').notNull(),
    locationId: uuid('location_id').notNull(),
    quantityOwned: integer('quantity_owned').notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.productId, t.locationId] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    check('inventory_pools_qty', sql`${t.quantityOwned} >= 0`),
  ],
);

// --- customers --------------------------------------------------------------------------

export const customers = pgTable(
  'customers',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    kind: text('kind').notNull().default('individual'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    companyName: text('company_name'),
    displayName: text('display_name').generatedAlwaysAs(
      sql`coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), company_name, 'Unnamed')`,
    ),
    email: citext('email'),
    phone: text('phone'),
    phoneSecondary: text('phone_secondary'),
    line1: text('line1'),
    line2: text('line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('US'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    source: text('source'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    smsOptIn: boolean('sms_opt_in').notNull().default(true),
    taxExempt: boolean('tax_exempt').notNull().default(false),
    externalRefs: jsonb('external_refs').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    check('customers_kind', sql`${t.kind} in ('individual','organization')`),
    index('customers_email_idx').on(t.tenantId, t.email),
    index('customers_phone_idx').on(t.tenantId, t.phone),
  ],
);

// --- orders -----------------------------------------------------------------------------

/** A rental order: draft -> quote_sent -> booked -> completed (or cancelled). */
export const orders = pgTable(
  'orders',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    number: text('number').notNull(),
    locationId: uuid('location_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    status: text('status').notNull().default('draft'),
    eventType: text('event_type'),
    eventStartsAt: timestamp('event_starts_at', { withTimezone: true }).notNull(),
    eventEndsAt: timestamp('event_ends_at', { withTimezone: true }).notNull(),
    multiDay: boolean('multi_day').notNull().default(false),
    eventSameAsBilling: boolean('event_same_as_billing').notNull().default(true),
    eventLocationName: text('event_location_name'),
    eventLine1: text('event_line1'),
    eventLine2: text('event_line2'),
    eventCity: text('event_city'),
    eventRegion: text('event_region'),
    eventPostalCode: text('event_postal_code'),
    eventCountry: text('event_country').notNull().default('US'),
    eventLat: doublePrecision('event_lat'),
    eventLng: doublePrecision('event_lng'),
    eventContactName: text('event_contact_name'),
    eventContactMobile: text('event_contact_mobile'),
    eventContactEmail: citext('event_contact_email'),
    // money inputs
    damageWaiver: boolean('damage_waiver').notNull().default(true),
    damageWaiverPercent: numeric('damage_waiver_percent', { precision: 6, scale: 3, mode: 'number' }).notNull().default(10),
    travelFeeCents: bigint('travel_fee_cents', { mode: 'number' }).notNull().default(0),
    travelFeeOverridden: boolean('travel_fee_overridden').notNull().default(false),
    travelInfo: jsonb('travel_info'),
    miscFeesCents: bigint('misc_fees_cents', { mode: 'number' }).notNull().default(0),
    discountKind: text('discount_kind'),
    discountValue: numeric('discount_value', { precision: 12, scale: 3, mode: 'number' }),
    discountAfterTax: boolean('discount_after_tax').notNull().default(false),
    couponCode: text('coupon_code'),
    couponCents: bigint('coupon_cents', { mode: 'number' }).notNull().default(0),
    taxPercent: numeric('tax_percent', { precision: 7, scale: 4, mode: 'number' }).notNull().default(0),
    taxOverridden: boolean('tax_overridden').notNull().default(false),
    depositKind: text('deposit_kind').notNull().default('percent'),
    depositValue: numeric('deposit_value', { precision: 12, scale: 3, mode: 'number' }).notNull().default(30),
    // money results (the pricing engine's summary, stored for lists and reports)
    merchandiseCents: bigint('merchandise_cents', { mode: 'number' }).notNull().default(0),
    extrasCents: bigint('extras_cents', { mode: 'number' }).notNull().default(0),
    discountCents: bigint('discount_cents', { mode: 'number' }).notNull().default(0),
    taxCents: bigint('tax_cents', { mode: 'number' }).notNull().default(0),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull().default(0),
    depositDueCents: bigint('deposit_due_cents', { mode: 'number' }).notNull().default(0),
    paidCents: bigint('paid_cents', { mode: 'number' }).notNull().default(0),
    summary: jsonb('summary').notNull().default({}),
    source: text('source'),
    internalNotes: text('internal_notes'),
    customerNotes: text('customer_notes'),
    quoteSentAt: timestamp('quote_sent_at', { withTimezone: true }),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    version: integer('version').notNull().default(1),
    createdByUserId: text('created_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('orders_number').on(t.tenantId, t.number),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    check('orders_status', sql`${t.status} in ('draft','quote_sent','booked','completed','cancelled')`),
    check('orders_period', sql`${t.eventEndsAt} > ${t.eventStartsAt}`),
    check('orders_discount_kind', sql`${t.discountKind} is null or ${t.discountKind} in ('percent','amount')`),
    check('orders_deposit_kind', sql`${t.depositKind} in ('percent','amount')`),
    index('orders_calendar_idx').on(t.tenantId, t.eventStartsAt),
    index('orders_customer_idx').on(t.tenantId, t.customerId),
    index('orders_status_idx').on(t.tenantId, t.status, t.eventStartsAt),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    tenantId: tenantId(),
    id: id(),
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id').notNull(),
    name: text('name').notNull(),
    serviceMode: text('service_mode').notNull().default('staffed'),
    quantity: integer('quantity').notNull().default(1),
    unitCents: bigint('unit_cents', { mode: 'number' }).notNull(),
    autoUnitCents: bigint('auto_unit_cents', { mode: 'number' }).notNull(),
    priceOverridden: boolean('price_overridden').notNull().default(false),
    flatRate: boolean('flat_rate').notNull().default(false),
    setupSurface: text('setup_surface'),
    setupSurfaceFeeCents: bigint('setup_surface_fee_cents', { mode: 'number' }).notNull().default(0),
    lineTotalCents: bigint('line_total_cents', { mode: 'number' }).notNull(),
    pricingTrace: jsonb('pricing_trace').notNull().default({}),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }),
    check('order_lines_mode', sql`${t.serviceMode} in ('staffed','pickup','dropoff')`),
    check('order_lines_qty', sql`${t.quantity} > 0`),
    index('order_lines_order_idx').on(t.tenantId, t.orderId),
  ],
);

/**
 * Equipment held for a booked order: busy from event start until return plus the
 * cleanup buffer (Odoo: 3 h). Written only through app_reserve_inventory(), which
 * locks per product+location and refuses to go over the quantity owned.
 */
export const reservations = pgTable(
  'reservations',
  {
    tenantId: tenantId(),
    id: id(),
    orderId: uuid('order_id').notNull(),
    orderLineId: uuid('order_line_id').notNull(),
    productId: uuid('product_id').notNull(),
    locationId: uuid('location_id').notNull(),
    quantity: integer('quantity').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    blockedUntil: timestamp('blocked_until', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.orderLineId], foreignColumns: [orderLines.tenantId, orderLines.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }),
    check('reservations_qty', sql`${t.quantity} > 0`),
    index('reservations_lookup_idx').on(t.tenantId, t.productId, t.locationId, t.startsAt),
  ],
);
