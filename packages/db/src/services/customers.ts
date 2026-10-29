import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { CREDIT_KINDS, customerSchema, type CreditInput, type CustomerAddressInput, type CustomerInput } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { creditApplications, credits, customerAddresses, customers, orders } from '../schema';
import { audit, diff, type Actor } from './audit';
import { OrgError } from './errors';

export type Customer = typeof customers.$inferSelect;
export type CustomerAddress = typeof customerAddresses.$inferSelect;

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
  referredByCustomerId: c.referredByCustomerId ?? null,
  notes: c.notes ?? null,
  tags: [...new Set(c.tags)],
  smsOptIn: c.smsOptIn,
  marketingOptIn: c.marketingOptIn,
  taxExempt: c.taxExempt,
});

// Per-customer order figures, computed in SQL within the same tenant.
const stat = {
  orderCount: sql<number>`(select count(*)::int from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status <> 'cancelled')`,
  bookedCount: sql<number>`(select count(*)::int from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status in ('booked','completed'))`,
  lifetimeCents: sql<string>`(select coalesce(sum(o.total_cents),0)::text from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status in ('booked','completed'))`,
  balanceCents: sql<string>`(select coalesce(sum(greatest(o.total_cents - o.paid_cents, 0)),0)::text from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status in ('booked','completed'))`,
  lastEventAt: sql<string | null>`(select max(o.event_starts_at)::text from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status <> 'cancelled')`,
  lastStatus: sql<string | null>`(select o.status from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status <> 'cancelled' order by o.event_starts_at desc limit 1)`,
};
const isRepeat = sql`(select count(*) from orders o where o.tenant_id = customers.tenant_id and o.customer_id = customers.id and o.status in ('booked','completed')) >= 2`;

export type CustomerFilter = 'all' | 'people' | 'organizations' | 'repeat';

function searchWhere(search: string): SQL | undefined {
  const q = search.trim();
  if (!q) return undefined;
  const digits = q.replace(/\D/g, '');
  return or(
    ilike(customers.displayName, `%${q}%`),
    ilike(customers.companyName, `%${q}%`),
    ilike(customers.email, `%${q}%`),
    digits.length >= 3 ? ilike(customers.phone, `%${digits}%`) : undefined,
  );
}

/** Search by name, company, email or phone digits; filter chips with counts. */
export function listCustomers(db: Db, tenantId: string, opts: { search?: string; filter?: CustomerFilter; limit?: number } = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const base = and(eq(customers.tenantId, tenantId), searchWhere(opts.search ?? ''));
    const filterWhere: Record<CustomerFilter, SQL | undefined> = {
      all: undefined,
      people: eq(customers.kind, 'individual'),
      organizations: eq(customers.kind, 'organization'),
      repeat: isRepeat,
    };
    const rows = await tx
      .select({ customer: customers, ...stat })
      .from(customers)
      .where(and(base, filterWhere[opts.filter ?? 'all']))
      .orderBy(desc(customers.updatedAt))
      .limit(opts.limit ?? 100);
    const [counts] = await tx
      .select({
        all: sql<number>`count(*)::int`,
        people: sql<number>`(count(*) filter (where ${customers.kind} = 'individual'))::int`,
        organizations: sql<number>`(count(*) filter (where ${customers.kind} = 'organization'))::int`,
        repeat: sql<number>`(count(*) filter (where ${isRepeat}))::int`,
      })
      .from(customers)
      .where(base);
    return {
      rows: rows.map((r) => ({
        ...r.customer,
        orderCount: r.orderCount,
        repeat: r.bookedCount >= 2,
        lifetimeCents: Number(r.lifetimeCents),
        balanceCents: Number(r.balanceCents),
        lastEventAt: r.lastEventAt,
        lastStatus: r.lastStatus,
      })),
      counts: counts ?? { all: 0, people: 0, organizations: 0, repeat: 0 },
    };
  });
}
export type CustomerListRow = Awaited<ReturnType<typeof listCustomers>>['rows'][number];

/** Credits with what is left on each (orders that were cancelled give their share back). */
async function openCredits(tx: Tx, tenantId: string, customerIds: string[], exceptOrderId?: string | null) {
  if (!customerIds.length) return [];
  const used = sql<string>`(select coalesce(sum(a.amount_cents),0)::text from credit_applications a
    join orders o on o.tenant_id = a.tenant_id and o.id = a.order_id
    where a.tenant_id = credits.tenant_id and a.credit_id = credits.id and o.status <> 'cancelled'
    ${exceptOrderId ? sql`and a.order_id <> ${exceptOrderId}::uuid` : sql``})`;
  const rows = await tx
    .select({ credit: credits, used })
    .from(credits)
    .where(and(eq(credits.tenantId, tenantId), inArray(credits.customerId, customerIds), isNull(credits.voidedAt)))
    .orderBy(asc(credits.createdAt));
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const balanceCents = Math.max(0, r.credit.amountCents - Number(r.used));
    const expired = !!r.credit.validUntil && r.credit.validUntil < today;
    return { ...r.credit, balanceCents, expired, label: CREDIT_KINDS[r.credit.kind as keyof typeof CREDIT_KINDS]?.label ?? 'Credit' };
  });
}
export type CustomerCredit = Awaited<ReturnType<typeof openCredits>>[number];

/** Credits a customer can still use on `exceptOrderId` (its own applications count as free). */
export function usableCredits(db: Db, tenantId: string, customerId: string, exceptOrderId?: string | null) {
  return withTenant(db, tenantId, async (tx) => usableCreditsTx(tx, tenantId, customerId, exceptOrderId));
}

export async function usableCreditsTx(tx: Tx, tenantId: string, customerId: string, exceptOrderId?: string | null) {
  return (await openCredits(tx, tenantId, [customerId], exceptOrderId)).filter((c) => c.balanceCents > 0 && !c.expired);
}

export function getCustomer(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ customer: customers, ...stat })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
      .limit(1);
    if (!row) return null;
    const [history, addresses, creditRows, referrer] = await Promise.all([
      tx
        .select({ id: orders.id, number: orders.number, status: orders.status, eventStartsAt: orders.eventStartsAt, totalCents: orders.totalCents, paidCents: orders.paidCents })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, id)))
        .orderBy(desc(orders.eventStartsAt))
        .limit(200),
      tx
        .select()
        .from(customerAddresses)
        .where(and(eq(customerAddresses.tenantId, tenantId), eq(customerAddresses.customerId, id)))
        .orderBy(asc(customerAddresses.kind), asc(customerAddresses.label)),
      openCredits(tx, tenantId, [id]),
      row.customer.referredByCustomerId
        ? tx
            .select({ id: customers.id, name: customers.displayName })
            .from(customers)
            .where(and(eq(customers.tenantId, tenantId), eq(customers.id, row.customer.referredByCustomerId)))
            .limit(1)
        : Promise.resolve([] as { id: string; name: string | null }[]),
    ]);
    return {
      ...row.customer,
      orderCount: row.orderCount,
      repeat: row.bookedCount >= 2,
      lifetimeCents: Number(row.lifetimeCents),
      balanceCents: Number(row.balanceCents),
      lastEventAt: row.lastEventAt,
      orders: history,
      addresses,
      credits: creditRows,
      referredBy: referrer[0] ?? null,
    };
  });
}
export type CustomerProfile = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** Possible duplicates: same email or same phone. */
export function findDuplicateCustomers(db: Db, tenantId: string, email?: string, phone?: string, exceptId?: string) {
  return withTenant(db, tenantId, async (tx) => {
    const conds = [email ? eq(customers.email, email) : undefined, phone ? eq(customers.phone, phone) : undefined].filter(Boolean);
    if (!conds.length) return [];
    return tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), or(...conds), exceptId ? ne(customers.id, exceptId) : undefined))
      .limit(5);
  });
}

async function checkReferrer(tx: Tx, tenantId: string, input: CustomerInput, selfId?: string) {
  if (!input.referredByCustomerId) return;
  if (input.referredByCustomerId === selfId) throw new OrgError('A customer cannot refer themselves.', 'invalid');
  const [r] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, input.referredByCustomerId)))
    .limit(1);
  if (!r) throw new OrgError('The referring customer was not found.', 'invalid');
}

export function createCustomer(db: Db, tenantId: string, actor: Actor, input: CustomerInput) {
  return withTenant(db, tenantId, async (tx) => createCustomerTx(tx, tenantId, actor, input));
}

export async function createCustomerTx(tx: Tx, tenantId: string, actor: Actor, input: CustomerInput) {
  await checkReferrer(tx, tenantId, input);
  const [c] = await tx.insert(customers).values({ tenantId, ...values(input) }).returning();
  await audit(tx, tenantId, actor, { type: 'customer', id: c!.id }, 'customer.created', { name: c!.displayName });
  return c!;
}

export function updateCustomer(db: Db, tenantId: string, actor: Actor, id: string, input: CustomerInput) {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id))).limit(1);
    if (!before) throw new OrgError('Customer not found.', 'not_found');
    await checkReferrer(tx, tenantId, input, id);
    const [after] = await tx.update(customers).set(values(input)).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id))).returning();
    const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
    delete changes.updatedAt;
    delete changes.displayName;
    if (Object.keys(changes).length) await audit(tx, tenantId, actor, { type: 'customer', id }, 'customer.updated', changes);
    return after!;
  });
}

/** Message preferences only (the toggles on the profile). */
export function setCustomerMessaging(db: Db, tenantId: string, actor: Actor, id: string, prefs: { smsOptIn?: boolean; marketingOptIn?: boolean }) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.update(customers).set(prefs).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id))).returning();
    if (!c) throw new OrgError('Customer not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'customer', id }, 'customer.updated', prefs);
    return c;
  });
}

// --- saved addresses --------------------------------------------------------------------------

export function saveCustomerAddress(db: Db, tenantId: string, actor: Actor, customerId: string, input: CustomerAddressInput, id?: string | null) {
  return withTenant(db, tenantId, async (tx) => saveCustomerAddressTx(tx, tenantId, actor, customerId, input, id));
}

export async function saveCustomerAddressTx(tx: Tx, tenantId: string, actor: Actor, customerId: string, input: CustomerAddressInput, id?: string | null) {
  const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))).limit(1);
  if (!c) throw new OrgError('Customer not found.', 'not_found');
  const a = input.address;
  const row = {
    label: input.label, kind: input.kind, line1: a.line1 ?? null, line2: a.line2 ?? null, city: a.city ?? null, region: a.region ?? null,
    postalCode: a.postalCode ?? null, country: a.country, lat: a.lat ?? null, lng: a.lng ?? null,
  };
  const [saved] = id
    ? await tx
        .update(customerAddresses)
        .set(row)
        .where(and(eq(customerAddresses.tenantId, tenantId), eq(customerAddresses.customerId, customerId), eq(customerAddresses.id, id)))
        .returning()
    : await tx.insert(customerAddresses).values({ tenantId, customerId, ...row }).returning();
  if (!saved) throw new OrgError('Address not found.', 'not_found');
  await audit(tx, tenantId, actor, { type: 'customer', id: customerId }, id ? 'customer.address_updated' : 'customer.address_added', { label: input.label });
  return saved;
}

export function removeCustomerAddress(db: Db, tenantId: string, actor: Actor, customerId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [a] = await tx
      .delete(customerAddresses)
      .where(and(eq(customerAddresses.tenantId, tenantId), eq(customerAddresses.customerId, customerId), eq(customerAddresses.id, id)))
      .returning();
    if (!a) throw new OrgError('Address not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'customer', id: customerId }, 'customer.address_removed', { label: a.label });
  });
}

// --- credits ------------------------------------------------------------------------------------

export function createCredit(db: Db, tenantId: string, actor: Actor, customerId: string, input: CreditInput, sourceOrderId?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId))).limit(1);
    if (!c) throw new OrgError('Customer not found.', 'not_found');
    const prefix = `${CREDIT_KINDS[input.kind].prefix}-`;
    const [num] = (await tx.execute<{ number: string }>(sql`select app_next_number(${`credit:${prefix}`}, ${prefix}, 4) as number`)) as unknown as [
      { number: string },
    ];
    const [credit] = await tx
      .insert(credits)
      .values({
        tenantId, customerId, kind: input.kind, code: num.number, amountCents: Math.round(input.amount * 100), reason: input.reason ?? null,
        validUntil: input.validUntil, sourceOrderId: sourceOrderId ?? null, createdByUserId: actor.userId ?? null,
      })
      .returning();
    await audit(tx, tenantId, actor, { type: 'customer', id: customerId }, 'credit.created', { code: credit!.code, amountCents: credit!.amountCents, kind: input.kind });
    return credit!;
  });
}

export function voidCredit(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [inUse] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(creditApplications)
      .innerJoin(orders, and(eq(orders.tenantId, creditApplications.tenantId), eq(orders.id, creditApplications.orderId)))
      .where(and(eq(creditApplications.tenantId, tenantId), eq(creditApplications.creditId, id), inArray(orders.status, ['draft', 'quote_sent', 'booked'])));
    if ((inUse?.n ?? 0) > 0) throw new OrgError('This credit is applied to an open order. Remove it from the order first.', 'invalid');
    const [c] = await tx
      .update(credits)
      .set({ voidedAt: new Date() })
      .where(and(eq(credits.tenantId, tenantId), eq(credits.id, id), isNull(credits.voidedAt)))
      .returning();
    if (!c) throw new OrgError('Credit not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'customer', id: c.customerId }, 'credit.voided', { code: c.code });
    return c;
  });
}

// --- import ---------------------------------------------------------------------------------------

export type ImportResult = { created: number; skipped: { row: number; reason: string }[] };

/**
 * Create customers from parsed CSV rows. Rows that fail validation or match an
 * existing customer's email or phone are skipped and reported back (row numbers
 * count the header as row 1).
 */
export function importCustomers(db: Db, tenantId: string, actor: Actor, rows: Record<string, unknown>[]): Promise<ImportResult> {
  return withTenant(db, tenantId, async (tx) => {
    const skipped: ImportResult['skipped'] = [];
    let created = 0;
    const seenEmail = new Set<string>();
    const seenPhone = new Set<string>();
    for (const [i, raw] of rows.entries()) {
      const parsed = customerSchema.safeParse(raw);
      if (!parsed.success) {
        skipped.push({ row: i + 2, reason: parsed.error.issues[0]?.message ?? 'Invalid row' });
        continue;
      }
      const input = { ...parsed.data, referredByCustomerId: null };
      const email = input.email?.toLowerCase();
      if ((email && seenEmail.has(email)) || (input.phone && seenPhone.has(input.phone))) {
        skipped.push({ row: i + 2, reason: 'Same email or phone as an earlier row' });
        continue;
      }
      const conds = [email ? eq(customers.email, email) : undefined, input.phone ? eq(customers.phone, input.phone) : undefined].filter(Boolean);
      const [dupe] = await tx
        .select({ name: customers.displayName })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), or(...conds)))
        .limit(1);
      if (dupe) {
        skipped.push({ row: i + 2, reason: `Already a customer (${dupe.name})` });
        continue;
      }
      await tx.insert(customers).values({ tenantId, ...values(input) });
      if (email) seenEmail.add(email);
      if (input.phone) seenPhone.add(input.phone);
      created++;
    }
    if (created) await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, 'customer.imported', { created, skipped: skipped.length });
    return { created, skipped };
  });
}
