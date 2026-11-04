/**
 * QA B-14: a member limited to some locations sees and changes only those locations' orders,
 * invoices, payments and messages. Row-level security enforces it, so no screen can forget.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { customerSchema, orderSchema, parsePreferences, warehouseStepSchema, wallTimeToUtc } from '@rental/core';
import '../../scripts/env';
import { createDb, setLocationScope, withTenant } from '../client';
import { payments, tenants, users } from '../schema';
import { createCustomer } from './customers';
import { createLocation, listLocations } from './locations';
import { createOrder, getOrder, listOrders, recordPayment, transitionOrder } from './orders';
import { setupOrganization } from './organizations';

const app = createDb(process.env.DATABASE_URL!, { max: 2 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `ls-${run}` };
const prefs = parsePreferences({});
let tenantId = '';
let austin = '';
let dallas = '';
let customerId = '';

const order = (locationId: string, day: number) =>
  orderSchema.parse({
    customerId, locationId, startsAt: wallTimeToUtc(`2027-03-${String(day).padStart(2, '0')}`, '13:00', 'America/Chicago'),
    endsAt: wallTimeToUtc(`2027-03-${String(day).padStart(2, '0')}`, '17:00', 'America/Chicago'),
    eventAddress: { line1: '1 Main St', city: 'Austin', country: 'US' }, lines: [{ name: 'Custom tent', quantity: 1, overridePrice: 200 }],
  });

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'LS Owner', email: `ls-${run}@example.test` });
  const t = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `ls-${run}`, name: 'Scope Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  austin = (await listLocations(db, tenantId))[0]!.id;
  dallas = (await createLocation(db, tenantId, actor, warehouseStepSchema.shape.location.parse({
    name: 'Dallas', code: 'DAL', isActive: true, isPrimary: false, address: { line1: '1 Elm St', city: 'Dallas', country: 'US', lat: 32.78, lng: -96.8 },
  }), 8.25)).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({ firstName: 'Ana', lastName: 'L', email: `ana-${run}@example.test`, address: { country: 'US' } }))).id;
});

afterEach(() => setLocationScope(() => null));

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('location-scoped members (QA B-14)', () => {
  it('see and change only their own locations', async () => {
    const a = await createOrder(db, tenantId, actor, order(austin, 2), prefs);
    const d = await createOrder(db, tenantId, actor, order(dallas, 3), prefs);
    await transitionOrder(db, tenantId, actor, d.id, 'book', prefs);
    await recordPayment(db, tenantId, actor, d.id, prefs, { method: 'cash', amount: 50 });

    setLocationScope(() => [austin]);
    const seen = (await listOrders(db, tenantId, {})).map((o) => o.id);
    expect(seen).toContain(a.id);
    expect(seen).not.toContain(d.id);
    expect(await getOrder(db, tenantId, d.id)).toBeNull();
    expect(await withTenant(db, tenantId, (tx) => tx.select().from(payments).where(sql`${payments.orderId} = ${d.id}::uuid`))).toEqual([]);
    await expect(createOrder(db, tenantId, actor, order(dallas, 4), prefs)).rejects.toThrow();

    // Everyone else (and the worker) still sees every location.
    setLocationScope(() => null);
    expect((await listOrders(db, tenantId, {})).map((o) => o.id)).toEqual(expect.arrayContaining([a.id, d.id]));
  });
});
