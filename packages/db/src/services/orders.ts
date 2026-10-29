import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  basePackageCents, cancelSchema, extraRateOf, lockedPricing, parseLocationSettings, quoteOrder, renderPrefix, rescheduleSchema, sequenceScope, toCents, travelFee,
  type BookingInput, type CancelInput, type CancelOutcome, type DocumentKind, type RescheduleInput, type OrderInput, type OrderStatus, type ServiceMode, type TenantPreferences,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import {
  coupons, creditApplications, credits, customers, invoices, locations, memberships, orderLines, orderVersions, orders, payments, productLocationPrices,
  products, refunds, reservations, taxRates, users,
} from '../schema';
import { audit, type Actor } from './audit';
import { pricingOf, type LocationPrice } from './catalog';
import { usableCreditsTx } from './customers';
import { OrgError } from './errors';
import { enqueueOfficeAlert, enqueueOrderMessage, enqueuePaymentConfirmation, ensureOrderToken, planOrderMessages } from './messaging';
import { billingOrder, rainCheckUntil, syncInvoices } from './money';

export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type OrderVersion = typeof orderVersions.$inferSelect;

// --- pricing --------------------------------------------------------------------------------

type CouponCheck = { ok: true; id: string; code: string; kind: 'percent' | 'amount'; value: number; label: string } | { ok: false; message: string };

/** Is `code` usable on an order now? (active, inside its dates, uses left; this order's own use doesn't count) */
async function checkCoupon(tx: Tx, tenantId: string, code: string, orderId?: string | null): Promise<CouponCheck> {
  const [c] = await tx.select().from(coupons).where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, code.trim()))).limit(1);
  if (!c || !c.active) return { ok: false, message: 'Not a valid code' };
  const today = new Date().toISOString().slice(0, 10);
  if (c.validFrom && today < c.validFrom) return { ok: false, message: `Valid from ${c.validFrom}` };
  if (c.validUntil && today > c.validUntil) return { ok: false, message: 'This code has expired' };
  if (c.maxUses) {
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.couponId, c.id), ne(orders.status, 'cancelled'), orderId ? ne(orders.id, orderId) : undefined));
    if ((used?.n ?? 0) >= c.maxUses) return { ok: false, message: 'This code has been used up' };
  }
  const kind = c.kind as 'percent' | 'amount';
  const label = kind === 'percent' ? `${Number(c.value)}% off rentals` : `$${Number(c.value).toFixed(2)} off rentals`;
  return { ok: true, id: c.id, code: c.code, kind, value: Number(c.value), label };
}

export function validateCoupon(db: Db, tenantId: string, code: string, orderId?: string | null) {
  return withTenant(db, tenantId, (tx) => checkCoupon(tx, tenantId, code, orderId));
}

/** Free miles and rates for a trip from `depotId` (a location's own settings, else the org's). */
export function travelRules(prefs: TenantPreferences, settings: unknown) {
  const own = parseLocationSettings(settings);
  return {
    unit: prefs.formats.distanceUnit,
    freeDistance: own.freeTravelMiles ?? prefs.booking.freeTravelDistance,
    rateStaffed: own.travelRateStaffed ?? prefs.booking.travelRateStaffed,
    rateDropoff: own.travelRateDropoff ?? prefs.booking.travelRateDropoff,
  };
}

/**
 * Price an order with the shared engine. The server is authoritative: product
 * prices (with branch overrides), tax, surface fees, travel from the miles,
 * coupon and credits are all worked out here, whatever the browser showed.
 */
async function priceOrder(tx: Tx, tenantId: string, input: OrderInput, prefs: TenantPreferences, orderId?: string | null) {
  const ids = [...new Set(input.lines.map((l) => l.productId).filter((id): id is string => !!id))];
  const rows = ids.length ? await tx.select().from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, ids))) : [];
  const byId = new Map(rows.map((p) => [p.id, p]));
  for (const l of input.lines) if (l.productId && !byId.has(l.productId)) throw new OrgError('A product on this order no longer exists.', 'invalid');
  const branchPrices: LocationPrice[] = ids.length
    ? (
        await tx
          .select()
          .from(productLocationPrices)
          .where(and(eq(productLocationPrices.tenantId, tenantId), eq(productLocationPrices.locationId, input.locationId), inArray(productLocationPrices.productId, ids)))
      ).map((r) => ({ locationId: r.locationId, mode: r.serviceMode as ServiceMode, priceCents: r.priceCents }))
    : [];

  const [loc] = await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, input.locationId))).limit(1);
  if (!loc) throw new OrgError('Choose a location.', 'invalid');
  const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, input.customerId))).limit(1);
  if (!customer) throw new OrgError('Choose a customer.', 'invalid');

  // Tax: the order's own % when overridden, 0 for tax-exempt customers, else the location's default rate.
  let taxPercent = input.taxPercent ?? 0;
  if (!input.taxOverridden) {
    if (customer.taxExempt) taxPercent = 0;
    else {
      const [rate] = await tx
        .select({ rate: taxRates.rate })
        .from(taxRates)
        .where(and(eq(taxRates.tenantId, tenantId), eq(taxRates.locationId, input.locationId), eq(taxRates.isDefault, true)))
        .limit(1);
      taxPercent = rate ? Number(rate.rate) : prefs.booking.defaultTaxPercent;
    }
  }

  // Setup surface: the order's surface applies to every product line (Odoo: per line), a line may name its own.
  const surfaceFee = (code?: string | null) => prefs.booking.setupSurfaces.find((s) => s.code === code)?.feeCents ?? 0;

  // Travel: from the miles (Mapbox or typed in) with the depot's rules, unless the fee itself was overridden.
  const modes = input.lines.filter((l) => l.productId).map((l) => l.serviceMode);
  let travelCents = toCents(input.travelFee);
  let travelInfo = (input.travelInfo ?? null) as Record<string, unknown> | null;
  if (!input.travelFeeOverridden) {
    if (input.eventMiles == null || !modes.length) travelCents = 0;
    else {
      const depotId = typeof travelInfo?.depotId === 'string' ? travelInfo.depotId : null;
      const [depot] = depotId
        ? await tx.select().from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, depotId))).limit(1)
        : [loc];
      const fee = travelFee(input.eventMiles, modes, travelRules(prefs, (depot ?? loc).settings));
      travelCents = Math.round(fee.fee * 100);
      travelInfo = { ...(travelInfo ?? {}), miles: input.eventMiles, billable: fee.billable, rate: fee.rate, reason: fee.reason, depotId: (depot ?? loc).id };
    }
  }

  let coupon: Extract<CouponCheck, { ok: true }> | null = null;
  if (input.couponCode) {
    const c = await checkCoupon(tx, tenantId, input.couponCode, orderId);
    if (!c.ok) throw new OrgError(`Coupon ${input.couponCode.toUpperCase()}: ${c.message.toLowerCase()}.`, 'invalid');
    coupon = c;
  }

  // Credits: each amount must fit what is left on it; the engine then caps the total at what is owed.
  const usable = input.credits.length ? await usableCreditsTx(tx, tenantId, input.customerId, orderId) : [];
  const wanted = input.credits
    .filter((c) => c.amount > 0)
    .map((c) => {
      const credit = usable.find((u) => u.id === c.creditId);
      if (!credit) throw new OrgError('A credit on this order is no longer available.', 'invalid');
      const cents = toCents(c.amount);
      if (cents > credit.balanceCents) throw new OrgError(`${credit.code} has only ${(credit.balanceCents / 100).toFixed(2)} left.`, 'invalid');
      return { creditId: credit.id, code: credit.code, cents };
    });

  const quote = quoteOrder({
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    multiDay: input.multiDay,
    lines: input.lines.map((l) => {
      if (!l.productId) {
        return {
          productId: null, name: l.name ?? 'Custom item', pricing: null, minHours: null, serviceMode: l.serviceMode, quantity: l.quantity,
          flatRate: true, overrideUnitCents: toCents(l.overridePrice ?? 0), setupSurfaceFeeCents: 0, taxable: l.taxable,
        };
      }
      const p = byId.get(l.productId)!;
      return {
        productId: p.id,
        name: l.name || p.name,
        // The line's locked base and rate win over the product's current price (Odoo: locked on the order).
        pricing: lockedPricing(pricingOf(p, branchPrices, input.locationId), l.serviceMode, l.basePrice == null ? null : toCents(l.basePrice), l.extraRate == null ? null : toCents(l.extraRate)),
        minHours: p.minHours,
        serviceMode: l.serviceMode,
        quantity: l.quantity,
        flatRate: l.flatRate,
        overrideUnitCents: l.overridePrice == null ? null : toCents(l.overridePrice),
        setupSurfaceFeeCents: surfaceFee(l.setupSurface ?? input.setupSurface),
        taxable: l.taxable,
      };
    }),
    damageWaiver: { enabled: input.damageWaiver, percent: input.damageWaiverPercent ?? prefs.booking.damageWaiverPercent },
    travelFeeCents: travelCents,
    miscFeesCents: toCents(input.miscFees),
    eventLocationFeeCents: input.eventLocationFee ? toCents(input.eventLocationFeeAmount) : 0,
    discount: input.discount && input.discount.value > 0 ? input.discount : null,
    coupon: coupon ? { kind: coupon.kind, value: coupon.value } : null,
    couponCents: coupon ? undefined : toCents(input.coupon),
    taxPercent,
    creditCents: wanted.reduce((sum, c) => sum + c.cents, 0),
    deposit: input.deposit,
    defaultDepositPercent: prefs.booking.depositPercent,
  });

  // Spread what the engine actually applied over the chosen credits, in order.
  let left = quote.summary.creditCents;
  const applications = wanted
    .map((c) => {
      const cents = Math.min(c.cents, left);
      left -= cents;
      return { ...c, cents };
    })
    .filter((c) => c.cents > 0);

  return { quote, taxPercent, byId, travelCents, travelInfo, coupon, applications, location: loc, customer };
}
export type PricedOrder = Awaited<ReturnType<typeof priceOrder>>;

/** Price an order without saving it (the builder's live total, server-checked). */
export function previewOrder(db: Db, tenantId: string, input: OrderInput, prefs: TenantPreferences, orderId?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const p = await priceOrder(tx, tenantId, input, prefs, orderId);
    return { summary: p.quote.summary, lines: p.quote.lines, hours: p.quote.hours, travelCents: p.travelCents, taxPercent: p.taxPercent, warnings: p.quote.warnings };
  });
}

function orderValues(input: OrderInput, priced: PricedOrder, prefs: TenantPreferences) {
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
    contactConfirmed: input.contactConfirmed,
    customerAddressId: input.customerAddressId ?? null,
    eventMiles: input.eventMiles,
    milesOverridden: input.milesOverridden,
    setupSurface: input.setupSurface ?? null,
    eventLocationFee: input.eventLocationFee,
    eventLocationFeeCents: input.eventLocationFee ? toCents(input.eventLocationFeeAmount) : 0,
    billing: input.billing,
    salespersonUserId: input.salespersonUserId ?? null,
    referredByCustomerId: input.referredByCustomerId ?? null,
    damageWaiver: input.damageWaiver,
    damageWaiverPercent: input.damageWaiverPercent ?? prefs.booking.damageWaiverPercent,
    travelFeeCents: priced.travelCents,
    travelFeeOverridden: input.travelFeeOverridden,
    travelInfo: priced.travelInfo,
    miscFeesCents: toCents(input.miscFees),
    discountKind: input.discount && input.discount.value > 0 ? input.discount.kind : null,
    discountValue: input.discount && input.discount.value > 0 ? input.discount.value : null,
    discountAfterTax: !!input.discount?.afterTax,
    discountNote: input.discountNote ?? null,
    couponCode: priced.coupon?.code ?? input.couponCode ?? null,
    couponId: priced.coupon?.id ?? null,
    couponCents: s.couponCents,
    creditCents: s.creditCents,
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
    setupMapFileId: input.setupMapFileId ?? null,
  };
}

async function writeLines(tx: Tx, tenantId: string, orderId: string, input: OrderInput, priced: PricedOrder) {
  await tx.delete(orderLines).where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)));
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
        taxable: l.taxable !== false,
        quantity: l.quantity,
        unitCents: l.unitCents,
        autoUnitCents: l.autoUnitCents,
        priceOverridden: l.overridden,
        flatRate: l.flatRate,
        // What this order was priced with stays with it, even if the product's price changes later.
        baseCents: l.pricing ? basePackageCents(l.pricing, l.serviceMode) : null,
        extraRateCents: l.pricing ? extraRateOf(l.pricing).cents : null,
        setupSurface: l.productId ? (input.lines[i]?.setupSurface ?? input.setupSurface ?? null) : null,
        setupSurfaceFeeCents: l.setupSurfaceFeeCents,
        lineTotalCents: l.lineTotalCents,
        pricingTrace: l.trace,
        sort: i,
      })),
    )
    .returning();
}

async function writeCredits(tx: Tx, tenantId: string, orderId: string, priced: PricedOrder) {
  await tx.delete(creditApplications).where(and(eq(creditApplications.tenantId, tenantId), eq(creditApplications.orderId, orderId)));
  if (priced.applications.length) {
    await tx.insert(creditApplications).values(priced.applications.map((a) => ({ tenantId, orderId, creditId: a.creditId, amountCents: a.cents })));
  }
}

/** Hold every product line's equipment; throws a friendly error naming what is not free. */
async function reserveAll(tx: Tx, tenantId: string, order: Order, lines: OrderLine[], prefs: TenantPreferences) {
  await tx.delete(reservations).where(and(eq(reservations.tenantId, tenantId), eq(reservations.orderId, order.id)));
  const held = lines.filter((l) => l.productId);
  const prodIds = [...new Set(held.map((l) => l.productId!))];
  const prods = prodIds.length ? await tx.select().from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, prodIds))) : [];
  const refused: string[] = [];
  for (const line of held) {
    const p = prods.find((x) => x.id === line.productId)!;
    const turnaround = p.turnaroundMinutes ?? prefs.booking.cleanupBufferMinutes;
    const blockedUntil = new Date(order.eventEndsAt.getTime() + turnaround * 60_000);
    try {
      // A savepoint per line: a refused line rolls back only itself, so the next lines are still checked
      // (without it Postgres aborts the transaction and every later line fails with a raw error).
      await tx.transaction((sp) => sp.execute(sql`select app_reserve_inventory(${order.id}::uuid, ${line.id}::uuid, ${line.productId}::uuid, ${order.locationId}::uuid,
        ${line.quantity}::int, ${order.eventStartsAt.toISOString()}::timestamptz, ${order.eventEndsAt.toISOString()}::timestamptz,
        ${blockedUntil.toISOString()}::timestamptz)`));
    } catch (e) {
      const cause = (e as { cause?: { message?: string; detail?: string } }).cause;
      if (!cause?.message?.includes('NOT_AVAILABLE')) throw e;
      const d = JSON.parse(cause.detail ?? '{}') as { owned?: number; held?: number };
      refused.push(`${line.name}: ${d.held ?? 0} of ${d.owned ?? 0} already reserved for this time`);
    }
  }
  // Report every refused line at once; the whole save rolls back.
  if (refused.length) throw new OrgError(`Refused · ${refused.join(' · ')}`, 'invalid');
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

// --- versions -------------------------------------------------------------------------------

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** A flat, human-readable picture of an order, so two versions can be compared field by field. */
function snapshot(o: Order, lines: Pick<OrderLine, 'name' | 'quantity' | 'serviceMode' | 'unitCents' | 'taxable'>[]): Record<string, string> {
  const s: Record<string, string> = {
    Status: o.status,
    Location: o.locationId,
    Customer: o.customerId,
    Starts: o.eventStartsAt.toISOString(),
    Ends: o.eventEndsAt.toISOString(),
    'Event type': o.eventType ?? '',
    Address: [o.eventLine1, o.eventCity, o.eventPostalCode].filter(Boolean).join(', '),
    Venue: o.eventLocationName ?? '',
    'On-site contact': [o.eventContactName, o.eventContactMobile].filter(Boolean).join(' · '),
    Miles: o.eventMiles == null ? '' : String(o.eventMiles),
    Surface: o.setupSurface ?? '',
    'Location fee': o.eventLocationFee ? money(o.eventLocationFeeCents) : 'off',
    'Damage waiver': o.damageWaiver ? `${o.damageWaiverPercent}%` : 'declined',
    'Travel fee': money(o.travelFeeCents),
    Discount: o.discountKind ? `${o.discountValue}${o.discountKind === 'percent' ? '%' : ' $'}` : '',
    Coupon: o.couponCode ?? '',
    'Sales tax': `${o.taxPercent}%`,
    Deposit: o.depositKind === 'none' ? 'None' : `${o.depositValue}${o.depositKind === 'percent' ? '%' : ' $'}`,
    Credits: money(o.creditCents),
    Total: money(o.totalCents),
    'Internal notes': o.internalNotes ?? '',
    'Note to customer': o.customerNotes ?? '',
  };
  lines.forEach((l, i) => {
    s[`Line ${i + 1}`] = `${l.name} × ${l.quantity} · ${l.serviceMode} · ${money(l.unitCents)}${l.taxable ? '' : ' · not taxable'}`;
  });
  return s;
}

function snapshotDiff(before: Record<string, string>, after: Record<string, string>) {
  const out: Record<string, { from: string; to: string }> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[k] ?? '') !== (after[k] ?? '')) out[k] = { from: before[k] ?? '', to: after[k] ?? '' };
  }
  return out;
}

async function actorName(tx: Tx, actor: Actor) {
  if (!actor.userId) return actor.type === 'system' ? 'System' : null;
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1);
  return u?.name ?? null;
}

export async function recordVersion(tx: Tx, tenantId: string, actor: Actor, order: Order, action: string, diff: Record<string, unknown>, reason?: string | null) {
  await tx.insert(orderVersions).values({
    tenantId,
    orderId: order.id,
    version: order.version,
    action,
    diff,
    totals: { totalCents: order.totalCents, depositCents: order.depositDueCents, taxCents: order.taxCents, creditCents: order.creditCents, paidCents: order.paidCents },
    actorUserId: actor.userId ?? null,
    actorName: await actorName(tx, actor),
    reason: reason ?? null,
  });
}

async function linesOf(tx: Tx, tenantId: string, orderId: string) {
  return tx.select().from(orderLines).where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId))).orderBy(asc(orderLines.sort));
}

// --- create / update -----------------------------------------------------------------------------

export function createOrder(db: Db, tenantId: string, actor: Actor, input: OrderInput, prefs: TenantPreferences, copiedFrom?: { id: string; number: string }) {
  return withTenant(db, tenantId, async (tx) => {
    const priced = await priceOrder(tx, tenantId, input, prefs);
    const number = await nextDocumentNumber(tx, 'quote', prefs, input.locationId);
    const [order] = await tx
      .insert(orders)
      .values({ tenantId, number, status: 'draft', createdByUserId: actor.userId ?? null, copiedFromOrderId: copiedFrom?.id ?? null, ...orderValues(input, priced, prefs) })
      .returning();
    const lines = await writeLines(tx, tenantId, order!.id, input, priced);
    await writeCredits(tx, tenantId, order!.id, priced);
    await recordVersion(tx, tenantId, actor, order!, 'created', snapshot(order!, lines), copiedFrom ? `Copied from ${copiedFrom.number}` : null);
    await audit(tx, tenantId, actor, { type: 'order', id: order!.id }, 'order.created', { number, totalCents: order!.totalCents, ...(copiedFrom ? { copiedFrom: copiedFrom.number } : {}) });
    return order!;
  });
}

/**
 * Duplicate order (Odoo "Duplicate"): a new draft with its own number, filled in from another order's
 * form so the salesperson doesn't start over. Only the form is copied. Nothing of the original's money
 * or paperwork comes along: no payments, invoice, receipts, signature, policy confirmations, quote link,
 * messages, coupon or credits, and the original is not touched.
 * - Same date and time and the original's locked prices (the builder warns, and offers today's prices).
 * - Billing comes from the customer's current details, not the old order's.
 * - No salesperson (one must be picked before it's quoted or booked), referral cleared, and the
 *   event-day contact must be confirmed again.
 */
export async function duplicateOrder(db: Db, tenantId: string, actor: Actor, id: string, prefs: TenantPreferences) {
  const source = await getOrder(db, tenantId, id);
  if (!source) throw new OrgError('Order not found.', 'not_found');
  const input = orderInputFrom(source, source.lines, [], {
    billing: { email: undefined, phone: undefined, phone2: undefined },
    salespersonUserId: null,
    referredByCustomerId: null,
    source: 'Repeat customer',
    contactConfirmed: false,
    couponCode: undefined,
    coupon: 0,
    credits: [],
  });
  return createOrder(db, tenantId, actor, input, prefs, { id: source.id, number: source.number });
}

export type SaveResult = { order: Order; overpaidCents: number; changed: number };

/**
 * Save edits. Every field stays editable after booking: the save re-prices,
 * re-checks availability for a booked order (excluding its own holds) and
 * records a new version. `expectedVersion` stops two people overwriting each other.
 */
export function updateOrder(
  db: Db, tenantId: string, actor: Actor, id: string, input: OrderInput, prefs: TenantPreferences, expectedVersion?: number, reason?: string | null,
): Promise<SaveResult> {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).for('update').limit(1);
    if (!before) throw new OrgError('Order not found.', 'not_found');
    if (expectedVersion != null && before.version !== expectedVersion) {
      throw new OrgError('Someone else changed this order a moment ago. Reload to see their changes.', 'conflict');
    }
    if (before.status === 'cancelled') throw new OrgError('A cancelled order cannot be changed. Reopen it first.', 'invalid');
    const beforeLines = await linesOf(tx, tenantId, id);
    const priced = await priceOrder(tx, tenantId, input, prefs, id);
    const [order] = await tx
      .update(orders)
      .set({ ...orderValues(input, priced, prefs), version: before.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();
    const lines = await writeLines(tx, tenantId, id, input, priced);
    await writeCredits(tx, tenantId, id, priced);
    // A booked order keeps its equipment: re-hold for the new items and times.
    if (order!.status === 'booked') await reserveAll(tx, tenantId, order!, lines, prefs);
    const changes = snapshotDiff(snapshot(before, beforeLines), snapshot(order!, lines));
    await recordVersion(tx, tenantId, actor, order!, 'updated', changes, reason);
    if (order!.status === 'booked') await planOrderMessages(tx, tenantId, id);
    await syncInvoices(tx, tenantId, id);
    await audit(tx, tenantId, actor, { type: 'order', id }, 'order.updated', {
      number: order!.number,
      version: order!.version,
      totalCents: { from: before.totalCents, to: order!.totalCents },
      fields: Object.keys(changes),
    });
    return { order: order!, overpaidCents: Math.max(0, order!.paidCents - order!.totalCents), changed: Object.keys(changes).length };
  });
}

/**
 * After a save leaves the customer overpaid: refund it (recorded as owed back),
 * move it to wallet credit, or keep it as an overpayment.
 */
export function resolveOverpayment(db: Db, tenantId: string, actor: Actor, id: string, choice: 'refund' | 'wallet' | 'keep') {
  return withTenant(db, tenantId, async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).for('update').limit(1);
    if (!o) throw new OrgError('Order not found.', 'not_found');
    const over = o.paidCents - o.totalCents;
    if (over <= 0) return o;
    if (choice === 'keep') {
      await audit(tx, tenantId, actor, { type: 'order', id }, 'order.overpayment_kept', { cents: over });
      return o;
    }
    if (choice === 'wallet') {
      const [num] = (await tx.execute<{ number: string }>(sql`select app_next_number('credit:WC-', 'WC-', 4) as number`)) as unknown as [{ number: string }];
      await tx.insert(credits).values({
        tenantId, customerId: o.customerId, kind: 'wallet', code: num.number, amountCents: over,
        reason: `Overpayment on ${o.number}`, sourceOrderId: o.id, createdByUserId: actor.userId ?? null,
      });
    }
    const [after] = await tx
      .update(orders)
      .set({ paidCents: o.totalCents, version: o.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();
    await recordVersion(tx, tenantId, actor, after!, choice === 'wallet' ? 'overpayment_to_wallet' : 'refund_owed', { Overpaid: { from: money(over), to: '' } });
    await audit(tx, tenantId, actor, { type: 'order', id }, `order.overpayment_${choice}`, { cents: over });
    await syncInvoices(tx, tenantId, id);
    return after!;
  });
}

// --- status changes --------------------------------------------------------------------------------

export type OrderAction = 'send_quote' | 'book' | 'complete' | 'cancel' | 'reopen';

const ALLOWED: Record<OrderAction, OrderStatus[]> = {
  send_quote: ['draft', 'quote_sent'],
  book: ['draft', 'quote_sent'],
  complete: ['booked'],
  cancel: ['draft', 'quote_sent', 'booked'],
  reopen: ['cancelled'],
};

async function recordPaymentTx(
  tx: Tx, tenantId: string, actor: Actor, order: Order, prefs: TenantPreferences,
  p: { method: string; amountCents: number; tipCents?: number; invoiceId?: string | null; reference?: string | null; note?: string | null },
) {
  // Receipts carry the order's number (Q-AUS-00098), like its quote and invoice.
  const number = order.number;
  // Pays the named invoice, else the order's open one.
  let invoiceId = p.invoiceId ?? null;
  if (!invoiceId) {
    const [open] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.orderId, order.id), inArray(invoices.status, ['open', 'overdue'])))
      .orderBy(billingOrder, asc(invoices.createdAt))
      .limit(1);
    invoiceId = open?.id ?? null;
  }
  const [pay] = await tx
    .insert(payments)
    .values({
      tenantId, number, orderId: order.id, method: p.method, amountCents: p.amountCents, tipCents: p.tipCents ?? 0, invoiceId, reference: p.reference ?? null,
      note: p.note ?? null, createdByUserId: actor.userId ?? null,
    })
    .returning();
  return pay!;
}

export function transitionOrder(
  db: Db, tenantId: string, actor: Actor, id: string, action: OrderAction, prefs: TenantPreferences,
  /** paymentFollows: a card payment is recorded right after (its confirmation also confirms the booking). */
  opts: { reason?: string; booking?: BookingInput; paymentFollows?: boolean } = {},
) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).for('update').limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    if (!ALLOWED[action].includes(order.status as OrderStatus)) {
      throw new OrgError(`This order is ${order.status.replace('_', ' ')}; that step is not possible now.`, 'invalid');
    }
    const now = new Date();
    let set: Partial<typeof orders.$inferInsert> = {};
    let payment: Payment | null = null;
    if (action === 'send_quote') {
      await ensureOrderToken(tx, tenantId, id);
      const days = prefs.booking.quoteValidDays;
      set = { status: 'quote_sent', quoteSentAt: now, quoteExpiresOn: days ? new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10) : null };
    }
    if (action === 'book') {
      const lines = await linesOf(tx, tenantId, id);
      if (!lines.length) throw new OrgError('Add at least one item before booking.', 'invalid');
      await reserveAll(tx, tenantId, order, lines, prefs);
      set = { status: 'booked', bookedAt: now };
      const b = opts.booking;
      if (b?.method === 'manual') {
        const cents = toCents(Number(b.amount));
        if (cents > order.totalCents - order.paidCents) throw new OrgError('That is more than the order total.', 'invalid');
        payment = await recordPaymentTx(tx, tenantId, actor, order, prefs, {
          method: b.payMethod, amountCents: cents, tipCents: b.tip ? toCents(Number(b.tip)) : 0, reference: b.reference,
        });
        set = { ...set, paidCents: order.paidCents + cents, unpaidReason: null, expectedPaymentOn: null, followUpNotes: null };
      } else if (b?.method === 'none') {
        set = { ...set, unpaidReason: b.reason, expectedPaymentOn: b.expectedOn, followUpNotes: b.notes ?? null };
      }
      // Staff confirmed, for the customer, the policies they agreed to (Odoo POS "Additional information").
      const acks = Object.entries(b?.policies ?? {}).filter(([, on]) => on);
      if (acks.length) {
        const by = actor.userId ? (await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1))[0]?.name ?? null : null;
        set = { ...set, policyAcks: Object.fromEntries(acks.map(([k]) => [k, { at: now.toISOString(), by }])) };
      }
    }
    if (action === 'complete') set = { status: 'completed' };
    if (action === 'cancel') {
      await tx.delete(reservations).where(and(eq(reservations.tenantId, tenantId), eq(reservations.orderId, id)));
      set = { status: 'cancelled', cancelledAt: now, cancelReason: opts.reason ?? null };
    }
    if (action === 'reopen') {
      // Its money was settled (credit, refund or rain check): reopening would count it twice.
      if (order.cancelOutcome && order.cancelOutcome !== 'none') {
        throw new OrgError('What was paid on this order was already turned into credit or refunded. Start a new order and apply the credit there.', 'invalid');
      }
      set = { status: 'draft', cancelledAt: null, cancelReason: null, cancelOutcome: null };
    }
    const [after] = await tx
      .update(orders)
      .set({ ...set, version: order.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();
    const diff: Record<string, { from: string; to: string }> = { Status: { from: order.status, to: after!.status } };
    if (payment) diff.Payment = { from: '', to: `${payment.number} · ${payment.method} · ${money(payment.amountCents)}` };
    if (opts.booking?.method === 'none') diff['Booked without payment'] = { from: '', to: `${opts.booking.reason} · expected ${opts.booking.expectedOn}` };
    const confirmed = Object.entries(opts.booking?.policies ?? {}).filter(([, on]) => on).map(([k]) => k);
    if (confirmed.length) diff['Policies confirmed for the customer'] = { from: '', to: confirmed.join(', ') };
    if (payment?.tipCents) diff.Tip = { from: '', to: money(payment.tipCents) };
    await recordVersion(tx, tenantId, actor, after!, action === 'book' ? 'booked' : action, diff, opts.reason);
    await audit(tx, tenantId, actor, { type: 'order', id }, `order.${action}`, {
      number: order.number, from: order.status, to: after!.status, ...(opts.reason ? { reason: opts.reason } : {}), ...(payment ? { payment: payment.number } : {}),
    });
    // Messages, in the same transaction: one key per thing that happened, so nothing goes out twice.
    if (action === 'send_quote') await enqueueOrderMessage(tx, tenantId, id, 'quote', `${id}:quote:v${after!.version}`, { automatic: false });
    if (action === 'book') {
      // Like Odoo: a paid booking gets one email, the payment confirmation (which says it is booked).
      // "Email payment receipt to the customer" ticked: always sent (staff asked); unticked: none.
      if (payment) {
        if (opts.booking?.method !== 'manual' || opts.booking.receipt !== false) await enqueuePaymentConfirmation(tx, tenantId, after!, payment.id, opts.booking?.method !== 'manual');
      }
      else if (!opts.paymentFollows) await enqueueOrderMessage(tx, tenantId, id, 'booking_confirmation', `${id}:booking_confirmation`, { automatic: true });
      const m = prefs.messaging;
      if (order.eventStartsAt.getTime() - now.getTime() < (m.lastMinuteHours ?? 24) * 3_600_000) {
        await enqueueOfficeAlert(tx, tenantId, 'last_minute', `${id}:last_minute`, id);
      }
    }
    if (action === 'cancel') {
      await enqueueOrderMessage(tx, tenantId, id, 'cancellation', `${id}:cancellation:v${after!.version}`, { automatic: true, meta: { reason: opts.reason ?? '' } });
    }
    if (action === 'book' || action === 'cancel' || action === 'reopen') await planOrderMessages(tx, tenantId, id);
    await syncInvoices(tx, tenantId, id);
    return { order: after!, payment };
  });
}

// --- cancel with money outcomes, rain checks, reschedule (Phase 3) ---------------------------------------

/** Received payments of an order, newest first (what a refund comes back from). */
export function refundablePayments(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const pays = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId), eq(payments.status, 'received'))).orderBy(desc(payments.receivedAt));
    const done = await tx.select({ paymentId: refunds.paymentId, cents: sql<number>`sum(${refunds.amountCents})::bigint` }).from(refunds)
      .where(and(eq(refunds.tenantId, tenantId), eq(refunds.orderId, orderId))).groupBy(refunds.paymentId);
    const back = new Map(done.map((d) => [d.paymentId, Number(d.cents)]));
    return pays.map((p) => ({ ...p, refundableCents: Math.max(0, p.amountCents - (back.get(p.id) ?? 0)) })).filter((p) => p.refundableCents > 0);
  });
}

/**
 * Split a refund over the payments: card payments first (back through the
 * gateway), newest first; whatever is left is handed back by staff.
 */
export function planRefund(pays: { id: string; gateway: string; method: string; gatewayRef: string | null; refundableCents: number }[], amountCents: number) {
  const order = [...pays.filter((p) => p.gateway !== 'manual' && p.gatewayRef), ...pays.filter((p) => p.gateway === 'manual' || !p.gatewayRef)];
  const parts: { paymentId: string; cents: number; gateway: string; method: string; intentRef: string | null }[] = [];
  let left = amountCents;
  for (const p of order) {
    if (left <= 0) break;
    const cents = Math.min(left, p.refundableCents);
    parts.push({ paymentId: p.id, cents, gateway: p.gateway, method: p.method, intentRef: p.gatewayRef });
    left -= cents;
  }
  return { parts, unallocatedCents: left };
}

export type DoneRefund = { paymentId: string | null; cents: number; gateway: string; method: string; ref: string | null };

async function insertCreditTx(tx: Tx, tenantId: string, actor: Actor, o: Order, kind: 'wallet' | 'rain_check' | 'goodwill', cents: number, reason: string, validUntil: string | null) {
  const prefix = kind === 'rain_check' ? 'RC-' : kind === 'goodwill' ? 'GW-' : 'WC-';
  const [num] = (await tx.execute<{ number: string }>(sql`select app_next_number(${`credit:${prefix}`}, ${prefix}, 4) as number`)) as unknown as [{ number: string }];
  const [c] = await tx
    .insert(credits)
    .values({ tenantId, customerId: o.customerId, kind, code: num.number, amountCents: cents, reason, validUntil, sourceOrderId: o.id, createdByUserId: actor.userId ?? null })
    .returning();
  return c!;
}

/**
 * Cancel a booking and settle what was paid: wallet credit, refund, or a rain
 * check (weather; the order shows as "Rained out"). Always releases the items,
 * cancels scheduled messages and the balance charge, voids unpaid invoices and
 * emails the cancellation. Card refunds are made at the gateway first and
 * passed in as `done`; the rest of a refund is recorded as handed back.
 */
export function cancelOrder(
  db: Db, tenantId: string, actor: Actor, id: string, prefs: TenantPreferences, input: CancelInput, done: DoneRefund[] = [],
) {
  const c = cancelSchema.parse(input);
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).for('update').limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    if (!ALLOWED.cancel.includes(order.status as OrderStatus)) throw new OrgError(`This order is ${order.status.replace('_', ' ')}; it cannot be cancelled now.`, 'invalid');
    const paid = order.paidCents;
    const amount = toCents(c.amount);
    const goodwill = toCents(c.goodwill);
    if (c.outcome === 'none' && paid > 0) throw new OrgError(`Choose what happens to the ${money(paid)} paid.`, 'invalid');
    if (c.outcome !== 'none' && amount > paid) throw new OrgError(`That is more than the ${money(paid)} paid.`, 'invalid');
    if ((c.outcome === 'wallet' || c.outcome === 'rain_check') && amount + goodwill <= 0) throw new OrgError('Enter the credit amount.', 'invalid');
    if (c.outcome === 'refund' && amount <= 0) throw new OrgError('Enter the refund amount.', 'invalid');

    const now = new Date();
    const why = [c.reason, c.note].filter(Boolean).join(' · ');
    let credit: typeof credits.$inferSelect | null = null;
    let extra: typeof credits.$inferSelect | null = null;
    const made: (typeof refunds.$inferSelect)[] = [];
    if (c.outcome === 'wallet' || c.outcome === 'rain_check') {
      const label = c.outcome === 'rain_check' ? `Rain check · ${order.number}` : `Cancelled ${order.number}`;
      credit = await insertCreditTx(tx, tenantId, actor, order, c.outcome, amount + goodwill, `${label}${goodwill ? ` (includes ${money(goodwill)} goodwill)` : ''} · ${c.reason}`,
        c.outcome === 'rain_check' ? (c.validUntil ?? rainCheckUntil(prefs, now)) : c.validUntil);
    }
    if (c.outcome === 'refund') {
      const gateway = done.reduce((s, r) => s + r.cents, 0);
      if (gateway > amount) throw new OrgError('The card refunds are more than the refund amount.', 'invalid');
      const rows: DoneRefund[] = [...done];
      if (amount > gateway) {
        // The rest comes back from the manual payments (staff hand it back).
        const pays = (await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, id), eq(payments.status, 'received'))).orderBy(desc(payments.receivedAt)))
          .filter((p) => p.gateway === 'manual');
        let left = amount - gateway;
        for (const p of pays) {
          if (left <= 0) break;
          const cents = Math.min(left, p.amountCents);
          rows.push({ paymentId: p.id, cents, gateway: 'manual', method: p.method, ref: null });
          left -= cents;
        }
        if (left > 0) throw new OrgError(`${money(left)} was paid by card and could not be refunded at the gateway.`, 'invalid');
      }
      for (const r of rows) {
        const [num] = (await tx.execute<{ number: string }>(sql`select app_next_number('refund:RF-', 'RF-', 4) as number`)) as unknown as [{ number: string }];
        const [row] = await tx.insert(refunds).values({
          tenantId, number: num.number, orderId: id, paymentId: r.paymentId, amountCents: r.cents, method: r.method, gateway: r.gateway, gatewayRef: r.ref,
          reason: why, createdByUserId: actor.userId ?? null,
        }).returning();
        made.push(row!);
      }
      if (goodwill > 0) extra = await insertCreditTx(tx, tenantId, actor, order, 'goodwill', goodwill, `Goodwill · cancelled ${order.number}`, null);
    }
    const refunded = made.reduce((s, r) => s + r.amountCents, 0);

    await tx.delete(reservations).where(and(eq(reservations.tenantId, tenantId), eq(reservations.orderId, id)));
    const [after] = await tx
      .update(orders)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: why, cancelOutcome: c.outcome, paidCents: paid - refunded, version: order.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();

    const outcome = cancelOutcomeText(c.outcome, { credit, extra, refunded, money });
    const diff: Record<string, { from: string; to: string }> = { Status: { from: order.status, to: c.outcome === 'rain_check' ? 'rained out' : 'cancelled' }, Outcome: { from: '', to: outcome } };
    for (const r of made) diff[`Refund ${r.number}`] = { from: '', to: `${money(r.amountCents)} · ${r.gateway === 'manual' ? `${r.method}, handed back` : 'to the card'}` };
    await recordVersion(tx, tenantId, actor, after!, 'cancel', diff, why);
    await audit(tx, tenantId, actor, { type: 'order', id }, 'order.cancel', {
      number: order.number, from: order.status, outcome: c.outcome, credit: credit?.code ?? null, refundedCents: refunded, reason: c.reason,
    });
    await enqueueOrderMessage(tx, tenantId, id, 'cancellation', `${id}:cancellation:v${after!.version}`, { automatic: true, meta: { reason: why, outcome } });
    await planOrderMessages(tx, tenantId, id);
    await syncInvoices(tx, tenantId, id);
    return { order: after!, credit, goodwillCredit: extra, refunds: made, outcome };
  });
}

/** What the customer is told happened to their money (cancellation email, history, result card). */
export function cancelOutcomeText(
  outcome: CancelOutcome,
  r: { credit: { code: string; amountCents: number; validUntil: string | null } | null; extra?: { code: string; amountCents: number } | null; refunded: number; money: (c: number) => string },
) {
  const until = (d: string | null) => (d ? `, valid until ${new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : '');
  if (outcome === 'rain_check' && r.credit) return `Rain check ${r.credit.code} for ${r.money(r.credit.amountCents)}${until(r.credit.validUntil)}. Use it on a new date.`;
  if (outcome === 'wallet' && r.credit) return `Wallet credit ${r.credit.code} for ${r.money(r.credit.amountCents)}, ready for your next booking.`;
  if (outcome === 'refund') return `Refund of ${r.money(r.refunded)}${r.extra ? `, plus goodwill credit ${r.extra.code} for ${r.money(r.extra.amountCents)}` : ''}.`;
  return 'Nothing was paid on this order.';
}

/**
 * Rain check → Reschedule now: move the booking to a new date (availability is
 * re-checked; same number, new version, reminders re-planned).
 */
export async function rescheduleOrder(db: Db, tenantId: string, actor: Actor, id: string, prefs: TenantPreferences, input: RescheduleInput) {
  const r = rescheduleSchema.parse(input);
  const full = await getOrder(db, tenantId, id);
  if (!full) throw new OrgError('Order not found.', 'not_found');
  if (full.status !== 'booked') throw new OrgError('Only a booked order can be rescheduled.', 'invalid');
  const multiDay = full.multiDay || r.endsAt.getTime() - r.startsAt.getTime() > 86_400_000;
  const next = orderInputFrom(full, full.lines, full.creditApplications, { startsAt: r.startsAt, endsAt: r.endsAt, multiDay });
  return updateOrder(db, tenantId, actor, id, next, prefs, full.version, `Rescheduled · ${[r.reason, r.note].filter(Boolean).join(' · ')}`);
}

/** Record money received outside a gateway (cash, check, Zelle...). */
export function recordPayment(
  db: Db, tenantId: string, actor: Actor, id: string, prefs: TenantPreferences,
  p: { method: string; amount: number; tip?: number; invoiceId?: string | null; reference?: string | null; note?: string | null; receipt?: boolean },
) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).for('update').limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    if (order.status === 'cancelled') throw new OrgError('This order is cancelled.', 'invalid');
    const cents = toCents(p.amount);
    if (cents <= 0) throw new OrgError('Enter the amount received.', 'invalid');
    const pay = await recordPaymentTx(tx, tenantId, actor, order, prefs, {
      method: p.method, amountCents: cents, tipCents: p.tip ? toCents(p.tip) : 0, invoiceId: p.invoiceId, reference: p.reference, note: p.note,
    });
    const [after] = await tx
      .update(orders)
      .set({ paidCents: order.paidCents + cents, version: order.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();
    await recordVersion(tx, tenantId, actor, after!, 'payment', { Payment: { from: '', to: `${pay.number} · ${pay.method} · ${money(cents)}` } });
    await audit(tx, tenantId, actor, { type: 'order', id }, 'order.payment', { number: order.number, payment: pay.number, cents });
    // Staff ticking "Send receipt" always sends; otherwise the automation decides.
    if (p.receipt !== false) await enqueuePaymentConfirmation(tx, tenantId, after!, pay.id, p.receipt !== true);
    await syncInvoices(tx, tenantId, id);
    return { order: after!, payment: pay };
  });
}

/**
 * Collect Tip (Odoo POS): a tip for the party coach taken on its own after booking,
 * by cash, check, Zelle, Venmo or ACH. It is a receipt with no amount, so the
 * order total and its invoices do not change.
 */
export function recordTip(
  db: Db, tenantId: string, actor: Actor, id: string, prefs: TenantPreferences,
  p: { method: string; tip: number; reference?: string | null; note?: string | null },
) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).for('update').limit(1);
    if (!order) throw new OrgError('Order not found.', 'not_found');
    if (order.status !== 'booked' && order.status !== 'completed') throw new OrgError('Tips are collected once the order is booked.', 'invalid');
    const cents = toCents(p.tip);
    if (cents <= 0) throw new OrgError('Enter the tip amount.', 'invalid');
    const [pay] = await tx
      .insert(payments)
      .values({
        tenantId, number: order.number, orderId: id, method: p.method, amountCents: 0, tipCents: cents,
        reference: p.reference ?? null, note: p.note ?? null, createdByUserId: actor.userId ?? null,
      })
      .returning();
    const [after] = await tx.update(orders).set({ version: order.version + 1 }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).returning();
    await recordVersion(tx, tenantId, actor, after!, 'tip', { Tip: { from: '', to: `${pay!.number} · ${pay!.method} · ${money(cents)}` } });
    await audit(tx, tenantId, actor, { type: 'order', id }, 'order.tip', { number: order.number, payment: pay!.number, cents });
    return { order: after!, payment: pay! };
  });
}

// --- reads ----------------------------------------------------------------------------------------

/**
 * A saved order as an OrderInput again (the inverse of orderValues), so changes made
 * outside the builder — the customer declining the waiver on the quote page — go
 * through updateOrder with the same pricing, versions and checks as staff edits.
 */
export function orderInputFrom(
  o: Order,
  lines: OrderLine[],
  applied: { creditId: string; amountCents: number }[],
  patch: Partial<OrderInput> = {},
): OrderInput {
  const dollars = (c: number) => c / 100;
  const base: OrderInput = {
    customerId: o.customerId,
    locationId: o.locationId,
    eventType: o.eventType ?? undefined,
    startsAt: o.eventStartsAt,
    endsAt: o.eventEndsAt,
    multiDay: o.multiDay,
    eventSameAsBilling: o.eventSameAsBilling,
    eventLocationName: o.eventLocationName ?? undefined,
    eventAddress: {
      line1: o.eventLine1 ?? undefined, line2: o.eventLine2 ?? undefined, city: o.eventCity ?? undefined, region: o.eventRegion ?? undefined,
      postalCode: o.eventPostalCode ?? undefined, country: o.eventCountry, lat: o.eventLat ?? undefined, lng: o.eventLng ?? undefined,
    },
    eventContactName: o.eventContactName ?? undefined,
    eventContactMobile: o.eventContactMobile ?? undefined,
    eventContactEmail: o.eventContactEmail ?? undefined,
    contactConfirmed: o.contactConfirmed,
    customerAddressId: o.customerAddressId,
    eventMiles: o.eventMiles,
    milesOverridden: o.milesOverridden,
    setupSurface: o.setupSurface,
    eventLocationFee: o.eventLocationFee,
    eventLocationFeeAmount: dollars(o.eventLocationFeeCents),
    billing: (o.billing ?? {}) as OrderInput['billing'],
    salespersonUserId: o.salespersonUserId,
    referredByCustomerId: o.referredByCustomerId,
    lines: lines.map((l) => ({
      productId: l.productId, name: l.name, serviceMode: l.serviceMode as OrderInput['lines'][number]['serviceMode'], quantity: l.quantity,
      flatRate: l.flatRate, overridePrice: !l.productId || l.priceOverridden ? dollars(l.unitCents) : null, taxable: l.taxable, setupSurface: l.setupSurface,
      basePrice: l.productId && l.baseCents != null ? dollars(l.baseCents) : null, extraRate: l.productId && l.extraRateCents != null ? dollars(l.extraRateCents) : null,
    })),
    damageWaiver: o.damageWaiver,
    damageWaiverPercent: Number(o.damageWaiverPercent),
    travelFee: dollars(o.travelFeeCents),
    travelFeeOverridden: o.travelFeeOverridden,
    travelInfo: (o.travelInfo ?? null) as OrderInput['travelInfo'],
    miscFees: dollars(o.miscFeesCents),
    discount: o.discountKind ? { kind: o.discountKind as 'percent' | 'amount', value: Number(o.discountValue ?? 0), afterTax: o.discountAfterTax } : null,
    couponCode: o.couponCode ?? undefined,
    coupon: o.couponId ? 0 : dollars(o.couponCents),
    credits: applied.map((a) => ({ creditId: a.creditId, amount: dollars(a.amountCents) })),
    taxPercent: Number(o.taxPercent),
    taxOverridden: o.taxOverridden,
    deposit: { kind: o.depositKind as 'percent' | 'amount' | 'none', value: Number(o.depositValue) },
    source: o.source ?? undefined,
    internalNotes: o.internalNotes ?? undefined,
    customerNotes: o.customerNotes ?? undefined,
    discountNote: o.discountNote ?? undefined,
    setupMapFileId: o.setupMapFileId,
  };
  return { ...base, ...patch };
}

export function getOrder(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id))).limit(1);
    if (!order) return null;
    const [lines, [customer], versions, pays, applied] = await Promise.all([
      linesOf(tx, tenantId, id),
      tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, order.customerId))).limit(1),
      tx.select().from(orderVersions).where(and(eq(orderVersions.tenantId, tenantId), eq(orderVersions.orderId, id))).orderBy(desc(orderVersions.version)),
      tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, id))).orderBy(asc(payments.receivedAt)),
      tx.select().from(creditApplications).where(and(eq(creditApplications.tenantId, tenantId), eq(creditApplications.orderId, id))),
    ]);
    return { ...order, lines, customer: customer!, versions, payments: pays, creditApplications: applied };
  });
}
export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

export type OrderListFilters = {
  status?: OrderStatus | 'open' | 'quotes' | 'all';
  search?: string;
  from?: Date;
  to?: Date;
  customerId?: string;
  locationId?: string;
  unpaid?: boolean;
  limit?: number;
};

export function listOrders(db: Db, tenantId: string, f: OrderListFilters = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const conds: (SQL | undefined)[] = [
      eq(orders.tenantId, tenantId),
      f.status && f.status !== 'all'
        ? f.status === 'open'
          ? inArray(orders.status, ['draft', 'quote_sent', 'booked'])
          : f.status === 'quotes'
            ? inArray(orders.status, ['draft', 'quote_sent'])
            : eq(orders.status, f.status)
        : undefined,
      f.from ? gte(orders.eventEndsAt, f.from) : undefined,
      f.to ? lt(orders.eventStartsAt, f.to) : undefined,
      f.customerId ? eq(orders.customerId, f.customerId) : undefined,
      f.locationId ? eq(orders.locationId, f.locationId) : undefined,
      f.unpaid ? and(eq(orders.status, 'booked'), isNotNull(orders.unpaidReason)) : undefined,
      f.search
        ? or(
            ilike(orders.number, `%${f.search}%`),
            ilike(customers.displayName, `%${f.search}%`),
            ilike(orders.eventCity, `%${f.search}%`),
            ilike(orders.eventLine1, `%${f.search}%`),
          )
        : undefined,
    ];
    const rows = await tx
      .select({
        order: orders,
        customerName: customers.displayName,
        customerPhone: customers.phone,
        locationName: locations.name,
        locationCode: locations.code,
        items: sql<string>`(select string_agg(l.name || case when l.quantity > 1 then ' ×' || l.quantity else '' end, ', ' order by l.sort) from order_lines l where l.tenant_id = orders.tenant_id and l.order_id = orders.id)`,
        lines: sql<{ productId: string | null; name: string; quantity: number }[]>`coalesce((select json_agg(json_build_object('productId', l.product_id, 'name', l.name, 'quantity', l.quantity) order by l.sort) from order_lines l where l.tenant_id = orders.tenant_id and l.order_id = orders.id), '[]'::json)`,
      })
      .from(orders)
      .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
      .innerJoin(locations, and(eq(locations.tenantId, orders.tenantId), eq(locations.id, orders.locationId)))
      .where(and(...conds))
      .orderBy(f.from ? asc(orders.eventStartsAt) : desc(orders.eventStartsAt))
      .limit(f.limit ?? 200);
    return rows.map((r) => ({
      ...r.order,
      customerName: r.customerName ?? '',
      customerPhone: r.customerPhone,
      locationName: r.locationName,
      locationCode: r.locationCode,
      items: r.items ?? '',
      lineItems: r.lines,
    }));
  });
}
export type OrderListRow = Awaited<ReturnType<typeof listOrders>>[number];

/** People who can be named as salesperson (active staff). */
export function listSalespeople(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) =>
    tx
      .select({ userId: memberships.userId, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, 'active'), inArray(memberships.role, ['owner', 'admin', 'manager', 'sales'])))
      .orderBy(asc(users.name)),
  );
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
        (select count(*)::int from orders where tenant_id = ${tenantId}::uuid and status = 'booked' and event_starts_at >= now()) as upcoming,
        (select count(*)::int from orders, b where tenant_id = ${tenantId}::uuid and status in ('booked','completed') and event_starts_at >= b.week_start and event_starts_at < b.week_start + interval '7 days') as this_week,
        (select count(*)::int from orders where tenant_id = ${tenantId}::uuid and status in ('draft','quote_sent')) as quotes_open,
        (select coalesce(sum(total_cents),0)::text from orders, b where tenant_id = ${tenantId}::uuid and status in ('booked','completed') and booked_at >= b.month_start) as booked_month_cents,
        (select min(event_starts_at)::text from orders where tenant_id = ${tenantId}::uuid and status = 'booked' and event_starts_at >= now()) as next_event`);
    return {
      upcoming: row?.upcoming ?? 0,
      thisWeek: row?.this_week ?? 0,
      quotesOpen: row?.quotes_open ?? 0,
      bookedThisMonthCents: Number(row?.booked_month_cents ?? 0),
      nextEvent: row?.next_event ? new Date(row.next_event) : null,
    };
  });
}
