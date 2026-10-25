import { and, asc, desc, eq, gte, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { addDays, parsePreferences, resolveAgreement, utcToWallTime, type SignInput, type TenantPreferences } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { customers, invoices, locations, orders, paymentMethods, payments, signatures, tenants } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';
import { enqueueOrderMessage } from './messaging';
import { nextDocumentNumber } from './orders';

export type Invoice = typeof invoices.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type Signature = typeof signatures.$inferSelect;

async function prefsOf(tx: Tx, tenantId: string): Promise<TenantPreferences> {
  const [t] = await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return parsePreferences(t?.s);
}

/** Invoices of one order in billing order (they are often created in the same instant). */
export const billingOrder = sql`case ${invoices.kind} when 'deposit' then 0 when 'full' then 1 when 'balance' then 2 else 3 end`;

/** Today's date in a location's time zone. */
const localToday = (tz: string) => utcToWallTime(new Date(), tz).date;

/**
 * Bring an order's invoices in line with the order (idempotent; run after any
 * change). Booked orders get a deposit invoice (if any deposit) and a balance
 * invoice due on the event day — or one full invoice when there is no deposit.
 * Payments are applied oldest invoice first. Cancelled orders void what is unpaid.
 */
export async function syncInvoices(tx: Tx, tenantId: string, orderId: string) {
  const [row] = await tx
    .select({ order: orders, tz: locations.timezone })
    .from(orders)
    .innerJoin(locations, and(eq(locations.tenantId, orders.tenantId), eq(locations.id, orders.locationId)))
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  if (!row) return [];
  const { order: o, tz } = row;
  const existing = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, orderId), ne(invoices.kind, 'tip')))
    .orderBy(billingOrder, asc(invoices.createdAt));
  const live = existing.filter((i) => i.status !== 'void');

  if (o.status === 'cancelled' || o.status === 'draft' || o.status === 'quote_sent') {
    // Nothing is owed on an order that is not booked: void whatever has not been paid.
    for (const i of live.filter((x) => x.paidCents === 0)) {
      await tx.update(invoices).set({ status: 'void' }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, i.id)));
    }
    return tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, orderId)));
  }

  const prefs = await prefsOf(tx, tenantId);
  const eventDay = utcToWallTime(o.eventStartsAt, tz).date;
  const bookedDay = o.bookedAt ? utcToWallTime(o.bookedAt, tz).date : localToday(tz);
  const [card] = await tx
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.customerId, o.customerId), isNull(paymentMethods.removedAt)))
    .limit(1);
  const make = async (kind: 'deposit' | 'balance' | 'full', amountCents: number, dueOn: string) => {
    const number = await nextDocumentNumber(tx, 'invoice', prefs, o.locationId);
    const [inv] = await tx
      .insert(invoices)
      .values({ tenantId, orderId, number, kind, amountCents, dueOn, autoCharge: kind !== 'deposit' && !!card })
      .returning();
    return inv!;
  };

  let deposit = live.find((i) => i.kind === 'deposit');
  let rest = live.find((i) => i.kind === 'balance' || i.kind === 'full');
  if (!deposit && !rest && o.depositDueCents > 0) deposit = await make('deposit', o.depositDueCents, bookedDay);
  // An unpaid deposit follows the order's deposit; once anything is paid on it, it stays as issued.
  if (deposit && deposit.paidCents === 0 && deposit.amountCents !== o.depositDueCents && o.depositDueCents > 0) {
    [deposit] = await tx.update(invoices).set({ amountCents: o.depositDueCents }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, deposit.id))).returning();
  }
  const restAmount = Math.max(0, o.totalCents - (deposit?.amountCents ?? 0));
  if (!rest) rest = await make(deposit ? 'balance' : 'full', restAmount, eventDay);
  else if (rest.amountCents !== restAmount || rest.dueOn !== eventDay) {
    [rest] = await tx.update(invoices).set({ amountCents: restAmount, dueOn: eventDay }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, rest.id))).returning();
  }

  // Apply what the customer paid (tips excluded), oldest invoice first.
  const [{ tips } = { tips: 0 }] = await tx
    .select({ tips: sql<number>`coalesce(sum(${payments.tipCents}), 0)::int` })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId), eq(payments.status, 'received')));
  let left = Math.max(0, o.paidCents - tips);
  const today = localToday(tz);
  for (const inv of [deposit, rest].filter(Boolean) as Invoice[]) {
    const paid = Math.min(inv.amountCents, left);
    left -= paid;
    const settled = paid >= inv.amountCents;
    const status = settled ? 'paid' : inv.dueOn < today || inv.lastChargeError ? 'overdue' : 'open';
    if (paid !== inv.paidCents || status !== inv.status) {
      await tx
        .update(invoices)
        .set({ paidCents: paid, status, paidAt: settled ? (inv.paidAt ?? new Date()) : null, ...(settled ? { lastChargeError: null } : {}) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, inv.id)));
    }
  }
  return tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, orderId))).orderBy(billingOrder, asc(invoices.createdAt));
}

/** Run syncInvoices in its own transaction (after actions outside one). */
export function syncOrderInvoices(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, (tx) => syncInvoices(tx, tenantId, orderId));
}

/** One-off: invoices for every booked order that has none (orders booked before invoices existed). */
export function backfillInvoices(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const missing = await tx.execute<{ id: string }>(sql`
      select o.id from orders o where o.tenant_id = ${tenantId}::uuid and o.status in ('booked','completed')
        and not exists (select 1 from invoices i where i.tenant_id = o.tenant_id and i.order_id = o.id)`);
    for (const m of missing) await syncInvoices(tx, tenantId, m.id);
    return [...missing].length;
  });
}

// --- invoices screen --------------------------------------------------------------------------------

export type InvoiceFilter = 'all' | 'open' | 'overdue' | 'paid';

export function listInvoices(db: Db, tenantId: string, opts: { filter?: InvoiceFilter; search?: string; limit?: number } = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const f = opts.filter ?? 'all';
    const conds: (SQL | undefined)[] = [
      eq(invoices.tenantId, tenantId),
      ne(invoices.status, 'void'),
      f === 'open' ? eq(invoices.status, 'open') : f === 'overdue' ? eq(invoices.status, 'overdue') : f === 'paid' ? eq(invoices.status, 'paid') : undefined,
      opts.search ? sql`(${invoices.number} ilike ${`%${opts.search}%`} or ${orders.number} ilike ${`%${opts.search}%`} or ${customers.displayName} ilike ${`%${opts.search}%`})` : undefined,
    ];
    const rows = await tx
      .select({ inv: invoices, orderNumber: orders.number, orderStatus: orders.status, customerName: customers.displayName, customerId: customers.id })
      .from(invoices)
      .innerJoin(orders, and(eq(orders.tenantId, invoices.tenantId), eq(orders.id, invoices.orderId)))
      .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
      .where(and(...conds))
      .orderBy(desc(invoices.createdAt))
      .limit(opts.limit ?? 300);
    const [counts] = await tx
      .select({
        all: sql<number>`(count(*) filter (where ${invoices.status} <> 'void'))::int`,
        open: sql<number>`(count(*) filter (where ${invoices.status} = 'open'))::int`,
        overdue: sql<number>`(count(*) filter (where ${invoices.status} = 'overdue'))::int`,
        paid: sql<number>`(count(*) filter (where ${invoices.status} = 'paid'))::int`,
        outstanding: sql<string>`coalesce(sum(${invoices.amountCents} - ${invoices.paidCents}) filter (where ${invoices.status} in ('open','overdue')), 0)::text`,
        overdueCents: sql<string>`coalesce(sum(${invoices.amountCents} - ${invoices.paidCents}) filter (where ${invoices.status} = 'overdue'), 0)::text`,
        autoWeek: sql<string>`coalesce(sum(${invoices.amountCents} - ${invoices.paidCents}) filter (where ${invoices.status} = 'open' and ${invoices.autoCharge} and ${invoices.dueOn} < current_date + 7), 0)::text`,
      })
      .from(invoices)
      .where(eq(invoices.tenantId, tenantId));
    const [collected] = await tx
      .select({ cents: sql<string>`coalesce(sum(${payments.amountCents} + ${payments.tipCents}), 0)::text` })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.status, 'received'), gte(payments.receivedAt, sql`date_trunc('month', now())`)));
    return {
      rows: rows.map((r) => ({ ...r.inv, orderNumber: r.orderNumber, orderStatus: r.orderStatus, customerName: r.customerName ?? '', customerId: r.customerId })),
      counts: { all: counts!.all, open: counts!.open, overdue: counts!.overdue, paid: counts!.paid },
      kpis: { outstanding: Number(counts!.outstanding), overdue: Number(counts!.overdueCents), autoChargesWeek: Number(counts!.autoWeek), collectedMonth: Number(collected!.cents) },
    };
  });
}

export function getInvoice(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id))).limit(1);
    if (!inv) return null;
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, inv.orderId))).limit(1);
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, order!.customerId))).limit(1);
    const [loc] = await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, order!.locationId))).limit(1);
    const lines = await tx.execute<{ name: string; quantity: number; service_mode: string; line_total_cents: string }>(
      sql`select name, quantity, service_mode, line_total_cents::text from order_lines where tenant_id = ${tenantId}::uuid and order_id = ${inv.orderId}::uuid order by sort`,
    );
    const schedule = await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, inv.orderId), ne(invoices.status, 'void'))).orderBy(billingOrder, asc(invoices.createdAt));
    const pays = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, inv.orderId))).orderBy(asc(payments.receivedAt));
    const [card] = await tx
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.customerId, customer!.id), isNull(paymentMethods.removedAt)))
      .orderBy(desc(paymentMethods.createdAt))
      .limit(1);
    return { invoice: inv, order: order!, customer: customer!, location: loc!, lines: [...lines], schedule, payments: pays, card: card ?? null };
  });
}
export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

/** One order's invoices in billing order (the order screen). */
export function orderInvoices(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, orderId), ne(invoices.status, 'void'))).orderBy(billingOrder, asc(invoices.createdAt)),
  );
}

export function setAutoCharge(db: Db, tenantId: string, actor: Actor, id: string, on: boolean) {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.update(invoices).set({ autoCharge: on }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id))).returning();
    if (!inv) throw new OrgError('Invoice not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'order', id: inv.orderId }, 'invoice.auto_charge', { number: inv.number, on });
    return inv;
  });
}

/** Email an invoice (staff action: always sent). */
export function emailInvoice(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id))).limit(1);
    if (!inv) throw new OrgError('Invoice not found.', 'not_found');
    const msg = await enqueueOrderMessage(tx, tenantId, inv.orderId, 'invoice', `${inv.id}:invoice:${Date.now()}`, {
      automatic: false, meta: { invoiceNumber: inv.number, invoiceAmountCents: inv.amountCents - inv.paidCents },
    });
    await tx.update(invoices).set({ sentAt: new Date() }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
    await audit(tx, tenantId, actor, { type: 'order', id: inv.orderId }, 'invoice.emailed', { number: inv.number });
    return { invoice: inv, message: msg };
  });
}

export function listPayments(db: Db, tenantId: string, opts: { limit?: number } = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({ p: payments, orderNumber: orders.number, customerName: customers.displayName, invoiceNumber: invoices.number })
      .from(payments)
      .innerJoin(orders, and(eq(orders.tenantId, payments.tenantId), eq(orders.id, payments.orderId)))
      .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
      .leftJoin(invoices, and(eq(invoices.tenantId, payments.tenantId), eq(invoices.id, payments.invoiceId)))
      .where(eq(payments.tenantId, tenantId))
      .orderBy(desc(payments.receivedAt))
      .limit(opts.limit ?? 300);
    return rows.map((r) => ({ ...r.p, orderNumber: r.orderNumber, customerName: r.customerName ?? '', invoiceNumber: r.invoiceNumber }));
  });
}

// --- saved cards ------------------------------------------------------------------------------------

export function savedCard(db: Db, tenantId: string, customerId: string, gateway?: 'stripe' | 'ipos') {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.customerId, customerId), isNull(paymentMethods.removedAt), gateway ? eq(paymentMethods.gateway, gateway) : undefined))
      .orderBy(desc(paymentMethods.createdAt))
      .limit(1);
    return c ?? null;
  });
}

export async function saveCardTx(
  tx: Tx, tenantId: string,
  c: { customerId: string; gateway: 'stripe' | 'ipos'; gatewayCustomerId: string | null; gatewayMethodId: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null },
) {
  const [row] = await tx
    .insert(paymentMethods)
    .values({ tenantId, ...c, consentAt: new Date() })
    .onConflictDoUpdate({ target: [paymentMethods.tenantId, paymentMethods.gateway, paymentMethods.gatewayMethodId], set: { removedAt: null, consentAt: new Date() } })
    .returning();
  // A newly saved card switches on auto-charge for this customer's open balances.
  await tx.execute(sql`update invoices i set auto_charge = true from orders o
    where i.tenant_id = ${tenantId}::uuid and o.tenant_id = i.tenant_id and o.id = i.order_id and o.customer_id = ${c.customerId}::uuid
      and i.kind in ('balance','full') and i.status in ('open','overdue')`);
  return row!;
}

// --- gateway payments ---------------------------------------------------------------------------------

export type GatewayPayment = {
  gateway: 'stripe' | 'ipos'; ref: string; amountCents: number; tipCents?: number; brand?: string | null; last4?: string | null;
  steps?: Record<string, string>; note?: string | null;
  /** false when the caller sends its own receipt (the event-day charge email). */
  receipt?: boolean;
};

/**
 * Record money a gateway took (idempotent on the gateway's id: a retried webhook
 * or a double click never records it twice). Applies it to the order and its
 * invoices and queues the receipt.
 */
export function recordGatewayPayment(db: Db, tenantId: string, actor: Actor, orderId: string, p: GatewayPayment) {
  return withTenant(db, tenantId, async (tx) => {
    const [dupe] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.gatewayRef, p.ref))).limit(1);
    if (dupe) return { payment: dupe, duplicate: true };
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).for('update').limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    const prefs = await prefsOf(tx, tenantId);
    const [openInv] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, orderId), inArray(invoices.status, ['open', 'overdue'])))
      .orderBy(billingOrder, asc(invoices.createdAt))
      .limit(1);
    const number = await nextDocumentNumber(tx, 'receipt', prefs, order.locationId);
    const [pay] = await tx
      .insert(payments)
      .values({
        tenantId, number, orderId, method: 'card', amountCents: p.amountCents, tipCents: p.tipCents ?? 0, invoiceId: openInv?.id ?? null, gateway: p.gateway,
        gatewayRef: p.ref, cardBrand: p.brand ?? null, cardLast4: p.last4 ?? null, steps: p.steps ?? {}, note: p.note ?? null, createdByUserId: actor.userId ?? null,
      })
      .returning();
    await tx
      .update(orders)
      .set({ paidCents: order.paidCents + p.amountCents, unpaidReason: null, expectedPaymentOn: null, version: order.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
    await syncInvoices(tx, tenantId, orderId);
    await audit(tx, tenantId, actor, { type: 'order', id: orderId }, 'order.payment', {
      number: order.number, payment: number, cents: p.amountCents, gateway: p.gateway, card: p.last4 ? `${p.brand} •${p.last4}` : null,
    });
    if (p.receipt !== false) await enqueueOrderMessage(tx, tenantId, orderId, 'receipt', `${pay!.id}:receipt`, { automatic: true, meta: { paymentId: pay!.id } });
    return { payment: pay!, duplicate: false };
  });
}

/** A failed charge: the invoice goes overdue, the customer gets a pay link, the office an alert. */
export function recordChargeFailure(db: Db, tenantId: string, orderId: string, invoiceId: string | null, reason: string) {
  return withTenant(db, tenantId, async (tx) => {
    if (invoiceId) {
      await tx
        .update(invoices)
        .set({ status: 'overdue', lastChargeAt: new Date(), lastChargeError: reason.slice(0, 300) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
    }
    const [inv] = invoiceId ? await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId))).limit(1) : [];
    const meta = { reason, invoiceNumber: inv?.number, invoiceAmountCents: inv ? inv.amountCents - inv.paidCents : undefined };
    const day = new Date().toISOString().slice(0, 10);
    await enqueueOrderMessage(tx, tenantId, orderId, 'card_declined', `${orderId}:card_declined:email:${day}`, { automatic: true, meta });
    await enqueueOrderMessage(tx, tenantId, orderId, 'card_declined', `${orderId}:card_declined:sms:${day}`, { automatic: true, meta, channel: 'sms' });
    const { enqueueOfficeAlert } = await import('./messaging');
    await enqueueOfficeAlert(tx, tenantId, 'declined_alert', `${orderId}:declined_alert:${day}`, orderId, meta);
    await audit(tx, tenantId, { type: 'system' }, { type: 'order', id: orderId }, 'order.charge_failed', { reason, invoice: inv?.number });
  });
}

// --- signatures ------------------------------------------------------------------------------------------

export function latestSignature(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [s] = await tx
      .select()
      .from(signatures)
      .where(and(eq(signatures.tenantId, tenantId), eq(signatures.orderId, orderId)))
      .orderBy(desc(signatures.signedAt))
      .limit(1);
    return s ?? null;
  });
}

export function signAgreement(db: Db, tenantId: string, orderId: string, input: SignInput, meta: { ip: string | null; userAgent: string | null }) {
  return withTenant(db, tenantId, async (tx) => {
    const prefs = await prefsOf(tx, tenantId);
    const a = resolveAgreement(prefs.agreement);
    const missing = a.policies.filter((p) => p.key !== 'waiver' && !input.policies[p.key]);
    if (missing.length) throw new OrgError(`Please accept: ${missing.map((p) => p.title).join(', ')}.`, 'invalid');
    const now = new Date().toISOString();
    // Only this agreement's policies go on the record (the page also sends its own markers).
    const keys = new Set(a.policies.map((p) => p.key));
    const [s] = await tx
      .insert(signatures)
      .values({
        tenantId, orderId, agreementVersion: a.version, agreementText: `${a.title}\n\n${a.body}`, typedName: input.typedName,
        policies: Object.fromEntries(Object.entries(input.policies).filter(([k, v]) => v && keys.has(k)).map(([k]) => [k, now])),
        waiverAccepted: input.waiverAccepted, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null,
      })
      .returning();
    await audit(tx, tenantId, { type: 'customer' }, { type: 'order', id: orderId }, 'order.signed', { name: input.typedName, version: a.version });
    return s!;
  });
}

/** Rain checks issued for weather cancellations stay valid this long (Rental rules / agreement). */
export const rainCheckUntil = (prefs: TenantPreferences, from = new Date()) => addDays(from.toISOString().slice(0, 10), prefs.agreement.rainCheckMonths * 30);

// --- quote page ---------------------------------------------------------------------------------------

/** Everything the customer's quote page shows, read inside the order's workspace. */
export function quoteContext(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).limit(1);
    if (!order) return null;
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, order.customerId))).limit(1);
    const [location] = await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, order.locationId))).limit(1);
    const lines = await tx.execute<{ product_id: string | null; name: string; quantity: number; service_mode: string; unit_cents: string; line_total_cents: string; icon: string | null; tint: string | null; kind: string | null }>(sql`
      select l.product_id, l.name, l.quantity, l.service_mode, l.unit_cents::text, l.line_total_cents::text, p.icon, p.tint, p.kind
      from order_lines l left join products p on p.tenant_id = l.tenant_id and p.id = l.product_id
      where l.tenant_id = ${tenantId}::uuid and l.order_id = ${orderId}::uuid order by l.sort`);
    const inv = await tx.select().from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, orderId), ne(invoices.status, 'void'))).orderBy(billingOrder);
    const pays = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId), eq(payments.status, 'received'))).orderBy(asc(payments.receivedAt));
    const [sig] = await tx.select().from(signatures).where(and(eq(signatures.tenantId, tenantId), eq(signatures.orderId, orderId))).orderBy(desc(signatures.signedAt)).limit(1);
    const [card] = await tx
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.customerId, order.customerId), isNull(paymentMethods.removedAt)))
      .orderBy(desc(paymentMethods.createdAt))
      .limit(1);
    return { order, tenant: tenant!, prefs: parsePreferences(tenant!.settings), customer: customer!, location: location!, lines: [...lines], invoices: inv, payments: pays, signature: sig ?? null, card: card ?? null };
  });
}
export type QuoteContext = NonNullable<Awaited<ReturnType<typeof quoteContext>>>;
