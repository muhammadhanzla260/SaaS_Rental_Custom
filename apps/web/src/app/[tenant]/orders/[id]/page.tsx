import { notFound } from 'next/navigation';
import { addDays, formatPhone, utcToWallTime, type OrderStatus } from '@rental/core';
import { getCustomer, getOrder, listCategories, listLocations, listProducts, pricingOf } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { OrderBuilder } from '../order-builder';

export const metadata = { title: 'Order' };

export default async function OrderPage({
  params, searchParams,
}: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ customer?: string; date?: string; done?: string; failed?: string }> }) {
  const { tenant: slug, id } = await params;
  const { customer: customerParam, date: dateParam, done, failed } = await searchParams;
  const DONE: Record<string, string> = {
    saved: 'Saved as a draft.',
    book: 'Booked. The equipment is now held for this event.',
    send_quote: 'Marked as quote sent. Emailing quotes arrives in Phase 2.',
  };
  const { tenant, prefs } = await getTenantContext(slug);
  const isNew = id === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [order, products, categories, locs] = await Promise.all([
    isNew ? null : getOrder(db, tenant.id, id),
    listProducts(db, tenant.id),
    listCategories(db, tenant.id),
    listLocations(db, tenant.id),
  ]);
  if (!isNew && !order) notFound();
  const activeLocs = locs.filter((l) => l.isActive || l.id === order?.locationId);
  const primary = activeLocs.find((l) => l.isPrimary) ?? activeLocs[0]!;

  const customer = order?.customer ?? (customerParam && /^[0-9a-f-]{36}$/i.test(customerParam) ? await getCustomer(db, tenant.id, customerParam) : null);
  const billing = customer
    ? { line1: customer.line1 ?? '', line2: customer.line2 ?? '', city: customer.city ?? '', region: customer.region ?? '', postalCode: customer.postalCode ?? '', country: customer.country, lat: customer.lat ?? undefined, lng: customer.lng ?? undefined }
    : { country: tenant.country };

  const tz = (order ? locs.find((l) => l.id === order.locationId)?.timezone : primary.timezone) ?? tenant.timezone;
  let initial: Record<string, unknown>;
  if (order) {
    const start = utcToWallTime(order.eventStartsAt, tz);
    const end = utcToWallTime(order.eventEndsAt, tz);
    initial = {
      customerId: order.customerId, locationId: order.locationId, locationAuto: false, eventType: order.eventType ?? '',
      date: start.date, startTime: start.time, endTime: end.time, multiDay: order.multiDay, endDate: end.date,
      eventSameAsBilling: order.eventSameAsBilling, billing, eventLocationName: order.eventLocationName ?? '',
      eventAddress: {
        line1: order.eventLine1 ?? '', line2: order.eventLine2 ?? '', city: order.eventCity ?? '', region: order.eventRegion ?? '',
        postalCode: order.eventPostalCode ?? '', country: order.eventCountry, lat: order.eventLat ?? undefined, lng: order.eventLng ?? undefined,
      },
      eventContactName: order.eventContactName ?? '', eventContactMobile: formatPhone(order.eventContactMobile, tenant.country), eventContactEmail: order.eventContactEmail ?? '',
      lines: order.lines.map((l, i) => ({
        key: `s${i}`, productId: l.productId, serviceMode: l.serviceMode, quantity: l.quantity, flatRate: l.flatRate,
        overridePrice: l.priceOverridden ? l.unitCents / 100 : null, setupSurface: l.setupSurface,
      })),
      defaultSurface: order.lines[0]?.setupSurface ?? '',
      damageWaiver: order.damageWaiver, travelFee: order.travelFeeCents / 100, travelFeeOverridden: order.travelFeeOverridden, travelInfo: order.travelInfo,
      miscFees: order.miscFeesCents / 100, discountKind: order.discountKind ?? 'none', discountValue: order.discountValue ?? 0, discountAfterTax: order.discountAfterTax,
      couponCode: order.couponCode ?? '', coupon: order.couponCents / 100, taxPercent: order.taxPercent, taxOverridden: order.taxOverridden,
      depositKind: order.depositKind, depositValue: order.depositValue, internalNotes: order.internalNotes ?? '', customerNotes: order.customerNotes ?? '', source: order.source ?? '',
    };
  } else {
    const today = utcToWallTime(new Date(), tz).date;
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : addDays(today, 7);
    initial = {
      customerId: customer?.id ?? '', locationId: primary.id, locationAuto: true, eventType: '', date, startTime: '14:00', endTime: '18:00',
      multiDay: false, endDate: date, eventSameAsBilling: true, billing, eventLocationName: '', eventAddress: { ...billing },
      eventContactName: customer?.displayName ?? '', eventContactMobile: formatPhone(customer?.phone, tenant.country), eventContactEmail: '',
      lines: [], defaultSurface: '', damageWaiver: prefs.booking.damageWaiverDefaultOn, travelFee: 0, travelFeeOverridden: false, travelInfo: null,
      miscFees: 0, discountKind: 'none', discountValue: 0, discountAfterTax: false, couponCode: '', coupon: 0, taxPercent: 0, taxOverridden: false,
      depositKind: 'percent', depositValue: prefs.booking.depositPercent, internalNotes: '', customerNotes: '', source: customer?.source ?? '',
    };
  }

  return (
    <OrderBuilder
      key={order ? `${order.id}-${order.version}` : 'new'}
      slug={slug}
      orderId={order?.id ?? null}
      number={order?.number ?? null}
      status={(order?.status ?? 'draft') as OrderStatus}
      version={order?.version ?? 1}
      initial={initial}
      initialCustomer={customer ? { id: customer.id, name: customer.displayName ?? '', email: customer.email, phone: customer.phone, city: customer.city, lat: customer.lat, lng: customer.lng } : null}
      products={products
        .filter((p) => p.status === 'active' || order?.lines.some((l) => l.productId === p.id))
        .map((p) => ({ id: p.id, name: p.name, categoryId: p.categoryId, imageUrl: fileUrl(tenant.id, p.imageFileId), kind: p.kind, minHours: p.minHours, pricing: pricingOf(p) }))}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      locations={activeLocs.map((l) => ({ id: l.id, name: l.name, code: l.code, timezone: l.timezone, taxPercent: Number(l.taxRate?.rate ?? 0), lat: l.lat, lng: l.lng, isPrimary: l.isPrimary }))}
      prefs={{
        depositPercent: prefs.booking.depositPercent, damageWaiverPercent: prefs.booking.damageWaiverPercent, damageWaiverDefaultOn: prefs.booking.damageWaiverDefaultOn,
        serviceRadius: prefs.booking.serviceRadius, distanceUnit: prefs.formats.distanceUnit, setupSurfaces: prefs.booking.setupSurfaces,
      }}
      currency={tenant.currency}
      country={tenant.country}
      flash={failed ? null : done ? DONE[done] ?? null : null}
      flashError={failed ? failed.slice(0, 300) : null}
    />
  );
}
