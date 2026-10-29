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

export type Due = { amountCents: number; purpose: 'deposit' | 'full' | 'balance' | 'none'; label: string };

/** What the customer pays now: the deposit (or everything, if they choose) to book, or what is left once booked. */
export function amountDue(q: QuoteContext, opts: { full?: boolean } = {}): Due {
  const o = q.order;
  if (o.status === 'booked' || o.status === 'completed') {
    const left = Math.max(0, o.totalCents - o.paidCents);
    return { amountCents: left, purpose: left > 0 ? 'balance' : 'none', label: left > 0 ? 'Balance due' : 'Paid in full' };
  }
  const all = Math.max(0, o.totalCents - o.paidCents);
  if (opts.full && all > 0) return { amountCents: all, purpose: 'full', label: 'Pay in full' };
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
export async function startCardPayment(db: Db, q: QuoteContext, opts: { saveCard: boolean; payFull?: boolean }) {
  const due = amountDue(q, { full: opts.payFull });
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
    // Paying everything leaves nothing for the event day, so there is no card to keep.
    saveCard: opts.saveCard && due.purpose !== 'full',
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
      // The payment confirmation below also confirms the booking (one email, like Odoo).
      await transitionOrder(db, q.tenant.id, actor, q.order.id, 'book', prefs, { paymentFollows: true });
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

// --- staff card payments (order Payment Options, Invoices → Record payment) ---------------------------------

/**
 * What staff take by card: `book` books the order once the money is in, `payment`
 * pays toward a booked order, `tip` is Collect Tip (a tip on its own, no amount).
 */
export type StaffCard = { purpose: 'book' | 'payment' | 'tip'; amountCents: number; tipCents: number; receipt: boolean; saveCard?: boolean; policies?: Record<string, boolean> };
export type StaffCardResult = { number: string; last4: string | null; brand: string | null; booked: boolean };

async function staffQuote(db: Db, tenantId: string, orderId: string) {
  const { quoteContext } = await import('@rental/db');
  const q = await quoteContext(db, tenantId, orderId);
  if (!q) throw new OrgError('Order not found.', 'not_found');
  return q;
}

/** The amounts make sense for the order as it is now (checked again when the money comes back). */
function checkStaffCard(q: QuoteContext, p: StaffCard) {
  const open = q.order.status === 'draft' || q.order.status === 'quote_sent';
  const live = q.order.status === 'booked' || q.order.status === 'completed';
  if (p.purpose === 'book' && !open) throw new OrgError('This order is already booked. Record the payment instead.', 'invalid');
  if (p.purpose !== 'book' && !live) throw new OrgError(p.purpose === 'tip' ? 'Tips are collected once the order is booked.' : 'Book the order first.', 'invalid');
  if (p.tipCents < 0 || p.amountCents < 0) throw new OrgError('Amounts cannot be negative.', 'invalid');
  if (p.purpose === 'tip') {
    if (p.amountCents !== 0 || p.tipCents <= 0) throw new OrgError('Enter the tip amount.', 'invalid');
  } else {
    if (p.amountCents <= 0) throw new OrgError('Enter the amount to charge.', 'invalid');
    if (p.amountCents > q.order.totalCents - q.order.paidCents) throw new OrgError('That is more than the order total.', 'invalid');
  }
}

/**
 * The card went through (new or saved): book the order when that was the point
 * (refunding at once if the stock went in the meantime), then record the payment
 * once and keep the card for auto-charge when it was saved.
 */
async function settleStaffCard(
  db: Db, q: QuoteContext, s: NonNullable<Awaited<ReturnType<typeof stripeFor>>>, actor: Actor, p: StaffCard,
  i: { id: string; created: Date; card: { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null }; saved: { customerId: string | null; methodId: string } | null },
): Promise<StaffCardResult> {
  let booked = false;
  if (p.purpose === 'book' && (q.order.status === 'draft' || q.order.status === 'quote_sent')) {
    try {
      await transitionOrder(db, q.tenant.id, actor, q.order.id, 'book', parsePreferences(q.tenant.settings), {
        booking: { method: 'card', policies: p.policies ?? {} }, paymentFollows: true,
      });
      booked = true;
    } catch (e) {
      await refundIntent(s.stripe, i.id, `Could not book ${q.order.number}: ${(e as Error).message}`);
      throw new OrgError(`The card was charged, but the order could not be booked, so the charge was refunded in full. ${(e as Error).message}`, 'invalid');
    }
  }
  const r = await recordGatewayPayment(db, q.tenant.id, actor, q.order.id, {
    gateway: 'stripe', ref: i.id, amountCents: p.amountCents, tipCents: p.tipCents, brand: i.card.brand, last4: i.card.last4, receipt: p.receipt,
    steps: { authorizedAt: i.created.toISOString(), capturedAt: new Date().toISOString() },
  });
  if (i.saved) {
    await withTenant(db, q.tenant.id, (tx) =>
      saveCardTx(tx, q.tenant.id, {
        customerId: q.customer.id, gateway: 'stripe', gatewayCustomerId: i.saved!.customerId, gatewayMethodId: i.saved!.methodId, brand: i.card.brand,
        last4: i.card.last4, expMonth: i.card.expMonth, expYear: i.card.expYear,
      }),
    );
  }
  return { number: r.payment.number, last4: i.card.last4, brand: i.card.brand, booked };
}

/** New card at the counter or on the phone: a PaymentIntent for Stripe's card field in the staff browser. */
export async function startStaffCardPayment(db: Db, tenantId: string, orderId: string, p: StaffCard) {
  const q = await staffQuote(db, tenantId, orderId);
  checkStaffCard(q, p);
  const s = await stripeFor(db, q);
  if (!s) throw new OrgError('Connect Stripe first (Settings → Workspace & brand → Payments).', 'invalid');
  if (p.purpose === 'book') {
    const avail = await stillAvailable(db, q);
    if (!avail.ok) throw new OrgError(`${avail.short.join(', ')} ${avail.short.length === 1 ? 'is' : 'are'} no longer available for this time.`, 'invalid');
  }
  const existing = q.card?.gateway === 'stripe' ? q.card.gatewayCustomerId : null;
  const customerId = await ensureStripeCustomer(s.stripe, existing, {
    name: q.customer.displayName ?? 'Customer', email: q.customer.email, phone: q.customer.phone, ref: `${q.tenant.id}:${q.customer.id}`,
  });
  const total = p.amountCents + p.tipCents;
  const intent = await createIntent(s.stripe, {
    amountCents: total,
    currency: q.tenant.currency,
    customerId,
    saveCard: !!p.saveCard,
    description: `${q.tenant.name} · ${q.order.number} · ${p.purpose === 'tip' ? 'tip' : 'payment'}`,
    // What to record once it succeeds travels with the intent (the browser only says "done").
    metadata: {
      tenant_id: tenantId, order_id: orderId, order_number: q.order.number, purpose: `staff_${p.purpose}`,
      amount_cents: String(p.amountCents), tip_cents: String(p.tipCents), receipt: p.receipt ? '1' : '0',
    },
    idempotencyKey: `${orderId}:staff-${p.purpose}:${p.amountCents}:${p.tipCents}:v${q.order.version}:${p.saveCard ? 'save' : 'once'}`,
  });
  return { clientSecret: intent.clientSecret, intentId: intent.id, publishableKey: s.creds.publishableKey!, amountCents: total, testMode: s.creds.keyMode === 'test' };
}

/** After Stripe's card field says it went through: trust only what Stripe reports, then settle. */
export async function finishStaffCardPayment(db: Db, tenantId: string, orderId: string, actor: Actor, intentId: string, policies: Record<string, boolean> = {}) {
  const q = await staffQuote(db, tenantId, orderId);
  const s = await stripeFor(db, q);
  if (!s) throw new OrgError('Card payments are not set up.', 'invalid');
  const i = await readIntent(s.stripe, intentId);
  const m = i.metadata;
  if (m.order_id !== orderId || m.tenant_id !== tenantId || !m.purpose?.startsWith('staff_')) throw new OrgError('This payment belongs to another order.', 'invalid');
  if (i.status === 'processing') throw new OrgError('The bank is still processing the payment. Check Invoices & payments in a minute.', 'invalid');
  if (i.status !== 'succeeded') throw new OrgError('The payment did not go through. No money was taken.', 'invalid');
  const p: StaffCard = {
    purpose: m.purpose.slice(6) as StaffCard['purpose'], amountCents: Number(m.amount_cents), tipCents: Number(m.tip_cents), receipt: m.receipt === '1', policies,
  };
  return settleStaffCard(db, q, s, actor, p, {
    id: i.id, created: i.created, card: i.card, saved: i.savedForLater && i.paymentMethodId ? { customerId: i.customerId, methodId: i.paymentMethodId } : null,
  });
}

/** Charge the customer's saved card now (partial allowed, plus a tip), booking the order when asked. */
export async function chargeSavedCardForOrder(db: Db, tenantId: string, orderId: string, actor: Actor, p: StaffCard): Promise<StaffCardResult> {
  const q = await staffQuote(db, tenantId, orderId);
  checkStaffCard(q, p);
  const card = q.card?.gateway === 'stripe' ? q.card : null;
  if (!card || !card.gatewayCustomerId) throw new OrgError('This customer has no saved card. Use a new card or send a pay link.', 'invalid');
  const s = await stripeFor(db, q);
  if (!s) throw new OrgError('Connect Stripe first (Settings → Workspace & brand → Payments).', 'invalid');
  if (p.purpose === 'book') {
    const avail = await stillAvailable(db, q);
    if (!avail.ok) throw new OrgError(`${avail.short.join(', ')} ${avail.short.length === 1 ? 'is' : 'are'} no longer available for this time.`, 'invalid');
  }
  const total = p.amountCents + p.tipCents;
  const r = await chargeSaved(s.stripe, {
    amountCents: total, currency: q.tenant.currency, customerId: card.gatewayCustomerId, paymentMethodId: card.gatewayMethodId,
    description: `${q.tenant.name} · ${q.order.number} · ${p.purpose === 'tip' ? 'tip' : 'payment'}`, metadata: { tenant_id: tenantId, order_id: orderId, purpose: `staff_${p.purpose}` },
    // A double click on the same order version makes one charge, not two.
    idempotencyKey: `${orderId}:staff-${p.purpose}:${total}:v${q.order.version}`,
  });
  if (!r.ok) throw new OrgError(r.declined ? `Card declined: ${r.message}` : r.message, 'invalid');
  return settleStaffCard(db, q, s, actor, p, { id: r.intentId, created: new Date(), card: r.card, saved: null });
}

/** Invoices → Record payment → Card on file. */
export async function chargeCardOnFile(
  db: Db, tenantId: string, orderId: string, actor: Actor, p: { amountCents: number; tipCents: number; receipt: boolean },
) {
  return chargeSavedCardForOrder(db, tenantId, orderId, actor, { purpose: 'payment', ...p });
}

/**
 * Refund part of a cancelled order's payments to the cards they came from
 * (newest first). Returns what the gateway refunded, for cancelOrder to record;
 * the rest of the amount comes from cash/check payments (handed back by staff).
 */
export async function refundToCards(db: Db, tenantId: string, orderId: string, amountCents: number, reason: string) {
  const { getPaymentCredentials, planRefund, refundablePayments, getOrder } = await import('@rental/db');
  const order = await getOrder(db, tenantId, orderId);
  if (!order) throw new OrgError('Order not found.', 'not_found');
  const plan = planRefund(await refundablePayments(db, tenantId, orderId), amountCents);
  if (plan.unallocatedCents > 0) throw new OrgError('That is more than was paid.', 'invalid');
  const cards = plan.parts.filter((p) => p.gateway === 'stripe' && p.intentRef);
  if (!cards.length) return [];
  const creds = await getPaymentCredentials(db, tenantId, order.locationId);
  if (!creds || creds.provider !== 'stripe' || !creds.secret) throw new OrgError('Card payments are not connected, so the card refund cannot be made. Choose wallet credit or a rain check instead.', 'invalid');
  const stripe = stripeClient(creds.secret);
  const done: { paymentId: string; cents: number; gateway: string; method: string; ref: string }[] = [];
  for (const p of cards) {
    const ref = await refundIntent(stripe, p.intentRef!, reason, p.cents);
    done.push({ paymentId: p.paymentId, cents: p.cents, gateway: 'stripe', method: 'card', ref });
  }
  return done;
}
