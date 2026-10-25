import { checkAccent, formatMoney } from '@rental/core';
import type { InvoiceDetail } from '@rental/db';
import { orderSummaryRows, shortDay } from './order-summary';
import { fileUrl } from './urls';

export const INVOICE_KIND: Record<string, string> = { deposit: 'Deposit invoice', balance: 'Balance invoice', full: 'Full invoice', tip: 'Tip invoice' };
const MODE: Record<string, string> = { staffed: 'staffed', pickup: 'pick-up', dropoff: 'drop-off' };

export type InvoiceDocData = {
  id: string; number: string; kind: string; kindLabel: string; status: string;
  brand: { name: string; initials: string; color: string; onColor: string; logoUrl: string | null; place: string };
  billTo: { name: string; email: string | null };
  orderNumber: string; orderId: string; issued: string; due: string; autoCharge: boolean;
  lines: { label: string; value: string; tone?: 'credit' }[];
  total: string; paid: string; amountDue: string; dueCents: number; paidCents: number; amountCents: number;
  sentAt: string | null; lastChargeError: string | null;
  schedule: { id: string; kind: string; label: string; amount: string; status: string; note: string; autoCharge: boolean; selected: boolean }[];
  card: { brand: string | null; last4: string | null } | null;
};

/** One invoice as a document: the order's lines, then whatever earlier invoices covered. */
export function invoiceDoc(d: InvoiceDetail, tenant: { id: string; name: string; currency: string; brandColor: string | null; logoFileId: string | null }): InvoiceDocData {
  const money = (c: number) => formatMoney(c, tenant.currency);
  const inv = d.invoice;
  const o = d.order;
  const hours = Math.round(((o.eventEndsAt.getTime() - o.eventStartsAt.getTime()) / 3_600_000) * 10) / 10;
  const color = tenant.brandColor || '#2C4FE0';
  const card = d.card ? { brand: d.card.brand, last4: d.card.last4 } : null;
  const cardText = card?.last4 ? `card ending ${card.last4}` : 'the saved card';
  let lines: InvoiceDocData['lines'];
  if (inv.kind === 'deposit') {
    lines = [
      { label: `Deposit to book ${o.number}`, value: money(inv.amountCents) },
      { label: `Order total ${money(o.totalCents)} · balance due on the event day`, value: '' },
    ];
  } else if (inv.kind === 'tip') {
    lines = [{ label: `Tip · ${o.number}`, value: money(inv.amountCents) }];
  } else {
    const items = d.lines.map((l) => ({ label: `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ''} · ${MODE[l.service_mode] ?? l.service_mode} ${hours} h`, value: money(Number(l.line_total_cents)) }));
    const extras = orderSummaryRows(o, tenant.currency).filter((r) => r.label !== 'Rental items');
    const covered = o.totalCents - inv.amountCents;
    lines = [...items, ...extras, ...(covered > 0 ? [{ label: 'Less deposit invoice', value: `−${money(covered)}`, tone: 'credit' as const }] : [])];
  }
  const paidLater = (i: (typeof d.schedule)[number]) => {
    const p = d.payments.filter((x) => x.invoiceId === i.id && x.status === 'received').at(-1);
    return p ? `Paid ${p.receivedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${p.cardLast4 ? ` · card ending ${p.cardLast4}` : ` · ${p.method}`}` : `Paid ${shortDay(i.paidAt?.toISOString().slice(0, 10))}`;
  };
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    kindLabel: INVOICE_KIND[inv.kind] ?? 'Invoice',
    status: inv.status,
    brand: {
      name: tenant.name, initials: tenant.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase(), color, onColor: checkAccent(color).onAccent,
      logoUrl: fileUrl(tenant.id, tenant.logoFileId), place: [d.location.name, d.location.city].filter((x, i, a) => x && a.indexOf(x) === i).join(' · '),
    },
    billTo: { name: d.customer.displayName ?? 'Customer', email: d.customer.email },
    orderNumber: o.number,
    orderId: o.id,
    issued: inv.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    due: shortDay(inv.dueOn),
    autoCharge: inv.autoCharge,
    lines,
    total: money(inv.amountCents),
    paid: money(inv.paidCents),
    amountDue: money(Math.max(0, inv.amountCents - inv.paidCents)),
    dueCents: Math.max(0, inv.amountCents - inv.paidCents),
    paidCents: inv.paidCents,
    amountCents: inv.amountCents,
    sentAt: inv.sentAt ? inv.sentAt.toISOString() : null,
    lastChargeError: inv.lastChargeError,
    card,
    schedule: d.schedule.map((i) => ({
      id: i.id,
      kind: i.kind,
      label: `${(INVOICE_KIND[i.kind] ?? 'Invoice').replace(' invoice', '')} · ${money(i.amountCents)}`,
      amount: money(i.amountCents),
      status: i.status,
      autoCharge: i.autoCharge,
      selected: i.id === inv.id,
      note:
        i.status === 'paid' ? paidLater(i)
          : i.status === 'overdue' ? `Overdue · was due ${shortDay(i.dueOn)}${i.lastChargeError ? ` · ${i.lastChargeError}` : ''}`
            : i.autoCharge && card ? `Charged ${shortDay(i.dueOn)} at 8:00 AM to ${cardText}, then receipt sent`
              : `Due ${shortDay(i.dueOn)}${i.autoCharge ? ' · auto-charge once a card is saved' : ''}`,
    })),
  };
}
