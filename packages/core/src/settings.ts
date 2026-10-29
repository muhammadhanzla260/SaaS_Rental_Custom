import { z } from 'zod';
import { CORNERS, HEX_RE, checkAccent } from './theme';
import { isValidTimezone } from './regional';
import { normalizePhone } from './phone';
import { DEFAULT_SETUP_SURFACES } from './pricing';

/**
 * Organization settings. Identity, contact, branding and core regional values
 * are real columns on `tenants`; everything else lives in `tenants.settings`
 * (jsonb) and is parsed through `tenantPreferencesSchema`, which fills defaults
 * so older rows keep working when new settings are added.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .transform((v) => (v ? v : undefined))
    .optional();
const optionalEmail = z.union([z.literal(''), z.email('Enter a valid email address.')]).optional().transform((v) => v || undefined);
const optionalUrl = z
  .union([z.literal(''), z.url('Enter a full web address, like https://example.com')])
  .optional()
  .transform((v) => v || undefined);

// --- workspace address (slug) ---------------------------------------------------

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const RESERVED_SLUGS = new Set([
  'api', 'app', 'admin', 'auth', 'invite', 'onboarding', 'sign-in', 'sign-up', 'register', 'settings', 'www',
  'help', 'support', 'status', 'billing', 'static', 'assets', 'files', 'l', 'crew', 'coach', 'public', 'docs',
  'console', 'platform', 'orgs', 'mail', 'blog', 'pricing', 'terms', 'privacy', 'quote', 'pay', 'q',
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

// --- addresses and phones ----------------------------------------------------------

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

// --- registration (01 · Register) ---------------------------------------------------

export const SIGNUP_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'CA', name: 'Canada' },
] as const;

export const PASSWORD_MIN = 8;

export const registerSchema = z.object({
  businessName: trimmed(120).min(2, 'Enter your business name.'),
  slug: slugSchema,
  ownerName: trimmed(120).min(2, 'Enter your name.'),
  country: z.enum(SIGNUP_COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  email: z.email('Enter a valid work email.'),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`).max(128),
  acceptTerms: z.literal(true, { error: 'Please agree to the Terms and Privacy Policy.' }),
  /** The browser's time zone: used until the first location's map pin sets it. */
  deviceTimezone: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Password strength for the meter under the field (design: 4 segments). */
export function passwordScore(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  return ((pw.length >= PASSWORD_MIN ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14 ? 1 : 0)) as 0 | 1 | 2 | 3 | 4;
}
export const PASSWORD_LABELS = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'] as const;

// --- business profile (onboarding 1 / Workspace · Business profile) ------------------

export const businessProfileSchema = z.object({
  name: trimmed(120).min(2, 'Enter your business name.'),
  legalName: optionalText(160),
  email: optionalEmail,
  phone: phoneField('US'),
  website: optionalUrl,
  taxId: optionalText(40),
  address: addressSchema,
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const CURRENCIES = [
  { code: 'USD', name: 'US dollar' },
  { code: 'GBP', name: 'British pound' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'CAD', name: 'Canadian dollar' },
] as const;

export const regionalSchema = z.object({
  country: z.string().length(2).toUpperCase(),
  timezone: z.string().refine(isValidTimezone, 'Pick a time zone from the list.'),
  currency: z.string().length(3).toUpperCase(),
  locale: z.string().min(2).max(20).default('en-US'),
});
export type Regional = z.infer<typeof regionalSchema>;

export const formatsSchema = z.object({
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).default('MM/DD/YYYY'),
  timeFormat: z.enum(['12h', '24h']).default('12h'),
  weekStartsOn: z.enum(['sunday', 'monday']).default('sunday'),
  distanceUnit: z.enum(['mi', 'km']).default('mi'),
});

/** Onboarding step 1 / Business profile tab: profile + region. Display name, phone, time zone and currency are required. */
export const profileStepSchema = z.object({
  profile: businessProfileSchema.extend({
    phone: phoneField('US').refine((v) => !!v, 'Enter the business phone.'),
  }),
  timezone: z.string().refine(isValidTimezone, 'Pick a time zone from the list.'),
  currency: z.enum(CURRENCIES.map((c) => c.code) as [string, ...string[]]),
  dateFormat: formatsSchema.shape.dateFormat,
  weekStartsOn: formatsSchema.shape.weekStartsOn,
});
export type ProfileStep = z.infer<typeof profileStepSchema>;

// --- brand (onboarding 2 / Workspace · Brand & theme) ------------------------------------

export const LOGO_VARIANTS = ['main', 'icon', 'onDark'] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];
export const LOGO_VARIANT_LABELS: Record<LogoVariant, string> = { main: 'Main logo', icon: 'Square icon', onDark: 'On dark / colour' };

export const logoAdjustSchema = z.object({
  zoom: z.coerce.number().min(50).max(200).default(100),
  x: z.coerce.number().min(-100).max(100).default(0),
  y: z.coerce.number().min(-100).max(100).default(0),
  padding: z.coerce.number().min(0).max(40).default(8),
  background: z.enum(['none', 'white', 'brand', 'dark']).default('none'),
  shape: z.enum(['square', 'rounded', 'circle']).default('rounded'),
  rotate: z.coerce.number().int().min(-180).max(180).default(0),
});
export type LogoAdjust = z.infer<typeof logoAdjustSchema>;
export const DEFAULT_LOGO_ADJUST: Record<LogoVariant, LogoAdjust> = {
  main: logoAdjustSchema.parse({}),
  icon: logoAdjustSchema.parse({ background: 'white', padding: 12 }),
  onDark: logoAdjustSchema.parse({ background: 'dark' }),
};

const accentHex = z
  .string()
  .regex(HEX_RE, 'Pick a colour in #RRGGBB format.')
  .transform((v) => v.toUpperCase())
  .refine((v) => checkAccent(v).level !== 'fail', 'Button text would be hard to read on this colour. Pick a stronger one.');

export const brandingSchema = z.object({
  brandColor: accentHex,
  themeMode: z.enum(['system', 'light', 'dark']).default('light'),
  radius: z.enum(Object.keys(CORNERS) as [keyof typeof CORNERS, ...(keyof typeof CORNERS)[]]).default('round'),
});
export type Branding = z.infer<typeof brandingSchema>;

export const brandSettingsSchema = z.object({
  sidebar: z.enum(['dark', 'light', 'brand']).default('dark'),
  headingFont: z.enum(['modern', 'classic', 'friendly']).default('modern'),
  emailHeader: z.enum(['band', 'white']).default('band'),
  customDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^$|^(?=.{4,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'Enter a domain like book.yourbusiness.com')
    .transform((v) => v || undefined)
    .optional(),
  customDomainVerified: z.boolean().default(false),
  reviewLink: optionalUrl,
  socialUrl: optionalUrl,
  invoiceFooter: optionalText(600),
  logo: z
    .object({ main: logoAdjustSchema, icon: logoAdjustSchema, onDark: logoAdjustSchema })
    .default(DEFAULT_LOGO_ADJUST),
});
export type BrandSettings = z.infer<typeof brandSettingsSchema>;

export const brandStepSchema = z.object({ branding: brandingSchema, brand: brandSettingsSchema });
export type BrandStep = z.infer<typeof brandStepSchema>;

// --- rental rules (Workspace · Rental rules; never in onboarding) --------------------------

export const bookingDefaultsSchema = z.object({
  depositPercent: z.coerce.number().min(0).max(100).default(30),
  balanceDue: z.enum(['event_day', 'days_before']).default('event_day'),
  balanceDueDaysBefore: z.coerce.number().int().min(0).max(90).default(0),
  autoChargeBalance: z.boolean().default(true),
  /** Null = quotes never expire. */
  quoteValidDays: z.coerce.number().int().min(1).max(365).nullable().default(14),
  /** Busy time after the return before the item can go out again. */
  cleanupBufferMinutes: z.coerce.number().int().min(0).max(1440).default(180),
  /** "Next day": the item is busy until the start of the next day. */
  cleanupNextDay: z.boolean().default(false),
  /** Overtime when a product has no hourly rate (Odoo: $25 per 15 minutes). New products start with this. */
  overtimeBlockMinutes: z.coerce.number().int().min(5).max(120).default(15),
  overtimeBlockCents: z.coerce.number().int().min(0).max(1_000_000).default(2500),
  /** Event location fee for parks and venues with permits (Odoo: $20). */
  eventLocationFeeCents: z.coerce.number().int().min(0).max(1_000_000).default(2000),
  minimumBookingCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
  lastMinuteHours: z.coerce.number().int().min(0).max(720).default(48),
  maxAdvanceMonths: z.coerce.number().int().min(1).max(60).default(18),
  quotesHoldInventory: z.boolean().default(false),
  damageWaiverPercent: z.coerce.number().min(0).max(100).default(10),
  damageWaiverDefaultOn: z.boolean().default(true),
  /** Org defaults; a location can override travel miles and rates. */
  freeTravelDistance: z.coerce.number().min(0).max(1000).default(10),
  serviceRadius: z.coerce.number().min(5).max(1000).default(80),
  setupSurfaces: z
    .array(z.object({ code: z.string(), label: z.string(), feeCents: z.number().int().min(0) }))
    .default(DEFAULT_SETUP_SURFACES.map((s) => ({ ...s }))),
  travelRateStaffed: z.coerce.number().min(0).max(1000).default(2.5),
  travelRateDropoff: z.coerce.number().min(0).max(1000).default(3),
  defaultTaxPercent: z.coerce.number().min(0).max(100).default(0),
});
export type BookingDefaults = z.infer<typeof bookingDefaultsSchema>;

// --- document numbers ------------------------------------------------------------------

/** Prefix templates: {LOC} = location code, {YYYY} = year. "Q-{LOC}-" → Q-AUS-01042. */
const prefixTemplate = trimmed(24).regex(/^(?:[A-Za-z0-9-]|\{LOC\}|\{YYYY\})*$/, 'Letters, numbers, dashes, {LOC} and {YYYY} only.');

export const documentNumberingSchema = z.object({
  quotePrefix: prefixTemplate.default('Q-{LOC}-'),
  quotePadding: z.coerce.number().int().min(3).max(8).default(5),
  invoicePrefix: prefixTemplate.default('INV-{YYYY}-'),
  invoicePadding: z.coerce.number().int().min(3).max(8).default(4),
  receiptPrefix: prefixTemplate.default('PAY-{LOC}-'),
  receiptPadding: z.coerce.number().int().min(3).max(8).default(5),
});
export type DocumentNumbering = z.infer<typeof documentNumberingSchema>;
export type DocumentKind = 'quote' | 'invoice' | 'receipt';

export function renderPrefix(template: string, vars: { loc?: string | null; year?: number }): string {
  return template
    .replace(/\{LOC\}/g, (vars.loc ?? '').toUpperCase())
    .replace(/\{YYYY\}/g, String(vars.year ?? new Date().getUTCFullYear()))
    .toUpperCase();
}

/** Sequence key: one counter per rendered prefix, so Q-AUS- and Q-DAL- count separately. */
export function sequenceScope(kind: DocumentKind, renderedPrefix: string): string {
  return `${kind}:${renderedPrefix}`;
}

/** Example number for settings screens ("Q-AUS-01042"). */
export function exampleNumber(n: DocumentNumbering, kind: DocumentKind, loc: string, value = 1042): string {
  return renderPrefix(n[`${kind}Prefix`], { loc }) + String(value).padStart(n[`${kind}Padding`], '0');
}

// --- formats, hours, communication --------------------------------------------------------

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const businessHoursSchema = z
  .array(z.object({ day: z.enum(WEEKDAYS), open: z.boolean(), opens: z.string().regex(TIME_RE), closes: z.string().regex(TIME_RE) }))
  .length(7)
  .refine((days) => days.every((d) => !d.open || d.opens < d.closes), 'Closing time must be after opening time.');

export const DEFAULT_HOURS: z.infer<typeof businessHoursSchema> = WEEKDAYS.map((day) => ({
  day,
  open: true,
  opens: '08:00',
  closes: day === 'sunday' ? '18:00' : '20:00',
}));

export const communicationSchema = z.object({
  senderName: optionalText(80),
  replyToEmail: optionalEmail,
  internalAlertEmails: z.array(z.email()).max(10).default([]),
  emailFooter: optionalText(500),
});

// --- onboarding progress ------------------------------------------------------------------

export const ONBOARDING_STEPS = [
  { key: 'profile', title: 'Business profile', sub: 'Name, phone, region' },
  { key: 'brand', title: 'Brand & theme', sub: 'Logo and colours' },
  { key: 'warehouse', title: 'Warehouse', sub: 'Ships from, travel fees' },
  { key: 'connect', title: 'Email & payments', sub: 'SMTP, SMS, gateway' },
  { key: 'team', title: 'Team', sub: 'Invite people' },
  { key: 'launch', title: 'Review & launch', sub: 'Plan and go' },
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]['key'];
const stepKeys = ONBOARDING_STEPS.map((s) => s.key) as [OnboardingStepKey, ...OnboardingStepKey[]];

export const onboardingProgressSchema = z.object({
  /** Steps saved at least once. */
  done: z.array(z.enum(stepKeys)).default([]),
  skipped: z.array(z.enum(stepKeys)).default([]),
  /** Resume point for "Save & finish later". */
  current: z.number().int().min(0).max(ONBOARDING_STEPS.length - 1).default(0),
});
export type OnboardingProgress = z.infer<typeof onboardingProgressSchema>;

/** 0-100 for the console's "Onboarding 80%" bar. */
export function onboardingPercent(p: OnboardingProgress, launched: boolean): number {
  if (launched) return 100;
  const n = new Set([...p.done, ...p.skipped]).size;
  return Math.round((n / ONBOARDING_STEPS.length) * 100);
}

/** Everything stored in tenants.settings. Parse with parsePreferences(row.settings). */
export const tenantPreferencesSchema = z.object({
  formats: formatsSchema.default(formatsSchema.parse({})),
  booking: bookingDefaultsSchema.default(bookingDefaultsSchema.parse({})),
  hours: businessHoursSchema.default(DEFAULT_HOURS),
  numbering: documentNumberingSchema.default(documentNumberingSchema.parse({})),
  communication: communicationSchema.default(communicationSchema.parse({})),
  brand: brandSettingsSchema.default(brandSettingsSchema.parse({})),
  onboarding: onboardingProgressSchema.default(onboardingProgressSchema.parse({})),
  /** Home setup items ticked by hand ("Click a circle to mark it done"). */
  setupDone: z.array(z.string()).default([]),
});
export type TenantPreferences = z.infer<typeof tenantPreferencesSchema>;

/** Parses each section on its own, so one bad value only resets its own section. */
export function parsePreferences(raw: unknown): TenantPreferences {
  const parsed = tenantPreferencesSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const shape = tenantPreferencesSchema.shape;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape) as (keyof typeof shape)[]) {
    const r = shape[key].safeParse(src[key]);
    out[key] = r.success ? r.data : shape[key].parse(undefined);
  }
  return out as TenantPreferences;
}

// --- locations ------------------------------------------------------------------------------

export const LOCATION_PILL_COLORS = ['#0B0D12', '#2C4FE0', '#0B7A55', '#A85A00', '#B0306A', '#6D3FD6', '#0E7490'] as const;

/** Per-location settings stored in locations.settings (jsonb). Null travel values fall back to the org default. */
export const locationSettingsSchema = z.object({
  freeTravelMiles: z.coerce.number().min(0).max(1000).nullable().default(null),
  travelRateStaffed: z.coerce.number().min(0).max(1000).nullable().default(null),
  travelRateDropoff: z.coerce.number().min(0).max(1000).nullable().default(null),
  servedZips: z.array(z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/)).max(1000).default([]),
  pillColor: z.string().regex(HEX_RE).default('#0B0D12'),
  paused: z.boolean().default(false),
  /** Use the org mail server (false) or this location's own (true). */
  ownMailServer: z.boolean().default(false),
});
export type LocationSettings = z.infer<typeof locationSettingsSchema>;

export function parseLocationSettings(raw: unknown): LocationSettings {
  const r = locationSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : locationSettingsSchema.parse({});
}

/**
 * A location: a branch that rental equipment ships from (location = warehouse).
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
  email: optionalEmail,
  address: addressSchema.refine((a) => !!a.line1 && !!a.city, 'Enter at least the street and city, or search for the address.'),
  loadingNotes: optionalText(1000),
  isPrimary: z.boolean().default(false),
  isActive: z.boolean().default(true),
  settings: locationSettingsSchema.default(locationSettingsSchema.parse({})),
});
export type LocationInput = z.input<typeof locationSchema>;
export type LocationValues = z.infer<typeof locationSchema>;

/** Onboarding step 3: the first warehouse plus org travel defaults. */
export const warehouseStepSchema = z.object({
  location: locationSchema,
  travel: z.object({
    freeTravelDistance: bookingDefaultsSchema.shape.freeTravelDistance,
    travelRateStaffed: bookingDefaultsSchema.shape.travelRateStaffed,
    travelRateDropoff: bookingDefaultsSchema.shape.travelRateDropoff,
  }),
});
export type WarehouseStep = z.infer<typeof warehouseStepSchema>;

/** ZIPs typed as "78701, 78702 78703" → ['78701','78702','78703']. */
export function parseZipList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((z) => z.trim().toUpperCase()).filter((z) => /^[A-Z0-9-]{3,10}$/.test(z)))];
}

// --- integrations (onboarding 4 / Workspace · Email & payments / Location tabs) ------------

export const MAIL_PRESETS = [
  { key: 'google', label: 'Google Workspace', host: 'smtp.gmail.com', port: 587, security: 'starttls' },
  { key: 'microsoft', label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, security: 'starttls' },
  { key: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, security: 'ssl' },
  { key: 'other', label: 'Other SMTP', host: '', port: 587, security: 'starttls' },
] as const;

export const mailAccountSchema = z
  .object({
    mode: z.enum(['platform', 'smtp']).default('platform'),
    provider: z.enum(['google', 'microsoft', 'zoho', 'other']).default('other'),
    host: optionalText(253),
    port: z.coerce.number().int().min(1).max(65535).default(587),
    security: z.enum(['starttls', 'ssl', 'none']).default('starttls'),
    username: optionalText(254),
    /** Write-only: empty keeps the saved password. */
    password: z.string().max(512).optional(),
    fromName: optionalText(80),
    fromEmail: optionalEmail,
    replyTo: optionalEmail,
  })
  .superRefine((v, ctx) => {
    if (v.mode !== 'smtp') return;
    if (!v.host) ctx.addIssue({ code: 'custom', path: ['host'], message: 'Enter the mail server host.' });
    if (!v.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Enter the username.' });
    if (!v.fromEmail) ctx.addIssue({ code: 'custom', path: ['fromEmail'], message: 'Enter the address emails come from.' });
  });
export type MailAccountInput = z.infer<typeof mailAccountSchema>;

export const smsAccountSchema = z.object({
  provider: z.enum(['none', 'twilio', 'quo']).default('none'),
  sendingNumber: optionalText(32),
  accountId: optionalText(120),
  /** Write-only. */
  apiKey: z.string().max(512).optional(),
});
export type SmsAccountInput = z.infer<typeof smsAccountSchema>;

export const PAYMENT_PROVIDERS = [
  { key: 'stripe', label: 'Stripe', sub: 'Cards and wallets. Connect in 2 minutes.' },
  { key: 'ipos', label: 'iPOS Pay', sub: 'Card payments with saved tokens.' },
  { key: 'manual', label: 'Manual only', sub: 'Cash, check, Zelle, ACH recorded by staff.' },
] as const;

export const paymentAccountSchema = z.object({
  provider: z.enum(['manual', 'stripe', 'ipos']).default('manual'),
  /** iPOS Pay terminal id (TPN). */
  merchantId: optionalText(64),
  publishableKey: z
    .string()
    .trim()
    .regex(/^$|^pk_(test|live)_[A-Za-z0-9]+$/, 'A Stripe publishable key starts with pk_test_ or pk_live_.')
    .optional(),
  /** Write-only. */
  secretKey: z
    .string()
    .trim()
    .max(512)
    .optional(),
}).superRefine((v, ctx) => {
  if (v.provider === 'stripe' && v.secretKey && !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(v.secretKey)) {
    ctx.addIssue({ code: 'custom', path: ['secretKey'], message: 'A Stripe secret key starts with sk_test_ or sk_live_.' });
  }
});
export type PaymentAccountInput = z.infer<typeof paymentAccountSchema>;

export const connectStepSchema = z.object({
  mail: mailAccountSchema,
  sms: smsAccountSchema,
  payments: paymentAccountSchema,
});
export type ConnectStep = z.infer<typeof connectStepSchema>;
