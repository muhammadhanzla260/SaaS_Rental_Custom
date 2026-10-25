import {
  formatPhone, quoteOrder, travelFee, utcToWallTime, wallTimeToUtc, addDays,
  type OrderFormValues, type ServiceMode,
} from '@rental/core';
import type { BuilderData, BuilderLocation, Draft, DraftLine } from './types';

let seq = 0;
export const lineKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

const cents = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const dollars = (c: number) => (c / 100).toFixed(2);
export const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const blankAddr = (country: string) => ({ line1: '', line2: '', city: '', region: '', postalCode: '', country });

export function locationOf(data: BuilderData, id: string): BuilderLocation | undefined {
  return data.locations.find((l) => l.id === id);
}

/** A starting draft: an existing order as it is saved, or a new one with the workspace defaults. */
export function initialDraft(data: BuilderData): Draft {
  const o = data.order;
  const locationId = o?.locationId ?? data.defaultLocationId ?? data.locations[0]?.id ?? '';
  const loc = locationOf(data, locationId);
  const tz = loc?.timezone ?? data.orgTimezone;
  const c = data.customer;
  if (o) {
    const s = utcToWallTime(new Date(o.startsAt), tz);
    const dur = Math.round((new Date(o.endsAt).getTime() - new Date(o.startsAt).getTime()) / 60_000);
    const applied = Object.fromEntries(o.credits.map((x) => [x.creditId, { on: true, amount: dollars(x.amountCents) }]));
    const credits = Object.fromEntries(data.credits.map((x) => [x.id, applied[x.id] ?? { on: false, amount: dollars(x.balanceCents) }]));
    const depositRule: Draft['depositRule'] =
      o.depositKind === 'none' ? 'none'
        : o.depositKind === 'percent' && o.depositValue === 30 ? '30'
          : o.depositKind === 'percent' && o.depositValue === 50 ? '50'
            : o.depositKind === 'percent' && o.depositValue === 100 ? 'full' : 'custom';
    return {
      locationId,
      customer: c,
      billing: {
        name: o.billing.name ?? c?.name ?? '', email: o.billing.email ?? c?.email ?? '', phone: formatPhone(o.billing.phone ?? c?.phone, data.country),
        phone2: formatPhone(o.billing.phone2 ?? c?.phoneSecondary, data.country),
        address: { ...blankAddr(data.country), ...(c?.billingAddress ?? {}), ...(o.billing.address ?? {}) },
      },
      salespersonUserId: o.salespersonUserId ?? '', source: o.source ?? '', referredBy: o.referredByCustomerId ? { id: o.referredByCustomerId, name: 'Referring customer' } : null,
      eventType: o.eventType ?? '', date: s.date, start: s.time, durationMin: dur,
      addressChoice: o.customerAddressId ? `saved:${o.customerAddressId}` : 'other',
      eventAddress: { ...o.eventAddress }, saveAddress: false, eventLocationName: o.eventLocationName ?? '',
      miles: o.eventMiles == null ? '' : String(o.eventMiles), milesOverridden: o.milesOverridden,
      depotId: typeof o.travelInfo?.depotId === 'string' ? o.travelInfo.depotId : null, milesNote: null,
      setupSurface: o.setupSurface ?? data.booking.surfaces[0]?.code ?? '',
      eventLocationFee: o.eventLocationFee, eventLocationFeeAmount: dollars(o.eventLocationFee ? o.eventLocationFeeCents : data.booking.locationFeeCents),
      contact: { ...o.contact, mobile: formatPhone(o.contact.mobile, data.country) },
      lines: o.lines.map((l) => ({
        key: lineKey(), productId: l.productId, name: l.name, serviceMode: l.serviceMode, quantity: l.quantity, taxable: l.taxable, flatRate: l.flatRate,
        price: !l.productId || l.priceOverridden ? dollars(l.unitCents) : '', setupSurface: l.setupSurface,
      })),
      internalNotes: o.internalNotes, customerNotes: o.customerNotes,
      damageWaiver: o.damageWaiver, waiverPercent: String(o.damageWaiverPercent),
      travelOverride: o.travelFeeOverridden ? dollars(o.travelFeeCents) : null,
      discountKind: o.discountKind ?? 'percent', discountValue: o.discountValue == null ? '' : String(o.discountValue),
      couponCode: o.couponCode ?? '',
      coupon: null,
      taxPercent: String(o.taxPercent), taxOverridden: o.taxOverridden,
      credits,
      depositRule, depositCustomKind: o.depositKind === 'amount' ? 'amount' : 'percent', depositCustomValue: depositRule === 'custom' ? String(o.depositValue) : '',
    };
  }
  const today = utcToWallTime(new Date(), tz).date;
  return {
    locationId,
    customer: c,
    billing: {
      name: c?.name ?? '', email: c?.email ?? '', phone: formatPhone(c?.phone, data.country), phone2: formatPhone(c?.phoneSecondary, data.country),
      address: c?.billingAddress ?? blankAddr(data.country),
    },
    salespersonUserId: data.salespeople.some((s) => s.userId === data.me.userId) ? data.me.userId : '',
    source: c ? (c.orderCount > 0 ? 'Repeat customer' : c.source ?? '') : '', referredBy: null,
    eventType: '', date: data.defaultDate ?? addDays(today, 7), start: '13:00', durationMin: 300,
    addressChoice: c?.addresses.find((a) => a.kind === 'event') ? `saved:${c.addresses.find((a) => a.kind === 'event')!.id}` : c?.billingAddress.line1 ? 'billing' : 'other',
    eventAddress: c?.addresses.find((a) => a.kind === 'event')?.address ?? (c?.billingAddress.line1 ? c.billingAddress : blankAddr(data.country)),
    saveAddress: false, eventLocationName: '',
    miles: '', milesOverridden: false, depotId: null, milesNote: null,
    setupSurface: data.booking.surfaces[0]?.code ?? '', eventLocationFee: false, eventLocationFeeAmount: dollars(data.booking.locationFeeCents),
    contact: { name: c?.name ?? '', mobile: formatPhone(c?.phone, data.country), email: c?.email ?? '', confirmed: false },
    lines: [], internalNotes: '', customerNotes: '',
    damageWaiver: data.booking.waiverDefaultOn, waiverPercent: String(data.booking.waiverPercent),
    travelOverride: null, discountKind: 'percent', discountValue: '', couponCode: '', coupon: null,
    taxPercent: String(loc?.taxPercent ?? 0), taxOverridden: false,
    credits: Object.fromEntries(data.credits.map((x) => [x.id, { on: false, amount: dollars(x.balanceCents) }])),
    depositRule: data.booking.depositPercent === 50 ? '50' : '30', depositCustomKind: 'percent', depositCustomValue: '',
  };
}

export function eventTimes(d: Draft, tz: string) {
  const startsAt = wallTimeToUtc(d.date, d.start, tz);
  const endsAt = new Date(startsAt.getTime() + d.durationMin * 60_000);
  return { startsAt, endsAt };
}

export function depositOf(d: Draft): { kind: 'percent' | 'amount' | 'none'; value: number } {
  switch (d.depositRule) {
    case '30': return { kind: 'percent', value: 30 };
    case '50': return { kind: 'percent', value: 50 };
    case 'full': return { kind: 'percent', value: 100 };
    case 'none': return { kind: 'none', value: 0 };
    default: return { kind: d.depositCustomKind, value: num(d.depositCustomValue) };
  }
}

/** Travel fee from the miles with the depot's rules (or the order's location), unless overridden. */
export function travelOf(d: Draft, data: BuilderData) {
  const modes = d.lines.filter((l) => l.productId).map((l) => l.serviceMode);
  if (d.travelOverride != null) return { cents: cents(d.travelOverride), trace: 'Set by hand', overridden: true };
  if (!d.miles.trim() || !modes.length) return { cents: 0, trace: modes.length ? 'Add the event address' : '', overridden: false };
  const depot = locationOf(data, d.depotId ?? '') ?? locationOf(data, d.locationId);
  if (!depot) return { cents: 0, trace: '', overridden: false };
  const fee = travelFee(num(d.miles), modes, depot.rules);
  const unit = depot.rules.unit;
  const trace = fee.reason === 'pickup'
    ? 'Customer picks up · no travel'
    : `${num(d.miles).toFixed(1)} ${unit} − ${depot.rules.freeDistance} free = ${fee.billable.toFixed(1)} × $${fee.rate.toFixed(2)}`;
  return { cents: Math.round(fee.fee * 100), trace, overridden: false };
}

/** Live price: the same engine the server runs, with branch prices for the chosen location. */
export function priceDraft(d: Draft, data: BuilderData) {
  const loc = locationOf(data, d.locationId);
  const tz = loc?.timezone ?? data.orgTimezone;
  const { startsAt, endsAt } = eventTimes(d, tz);
  const byId = new Map(data.products.map((p) => [p.id, p]));
  const surfaceFee = (code: string | null) => data.booking.surfaces.find((s) => s.code === code)?.feeCents ?? 0;
  const travel = travelOf(d, data);
  const usedCredits = data.credits.filter((c) => d.credits[c.id]?.on).map((c) => ({ id: c.id, cents: Math.min(cents(d.credits[c.id]!.amount), c.balanceCents) }));
  const taxPercent = d.taxOverridden ? num(d.taxPercent) : d.customer?.taxExempt ? 0 : (loc?.taxPercent ?? 0);
  const quote = quoteOrder({
    startsAt, endsAt, multiDay: false,
    lines: d.lines.map((l) => {
      const p = l.productId ? byId.get(l.productId) : undefined;
      if (!p) {
        return { productId: null, name: l.name || 'Custom item', pricing: null, minHours: null, serviceMode: l.serviceMode, quantity: l.quantity, flatRate: true, overrideUnitCents: cents(l.price), setupSurfaceFeeCents: 0, taxable: l.taxable };
      }
      const own = (mode: ServiceMode) => p.branchPrices.find((b) => b.locationId === d.locationId && b.mode === mode)?.priceCents;
      return {
        productId: p.id, name: l.name || p.name,
        pricing: { ...p.pricing, priceStaffedCents: own('staffed') ?? p.pricing.priceStaffedCents, pricePickupCents: own('pickup') ?? p.pricing.pricePickupCents, priceDropoffCents: own('dropoff') ?? p.pricing.priceDropoffCents },
        minHours: p.minHours, serviceMode: l.serviceMode, quantity: l.quantity, flatRate: l.flatRate,
        overrideUnitCents: l.price.trim() === '' ? null : cents(l.price), setupSurfaceFeeCents: surfaceFee(l.setupSurface ?? d.setupSurface), taxable: l.taxable,
      };
    }),
    damageWaiver: { enabled: d.damageWaiver, percent: num(d.waiverPercent) },
    travelFeeCents: travel.cents, miscFeesCents: 0,
    eventLocationFeeCents: d.eventLocationFee ? cents(d.eventLocationFeeAmount) : 0,
    discount: num(d.discountValue) > 0 ? { kind: d.discountKind, value: num(d.discountValue) } : null,
    coupon: d.coupon ? { kind: d.coupon.kind, value: d.coupon.value } : null,
    couponCents: 0,
    taxPercent,
    creditCents: usedCredits.reduce((s, c) => s + c.cents, 0),
    deposit: depositOf(d),
    defaultDepositPercent: data.booking.depositPercent,
  });
  const totalBeforeCredits = quote.summary.totalCents + quote.summary.creditCents;
  return { quote, travel, startsAt, endsAt, tz, taxPercent, totalBeforeCredits, usedCredits };
}

/** The payload the server validates (orderSchema). */
export function toOrderInput(d: Draft, data: BuilderData): OrderFormValues {
  const loc = locationOf(data, d.locationId);
  const { startsAt, endsAt } = eventTimes(d, loc?.timezone ?? data.orgTimezone);
  const travel = travelOf(d, data);
  const dep = depositOf(d);
  return {
    customerId: d.customer?.id ?? '',
    locationId: d.locationId,
    eventType: d.eventType,
    startsAt, endsAt, multiDay: false,
    eventSameAsBilling: d.addressChoice === 'billing',
    eventLocationName: d.eventLocationName,
    eventAddress: d.eventAddress,
    eventContactName: d.contact.name, eventContactMobile: d.contact.mobile, eventContactEmail: d.contact.email,
    contactConfirmed: d.contact.confirmed,
    customerAddressId: d.addressChoice.startsWith('saved:') ? d.addressChoice.slice(6) : null,
    eventMiles: d.miles.trim() === '' ? null : num(d.miles),
    milesOverridden: d.milesOverridden,
    setupSurface: d.setupSurface || null,
    eventLocationFee: d.eventLocationFee,
    eventLocationFeeAmount: num(d.eventLocationFeeAmount),
    billing: { name: d.billing.name, email: d.billing.email, phone: d.billing.phone, phone2: d.billing.phone2, address: d.billing.address },
    salespersonUserId: d.salespersonUserId || null,
    referredByCustomerId: d.referredBy?.id ?? null,
    lines: d.lines.map((l) => ({
      productId: l.productId, name: l.name, serviceMode: l.serviceMode, quantity: l.quantity, flatRate: l.flatRate, taxable: l.taxable,
      overridePrice: l.price.trim() === '' ? null : num(l.price), setupSurface: l.setupSurface,
    })),
    damageWaiver: d.damageWaiver,
    damageWaiverPercent: num(d.waiverPercent),
    travelFee: travel.cents / 100,
    travelFeeOverridden: d.travelOverride != null,
    travelInfo: d.depotId ? { depotId: d.depotId } : null,
    miscFees: 0,
    discount: num(d.discountValue) > 0 ? { kind: d.discountKind, value: num(d.discountValue), afterTax: false } : null,
    couponCode: d.coupon?.code ?? '',
    coupon: 0,
    credits: data.credits.filter((c) => d.credits[c.id]?.on).map((c) => ({ creditId: c.id, amount: Math.min(num(d.credits[c.id]!.amount), c.balanceCents / 100) })),
    taxPercent: num(d.taxPercent),
    taxOverridden: d.taxOverridden,
    deposit: dep,
    source: d.source,
    internalNotes: d.internalNotes,
    customerNotes: d.customerNotes,
  } as OrderFormValues;
}

export function newLine(p: { id: string; name: string; taxable: boolean; pricing: { pricePickupCents: number | null } } | null, mode: ServiceMode = 'staffed'): DraftLine {
  return {
    key: lineKey(), productId: p?.id ?? null, name: p ? p.name : '', serviceMode: mode, quantity: 1, taxable: p ? p.taxable : true, flatRate: false,
    price: p ? '' : '', setupSurface: null,
  };
}

export const timeLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const addMinutes = (hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};
export const durationLabel = (mins: number) => `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
