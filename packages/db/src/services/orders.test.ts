/**
 * Phase 1 integration tests: catalog, customers, orders, pricing and inventory
 * holds, against the real database as the restricted runtime role.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { customerSchema, onboardingSchema, orderSchema, parsePreferences, productSchema, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { tenants, users } from '../schema';
import { createCategory, createProduct, getProduct, listProducts, productAvailability } from './catalog';
import { createCustomer, getCustomer, listCustomers } from './customers';
import { listLocations } from './locations';
import { createOrder, getOrder, listOrders, orderStats, transitionOrder, updateOrder } from './orders';
import { createOrganization } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 6 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `p1-${run}` };
const prefs = parsePreferences({});

let tenantId = '';
let locationId = '';
let bounceId = '';
let screenId = '';
let customerId = '';

// Austin wall time (CST, UTC-6 in November)
const t = (day: number, hour: number, min = 0) => new Date(Date.UTC(2026, 10, day, hour + 6, min));

const orderInput = (start: Date, end: Date, lines: { productId: string; quantity?: number; serviceMode?: string }[], extra: Partial<Record<string, unknown>> = {}): OrderInput =>
  orderSchema.parse({
    customerId,
    locationId,
    startsAt: start,
    endsAt: end,
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US', lat: 30.2747, lng: -97.7404 },
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity ?? 1, serviceMode: l.serviceMode ?? 'staffed' })),
    travelFee: 0,
    ...extra,
  });

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'P1 Owner', email: `p1-${run}@example.test` });
  const tenant = await createOrganization(db, { userId: actor.userId! }, onboardingSchema.parse({
    slug: `p1-${run}`,
    profile: { name: 'P1 Rentals', address: { country: 'US' } },
    branding: { brandColor: '#2450C8', themeMode: 'system', radius: 'soft' },
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.2692, lng: -97.7428 } },
    booking: { defaultTaxPercent: 8.25 },
  }));
  tenantId = tenant.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  const cat = await createCategory(db, tenantId, actor, 'Inflatables');
  const bounce = await createProduct(db, tenantId, actor, productSchema.parse({
    name: 'Castle Bounce House', categoryId: cat.id, priceStaffed: 299, pricePickup: 199, priceDropoff: 249, baseHours: 4, hourlyRate: 50,
    inventory: { [locationId]: 2 },
  }));
  bounceId = bounce.id;
  const screen = await createProduct(db, tenantId, actor, productSchema.parse({ name: '40ft Movie Screen', priceStaffed: 650 }));
  screenId = screen.id; // no inventory row: one unit, like Odoo
  const c = await createCustomer(db, tenantId, actor, customerSchema.parse({
    firstName: 'Jane', lastName: 'Doe', email: `jane-${run}@example.test`, phone: '512-555-0101', address: { country: 'US' },
  }));
  customerId = c.id;
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('catalog and customers', () => {
  it('stores prices in cents and quantity per location', async () => {
    const p = await getProduct(db, tenantId, bounceId);
    expect(p).toMatchObject({ priceStaffedCents: 29900, pricePickupCents: 19900, baseHours: 4, hourlyRateCents: 5000, inventory: { [locationId]: 2 } });
    expect((await listProducts(db, tenantId)).map((x) => x.name)).toEqual(['40ft Movie Screen', 'Castle Bounce House']);
  });
  it('finds customers by name, email or phone digits', async () => {
    expect((await listCustomers(db, tenantId, 'doe'))[0]?.displayName).toBe('Jane Doe');
    expect((await listCustomers(db, tenantId, '5550101'))[0]?.id).toBe(customerId);
  });
});

describe('orders', () => {
  it('prices like the POS, numbers the quote, and stores the summary', async () => {
    // 2 PM - 7:30 PM = 5.5 h: castle $299 + 1.5 h x $50 = $374
    const o = await createOrder(db, tenantId, actor, orderInput(t(7, 14), t(7, 19, 30), [{ productId: bounceId }], { travelFee: 37.5 }), prefs);
    expect(o.number).toMatch(/^Q-\d{5}$/);
    const full = await getOrder(db, tenantId, o.id);
    expect(full!.lines[0]).toMatchObject({ unitCents: 37400, lineTotalCents: 37400 });
    // waiver 10% = 3740, extras = 3750 + 3740 = 7490, tax 8.25% of 44890 = 3703.425 -> 3703
    expect(o).toMatchObject({ merchandiseCents: 37400, extrasCents: 7490, taxCents: 3703, totalCents: 48593, depositDueCents: 14578, taxPercent: 8.25 });
  });

  it('books within quantity owned and refuses the third overlapping booking', async () => {
    const a = await createOrder(db, tenantId, actor, orderInput(t(14, 16), t(14, 18), [{ productId: bounceId }]), prefs);
    const b = await createOrder(db, tenantId, actor, orderInput(t(14, 17), t(14, 19), [{ productId: bounceId }]), prefs);
    const c = await createOrder(db, tenantId, actor, orderInput(t(14, 17, 30), t(14, 18, 30), [{ productId: bounceId }]), prefs);
    await transitionOrder(db, tenantId, actor, a.id, 'book', prefs);
    await transitionOrder(db, tenantId, actor, b.id, 'book', prefs);
    await expect(transitionOrder(db, tenantId, actor, c.id, 'book', prefs)).rejects.toThrow(/Castle Bounce House is not available then: all 2 already booked/);
    expect((await getOrder(db, tenantId, c.id))!.status).toBe('draft');
    const avail = await productAvailability(db, tenantId, locationId, t(14, 17), t(14, 18));
    expect(avail[bounceId]).toEqual({ owned: 2, held: 2, free: 0 });
  });

  it('keeps the 3 h cleanup after each rental (Odoo rule) and frees equipment on cancel', async () => {
    const first = await createOrder(db, tenantId, actor, orderInput(t(21, 14), t(21, 18), [{ productId: screenId }]), prefs);
    await transitionOrder(db, tenantId, actor, first.id, 'book', prefs);
    const tooSoon = await createOrder(db, tenantId, actor, orderInput(t(21, 20, 30), t(21, 23), [{ productId: screenId }]), prefs);
    await expect(transitionOrder(db, tenantId, actor, tooSoon.id, 'book', prefs)).rejects.toThrow(/not available/);
    const after = await createOrder(db, tenantId, actor, orderInput(t(21, 21), t(21, 23), [{ productId: screenId }]), prefs);
    await transitionOrder(db, tenantId, actor, after.id, 'book', prefs); // 6 PM + 3 h = 9 PM is free again
    // Cancelling releases equipment: with both bookings cancelled the 8:30 PM slot frees up.
    await transitionOrder(db, tenantId, actor, first.id, 'cancel', prefs, 'Weather');
    await expect(transitionOrder(db, tenantId, actor, tooSoon.id, 'book', prefs)).rejects.toThrow(/not available/); // still overlaps the 9 PM booking
    await transitionOrder(db, tenantId, actor, after.id, 'cancel', prefs);
    await transitionOrder(db, tenantId, actor, tooSoon.id, 'book', prefs);
    expect((await getOrder(db, tenantId, tooSoon.id))!.status).toBe('booked');
  });

  it('lets exactly one of two simultaneous bookings take the last unit', async () => {
    const x = await createOrder(db, tenantId, actor, orderInput(t(28, 10), t(28, 12), [{ productId: screenId }]), prefs);
    const y = await createOrder(db, tenantId, actor, orderInput(t(28, 11), t(28, 13), [{ productId: screenId }]), prefs);
    const results = await Promise.allSettled([
      transitionOrder(db, tenantId, actor, x.id, 'book', prefs),
      transitionOrder(db, tenantId, actor, y.id, 'book', prefs),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('re-holds equipment when a booked order is edited, and refuses stale edits', async () => {
    const o = await createOrder(db, tenantId, actor, orderInput(t(30, 10), t(30, 12), [{ productId: bounceId }]), prefs);
    const booked = await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    const bigger = orderInput(t(30, 10), t(30, 12), [{ productId: bounceId, quantity: 3 }]);
    await expect(updateOrder(db, tenantId, actor, o.id, bigger, prefs, booked.version)).rejects.toThrow(/only 2 of 2|all 2|not available/);
    const two = orderInput(t(30, 10), t(30, 12), [{ productId: bounceId, quantity: 2 }]);
    const saved = await updateOrder(db, tenantId, actor, o.id, two, prefs, booked.version);
    expect(saved.version).toBe(booked.version + 1);
    await expect(updateOrder(db, tenantId, actor, o.id, two, prefs, booked.version)).rejects.toThrow(/changed this order/);
  });

  it('lists, filters and counts orders; customer history follows', async () => {
    const booked = await listOrders(db, tenantId, { status: 'booked' });
    expect(booked.length).toBeGreaterThanOrEqual(4);
    expect(booked[0]).toMatchObject({ customerName: 'Jane Doe', locationName: 'Austin' });
    expect((await listOrders(db, tenantId, { search: 'Jane' })).length).toBeGreaterThan(0);
    const stats = await orderStats(db, tenantId, 'America/Chicago');
    expect(stats.quotesOpen).toBeGreaterThan(0);
    expect((await getCustomer(db, tenantId, customerId))!.orders.length).toBeGreaterThanOrEqual(7);
  });
});
