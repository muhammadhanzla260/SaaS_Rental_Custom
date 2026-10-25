import { notFound } from 'next/navigation';
import { agreementSections, checkAccent, formatMoney, formatPhone, policyText, resolveAgreement, utcToWallTime } from '@rental/core';
import { quoteContext, resolveOrderToken } from '@rental/db';
import { amountDue, cardGateway } from '@rental/payments';
import { orderSummaryRows, shortDay } from '@/lib/order-summary';
import { fileUrl } from '@/lib/urls';
import { db } from '@/server/db';
import { QuoteFlow, type QuoteView } from './quote-flow';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your quote', robots: { index: false, follow: false } };

const MODE: Record<string, string> = { staffed: 'Staffed · we set up and stay', pickup: 'Pick-up', dropoff: 'Drop-off' };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ payment_intent?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ref = await resolveOrderToken(db, token);
  if (!ref) notFound();
  const q = await quoteContext(db, ref.tenantId, ref.orderId);
  if (!q) notFound();
  const o = q.order;
  const tz = q.location.timezone || q.tenant.timezone;
  const money = (c: number) => formatMoney(c, q.tenant.currency);
  const s = (o.summary ?? {}) as Record<string, number>;
  const hours = Number(s.hours ?? (o.eventEndsAt.getTime() - o.eventStartsAt.getTime()) / 3_600_000);
  const fmtDate = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(d);
  const time = (d: Date) => fmtDate(d, { hour: 'numeric', minute: '2-digit' });
  const agreement = resolveAgreement(q.prefs.agreement);
  const due = amountDue(q);
  const gateway = await cardGateway(db, q);
  const color = q.tenant.brandColor || '#2C4FE0';
  const today = utcToWallTime(new Date(), tz).date;
  const open = o.status === 'draft' || o.status === 'quote_sent';
  const balanceInvoice = q.invoices.find((i) => i.kind === 'balance' || i.kind === 'full');

  const summary = orderSummaryRows(o, q.tenant.currency);

  const view: QuoteView = {
    token,
    brand: {
      name: q.tenant.name, color, onColor: checkAccent(color).onAccent, logoUrl: fileUrl(q.tenant.id, q.tenant.logoFileId),
      phone: formatPhone(q.location.phone ?? q.tenant.phone, q.tenant.country) || null, location: q.location.name, reviewLink: q.prefs.brand.reviewLink ?? null,
    },
    firstName: q.customer.firstName || (q.customer.displayName ?? 'there').split(' ')[0]!,
    order: {
      number: o.number,
      status: o.status,
      eventType: o.eventType && !/^other$/i.test(o.eventType) ? o.eventType.toLowerCase() : 'event',
      dateLong: fmtDate(o.eventStartsAt, { weekday: 'long', month: 'long', day: 'numeric' }),
      dateShort: fmtDate(o.eventStartsAt, { weekday: 'short', month: 'short', day: 'numeric' }),
      timeRange: `${time(o.eventStartsAt)} – ${time(o.eventEndsAt)}`,
      setupFrom: time(new Date(o.eventStartsAt.getTime() - 2 * 3_600_000)),
      where: o.eventLocationName || [o.eventLine1, o.eventCity].filter(Boolean)[0] || 'Your event address',
      address: [o.eventLine1, o.eventCity, o.eventRegion].filter(Boolean).join(', '),
      surface: q.prefs.booking.setupSurfaces.find((x) => x.code === o.setupSurface)?.label ?? null,
      items: q.lines.map((l) => ({
        name: l.name, quantity: l.quantity, total: money(Number(l.line_total_cents)), icon: l.icon, tint: l.tint, kind: l.kind ?? 'service',
        sub: [MODE[l.service_mode] ?? l.service_mode, `${Math.round(hours * 10) / 10} hours`, l.quantity > 1 ? `× ${l.quantity}` : null].filter(Boolean).join(' · '),
      })),
      summary,
      total: money(o.totalCents + o.creditCents),
      dueAfterCredits: o.creditCents ? money(o.totalCents) : null,
      deposit: money(o.depositDueCents),
      depositCents: o.depositDueCents,
      paid: money(o.paidCents),
      balance: money(Math.max(0, o.totalCents - o.paidCents)),
      validUntil: shortDay(o.quoteExpiresOn) || null,
      waiver: { on: o.damageWaiver, percent: Number(o.damageWaiverPercent), amount: money(s.damageWaiverCents ?? Math.round((o.merchandiseCents * Number(o.damageWaiverPercent)) / 100)) },
      balanceDue: shortDay(balanceInvoice?.dueOn) || null,
      autoCharge: !!balanceInvoice?.autoCharge,
    },
    state: o.status === 'cancelled' ? 'cancelled'
      : open && o.quoteExpiresOn && o.quoteExpiresOn < today ? 'expired'
        : !open && due.amountCents <= 0 ? 'done'
          : !open ? 'balance' : 'quote',
    due: { amountCents: due.amountCents, label: due.label, amount: money(due.amountCents) },
    agreement: {
      title: agreement.title, version: agreement.version, sections: agreementSections(agreement.body),
      policies: agreement.policies.map((p) => ({ key: p.key, title: p.title, text: policyText(p, agreement) })),
    },
    signature: q.signature ? { name: q.signature.typedName, at: q.signature.signedAt.toISOString(), version: q.signature.agreementVersion } : null,
    gateway: gateway ? { publishableKey: gateway.publishableKey, testMode: gateway.testMode } : null,
    card: q.card ? { brand: q.card.brand, last4: q.card.last4 } : null,
    payments: q.payments.map((p) => ({ number: p.number, amount: money(p.amountCents), last4: p.cardLast4, brand: p.cardBrand, method: p.method, at: p.receivedAt.toISOString() })),
    returningIntent: sp.payment_intent ?? null,
    currency: q.tenant.currency,
  };
  return <QuoteFlow view={view} />;
}
