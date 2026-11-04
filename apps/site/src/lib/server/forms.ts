/** What each website form accepts, where it goes, and what the thank-you email says. */
import * as z from 'zod';

const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(200);
const text = (max = 200) => z.string().trim().max(max);
const req = (label: string, max = 200) => z.string().trim().min(1, `${label} is required.`).max(max);

export const FORMS = {
  newsletter: {
    list: 'Newsletter',
    schema: z.object({ email, source: text(40).optional() }),
    inbox: null,
    thanks: {
      subject: 'You’re on the Rent Hatch newsletter',
      lines: ['Thanks for subscribing. Once a month we send one useful email for rental operators: pricing ideas, seasonal checklists and what changed in Rent Hatch.', 'No spam, and every email has a one-click unsubscribe.'],
    },
  },
  'early-access': {
    list: 'Cars early access',
    schema: z.object({
      email,
      name: text(120).optional(),
      fleet_size: text(40).optional(),
      current_tool: text(120).optional(),
      source: text(40).optional(),
    }),
    inbox: 'sales',
    thanks: {
      subject: 'You’re on the list for Rent Hatch car rental',
      lines: ['Thanks for joining early access to Rent Hatch for car and vehicle rental.', 'We’re onboarding fleets in small groups. We’ll email you before your spot opens, with launch pricing locked in for early-access members.', 'Reply to this email any time to tell us about your fleet. It helps us shape the launch.'],
    },
  },
  demo: {
    list: 'Demo requests',
    schema: z.object({
      name: req('Name', 120),
      email,
      company: req('Company', 160),
      phone: text(40).optional(),
      rents: req('What you rent', 60),
      size: text(60).optional(),
      current_tool: text(120).optional(),
      slot: z.string().datetime({ offset: true, message: 'Pick a time for the call.' }),
      timezone: text(60).optional(),
    }),
    inbox: 'sales',
    thanks: {
      subject: 'Your Rent Hatch demo is booked',
      lines: ['Thanks for booking a demo. A calendar invite is attached; the video link follows from the person running your call.', 'Bring a real order or two you’ve struggled with. We’ll build them live in Rent Hatch so you can see the numbers for your business.'],
    },
  },
  contact: {
    list: 'Contact',
    schema: z.object({
      topic: z.enum(['sales', 'support', 'partners', 'press', 'jobs']),
      name: req('Name', 120),
      email,
      company: text(160).optional(),
      rents: text(60).optional(),
      message: req('Message', 5000),
    }),
    inbox: 'topic',
    thanks: {
      subject: 'We got your message',
      lines: ['Thanks for writing to Rent Hatch. A real person reads every message, and we usually reply within one business day.'],
    },
  },
} as const;

export type FormKind = keyof typeof FORMS;
export const isFormKind = (k: string | undefined): k is FormKind => !!k && k in FORMS;

/** Inbox for a submission: a fixed team or, for contact, the topic the visitor picked. */
export function inboxFor(kind: FormKind, data: Record<string, unknown>): string | null {
  const inbox = FORMS[kind].inbox;
  if (!inbox) return null;
  const key = inbox === 'topic' ? String(data.topic ?? 'sales') : inbox;
  const env = process.env;
  return env[`INBOX_${key.toUpperCase()}`] || env.INBOX_SALES || 'sales@renthatch.com';
}
