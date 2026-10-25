/**
 * The rental agreement customers sign on the quote page, and the policies they
 * tick before signing. Each workspace edits its own; the version label goes on
 * every signature together with the exact text that was signed.
 */
import { z } from 'zod';

export const policySchema = z.object({
  key: z.string().regex(/^[a-z_]{2,30}$/),
  title: z.string().trim().min(2).max(80),
  text: z.string().trim().min(2).max(800),
});
export type Policy = z.infer<typeof policySchema>;

export const agreementSchema = z.object({
  /** Shown on the signature, e.g. 2026-10. Change it whenever the wording changes. */
  version: z.string().trim().min(1).max(20).default('2026-10'),
  title: z.string().trim().min(2).max(120).default('Rental agreement'),
  /** Plain text; lines starting with "## " are headings. */
  body: z.string().max(30000).default(''),
  policies: z.array(policySchema).max(10).default([]),
  /** Rain checks issued for weather cancellations stay valid this many months. */
  rainCheckMonths: z.coerce.number().int().min(1).max(60).default(12),
});
export type Agreement = z.infer<typeof agreementSchema>;

/** The design's four quote-page policies (the waiver one is answered accept / decline). */
export const DEFAULT_POLICIES: Policy[] = [
  { key: 'weather', title: 'Weather & payment', text: 'If weather forces a cancellation, your payment becomes a rain check you can use within {months} months.' },
  { key: 'setup', title: 'Setup & electricity', text: 'We need a flat area and a power outlet within 50 ft for each blower. Generators are available.' },
  { key: 'supervise', title: 'Adult supervision', text: 'An adult who has read the safety rules must supervise the equipment at all times.' },
  { key: 'waiver', title: 'Damage waiver', text: 'Covers accidental damage to the rentals. Without it, you pay for repairs or replacement.' },
];

export const DEFAULT_AGREEMENT_BODY = `## Terms of rental
The customer agrees to supervise the rented equipment and to follow the operating rules for each item. If equipment is damaged, the customer pays for the repair or replacement, unless the damage waiver was purchased and the damage was accidental.

## Delivery, operation and payment
The customer allows our staff onto the event address to deliver, set up and collect the equipment. One electrical outlet within 50 feet is needed for each blower, on a circuit used for nothing else.

## Safety
Equipment is only used on a smooth, suitable surface and is anchored by our crew. It must not be used in high or gusty winds, rain or lightning. An adult must supervise the users at all times, and the posted age and capacity limits must be followed.

## Weather and cancellations
If weather makes the event unsafe, the payment becomes a rain check for a future date. Other cancellations follow the cancellation policy on the quote.`;

export const defaultAgreement = (): Agreement => ({
  version: '2026-10', title: 'Rental agreement', body: DEFAULT_AGREEMENT_BODY, policies: DEFAULT_POLICIES, rainCheckMonths: 12,
});

/** The agreement to show: the workspace's own, or the default when it has none yet. */
export function resolveAgreement(a: Agreement): Agreement {
  return { ...a, body: a.body.trim() ? a.body : DEFAULT_AGREEMENT_BODY, policies: a.policies.length ? a.policies : DEFAULT_POLICIES };
}

export const policyText = (p: Policy, a: Agreement) => p.text.replace('{months}', String(a.rainCheckMonths));

/** "## Heading" lines → sections, for rendering the agreement. */
export function agreementSections(body: string) {
  const out: { heading: string | null; paragraphs: string[] }[] = [];
  for (const block of body.split(/\n{2,}/)) {
    const lines = block.trim().split('\n');
    if (!lines[0]) continue;
    if (lines[0].startsWith('## ')) {
      out.push({ heading: lines[0].slice(3).trim(), paragraphs: lines.slice(1).join(' ').trim() ? [lines.slice(1).join(' ').trim()] : [] });
    } else if (out.length) out[out.length - 1]!.paragraphs.push(lines.join(' '));
    else out.push({ heading: null, paragraphs: [lines.join(' ')] });
  }
  return out;
}

export const signSchema = z.object({
  typedName: z.string().trim().min(3, 'Type your full name.').max(120),
  consent: z.literal(true, 'Tick the box to confirm your typed name is your signature.'),
  policies: z.record(z.string(), z.boolean()),
  waiverAccepted: z.boolean(),
});
export type SignInput = z.infer<typeof signSchema>;
