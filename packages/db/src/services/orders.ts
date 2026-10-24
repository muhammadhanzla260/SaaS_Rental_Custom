import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import {
  quoteOrder, renderPrefix, sequenceScope, toCents,
  type DocumentKind, type OrderInput, type OrderStatus, type TenantPreferences,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { customers, locations, orderLines, orders, products, reservations, taxRates } from '../schema';
import { audit, type Actor } from './audit';
import { pricingOf } from './catalog';
import { OrgError } from './errors';

export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;

/** Price an order with the shared engine, loading products, tax and setup fees. */
async function priceOrder(tx: Tx, input: OrderInput, prefs: TenantPreferences) {
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const rows = ids.length ? await tx.select().from(products).where(inArray(products.id, ids)) : [];
  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const l of input.lines) if (!byId.has(l.productId)) throw new OrgError('A product on this order no longer exists.', 'invalid');

  let taxPercent = input.taxPercent ?? 0;
  if (!input.taxOverridden) {
    const [rate] = await tx
      .select({ rate: taxRates.rate })
      .from(taxRates)
      .where(and(eq(taxRates.locationId, input.locationId), eq(taxRates.isDefault, true)))
      .limit(1);
    taxPercent = rate ? Number(rate.rate) : prefs.booking.defaultTaxPercent;
  }
  const surfaceFee = (code?: string | null) => prefs.booking.setupSurfaces.find((s) => s.code === code)?.feeCents ?? 0;

  const quote = quoteOrder({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    multiDay: input.multiDay,
    lines: input.lines.map((l) => {
      const p = byId.get(l.productId)!;
      return {
        productId: p.id,
        name: p.name,
        pricing: pricingOf(p),
        minHours: p.minHours,
        serviceMode: l.serviceMode,
        quantity: l.quantity,
        flatRate: l.flatRate,
        overrideUnitCents: l.overridePrice == null ? null : toCents(l.overridePrice),
        setupSurfaceFeeCents: surfaceFee(l.setupSurface),
      };
    }),
    damageWaiver: { enabled: input.damageWaiver, percent: prefs.booking.damageWaiverPercent },
    travelFeeCents: toCents(input.travelFee),
    miscFeesCents: toCents(input.miscFees),
    discount: input.discount && input.discount.value > 0 ? input.discount : null,
    couponCents: toCents(input.coupon),
    taxPercent,
    deposit: input.deposit,
    defaultDepositPercent: prefs.booking.depositPercent,
  });
  return { quote, taxPercent, byId };
}

function orderValues(input: OrderInput, priced: Awaited<ReturnType<typeof priceOrder>>, prefs: TenantPreferences) {
  const s = priced.quote.summary;
  const a = input.eventAddress;
  return {
    locationId: input.locationId,
    customerId: input.customerId,
    eventType: input.eventType ?? null,
    eventStartsAt: input.startsAt,
    eventEndsAt: input.endsAt,
    multiDay: input.multiDay,
    eventSameAsBilling: input.eventSameAsBilling,
    eventLocationName: input.eventLocationName ?? null,
    eventLine1: a.line1 ?? null,
    eventLine2: a.line2 ?? null,
    eventCity: a.city ?? null,
    eventRegion: a.region ?? null,
    eventPostalCode: a.postalCode ?? null,
    eventCountry: a.country,
    eventLat: a.lat ?? null,
    eventLng: a.lng ?? null,
    eventContactName: input.eventContactName ?? null,
    eventContactMobile: input.eventContactMobile ?? null,
    eventContactEmail: input.eventContactEmail ?? null,
    damageWaiver: input.damageWaiver,
    damageWaiverPercent: prefs.booking.damageWaiverPercent,
    travelFeeCents: toCents(input.travelFee),
    travelFeeOverridden: input.travelFeeOverridden,
    travelInfo: input.travelInfo ?? null,
    miscFeesCents: toCents(input.miscFees),
    discountKind: input.discount && input.discount.value > 0 ? input.discount.kind : null,
    discountValue: input.discount && input.discount.value > 0 ? input.discount.value : null,
    discountAfterTax: !!input.discount?.afterTax,
    couponCode: input.couponCode ?? null,
    couponCents: toCents(input.coupon),
    taxPercent: priced.taxPercent,
    taxOverridden: input.taxOverridden,
    depositKind: input.deposit.kind,
    depositValue: input.deposit.value,
    merchandiseCents: s.merchandiseCents,
    extrasCents: s.extrasCents,
    discountCents: s.preTaxDiscountCents + s.couponCents + s.postTaxDiscountCents,
    taxCents: s.taxCents,
    totalCents: s.totalCents,
    depositDueCents: s.depositCents,
    summary: { ...s, hours: priced.quote.hours },
    source: input.source ?? null,
    internalNotes: input.internalNotes ?? null,
    customerNotes: input.customerNotes ?? null,
  };
}

async function writeLines(tx: Tx, tenantId: string, orderId: string, input: OrderInput, priced: Awaited<ReturnType<typeof priceOrder>>) {
  await tx.delete(orderLines).where(eq(orderLines.orderId, orderId));
  if (!priced.quote.lines.length) return [];
  return tx
    .insert(orderLines)
    .values(
      priced.quote.lines.map((l, i) => ({
        tenantId,
        orderId,
        productId: l.productId,
        name: l.name,
        serviceMode: l.serviceMode,
        quantity: l.quantity,
        unitCents: l.unitCents,
        autoUnitCents: l.autoUnitCents,
        priceOverridden: l.overridden,
        flatRate: l.flatRate,
        setupSurface: input.lines[i]?.setupSurface ?? null,
        setupSurfaceFeeCents: l.setupSurfaceFeeCents,
        lineTotalCents: l.lineTotalCents,
        pricingTrace: l.trace,
        sort: i,
      })),
    )
    .returning();
}

/** Hold every line's equipment; throws a friendly error naming what is not free. */
async function reserveAll(tx: Tx, order: Order, lines: OrderLine[], prefs: TenantPreferences) {
  await tx.delete(reservations).where(eq(reservations.orderId, order.id));
  const prodIds = [...new Set(lines.map((l) => l.productId))];
  const prods = prodIds.length ? await tx.select().from(products).where(inArray(products.id, prodIds)) : [];
  for (const line of lines) {
    const p = prods.find((x) => x.id === line.productId)!;
    const turnaround = p.turnaroundMinutes ?? prefs.booking.cleanupBufferMinutes;
    const blockedUntil = new Date(order.eventEndsAt.getTime() + turnaround * 60_000);
    try {
      await tx.execute(sql`select app_reserve_inventory(${order.id}::uuid, ${line.id}::uuid, ${line.productId}::uuid, ${order.locationId}::uuid,
        ${line.quantity}::int, ${order.eventStartsAt.toISOString()}::timestamptz, ${order.eventEndsAt.toISOString()}::timestamptz,
        ${blockedUntil.toISOString()}::timestamptz)`);
    } catch (e) {
      const cause = (e as { cause?: { message?: string; detail?: string } }).cause;
      if (cause?.message?.includes('NOT_AVAILABLE')) {
        const d = JSON.parse(cause.detail ?? '{}') as { owned?: number; held?: number; requested?: number };
        const left = Math.max(0, (d.owned ?? 0) - (d.held ?? 0));
        throw new OrgError(
          `${line.name} is not available then: ${left === 0 ? 'all' : `only ${left} of`} ${d.owned} already booked for that time (including the cleanup time after each rental).`,
          'invalid',
        );
      }
      throw e;
    }
  }
}

/** Next document number for a location: Q-AUS-01042 (prefix template from Settings, own counter per prefix). */
export async function nextDocumentNumber(tx: Tx, kind: DocumentKind, prefs: TenantPreferences, locationId: string): Promise<string> {
  const [loc] = await tx.select({ code: locations.code }).from(locations).where(eq(locations.id, locationId)).limit(1);
  const prefix = renderPrefix(prefs.numbering[`${kind}Prefix`], { loc: loc?.code ?? '' });
  const padding = prefs.numbering[`${kind}Padding`];
  const [row] = (await tx.execute<{ number: string }>(
    sql`select app_next_number(${sequenceScope(kind, prefix)}, ${prefix}, ${padding}::int) as number`,
  )) as unknown as [{ number: string }];
  return row.number;
}

export function createOrder(db: Db, tenantId: string, actor: Actor, input: OrderInput, prefs: TenantPreferences) {
  return withTenant(db, tenantId, async (tx) => {
    const priced = await priceOrder(tx, input, prefs);
    const number = await nextDocumentNumber(tx, 'quote', prefs, input.locationId);
    const [order] = await tx
      .insert(orders)
      .values({ tenantId, number, status: 'draft', createdByUserId: actor.userId ?? null, ...orderValues(input, priced, prefs) })
      .returning();
    await writeLines(tx, tenantId, order!.id, input, priced);
    await audit(tx, tenantId, actor, { type: 'order', id: order!.id }, 'order.created', { number, totalCents: order!.totalCents });
    return order!;
  });
}

export function updateOrder(db: Db, tenantId: string, actor: Actor, id: string, input: OrderInput, prefs: TenantPreferences, expectedVersion?: number) {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(orders).where(eq(orders.id, id)).for('update').limit(1);
    if (!before) throw new OrgError('Order not found.', 'not_found');
    if (expectedVersion != null && before.version !== expectedVersion) {
      throw new OrgError('Someone else changed this order a moment ago. Reload to see their changes.', 'invalid');
    }
    if (before.status === 'cancelled' || before.status === 'completed') throw new OrgError(`A ${before.status} order cannot be changed.`, 'invalid');
    const priced = await priceOrder(tx, input, prefs);
    const [order] = await tx
      .update(orders)
      .set({ ...orderValues(input, priced, prefs), version: before.version + 1 })
      .where(eq(orders.id, id))
      .returning();
    const lines = await writeLines(tx, tenantId, id, input, priced);
    // A booked order keeps its equipment: re-hold for the new items and times.
    if (order!.status === 'booked') await reserveAll(tx, order!, lines, prefs);
    await audit(tx, tenantId, actor, { type: 'order', id }, 'order.updated', {
      totalCents: { from: before.totalCents, to: order!.totalCents },
      ...(before.eventStartsAt.getTime() !== order!.eventStartsAt.getTime() ? { startsAt: { from: before.eventStartsAt, to: order!.eventStartsAt } } : {}),
    });
    return order!;
  });
}

export type OrderAction = 'send_quote' | 'book' | 'complete' | 'cancel' | 'reopen';

const ALLOWED: Record<OrderAction, OrderStatus[]> = {
  send_quote: ['draft'],
  book: ['draft', 'quote_sent'],
  complete: ['booked'],
  cancel: ['draft', 'quote_sent', 'booked'],
  reopen: ['cancelled'],
};

export function transitionOrder(db: Db, tenantId: string, actor: Actor, id: string, action: OrderAction, prefs: TenantPreferences, reason?: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update').limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    if (!ALLOWED[action].includes(order.status as OrderStatus)) throw new OrgError(`This order is ${order.status.replace('_', ' ')}; that step is not possible now.`, 'invalid');
    const now = new Date();
    let set: Partial<typeof orders.$inferInsert> = {};
    if (action === 'send_quote') set = { status: 'quote_sent', quoteSentAt: now };
    if (action === 'book') {
      const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.sort));
      if (!lines.length) throw new OrgError('Add at least one item before booking.', 'invalid');
      await reserveAll(tx, order, lines, prefs);
      set = { status: 'booked', bookedAt: now };
    }
    if (action === 'complete') set = { status: 'completed' };
    if (action === 'cancel') {
      await tx.delete(reservations).where(eq(reservations.orderId, id));
      set = { status: 'cancelled', cancelledAt: now, cancelReason: reason ?? null };
    }
    if (action === 'reopen') set = { status: 'draft', cancelledAt: null, cancelReason: null };
    const [after] = await tx.update(orders).set({ ...set, version: order.version + 1 }).where(eq(orders.id, id)).returning();
    await audit(tx, tenantId, actor, { type: 'order', id }, `order.${action}`, { from: order.status, to: after!.status, ...(reason ? { reason } : {}) });
    return after!;
  });
}

export function getOrder(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return null;
    const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.sort));
    const [customer] = await tx.select().from(customers).where(eq(customers.id, order.customerId)).limit(1);
    return { ...order, lines, customer: customer! };
  });
}

export type OrderListFilters = { status?: OrderStatus | 'open' | 'all'; search?: string; from?: Date; to?: Date; customerId?: string; limit?: number };

export function listOrders(db: Db, tenantId: string, f: OrderListFilters = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const conds = [
      f.status && f.status !== 'all'
        ? f.status === 'open'
          ? inArray(orders.status, ['draft', 'quote_sent', 'booked'])
          : eq(orders.status, f.status)
        : undefined,
      f.from ? gte(orders.eventStartsAt, f.from) : undefined,
      f.to ? lt(orders.eventStartsAt, f.to) : undefined,
      f.customerId ? eq(orders.customerId, f.customerId) : undefined,
      f.search
        ? or(ilike(orders.number, `%${f.search}%`), ilike(customers.displayName, `%${f.search}%`), ilike(orders.eventCity, `%${f.search}%`), ilike(orders.eventLine1, `%${f.search}%`))
        : undefined,
    ].filter(Boolean);
    const rows = await tx
      .select({
        order: orders,
        customerName: customers.displayName,
        customerPhone: customers.phone,
        locationName: locations.name,
        items: sql<string>`(select string_agg(l.name || case when l.quantity > 1 then ' x' || l.quantity else '' end, ', ' order by l.sort) from order_lines l where l.tenant_id = ${orders.tenantId} and l.order_id = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
      .innerJoin(locations, and(eq(locations.tenantId, orders.tenantId), eq(locations.id, orders.locationId)))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(f.from ? asc(orders.eventStartsAt) : desc(orders.eventStartsAt))
      .limit(f.limit ?? 200);
    return rows.map((r) => ({ ...r.order, customerName: r.customerName ?? '', customerPhone: r.customerPhone, locationName: r.locationName, items: r.items ?? '' }));
  });
}

/** Numbers for the dashboard, in the tenant's time zone. */
export function orderStats(db: Db, tenantId: string, timezone: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx.execute<{
      upcoming: number; this_week: number; quotes_open: number; booked_month_cents: string; next_event: string | null;
    }>(sql`
      with b as (
        select (date_trunc('week', now() at time zone ${timezone}) at time zone ${timezone}) as week_start,
               (date_trunc('month', now() at time zone ${timezone}) at time zone ${timezone}) as month_start
      )
      select
        (select count(*)::int from orders where status = 'booked' and event_starts_at >= now()) as upcoming,
        (select count(*)::int from orders, b where status in ('booked','completed') and event_starts_at >= b.week_start and event_starts_at < b.week_start + interval '7 days') as this_week,
        (select count(*)::int from orders where status in ('draft','quote_sent')) as quotes_open,
        (select coalesce(sum(total_cents),0)::text from orders, b where status in ('booked','completed') and booked_at >= b.month_start) as booked_month_cents,
        (select min(event_starts_at)::text from orders where status = 'booked' and event_starts_at >= now()) as next_event`);
    return {
      upcoming: row?.upcoming ?? 0,
      thisWeek: row?.this_week ?? 0,
      quotesOpen: row?.quotes_open ?? 0,
      bookedThisMonthCents: Number(row?.booked_month_cents ?? 0),
      nextEvent: row?.next_event ? new Date(row.next_event) : null,
    };
  });
}

