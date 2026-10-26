/**
 * Customer messaging: message types, automation rules, template fields and
 * rendering, HTML checks and SMS segments. Pure functions, shared by the web
 * app (previews, instant sends) and the worker (scheduled sends).
 *
 * Timings follow the FreedomFun Odoo build (rental_email_log crons): pre-event
 * 3 days before start, day-before 1 day before, review 1 day after the end,
 * thank-you 2 days after, survey 7 days after, balance charged on event day.
 */
import { z } from 'zod';
import { BLOCK_KEYS, emailBlocks, sampleEmailData } from './email-blocks';
import { defaultEmailHtml } from './email-templates';
import { addDays, utcToWallTime, wallTimeToUtc } from './time';

// --- message types -------------------------------------------------------------------------

export type Channel = 'email' | 'sms';
export type MessageGroup = 'instant' | 'scheduled' | 'internal';

export const MESSAGE_TYPES = {
  quote: { label: 'Quote', group: 'instant', channels: ['email'], when: 'Sent when staff press Send quote. Includes the review, sign & pay link.' },
  invoice: { label: 'Invoice', group: 'instant', channels: ['email'], when: 'When staff press Email invoice: what is due, with a pay link.' },
  payment_partial: { label: 'Payment confirmation (partial)', group: 'instant', channels: ['email'], when: 'After a payment that leaves a balance. Also confirms the booking.' },
  payment_paid: { label: 'Payment confirmation (paid)', group: 'instant', channels: ['email'], when: 'After the payment that pays the order in full.' },
  booking_confirmation: { label: 'Booking confirmation', group: 'instant', channels: ['email'], when: 'When an order is booked without a payment (a paid booking gets the payment confirmation instead).' },
  cancellation: { label: 'Cancellation', group: 'instant', channels: ['email'], when: 'When an order is cancelled, with refund or credit details.' },
  card_declined: { label: 'Card declined', group: 'instant', channels: ['email', 'sms'], when: 'To the customer when a charge fails, with a pay-now link.' },
  pre_event: { label: 'Pre-event reminder', group: 'scheduled', channels: ['email'], when: 'Before the event: what to expect and how to prepare.' },
  quality_check: { label: 'Quality check text', group: 'scheduled', channels: ['sms'], when: 'To the on-site contact, confirming time and setup spot.' },
  day_before: { label: 'Day-before reminder', group: 'scheduled', channels: ['email'], when: 'The day before: arrival window and checklist.' },
  charge_balance: { label: 'Charge balance', group: 'scheduled', channels: ['email'], when: 'Charges the saved card for what is left, then sends the receipt.' },
  review_request: { label: 'Review request', group: 'scheduled', channels: ['email'], when: 'After the event: asks for a review.' },
  thank_you: { label: 'Thank you + survey', group: 'scheduled', channels: ['email'], when: 'After the event: thanks and a short survey.' },
  survey_reminder: { label: 'Survey reminder', group: 'scheduled', channels: ['email'], when: 'Only if the survey was not done.' },
  declined_alert: { label: 'Card declined (office)', group: 'internal', channels: ['email'], when: 'Tells the office a charge failed.' },
  last_minute: { label: 'Last-minute booking', group: 'internal', channels: ['email'], when: 'A booking made shortly before its event.' },
  change_request: { label: 'Customer asked for changes', group: 'internal', channels: ['email'], when: 'From the quote page’s Request changes.' },
  daily_digest: { label: 'Tomorrow’s events', group: 'internal', channels: ['email'], when: 'Every evening: the events for tomorrow.' },
} as const satisfies Record<string, { label: string; group: MessageGroup; channels: readonly Channel[]; when: string }>;
export type MessageType = keyof typeof MESSAGE_TYPES;
export const MESSAGE_TYPE_KEYS = Object.keys(MESSAGE_TYPES) as MessageType[];
export const SCHEDULED_TYPES = MESSAGE_TYPE_KEYS.filter((k) => MESSAGE_TYPES[k].group === 'scheduled');
export const INSTANT_TYPES = MESSAGE_TYPE_KEYS.filter((k) => MESSAGE_TYPES[k].group === 'instant');

// --- automation settings (tenants.settings.messaging) ----------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.');

export const scheduleRuleSchema = z.object({
  enabled: z.boolean(),
  /** 'charge' charges the saved card (charge_balance only). */
  channels: z.array(z.enum(['email', 'sms', 'charge'])).max(3),
  days: z.coerce.number().int().min(0).max(60),
  direction: z.enum(['before', 'after']),
  anchor: z.enum(['start', 'end']),
  time: hhmm,
});
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

export type ScheduledType = 'pre_event' | 'quality_check' | 'day_before' | 'charge_balance' | 'review_request' | 'thank_you' | 'survey_reminder';
export const DEFAULT_SCHEDULES: Record<ScheduledType, ScheduleRule> = {
  pre_event: { enabled: true, channels: ['email'], days: 3, direction: 'before', anchor: 'start', time: '09:00' },
  quality_check: { enabled: true, channels: ['sms'], days: 2, direction: 'before', anchor: 'start', time: '10:00' },
  day_before: { enabled: true, channels: ['email'], days: 1, direction: 'before', anchor: 'start', time: '09:00' },
  charge_balance: { enabled: true, channels: ['charge', 'email'], days: 0, direction: 'before', anchor: 'start', time: '08:00' },
  review_request: { enabled: true, channels: ['email'], days: 1, direction: 'after', anchor: 'end', time: '10:00' },
  thank_you: { enabled: true, channels: ['email'], days: 2, direction: 'after', anchor: 'end', time: '10:00' },
  survey_reminder: { enabled: false, channels: ['email'], days: 7, direction: 'after', anchor: 'end', time: '10:00' },
};

const emailList = z.array(z.email('Enter a valid email address.')).max(10);

export const messagingSettingsSchema = z.object({
  /** Instant messages that are switched on. */
  instant: z.record(z.string(), z.boolean()).default({}),
  schedules: z.record(z.string(), scheduleRuleSchema).default({}),
  internal: z.record(z.string(), z.boolean()).default({}),
  replyTo: z.union([z.literal(''), z.email()]).default(''),
  cc: emailList.default([]),
  bcc: emailList.default([]),
  /** Declined cards, last-minute bookings, change requests and the daily digest go here. */
  alertsTo: emailList.default([]),
  quietFrom: hhmm.default('21:00'),
  quietTo: hhmm.default('08:00'),
  retries: z.coerce.number().int().min(0).max(10).default(3),
  /** Reminders are skipped for orders booked this close to the event. */
  skipRemindersWithinHours: z.coerce.number().int().min(0).max(240).default(48),
  lastMinuteHours: z.coerce.number().int().min(1).max(240).default(24),
  digestTime: hhmm.default('18:00'),
  /** Off until someone switches automations on (a new workspace never mails customers by surprise). */
  live: z.boolean().default(false),
});
export type MessagingSettings = z.infer<typeof messagingSettingsSchema>;

/** Settings with every type filled in (defaults for anything not saved yet). */
export function resolveMessaging(m: MessagingSettings) {
  const instant = Object.fromEntries(INSTANT_TYPES.map((k) => [k, m.instant[k] ?? true])) as Record<string, boolean>;
  const schedules = Object.fromEntries(
    SCHEDULED_TYPES.map((k) => [k, m.schedules[k] ?? DEFAULT_SCHEDULES[k as ScheduledType]]),
  ) as Record<string, ScheduleRule>;
  const internal = Object.fromEntries(
    MESSAGE_TYPE_KEYS.filter((k) => MESSAGE_TYPES[k].group === 'internal').map((k) => [k, m.internal[k] ?? true]),
  ) as Record<string, boolean>;
  return { ...m, instant, schedules, internal };
}
export type ResolvedMessaging = ReturnType<typeof resolveMessaging>;

// --- scheduling -------------------------------------------------------------------------------

/** When a scheduled message is due: anchor's local date ± days, at the rule's local time. */
export function scheduledAt(rule: ScheduleRule, event: { startsAt: Date; endsAt: Date }, timeZone: string): Date {
  const anchor = rule.anchor === 'start' ? event.startsAt : event.endsAt;
  const local = utcToWallTime(anchor, timeZone).date;
  const date = addDays(local, rule.direction === 'before' ? -rule.days : rule.days);
  return wallTimeToUtc(date, rule.time, timeZone);
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Texts are never sent in quiet hours: a time inside them moves to the end of the quiet window. */
export function outsideQuietHours(at: Date, timeZone: string, from: string, to: string): Date {
  const { date, time } = utcToWallTime(at, timeZone);
  const t = minutes(time);
  const f = minutes(from);
  const e = minutes(to);
  const wraps = f > e; // e.g. 21:00 -> 08:00
  const inside = wraps ? t >= f || t < e : t >= f && t < e;
  if (!inside) return at;
  const day = wraps && t >= f ? addDays(date, 1) : date;
  return wallTimeToUtc(day, to, timeZone);
}

/** Short human line for a rule: "3 days before start · 09:00". */
export function describeRule(r: ScheduleRule) {
  const when = r.days === 0 ? (r.anchor === 'start' ? 'Event day' : 'Day it ends') : `${r.days} day${r.days === 1 ? '' : 's'} ${r.direction} ${r.anchor === 'start' ? 'start' : 'end'}`;
  return `${when} · ${r.time}`;
}

// --- template fields ---------------------------------------------------------------------------

export const TEMPLATE_FIELDS = [
  { key: 'customer.first_name', label: 'Customer first name', sample: 'Maria' },
  { key: 'customer.name', label: 'Customer name', sample: 'Maria Gonzalez' },
  { key: 'order.number', label: 'Order number', sample: 'Q-AUS-01043' },
  { key: 'order.total', label: 'Order total', sample: '$618.11' },
  { key: 'order.balance', label: 'Balance due', sample: '$432.68' },
  { key: 'event.type', label: 'Event type', sample: 'birthday party' },
  { key: 'event.date', label: 'Event date', sample: 'Saturday, Nov 7' },
  { key: 'event.time', label: 'Event time', sample: '1:00 – 6:00 PM' },
  { key: 'event.address', label: 'Event address', sample: '1890 Ranch Shopping Center, Cedar Park' },
  { key: 'event.items', label: 'Items', sample: 'Castle Bounce House, Popcorn Machine' },
  { key: 'deposit.amount', label: 'Deposit amount', sample: '$185.43' },
  { key: 'deposit.percent', label: 'Deposit percent', sample: '30%' },
  { key: 'payment.amount', label: 'Payment amount', sample: '$185.43' },
  { key: 'payment.number', label: 'Receipt number', sample: 'PAY-AUS-00412' },
  { key: 'card.last4', label: 'Card last 4', sample: '4242' },
  { key: 'invoice.number', label: 'Invoice number', sample: 'INV-2026-0205' },
  { key: 'invoice.amount', label: 'Invoice amount', sample: '$432.68' },
  { key: 'org.name', label: 'Business name', sample: 'Freedom Fun USA' },
  { key: 'org.phone', label: 'Business phone', sample: '(512) 981-5557' },
  { key: 'location.name', label: 'Location', sample: 'Austin' },
  { key: 'pay_link', label: 'Sign & pay link', sample: 'https://…/q/…' },
  { key: 'review_link', label: 'Review link', sample: 'https://g.page/r/…' },
  { key: 'reason', label: 'Reason', sample: 'Card declined' },
  { key: 'cancel.outcome', label: 'What happens to the money (cancellation)', sample: 'Rain check RC-0019 for $185.43, valid until November 7, 2027. Use it on a new date.' },
  { key: 'order.paid', label: 'Paid so far', sample: '$109.20' },
  { key: 'order.prepared_suffix', label: '" | Prepared by …" (empty if no salesperson)', sample: ' | Prepared by Sam Ortiz' },
  { key: 'event.days_to_go', label: 'Days to go ("3 days")', sample: '3 days' },
  { key: 'payment.status', label: 'Partial or paid in full', sample: 'Partial payment' },
  { key: 'payment.detail', label: 'How it was paid', sample: 'Card ending in 4242 · Oct 2, 2026' },
  { key: 'org.location_name', label: 'Business - location', sample: 'Freedom Fun USA - Austin' },
  { key: 'org.email', label: 'Business email', sample: 'care@freedomfunusa.com' },
  { key: 'org.address', label: 'Business address', sample: '15122 Honeycomb Drive, Leander, TX 78641' },
  { key: 'org.website', label: 'Website', sample: 'www.freedomfunusa.com' },
  { key: 'org.website_url', label: 'Website link', sample: 'https://www.freedomfunusa.com' },
  { key: 'brand.color', label: 'Brand colour', sample: '#056690' },
  { key: 'brand.on_color', label: 'Text on brand colour', sample: '#ffffff' },
  { key: 'contract_link', label: 'Contract (PDF) link', sample: 'https://…/q/…/print?doc=agreement' },
  { key: 'quote_pdf_link', label: 'Quote (PDF) link', sample: 'https://…/q/…/print?doc=quote' },
] as const;
export type TemplateFieldKey = (typeof TEMPLATE_FIELDS)[number]['key'];
export type FieldValues = Partial<Record<string, string>>;
export const SAMPLE_FIELDS: FieldValues = Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f.key, f.sample]));
const KNOWN = new Set<string>([...TEMPLATE_FIELDS.map((f) => f.key), ...BLOCK_KEYS]);

// {field} or {{field}}; unknown fields are left exactly as typed.
const FIELD_RE = /\{\{?\s*([a-z_]+(?:\.[a-z_0-9]+)?)\s*\}?\}/g;

export function fieldsIn(text: string) {
  const found = new Set<string>();
  for (const m of text.matchAll(FIELD_RE)) found.add(m[1]!);
  return { known: [...found].filter((f) => KNOWN.has(f)), unknown: [...found].filter((f) => !KNOWN.has(f)) };
}

export function fillFields(text: string, values: FieldValues, escape: (s: string) => string = (s) => s) {
  // Blocks are HTML we generate (already escaped inside), so they go in as is.
  return text.replace(FIELD_RE, (whole, key: string) => (KNOWN.has(key) && values[key] != null ? (BLOCK_KEYS.has(key) ? values[key]! : escape(values[key]!)) : whole));
}

/** Preview values: the sample fields plus every block rendered from the sample order in this brand. */
export function sampleFields(brand: { color: string; onColor: string }, orgName: string, logoUrl: string | null = null, type?: MessageType): FieldValues {
  const stage = type === 'quote' ? 'quote' : type === 'booking_confirmation' ? 'unpaid' : type === 'payment_paid' || type === 'charge_balance' ? 'paid' : 'deposit';
  return { ...SAMPLE_FIELDS, 'brand.color': brand.color, 'brand.on_color': brand.onColor, 'org.name': orgName, ...emailBlocks(sampleEmailData(brand, orgName, stage), logoUrl) };
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// --- templates -----------------------------------------------------------------------------------

export const templateSchema = z.object({
  subject: z.string().trim().max(200).default(''),
  body: z.string().max(20000).default(''),
  buttonText: z.string().trim().max(60).default(''),
  mode: z.enum(['builder', 'raw']).default('builder'),
  rawSource: z.string().max(400_000).default(''),
  rawKind: z.enum(['html', 'xml']).default('html'),
  attachDocument: z.boolean().default(false),
  attachAgreement: z.boolean().default(false),
  tracking: z.boolean().default(false),
  autoPlainText: z.boolean().default(true),
});
export type TemplateInput = z.infer<typeof templateSchema>;

type Default = { subject: string; body: string; buttonText: string; button: 'pay_link' | 'review_link' | null; attachDocument?: boolean; attachAgreement?: boolean };
const sms = (body: string): Default => ({ subject: '', body, buttonText: '', button: null });

/** Starting copy for every message (FreedomFun tone). Edited per workspace in the template editor. */
export const DEFAULT_TEMPLATES: Record<MessageType, Partial<Record<Channel, Default>>> = {
  quote: { email: { subject: 'Your quote {order.number} is ready, {customer.first_name}', button: 'pay_link', buttonText: 'Review, sign & pay', attachDocument: true,
    body: 'Hi {customer.first_name},\n\nThanks for thinking of us for your {event.type} on {event.date}. Your quote is ready.\n\nReview it, accept our policies, sign and pay the {deposit.percent} deposit to lock in your date. Until then, items are not reserved.' } },
  invoice: { email: { subject: 'Invoice {invoice.number} from {org.name}', button: 'pay_link', buttonText: 'Pay {invoice.amount}', attachDocument: true,
    body: 'Hi {customer.first_name},\n\nHere is invoice {invoice.number} for order {order.number} ({event.date}). The amount due is {invoice.amount}.' } },
  payment_partial: { email: { subject: 'Payment Confirmation (Partial) - Order #{order.number}', button: 'pay_link', buttonText: 'Pay remaining balance',
    body: 'Hi {customer.first_name},\n\nThank you! We received {payment.amount} for order {order.number}. Receipt number {payment.number}.\n\nRemaining balance: {order.balance}.' } },
  payment_paid: { email: { subject: 'Payment Confirmation (Paid in Full) - Order #{order.number}', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nThank you! We received {payment.amount} for order {order.number}. Receipt number {payment.number}. You are paid in full.' } },
  booking_confirmation: { email: { subject: 'You’re booked! {order.number} on {event.date}', button: null, buttonText: '', attachAgreement: true,
    body: 'Hi {customer.first_name},\n\nYour {event.type} on {event.date} ({event.time}) is booked and your equipment is reserved.\n\nWe’ll set up at {event.address}. The balance of {order.balance} is charged on the event day. Your signed rental agreement is attached.' } },
  cancellation: { email: { subject: 'Order {order.number} is cancelled', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nYour order {order.number} for {event.date} has been cancelled ({reason}).\n\n{cancel.outcome}\n\nIf this is a surprise, reply to this email and we’ll sort it out.' } },
  card_declined: {
    email: { subject: 'Payment for {order.number} didn’t go through', button: 'pay_link', buttonText: 'Pay now',
      body: 'Hi {customer.first_name},\n\nWe tried to charge {invoice.amount} for your event on {event.date}, but the card was declined. Please pay with the link below so we can keep your booking.' },
    sms: sms('{org.name}: the payment for your {event.date} event was declined. Pay here: {pay_link}'),
  },
  pre_event: { email: { subject: '3 days to go — {order.number}', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nYour {event.type} is coming up on {event.date} ({event.time}). Please make sure the setup area is clear and there is a power outlet within 50 ft.\n\nQuestions? Just reply.' } },
  quality_check: { sms: sms('Hi! {org.name} here. Confirming {event.date} {event.time} at {event.address}. Reply YES to confirm or call {org.phone}.') },
  day_before: { email: { subject: 'Your event is tomorrow! — {order.number}', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nWe’re all set for tomorrow, {event.date}. Our crew will arrive before {event.time} to set up {event.items}.' } },
  charge_balance: { email: { subject: 'Receipt {payment.number} · balance paid', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nToday is the day! We charged the balance of {payment.amount} to your card ending {card.last4}. Receipt {payment.number}.' } },
  review_request: { email: { subject: 'Thank you from {org.name} — we’d love your feedback!', button: 'review_link', buttonText: 'Leave a review',
    body: 'Hi {customer.first_name},\n\nThanks for celebrating with us! If you had a great time, a quick review means the world to a small business.' } },
  thank_you: { email: { subject: 'Thank you from {org.name}!', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nThank you for choosing us for your {event.type}. We hope everyone had a blast.' } },
  survey_reminder: { email: { subject: 'How did we do? — {customer.first_name}', button: null, buttonText: '',
    body: 'Hi {customer.first_name},\n\nWe’d love to hear how your event went. It only takes a minute.' } },
  declined_alert: { email: { subject: 'Card declined: {order.number} · {customer.name}', button: null, buttonText: '',
    body: 'A charge of {invoice.amount} for {order.number} ({event.date}) was declined: {reason}. The customer was sent a pay link.' } },
  last_minute: { email: { subject: 'Last-minute booking: {order.number} on {event.date}', button: null, buttonText: '',
    body: '{customer.name} booked {event.items} for {event.date} {event.time} at {event.address}.' } },
  change_request: { email: { subject: '{customer.name} asked for changes to {order.number}', button: null, buttonText: '',
    body: '{customer.name} asked for changes to quote {order.number} ({event.date}):\n\n{reason}' } },
  daily_digest: { email: { subject: 'Tomorrow’s events', button: null, buttonText: '', body: '{reason}' } },
};

export function defaultTemplate(type: MessageType, channel: Channel): TemplateInput & { button: Default['button'] } {
  const d = DEFAULT_TEMPLATES[type][channel] ?? DEFAULT_TEMPLATES[type].email ?? sms('');
  const base = { ...templateSchema.parse({}), subject: d.subject, body: d.body, buttonText: d.buttonText, attachDocument: !!d.attachDocument, attachAgreement: !!d.attachAgreement, button: d.button };
  // The order emails ship as HTML in the Odoo layout (staff edit the HTML); the rest use the builder.
  const html = channel === 'email' ? defaultEmailHtml(type) : null;
  return html ? { ...base, subject: html.subject, mode: 'raw', rawSource: html.html, rawKind: 'html' } : base;
}

// --- HTML checks ------------------------------------------------------------------------------------

export type HtmlCheck = { key: string; level: 'pass' | 'warn' | 'fail'; text: string };

/** Email apps block scripts and handlers: remove them (and other active content) before sending. */
export function sanitizeEmailHtml(html: string) {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<(iframe|object|embed|frame|frameset|applet)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

/** Checks shown under an uploaded template (design 21): parse, fields, scripts, size. */
export function checkTemplateSource(source: string, kind: 'html' | 'xml'): HtmlCheck[] {
  const checks: HtmlCheck[] = [];
  const trimmed = source.trim();
  if (!trimmed) return [{ key: 'empty', level: 'fail', text: 'Nothing uploaded yet.' }];
  if (kind === 'xml') {
    const opens = (trimmed.match(/<([a-zA-Z][\w:-]*)(\s[^>]*)?(?<!\/)>/g) ?? []).length;
    const closes = (trimmed.match(/<\/[a-zA-Z][\w:-]*\s*>/g) ?? []).length;
    checks.push(opens === closes ? { key: 'parse', level: 'pass', text: 'XML is well-formed' } : { key: 'parse', level: 'fail', text: `XML is not well-formed (${opens} opening and ${closes} closing tags)` });
  } else {
    const ok = /<(html|body|table|div|p)\b/i.test(trimmed);
    checks.push(ok ? { key: 'parse', level: 'pass', text: 'HTML parsed' } : { key: 'parse', level: 'warn', text: 'No HTML structure found (sent as plain markup)' });
  }
  const f = fieldsIn(trimmed);
  checks.push({ key: 'fields', level: 'pass', text: `${f.known.length} field${f.known.length === 1 ? '' : 's'} found${f.known.length ? `: ${f.known.join(', ')}` : ''}` });
  if (f.unknown.length) checks.push({ key: 'unknown', level: 'warn', text: `Unknown fields left as typed: ${f.unknown.join(', ')}` });
  const scripts = (trimmed.match(/<script\b/gi) ?? []).length + (trimmed.match(/\son[a-z]+\s*=/gi) ?? []).length;
  checks.push(scripts ? { key: 'scripts', level: 'warn', text: `${scripts} script${scripts === 1 ? '' : 's'} found. Email apps block scripts, so they are stripped before sending.` } : { key: 'scripts', level: 'pass', text: 'No scripts' });
  const kb = new TextEncoder().encode(trimmed).length / 1024;
  checks.push(kb > 100 ? { key: 'size', level: 'warn', text: `${kb.toFixed(0)} KB — Gmail clips emails over 100 KB` } : { key: 'size', level: 'pass', text: `${kb.toFixed(1)} KB (under 100 KB)` });
  return checks;
}

export function htmlToText(html: string) {
  return html
    .replace(/<(style|head|script)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- SMS ------------------------------------------------------------------------------------------------

const GSM = /^[@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[~\]|€]*$/;

/** Segments a text uses: GSM-7 160/153 per part, otherwise UCS-2 70/67. */
export function smsSegments(text: string) {
  const gsm = GSM.test(text);
  const len = gsm ? [...text].reduce((n, ch) => n + ('^{}\\[~]|€'.includes(ch) ? 2 : 1), 0) : [...text].length;
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return { length: len, encoding: gsm ? 'GSM-7' : 'Unicode', segments: len === 0 ? 0 : len <= single ? 1 : Math.ceil(len / multi) };
}

// --- branded layout ----------------------------------------------------------------------------------

export type EmailBrand = {
  orgName: string; locationName?: string | null; brandColor: string; onBrand: string; logoUrl?: string | null; phone?: string | null;
  address?: string | null; footer?: string | null; header?: 'band' | 'white';
};
export type EmailSummary = { label: string; value: string }[];

/**
 * The builder layout (design 21): logo header, message, order summary, one
 * button, footer. Table-based and inline-styled so it survives Gmail and Outlook.
 */
export function builderEmail(opts: { brand: EmailBrand; body: string; summary?: EmailSummary; button?: { text: string; url: string } | null; preheader?: string }) {
  const b = opts.brand;
  const band = b.header !== 'white';
  const paras = opts.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#353C48">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const logo = b.logoUrl
    ? `<img src="${escapeHtml(b.logoUrl)}" alt="" width="36" height="36" style="display:block;border-radius:8px;background:#fff;object-fit:contain">`
    : `<div style="width:36px;height:36px;border-radius:8px;background:${band ? 'rgba(255,255,255,.18)' : b.brandColor};color:${band ? b.onBrand : b.onBrand};font:700 14px/36px Arial,sans-serif;text-align:center">${escapeHtml(b.orgName.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</div>`;
  const summary = opts.summary?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid #E2E5EA;border-radius:12px">${opts.summary
        .map((r, i) => `<tr><td style="padding:10px 16px;font-size:14px;color:#535C6B;${i ? 'border-top:1px solid #EEF0F3;' : ''}">${escapeHtml(r.label)}</td><td align="right" style="padding:10px 16px;font:600 14px Menlo,Consolas,monospace;color:#10131A;${i ? 'border-top:1px solid #EEF0F3;' : ''}">${escapeHtml(r.value)}</td></tr>`)
        .join('')}</table>`
    : '';
  const button = opts.button?.url
    ? `<p style="margin:8px 0 22px"><a href="${escapeHtml(opts.button.url)}" style="display:inline-block;background:${b.brandColor};color:${b.onBrand};text-decoration:none;font-weight:600;font-size:16px;padding:13px 22px;border-radius:10px">${escapeHtml(opts.button.text)}</a></p>`
    : '';
  const footer = [b.orgName, b.locationName, b.phone].filter(Boolean).map((s) => escapeHtml(s!)).join(' · ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#F3F4F6;font-family:Geist,'Segoe UI',Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(opts.preheader ?? '')}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E2E5EA">
<tr><td style="padding:18px 24px;${band ? `background:${b.brandColor};` : 'border-bottom:1px solid #EEF0F3;'}"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td>${logo}</td><td style="padding-left:12px;font:700 19px Arial,sans-serif;color:${band ? b.onBrand : '#10131A'}">${escapeHtml(b.orgName)}${b.locationName ? ` · ${escapeHtml(b.locationName)}` : ''}</td></tr></table></td></tr>
<tr><td style="padding:26px 24px 8px">${paras}${summary}${button}</td></tr>
<tr><td style="padding:16px 24px;background:#F7F8FA;font-size:13px;line-height:1.5;color:#535C6B">${footer}${b.address ? `<br>${escapeHtml(b.address)}` : ''}<br>Reply to this email to reach the office.${b.footer ? `<br><br>${escapeHtml(b.footer)}` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return html;
}

/** Footer appended to uploaded templates ("we only add the legally required ... footer"). */
export function legalFooterHtml(b: EmailBrand) {
  return `<div style="padding:16px;font:12px Arial,sans-serif;color:#7D8594;text-align:center">${escapeHtml([b.orgName, b.address].filter(Boolean).join(' · '))}<br>You receive this because you booked with ${escapeHtml(b.orgName)}. Reply to this email with questions.</div>`;
}

export type RenderedMessage = { subject: string; html: string | null; text: string };

/** Render one message from its template (builder or uploaded), with fields filled. */
export function renderMessage(opts: {
  channel: Channel; template: TemplateInput & { button?: Default['button'] }; values: FieldValues; brand: EmailBrand; summary?: EmailSummary;
  links: { pay_link?: string | null; review_link?: string | null };
}): RenderedMessage {
  const v = { ...opts.values, pay_link: opts.links.pay_link ?? opts.values.pay_link, review_link: opts.links.review_link ?? opts.values.review_link };
  if (opts.channel === 'sms') return { subject: '', html: null, text: fillFields(opts.template.body, v) };
  const subject = fillFields(opts.template.subject, v);
  if (opts.template.mode === 'raw') {
    const filled = fillFields(opts.template.rawSource, v, escapeHtml);
    const clean = sanitizeEmailHtml(filled);
    // Our own layouts carry the footer already (data-legal-footer); anything else gets ours.
    const html = /data-legal-footer/.test(clean) ? clean
      : /<\/body>/i.test(clean) ? clean.replace(/<\/body>/i, `${legalFooterHtml(opts.brand)}</body>`) : `${clean}${legalFooterHtml(opts.brand)}`;
    return { subject, html, text: htmlToText(html) };
  }
  const body = fillFields(opts.template.body, v);
  const target = opts.template.button === 'review_link' ? v.review_link : opts.template.button === 'pay_link' ? v.pay_link : null;
  const button = opts.template.buttonText && target ? { text: fillFields(opts.template.buttonText, v), url: target } : null;
  const html = builderEmail({ brand: opts.brand, body, summary: opts.summary, button, preheader: body.split('\n').find((l) => l.trim() && !/^hi\b/i.test(l)) });
  const text = [body, ...(opts.summary ?? []).map((r) => `${r.label}: ${r.value}`), button ? `${button.text}: ${button.url}` : '', [opts.brand.orgName, opts.brand.phone].filter(Boolean).join(' · ')]
    .filter(Boolean)
    .join('\n\n');
  return { subject, html, text };
}
