import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { CustomerInput } from '@rental/core';
import { withTenant, type Db } from '../client';
import { customers, orders } from '../schema';
import { audit, diff, type Actor } from './audit';
import { OrgError } from './errors';

export type Customer = typeof customers.$inferSelect;

const values = (c: CustomerInput) => ({
  kind: c.kind,
  firstName: c.firstName ?? null,
  lastName: c.lastName ?? null,
  companyName: c.companyName ?? null,
  email: c.email ?? null,
  phone: c.phone ?? null,
  phoneSecondary: c.phoneSecondary ?? null,
  line1: c.address.line1 ?? null,
  line2: c.address.line2 ?? null,
  city: c.address.city ?? null,
  region: c.address.region ?? null,
  postalCode: c.address.postalCode ?? null,
  country: c.address.country,
  lat: c.address.lat ?? null,
  lng: c.address.lng ?? null,
  source: c.source ?? null,
  notes: c.notes ?? null,
  smsOptIn: c.smsOptIn,
  taxExempt: c.taxExempt,
});

/** Search by name, company, email or phone digits. */
export function listCustomers(db: Db, tenantId: string, search = '', limit = 50) {
  return withTenant(db, tenantId, async (tx) => {
    const q = search.trim();
    const digits = q.replace(/\D/g, '');
    const where = q
      ? or(
          ilike(customers.displayName, `%${q}%`),
          ilike(customers.companyName, `%${q}%`),
          ilike(customers.email, `%${q}%`),
          digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined,
        )
      : undefined;
    const rows = await tx
      .select({
        customer: customers,
        orderCount: sql<number>`(select count(*)::int from orders o where o.tenant_id = ${customers.tenantId} and o.customer_id = ${customers.id})`,
        lastEventAt: sql<string | null>`(select max(o.event_starts_at) from orders o where o.tenant_id = ${customers.tenantId} and o.customer_id = ${customers.id} and o.status <> 'cancelled')`,
        bookedCents: sql<number>`(select coalesce(sum(o.total_cents),0)::bigint from orders o where o.tenant_id = ${customers.tenantId} and o.customer_id = ${customers.id} and o.status in ('booked','completed'))`,
      })
      .from(customers)
      .where(where)
      .orderBy(desc(customers.updatedAt))
      .limit(limit);
    return rows.map((r) => ({ ...r.customer, orderCount: r.orderCount, lastEventAt: r.lastEventAt, bookedCents: Number(r.bookedCents) }));
  });
}

export function getCustomer(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!c) return null;
    const history = await tx
      .select({ id: orders.id, number: orders.number, status: orders.status, eventStartsAt: orders.eventStartsAt, totalCents: orders.totalCents })
      .from(orders)
      .where(eq(orders.customerId, id))
      .orderBy(desc(orders.eventStartsAt));
    return { ...c, orders: history };
  });
}

/** Possible duplicates: same email or same phone. */
export function findDuplicateCustomers(db: Db, tenantId: string, email?: string, phone?: string, exceptId?: string) {
  return withTenant(db, tenantId, async (tx) => {
    const conds = [email ? eq(customers.email, email) : undefined, phone ? eq(customers.phone, phone) : undefined].filter(Boolean);
    if (!conds.length) return [];
    const rows = await tx.select().from(customers).where(or(...conds)).limit(5);
    return rows.filter((r) => r.id !== exceptId);
  });
}

export function createCustomer(db: Db, tenantId: string, actor: Actor, input: CustomerInput) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.insert(customers).values({ tenantId, ...values(input) }).returning();
    await audit(tx, tenantId, actor, { type: 'customer', id: c!.id }, 'customer.created', { name: c!.displayName });
    return c!;
  });
}

export function updateCustomer(db: Db, tenantId: string, actor: Actor, id: string, input: CustomerInput) {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(customers).where(eq(customers.id, id)).limit(1);
    if (!before) throw new OrgError('Customer not found.', 'not_found');
    const [after] = await tx.update(customers).set(values(input)).where(and(eq(customers.id, id))).returning();
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    delete changes.updatedAt;
    delete changes.displayName;
    if (Object.keys(changes).length) await audit(tx, tenantId, actor, { type: 'customer', id }, 'customer.updated', changes);
    return after!;
  });
}
