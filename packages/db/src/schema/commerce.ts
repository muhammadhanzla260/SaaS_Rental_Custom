import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text,
  timestamp, unique, uniqueIndex, uuid,
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
    /** pooled = identical units counted per location; serialized = each unit tracked; none = never runs out. */
    tracking: text('tracking').notNull().default('pooled'),
    /** Tile icon and tint when there is no photo (catalog, order screen). */
    icon: text('icon'),
    tint: text('tint'),
    commissionable: boolean('commissionable').notNull().default(true),
    /** Shown on the order screen when this item is in the cart. */
    suggestedAddonIds: uuid('suggested_addon_ids').array().notNull().default(sql`'{}'::uuid[]`),
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
    check('products_kind', sql`${t.kind} in ('rental','addon','service','fee','merchandise')`),
    check('products_status', sql`${t.status} in ('active','draft','archived')`),
    check('products_tracking', sql`${t.tracking} in ('pooled','serialized','none')`),
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
    /** Pooled stock that cannot be booked right now (broken, lent out). */
    outOfService: integer('out_of_service').notNull().default(0),
    /** Let bookings go past what is owned here (rentals you can sub-rent). */
    allowOverbooking: boolean('allow_overbooking').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.productId, t.locationId] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    check('inventory_pools_qty', sql`${t.quantityOwned} >= 0`),
    check('inventory_pools_oos', sql`${t.outOfService} >= 0 and ${t.outOfService} <= ${t.quantityOwned}`),
  ],
);

/** A branch's own base price for one service mode (the rest of the rule follows the product). */
export const productLocationPrices = pgTable(
  'product_location_prices',
  {
    tenantId: tenantId(),
    productId: uuid('product_id').notNull(),
    locationId: uuid('location_id').notNull(),
    serviceMode: text('service_mode').notNull(),
    priceCents: bigint('price_cents', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.productId, t.locationId, t.serviceMode] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    check('product_location_prices_mode', sql`${t.serviceMode} in ('staffed','pickup','dropoff')`),
    check('product_location_prices_price', sql`${t.priceCents} >= 0`),
  ],
);

/**
 * One physical unit of a serialized product. Units in maintenance or out of
 * service are held from bookings until they are marked available again.
 */
export const inventoryUnits = pgTable(
  'inventory_units',
  {
    tenantId: tenantId(),
    id: id(),
    productId: uuid('product_id').notNull(),
    locationId: uuid('location_id').notNull(),
    label: text('label').notNull(),
    serial: text('serial'),
    status: text('status').notNull().default('ready'),
    notes: text('notes'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.productId], foreignColumns: [products.tenantId, products.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }).onDelete('cascade'),
    check('inventory_units_status', sql`${t.status} in ('ready','cleaning','maintenance','out_of_service')`),
    index('inventory_units_product_idx').on(t.tenantId, t.productId, t.locationId),
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
    referredByCustomerId: uuid('referred_by_customer_id'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    smsOptIn: boolean('sms_opt_in').notNull().default(true),
    marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
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

/** A customer's saved places: home, a park they always use, the school gym. */
export const customerAddresses = pgTable(
  'customer_addresses',
  {
    tenantId: tenantId(),
    id: id(),
    customerId: uuid('customer_id').notNull(),
    label: text('label').notNull(),
    kind: text('kind').notNull().default('event'),
    line1: text('line1'),
    line2: text('line2'),
    city: text('city'),
    region: text('region'),
    postalCode: text('postal_code'),
    country: text('country').notNull().default('US'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }).onDelete('cascade'),
    check('customer_addresses_kind', sql`${t.kind} in ('billing','event')`),
    index('customer_addresses_customer_idx').on(t.tenantId, t.customerId),
  ],
);

/**
 * Money a customer can spend on a later order: a rain check from a rained-out
 * event, wallet credit (overpayments) or goodwill. Applied after tax, like Odoo's
 * raincheck discount and wallet outstanding. Balance = amount - applications.
 */
export const credits = pgTable(
  'credits',
  {
    tenantId: tenantId(),
    id: id(),
    customerId: uuid('customer_id').notNull(),
    kind: text('kind').notNull(),
    code: text('code').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    reason: text('reason'),
    validUntil: date('valid_until'),
    sourceOrderId: uuid('source_order_id'),
    createdByUserId: text('created_by_user_id'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('credits_code').on(t.tenantId, t.code),
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }).onDelete('cascade'),
    check('credits_kind', sql`${t.kind} in ('rain_check','wallet','goodwill')`),
    check('credits_amount', sql`${t.amountCents} > 0`),
    index('credits_customer_idx').on(t.tenantId, t.customerId),
  ],
);

/** Coupon codes (FALL10): % or $ off merchandise, optional window and use limit. */
export const coupons = pgTable(
  'coupons',
  {
    tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
    id: id(),
    code: citext('code').notNull(),
    kind: text('kind').notNull().default('percent'),
    value: numeric('value', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    validFrom: date('valid_from'),
    validUntil: date('valid_until'),
    maxUses: integer('max_uses'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('coupons_code').on(t.tenantId, t.code),
    check('coupons_kind', sql`${t.kind} in ('percent','amount')`),
    check('coupons_value', sql`${t.value} > 0`),
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
    contactConfirmed: boolean('contact_confirmed').notNull().default(false),
    /** The saved address picked for the event, if any (the address fields above are the snapshot). */
    customerAddressId: uuid('customer_address_id'),
    /** Driving miles from the nearest depot; `milesOverridden` when staff typed it. */
    eventMiles: numeric('event_miles', { precision: 8, scale: 2, mode: 'number' }),
    milesOverridden: boolean('miles_overridden').notNull().default(false),
    setupSurface: text('setup_surface'),
    eventLocationFee: boolean('event_location_fee').notNull().default(false),
    eventLocationFeeCents: bigint('event_location_fee_cents', { mode: 'number' }).notNull().default(0),
    /** Billing details copied onto this order: { name, email, phone, phone2, address }. */
    billing: jsonb('billing').notNull().default({}),
    salespersonUserId: text('salesperson_user_id'),
    referredByCustomerId: uuid('referred_by_customer_id'),
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
    discountNote: text('discount_note'),
    couponCode: text('coupon_code'),
    couponId: uuid('coupon_id'),
    couponCents: bigint('coupon_cents', { mode: 'number' }).notNull().default(0),
    /** Rain checks and wallet credit applied (see credit_applications). */
    creditCents: bigint('credit_cents', { mode: 'number' }).notNull().default(0),
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
    /** Setup map (image or PDF, files table) shared with the crew. */
    setupMapFileId: uuid('setup_map_file_id'),
    /** "Notes for coach" in the coach portal (Odoo coach_setup_instructions). */
    coachNotes: text('coach_notes'),
    /** Policies staff confirmed the customer agreed to when booking for them: { key: { at, by } }. */
    policyAcks: jsonb('policy_acks').notNull().default({}),
    /** What happened to the money when it was cancelled: wallet credit, refund, rain check ("Rained out") or nothing paid. */
    cancelOutcome: text('cancel_outcome'),
    /** Ops board "Mark called": the pre-event call was made (who and when are in the history). */
    preEventCalledAt: timestamp('pre_event_called_at', { withTimezone: true }),
    quoteSentAt: timestamp('quote_sent_at', { withTimezone: true }),
    /** sha256 of the customer's quote-page token (the token itself is only ever in the link). */
    accessTokenHash: text('access_token_hash'),
    /** The same token, encrypted (APP_ENCRYPTION_KEY), so later emails can carry the same link. */
    accessTokenEnc: text('access_token_enc'),
    quoteExpiresOn: date('quote_expires_on'),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    /** Booked without payment: why, when the money is expected, and follow-up notes (feeds the Ops board). */
    unpaidReason: text('unpaid_reason'),
    expectedPaymentOn: date('expected_payment_on'),
    followUpNotes: text('follow_up_notes'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    /**
     * Staff-only: the order this one was copied from (Duplicate order). Only the form was copied; nothing
     * else links the two (own number, payments, invoice). Not a foreign key, so removing either is fine.
     */
    copiedFromOrderId: uuid('copied_from_order_id'),
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
    check('orders_cancel_outcome', sql`${t.cancelOutcome} is null or ${t.cancelOutcome} in ('none','wallet','refund','rain_check')`),
    check('orders_period', sql`${t.eventEndsAt} > ${t.eventStartsAt}`),
    check('orders_discount_kind', sql`${t.discountKind} is null or ${t.discountKind} in ('percent','amount')`),
    check('orders_deposit_kind', sql`${t.depositKind} in ('percent','amount','none')`),
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
    /** Null for a custom line. */
    productId: uuid('product_id'),
    name: text('name').notNull(),
    serviceMode: text('service_mode').notNull().default('staffed'),
    taxable: boolean('taxable').notNull().default(true),
    quantity: integer('quantity').notNull().default(1),
    unitCents: bigint('unit_cents', { mode: 'number' }).notNull(),
    autoUnitCents: bigint('auto_unit_cents', { mode: 'number' }).notNull(),
    priceOverridden: boolean('price_overridden').notNull().default(false),
    flatRate: boolean('flat_rate').notNull().default(false),
    /** Locked on the order when the line is priced: the mode's base package and the additional-time rate. */
    baseCents: bigint('base_cents', { mode: 'number' }),
    extraRateCents: bigint('extra_rate_cents', { mode: 'number' }),
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

/** Every saved change to an order: what changed, the totals after, and who did it. */
export const orderVersions = pgTable(
  'order_versions',
  {
    tenantId: tenantId(),
    id: id(),
    orderId: uuid('order_id').notNull(),
    version: integer('version').notNull(),
    action: text('action').notNull(),
    diff: jsonb('diff').notNull().default({}),
    totals: jsonb('totals').notNull().default({}),
    actorUserId: text('actor_user_id'),
    actorName: text('actor_name'),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('order_versions_version').on(t.tenantId, t.orderId, t.version),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
  ],
);

/** How much of a credit an order uses. Cancelling the order frees it again. */
export const creditApplications = pgTable(
  'credit_applications',
  {
    tenantId: tenantId(),
    creditId: uuid('credit_id').notNull(),
    orderId: uuid('order_id').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.creditId, t.orderId] }),
    foreignKey({ columns: [t.tenantId, t.creditId], foreignColumns: [credits.tenantId, credits.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('credit_applications_amount', sql`${t.amountCents} > 0`),
  ],
);

/**
 * Money received against an order. Phase 1 records manual payments (cash,
 * check, Zelle, Venmo, ACH); card and pay-link payments arrive with Phase 2.
 */
export const payments = pgTable(
  'payments',
  {
    tenantId: tenantId(),
    id: id(),
    number: text('number').notNull(),
    orderId: uuid('order_id').notNull(),
    method: text('method').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    /** Tip on top of the amount (not part of the order total). */
    tipCents: bigint('tip_cents', { mode: 'number' }).notNull().default(0),
    invoiceId: uuid('invoice_id'),
    /** manual, stripe or ipos; gatewayRef is the PaymentIntent / transaction id (unique per workspace). */
    gateway: text('gateway').notNull().default('manual'),
    gatewayRef: text('gateway_ref'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    /** Gateway steps: { authorizedAt, capturedAt, fundedAt }. */
    steps: jsonb('steps').notNull().default({}),
    reference: text('reference'),
    note: text('note'),
    status: text('status').notNull().default('received'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Receipts carry the order's number (Q-AUS-00098), like its quote and invoice: not unique.
    index('payments_number_idx').on(t.tenantId, t.number),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('payments_method', sql`${t.method} in ('cash','check','zelle','venmo','ach','card','link','other')`),
    check('payments_status', sql`${t.status} in ('received','refunded','void')`),
    // A tip collected on its own after booking has no amount, only the tip.
    check('payments_amount', sql`${t.amountCents} >= 0 and (${t.amountCents} > 0 or ${t.tipCents} > 0)`),
    check('payments_gateway', sql`${t.gateway} in ('manual','stripe','ipos')`),
    unique('payments_gateway_ref').on(t.tenantId, t.gatewayRef),
    index('payments_order_idx').on(t.tenantId, t.orderId),
  ],
);

/**
 * Money given back (cancel → refund). Card payments are refunded through the
 * gateway (gatewayRef = the gateway's refund id); the rest is handed back by
 * staff (cash, check...). The order's paid amount goes down by the refund.
 */
export const refunds = pgTable(
  'refunds',
  {
    tenantId: tenantId(),
    id: id(),
    number: text('number').notNull(),
    orderId: uuid('order_id').notNull(),
    paymentId: uuid('payment_id'),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    gateway: text('gateway').notNull().default('manual'),
    gatewayRef: text('gateway_ref'),
    reason: text('reason'),
    createdByUserId: text('created_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('refunds_number').on(t.tenantId, t.number),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('refunds_amount', sql`${t.amountCents} > 0`),
    check('refunds_gateway', sql`${t.gateway} in ('manual','stripe','ipos')`),
    index('refunds_order_idx').on(t.tenantId, t.orderId),
  ],
);

/** Ops board: a card hidden until a time ("Snooze 1 day", or after "Send pay link"). */
export const opsSnoozes = pgTable(
  'ops_snoozes',
  {
    tenantId: tenantId(),
    orderId: uuid('order_id').notNull(),
    /** Which card: deposit, final_payment, call, contact, quote. */
    rule: text('rule').notNull(),
    until: timestamp('until', { withTimezone: true }).notNull(),
    reason: text('reason'),
    createdByUserId: text('created_by_user_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.orderId, t.rule] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('ops_snoozes_rule', sql`${t.rule} in ('deposit','final_payment','call','contact','quote')`),
  ],
);

/**
 * One invoice per order, numbered like the order (Q-AUS-00098 from draft to paid
 * in full). Its amount is always the order's current total, so edits after the
 * deposit change what is due; the deposit and the event-day balance are steps
 * of its payment schedule (due_on is the next unmet step).
 */
export const invoices = pgTable(
  'invoices',
  {
    tenantId: tenantId(),
    id: id(),
    number: text('number').notNull(),
    orderId: uuid('order_id').notNull(),
    kind: text('kind').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    paidCents: bigint('paid_cents', { mode: 'number' }).notNull().default(0),
    dueOn: date('due_on').notNull(),
    autoCharge: boolean('auto_charge').notNull().default(false),
    status: text('status').notNull().default('open'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    lastChargeAt: timestamp('last_charge_at', { withTimezone: true }),
    lastChargeError: text('last_charge_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('invoices_one_per_order').on(t.tenantId, t.orderId),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('invoices_kind', sql`${t.kind} in ('deposit','balance','full','tip')`),
    check('invoices_status', sql`${t.status} in ('open','paid','overdue','void')`),
    check('invoices_amount', sql`${t.amountCents} >= 0`),
    index('invoices_order_idx').on(t.tenantId, t.orderId),
    index('invoices_due_idx').on(t.tenantId, t.status, t.dueOn),
  ],
);

/** A card saved at the gateway for the event-day balance (only the gateway's ids and the last 4 digits). */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    tenantId: tenantId(),
    id: id(),
    customerId: uuid('customer_id').notNull(),
    gateway: text('gateway').notNull(),
    gatewayCustomerId: text('gateway_customer_id'),
    gatewayMethodId: text('gateway_method_id').notNull(),
    brand: text('brand'),
    last4: text('last4'),
    expMonth: integer('exp_month'),
    expYear: integer('exp_year'),
    /** The customer agreed to the event-day charge (quote page consent). */
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique('payment_methods_gateway').on(t.tenantId, t.gateway, t.gatewayMethodId),
    foreignKey({ columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }).onDelete('cascade'),
    check('payment_methods_gateway_kind', sql`${t.gateway} in ('stripe','ipos')`),
    index('payment_methods_customer_idx').on(t.tenantId, t.customerId),
  ],
);

/** The customer's signature on the rental agreement, with the exact text they signed. */
export const signatures = pgTable(
  'signatures',
  {
    tenantId: tenantId(),
    id: id(),
    orderId: uuid('order_id').notNull(),
    agreementVersion: text('agreement_version').notNull(),
    agreementText: text('agreement_text').notNull(),
    typedName: text('typed_name').notNull(),
    /** Policies ticked on the quote page: { key: ISO time }; waiver: accepted or declined. */
    policies: jsonb('policies').notNull().default({}),
    waiverAccepted: boolean('waiver_accepted'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    channel: text('channel').notNull().default('quote_page'),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [orders.tenantId, orders.id] }).onDelete('cascade'),
    check('signatures_channel', sql`${t.channel} in ('quote_page','on_site','staff')`),
    index('signatures_order_idx').on(t.tenantId, t.orderId),
  ],
);
