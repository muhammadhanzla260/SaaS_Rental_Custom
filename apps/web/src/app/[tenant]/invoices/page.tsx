import { formatMoney } from '@rental/core';
import { getInvoice, listInvoices, listPayments, type InvoiceFilter } from '@rental/db';
import { INVOICE_KIND, invoiceDoc } from '@/lib/invoice-doc';
import { shortDay } from '@/lib/order-summary';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { InvoicesView, type InvoiceRow, type PaymentRow } from './invoices-view';

export const metadata = { title: 'Invoices & payments' };

const FILTERS: InvoiceFilter[] = ['all', 'open', 'overdue', 'paid'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD: Record<string, string> = { cash: 'Cash', check: 'Check', zelle: 'Zelle', venmo: 'Venmo', ach: 'ACH', other: 'Other', card: 'Card', wallet: 'Wallet credit' };

export default async function InvoicesPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ tab?: string; f?: string; q?: string; id?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const tab = sp.tab === 'payments' ? 'payments' : 'invoices';
  const filter = (FILTERS as string[]).includes(sp.f ?? '') ? (sp.f as InvoiceFilter) : 'all';
  const q = (sp.q ?? '').slice(0, 80);
  const money = (c: number) => formatMoney(c, ctx.tenant.currency);

  const [list, pays] = await Promise.all([
    listInvoices(db, ctx.tenant.id, { filter, search: q }),
    tab === 'payments' ? listPayments(db, ctx.tenant.id) : Promise.resolve([]),
  ]);
  const explicit = !!(sp.id && UUID.test(sp.id));
  const selectedId = explicit ? sp.id! : tab === 'invoices' ? list.rows[0]?.id : undefined;
  const detail = selectedId ? await getInvoice(db, ctx.tenant.id, selectedId) : null;

  const rows: InvoiceRow[] = list.rows.map((r) => ({
    id: r.id,
    number: r.number,
    kindLabel: INVOICE_KIND[r.kind] ?? 'Invoice',
    customer: r.customerName || 'Customer',
    orderNumber: r.orderNumber,
    amount: money(r.amountCents),
    status: r.status === 'open' && r.paidCents > 0 ? 'partial' : r.status,
    sub:
      r.status === 'paid' ? `Paid ${r.paidAt ? r.paidAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`
        : r.status === 'overdue' ? `Overdue · was due ${shortDay(r.dueOn)}`
          : `Due ${shortDay(r.dueOn)}${r.autoCharge ? ' · auto-charge' : ''}${r.paidCents > 0 ? ` · ${money(r.amountCents - r.paidCents)} left` : ''}`,
  }));
  const payments: PaymentRow[] = pays.map((p) => ({
    id: p.id,
    number: p.number,
    customer: p.customerName || 'Customer',
    orderNumber: p.orderNumber,
    invoiceNumber: p.invoiceNumber,
    method: p.cardLast4 ? `${(p.cardBrand ?? 'card').toUpperCase()} •${p.cardLast4}` : METHOD[p.method] ?? p.method,
    gateway: p.gateway,
    amount: money(p.amountCents),
    tip: p.tipCents ? money(p.tipCents) : null,
    steps: (p.steps ?? {}) as Record<string, string>,
    status: p.status,
    at: p.receivedAt.toISOString(),
  }));

  return (
    <InvoicesView
      slug={slug}
      tab={tab}
      filter={filter}
      q={q}
      rows={rows}
      counts={list.counts}
      kpis={{
        outstanding: money(list.kpis.outstanding), overdue: money(list.kpis.overdue), autoChargesWeek: money(list.kpis.autoChargesWeek), collectedMonth: money(list.kpis.collectedMonth),
      }}
      doc={detail ? invoiceDoc(detail, ctx.tenant) : null}
      explicit={explicit}
      payments={payments}
      currency={ctx.tenant.currency}
      timezone={ctx.tenant.timezone}
      canRecord={ctx.can('payments.record')}
    />
  );
}
