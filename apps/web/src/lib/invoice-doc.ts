import { checkAccent, depositStep, formatMoney, utcToWallTime } from '@rental/core';
import type { InvoiceDetail } from '@rental/db';
import { orderSummaryRows, shortDay } from './order-summary';
import { fileUrl } from './urls';

/** One invoice per order now (kind 'full'); older kinds read the same. */
export const INVOICE_KIND: Record<string, string> = { deposit: 'Invoice', balance: 'Invoice', full: 'Invoice', tip: 'Tip' };
const MODE: Record<string, string> = { staffed: 'staffed', pickup: 'pick-up', dropoff: 'drop-off' };

export type InvoiceDocData = {
  id: string; number: string; kind: string; kindLabel: string; status: string;
  brand: { name: string; initials: string; color: string; onColor: string; logoUrl: string | null; place: string };
  billTo: { name: string; email: string | null };
  orderNumber: string; orderId: string; issued: string; due: string; autoCharge: boolean;
  lines: { label: string; value: string; tone?: 'credit' }[];
  total: string; paid: string; amountDue: string; dueCents: number; paidCents: number; amountCents: number;
  sentAt: string | null; lastChargeError: string | null;
  /** The invoice's payment schedule: the deposit, then the balance on the event day. */
  schedule: { id: string; invoiceId: string; kind: 'deposit' | 'balance'; label: string; amount: string; status: string; note: string; autoCharge: boolean; selected: boolean }[];
  /** Receipts taken against the order (they carry the order's number). */
  receipts: { id: string; number: string; date: string; method: string; amount: string; tip: string | null }[];
  card: { brand: string | null; last4: string | null } | null;
};

/**
 * The order's invoice as a document: every line of the order as it stands now,
 * the total, what was paid and what is due, then its payment schedule. Edits to
 * the order after the deposit change the total and the amount due.
 */
export function invoiceDoc(d: InvoiceDetail, tenant: { id: string; name: string; currency: string; brandColor: string | null; logoFileId: string | null }): InvoiceDocData {
  const money = (c: number) => formatMoney(c, tenant.currency);
  const inv = d.invoice;
  const o = d.order;
  const tz = d.location.timezone;
  const hours = Math.round(((o.eventEndsAt.getTime() - o.eventStartsAt.getTime()) / 3_600_000) * 10) / 10;
  const color = tenant.brandColor || '#2C4FE0';
  const card = d.card ? { brand: d.card.brand, last4: d.card.last4 } : null;
  const cardText = card?.last4 ? `card ending ${card.last4}` : 'the saved card';
  const items = d.lines.map((l) => ({ label: `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ''} · ${MODE[l.service_mode] ?? l.service_mode}${o.multiDay ? '' : ` ${hours} h`}`, value: money(Number(l.line_total_cents)) }));
  const extras = orderSummaryRows(o, tenant.currency).filter((r) => r.label !== 'Rental items');
  const lines: InvoiceDocData['lines'] = inv.kind === 'tip' ? [{ label: `Tip · ${o.number}`, value: money(inv.amountCents) }] : [...items, ...extras];

  const received = d.payments.filter((p) => p.status === 'received');
  const day = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
  const how = (p: (typeof received)[number]) => (p.cardLast4 ? `card ending ${p.cardLast4}` : p.method);
  const paid = inv.paidCents;
  const deposit = Math.min(depositStep(o, d.payments), inv.amountCents);
  const eventDay = utcToWallTime(o.eventStartsAt, tz).date;
  const bookedDay = o.bookedAt ? utcToWallTime(o.bookedAt, tz).date : inv.dueOn;
  const lastBy = (cents: number) => {
    // The receipt that brought the running total to `cents`.
    let run = 0;
    for (const p of received) {
      run += p.amountCents;
      if (run >= cents && p.amountCents > 0) return p;
    }
    return null;
  };
  const paidNote = (cents: number) => {
    const p = lastBy(cents);
    return p ? `Paid ${day(p.receivedAt)} · ${how(p)}` : 'Paid';
  };
  const balanceCents = inv.amountCents - deposit;
  const steps: InvoiceDocData['schedule'] = [];
  if (deposit > 0) {
    const done = paid >= deposit;
    steps.push({
      id: `${inv.id}:deposit`, invoiceId: inv.id, kind: 'deposit', label: `Deposit · ${money(deposit)}`, amount: money(deposit), autoCharge: false, selected: !done,
      status: done ? 'paid' : bookedDay < utcToWallTime(new Date(), tz).date ? 'overdue' : 'open',
      note: done ? paidNote(deposit) : `Due ${shortDay(bookedDay)} to hold the booking`,
    });
  }
  if (balanceCents > 0 || deposit === 0) {
    const done = paid >= inv.amountCents;
    const part = Math.max(0, paid - deposit);
    steps.push({
      id: `${inv.id}:balance`, invoiceId: inv.id, kind: 'balance', label: `${deposit > 0 ? 'Balance' : 'Full amount'} · ${money(balanceCents)}`, amount: money(balanceCents),
      autoCharge: inv.autoCharge, selected: paid >= deposit && !done,
      status: done ? 'paid' : inv.status === 'overdue' && paid >= deposit ? 'overdue' : 'open',
      note: done ? paidNote(inv.amountCents)
        : inv.status === 'overdue' && paid >= deposit ? `Overdue · was due ${shortDay(eventDay)}${inv.lastChargeError ? ` · ${inv.lastChargeError}` : ''}`
          : `${part > 0 ? `${money(part)} paid · ` : ''}${inv.autoCharge && card ? `${money(balanceCents - part)} charged ${shortDay(eventDay)} at 8:00 AM to ${cardText}, then receipt sent` : `Due ${shortDay(eventDay)} (event day)${inv.autoCharge ? ' · auto-charge once a card is saved' : ''}`}`,
    });
  }

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
    paid: money(paid),
    amountDue: money(Math.max(0, inv.amountCents - paid)),
    dueCents: Math.max(0, inv.amountCents - paid),
    paidCents: paid,
    amountCents: inv.amountCents,
    sentAt: inv.sentAt ? inv.sentAt.toISOString() : null,
    lastChargeError: inv.lastChargeError,
    card,
    schedule: steps,
    receipts: received.map((p) => ({
      id: p.id, number: p.number, date: day(p.receivedAt), method: how(p), amount: money(p.amountCents), tip: p.tipCents ? money(p.tipCents) : null,
    })),
  };
}
