/**
 * Phase 3 Ops board: cards come from the orders (deposit, final payment, call,
 * contact, quote), snoozing hides them, acting removes them.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays, customerSchema, orderSchema, parsePreferences, productSchema, utcToWallTime, wallTimeToUtc, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { tenants, users } from '../schema';
import { createProduct } from './catalog';
import { createCustomer } from './customers';
import { listLocations } from './locations';
import { actionNeeded, markPreEventCalled, snoozeCard } from './ops';
import { createOrder, transitionOrder } from './orders';
import { setupOrganization } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `ops-${run}` };
const prefs = parsePreferences({});
let tenantId = '';
let locationId = '';
let castleId = '';
let customerId = '';

// Calendar days in the location's time zone, like the board counts them.
const day = (n: number) => addDays(utcToWallTime(new Date(), 'America/Chicago').date, n);
const input = (date: string, extra: Partial<Record<string, unknown>> = {}): OrderInput =>
  orderSchema.parse({
    customerId, locationId, startsAt: wallTimeToUtc(date, '13:00', 'America/Chicago'), endsAt: wallTimeToUtc(date, '18:00', 'America/Chicago'),
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US' }, eventContactName: 'Maria', eventContactMobile: '512-555-0198', contactConfirmed: true,
    lines: [{ productId: castleId, quantity: 1 }], ...extra,
  });
const board = () => actionNeeded(db, tenantId, { currency: 'USD' });
const cardsFor = async (orderId: string) => (await board()).cards.filter((c) => c.orderId === orderId).map((c) => c.rule).sort();

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'Ops Owner', email: `ops-${run}@example.test` });
  const t = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `ops-${run}`, name: 'Ops Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  castleId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Castle', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 10 } } }))).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({ firstName: 'Maria', lastName: 'G', email: `m-${run}@example.test`, address: { country: 'US' } }))).id;
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('Ops board cards', () => {
  it('acceptance 4: booked without payment soon → Deposit needed; snoozing (as after a pay link) removes it', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(5)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'none', reason: 'Mailed check expected', expectedOn: day(2) } });
    const card = (await board()).cards.find((c) => c.orderId === o.id && c.rule === 'deposit');
    expect(card).toMatchObject({ action: 'pay_link', badge: '2 days' });
    expect(card!.detail).toContain('mailed check expected');
    await snoozeCard(db, tenantId, actor, o.id, 'deposit', 48, 'Pay link sent');
    expect(await cardsFor(o.id)).not.toContain('deposit');
  });

  it('an event tomorrow needs the pre-event call; Mark called clears it and is logged', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(1)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: o.depositDueCents / 100 } });
    expect(await cardsFor(o.id)).toContain('call');
    const after = await markPreEventCalled(db, tenantId, actor, o.id);
    expect(after.preEventCalledAt).toBeTruthy();
    expect(await cardsFor(o.id)).not.toContain('call');
  });

  it('a contact without a mobile in the coming week → Contact not confirmed (open the order)', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(6), { eventContactMobile: '', contactConfirmed: false }), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: o.depositDueCents / 100 } });
    const card = (await board()).cards.find((c) => c.orderId === o.id && c.rule === 'contact');
    expect(card).toMatchObject({ action: 'open', detail: 'On-site contact has no mobile number' });
  });

  it('a quote sent 5 days ago for a future event → Quotes going cold; a fresh one does not', async () => {
    const old = await createOrder(db, tenantId, actor, input(day(30)), prefs);
    await transitionOrder(db, tenantId, actor, old.id, 'send_quote', prefs);
    await owner.db.execute(sql`update orders set quote_sent_at = now() - interval '5 days' where id = ${old.id}::uuid`);
    const fresh = await createOrder(db, tenantId, actor, input(day(31)), prefs);
    await transitionOrder(db, tenantId, actor, fresh.id, 'send_quote', prefs);
    expect((await board()).cards.find((c) => c.orderId === old.id)).toMatchObject({ rule: 'quote', action: 'follow_up', badge: '5 days' });
    expect(await cardsFor(fresh.id)).toEqual([]);
  });

  it('an overdue invoice → Final payment late (retry when a card is saved, else a pay link)', async () => {
    const o = await createOrder(db, tenantId, actor, input(day(3)), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: o.depositDueCents / 100 } });
    await owner.db.execute(sql`update invoices set status = 'overdue', due_on = current_date - 2, last_charge_error = 'Card declined' where order_id = ${o.id}::uuid and kind = 'balance'`);
    const card = (await board()).cards.find((c) => c.orderId === o.id && c.rule === 'final_payment');
    expect(card).toMatchObject({ action: 'pay_link', tone: 'overdue' });
    expect(card!.detail).toContain('Auto-charge declined');
    const k = (await board()).kpis;
    expect(k.quotesWeek).toBeGreaterThanOrEqual(1);
    expect(k.quotesSeries).toHaveLength(8);
  });
});
