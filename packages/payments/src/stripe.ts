/**
 * Stripe, per workspace (each one connects its own account; keys are decrypted
 * server-side only). Card numbers never reach our servers: the browser talks to
 * Stripe's Payment Element, and we only see ids, the brand and the last 4 digits.
 */
import Stripe from 'stripe';

const clients = new Map<string, Stripe>();

export function stripeClient(secret: string) {
  let c = clients.get(secret);
  if (!c) {
    c = new Stripe(secret, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'Tentpole Rentals' } });
    clients.set(secret, c);
  }
  return c;
}

export type CardInfo = { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };

export async function ensureStripeCustomer(stripe: Stripe, existingId: string | null, who: { name: string; email: string | null; phone: string | null; ref: string }) {
  if (existingId) return existingId;
  const c = await stripe.customers.create(
    { name: who.name, email: who.email ?? undefined, phone: who.phone ?? undefined, metadata: { tentpole_customer: who.ref } },
    { idempotencyKey: `customer:${who.ref}` },
  );
  return c.id;
}

export async function createIntent(
  stripe: Stripe,
  p: { amountCents: number; currency: string; customerId: string; saveCard: boolean; description: string; metadata: Record<string, string>; idempotencyKey: string },
) {
  const intent = await stripe.paymentIntents.create(
    {
      amount: p.amountCents,
      currency: p.currency.toLowerCase(),
      customer: p.customerId,
      allowed_payment_method_types: ['card'],
      setup_future_usage: p.saveCard ? 'off_session' : undefined,
      description: p.description,
      metadata: p.metadata,
    },
    { idempotencyKey: p.idempotencyKey },
  );
  return { id: intent.id, clientSecret: intent.client_secret! };
}

/** The intent as Stripe has it (never trust what the browser says happened). */
export async function readIntent(stripe: Stripe, id: string) {
  const i = await stripe.paymentIntents.retrieve(id, { expand: ['payment_method', 'latest_charge'] });
  const pm = typeof i.payment_method === 'object' ? i.payment_method : null;
  const card: CardInfo = { brand: pm?.card?.brand ?? null, last4: pm?.card?.last4 ?? null, expMonth: pm?.card?.exp_month ?? null, expYear: pm?.card?.exp_year ?? null };
  return {
    id: i.id,
    status: i.status,
    amountCents: i.amount_received || i.amount,
    currency: i.currency,
    metadata: i.metadata,
    customerId: typeof i.customer === 'string' ? i.customer : i.customer?.id ?? null,
    paymentMethodId: pm?.id ?? (typeof i.payment_method === 'string' ? i.payment_method : null),
    savedForLater: i.setup_future_usage === 'off_session',
    card,
    created: new Date(i.created * 1000),
  };
}

export type ChargeResult = { ok: true; intentId: string; card: CardInfo } | { ok: false; declined: boolean; message: string; intentId?: string };

/** Charge a saved card without the customer present (event-day balance). */
export async function chargeSaved(
  stripe: Stripe,
  p: { amountCents: number; currency: string; customerId: string; paymentMethodId: string; description: string; metadata: Record<string, string>; idempotencyKey: string },
): Promise<ChargeResult> {
  try {
    const i = await stripe.paymentIntents.create(
      {
        amount: p.amountCents, currency: p.currency.toLowerCase(), customer: p.customerId, payment_method: p.paymentMethodId, off_session: true, confirm: true,
        description: p.description, metadata: p.metadata,
      },
      { idempotencyKey: p.idempotencyKey },
    );
    if (i.status !== 'succeeded') {
      const message = i.status === 'requires_action' ? 'The bank asked the customer to approve this payment.' : `The payment did not go through (${i.status.replace(/_/g, ' ')}).`;
      return { ok: false, declined: true, message, intentId: i.id };
    }
    const r = await readIntent(stripe, i.id);
    return { ok: true, intentId: i.id, card: r.card };
  } catch (e) {
    const err = e as { type?: string; message?: string; code?: string; raw?: { payment_intent?: { id?: string } } };
    const declined = err.type === 'StripeCardError' || err.code === 'authentication_required';
    return { ok: false, declined, message: err.message ?? 'The charge failed.', intentId: err.raw?.payment_intent?.id };
  }
}

export async function refundIntent(stripe: Stripe, intentId: string, reason: string) {
  await stripe.refunds.create({ payment_intent: intentId, reason: 'requested_by_customer', metadata: { note: reason.slice(0, 400) } }, { idempotencyKey: `refund:${intentId}` });
}

/** Check a secret key before saving it (Settings → Connect). */
export async function verifyStripeKey(secret: string) {
  try {
    const acct = await stripeClient(secret).accounts.retrieve(null);
    return { ok: true as const, account: acct.settings?.dashboard?.display_name ?? acct.business_profile?.name ?? acct.id };
  } catch (e) {
    return { ok: false as const, message: (e as Error).message };
  }
}
