import 'server-only';
import { notFound } from 'next/navigation';
import { parseLocationSettings, type ServiceMode } from '@rental/core';
import {
  getCustomer, getOrder, listCategories, listLocations, listProducts, listSalespeople, pricingOf, travelRules, usableCredits,
} from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import type { Billing, BuilderCustomer, BuilderData } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function customerFor(tenantId: string, id: string): Promise<BuilderCustomer | null> {
  const c = await getCustomer(db, tenantId, id);
  if (!c) return null;
  return {
    id: c.id, name: c.displayName ?? 'Customer', firstName: c.firstName, email: c.email, phone: c.phone, phoneSecondary: c.phoneSecondary, country: c.country,
    taxExempt: c.taxExempt, orderCount: c.orderCount, tags: c.tags, source: c.source,
    billingAddress: { line1: c.line1 ?? '', line2: c.line2 ?? '', city: c.city ?? '', region: c.region ?? '', postalCode: c.postalCode ?? '', country: c.country, lat: c.lat ?? undefined, lng: c.lng ?? undefined },
    addresses: c.addresses.map((a) => ({
      id: a.id, label: a.label, kind: a.kind,
      address: { line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', region: a.region ?? '', postalCode: a.postalCode ?? '', country: a.country, lat: a.lat ?? undefined, lng: a.lng ?? undefined },
    })),
  };
}

/** Everything the order screen needs, priced and permission-checked on the server. */
export async function loadBuilder(slug: string, orderId: string | null, opts: { customerId?: string; date?: string; locationId?: string } = {}): Promise<BuilderData> {
  const ctx = await pageContext(slug, orderId ? 'orders.view' : 'orders.create');
  if (orderId && !UUID.test(orderId)) notFound();
  const order = orderId ? await getOrder(db, ctx.tenant.id, orderId) : null;
  if (orderId && !order) notFound();

  const [locations, products, categories, salespeople] = await Promise.all([
    listLocations(db, ctx.tenant.id),
    listProducts(db, ctx.tenant.id, { includeArchived: !!order }),
    listCategories(db, ctx.tenant.id),
    listSalespeople(db, ctx.tenant.id),
  ]);
  const customerId = order?.customerId ?? (opts.customerId && UUID.test(opts.customerId) ? opts.customerId : null);
  const [customer, credits] = customerId
    ? await Promise.all([customerFor(ctx.tenant.id, customerId), usableCredits(db, ctx.tenant.id, customerId, order?.id ?? null)])
    : [null, []];
  const prefs = ctx.prefs;
  const usedIds = new Set(order?.lines.map((l) => l.productId) ?? []);

  return {
    slug,
    currency: ctx.tenant.currency,
    country: ctx.tenant.country,
    orgTimezone: ctx.tenant.timezone,
    locations: locations
      .filter((l) => l.isActive || l.id === order?.locationId)
      .map((l) => ({
        id: l.id, name: l.name, code: l.code, timezone: l.timezone || ctx.tenant.timezone, lat: l.lat, lng: l.lng, isPrimary: l.isPrimary,
        taxPercent: l.taxRate ? Number(l.taxRate.rate) : prefs.booking.defaultTaxPercent,
        rules: travelRules(prefs, l.settings),
        paused: parseLocationSettings(l.settings).paused,
      })),
    defaultLocationId: (opts.locationId && locations.some((l) => l.id === opts.locationId) ? opts.locationId : null)
      ?? locations.find((l) => l.isPrimary)?.id ?? locations[0]?.id ?? null,
    defaultDate: opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : null,
    booking: {
      surfaces: prefs.booking.setupSurfaces.map((s) => ({ code: s.code, label: s.label, feeCents: s.feeCents })),
      waiverPercent: prefs.booking.damageWaiverPercent,
      waiverDefaultOn: prefs.booking.damageWaiverDefaultOn,
      depositPercent: prefs.booking.depositPercent,
      cleanupMinutes: prefs.booking.cleanupBufferMinutes,
      locationFeeCents: prefs.booking.eventLocationFeeCents,
      minimumBookingCents: prefs.booking.minimumBookingCents,
    },
    products: products
      .filter((p) => p.status === 'active' || usedIds.has(p.id))
      .map((p) => ({
        id: p.id, name: p.name, kind: p.kind, categoryId: p.categoryId, icon: p.icon, tint: p.tint, imageUrl: fileUrl(ctx.tenant.id, p.imageFileId),
        pricing: pricingOf(p), branchPrices: p.locationPrices, minHours: p.minHours, taxable: p.taxable, turnaroundMinutes: p.turnaroundMinutes,
        suggestedAddonIds: p.suggestedAddonIds, tracking: p.tracking, fromCents: p.fromCents, active: p.status === 'active',
      })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    salespeople: salespeople.map((s) => ({ userId: s.userId, name: s.name })),
    me: { userId: ctx.user.id, role: ctx.role },
    perms: {
      create: ctx.can('orders.create'),
      overridePrice: ctx.can('orders.override_price'),
      overrideTax: ctx.can('orders.override_tax'),
      recordPayment: ctx.can('payments.record'),
      refund: ctx.can('payments.refund'),
      editCustomers: ctx.can('customers.manage'),
    },
    readOnly: ctx.readOnly,
    customer,
    credits: credits.map((c) => ({ id: c.id, code: c.code, kind: c.kind, label: c.label, balanceCents: c.balanceCents, validUntil: c.validUntil, reason: c.reason })),
    order: order
      ? {
          id: order.id, number: order.number, status: order.status, version: order.version, locationId: order.locationId, customerId: order.customerId,
          eventType: order.eventType, startsAt: order.eventStartsAt.toISOString(), endsAt: order.eventEndsAt.toISOString(),
          eventLocationName: order.eventLocationName,
          eventAddress: {
            line1: order.eventLine1 ?? '', line2: order.eventLine2 ?? '', city: order.eventCity ?? '', region: order.eventRegion ?? '', postalCode: order.eventPostalCode ?? '',
            country: order.eventCountry, lat: order.eventLat ?? undefined, lng: order.eventLng ?? undefined,
          },
          customerAddressId: order.customerAddressId,
          contact: { name: order.eventContactName ?? '', mobile: order.eventContactMobile ?? '', email: order.eventContactEmail ?? '', confirmed: order.contactConfirmed },
          eventMiles: order.eventMiles, milesOverridden: order.milesOverridden, travelInfo: (order.travelInfo ?? null) as Record<string, unknown> | null,
          setupSurface: order.setupSurface, eventLocationFee: order.eventLocationFee, eventLocationFeeCents: order.eventLocationFeeCents,
          billing: (order.billing ?? {}) as Billing,
          salespersonUserId: order.salespersonUserId, referredByCustomerId: order.referredByCustomerId, source: order.source,
          damageWaiver: order.damageWaiver, damageWaiverPercent: Number(order.damageWaiverPercent),
          travelFeeCents: order.travelFeeCents, travelFeeOverridden: order.travelFeeOverridden,
          discountKind: order.discountKind as 'percent' | 'amount' | null, discountValue: order.discountValue == null ? null : Number(order.discountValue),
          couponCode: order.couponCode, couponCents: order.couponCents,
          taxPercent: Number(order.taxPercent), taxOverridden: order.taxOverridden,
          depositKind: order.depositKind as 'percent' | 'amount' | 'none', depositValue: Number(order.depositValue),
          internalNotes: order.internalNotes ?? '', customerNotes: order.customerNotes ?? '',
          totalCents: order.totalCents, depositDueCents: order.depositDueCents, paidCents: order.paidCents, creditCents: order.creditCents,
          unpaidReason: order.unpaidReason, expectedPaymentOn: order.expectedPaymentOn, followUpNotes: order.followUpNotes,
          cancelReason: order.cancelReason, bookedAt: order.bookedAt?.toISOString() ?? null,
          lines: order.lines.map((l) => ({
            productId: l.productId, name: l.name, serviceMode: l.serviceMode as ServiceMode, quantity: l.quantity, taxable: l.taxable, flatRate: l.flatRate,
            unitCents: l.unitCents, priceOverridden: l.priceOverridden, setupSurface: l.setupSurface,
          })),
          credits: order.creditApplications.map((a) => ({ creditId: a.creditId, amountCents: a.amountCents })),
          payments: order.payments.map((p) => ({ id: p.id, number: p.number, method: p.method, amountCents: p.amountCents, reference: p.reference, receivedAt: p.receivedAt.toISOString(), status: p.status })),
          versions: order.versions.map((v) => ({
            version: v.version, action: v.action, diff: v.diff as Record<string, { from: string; to: string }>, totals: v.totals as { totalCents?: number },
            actorName: v.actorName, reason: v.reason, at: v.createdAt.toISOString(),
          })),
        }
      : null,
  };
}
