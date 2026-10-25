/**
 * Money flows shared by the quote page (web) and the event-day charge (worker).
 * Gateway-agnostic on the outside; Stripe today, iPOS Pay next (same shape).
 */
import { parsePreferences, utcToWallTime } from '@rental/core';
import {
  getPaymentCredentials, OrgError, productAvailability, recordChargeFailure, recordGatewayPayment, saveCardTx, transitionOrder, withTenant,
  type Actor, type Db, type MessageContext, type QuoteContext,
} from '@rental/db';
import { chargeSaved, createIntent, ensureStripeCustomer, readIntent, refundIntent, stripeClient } from './stripe';

export type Due = { amountCents: number; purpose: 'deposit' | 'balance' | 'none'; label: string };

/** What the customer pays now: the deposit to book, or what is left once booked. */
export function amountDue(q: QuoteContext): Due {
  const o = q.order;
  if (o.status === 'booked' || o.status === 'completed') {
    const left = Math.max(0, o.totalCents - o.paidCents);
    return { amountCents: left, purpose: left > 0 ? 'balance' : 'none', label: left > 0 ? 'Balance due' : 'Paid in full' };
  }
  return { amountCents: o.depositDueCents, purpose: o.depositDueCents > 0 ? 'deposit' : 'none', label: 'Deposit to book' };
}

/** Is everything on the order still free for its time? (Quotes hold nothing until paid.) */
export async function stillAvailable(db: Db, q: QuoteContext) {
  const o = q.order;
  if (o.status === 'booked') return { ok: true as const };
  const avail = await productAvailability(db, q.tenant.id, o.locationId, o.eventStartsAt, o.eventEndsAt, o.id);
  const need = new Map<string, number>();
  for (const l of q.lines) if (l.product_id) need.set(l.product_id, (need.get(l.product_id) ?? 0) + l.quantity);
  const short = [...need].filter(([id, n]) => avail[id] && !avail[id]!.overbook && avail[id]!.free < n).map(([id]) => q.lines.find((l) => l.product_id === id)!.name);
  return short.length ? { ok: false as const, short } : { ok: true as const };
}

async function stripeFor(db: Db, q: QuoteContext) {
  const creds = await getPaymentCredentials(db, q.tenant.id, q.order.locationId);
  if (!creds || creds.provider !== 'stripe' || !creds.secret || !creds.publishableKey) return null;
  return { creds, stripe: stripeClient(creds.secret) };
}

/** Is card payment possible for this order (what the quote page offers). */
export async function cardGateway(db: Db, q: QuoteContext) {
  const s = await stripeFor(db, q);
  return s ? { provider: 'stripe' as const, publishableKey: s.creds.publishableKey!, testMode: s.creds.keyMode === 'test' } : null;
}

/** Start a card payment: re-check stock, then a PaymentIntent the browser confirms with Stripe. */
export async function startCardPayment(db: Db, q: QuoteContext, opts: { saveCard: boolean }) {
  const due = amountDue(q);
  if (due.amountCents <= 0) throw new OrgError('Nothing is due right now.', 'invalid');
  const s = await stripeFor(db, q);
  if (!s) throw new OrgError(`${q.tenant.name} has not set up card payments yet. Please call them to book.`, 'invalid');
  const avail = await stillAvailable(db, q);
  if (!avail.ok) throw new OrgError(`Sorry — ${avail.short.join(', ')} ${avail.short.length === 1 ? 'is' : 'are'} no longer available for this time. Please contact ${q.tenant.name}.`, 'invalid');
  const existing = q.card?.gateway === 'stripe' ? q.card.gatewayCustomerId : null;
  const customerId = await ensureStripeCustomer(s.stripe, existing, {
    name: q.customer.displayName ?? 'Customer', email: q.customer.email, phone: q.customer.phone, ref: `${q.tenant.id}:${q.customer.id}`,
  });
  const intent = await createIntent(s.stripe, {
    amountCents: due.amountCents,
    currency: q.tenant.currency,
    customerId,
    saveCard: opts.saveCard,
    description: `${q.tenant.name} · ${q.order.number} · ${due.purpose}`,
    metadata: { tenant_id: q.tenant.id, order_id: q.order.id, order_number: q.order.number, purpose: due.purpose },
    // Same order, same amount, same version → the same intent (a double click never makes two).
    idempotencyKey: `${q.order.id}:${due.purpose}:${due.amountCents}:v${q.order.version}:${opts.saveCard ? 'save' : 'once'}`,
  });
  return { clientSecret: intent.clientSecret, intentId: intent.id, publishableKey: s.creds.publishableKey!, amountCents: due.amountCents, purpose: due.purpose };
}

export type FinishResult = { ok: true; paymentNumber: string; last4: string | null; brand: string | null; booked: boolean } | { ok: false; error: string };

/**
 * After the browser says the card went through: read the intent from Stripe,
 * book the order if it is a deposit (refunding if the stock went in the meantime),
 * record the payment once, and save the card for the event-day balance.
 */
export async function finishCardPayment(db: Db, q: QuoteContext, intentId: string): Promise<FinishResult> {
  const s = await stripeFor(db, q);
  if (!s) return { ok: false, error: 'Card payments are not set up.' };
  const i = await readIntent(s.stripe, intentId);
  if (i.metadata.order_id !== q.order.id || i.metadata.tenant_id !== q.tenant.id) return { ok: false, error: 'This payment belongs to another order.' };
  if (i.status === 'processing') return { ok: false, error: 'Your bank is still processing the payment. Refresh this page in a minute.' };
  if (i.status !== 'succeeded') return { ok: false, error: 'The payment did not go through. No money was taken.' };

  const prefs = parsePreferences(q.tenant.settings);
  const actor = { type: 'customer' as const };
  let booked = false;
  if (q.order.status === 'draft' || q.order.status === 'quote_sent') {
    try {
      await transitionOrder(db, q.tenant.id, actor, q.order.id, 'book', prefs);
      booked = true;
    } catch (e) {
      // Someone else booked the last unit between "Pay" and now: give the money back at once.
      await refundIntent(s.stripe, i.id, `Could not book ${q.order.number}: ${(e as Error).message}`);
      return { ok: false, error: `Sorry — the equipment was booked by someone else a moment ago. Your card was refunded in full. ${(e as Error).message}` };
    }
  }
  const r = await recordGatewayPayment(db, q.tenant.id, actor, q.order.id, {
    gateway: 'stripe', ref: i.id, amountCents: i.amountCents, brand: i.card.brand, last4: i.card.last4,
    steps: { authorizedAt: i.created.toISOString(), capturedAt: new Date().toISOString() },
  });
  if (i.savedForLater && i.paymentMethodId) {
    await withTenant(db, q.tenant.id, (tx) =>
      saveCardTx(tx, q.tenant.id, {
        customerId: q.customer.id, gateway: 'stripe', gatewayCustomerId: i.customerId, gatewayMethodId: i.paymentMethodId!, brand: i.card.brand,
        last4: i.card.last4, expMonth: i.card.expMonth, expYear: i.card.expYear,
      }),
    );
  }
  return { ok: true, paymentNumber: r.payment.number, last4: i.card.last4, brand: i.card.brand, booked: booked || q.order.status === 'booked' };
}

/**
 * Worker hook for the charge_balance message: charge the saved card for what is
 * left. A decline marks the balance overdue, sends the customer a pay link and
 * alerts the office (recordChargeFailure).
 */
export function balanceCharger(db: Db) {
  return async (ctx: MessageContext) => {
    const o = ctx.order!;
    const due = o.totalCents - o.paidCents;
    if (due <= 0) return { ok: false as const, skip: 'Nothing left to pay' };
    const { quoteContext } = await import('@rental/db');
    const q = await quoteContext(db, ctx.tenant.id, o.id);
    if (!q) return { ok: false as const, skip: 'Order not found' };
    const balance = q.invoices.find((i) => (i.kind === 'balance' || i.kind === 'full') && i.status !== 'paid');
    if (balance && !balance.autoCharge) return { ok: false as const, skip: 'Auto-charge is switched off for this invoice' };
    const card = q.card?.gateway === 'stripe' ? q.card : null;
    if (!card || !card.gatewayCustomerId) return { ok: false as const, skip: 'No saved card — the balance stays open' };
    const s = await stripeFor(db, q);
    if (!s) return { ok: false as const, skip: 'No card gateway connected' };
    const eventDay = utcToWallTime(o.eventStartsAt, q.location.timezone).date;
    const r = await chargeSaved(s.stripe, {
      amountCents: due, currency: q.tenant.currency, customerId: card.gatewayCustomerId, paymentMethodId: card.gatewayMethodId,
      description: `${q.tenant.name} · ${o.number} · balance`, metadata: { tenant_id: q.tenant.id, order_id: o.id, purpose: 'balance' },
      idempotencyKey: `${o.id}:auto-balance:${eventDay}:${due}`,
    });
    if (!r.ok) {
      await recordChargeFailure(db, q.tenant.id, o.id, balance?.id ?? null, r.declined ? `Card declined: ${r.message}` : r.message);
      return { ok: false as const, error: r.message };
    }
    const p = await recordGatewayPayment(db, q.tenant.id, { type: 'system' }, o.id, {
      gateway: 'stripe', ref: r.intentId, amountCents: due, brand: r.card.brand, last4: r.card.last4, receipt: false,
      steps: { authorizedAt: new Date().toISOString(), capturedAt: new Date().toISOString() },
    });
    return { ok: true as const, payment: { number: p.payment.number, amountCents: due, method: 'card', last4: r.card.last4 } };
  };
}

/**
 * Staff "Record payment → card on file": charge the customer's saved card now
 * for an amount the office chooses (partial allowed), plus an optional tip.
 */
export async function chargeCardOnFile(
  db: Db, tenantId: string, orderId: string, actor: Actor, p: { amountCents: number; tipCents: number; receipt: boolean },
) {
  const { quoteContext } = await import('@rental/db');
  const q = await quoteContext(db, tenantId, orderId);
  if (!q) throw new OrgError('Order not found.', 'not_found');
  const card = q.card?.gateway === 'stripe' ? q.card : null;
  if (!card || !card.gatewayCustomerId) throw new OrgError('This customer has no saved card. Send them a pay link instead.', 'invalid');
  const s = await stripeFor(db, q);
  if (!s) throw new OrgError('Connect Stripe first (Settings → Workspace & brand → Connect).', 'invalid');
  const total = p.amountCents + p.tipCents;
  const r = await chargeSaved(s.stripe, {
    amountCents: total, currency: q.tenant.currency, customerId: card.gatewayCustomerId, paymentMethodId: card.gatewayMethodId,
    description: `${q.tenant.name} · ${q.order.number} · payment`, metadata: { tenant_id: tenantId, order_id: orderId, purpose: 'staff' },
    // A double click on the same order version makes one charge, not two.
    idempotencyKey: `${orderId}:staff:${total}:v${q.order.version}`,
  });
  if (!r.ok) throw new OrgError(r.declined ? `Card declined: ${r.message}` : r.message, 'invalid');
  const rec = await recordGatewayPayment(db, tenantId, actor, orderId, {
    gateway: 'stripe', ref: r.intentId, amountCents: p.amountCents, tipCents: p.tipCents, brand: r.card.brand, last4: r.card.last4, receipt: p.receipt,
    steps: { authorizedAt: new Date().toISOString(), capturedAt: new Date().toISOString() },
  });
  return { number: rec.payment.number, last4: r.card.last4, brand: r.card.brand };
}
