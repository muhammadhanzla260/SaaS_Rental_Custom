/**
 * Phase 2a integration tests: quote email, exactly-once delivery, scheduled
 * reminders planned in the location's time zone, re-planning, quiet hours and
 * cancellation, against the real database (outbox delivery).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { customerSchema, orderSchema, parsePreferences, productSchema, wallTimeToUtc } from '@rental/core';
import {
  createCustomer, createDb, createOrder, createProduct, listLocations, listMessages, replanAll, resolveOrderToken, saveMailAccount, schema,
  recordGatewayPayment, recordPayment, setupOrganization, transitionOrder, updateOrder, updatePreferences,
} from '@rental/db';
import { dispatchMessage, dispatchOrder } from './dispatch';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
process.env.MESSAGING_DELIVERY = 'outbox';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `p2-${run}` };
let tenantId = '';
let locationId = '';
let productId = '';
let customerId = '';
let prefs = parsePreferences({});

// A Saturday ~3 weeks out, 1-6 PM Chicago.
const sat = (() => {
  const d = new Date(Date.now() + 21 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
})();
const input = (date: string, from = '13:00', to = '18:00') =>
  orderSchema.parse({
    customerId, locationId, startsAt: wallTimeToUtc(date, from, 'America/Chicago'), endsAt: wallTimeToUtc(date, to, 'America/Chicago'),
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US' }, eventContactName: 'Maria', eventContactMobile: '512-555-0142',
    lines: [{ productId, quantity: 1 }],
  });
const msgs = async (orderId: string) => (await listMessages(db, tenantId, { orderId })).rows;

beforeAll(async () => {
  await owner.db.insert(schema.users).values({ id: actor.userId!, name: 'P2 Owner', email: `p2-${run}@example.test` });
  const t = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `p2-${run}`, name: 'P2 Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  productId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Castle', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 2 } } }))).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({
    firstName: 'Maria', lastName: 'Gonzalez', email: `maria-${run}@example.test`, phone: '512-555-0142', address: { country: 'US' },
  }))).id;
  await saveMailAccount(db, tenantId, actor, null, {
    mode: 'smtp', provider: 'google', host: 'smtp.gmail.com', port: 587, security: 'starttls', username: 'bookings@p2.test', password: 'x',
    fromName: 'P2 Rentals', fromEmail: 'bookings@p2.test',
  } as never);
  prefs = parsePreferences((await owner.db.execute(sql`select settings from tenants where id = ${tenantId}::uuid`))[0]!.settings);
  await updatePreferences(db, tenantId, actor, 'messaging', { ...prefs.messaging, live: true });
  prefs = parsePreferences((await owner.db.execute(sql`select settings from tenants where id = ${tenantId}::uuid`))[0]!.settings);
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.execute(sql`delete from tenants where id = ${tenantId}::uuid`);
  await owner.db.execute(sql`delete from users where id = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('quote email', () => {
  it('acceptance 1: Send quote → exactly one quote email, from the workspace’s own address, with a working link', async () => {
    const o = await createOrder(db, tenantId, actor, input(sat), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'send_quote', prefs);
    const results = await dispatchOrder(db, tenantId, o.id);
    expect(results).toEqual(['sent']);
    const quote = (await msgs(o.id)).filter((m) => m.type === 'quote');
    expect(quote).toHaveLength(1);
    expect(quote[0]).toMatchObject({ status: 'sent', toAddress: `maria-${run}@example.test`, subject: expect.stringContaining('Quote #') });
    const file = quote[0]!.providerRef!.replace(/^outbox:/, '');
    const html = await readFile(file, 'utf8');
    expect(html).toContain('From: "P2 Rentals" <bookings@p2.test>');
    const token = html.match(/\/q\/([A-Za-z0-9_-]+)/)?.[1];
    expect(await resolveOrderToken(db, token!)).toEqual({ tenantId, orderId: o.id });
    // A second dispatch of the same message cannot send it again.
    expect(await dispatchMessage(db, tenantId, quote[0]!.id)).toBe('not_claimed');
  });
});

describe('payment confirmations (Odoo triggers)', () => {
  it('booked without payment → booking confirmation; card checkout → only the paid confirmation; balance → paid', async () => {
    const day = (n: number) => new Date(new Date(`${sat}T12:00:00Z`).getTime() + n * 7 * 86_400_000).toISOString().slice(0, 10);
    // 1. Booked with nothing paid: the booking confirmation is the only email.
    const a = await createOrder(db, tenantId, actor, input(day(1)), prefs);
    await transitionOrder(db, tenantId, actor, a.id, 'book', prefs, { booking: { method: 'none', reason: 'Mailed check expected', expectedOn: day(1) } });
    expect((await msgs(a.id)).filter((m) => ['booking_confirmation', 'payment_partial', 'payment_paid'].includes(m.type)).map((m) => m.type)).toEqual(['booking_confirmation']);
    // Paying the whole balance later sends "paid", not "partial".
    await recordPayment(db, tenantId, actor, a.id, prefs, { method: 'cash', amount: a.totalCents / 100 });
    expect((await msgs(a.id)).filter((m) => m.type.startsWith('payment_')).map((m) => m.type)).toEqual(['payment_paid']);

    // 2. Quote page card checkout: book (payment follows) then the gateway payment — one email, the paid confirmation.
    const b = await createOrder(db, tenantId, actor, input(day(2)), prefs);
    await transitionOrder(db, tenantId, actor, b.id, 'book', prefs, { paymentFollows: true });
    await recordGatewayPayment(db, tenantId, { type: 'customer' }, b.id, { gateway: 'stripe', ref: `pi_test_${run}`, amountCents: b.totalCents, brand: 'visa', last4: '4242' });
    expect((await msgs(b.id)).filter((m) => ['booking_confirmation', 'payment_partial', 'payment_paid'].includes(m.type)).map((m) => m.type)).toEqual(['payment_paid']);
  });
});

describe('booking and schedules', () => {
  it('a paid booking sends one payment confirmation (like Odoo) and plans reminders in the location’s time zone', async () => {
    const o = await createOrder(db, tenantId, actor, input(sat), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: 50 } });
    await dispatchOrder(db, tenantId, o.id);
    const all = await msgs(o.id);
    // $50 of the order: partial. No separate booking confirmation — the payment confirmation says it is booked.
    expect(all.filter((m) => m.type === 'booking_confirmation')).toHaveLength(0);
    expect(all.filter((m) => m.type === 'payment_partial' && m.status === 'sent')).toHaveLength(1);
    const pre = all.find((m) => m.type === 'pre_event')!;
    expect(pre.status).toBe('queued');
    expect(pre.scheduledFor.toISOString()).toBe(wallTimeToUtc(new Date(new Date(`${sat}T12:00:00Z`).getTime() - 3 * 86_400_000).toISOString().slice(0, 10), '09:00', 'America/Chicago').toISOString());
    const text = all.find((m) => m.type === 'quality_check')!;
    expect(text).toMatchObject({ channel: 'sms', audience: 'contact', status: 'queued' });

    // Moving the event re-plans: the old reminder is cancelled, a new one is queued.
    const later = new Date(new Date(`${sat}T12:00:00Z`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const { order } = await (async () => ({ order: (await updateOrder(db, tenantId, actor, o.id, input(later), prefs)).order }))();
    const after = await msgs(order.id);
    expect(after.find((m) => m.id === pre.id)!.status).toBe('cancelled');
    expect(after.filter((m) => m.type === 'pre_event' && m.status === 'queued')).toHaveLength(1);
  });

  it('acceptance 3: changing the day-before rule moves the queued job', async () => {
    await updatePreferences(db, tenantId, actor, 'messaging', {
      ...prefs.messaging, live: true, schedules: { ...prefs.messaging.schedules, day_before: { enabled: true, channels: ['email'], days: 2, direction: 'before', anchor: 'start', time: '18:00' } },
    });
    await replanAll(db, tenantId);
    const rows = (await listMessages(db, tenantId, { status: 'upcoming', type: 'day_before' })).rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).format(r.scheduledFor);
      expect(local).toBe('18:00');
    }
  });

  it('changing a rule and changing it back queues the reminders again (no lost messages)', async () => {
    const twoDays = { enabled: true, channels: ['email'] as ('email')[], days: 2, direction: 'before' as const, anchor: 'start' as const, time: '18:00' };
    const count = async () => (await listMessages(db, tenantId, { status: 'upcoming', type: 'day_before' })).rows.length;
    const before = await count();
    await updatePreferences(db, tenantId, actor, 'messaging', { ...prefs.messaging, live: true, schedules: { ...prefs.messaging.schedules, day_before: { ...twoDays, days: 1, time: '09:00' } } });
    await replanAll(db, tenantId);
    await updatePreferences(db, tenantId, actor, 'messaging', { ...prefs.messaging, live: true, schedules: { ...prefs.messaging.schedules, day_before: twoDays } });
    await replanAll(db, tenantId);
    expect(await count()).toBe(before);
  });

  it('acceptance 4: a text due in quiet hours waits until morning', async () => {
    await updatePreferences(db, tenantId, actor, 'messaging', {
      ...prefs.messaging, live: true, schedules: { ...prefs.messaging.schedules, quality_check: { enabled: true, channels: ['sms'], days: 2, direction: 'before', anchor: 'start', time: '22:30' } },
    });
    await replanAll(db, tenantId);
    const texts = (await listMessages(db, tenantId, { status: 'upcoming', type: 'quality_check' })).rows;
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).format(t.scheduledFor)).toBe('08:00');
    }
  });

  it('cancelling cancels queued messages and sends the cancellation once', async () => {
    const o = await createOrder(db, tenantId, actor, input(sat, '09:00', '12:00'), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'cancel', prefs, { reason: 'Customer changed plans' });
    await dispatchOrder(db, tenantId, o.id);
    const all = await msgs(o.id);
    expect(all.filter((m) => m.status === 'queued')).toHaveLength(0);
    expect(all.filter((m) => m.type === 'cancellation' && m.status === 'sent')).toHaveLength(1);
  });

  it('automations off: automatic messages are logged as skipped, nothing planned', async () => {
    await updatePreferences(db, tenantId, actor, 'messaging', { ...prefs.messaging, live: false });
    const o = await createOrder(db, tenantId, actor, input(sat, '19:00', '21:00'), prefs);
    await transitionOrder(db, tenantId, actor, o.id, 'book', prefs);
    const all = await msgs(o.id);
    expect(all.find((m) => m.type === 'booking_confirmation')).toMatchObject({ status: 'skipped', lastError: 'Automations are off' });
    expect(all.filter((m) => m.status === 'queued')).toHaveLength(0);
  });
});
