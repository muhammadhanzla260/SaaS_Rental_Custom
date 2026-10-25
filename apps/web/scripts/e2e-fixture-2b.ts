/**
 * Fresh quotes for the Phase 2b browser QA (called by e2e-phase2b.mjs):
 *   create   → prints JSON: a quote with a 30% deposit and one with no deposit, each with its customer link
 *   cleanup <orderId…> → cancels them, so the calendar stays clean
 * A random weekday 60–150 days out keeps runs from colliding with each other or the demo.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { addDays, customerSchema, orderSchema, parsePreferences, wallTimeToUtc } from '@rental/core';
import { createCustomer, createDb, createOrder, ensureOrderToken, quoteUrl, transitionOrder, withTenant } from '@rental/db';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });

const [t] = await owner<{ id: string; settings: unknown }[]>`select id, settings from tenants where slug = 'freedom-fun-demo'`;
const [jordan] = await owner<{ id: string }[]>`select id from users where email = 'jordan@demo.tentpole.test'`;
if (!t || !jordan) throw new Error('Run pnpm seed:demo first.');
const actor = { type: 'user' as const, userId: jordan.id };
const prefs = parsePreferences(t.settings);

if (process.argv[2] === 'cleanup') {
  for (const id of process.argv.slice(3)) {
    await transitionOrder(db, t.id, actor, id, 'cancel', prefs, { reason: 'QA run finished' }).catch((e: Error) => console.error(`${id}: ${e.message}`));
  }
} else {
  const email = 'qa-quote@example.test';
  const [found] = await owner<{ id: string }[]>`select id from customers where tenant_id = ${t.id} and email = ${email} limit 1`;
  const customerId = found?.id ?? (await createCustomer(db, t.id, actor, customerSchema.parse({
    firstName: 'Quinn', lastName: 'Tester', email, phone: '512-555-0131', source: 'QA',
    address: { line1: '1100 Congress Ave', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', lat: 30.2747, lng: -97.7404 },
  }))).id;
  const [aus] = await owner<{ id: string }[]>`select id from locations where tenant_id = ${t.id} and code = 'AUS'`;
  const [jenga] = await owner<{ id: string }[]>`select id from products where tenant_id = ${t.id} and sku = 'GM-JENGA'`;
  const day = addDays(new Date().toISOString().slice(0, 10), 60 + Math.floor(Math.random() * 90));
  const make = async (deposit: { kind: 'percent' | 'none'; value: number }) => {
    const o = await createOrder(db, t.id, actor, orderSchema.parse({
      customerId, locationId: aus!.id, eventType: 'Birthday',
      startsAt: wallTimeToUtc(day, '13:00', 'America/Chicago'), endsAt: wallTimeToUtc(day, '17:00', 'America/Chicago'),
      eventAddress: { line1: '1100 Congress Ave', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', lat: 30.2747, lng: -97.7404 }, eventMiles: 4,
      eventContactName: 'Quinn Tester', eventContactMobile: '512-555-0131', contactConfirmed: true,
      lines: [{ productId: jenga!.id, quantity: 1, serviceMode: 'staffed' }],
      deposit,
    }), prefs);
    await transitionOrder(db, t.id, actor, o.id, 'send_quote', prefs);
    const token = await withTenant(db, t.id, (tx) => ensureOrderToken(tx, t.id, o.id));
    return { id: o.id, number: o.number, url: quoteUrl(token) };
  };
  console.log(JSON.stringify({ day, deposit: await make({ kind: 'percent', value: 30 }), noDeposit: await make({ kind: 'none', value: 0 }) }));
}
await app.end();
await owner.end();
