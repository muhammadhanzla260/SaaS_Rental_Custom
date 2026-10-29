/**
 * Phase 1 integration tests: catalog, customers, orders, pricing, credits and
 * stock holds, against the real database as the restricted runtime role.
 * Mirrors the design's acceptance tests (handoff docs/02-booking-and-catalog.md).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { creditSchema, customerSchema, orderSchema, parsePreferences, productSchema, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { coupons, tenants, users } from '../schema';
import {
  addUnit, createCategory, createProduct, deleteCategory, duplicateProduct, updateProduct, getProduct, inventoryOverview, listCategories, listProducts, productAvailability, setUnitStatus,
} from './catalog';
import { createCredit, createCustomer, getCustomer, importCustomers, listCustomers, usableCredits, voidCredit } from './customers';
import { listLocations } from './locations';
import {
  createOrder, getOrder, listOrders, orderInputFrom, orderStats, previewOrder, recordPayment, resolveOverpayment, transitionOrder, updateOrder, validateCoupon,
} from './orders';
import { setupOrganization } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 6 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `p1-${run}` };
const prefs = parsePreferences({});

let tenantId = '';
let locationId = '';
let castleId = '';
let popcornId = '';
let screenId = '';
let ledId = '';
let attendantId = '';
let customerId = '';
let exemptId = '';

// Austin wall time (CST, UTC-6 in November)
const t = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 10, day, hour + 6, min));

type LineIn = { productId?: string | null; quantity?: number; serviceMode?: string; name?: string; overridePrice?: number; taxable?: boolean; basePrice?: number; extraRate?: number };
const orderInput = (start: Date, end: Date, lines: LineIn[], extra: Partial<Record<string, unknown>> = {}): OrderInput =>
  orderSchema.parse({
    customerId,
    locationId,
    startsAt: start,
    endsAt: end,
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US', lat: 30.2747, lng: -97.7404 },
    lines: lines.map((l) => ({ productId: l.productId ?? null, quantity: l.quantity ?? 1, serviceMode: l.serviceMode ?? 'staffed', name: l.name, overridePrice: l.overridePrice, taxable: l.taxable, basePrice: l.basePrice, extraRate: l.extraRate })),
    ...extra,
  });

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'P1 Owner', email: `p1-${run}@example.test` });
  const tenant = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `p1-${run}`,
    name: 'P1 Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.2692, lng: -97.7428 } },
    taxPercent: 8.25,
  });
  tenantId = tenant.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  const cat = await createCategory(db, tenantId, actor, 'Bounce houses');
  const stock = (owned: number, extra = {}) => ({ [locationId]: { owned, ...extra } });
  castleId = (await createProduct(db, tenantId, actor, productSchema.parse({
    name: 'Castle Bounce House', categoryId: cat.id, priceStaffed: 225, pricePickup: 175, priceDropoff: 195, baseHours: 4, inventory: stock(2),
  }))).id;
  popcornId = (await createProduct(db, tenantId, actor, productSchema.parse({
    name: 'Popcorn Machine', kind: 'addon', priceStaffed: 75, pricePickup: 60, priceDropoff: 60, baseHours: 4, inventory: stock(3),
  }))).id;
  screenId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: '40ft Movie Screen', priceStaffed: 650 }))).id; // no stock row: 1 unit, like Odoo
  ledId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'LED Screen 12 ft', tracking: 'serialized', priceStaffed: 650, baseHours: 4 }))).id;
  attendantId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Attendant (per hour)', kind: 'service', priceStaffed: 35, hourlyRate: 35 }))).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({
    firstName: 'Maria', lastName: 'Gonzalez', email: `maria-${run}@example.test`, phone: '512-555-0142', address: { country: 'US' },
  }))).id;
  exemptId = (await createCustomer(db, tenantId, actor, customerSchema.parse({
    kind: 'organization', companyName: 'Oak Hill Elementary', email: `pta-${run}@example.test`, taxExempt: true, tags: ['School'], address: { country: 'US' },
  }))).id;
  await owner.db.insert(coupons).values({ tenantId, code: 'FALL10', kind: 'percent', value: 10, maxUses: 1 });
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('catalog and customers', () => {
  it('stores prices in cents, stock per location, and counts categories', async () => {
    const p = await getProduct(db, tenantId, castleId);
    expect(p).toMatchObject({ priceStaffedCents: 22500, pricePickupCents: 17500, baseHours: 4, fromCents: 17500, inventory: { [locationId]: { owned: 2, outOfService: 0 } } });
    expect((await listProducts(db, tenantId)).map((x) => x.name)).toContain('Popcorn Machine');
    expect((await listCategories(db, tenantId))[0]).toMatchObject({ name: 'Bounce houses', count: 1 });
  });
  it('removing a category keeps its products, uncategorized', async () => {
    const cat = await createCategory(db, tenantId, actor, 'Seasonal');
    const p = await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Snow Machine', categoryId: cat.id, priceStaffed: 249 }));
    await deleteCategory(db, tenantId, actor, cat.id);
    expect(await getProduct(db, tenantId, p.id)).toMatchObject({ name: 'Snow Machine', categoryId: null });
  });
  it('duplicates a product as a draft with its stock settings', async () => {
    const copy = await duplicateProduct(db, tenantId, actor, castleId);
    expect(copy).toMatchObject({ name: 'Castle Bounce House (copy)', status: 'draft' });
    expect((await getProduct(db, tenantId, copy.id))!.inventory[locationId]!.owned).toBe(2);
  });
  it('finds customers, filters people vs organizations, and imports CSV rows', async () => {
    expect((await listCustomers(db, tenantId, { search: 'gonz' })).rows[0]?.displayName).toBe('Maria Gonzalez');
    expect((await listCustomers(db, tenantId, { search: '5550142' })).rows[0]?.id).toBe(customerId);
    const orgs = await listCustomers(db, tenantId, { filter: 'organizations' });
    expect(orgs.rows.map((r) => r.displayName)).toEqual(['Oak Hill Elementary']);
    const res = await importCustomers(db, tenantId, actor, [
      { firstName: 'Jason', lastName: 'Lee', email: `jason-${run}@example.test`, address: { country: 'US' } },
      { firstName: 'Dup', email: `maria-${run}@example.test`, address: { country: 'US' } },
      { firstName: 'NoContact', address: { country: 'US' } },
    ]);
    expect(res.created).toBe(1);
    expect(res.skipped.map((s) => s.row)).toEqual([3, 4]);
  });
});

describe('orders (acceptance tests)', () => {
  it('1 · reference order prices to the cent: $618.11 / deposit $185.43 / balance $432.68', async () => {
    const o = await createOrder(db, tenantId, actor, orderInput(t(7, 13), t(7, 18), [{ productId: castleId }, { productId: popcornId }], { eventMiles: 18.4 }), prefs);
    expect(o.number).toMatch(/^Q-AUS-\d{5}$/);
    expect(o).toMatchObject({ merchandiseCents: 50000, travelFeeCents: 2100, taxCents: 4711, totalCents: 61811, depositDueCents: 18543 });
    const full = await getOrder(db, tenantId, o.id);
    expect(full!.lines.map((l) => l.unitCents)).toEqual([32500, 17500]);
    expect(full!.versions[0]).toMatchObject({ version: 1, action: 'created', actorName: 'P1 Owner' });
  });

  it('2 · a third castle when 2 are owned and both reserved is refused', async () => {
    const a = await createOrder(db, tenantId, actor, orderInput(t(14, 13), t(14, 18), [{ productId: castleId, quantity: 2 }]), prefs);
    await transitionOrder(db, tenantId, actor, a.id, 'book', prefs);
    const b = await createOrder(db, tenantId, actor, orderInput(t(14, 14), t(14, 17), [{ productId: castleId }]), prefs);
    await expect(transitionOrder(db, tenantId, actor, b.id, 'book', prefs)).rejects.toThrow('Refused · Castle Bounce House: 2 of 2 already reserved for this time');
    expect((await getOrder(db, tenantId, b.id))!.status).toBe('draft');
    expect((await productAvailability(db, tenantId, locationId, t(14, 15), t(14, 16)))[castleId]).toMatchObject({ owned: 2, held: 2, free: 0 });
  });

  it('3 · book, change the duration to 6 h → re-priced, new version, diff in history', async () => {
    const o = await createOrder(db, tenantId, actor, orderInput(t(21, 13), t(21, 18), [{ productId: castleId }], { eventMiles: 5 }), prefs);
    const { order: booked } = await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, {
      booking: { method: 'manual', payMethod: 'check', amount: 100, reference: '#1043' },
    });
    expect(booked.paidCents).toBe(10000);
    const saved = await updateOrder(db, tenantId, actor, o.id, orderInput(t(21, 13), t(21, 19), [{ productId: castleId }], { eventMiles: 5 }), prefs, booked.version);
    expect(saved.order.version).toBe(booked.version + 1);
    expect(saved.order.totalCents).toBeGreaterThan(booked.totalCents); // 6 h: $225 + 8 × $25
    const full = await getOrder(db, tenantId, o.id);
    expect(full!.versions[0]!.diff).toHaveProperty('Ends');
    expect(full!.versions[0]!.diff).toHaveProperty('Line 1');
    expect(full!.payments[0]).toMatchObject({ method: 'check', amountCents: 10000 });
    await expect(updateOrder(db, tenantId, actor, o.id, orderInput(t(21, 13), t(21, 19), [{ productId: castleId }]), prefs, booked.version)).rejects.toThrow(/changed this order/);
  });

  it('locks the base package and additional-time rate on the order (Odoo cart), whatever the product costs later', async () => {
    const bow = await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Extra Bow Set', kind: 'addon', priceStaffed: 30, baseHours: 1, hourlyRate: 20 }));
    // Odoo cart: Concierge base $25.00 incl. 1 h + 8.00 h × $15.00 = $145.00
    const odoo = await createOrder(db, tenantId, actor, orderInput(t(24, 5, 30), t(24, 14, 30), [{ productId: bow.id, basePrice: 25, extraRate: 15 }]), prefs);
    const [line] = (await getOrder(db, tenantId, odoo.id))!.lines;
    expect(line).toMatchObject({ unitCents: 14500, baseCents: 2500, extraRateCents: 1500, priceOverridden: false });
    // A line priced at today's price keeps it after the product's price goes up.
    const o = await createOrder(db, tenantId, actor, orderInput(t(24, 5, 30), t(24, 14, 30), [{ productId: bow.id }]), prefs);
    await updateProduct(db, tenantId, actor, bow.id, productSchema.parse({ name: 'Extra Bow Set', kind: 'addon', priceStaffed: 40, baseHours: 1, hourlyRate: 25 }));
    const full = (await getOrder(db, tenantId, o.id))!;
    const again = await updateOrder(db, tenantId, actor, o.id, orderInputFrom(full, full.lines, []), prefs, full.version);
    expect(again.order.totalCents).toBe(o.totalCents);
    expect((await getOrder(db, tenantId, o.id))!.lines[0]).toMatchObject({ baseCents: 3000, extraRateCents: 2000, unitCents: 3000 + 8 * 2000 });
  });

  it('booking at the counter: tip on top, policies confirmed by staff, multi-day billed for the real time', async () => {
    const o = await createOrder(db, tenantId, actor, orderInput(t(28, 9), t(30, 9), [{ productId: castleId }], { multiDay: true }), prefs);
    expect(o.multiDay).toBe(true);
    const { order, payment } = await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, {
      booking: { method: 'manual', payMethod: 'cash', amount: o.totalCents / 100, tip: 25, receipt: false, policies: { weather: true, setup: true, supervise: false } },
    });
    // The tip is recorded with the payment but is not part of what the order is paid against.
    expect(payment).toMatchObject({ amountCents: o.totalCents, tipCents: 2500 });
    expect(order.paidCents).toBe(o.totalCents);
    const acks = order.policyAcks as Record<string, { at: string; by: string | null }>;
    expect(Object.keys(acks).sort()).toEqual(['setup', 'weather']);
    expect(acks.weather!.by).toBeTruthy();
    const full = await getOrder(db, tenantId, o.id);
    expect(full!.versions[0]!.diff).toMatchObject({ Tip: { to: '$25.00' }, 'Policies confirmed for the customer': { to: 'weather, setup' } });
  });

  it('4 · rain check + $20 wallet credit → due after credits $412.68; deposit on that amount', async () => {
    const rc = await createCredit(db, tenantId, actor, customerId, creditSchema.parse({ kind: 'rain_check', amount: 185.43, reason: 'Rained out' }));
    const wc = await createCredit(db, tenantId, actor, customerId, creditSchema.parse({ kind: 'wallet', amount: 20 }));
    expect(rc.code).toMatch(/^RC-\d{4}$/);
    const o = await createOrder(db, tenantId, actor, orderInput(t(8, 13), t(8, 18), [{ productId: castleId }, { productId: popcornId }], {
      eventMiles: 18.4, credits: [{ creditId: rc.id, amount: 185.43 }, { creditId: wc.id, amount: 20 }],
    }), prefs);
    expect(o).toMatchObject({ creditCents: 20543, totalCents: 41268, depositDueCents: 12380 });
    expect(await usableCredits(db, tenantId, customerId)).toHaveLength(0);
    // Asking for more than is left is refused; cancelling the order gives the credit back.
    const other = orderInput(t(9, 13), t(9, 15), [{ productId: popcornId }], { credits: [{ creditId: wc.id, amount: 5 }] });
    await expect(createOrder(db, tenantId, actor, other, prefs)).rejects.toThrow(/no longer available/);
    await expect(voidCredit(db, tenantId, actor, rc.id)).rejects.toThrow(/applied to an open order/);
    await transitionOrder(db, tenantId, actor, o.id, 'cancel', prefs, { reason: 'Customer changed plans' });
    expect((await usableCredits(db, tenantId, customerId)).map((c) => c.balanceCents).sort((a, b) => a - b)).toEqual([2000, 18543]);
  });

  it('6 · two people booking the last unit at once: exactly one succeeds', async () => {
    const x = await createOrder(db, tenantId, actor, orderInput(t(28, 10), t(28, 12), [{ productId: screenId }]), prefs);
    const y = await createOrder(db, tenantId, actor, orderInput(t(28, 11), t(28, 13), [{ productId: screenId }]), prefs);
    const results = await Promise.allSettled([
      transitionOrder(db, tenantId, actor, x.id, 'book', prefs),
      transitionOrder(db, tenantId, actor, y.id, 'book', prefs),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('orders (rules)', () => {
  it('keeps the 3 h cleanup after each rental and frees equipment on cancel', async () => {
    const first = await createOrder(db, tenantId, actor, orderInput(t(22, 14), t(22, 18), [{ productId: screenId }]), prefs);
    await transitionOrder(db, tenantId, actor, first.id, 'book', prefs);
    const tooSoon = await createOrder(db, tenantId, actor, orderInput(t(22, 20, 30), t(22, 23), [{ productId: screenId }]), prefs);
    await expect(transitionOrder(db, tenantId, actor, tooSoon.id, 'book', prefs)).rejects.toThrow(/Refused/);
    await transitionOrder(db, tenantId, actor, first.id, 'cancel', prefs);
    await transitionOrder(db, tenantId, actor, tooSoon.id, 'book', prefs);
  });

  it('serialized stock: a unit in maintenance cannot be booked; services never run out', async () => {
    const u1 = await addUnit(db, tenantId, actor, { productId: ledId, locationId, label: 'Screen #1', serial: 'LED-12-001' });
    await addUnit(db, tenantId, actor, { productId: ledId, locationId, label: 'Screen #2' });
    await setUnitStatus(db, tenantId, actor, u1.id, 'maintenance');
    const two = await createOrder(db, tenantId, actor, orderInput(t(15, 18), t(15, 22), [{ productId: ledId, quantity: 2 }]), prefs);
    await expect(transitionOrder(db, tenantId, actor, two.id, 'book', prefs)).rejects.toThrow(/LED Screen 12 ft: 0 of 1/);
    await setUnitStatus(db, tenantId, actor, u1.id, 'ready');
    await transitionOrder(db, tenantId, actor, two.id, 'book', prefs);
    const staff = await createOrder(db, tenantId, actor, orderInput(t(15, 18), t(15, 22), [{ productId: attendantId, quantity: 40 }]), prefs);
    await transitionOrder(db, tenantId, actor, staff.id, 'book', prefs);
    const overview = await inventoryOverview(db, tenantId, locationId, '2026-11-15', 2, 'America/Chicago');
    expect(overview.daily.find((d) => d.productId === ledId && d.day === '2026-11-15')).toMatchObject({ owned: 2, held: 2 });
    expect(overview.daily.some((d) => d.productId === attendantId)).toBe(false);
  });

  it('custom non-taxable lines, tax-exempt customers, coupon limits', async () => {
    const preview = await previewOrder(db, tenantId, orderInput(t(16, 13), t(16, 17), [
      { productId: castleId }, { name: 'Generator rental', overridePrice: 50, taxable: false },
    ], { couponCode: 'fall10' }), prefs);
    expect(preview.summary).toMatchObject({ merchandiseCents: 22500, customCents: 5000, couponCents: 2250 });
    expect(await validateCoupon(db, tenantId, 'FALL10')).toMatchObject({ ok: true, label: '10% off rentals' });
    await createOrder(db, tenantId, actor, orderInput(t(16, 13), t(16, 17), [{ productId: castleId }], { couponCode: 'FALL10' }), prefs);
    expect(await validateCoupon(db, tenantId, 'FALL10')).toMatchObject({ ok: false, message: 'This code has been used up' });
    const school = await createOrder(db, tenantId, actor, orderInput(t(17, 9), t(17, 12), [{ productId: castleId }], { customerId: exemptId }), prefs);
    expect(school.taxCents).toBe(0);
  });

  it('book without payment records the reason; lowering the total below paid can go to wallet', async () => {
    const o = await createOrder(db, tenantId, actor, orderInput(t(23, 9), t(23, 12), [{ productId: popcornId, quantity: 2 }]), prefs);
    const { order: booked } = await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, {
      booking: { method: 'none', reason: 'Purchase order pending', expectedOn: '2026-11-20', notes: 'PO from the district' },
    });
    expect(booked).toMatchObject({ unpaidReason: 'Purchase order pending', expectedPaymentOn: '2026-11-20' });
    expect((await listOrders(db, tenantId, { unpaid: true })).map((r) => r.id)).toContain(o.id);
    const paid = await recordPayment(db, tenantId, actor, o.id, prefs, { method: 'cash', amount: booked.totalCents / 100 });
    const saved = await updateOrder(db, tenantId, actor, o.id, orderInput(t(23, 9), t(23, 12), [{ productId: popcornId, quantity: 1 }]), prefs, paid.order.version);
    expect(saved.overpaidCents).toBeGreaterThan(0);
    await resolveOverpayment(db, tenantId, actor, o.id, 'wallet');
    const wallet = (await usableCredits(db, tenantId, customerId)).find((c) => c.sourceOrderId === o.id);
    expect(wallet?.balanceCents).toBe(saved.overpaidCents);
  });

  it('lists, filters and counts orders; the customer profile follows', async () => {
    const booked = await listOrders(db, tenantId, { status: 'booked', locationId });
    expect(booked.length).toBeGreaterThanOrEqual(4);
    expect(booked[0]).toMatchObject({ customerName: 'Maria Gonzalez', locationName: 'Austin', locationCode: 'AUS' });
    expect(booked[0]!.lineItems.length).toBeGreaterThan(0);
    const stats = await orderStats(db, tenantId, 'America/Chicago');
    expect(stats.quotesOpen).toBeGreaterThan(0);
    const profile = await getCustomer(db, tenantId, customerId);
    expect(profile!.orders.length).toBeGreaterThanOrEqual(8);
    expect(profile!.repeat).toBe(true);
    expect(profile!.lifetimeCents).toBeGreaterThan(0);
  });
});
