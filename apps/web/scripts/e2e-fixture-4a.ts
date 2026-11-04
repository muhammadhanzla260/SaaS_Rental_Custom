/**
 * A throwaway workspace for the Phase 4a coach-portal browser QA (called by e2e-phase4a.mjs), so the
 * demo workspace gets no test orders:
 *   setup            → prints JSON: workspace, a coach login, a booked order for today (coach + crew on it) and a quote
 *   messages <id>    → prints JSON: the texts and alerts queued for an order
 *   teardown <id>    → deletes the workspace and its people
 *   pnpm --filter @rental/web exec tsx scripts/e2e-fixture-4a.ts setup
 */
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { addDays, customerSchema, orderSchema, parsePreferences, productSchema, utcToWallTime, wallTimeToUtc } from '@rental/core';
import { createCustomer, createDb, createOrder, createProduct, listLocations, setOrderStaff, setupOrganization, transitionOrder } from '@rental/db';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
const PASSWORD = 'Coach-QA-2026!';
const cmd = process.argv[2];

try {
  if (cmd === 'messages') {
    const rows = await owner`select type, status, last_error, meta from messages where order_id = ${process.argv[3]!}::uuid order by created_at`;
    console.log(JSON.stringify(rows));
  } else if (cmd === 'teardown') {
    const id = process.argv[3]!;
    const people = await owner<{ user_id: string }[]>`select user_id from memberships where tenant_id = ${id}::uuid`;
    await owner`delete from audit_log where tenant_id = ${id}::uuid`;
    await owner`delete from tenants where id = ${id}::uuid`;
    for (const p of people) await owner`delete from users where id = ${p.user_id} and email like '%@coach-qa.test'`;
    console.log(JSON.stringify({ ok: true }));
  } else {
    const run = randomUUID().slice(0, 6);
    const mk = async (name: string, role: string) => {
      const id = randomUUID();
      await owner`insert into users (id, name, email, email_verified) values (${id}, ${name}, ${`${role}-${run}@coach-qa.test`}, true)`;
      await owner`insert into accounts (id, account_id, provider_id, user_id, password) values (${randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(PASSWORD)})`;
      return id;
    };
    const ownerId = await mk('QA Owner', 'owner');
    const coachId = await mk('Alex Rivera', 'coach');
    const crewId = await mk('Sam Crew', 'crew');
    const actor = { type: 'user' as const, userId: ownerId };
    const t = await setupOrganization(db, { userId: ownerId }, {
      slug: `coach-qa-${run}`, name: 'Coach QA Rentals',
      location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', region: 'TX', country: 'US', lat: 30.2694, lng: -97.7429 } },
      taxPercent: 8.25,
    });
    await owner`insert into memberships (tenant_id, user_id, role, vehicle) values (${t.id}, ${coachId}, 'coach', 'Van 2 · white Transit'), (${t.id}, ${crewId}, 'crew', null)`;
    const locationId = (await listLocations(db, t.id))[0]!.id;
    const castle = await createProduct(db, t.id, actor, productSchema.parse({ name: 'Castle Bounce House', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 5 } } }));
    const customer = await createCustomer(db, t.id, actor, customerSchema.parse({
      firstName: 'Maria', lastName: 'Gonzalez', email: `maria-${run}@coach-qa.test`, phone: '512-555-0142',
      address: { line1: '1100 Congress Ave', city: 'Austin', region: 'TX', country: 'US', lat: 30.2747, lng: -97.7404 },
    }));
    const prefs = parsePreferences({});
    const today = utcToWallTime(new Date(), 'America/Chicago').date;
    const order = (date: string) => orderSchema.parse({
      customerId: customer.id, locationId, eventType: 'Birthday',
      startsAt: wallTimeToUtc(date, '18:00', 'America/Chicago'), endsAt: wallTimeToUtc(date, '22:00', 'America/Chicago'),
      eventAddress: { line1: '1100 Congress Ave', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', lat: 30.2747, lng: -97.7404 },
      eventContactName: 'Maria', eventContactMobile: '512-555-0198', contactConfirmed: true,
      lines: [{ productId: castle.id, quantity: 1 }],
    });
    const booked = await createOrder(db, t.id, actor, order(today), prefs);
    await transitionOrder(db, t.id, actor, booked.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: booked.depositDueCents / 100 } });
    await setOrderStaff(db, t.id, actor, booked.id, [{ userId: coachId, role: 'coach' }, { userId: crewId, role: 'crew' }]);
    const quote = await createOrder(db, t.id, actor, order(addDays(today, 9)), prefs);
    await transitionOrder(db, t.id, actor, quote.id, 'send_quote', prefs);
    await setOrderStaff(db, t.id, actor, quote.id, [{ userId: coachId, role: 'coach' }]);
    console.log(JSON.stringify({
      tenantId: t.id, slug: t.slug, password: PASSWORD, coachEmail: `coach-${run}@coach-qa.test`, crewEmail: `crew-${run}@coach-qa.test`, ownerEmail: `owner-${run}@coach-qa.test`,
      booked: { id: booked.id, number: booked.number }, quote: { id: quote.id, number: quote.number }, venue: { lat: 30.2747, lng: -97.7404 },
    }));
  }
} finally {
  await app.end();
  await owner.end();
}
