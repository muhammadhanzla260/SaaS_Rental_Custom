import { z } from 'zod';
import { normalizePhone } from './phone';
import { addressSchema } from './settings';

/**
 * Inputs for catalog, customers and orders. Money arrives as dollars in forms
 * and is stored as integer cents.
 */

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) => text(max).transform((v) => (v ? v : undefined)).optional();
const money = z.coerce.number().min(0, 'Use a positive amount.').max(1_000_000);
const optionalMoney = z
  .union([z.literal(''), z.null(), money])
  .optional()
  .transform((v) => (v === '' || v == null ? null : v));
const phone = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const e164 = normalizePhone(v, 'US');
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number.' });
      return z.NEVER;
    }
    return e164;
  });
const email = z
  .union([z.literal(''), z.email('Enter a valid email address.')])
  .optional()
  .transform((v) => v || undefined);

export const toCents = (dollars: number) => Math.round(dollars * 100);

export const categorySchema = z.object({ name: text(80).min(2, 'Give the category a name.') });

export const PRODUCT_KINDS = [
  { value: 'rental', label: 'Rental' },
  { value: 'addon', label: 'Add-on' },
  { value: 'service', label: 'Service' },
  { value: 'fee', label: 'Fee' },
  { value: 'merchandise', label: 'Merchandise' },
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number]['value'];

export const TRACKING = [
  { value: 'pooled', label: 'Pooled', hint: 'You own several identical units. Bookings count against the quantity per location.' },
  { value: 'serialized', label: 'Serialized', hint: 'Each unit has its own label and maintenance status. Units in maintenance cannot be booked.' },
  { value: 'none', label: 'Not tracked', hint: 'Services and fees never run out.' },
] as const;
export type Tracking = (typeof TRACKING)[number]['value'];

/** Tile icons and tints for products without a photo. */
export const PRODUCT_ICONS = ['castle', 'slide', 'water', 'screen', 'popcorn', 'cotton', 'game', 'tent', 'table', 'chair', 'generator', 'service', 'box'] as const;
export const PRODUCT_TINTS = ['cobalt', 'emerald', 'violet', 'sky', 'ink', 'navy', 'amber', 'rose', 'slate', 'mist'] as const;

export const SERVICE_MODES = [
  { value: 'staffed', label: 'Staffed' },
  { value: 'pickup', label: 'Pick-up' },
  { value: 'dropoff', label: 'Drop-off' },
] as const;

const poolSchema = z.object({
  owned: z.coerce.number().int().min(0).max(10000),
  outOfService: z.coerce.number().int().min(0).max(10000).default(0),
  allowOverbooking: z.boolean().default(false),
});

export const productSchema = z
  .object({
    name: text(120).min(2, 'Give the product a name.'),
    kind: z.enum(['rental', 'addon', 'service', 'fee', 'merchandise']).default('rental'),
    tracking: z.enum(['pooled', 'serialized', 'none']).default('pooled'),
    icon: z.enum(PRODUCT_ICONS).nullable().optional(),
    tint: z.enum(PRODUCT_TINTS).nullable().optional(),
    commissionable: z.boolean().default(true),
    suggestedAddonIds: z.array(z.string().uuid()).max(30).default([]),
    /** Branch prices: [{ locationId, mode, price }] (dollars). */
    locationPrices: z
      .array(z.object({ locationId: z.string().uuid(), mode: z.enum(['staffed', 'pickup', 'dropoff']), price: money }))
      .max(60)
      .default([]),
    categoryId: z.string().uuid().nullable().optional(),
    sku: optional(40),
    description: optional(4000),
    status: z.enum(['active', 'draft', 'archived']).default('active'),
    priceStaffed: money,
    pricePickup: optionalMoney,
    priceDropoff: optionalMoney,
    baseHours: z.union([z.literal(''), z.null(), z.coerce.number().min(0).max(240)]).optional().transform((v) => (v === '' || v == null || v === 0 ? null : v)),
    hourlyRate: optionalMoney,
    minHours: z.union([z.literal(''), z.null(), z.coerce.number().min(0).max(240)]).optional().transform((v) => (v === '' || v == null || v === 0 ? null : v)),
    overtimeBlockMinutes: z.coerce.number().int().min(5).max(120).default(15),
    overtimeBlockPrice: money.default(25),
    turnaroundMinutes: z.union([z.literal(''), z.null(), z.coerce.number().int().min(0).max(2880)]).optional().transform((v) => (v === '' || v == null ? null : v)),
    taxable: z.boolean().default(true),
    /** Stock at each location: { [locationId]: { owned, outOfService, allowOverbooking } }. */
    inventory: z.record(z.string().uuid(), poolSchema).default({}),
  })
  .superRefine((p, ctx) => {
    for (const [loc, v] of Object.entries(p.inventory)) {
      if (v.outOfService > v.owned) ctx.addIssue({ code: 'custom', message: 'Out of service cannot be more than owned.', path: ['inventory', loc, 'outOfService'] });
    }
    const seen = new Set<string>();
    for (const [i, r] of p.locationPrices.entries()) {
      const key = `${r.locationId}:${r.mode}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', message: 'That branch already has a price for this mode.', path: ['locationPrices', i, 'mode'] });
      seen.add(key);
    }
  });
export type ProductInput = z.infer<typeof productSchema>;
export type ProductFormValues = z.input<typeof productSchema>;

export const unitSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid('Choose a location.'),
  label: text(60).min(1, 'Give the unit a label, like Castle #3.'),
  serial: optional(60),
  notes: optional(500),
});
export type UnitInput = z.infer<typeof unitSchema>;

export const UNIT_STATUS = {
  ready: { label: 'Available', tone: 'success' },
  cleaning: { label: 'Cleaning', tone: 'info' },
  maintenance: { label: 'Maintenance', tone: 'warning' },
  out_of_service: { label: 'Out of service', tone: 'danger' },
} as const;
export type UnitStatus = keyof typeof UNIT_STATUS;

export const HOW_HEARD = [
  'Google search', 'Repeat customer', 'Referral', 'Facebook', 'Instagram', 'Yelp', 'Google ad', 'Website chat',
  'Vehicle graphic', 'Sign', 'Printed ad', 'Radio', 'Other',
] as const;

export const customerSchema = z
  .object({
    kind: z.enum(['individual', 'organization']).default('individual'),
    firstName: optional(80),
    lastName: optional(80),
    companyName: optional(120),
    email,
    phone,
    phoneSecondary: phone,
    address: addressSchema,
    source: optional(60),
    referredByCustomerId: z.string().uuid().nullable().optional(),
    notes: optional(4000),
    tags: z.array(text(30).min(1)).max(12).default([]),
    smsOptIn: z.boolean().default(true),
    marketingOptIn: z.boolean().default(false),
    taxExempt: z.boolean().default(false),
  })
  .refine((c) => !!(c.firstName || c.lastName || c.companyName), { message: 'Enter a name or a company.', path: ['firstName'] })
  .refine((c) => !!(c.email || c.phone), { message: 'Add an email or a phone number so you can reach them.', path: ['email'] });
export type CustomerInput = z.infer<typeof customerSchema>;
export type CustomerFormValues = z.input<typeof customerSchema>;

/** Suggested customer tags (free text is allowed too). */
export const CUSTOMER_TAGS = ['VIP', 'School', 'Church', 'HOA', 'Corporate', 'Do not rent'] as const;

export const customerAddressSchema = z.object({
  label: text(60).min(1, 'Name this place, like Home or Zilker Park.'),
  kind: z.enum(['billing', 'event']).default('event'),
  address: addressSchema,
});
export type CustomerAddressInput = z.infer<typeof customerAddressSchema>;

export const CREDIT_KINDS = {
  rain_check: { label: 'Rain check', prefix: 'RC' },
  wallet: { label: 'Wallet credit', prefix: 'WC' },
  goodwill: { label: 'Goodwill credit', prefix: 'GW' },
} as const;
export type CreditKind = keyof typeof CREDIT_KINDS;

export const creditSchema = z.object({
  kind: z.enum(['rain_check', 'wallet', 'goodwill']),
  amount: money.refine((v) => v > 0, 'Enter an amount.'),
  reason: optional(300),
  validUntil: z.union([z.literal(''), z.null(), z.iso.date()]).optional().transform((v) => v || null),
});
export type CreditInput = z.infer<typeof creditSchema>;

export const couponSchema = z.object({
  code: text(30).min(2, 'Enter a code.').regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only.').transform((v) => v.toUpperCase()),
  kind: z.enum(['percent', 'amount']).default('percent'),
  value: z.coerce.number().positive('Enter a value.').max(100000),
  validFrom: z.union([z.literal(''), z.null(), z.iso.date()]).optional().transform((v) => v || null),
  validUntil: z.union([z.literal(''), z.null(), z.iso.date()]).optional().transform((v) => v || null),
  maxUses: z.union([z.literal(''), z.null(), z.coerce.number().int().min(1)]).optional().transform((v) => (v === '' || v == null ? null : v)),
  active: z.boolean().default(true),
}).refine((c) => c.kind !== 'percent' || c.value < 100, { message: 'A percentage must be under 100.', path: ['value'] });
export type CouponInput = z.infer<typeof couponSchema>;

export const EVENT_TYPES = ['Birthday', 'School or church', 'HOA or community', 'Company or team', 'Wedding', 'Movie night', 'Other'] as const;

export const orderLineSchema = z
  .object({
    /** Null for a custom line (then `name` and `overridePrice` are required). */
    productId: z.string().uuid().nullable().default(null),
    name: optional(160),
    serviceMode: z.enum(['staffed', 'pickup', 'dropoff']).default('staffed'),
    quantity: z.coerce.number().int().min(1).max(500),
    flatRate: z.boolean().default(false),
    /** Manual price in dollars; null = the automatic price. */
    overridePrice: optionalMoney,
    taxable: z.boolean().default(true),
    setupSurface: z.string().max(40).nullable().optional(),
  })
  .refine((l) => l.productId || l.name, { message: 'Describe the custom line.', path: ['name'] })
  .refine((l) => l.productId || l.overridePrice != null, { message: 'Enter a price for the custom line.', path: ['overridePrice'] });
export type OrderLineInput = z.infer<typeof orderLineSchema>;

export const billingSchema = z.object({
  name: optional(160),
  email,
  phone,
  phone2: phone,
  address: addressSchema.optional(),
});
export type BillingInput = z.infer<typeof billingSchema>;

export const orderSchema = z
  .object({
    customerId: z.string().uuid('Choose a customer.'),
    locationId: z.string().uuid('Choose a location.'),
    eventType: optional(60),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    multiDay: z.boolean().default(false),
    eventSameAsBilling: z.boolean().default(true),
    eventLocationName: optional(120),
    eventAddress: addressSchema,
    eventContactName: optional(120),
    eventContactMobile: phone,
    eventContactEmail: email,
    contactConfirmed: z.boolean().default(false),
    customerAddressId: z.string().uuid().nullable().optional(),
    eventMiles: z.union([z.literal(''), z.null(), z.coerce.number().min(0).max(5000)]).optional().transform((v) => (v === '' || v == null ? null : v)),
    milesOverridden: z.boolean().default(false),
    setupSurface: z.string().max(40).nullable().optional(),
    eventLocationFee: z.boolean().default(false),
    eventLocationFeeAmount: money.default(0),
    billing: billingSchema.prefault({}),
    salespersonUserId: z.string().max(64).nullable().optional(),
    referredByCustomerId: z.string().uuid().nullable().optional(),
    lines: z.array(orderLineSchema).max(60),
    damageWaiver: z.boolean().default(true),
    damageWaiverPercent: z.coerce.number().min(0).max(100).optional(),
    travelFee: money.default(0),
    travelFeeOverridden: z.boolean().default(false),
    travelInfo: z.record(z.string(), z.unknown()).nullable().optional(),
    miscFees: money.default(0),
    discount: z
      .object({ kind: z.enum(['percent', 'amount']), value: z.coerce.number().min(0), afterTax: z.boolean().default(false) })
      .nullable()
      .optional(),
    couponCode: optional(40),
    coupon: money.default(0),
    /** Rain checks and credits to apply: [{ creditId, amount }] (dollars). */
    credits: z.array(z.object({ creditId: z.string().uuid(), amount: money })).max(20).default([]),
    taxPercent: z.coerce.number().min(0).max(100).optional(),
    taxOverridden: z.boolean().default(false),
    deposit: z.object({ kind: z.enum(['percent', 'amount']), value: z.coerce.number().min(0) }).default({ kind: 'percent', value: 30 }),
    source: optional(60),
    internalNotes: optional(4000),
    customerNotes: optional(4000),
  })
  .refine((o) => o.endsAt.getTime() !== o.startsAt.getTime(), { message: 'The event must end after it starts.', path: ['endsAt'] })
  .refine((o) => !o.multiDay || o.endsAt > o.startsAt, { message: 'The end date must be after the start.', path: ['endsAt'] })
  .refine((o) => !o.discount || o.discount.kind !== 'percent' || o.discount.value < 100, { message: 'A discount cannot cover the whole order.', path: ['discount'] });
export type OrderInput = z.infer<typeof orderSchema>;
export type OrderFormValues = z.input<typeof orderSchema>;

export const MANUAL_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'zelle', label: 'Zelle' },
  { value: 'venmo', label: 'Venmo' },
  { value: 'ach', label: 'ACH / bank transfer' },
  { value: 'other', label: 'Other' },
] as const;

export const UNPAID_REASONS = ['Mailed check expected', 'External invoice sent', 'Purchase order pending', 'Management approval', 'Other'] as const;

/** How the deposit is handled when booking. Card and pay link need a connected gateway (Phase 2). */
export const bookingSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('manual'),
    payMethod: z.enum(['cash', 'check', 'zelle', 'venmo', 'ach', 'other']),
    amount: money.refine((v) => v > 0, 'Enter the amount received.'),
    reference: optional(80),
  }),
  z.object({
    method: z.literal('none'),
    reason: z.enum(UNPAID_REASONS, 'Choose a reason.'),
    expectedOn: z.iso.date('Pick the date you expect payment.'),
    notes: optional(1000),
  }),
]);
export type BookingInput = z.infer<typeof bookingSchema>;

export const ORDER_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  quote_sent: { label: 'Quote sent', tone: 'info' },
  booked: { label: 'Booked', tone: 'success' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
} as const;
export type OrderStatus = keyof typeof ORDER_STATUS;

/** Where an order can go next, and which button does it. */
export const ORDER_TRANSITIONS: Record<OrderStatus, { action: 'send_quote' | 'book' | 'complete' | 'cancel' | 'reopen'; to: OrderStatus }[]> = {
  draft: [{ action: 'send_quote', to: 'quote_sent' }, { action: 'book', to: 'booked' }, { action: 'cancel', to: 'cancelled' }],
  quote_sent: [{ action: 'book', to: 'booked' }, { action: 'cancel', to: 'cancelled' }],
  booked: [{ action: 'complete', to: 'completed' }, { action: 'cancel', to: 'cancelled' }],
  completed: [],
  cancelled: [{ action: 'reopen', to: 'draft' }],
};
