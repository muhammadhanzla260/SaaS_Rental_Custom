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

export const productSchema = z
  .object({
    name: text(120).min(2, 'Give the product a name.'),
    kind: z.enum(['rental', 'addon', 'service']).default('rental'),
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
    /** Quantity owned at each location: { [locationId]: quantity }. */
    inventory: z.record(z.string().uuid(), z.coerce.number().int().min(0).max(10000)).default({}),
  });
export type ProductInput = z.infer<typeof productSchema>;

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
    notes: optional(4000),
    smsOptIn: z.boolean().default(true),
    taxExempt: z.boolean().default(false),
  })
  .refine((c) => !!(c.firstName || c.lastName || c.companyName), { message: 'Enter a name or a company.', path: ['firstName'] })
  .refine((c) => !!(c.email || c.phone), { message: 'Add an email or a phone number so you can reach them.', path: ['email'] });
export type CustomerInput = z.infer<typeof customerSchema>;

export const EVENT_TYPES = ['Birthday', 'School or church', 'HOA or community', 'Company or team', 'Wedding', 'Movie night', 'Other'] as const;

export const orderLineSchema = z.object({
  productId: z.string().uuid(),
  serviceMode: z.enum(['staffed', 'pickup', 'dropoff']).default('staffed'),
  quantity: z.coerce.number().int().min(1).max(500),
  flatRate: z.boolean().default(false),
  /** Manual price in dollars; null = the automatic price. */
  overridePrice: optionalMoney,
  setupSurface: z.string().max(40).nullable().optional(),
});

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
    lines: z.array(orderLineSchema).max(60),
    damageWaiver: z.boolean().default(true),
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

export const ORDER_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  quote_sent: { label: 'Quote sent', tone: 'brand' },
  booked: { label: 'Booked', tone: 'ok' },
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
