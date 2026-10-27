/**
 * Phase 2b integration tests: invoices follow the order, payments apply oldest
 * first, gateway payments are idempotent, signatures need every policy.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { customerSchema, orderSchema, parsePreferences, productSchema, wallTimeToUtc, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { tenants, users } from '../schema';
import { createProduct } from './catalog';
import { createCustomer } from './customers';
import { listLocations } from './locations';
import { latestSignature, listInvoices, recordGatewayPayment, saveCardTx, signAgreement, syncOrderInvoices } from './money';
import { createOrder, getOrder, orderInputFrom, recordPayment, recordTip, transitionOrder, updateOrder } from './orders';
import { setupOrganization } from './organizations';
import { withTenant } from '../client';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `p2b-${run}` };
const prefs = parsePreferences({});
let tenantId = '';
let locationId = '';
let castleId = '';
let popcornId = '';
let customerId = '';

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const input = (date: string, extra: Partial<Record<string, unknown>> = {}): OrderInput =>
  orderSchema.parse({
    customerId, locationId, startsAt: wallTimeToUtc(date, '13:00', 'America/Chicago'), endsAt: wallTimeToUtc(date, '18:00', 'America/Chicago'),
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US' }, eventMiles: 18.4,
    lines: [{ productId: castleId, quantity: 1 }, { productId: popcornId, quantity: 1 }], ...extra,
  });
const invoicesOf = async (orderId: string) => (await getOrderInvoices(orderId)).filter((i) => i.status !== 'void');
const getOrderInvoices = (orderId: string) => withTenant(db, tenantId, (tx) => tx.execute<{ kind: string; amount_cents: string; paid_cents: string; status: string; due_on: string }>(
  sql`select kind, amount_cents::text, paid_cents::text, status, due_on::text from invoices where tenant_id = ${tenantId}::uuid and order_id = ${orderId}::uuid order by case kind when 'deposit' then 0 when 'full' then 1 when 'balance' then 2 else 3 end`,
)).then((r) => [...r].map((x) => ({ kind: x.kind, amount: Number(x.amount_cents), paid: Number(x.paid_cents), status: x.status, dueOn: x.due_on })));

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'P2b Owner', email: `p2b-${run}@example.test` });
  const t = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `p2b-${run}`, name: 'P2b Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  castleId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Castle', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 5 } } }))).id;
  popcornId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Popcorn', priceStaffed: 75, baseHours: 4, inventory: { [locationId]: { owned: 5 } } }))).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({ firstName: 'Maria', lastName: 'G', email: `m-${run}@example.test`, address: { country: 'US' } }))).id;
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('invoices', () => {
  it('booking creates the deposit and the balance due on the event day; payments apply oldest first', async () => {
    const event = day(30);
    const o = await createOrder(db, tenantId, actor, input(event), prefs);
    expect(o.totalCents).toBe(61811);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'check', amount: 185.43 } });
    expect(await invoicesOf(o.id)).toMatchObject([
      { kind: 'deposit', amount: 18543, paid: 18543, status: 'paid' },
      { kind: 'balance', amount: 43268, paid: 0, status: 'open', dueOn: event },
    ]);
    await recordPayment(db, tenantId, actor, o.id, prefs, { method: 'cash', amount: 100 });
    expect((await invoicesOf(o.id))[1]).toMatchObject({ paid: 10000, status: 'open' });
  });

  it('editing a booked order re-sizes the balance; cancelling voids what is unpaid', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(31)), prefs);
    const { order: booked } = await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: 185.43 } });
    const full = await getOrder(db, tenantId, o.id);
    const bigger = orderInputFrom(full!, full!.lines, [], { lines: [...input(day(31)).lines, { productId: popcornId, quantity: 1, serviceMode: 'staffed', flatRate: false, overridePrice: null, basePrice: null, extraRate: null, taxable: true }] });
    const saved = await updateOrder(db, tenantId, actor, o.id, bigger, prefs, booked.version);
    const inv = await invoicesOf(o.id);
    expect(inv[0]).toMatchObject({ kind: 'deposit', amount: 18543 }); // a paid deposit stays as issued
    expect(inv[1]!.amount).toBe(saved.order.totalCents - 18543);
    await transitionOrder(db, tenantId, actor, o.id, 'cancel', prefs);
    expect((await invoicesOf(o.id)).map((i) => i.kind)).toEqual(['deposit']); // the paid deposit is kept, the balance voided
  });

  it('no deposit → one full invoice', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(32), { deposit: { kind: 'none', value: 0 } }), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    expect(await invoicesOf(o.id)).toMatchObject([{ kind: 'full', amount: o.totalCents, status: 'open' }]);
  });

  it('orderInputFrom round-trips: saving it unchanged keeps the total', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(33), { discount: { kind: 'percent', value: 5 } }), prefs);
    const full = await getOrder(db, tenantId, o.id);
    const again = await updateOrder(db, tenantId, actor, o.id, orderInputFrom(full!, full!.lines, []), prefs, full!.version);
    expect(again.order.totalCents).toBe(o.totalCents);
    expect(again.changed).toBe(0);
  });
});

describe('gateway payments and cards', () => {
  it('records a card payment once, however many times the gateway reports it', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(34)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    const p = { gateway: 'stripe' as const, ref: `pi_test_${run}`, amountCents: 18543, brand: 'visa', last4: '4242', steps: { authorizedAt: new Date().toISOString() } };
    const first = await recordGatewayPayment(db, tenantId, { type: 'customer' }, o.id, p);
    const second = await recordGatewayPayment(db, tenantId, { type: 'customer' }, o.id, p);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect((await getOrder(db, tenantId, o.id))!.paidCents).toBe(18543);
    expect((await invoicesOf(o.id))[0]).toMatchObject({ kind: 'deposit', status: 'paid' });
  });

  it('saving a card switches on auto-charge for open balances', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(35)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    await withTenant(db, tenantId, (tx) => saveCardTx(tx, tenantId, { customerId, gateway: 'stripe', gatewayCustomerId: 'cus_x', gatewayMethodId: `pm_${run}`, brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }));
    const list = await listInvoices(db, tenantId, { filter: 'open' });
    expect(list.rows.filter((i) => i.orderId === o.id && i.kind === 'balance').every((i) => i.autoCharge)).toBe(true);
    expect(list.kpis.outstanding).toBeGreaterThan(0);
    await syncOrderInvoices(db, tenantId, o.id); // idempotent
    expect((await invoicesOf(o.id)).length).toBe(2);
  });
});

describe('Collect Tip', () => {
  it('a tip on its own after booking: a receipt with no amount, the order and its invoices unchanged', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(36)), prefs);
    await expect(recordTip(db, tenantId, actor, o.id, prefs, { method: 'cash', tip: 20 })).rejects.toThrow(/once the order is booked/);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'check', amount: 185.43 } });
    const before = await invoicesOf(o.id);
    const t = await recordTip(db, tenantId, actor, o.id, prefs, { method: 'venmo', tip: 25, reference: '@maria' });
    expect(t.payment).toMatchObject({ amountCents: 0, tipCents: 2500, method: 'venmo', invoiceId: null });
    const after = (await getOrder(db, tenantId, o.id))!;
    expect(after.paidCents).toBe(18543);
    expect(after.versions[0]!.action).toBe('tip');
    expect(await invoicesOf(o.id)).toEqual(before);
    // A card tip through the gateway: no amount, no invoice, no payment confirmation email.
    const g = await recordGatewayPayment(db, tenantId, actor, o.id, { gateway: 'stripe', ref: `pi_tip_${run}`, amountCents: 0, tipCents: 1500, brand: 'visa', last4: '4242' });
    expect(g.payment).toMatchObject({ amountCents: 0, tipCents: 1500, invoiceId: null });
    const mails = await owner.db.execute<{ n: number }>(sql`select count(*)::int as n from messages where tenant_id = ${tenantId}::uuid and order_id = ${o.id}::uuid and meta->>'paymentId' = ${g.payment.id}`);
    expect([...mails][0]!.n).toBe(0);
    await expect(recordTip(db, tenantId, actor, o.id, prefs, { method: 'cash', tip: 0 })).rejects.toThrow(/tip amount/);
  });
});

describe('signatures', () => {
  it('needs every policy, stores the exact text, version, IP and browser', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(36)), prefs);
    const base = { typedName: 'Maria Gonzalez', consent: true as const, waiverAccepted: true };
    await expect(signAgreement(db, tenantId, o.id, { ...base, policies: { weather: true } }, { ip: '1.2.3.4', userAgent: 'test' })).rejects.toThrow(/Setup & electricity/);
    // The quote page also sends its own marker (__waiverChosen); only real policies are recorded.
    await signAgreement(db, tenantId, o.id, { ...base, policies: { weather: true, setup: true, supervise: true, __waiverChosen: true } }, { ip: '1.2.3.4', userAgent: 'test' });
    const s = await latestSignature(db, tenantId, o.id);
    expect(s).toMatchObject({ typedName: 'Maria Gonzalez', agreementVersion: '2026-10', ip: '1.2.3.4', waiverAccepted: true });
    expect(s!.agreementText).toContain('Terms of rental');
    expect(Object.keys(s!.policies as object).sort()).toEqual(['setup', 'supervise', 'weather']);
  });
});
