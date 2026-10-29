/**
 * Phase 4a coach portal, against the database: assignment, the server-enforced checklist rules,
 * en route with Text 1 / Text 2 (each once), live tracking, arrival, EVENT START and damage.
 * Numbers in the test names follow the acceptance tests in the design (05-leads-and-coach.md).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { addDays, customerSchema, orderSchema, parsePreferences, productSchema, utcToWallTime, wallTimeToUtc, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { memberships, messages, tenants, users } from '../schema';
import { createProduct } from './catalog';
import {
  addCoachPhoto, coachHome, coachOrderDetail, coachOrders, eventStart, markArrived, saveCoachPhase, setOrderStaff, setTracking, startEnRoute, trackPing,
  type EtaFn,
} from './coach';
import { createCustomer } from './customers';
import { listLocations } from './locations';
import { createOrder, transitionOrder } from './orders';
import { setupOrganization } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const boss = { type: 'user' as const, userId: `cb-${run}` };
const alex = { type: 'user' as const, userId: `ca-${run}` };
const sam = { type: 'user' as const, userId: `cs-${run}` };
const prefs = parsePreferences({});
let tenantId = '';
let locationId = '';
let castleId = '';
let customerId = '';

const VENUE = { lat: 30.2672, lng: -97.7431 };
const day = (n: number) => addDays(utcToWallTime(new Date(), 'America/Chicago').date, n);
const input = (date: string): OrderInput =>
  orderSchema.parse({
    customerId, locationId, startsAt: wallTimeToUtc(date, '13:00', 'America/Chicago'), endsAt: wallTimeToUtc(date, '18:00', 'America/Chicago'),
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US', lat: VENUE.lat, lng: VENUE.lng },
    eventContactName: 'Maria', eventContactMobile: '512-555-0198', contactConfirmed: true, lines: [{ productId: castleId, quantity: 1 }],
  });
const photo = { bytes: Buffer.from('fake-jpeg'), mime: 'image/jpeg', filename: 'p.jpg' };
const ALL_PRE = ['vehicle_fueled', 'route_planned', 'event_reviewed', 'uniform_clean', 'tools_packed', 'special_requests', 'marketing_packed'];
const textsFor = (orderId: string) =>
  owner.db.select({ type: messages.type, status: messages.status, meta: messages.meta }).from(messages)
    .where(and(eq(messages.orderId, orderId), sql`${messages.type} in ('coach_en_route','coach_arriving','damage_report')`));

async function bookedOrder(n = 0) {
  const o = await createOrder(db, tenantId, boss, input(day(n)), prefs);
  await transitionOrder(db, tenantId, boss, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: o.depositDueCents / 100 } });
  await setOrderStaff(db, tenantId, boss, o.id, [{ userId: alex.userId!, role: 'coach' }, { userId: sam.userId!, role: 'crew' }]);
  return o;
}

/** Pre-Departure and Load saved, with the load photo. */
async function readyToGo(orderId: string) {
  await saveCoachPhase(db, tenantId, alex, orderId, { phase: 'pre_departure', ticked: ALL_PRE });
  await addCoachPhoto(db, tenantId, alex, orderId, 'load', photo);
  await saveCoachPhase(db, tenantId, alex, orderId, { phase: 'load', ticked: ['equipment_loaded', 'spares_loaded'] });
}

beforeAll(async () => {
  await owner.db.insert(users).values([
    { id: boss.userId!, name: 'Coach Boss', email: `cb-${run}@example.test` },
    { id: alex.userId!, name: 'Alex Rivera', email: `ca-${run}@example.test` },
    { id: sam.userId!, name: 'Sam Crew', email: `cs-${run}@example.test` },
  ]);
  const t = await setupOrganization(db, { userId: boss.userId! }, {
    slug: `coach-${run}`, name: 'Coach Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  await owner.db.insert(memberships).values([
    { tenantId, userId: alex.userId!, role: 'coach' },
    { tenantId, userId: sam.userId!, role: 'crew' },
  ]);
  locationId = (await listLocations(db, tenantId))[0]!.id;
  castleId = (await createProduct(db, tenantId, boss, productSchema.parse({ name: 'Castle', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 10 } } }))).id;
  customerId = (await createCustomer(db, tenantId, boss, customerSchema.parse({ firstName: 'Maria', lastName: 'G', email: `m-${run}@example.test`, phone: '512-555-0100', address: { country: 'US' } }))).id;
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.execute(sql`delete from users where id in (${boss.userId}, ${alex.userId}, ${sam.userId})`);
  await app.client.end();
  await owner.client.end();
});

describe('assignment', () => {
  it('the only coach becomes the lead; crew can’t be a coach; a crew member sees but can’t tick', async () => {
    const o = await bookedOrder(3);
    const detail = await coachOrderDetail(db, tenantId, sam.userId!, o.id);
    expect(detail.me).toEqual({ role: 'crew', isLead: false });
    expect(detail.team.map((s) => [s.name, s.role, s.isLead])).toEqual([['Alex Rivera', 'coach', true], ['Sam Crew', 'crew', false]]);
    await expect(saveCoachPhase(db, tenantId, sam, o.id, { phase: 'pre_departure', ticked: ALL_PRE })).rejects.toThrow('only a coach');
    await expect(setOrderStaff(db, tenantId, boss, o.id, [{ userId: sam.userId!, role: 'coach' }])).rejects.toThrow('Coach role');
  });

  it('10: a Quote order is listed but locked', async () => {
    const q = await createOrder(db, tenantId, boss, input(day(9)), prefs);
    await transitionOrder(db, tenantId, boss, q.id, 'send_quote', prefs);
    await setOrderStaff(db, tenantId, boss, q.id, [{ userId: alex.userId!, role: 'coach' }]);
    const row = (await coachOrders(db, tenantId, alex.userId!)).find((x) => x.id === q.id)!;
    expect(row).toMatchObject({ statusLabel: 'Quote', workable: false });
    await expect(coachOrderDetail(db, tenantId, alex.userId!, q.id)).rejects.toThrow(`Order ${q.number} is a Quote order. The detail page is only available for Booked orders.`);
  });
});

describe('the checklist rules (server side)', () => {
  it('1: Start En Route is refused until Pre-Departure and Load are saved', async () => {
    const o = await bookedOrder(1);
    const eta: EtaFn = async () => 18;
    await expect(startEnRoute(db, tenantId, alex, o.id, { lat: 30.4, lng: -97.8 }, eta)).rejects.toThrow('unlocks once Pre-Departure and Load are saved');
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'pre_departure', ticked: ALL_PRE });
    await expect(startEnRoute(db, tenantId, alex, o.id, { lat: 30.4, lng: -97.8 }, eta)).rejects.toThrow('unlocks');
  });

  it('5: Load with 2 ticks and no photo → 67%; ticks stay; the photo makes it 100% and locked', async () => {
    const o = await bookedOrder(2);
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'pre_departure', ticked: ['vehicle_fueled'] });
    const first = await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'load', ticked: ['equipment_loaded', 'spares_loaded'] });
    expect(first).toMatchObject({ percent: 66.7, locked: false });
    // Sending no ticks does not untick the saved ones.
    expect((await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'load', ticked: [] })).percent).toBe(66.7);
    await addCoachPhoto(db, tenantId, alex, o.id, 'load', photo);
    expect(await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'load', ticked: [] })).toMatchObject({ percent: 100, locked: true });
    await expect(saveCoachPhase(db, tenantId, alex, o.id, { phase: 'load', ticked: [] })).rejects.toThrow('locked');
    await expect(addCoachPhoto(db, tenantId, alex, o.id, 'load', photo)).rejects.toThrow('locked');
  });

  it('4: Phase 3 can’t open before "I have arrived"; afterwards it opens and the time + distance are recorded', async () => {
    const o = await bookedOrder(4);
    await readyToGo(o.id);
    await expect(saveCoachPhase(db, tenantId, alex, o.id, { phase: 'arrival', ticked: [] })).rejects.toThrow('opens after "I have arrived"');
    const arrived = await markArrived(db, tenantId, alex, o.id, { lat: 30.2675, lng: -97.7431 });
    expect(arrived.distanceM).toBeGreaterThan(20);
    expect(arrived.distanceM).toBeLessThan(60);
    const d = await coachOrderDetail(db, tenantId, alex.userId!, o.id);
    expect(d.checklist.phases.find((p) => p.key === 'arrival')!.open).toBe(true);
    expect(d.checklist.phases.find((p) => p.key === 'setup')!.status).toMatchObject({ kind: 'locked_until', phase: 3 });
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'arrival', ticked: ['arrival_greeting'], overrideReason: 'Customer not home yet' });
    expect((await coachOrderDetail(db, tenantId, alex.userId!, o.id)).checklist.overrideReason).toBe('Customer not home yet');
  });
});

describe('en route, tracking and texts', () => {
  it('2 + 3: Text 1 once; ETA ≤ 5 → Text 2 once, tracking off, Start Tracking refused', async () => {
    const o = await bookedOrder(0);
    await readyToGo(o.id);
    let next = 18;
    const eta: EtaFn = async () => next;
    const r1 = await startEnRoute(db, tenantId, alex, o.id, { lat: 30.40, lng: -97.80 }, eta);
    expect(r1).toMatchObject({ etaMinutes: 18, text1: true, text2: false, tracking: true });
    // Pressing it again does not text again.
    expect((await startEnRoute(db, tenantId, alex, o.id, { lat: 30.401, lng: -97.80 }, eta)).text1).toBe(false);
    // Fixes here are milliseconds apart, so each step stays under the ~145 m a 1-second gap allows.
    next = 9;
    expect(await trackPing(db, tenantId, alex, o.id, { lat: 30.4019, lng: -97.80, accuracyM: 20 }, eta)).toMatchObject({ tracking: true, etaMinutes: 9, text2: false });
    next = 4;
    expect(await trackPing(db, tenantId, alex, o.id, { lat: 30.4028, lng: -97.80, accuracyM: 20 }, eta)).toMatchObject({ tracking: false, etaMinutes: 4, text2: true });
    expect(await trackPing(db, tenantId, alex, o.id, { lat: 30.4037, lng: -97.80 }, eta)).toMatchObject({ tracking: false, stopped: 'text2' });
    await expect(setTracking(db, tenantId, alex, o.id, true)).rejects.toThrow('5-minute text');
    const texts = await textsFor(o.id);
    expect(texts.map((t) => t.type).sort()).toEqual(['coach_arriving', 'coach_en_route']);
    expect(texts.find((t) => t.type === 'coach_en_route')!.meta).toMatchObject({ coachName: 'Alex Rivera', etaMinutes: 18 });
    expect(texts.find((t) => t.type === 'coach_arriving')!.meta).toMatchObject({ etaMinutes: 4 });
  });

  it('a GPS jump is ignored; Stop Tracking pauses and Start Tracking resumes (before Text 2)', async () => {
    const o = await bookedOrder(0);
    await readyToGo(o.id);
    const eta: EtaFn = async () => 20;
    await startEnRoute(db, tenantId, alex, o.id, { lat: 30.40, lng: -97.80 }, eta);
    expect(await trackPing(db, tenantId, alex, o.id, { lat: 31.40, lng: -97.80, accuracyM: 10 }, eta)).toMatchObject({ ignored: 'outlier', tracking: true });
    await setTracking(db, tenantId, alex, o.id, false);
    expect(await trackPing(db, tenantId, alex, o.id, { lat: 30.401, lng: -97.80 }, eta)).toMatchObject({ tracking: false, stopped: 'not_tracking' });
    expect(await setTracking(db, tenantId, alex, o.id, true)).toEqual({ tracking: true });
  });

  it('only one order is tracked per coach', async () => {
    const a = await bookedOrder(0);
    const b = await bookedOrder(0);
    await readyToGo(a.id);
    await readyToGo(b.id);
    const eta: EtaFn = async () => 25;
    await startEnRoute(db, tenantId, alex, a.id, { lat: 30.40, lng: -97.80 }, eta);
    await startEnRoute(db, tenantId, alex, b.id, { lat: 30.40, lng: -97.80 }, eta);
    const list = await coachOrders(db, tenantId, alex.userId!);
    expect(list.find((x) => x.id === a.id)!.tracking).toBe(false);
    expect(list.find((x) => x.id === b.id)!.tracking).toBe(true);
  });
});

describe('the event', () => {
  it('6 + 8: EVENT START once, with the variance; arrived + all five saved → Completed, rating updates', async () => {
    const o = await bookedOrder(0);
    await readyToGo(o.id);
    await markArrived(db, tenantId, alex, o.id, VENUE);
    await expect(eventStart(db, tenantId, alex, o.id, VENUE)).rejects.toThrow('opens after Arrival Checks');
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'arrival', ticked: ['arrival_greeting', 'arrival_contract', 'arrival_payment', 'arrival_review_card', 'arrival_safety_sheets', 'arrival_setup_location'] });
    const started = await eventStart(db, tenantId, alex, o.id, VENUE);
    expect(typeof started.variance.minutes).toBe('number');
    await expect(eventStart(db, tenantId, alex, o.id, VENUE)).rejects.toThrow('already pressed');
    await addCoachPhoto(db, tenantId, alex, o.id, 'setup', photo);
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'setup', ticked: ['setup_equipment'], sopNotes: 'Stakes in, blower on the left' });
    const before = (await coachOrders(db, tenantId, alex.userId!)).find((x) => x.id === o.id)!;
    expect(before.completed).toBe(false);
    const done = await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'closeout', ticked: ['closeout_breakdown'] });
    expect(done.completed).toBe(true);
    const after = (await coachOrders(db, tenantId, alex.userId!)).find((x) => x.id === o.id)!;
    expect(after).toMatchObject({ completed: true, statusLabel: 'Completed' });
    expect(after.rating).toBeGreaterThan(before.rating);
    const home = await coachHome(db, tenantId, alex.userId!, 'America/Chicago');
    expect(home.rating.orders).toBeGreaterThan(0);
    expect(home.activity.some((a) => a.orderId === o.id && a.action === 'coach.event_start')).toBe(true);
  });

  it('7 (part): Close-Out with damage notes turns the maintenance flag on and alerts the office once', async () => {
    const o = await bookedOrder(0);
    await readyToGo(o.id);
    await markArrived(db, tenantId, alex, o.id, VENUE);
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'arrival', ticked: [] });
    await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'setup', ticked: [] });
    const r = await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'closeout', ticked: [], damageNotes: 'Torn seam on the castle turret' });
    expect(r.damageAlert).toBe(true);
    expect((await saveCoachPhase(db, tenantId, alex, o.id, { phase: 'closeout', ticked: ['closeout_breakdown'] })).damageAlert).toBe(false);
    const d = await coachOrderDetail(db, tenantId, alex.userId!, o.id);
    expect(d.checklist).toMatchObject({ damage: true, maintenanceFlag: true, damageNotes: 'Torn seam on the castle turret' });
    expect((await textsFor(o.id)).filter((t) => t.type === 'damage_report')).toHaveLength(1);
  });
});
