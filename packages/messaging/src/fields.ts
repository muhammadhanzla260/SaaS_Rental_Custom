import { checkAccent, formatMoney, formatPhone, type EmailBrand, type EmailSummary, type FieldValues, type MessageType } from '@rental/core';
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
  return v;
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
    case 'receipt':
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
