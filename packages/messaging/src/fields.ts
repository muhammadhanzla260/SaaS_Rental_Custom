import {
  checkAccent, emailBlocks, formatMoney, formatPhone, parsePreferences, utcToWallTime, type EmailBrand, type EmailData, type EmailSummary, type FieldValues, type MessageType,
} from '@rental/core';
import type { MessageContext } from '@rental/db';

export const appBase = () => (process.env.APP_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/$/, '');

export type Extra = {
  payment?: { number: string; amountCents: number; method: string; last4?: string | null } | null;
  invoice?: { number: string; amountCents: number } | null;
};

function firstName(ctx: MessageContext) {
  const c = ctx.customer;
  const billingName = ((ctx.order?.billing ?? {}) as { name?: string }).name;
  return c?.firstName || (billingName ?? c?.displayName ?? '').split(/\s+/)[0] || 'there';
}

/** Field values for one message ({customer.first_name}, {event.date}…), in the location's time zone. */
export function fieldValues(ctx: MessageContext, extra: Extra = {}): FieldValues {
  const o = ctx.order;
  const tz = ctx.location?.timezone ?? ctx.tenant.timezone;
  const cur = ctx.tenant.currency;
  const money = (c: number) => formatMoney(c, cur);
  const meta = (ctx.message.meta ?? {}) as Record<string, unknown>;
  const v: FieldValues = {
    'org.name': ctx.tenant.name,
    'org.phone': formatPhone(ctx.location?.phone ?? ctx.tenant.phone, ctx.tenant.country),
    'location.name': ctx.location?.name ?? '',
    'customer.first_name': firstName(ctx),
    'customer.name': ctx.customer?.displayName ?? '',
    review_link: ctx.prefs.brand.reviewLink ?? '',
    pay_link: ctx.payUrl ?? '',
    reason: typeof meta.reason === 'string' ? meta.reason : '',
  };
  if (o) {
    const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(o.eventStartsAt);
    const time = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
    Object.assign(v, {
      'order.number': o.number,
      'order.total': money(o.totalCents),
      'order.balance': money(Math.max(0, o.totalCents - o.paidCents)),
      // "Other" (or nothing) reads badly in a sentence ("your other on Friday"): say "event".
      'event.type': !o.eventType || /^other$/i.test(o.eventType) ? 'event' : o.eventType.toLowerCase(),
      'event.date': date,
      'event.time': `${time(o.eventStartsAt)} – ${time(o.eventEndsAt)}`,
      'event.address': [o.eventLocationName, o.eventLine1, o.eventCity].filter(Boolean).join(', '),
      'event.items': ctx.lines.map((l) => (l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(', '),
      'deposit.amount': money(o.depositDueCents),
      'deposit.percent': o.depositKind === 'percent' ? `${Number(o.depositValue)}%` : money(o.depositDueCents),
    });
  }
  if (extra.payment) {
    Object.assign(v, { 'payment.amount': money(extra.payment.amountCents), 'payment.number': extra.payment.number, 'card.last4': extra.payment.last4 ?? '' });
  }
  if (extra.invoice) Object.assign(v, { 'invoice.number': extra.invoice.number, 'invoice.amount': money(extra.invoice.amountCents) });

  // The Odoo-layout templates: business details, brand colours, links and the order blocks.
  const brand = brandOf(ctx);
  const site = ctx.tenant.website?.trim() || '';
  Object.assign(v, {
    'org.location_name': ctx.location?.name ? `${ctx.tenant.name} - ${ctx.location.name}` : ctx.tenant.name,
    'org.email': ctx.tenant.email ?? '',
    'org.address': [ctx.tenant.line1, [ctx.tenant.city, [ctx.tenant.region, ctx.tenant.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '),
    'org.website': site.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    'org.website_url': site ? (site.startsWith('http') ? site : `https://${site}`) : appBase(),
    'brand.color': brand.brandColor,
    'brand.on_color': brand.onBrand,
    'order.prepared_suffix': ctx.preparedBy ? ` | Prepared by ${ctx.preparedBy}` : '',
  });
  if (o) {
    const tz = ctx.location?.timezone ?? ctx.tenant.timezone;
    const days = Math.round((Date.parse(utcToWallTime(o.eventStartsAt, tz).date) - Date.parse(utcToWallTime(new Date(), tz).date)) / 86_400_000);
    const data = emailData(ctx, extra);
    Object.assign(v, {
      'order.paid': money(data.paidCents),
      'event.days_to_go': days <= 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`,
      'payment.status': data.paidCents >= data.totalCents ? 'Paid in full' : 'Partial payment',
      'payment.detail': data.latestPayment?.detail ?? '',
      contract_link: data.links.contract,
      quote_pdf_link: data.links.quotePdf,
      ...emailBlocks(data, brand.logoUrl ?? null),
    });
  }
  return v;
}

const MODE_SHORT = { staffed: 'Staffed', pickup: 'Pickup', dropoff: 'Drop Off' } as const;

/** Plain data for the order blocks ({block.pricing}, {block.payment_options}…). */
export function emailData(ctx: MessageContext, extra: Extra = {}): EmailData {
  const o = ctx.order!;
  const tz = ctx.location?.timezone ?? ctx.tenant.timezone;
  const brand = brandOf(ctx);
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(d);
  const tzShort = fmt(o.eventStartsAt, { timeZoneName: 'short' }).split(' ').pop() ?? '';
  const time = (d: Date) => fmt(d, { hour: 'numeric', minute: '2-digit' });
  const hours = Math.round(((o.eventEndsAt.getTime() - o.eventStartsAt.getTime()) / 3_600_000) * 10) / 10;
  const slot = `${hours} hour${hours === 1 ? '' : 's'} · ${fmt(o.eventStartsAt, { weekday: 'short', month: 'short', day: 'numeric' })} ${time(o.eventStartsAt)} – ${time(o.eventEndsAt)}`;
  const s = (o.summary ?? {}) as Record<string, number>;
  const prefs = parsePreferences(ctx.tenant.settings);
  const surface = prefs.booking.setupSurfaces.find((x) => x.code === o.setupSurface);
  const billing = (o.billing ?? {}) as { name?: string; email?: string; phone?: string };
  const travel = (o.travelInfo ?? {}) as { billable?: number };
  const pct = (n: unknown) => `${Number(n)}%`;
  const pricing: EmailData['pricing'] = [
    { label: 'Rental Subtotal', cents: o.merchandiseCents },
    ...(s.customCents ? [{ label: 'Other Items', cents: s.customCents }] : []),
    ...(o.damageWaiver ? [{ label: `Damage Waiver (${pct(o.damageWaiverPercent)})`, cents: s.damageWaiverCents ?? 0 }] : []),
    ...(s.eventLocationCents ? [{ label: 'Non-Residential Location Fee', cents: s.eventLocationCents }] : []),
    ...(s.setupSurfaceCents ? [{ label: `Setup Surface Fee${surface ? ` (${surface.label})` : ''}`, cents: s.setupSurfaceCents }] : []),
    ...(o.travelFeeCents ? [{ label: `Travel Fee${travel.billable ? ` (${Number(travel.billable).toFixed(1)} mi)` : ''}`, cents: o.travelFeeCents }] : []),
    ...(s.preTaxDiscountCents ? [{ label: `${o.discountKind === 'percent' ? `Discount (${pct(o.discountValue)})` : 'Discount'}${o.discountNote ? ` · ${o.discountNote}` : ''}`, cents: s.preTaxDiscountCents, credit: true }] : []),
    ...(s.couponCents ? [{ label: `Coupon ${o.couponCode ?? ''}`.trim(), cents: s.couponCents, credit: true }] : []),
    ...(o.taxCents ? [{ label: `Tax (${pct(o.taxPercent)})`, cents: o.taxCents }] : []),
    ...(o.creditCents ? [{ label: 'Rain Checks & Credits', cents: o.creditCents, credit: true }] : []),
  ];
  const payments = ctx.payments.map((p) => ({
    label: `${p.cardLast4 ? 'Credit Card' : p.method.charAt(0).toUpperCase() + p.method.slice(1)}: ${utcToWallTime(p.receivedAt, tz).date}`,
    cents: p.amountCents,
  }));
  const latest = ctx.payments.at(-1);
  const pay = extra.payment ?? (latest ? { amountCents: latest.amountCents, last4: latest.cardLast4, method: latest.method, number: latest.number } : null);
  const payDate = latest ? fmt(latest.receivedAt, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const base = appBase();
  const modes = new Set(ctx.lines.map((l) => l.service_mode));
  return {
    currency: ctx.tenant.currency,
    brand: { color: brand.brandColor, onColor: brand.onBrand },
    orgName: ctx.tenant.name,
    status: o.status as EmailData['status'],
    orderNumber: o.number,
    preparedBy: ctx.preparedBy,
    signed: ctx.signed,
    event: {
      date: fmt(o.eventStartsAt, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      time: `${time(o.eventStartsAt)} to ${time(o.eventEndsAt)} ${tzShort}`.trim(),
      typeLabel: o.eventType && !/^other$/i.test(o.eventType) ? o.eventType : null,
      street: o.eventLine1 ?? null,
      cityLine: [o.eventCity, [o.eventRegion, o.eventPostalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      surface: surface?.label ?? null,
      // One mode for the whole order, else staffed wins (the crew is there anyway).
      mode: modes.size === 1 ? [...modes][0]! : 'staffed',
    },
    customer: { name: billing.name || ctx.customer?.displayName || 'Customer', email: billing.email || ctx.customer?.email || null, phone: billing.phone || ctx.customer?.phone || null },
    contact: { name: o.eventContactName ?? null, mobile: o.eventContactMobile ?? null, email: o.eventContactEmail ?? null },
    notes: o.customerNotes ?? null,
    lines: ctx.lines.map((l) => ({
      name: l.name, quantity: l.quantity, mode: l.service_mode, detail: slot, totalCents: Number(l.line_total_cents),
      imageUrl: l.image_file_id ? `${base}/api/files/${ctx.tenant.id}/${l.image_file_id}` : null,
    })),
    pricing,
    totalCents: o.totalCents,
    depositCents: o.depositDueCents,
    depositLabel: o.depositKind === 'percent' ? pct(o.depositValue) : null,
    paidCents: o.paidCents,
    payments,
    latestPayment: pay
      ? { cents: pay.amountCents, detail: [pay.last4 ? `Card ending in ${pay.last4}` : MODE_SHORT[pay.method as keyof typeof MODE_SHORT] ?? pay.method.charAt(0).toUpperCase() + pay.method.slice(1), payDate].filter(Boolean).join(' · ') }
      : null,
    links: {
      pay: ctx.payUrl ?? base,
      contract: ctx.token ? `${base}/q/${ctx.token}/print?doc=agreement` : base,
      quotePdf: ctx.token ? `${base}/q/${ctx.token}/print?doc=quote` : base,
    },
  };
}

export function brandOf(ctx: MessageContext): EmailBrand {
  const color = ctx.tenant.brandColor || '#2C4FE0';
  const logo = ctx.tenant.logoFileId ? `${appBase()}/api/files/${ctx.tenant.id}/${ctx.tenant.logoFileId}` : null;
  const address = [ctx.tenant.line1, ctx.tenant.city, ctx.tenant.region].filter(Boolean).join(', ');
  return {
    orgName: ctx.tenant.name,
    locationName: ctx.location?.name ?? null,
    brandColor: color,
    onBrand: checkAccent(color).onAccent,
    logoUrl: logo,
    phone: formatPhone(ctx.location?.phone ?? ctx.tenant.phone, ctx.tenant.country) || null,
    address: address || null,
    footer: ctx.prefs.brand.invoiceFooter ?? null,
    header: ctx.prefs.brand.emailHeader === 'white' ? 'white' : 'band',
  };
}

/** The summary box under the message, per type. */
export function summaryFor(type: MessageType, v: FieldValues): EmailSummary {
  const rows = (pairs: [string, string | undefined][]) => pairs.filter(([, val]) => !!val).map(([label, value]) => ({ label, value: value! }));
  switch (type) {
    case 'quote':
      return rows([['Order', v['order.number']], ['Event', `${v['event.date']} · ${v['event.time']}`], ['Total', v['order.total']], ['Deposit to book', v['deposit.amount']]]);
    case 'invoice':
    case 'card_declined':
      return rows([['Invoice', v['invoice.number']], ['Order', v['order.number']], ['Amount due', v['invoice.amount']]]);
    case 'payment_partial':
    case 'payment_paid':
    case 'charge_balance':
      return rows([['Receipt', v['payment.number']], ['Paid', v['payment.amount']], ['Balance left', v['order.balance']]]);
    case 'booking_confirmation':
      return rows([['Order', v['order.number']], ['Event', `${v['event.date']} · ${v['event.time']}`], ['Where', v['event.address']], ['Balance on event day', v['order.balance']]]);
    case 'pre_event':
    case 'day_before':
      return rows([['Event', `${v['event.date']} · ${v['event.time']}`], ['Where', v['event.address']], ['Items', v['event.items']]]);
    default:
      return [];
  }
}
