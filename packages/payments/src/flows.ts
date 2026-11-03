/**
 * Money flows shared by the quote page (web) and the event-day charge (worker).
 * Gateway-agnostic on the outside; Stripe today, iPOS Pay next (same shape).
 */
import { parsePreferences, utcToWallTime } from '@rental/core';
import {
  alertPayment, chargeInProgress, claimChargeLock, currentOrderStatus, findGatewayPayment, getPaymentCredentials, OrgError, productAvailability,
  recordChargeFailure, recordGatewayPayment, recordGatewayRefund, releaseChargeLock, saveCardTx, settleStalePendingRefund, stalePendingRefunds, stripeSecrets,
  transitionOrder, withTenant, type Actor, type Db, type MessageContext, type QuoteContext,
} from '@rental/db';
import { cancelIntent, chargeSaved, createIntent, ensureStripeCustomer, orderIntents, readIntent, refundForRow, refundIntent, stripeClient } from './stripe';

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

/**
 * Book the order a card just paid for. When booking fails, look again before refunding: another finish
 * of the same payment (a refresh, a double click, the page retrying) may have booked it a moment ago,
 * and then the money stays with the booking. Only an order that is still not booked gets the refund.
 */
async function bookOrRefund(
  db: Db, q: QuoteContext, stripe: ReturnType<typeof stripeClient>, intentId: string, actor: Actor, booking?: { method: 'card'; policies: Record<string, boolean> },
): Promise<{ booked: boolean; refused?: string }> {
  try {
    await transitionOrder(db, q.tenant.id, actor, q.order.id, 'book', parsePreferences(q.tenant.settings), { booking, paymentFollows: true });
    return { booked: true };
  } catch (e) {
    const now = await currentOrderStatus(db, q.tenant.id, q.order.id);
    if (now === 'booked' || now === 'completed') return { booked: false };
    await refundIntent(stripe, intentId, `Could not book ${q.order.number}: ${(e as Error).message}`);
    return { booked: false, refused: (e as Error).message };
  }
}

/**
 * Run a card charge while holding the order's charge lease, so two charges (auto-charge, staff,
 * Retry charge) never take the same balance at the same moment. null: another charge is running.
 */
async function oneChargeAtATime<T>(db: Db, tenantId: string, orderId: string, charge: () => Promise<T>): Promise<T | null> {
  if (!(await claimChargeLock(db, tenantId, orderId))) return null;
  try {
    return await charge();
  } finally {
    await releaseChargeLock(db, tenantId, orderId).catch((e) => console.error('[charge lock]', (e as Error).message));
  }
}

/** Money that arrived on a cancelled order goes straight back, and the office hears about it. */
async function refundCancelled(db: Db, q: QuoteContext, stripe: ReturnType<typeof stripeClient>, intentId: string, amountCents: number) {
  await refundIntent(stripe, intentId, `${q.order.number} was cancelled before this payment arrived`);
  await alertPayment(db, q.tenant.id, q.order.id, `cancelled:${intentId}`,
    `A card payment of $${(amountCents / 100).toFixed(2)} arrived after ${q.order.number} was cancelled. It was refunded to the card in full.`);
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
  if (await chargeInProgress(db, q.tenant.id, q.order.id)) throw new OrgError('A card payment on this order is being taken right now. Refresh this page in a minute.', 'invalid');
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

  const actor = { type: 'customer' as const };
  // Already recorded (this payment was finished a moment ago): say so again, change nothing.
  const done = await findGatewayPayment(db, q.tenant.id, i.id);
  if (done) {
    const status = await currentOrderStatus(db, q.tenant.id, q.order.id);
    return { ok: true, paymentNumber: done.number, last4: done.cardLast4, brand: done.cardBrand, booked: status === 'booked' || status === 'completed' };
  }
  if (q.order.status === 'cancelled') {
    await refundCancelled(db, q, s.stripe, i.id, i.amountCents);
    return { ok: false, error: `This order was cancelled, so the payment was refunded to your card in full. Please contact ${q.tenant.name}.` };
  }
  let booked = false;
  if (q.order.status === 'draft' || q.order.status === 'quote_sent') {
    // The payment confirmation below also confirms the booking (one email, like Odoo).
    const b = await bookOrRefund(db, q, s.stripe, i.id, actor);
    // Someone else booked the last unit between "Pay" and now: the money went back at once.
    if (b.refused) return { ok: false, error: `Sorry — the equipment was booked by someone else a moment ago. Your card was refunded in full. ${b.refused}` };
    booked = true;
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
  type Result = { ok: true; payment: { number: string; amountCents: number; method: string; last4: string | null } } | { ok: false; skip?: string; error?: string; retry?: boolean };
  return async (ctx: MessageContext): Promise<Result> => {
    const orderId = ctx.order!.id;
    if (ctx.order!.totalCents - ctx.order!.paidCents <= 0) return { ok: false, skip: 'Nothing left to pay' };
    const done = await oneChargeAtATime(db, ctx.tenant.id, orderId, async (): Promise<Result> => {
      const { quoteContext } = await import('@rental/db');
      let q = await quoteContext(db, ctx.tenant.id, orderId);
      if (!q) return { ok: false, skip: 'Order not found' };
      const s = await stripeFor(db, q);
      if (!s) return { ok: false, skip: 'No card gateway connected' };
      // The customer may have paid from the email link a moment ago: record that first.
      const sync = await syncOrderPayments(db, q.tenant.id, orderId, s.stripe);
      if (sync.processing) return { ok: false, error: 'A card payment on this order is still processing at the bank.', retry: true };
      if (sync.recorded) q = (await quoteContext(db, ctx.tenant.id, orderId))!;
      const o = q.order;
      const due = o.totalCents - o.paidCents;
      if (due <= 0) return { ok: false, skip: 'Nothing left to pay' };
      const balance = q.invoices.find((i) => (i.kind === 'balance' || i.kind === 'full') && i.status !== 'paid');
      if (balance && !balance.autoCharge) return { ok: false, skip: 'Auto-charge is switched off for this invoice' };
      const card = q.card?.gateway === 'stripe' ? q.card : null;
      if (!card || !card.gatewayCustomerId) return { ok: false, skip: 'No saved card. The balance stays open.' };
      const eventDay = utcToWallTime(o.eventStartsAt, q.location.timezone).date;
      const r = await chargeSaved(s.stripe, {
        amountCents: due, currency: q.tenant.currency, customerId: card.gatewayCustomerId, paymentMethodId: card.gatewayMethodId,
        description: `${q.tenant.name} · ${o.number} · balance`, metadata: { tenant_id: q.tenant.id, order_id: o.id, purpose: 'balance' },
        idempotencyKey: `${o.id}:auto-balance:${eventDay}:${due}`,
      });
      if (!r.ok) {
        await recordChargeFailure(db, q.tenant.id, o.id, balance?.id ?? null, r.declined ? `Card declined: ${r.message}` : r.message);
        return { ok: false, error: r.message };
      }
      const p = await recordGatewayPayment(db, q.tenant.id, { type: 'system' }, o.id, {
        gateway: 'stripe', ref: r.intentId, amountCents: due, brand: r.card.brand, last4: r.card.last4, receipt: false,
        steps: { authorizedAt: new Date().toISOString(), capturedAt: new Date().toISOString() },
      });
      await closeOpenPayForms(s.stripe, o.id, r.intentId);
      return { ok: true, payment: { number: p.payment.number, amountCents: due, method: 'card', last4: r.card.last4 } };
    });
    return done ?? { ok: false, error: 'Another card payment on this order is being taken right now.', retry: true };
  };
}

/** Pay forms left open on the quote page can no longer take a balance that was just paid another way. */
async function closeOpenPayForms(stripe: ReturnType<typeof stripeClient>, orderId: string, exceptId: string) {
  for (const i of await orderIntents(stripe, orderId)) {
    if (i.id !== exceptId && ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(i.status)) await cancelIntent(stripe, i.id);
  }
}

/**
 * Record a PaymentIntent that succeeded at Stripe but was never finished in the app (the tab
 * closed, the phone lost signal, a 3-D Secure return that never came back). Same steps as the
 * page would have taken: book the order when that was the point, record the payment once.
 */
async function settleIntent(db: Db, tenantId: string, orderId: string, intentId: string, purpose: string) {
  if (purpose.startsWith('staff_')) return finishStaffCardPayment(db, tenantId, orderId, { type: 'system' }, intentId);
  const { quoteContext } = await import('@rental/db');
  const q = await quoteContext(db, tenantId, orderId);
  if (!q) return null;
  return finishCardPayment(db, q, intentId);
}

/** Card payments Stripe took for one order that the app has not recorded yet: record them now. */
export async function syncOrderPayments(db: Db, tenantId: string, orderId: string, stripe: ReturnType<typeof stripeClient>) {
  let recorded = 0;
  let processing = false;
  for (const i of await orderIntents(stripe, orderId)) {
    if (i.metadata?.tenant_id !== tenantId) continue;
    if (i.status === 'processing') processing = true;
    if (i.status !== 'succeeded' || (await findGatewayPayment(db, tenantId, i.id))) continue;
    await settleIntent(db, tenantId, orderId, i.id, i.metadata.purpose ?? '');
    recorded++;
  }
  return { recorded, processing };
}

/**
 * Worker, every 15 minutes: bring a workspace's books in line with Stripe for the last few days.
 * Card payments that succeeded but were never recorded are recorded (and book their order);
 * refunds made in the Stripe dashboard are recorded against their payment; new disputes are
 * sent to the office. Without this, money could sit at Stripe that the app never shows.
 */
export async function reconcileStripe(db: Db, tenantId: string, sinceHours = 72) {
  const since = Math.floor(Date.now() / 1000) - sinceHours * 3600;
  const out = { payments: 0, refunds: 0, disputes: 0, errors: [] as string[] };
  for (const secret of await stripeSecrets(db, tenantId)) {
    const stripe = stripeClient(secret);
    for await (const i of stripe.paymentIntents.list({ created: { gte: since }, limit: 100 })) {
      const orderId = i.metadata?.order_id;
      if (i.metadata?.tenant_id !== tenantId || !orderId || i.status !== 'succeeded') continue;
      if (await findGatewayPayment(db, tenantId, i.id)) continue;
      try {
        await settleIntent(db, tenantId, orderId, i.id, i.metadata.purpose ?? '');
        out.payments++;
      } catch (e) {
        out.errors.push(`${i.id}: ${(e as Error).message}`);
      }
    }
    for await (const r of stripe.refunds.list({ created: { gte: since }, limit: 100 })) {
      // Our own refunds are recorded where they are made (cancel); these are the ones made in Stripe.
      if (r.metadata?.source === 'tentpole' || r.status !== 'succeeded' || typeof r.payment_intent !== 'string') continue;
      const row = await recordGatewayRefund(db, tenantId, { paymentRef: r.payment_intent, ref: r.id, amountCents: r.amount, reason: r.reason?.replace(/_/g, ' ') ?? 'refunded in Stripe' });
      if (row) out.refunds++;
    }
    for (const p of await stalePendingRefunds(db, tenantId)) {
      const ref = p.gatewayRef ?? (p.intentRef ? await refundForRow(stripe, p.intentRef, p.id).catch(() => null) : null);
      if ((await settleStalePendingRefund(db, tenantId, p.id, ref)) === 'done') out.refunds++;
    }
    for await (const d of stripe.disputes.list({ created: { gte: since }, limit: 100 })) {
      const ref = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
      const pay = ref ? await findGatewayPayment(db, tenantId, ref) : null;
      if (!pay) continue;
      await alertPayment(db, tenantId, pay.orderId, `dispute:${d.id}:${d.status}`,
        `The customer disputed the $${(d.amount / 100).toFixed(2)} card payment ${pay.number} with their bank (reason: ${d.reason.replace(/_/g, ' ')}; status: ${d.status.replace(/_/g, ' ')}). Answer it in your Stripe dashboard before the deadline.`);
      out.disputes++;
    }
  }
  return out;
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
  const done = await findGatewayPayment(db, q.tenant.id, i.id);
  if (done) return { number: done.number, last4: done.cardLast4, brand: done.cardBrand, booked: false };
  if (q.order.status === 'cancelled') {
    await refundCancelled(db, q, s.stripe, i.id, p.amountCents + p.tipCents);
    throw new OrgError('This order was cancelled, so the charge was refunded in full.', 'invalid');
  }
  let booked = false;
  if (p.purpose === 'book' && (q.order.status === 'draft' || q.order.status === 'quote_sent')) {
    const b = await bookOrRefund(db, q, s.stripe, i.id, actor, { method: 'card', policies: p.policies ?? {} });
    if (b.refused) throw new OrgError(`The card was charged, but the order could not be booked, so the charge was refunded in full. ${b.refused}`, 'invalid');
    booked = b.booked;
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
  const r = await oneChargeAtATime(db, tenantId, orderId, () => chargeSavedCard(db, tenantId, orderId, actor, p));
  if (!r) throw new OrgError('Another card payment on this order is being taken right now. Check Invoices & payments in a minute.', 'invalid');
  return r;
}

async function chargeSavedCard(db: Db, tenantId: string, orderId: string, actor: Actor, p: StaffCard): Promise<StaffCardResult> {
  // Read inside the lease: what is left to pay is what it is now, after any charge that just finished.
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
    description: `${q.tenant.name} · ${q.order.number} · ${p.purpose === 'tip' ? 'tip' : 'payment'}`,
    // Like a new-card payment, what to record travels with the charge (the reconciler reads it if recording fails).
    metadata: {
      tenant_id: tenantId, order_id: orderId, order_number: q.order.number, purpose: `staff_${p.purpose}`,
      amount_cents: String(p.amountCents), tip_cents: String(p.tipCents), receipt: p.receipt ? '1' : '0',
    },
    // A double click on the same order version makes one charge, not two.
    idempotencyKey: `${orderId}:staff-${p.purpose}:${total}:v${q.order.version}`,
  });
  if (!r.ok) throw new OrgError(r.declined ? `Card declined: ${r.message}` : r.message, 'invalid');
  const settled = await settleStaffCard(db, q, s, actor, p, { id: r.intentId, created: new Date(), card: r.card, saved: null });
  if (p.purpose !== 'tip') await closeOpenPayForms(s.stripe, orderId, r.intentId);
  return settled;
}

/** Invoices → Record payment → Card on file. */
export async function chargeCardOnFile(
  db: Db, tenantId: string, orderId: string, actor: Actor, p: { amountCents: number; tipCents: number; receipt: boolean },
) {
  return chargeSavedCardForOrder(db, tenantId, orderId, actor, { purpose: 'payment', ...p });
}

/**
 * Refund part of a cancelled order's payments to the cards they came from
 * (newest first). The refunds are written as pending rows first and the gateway
 * is asked with each row's id as its idempotency key; cancelOrder then marks them
 * done. The rest of the amount comes from cash/check payments (handed back by staff).
 */
export async function refundToCards(db: Db, tenantId: string, actor: Actor, orderId: string, amountCents: number, reason: string) {
  const { getOrder, markRefundSent, prepareCardRefunds } = await import('@rental/db');
  const order = await getOrder(db, tenantId, orderId);
  if (!order) throw new OrgError('Order not found.', 'not_found');
  const creds = await getPaymentCredentials(db, tenantId, order.locationId);
  const rows = await prepareCardRefunds(db, tenantId, actor, orderId, amountCents, reason);
  if (!rows.length) return [];
  if (!creds || creds.provider !== 'stripe' || !creds.secret) throw new OrgError('Card payments are not connected, so the card refund cannot be made. Choose wallet credit or a rain check instead.', 'invalid');
  const stripe = stripeClient(creds.secret);
  const done: { paymentId: string | null; cents: number; gateway: string; method: string; ref: string; refundId: string }[] = [];
  for (const r of rows) {
    const ref = r.gatewayRef ?? (await refundForRow(stripe, r.intentRef, r.id)) ?? (await refundIntent(stripe, r.intentRef, reason, r.cents, r.id));
    if (!r.gatewayRef) await markRefundSent(db, tenantId, r.id, ref);
    done.push({ paymentId: r.paymentId, cents: r.cents, gateway: 'stripe', method: 'card', ref, refundId: r.id });
  }
  return done;
}

/** Ops board → Refund now: give back a refund owed, to its card when it came from one, else handed back by staff. */
export async function refundOwed(db: Db, tenantId: string, actor: Actor, orderId: string) {
  const { getOrder, owedRefund, settleOwedRefund } = await import('@rental/db');
  const owed = await owedRefund(db, tenantId, orderId);
  if (!owed) throw new OrgError('Nothing is owed back on this order any more.', 'invalid');
  const r = owed.refund;
  if (r.gateway === 'stripe' && owed.intentRef) {
    const order = await getOrder(db, tenantId, orderId);
    const creds = await getPaymentCredentials(db, tenantId, order!.locationId);
    if (!creds || creds.provider !== 'stripe' || !creds.secret) throw new OrgError('Card payments are not connected, so the card refund cannot be made.', 'invalid');
    const stripe = stripeClient(creds.secret);
    const ref = (await refundForRow(stripe, owed.intentRef, r.id)) ?? (await refundIntent(stripe, owed.intentRef, r.reason ?? 'Overpayment', r.amountCents, r.id));
    await settleOwedRefund(db, tenantId, actor, r.id, ref);
    return { cents: r.amountCents, to: owed.last4 ? `the card ending ${owed.last4}` : 'the card', number: r.number };
  }
  await settleOwedRefund(db, tenantId, actor, r.id, null);
  return { cents: r.amountCents, to: null, number: r.number };
}
