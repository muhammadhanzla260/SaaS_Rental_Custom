import 'server-only';
import type { PaymentAccountInput } from '@rental/core';
import { verifyStripeKey } from '@rental/payments';
import type { ActionResult } from '@/lib/result';

const mode = (key: string | undefined) => key?.match(/_(test|live)_/)?.[1];
const fail = (message: string): { ok: false; result: ActionResult<never> } => ({
  ok: false, result: { ok: false, error: 'Stripe keys need attention.', fieldErrors: { 'payments.secretKey': message } },
});

/** Before new Stripe keys are stored: both must be test (or both live), and the secret must open the account. */
export async function checkStripeKeys(p: PaymentAccountInput | undefined) {
  if (p?.provider !== 'stripe' || !p.secretKey) return { ok: true as const, account: null };
  if (p.publishableKey && mode(p.publishableKey) !== mode(p.secretKey)) return fail('Use a matching pair: both test keys, or both live keys.');
  const r = await verifyStripeKey(p.secretKey);
  if (!r.ok) return fail('Stripe did not accept this secret key. Copy it again from Stripe → Developers → API keys.');
  return { ok: true as const, account: `${r.account}${mode(p.secretKey) === 'test' ? ' (test mode)' : ''}` };
}
