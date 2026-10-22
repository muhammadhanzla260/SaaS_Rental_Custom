import { z } from 'zod';
import { HEX_RE, RADIUS_OPTIONS } from './theme';
import { isValidTimezone } from './regional';
import { normalizePhone } from './phone';

/**
 * Organisation settings. Identity, contact, branding and core regional values
 * are real columns on `tenants`; everything else lives in `tenants.settings`
 * (jsonb) and is parsed through `tenantPreferencesSchema`, which fills defaults
 * so older rows keep working when new settings are added.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .transform((v) => (v ? v : undefined))
    .optional();

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const RESERVED_SLUGS = new Set([
  'api', 'app', 'admin', 'auth', 'invite', 'onboarding', 'sign-in', 'sign-up', 'settings', 'www',
  'help', 'support', 'status', 'billing', 'static', 'assets', 'files', 'l', 'crew', 'public', 'docs',
]);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_RE, 'Use 3-40 lowercase letters, numbers or dashes, starting and ending with a letter or number.')
  .refine((s) => !RESERVED_SLUGS.has(s), 'This address is reserved. Pick another one.');

export const addressSchema = z.object({
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(120),
  region: optionalText(120),
  postalCode: optionalText(20),
  country: z.string().length(2).toUpperCase().default('US'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type Address = z.infer<typeof addressSchema>;

const phoneField = (country: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const e164 = normalizePhone(v, country);
      if (!e164) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number.' });
        return z.NEVER;
      }
      return e164;
    });

export const businessProfileSchema = z.object({
  name: trimmed(120).min(2, 'Enter your business name.'),
  legalName: optionalText(160),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]).optional().transform((v) => v || undefined),
  phone: phoneField('US'),
  website: z
    .union([z.literal(''), z.url('Enter a full web address, like https://example.com')])
    .optional()
    .transform((v) => v || undefined),
  taxId: optionalText(40),
  address: addressSchema,
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const brandingSchema = z.object({
  brandColor: z.string().regex(HEX_RE, 'Pick a colour in #RRGGBB format.').transform((v) => v.toUpperCase()),
  themeMode: z.enum(['system', 'light', 'dark']).default('system'),
  radius: z.enum(Object.keys(RADIUS_OPTIONS) as [keyof typeof RADIUS_OPTIONS, ...(keyof typeof RADIUS_OPTIONS)[]]).default('soft'),
});
export type Branding = z.infer<typeof brandingSchema>;

export const regionalSchema = z.object({
  country: z.string().length(2).toUpperCase(),
  timezone: z.string().refine(isValidTimezone, 'Pick a time zone from the list.'),
  currency: z.string().length(3).toUpperCase(),
  locale: z.string().min(2).max(20).default('en-US'),
});
export type Regional = z.infer<typeof regionalSchema>;

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const businessHoursSchema = z
  .array(
    z.object({
      day: z.enum(WEEKDAYS),
      open: z.boolean(),
      opens: z.string().regex(TIME_RE),
      closes: z.string().regex(TIME_RE),
    }),
  )
  .length(7)
  .refine((days) => days.every((d) => !d.open || d.opens < d.closes), 'Closing time must be after opening time.');

export const DEFAULT_HOURS: z.infer<typeof businessHoursSchema> = WEEKDAYS.map((day) => ({
  day,
  open: true,
  opens: '08:00',
  closes: day === 'sunday' ? '18:00' : '20:00',
}));

export const bookingDefaultsSchema = z.object({
  depositPercent: z.coerce.number().min(0).max(100).default(30),
  balanceDue: z.enum(['event_day', 'days_before']).default('event_day'),
  balanceDueDaysBefore: z.coerce.number().int().min(0).max(90).default(0),
  autoChargeBalance: z.boolean().default(true),
  quoteValidDays: z.coerce.number().int().min(1).max(365).default(14),
  cleanupBufferMinutes: z.coerce.number().int().min(0).max(1440).default(180),
  lastMinuteHours: z.coerce.number().int().min(0).max(720).default(48),
  maxAdvanceMonths: z.coerce.number().int().min(1).max(60).default(18),
  quotesHoldInventory: z.boolean().default(false),
  damageWaiverPercent: z.coerce.number().min(0).max(100).default(10),
  damageWaiverDefaultOn: z.boolean().default(true),
  freeTravelDistance: z.coerce.number().min(0).max(1000).default(10),
  travelRateStaffed: z.coerce.number().min(0).max(1000).default(2.5),
  travelRateDropoff: z.coerce.number().min(0).max(1000).default(3),
  defaultTaxPercent: z.coerce.number().min(0).max(100).default(0),
});
export type BookingDefaults = z.infer<typeof bookingDefaultsSchema>;

export const documentNumberingSchema = z.object({
  quotePrefix: trimmed(12).regex(/^[A-Z0-9-]*$/i, 'Letters, numbers and dashes only.').default('Q-'),
  invoicePrefix: trimmed(12).regex(/^[A-Z0-9-]*$/i, 'Letters, numbers and dashes only.').default('INV-'),
  receiptPrefix: trimmed(12).regex(/^[A-Z0-9-]*$/i, 'Letters, numbers and dashes only.').default('R-'),
});

export const formatsSchema = z.object({
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).default('MM/DD/YYYY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  weekStartsOn: z.enum(['sunday', 'monday']).default('sunday'),
  distanceUnit: z.enum(['mi', 'km']).default('mi'),
});

export const communicationSchema = z.object({
  senderName: optionalText(80),
  replyToEmail: z.union([z.literal(''), z.email('Enter a valid email address.')]).optional().transform((v) => v || undefined),
  internalAlertEmails: z.array(z.email()).max(10).default([]),
  emailFooter: optionalText(500),
});

/** Everything stored in tenants.settings. Parse with `.parse(row.settings ?? {})`. */
export const tenantPreferencesSchema = z.object({
  formats: formatsSchema.default(formatsSchema.parse({})),
  booking: bookingDefaultsSchema.default(bookingDefaultsSchema.parse({})),
  hours: businessHoursSchema.default(DEFAULT_HOURS),
  numbering: documentNumberingSchema.default(documentNumberingSchema.parse({})),
  communication: communicationSchema.default(communicationSchema.parse({})),
});
export type TenantPreferences = z.infer<typeof tenantPreferencesSchema>;

export function parsePreferences(raw: unknown): TenantPreferences {
  const parsed = tenantPreferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : tenantPreferencesSchema.parse({});
}

/**
 * A location: a place equipment ships from (a branch, warehouse or yard).
 * Its map pin drives travel-fee distance and its time zone.
 */
export const locationSchema = z.object({
  name: trimmed(120).min(2, 'Give the location a name.'),
  code: trimmed(8)
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'Use 2-8 letters or numbers, like AUS.'),
  /** Worked out from the map pin when left empty. */
  timezone: z
    .string()
    .optional()
    .refine((tz) => !tz || isValidTimezone(tz), 'Pick a time zone from the list.'),
  phone: phoneField('US'),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]).optional().transform((v) => v || undefined),
  address: addressSchema.refine((a) => !!a.line1 && !!a.city, 'Enter at least the street and city, or search for the address.'),
  loadingNotes: optionalText(1000),
  isPrimary: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type LocationInput = z.infer<typeof locationSchema>;

/** The whole onboarding wizard, submitted at the end in one request. Region is detected, not asked. */
export const onboardingSchema = z.object({
  slug: slugSchema,
  profile: businessProfileSchema,
  branding: brandingSchema,
  location: locationSchema,
  booking: bookingDefaultsSchema,
  /** The browser's time zone: only a last resort when there is no map pin. */
  deviceTimezone: z.string().optional(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const ROLES = ['owner', 'admin', 'manager', 'sales', 'crew', 'accountant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  owner: { label: 'Owner', description: 'Everything, including billing and deleting the organization.' },
  admin: { label: 'Admin', description: 'All settings, team and every location.' },
  manager: { label: 'Manager', description: 'Runs locations: orders, overrides, refunds.' },
  sales: { label: 'Sales', description: 'Quotes, bookings and customers.' },
  crew: { label: 'Crew', description: 'Assigned jobs and checklists in the crew app.' },
  accountant: { label: 'Accountant', description: 'Invoices, payments and reports.' },
  viewer: { label: 'Viewer', description: 'Read-only access.' },
};
export const SETTINGS_ROLES: readonly Role[] = ['owner', 'admin'];
