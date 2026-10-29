/**
 * Duplicate order: a new draft from another order's form. Only the form is copied; the original's money
 * and paperwork (payments, invoice, coupon, credits, signature, confirmations) stay with the original.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { creditSchema, customerSchema, orderSchema, parsePreferences, productSchema } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { coupons, tenants, users } from '../schema';
import { createProduct } from './catalog';
import { createCredit, createCustomer } from './customers';
import { listLocations } from './locations';
import { orderInvoices } from './money';
import { createOrder, duplicateOrder, getOrder, transitionOrder } from './orders';
import { setupOrganization } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `dup-${run}` };
const prefs = parsePreferences({});

let tenantId = '';
let locationId = '';
let castleId = '';
let customerId = '';

// Austin wall time (CST, UTC-6 in November)
const t = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour + 6));

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId, name: 'Sam Ortiz', email: `dup-${run}@example.test` });
  const tenant = await setupOrganization(db, { userId: actor.userId }, {
    slug: `dup-${run}`,
    name: 'Dup Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.2692, lng: -97.7428 } },
    taxPercent: 8.25,
  });
  tenantId = tenant.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  castleId = (await createProduct(db, tenantId, actor, productSchema.parse({
    name: 'Castle Bounce House', priceStaffed: 225, pricePickup: 175, priceDropoff: 195, baseHours: 4, inventory: { [locationId]: { owned: 2 } },
  }))).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({
    firstName: 'Maria', lastName: 'Gonzalez', email: `maria-${run}@example.test`, phone: '512-555-0142', address: { country: 'US' },
  }))).id;
  await owner.db.insert(coupons).values({ tenantId, code: 'FALL10', kind: 'percent', value: 10, maxUses: 5 });
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('duplicate order', () => {
  it('copies the form into a new draft and leaves the money and paperwork behind', async () => {
    const credit = await createCredit(db, tenantId, actor, customerId, creditSchema.parse({ kind: 'wallet', amount: 20 }));
    const source = await createOrder(db, tenantId, actor, orderSchema.parse({
      customerId, locationId, startsAt: t(21, 13), endsAt: t(21, 17), eventType: 'Birthday',
      eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US', lat: 30.2747, lng: -97.7404 },
      eventLocationName: 'Back lawn', eventContactName: 'Maria', eventContactMobile: '512-555-0198', contactConfirmed: true,
      billing: { name: 'Old Billing Name', email: 'old@example.test' },
      salespersonUserId: actor.userId, source: 'Google',
      lines: [{ productId: castleId, quantity: 1, serviceMode: 'staffed' }, { productId: null, name: 'Generator', quantity: 1, overridePrice: 40 }],
      discount: { kind: 'percent', value: 5 }, discountNote: 'Neighbour', couponCode: 'FALL10',
      credits: [{ creditId: credit.id, amount: 20 }],
      internalNotes: 'Gate code 4412', customerNotes: 'See you Saturday!',
    }), prefs);
    const { order: booked } = await transitionOrder(db, tenantId, actor, source.id, 'book', prefs, {
      booking: { method: 'manual', payMethod: 'cash', amount: 100, tip: 10, receipt: false, policies: { weather: true, setup: true } },
    });

    const copy = await duplicateOrder(db, tenantId, actor, source.id, prefs);
    const full = (await getOrder(db, tenantId, copy.id))!;

    // A new order of its own: new number, a draft, nothing paid, nothing confirmed.
    expect(copy.id).not.toBe(source.id);
    expect(copy.number).not.toBe(source.number);
    expect(full).toMatchObject({
      status: 'draft', paidCents: 0, creditCents: 0, couponCode: null, couponCents: 0, bookedAt: null, quoteSentAt: null,
      policyAcks: {}, copiedFromOrderId: source.id, accessTokenHash: null,
    });
    expect(full.payments).toEqual([]);
    expect(full.creditApplications).toEqual([]);
    expect(await orderInvoices(db, tenantId, copy.id)).toEqual([]);
    expect(full.versions).toHaveLength(1);
    expect(full.versions[0]).toMatchObject({ action: 'created', reason: `Copied from ${source.number}` });

    // The form, as it was: same date and time, items at the original's locked prices, notes and discount.
    expect(full).toMatchObject({
      customerId, locationId, eventType: 'Birthday', eventLocationName: 'Back lawn', eventLine1: '1100 Congress Ave',
      eventContactName: 'Maria', eventContactMobile: source.eventContactMobile, discountKind: 'percent', discountNote: 'Neighbour',
      internalNotes: 'Gate code 4412', customerNotes: 'See you Saturday!', damageWaiver: source.damageWaiver,
    });
    expect(full.eventStartsAt.toISOString()).toBe(source.eventStartsAt.toISOString());
    expect(full.eventEndsAt.toISOString()).toBe(source.eventEndsAt.toISOString());
    const src = (await getOrder(db, tenantId, source.id))!;
    expect(full.lines.map((l) => [l.name, l.quantity, l.unitCents, l.baseCents])).toEqual(src.lines.map((l) => [l.name, l.quantity, l.unitCents, l.baseCents]));

    // Customer side starts fresh: billing from the customer record, no salesperson or referral, contact to re-confirm.
    expect(full).toMatchObject({ billing: {}, salespersonUserId: null, referredByCustomerId: null, source: 'Repeat customer', contactConfirmed: false });

    // The original is untouched.
    expect(src).toMatchObject({ status: 'booked', version: booked.version, paidCents: booked.paidCents, couponCode: 'FALL10' });
    expect(src.payments).toHaveLength(1);
  });

  it('a copy of a copy names its own original', async () => {
    const a = await createOrder(db, tenantId, actor, orderSchema.parse({
      customerId, locationId, startsAt: t(22, 10), endsAt: t(22, 14),
      eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US' }, lines: [{ productId: castleId, quantity: 1 }],
    }), prefs);
    const b = await duplicateOrder(db, tenantId, actor, a.id, prefs);
    const c = await duplicateOrder(db, tenantId, actor, b.id, prefs);
    expect((await getOrder(db, tenantId, c.id))!).toMatchObject({ copiedFromOrderId: b.id, versions: [expect.objectContaining({ reason: `Copied from ${b.number}` })] });
  });
});
