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
import { cancelOrder, createOrder, getOrder, planRefund, refundablePayments, rescheduleOrder, transitionOrder } from './orders';
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
