/**
 * Phase 3 integration tests: cancel settles what was paid (wallet credit,
 * refund, rain check), releases the items and stops the scheduled messages;
 * reschedule moves the booking after an availability check.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { customerSchema, orderSchema, parsePreferences, productSchema, wallTimeToUtc, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb, withTenant } from '../client';
import { tenants, users } from '../schema';
import { usableCredits } from './customers';
import { listLocations } from './locations';
import { createProduct, productAvailability } from './catalog';
import { recordGatewayPayment } from './money';
import { actionNeeded } from './ops';
import {
  cancelOrder, createOrder, getOrder, markRefundSent, owedRefund, planRefund, prepareCardRefunds, refundablePayments, rescheduleOrder, resolveOverpayment,
  orderInputFrom, recordPayment, settleOwedRefund, settleStalePendingRefund, transitionOrder, updateOrder,
} from './orders';
import { setupOrganization, updatePreferences } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `p3-${run}` };
let prefs = parsePreferences({});
let tenantId = '';
let locationId = '';
let castleId = '';
let popcornId = '';
let customerId = '';

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, time: string) => wallTimeToUtc(date, time, 'America/Chicago');
const input = (date: string, extra: Partial<Record<string, unknown>> = {}): OrderInput =>
  orderSchema.parse({
    customerId, locationId, startsAt: at(date, '13:00'), endsAt: at(date, '18:00'),
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US' }, eventMiles: 18.4,
    lines: [{ productId: castleId, quantity: 1 }, { productId: popcornId, quantity: 1 }], ...extra,
  });
const messagesOf = (orderId: string) => withTenant(db, tenantId, (tx) => tx.execute<{ type: string; status: string }>(
  sql`select type, status from messages where tenant_id = ${tenantId}::uuid and order_id = ${orderId}::uuid`,
)).then((r) => [...r]);
/** A booked order with the 30% deposit ($185.43) paid by check. */
async function bookedWithDeposit(date: string) {
  const o = await createOrder(db, tenantId, actor, input(date), prefs);
  await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'check', amount: o.depositDueCents / 100 } });
  return (await getOrder(db, tenantId, o.id))!;
}

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'P3 Owner', email: `p3-${run}@example.test` });
  const t = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `p3-${run}`, name: 'P3 Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  castleId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Castle', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 1 } } }))).id;
  popcornId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Popcorn', priceStaffed: 75, baseHours: 4, inventory: { [locationId]: { owned: 5 } } }))).id;
  customerId = (await (await import('./customers')).createCustomer(db, tenantId, actor, customerSchema.parse({ firstName: 'Maria', lastName: 'G', email: `m-${run}@example.test`, address: { country: 'US' } }))).id;
  // Automations live, so scheduled messages (and the balance charge) exist to be cancelled.
  await updatePreferences(db, tenantId, actor, 'messaging', { ...prefs.messaging, live: true });
  prefs = parsePreferences((await owner.db.execute(sql`select settings from tenants where id = ${tenantId}::uuid`))[0]!.settings);
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('cancel with a money outcome', () => {
  it('acceptance 1: wallet credit + $20 goodwill → one $205.43 credit, items released, balance charge cancelled, one cancellation email', async () => {
    const date = day(40);
    const o = await bookedWithDeposit(date);
    expect(o.paidCents).toBe(18543);
    expect((await messagesOf(o.id)).some((m) => m.type === 'charge_balance' && m.status === 'queued')).toBe(true);
    const r = await cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Customer changed plans', outcome: 'wallet', amount: 185.43, goodwill: 20 });
    expect(r.order).toMatchObject({ status: 'cancelled', cancelOutcome: 'wallet', paidCents: 18543 });
    expect(r.credit).toMatchObject({ kind: 'wallet', amountCents: 20543 });
    expect(r.credit!.code).toMatch(/^WC-\d{4}$/);
    expect((await usableCredits(db, tenantId, customerId)).find((c) => c.id === r.credit!.id)?.balanceCents).toBe(20543);
    expect((await productAvailability(db, tenantId, locationId, at(date, '14:00'), at(date, '15:00')))[castleId]).toMatchObject({ free: 1 });
    const msgs = await messagesOf(o.id);
    expect(msgs.filter((m) => m.type === 'cancellation')).toHaveLength(1);
    expect(msgs.filter((m) => m.type === 'charge_balance' && m.status === 'queued')).toHaveLength(0);
  });

  it('cannot credit more than was paid, and money paid needs an outcome', async () => {
    const o = await bookedWithDeposit(day(41));
    await expect(cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Other', outcome: 'wallet', amount: 500 })).rejects.toThrow(/more than the \$185\.43 paid/);
    await expect(cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Other', outcome: 'none' })).rejects.toThrow(/Choose what happens/);
  });

  it('refund: the check is handed back, the paid amount goes to zero, a refund record is kept', async () => {
    const o = await bookedWithDeposit(day(42));
    const pays = await refundablePayments(db, tenantId, o.id);
    expect(planRefund(pays, 10000)).toMatchObject({ parts: [{ cents: 10000, gateway: 'manual', method: 'check' }], unallocatedCents: 0 });
    const r = await cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Double booking', outcome: 'refund', amount: 185.43 });
    expect(r.order).toMatchObject({ cancelOutcome: 'refund', paidCents: 0 });
    expect(r.refunds).toHaveLength(1);
    expect(r.refunds[0]).toMatchObject({ amountCents: 18543, method: 'check', gateway: 'manual' });
    expect(r.refunds[0]!.number).toMatch(/^RF-\d{4}$/);
    expect(await refundablePayments(db, tenantId, o.id)).toEqual([]);
  });

  it('card refunds are written before the gateway is asked; a retry reuses them and the cancel confirms them (QA B-15)', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(54)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { paymentFollows: true });
    await recordGatewayPayment(db, tenantId, { type: 'customer' }, o.id, { gateway: 'stripe', ref: `pi_b15_${run}`, amountCents: 10000, brand: 'visa', last4: '4242' });
    const first = await prepareCardRefunds(db, tenantId, actor, o.id, 6000, 'Cancelled');
    expect(first).toMatchObject([{ cents: 6000, intentRef: `pi_b15_${run}`, gatewayRef: null }]);
    // The gateway made it, then the cancel failed: the retry gets the same row, not a second refund.
    await markRefundSent(db, tenantId, first[0]!.id, `re_b15_${run}`);
    const again = await prepareCardRefunds(db, tenantId, actor, o.id, 6000, 'Cancelled');
    expect(again).toMatchObject([{ id: first[0]!.id, gatewayRef: `re_b15_${run}` }]);
    // While it is pending, that money cannot be planned again.
    expect((await refundablePayments(db, tenantId, o.id))[0]!.refundableCents).toBe(4000);
    const done = again.map((r) => ({ paymentId: r.paymentId, cents: r.cents, gateway: 'stripe', method: 'card', ref: r.gatewayRef, refundId: r.id }));
    const r = await cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Customer changed plans', outcome: 'refund', amount: 60 }, done);
    expect(r.refunds).toMatchObject([{ id: first[0]!.id, status: 'done', gatewayRef: `re_b15_${run}`, amountCents: 6000 }]);
    expect(r.order.paidCents).toBe(4000);
  });

  it('a card refund whose cancel never went through is recorded an hour later, and the office is told (QA B-15)', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(56)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { paymentFollows: true });
    await recordGatewayPayment(db, tenantId, { type: 'customer' }, o.id, { gateway: 'stripe', ref: `pi_stale_${run}`, amountCents: 9000, brand: 'visa', last4: '4242' });
    const [p] = await prepareCardRefunds(db, tenantId, actor, o.id, 9000, 'Cancelled');
    expect(await settleStalePendingRefund(db, tenantId, p!.id, `re_stale_${run}`)).toBe('done');
    expect((await getOrder(db, tenantId, o.id))!).toMatchObject({ status: 'booked', paidCents: 0 });
    expect((await messagesOf(o.id)).some((m) => m.type === 'payment_alert')).toBe(true);
  });

  it('"refund the overpayment" is owed on the Ops board until it is given back (QA B-16)', async () => {
    const o = await bookedWithDeposit(day(57));
    // The customer pays the whole balance by check, plus $50 too much.
    await recordPayment(db, tenantId, actor, o.id, prefs, { method: 'check', amount: (o.totalCents - o.paidCents) / 100 + 50 });
    const over = (await getOrder(db, tenantId, o.id))!;
    expect(over.paidCents - over.totalCents).toBe(5000);
    await resolveOverpayment(db, tenantId, actor, o.id, 'refund');
    const owed = await owedRefund(db, tenantId, o.id);
    expect(owed!.refund).toMatchObject({ status: 'owed', amountCents: 5000, method: 'check', gateway: 'manual' });
    const board = await actionNeeded(db, tenantId, { currency: 'USD' });
    expect(board.cards.find((c) => c.orderId === o.id && c.rule === 'refund')).toMatchObject({ action: 'refund_now' });
    await settleOwedRefund(db, tenantId, actor, owed!.refund.id, null);
    expect(await owedRefund(db, tenantId, o.id)).toBeNull();
    expect((await actionNeeded(db, tenantId, { currency: 'USD' })).cards.some((c) => c.orderId === o.id && c.rule === 'refund')).toBe(false);
    expect((await getOrder(db, tenantId, o.id))!.paidCents).toBe(over.totalCents);
  });

  it('rain check: an RC credit valid for the workspace’s months, the order shows as rained out', async () => {
    const o = await bookedWithDeposit(day(43));
    const r = await cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Weather', outcome: 'rain_check', amount: 185.43, goodwill: 10 });
    expect(r.order.cancelOutcome).toBe('rain_check');
    expect(r.credit).toMatchObject({ kind: 'rain_check', amountCents: 19543 });
    expect(r.credit!.code).toMatch(/^RC-\d{4}$/);
    expect(r.credit!.validUntil! > day(300)).toBe(true);
    expect(r.outcome).toContain(r.credit!.code);
  });
});

describe('reschedule', () => {
  it('acceptance 2: moves the booking to a free date (new version, same number); a taken date is refused', async () => {
    const o = await bookedWithDeposit(day(44));
    const taken = await bookedWithDeposit(day(45));
    await expect(rescheduleOrder(db, tenantId, actor, o.id, prefs, { startsAt: at(day(45), '13:00'), endsAt: at(day(45), '18:00') })).rejects.toThrow(/Castle/);
    const r = await rescheduleOrder(db, tenantId, actor, o.id, prefs, { startsAt: at(day(46), '13:00'), endsAt: at(day(46), '18:00'), note: 'Storm forecast' });
    expect(r.order.number).toBe(o.number);
    expect(r.order.version).toBe(o.version + 1);
    expect(r.order.eventStartsAt.toISOString()).toBe(at(day(46), '13:00').toISOString());
    const full = (await getOrder(db, tenantId, o.id))!;
    expect(full.versions[0]!.reason).toContain('Rescheduled');
    expect(taken.status).toBe('booked');
  });
});

describe('editing a booked order (Odoo: the obstacle course that came back onto an order)', () => {
  const newLine = (productId: string) => ({ productId, quantity: 1, serviceMode: 'staffed' as const, flatRate: false, taxable: true, overridePrice: null, basePrice: null, extraRate: null });

  it('swapping one item for another sticks through every later save and frees the removed item', async () => {
    const extreme = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Extreme Obstacle', priceStaffed: 500, baseHours: 4, inventory: { [locationId]: { owned: 1 } } }))).id;
    const american = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'American Obstacle', priceStaffed: 450, baseHours: 4, inventory: { [locationId]: { owned: 1 } } }))).id;
    const date = day(60);
    const o = await createOrder(db, tenantId, actor, input(date, { lines: [{ productId: extreme, quantity: 1 }, { productId: popcornId, quantity: 1 }] }), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'check', amount: o.depositDueCents / 100 } });
    const booked = (await getOrder(db, tenantId, o.id))!;
    const popcornBefore = booked.lines.find((l) => l.productId === popcornId)!;

    const swap = orderInputFrom(booked, booked.lines, []);
    swap.lines = [...swap.lines.filter((l) => l.productId !== extreme), newLine(american)];
    await updateOrder(db, tenantId, actor, o.id, swap, prefs, booked.version);

    // Saved again twice more with no edits (Payment Options, an internal note...): still swapped.
    for (let i = 0; i < 2; i++) {
      const now = (await getOrder(db, tenantId, o.id))!;
      await updateOrder(db, tenantId, actor, o.id, orderInputFrom(now, now.lines, []), prefs, now.version);
    }
    const after = (await getOrder(db, tenantId, o.id))!;
    expect(after.lines.map((l) => l.productId).sort()).toEqual([american, popcornId].sort());
    expect(after.lines.find((l) => l.productId === popcornId)!.lineTotalCents).toBe(popcornBefore.lineTotalCents);
    const held = await withTenant(db, tenantId, (tx) => tx.execute<{ product_id: string }>(sql`select product_id from reservations where tenant_id = ${tenantId}::uuid and order_id = ${o.id}::uuid`));
    expect([...held].map((r) => r.product_id).sort()).toEqual([american, popcornId].sort());
    // The Extreme is free again for the same time, the American is not.
    const avail = await productAvailability(db, tenantId, locationId, at(date, '14:00'), at(date, '15:00'));
    expect(avail[extreme]).toMatchObject({ free: 1 });
    expect(avail[american]).toMatchObject({ free: 0 });
    expect(after.versions.some((v) => Object.values(v.diff as Record<string, { from: string; to: string }>).some((c) => c.from.includes('Extreme') && !c.to.includes('Extreme')))).toBe(true);
  });

  it('a multi-day booking can be lengthened and shortened; the stock follows the new dates', async () => {
    const tent = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Frame Tent', priceStaffed: 800, baseHours: 4, inventory: { [locationId]: { owned: 1 } } }))).id;
    const start = day(70);
    const o = await createOrder(db, tenantId, actor, input(start, { multiDay: true, startsAt: at(start, '10:00'), endsAt: at(day(72), '10:00'), lines: [{ productId: tent, quantity: 1 }] }), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    const full = (await getOrder(db, tenantId, o.id))!;
    // Lengthened by two days: the tent is now busy on day 73.
    const longer = await updateOrder(db, tenantId, actor, o.id, orderInputFrom(full, full.lines, [], { endsAt: at(day(74), '10:00') }), prefs, full.version);
    expect(longer.order.eventEndsAt.toISOString()).toBe(at(day(74), '10:00').toISOString());
    expect((await productAvailability(db, tenantId, locationId, at(day(73), '12:00'), at(day(73), '13:00')))[tent]).toMatchObject({ free: 0 });
    const other = await createOrder(db, tenantId, actor, input(day(73), { lines: [{ productId: tent, quantity: 1 }] }), prefs);
    await expect(transitionOrder(db, tenantId, actor, other.id, 'book', prefs)).rejects.toThrow(/Refused/);
    // Shortened back: day 73 is free again and the other booking goes through.
    const now = (await getOrder(db, tenantId, o.id))!;
    await updateOrder(db, tenantId, actor, o.id, orderInputFrom(now, now.lines, [], { endsAt: at(day(72), '10:00') }), prefs, now.version);
    await transitionOrder(db, tenantId, actor, other.id, 'book', prefs);
  });
});

describe('rain checks', () => {
  it('a rain check is spent in full on a bigger order, and what is left of a bigger rain check stays for next time', async () => {
    const first = await bookedWithDeposit(day(80)); // $185.43 paid
    const rc = (await cancelOrder(db, tenantId, actor, first.id, prefs, { reason: 'Weather', outcome: 'rain_check', amount: 185.43 })).credit!;
    // Applied in full to a $618 order.
    const next = await createOrder(db, tenantId, actor, input(day(81), { credits: [{ creditId: rc.id, amount: 185.43 }] }), prefs);
    expect(next.creditCents).toBe(18543);
    expect((await usableCredits(db, tenantId, customerId)).find((c) => c.id === rc.id)).toBeUndefined();

    // A $300 rain check on an $81 popcorn-only order: $81 is used, the rest stays on the customer.
    const second = await bookedWithDeposit(day(82));
    await recordPayment(db, tenantId, actor, second.id, prefs, { method: 'cash', amount: 300 - 185.43 });
    const big = (await cancelOrder(db, tenantId, actor, second.id, prefs, { reason: 'Weather', outcome: 'rain_check', amount: 300 })).credit!;
    const small = await createOrder(db, tenantId, actor, input(day(83), { lines: [{ productId: popcornId, quantity: 1 }], credits: [{ creditId: big.id, amount: 300 }] }), prefs);
    expect(small.totalCents).toBe(0);
    const left = (await usableCredits(db, tenantId, customerId)).find((c) => c.id === big.id)!;
    expect(left.balanceCents).toBe(30000 - small.creditCents);
  });

  it('an expired rain check cannot be used', async () => {
    const o = await bookedWithDeposit(day(84));
    const rc = (await cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Weather', outcome: 'rain_check', amount: 185.43 })).credit!;
    await owner.db.execute(sql`update credits set valid_until = '2020-01-01' where tenant_id = ${tenantId}::uuid and id = ${rc.id}::uuid`);
    await expect(createOrder(db, tenantId, actor, input(day(85), { credits: [{ creditId: rc.id, amount: 10 }] }), prefs)).rejects.toThrow(/no longer available/);
  });
});
