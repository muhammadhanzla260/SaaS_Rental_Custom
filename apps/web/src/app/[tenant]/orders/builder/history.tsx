'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { MANUAL_METHODS } from '@rental/core';
import { Button, Card, cx, Pill, useToast } from '@/components/kit';
import { timeAgo } from '@/lib/audit-text';
import { INVOICE_KIND } from '@/lib/invoice-doc';
import { shortDay } from '@/lib/order-summary';
import { quoteLinkAction } from '@/server/actions/money';
import type { BuilderOrder } from './types';

const ACTION: Record<string, string> = {
  created: 'Created',
  updated: 'Changed',
  booked: 'Booked',
  send_quote: 'Quote sent',
  cancel: 'Cancelled',
  reopen: 'Reopened',
  complete: 'Completed',
  payment: 'Payment recorded',
  overpayment_to_wallet: 'Overpayment moved to wallet',
  refund_owed: 'Refund owed',
  call_logged: 'Pre-event call made',
};
const METHOD = Object.fromEntries(MANUAL_METHODS.map((m) => [m.value, m.label])) as Record<string, string>;
const INVOICE_STATUS: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info'; label: string }> = {
  paid: { tone: 'success', label: 'Paid' }, open: { tone: 'warning', label: 'Unpaid' }, partial: { tone: 'info', label: 'Part paid' }, overdue: { tone: 'danger', label: 'Overdue' },
};

// Times in the diff are ISO instants: show them in the location's time zone.
function pretty(v: string, tz: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return new Date(v).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  return v || '—';
}

/** "Who changed what": every saved version with its field-by-field diff, plus payments. */
export function OrderHistory({
  slug, order, money, tz, locationName, customerName,
}: { slug: string; order: BuilderOrder; money: (c: number) => string; tz: string; locationName: (id: string) => string; customerName: string }) {
  const [all, setAll] = useState(false);
  const [copying, setCopying] = useState(false);
  const toast = useToast();
  const copyLink = async () => {
    setCopying(true);
    const r = await quoteLinkAction(slug, order.id);
    setCopying(false);
    if (!r.ok) return toast(r.error, 'error');
    try {
      await navigator.clipboard.writeText(r.data!.url);
      toast('Customer link copied. Paste it into a text or email.');
    } catch {
      window.prompt('Copy the customer link:', r.data!.url);
    }
  };
  const versions = all ? order.versions : order.versions.slice(0, 5);
  const show = (field: string, v: string) => (field === 'Location' ? locationName(v) : field === 'Customer' ? customerName : pretty(v, tz));
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 text-lg font-semibold text-fg">Order history</h2>
        <ol className="relative flex flex-col gap-5 border-l border-subtle pl-5">
          {versions.map((v) => {
            const rows = Object.entries(v.diff ?? {}).filter(([k]) => v.action !== 'created' || ['Status', 'Total', 'Starts'].includes(k));
            return (
              <li key={v.version} className="relative">
                <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-surface bg-accent" aria-hidden />
                <p className="text-sm text-fg">
                  <b>{ACTION[v.action] ?? v.action}</b> · <span className="mono text-fg-2">v{v.version}</span> · {v.actorName ?? 'Someone'} · <span className="text-fg-2">{timeAgo(new Date(v.at))}</span>
                  {v.totals?.totalCents != null && <span className="mono text-fg-2"> · total {money(v.totals.totalCents)}</span>}
                </p>
                {v.reason && <p className="mt-0.5 text-[13px] text-fg-2">“{v.reason}”</p>}
                {v.action !== 'created' && rows.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {rows.slice(0, 12).map(([k, d]) => (
                      <li key={k} className="text-[13px]">
                        <span className="font-semibold text-fg">{k}</span>{' '}
                        {d.from && <span className="text-fg-2 line-through">{show(k, d.from)}</span>}
                        {d.from && d.to && <span className="text-fg-3"> → </span>}
                        <span className={cx(d.to ? 'text-fg' : 'text-fg-2')}>{d.to ? show(k, d.to) : 'removed'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
        {order.versions.length > 5 && (
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => setAll((a) => !a)}>{all ? 'Show fewer' : `Show all ${order.versions.length} versions`}</Button>
        )}
      </Card>
      <Card className="flex flex-col gap-5 self-start p-5 sm:p-6">
        {order.invoices.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold text-fg">Invoices</h2>
            <ul className="divide-y divide-subtle">
              {order.invoices.map((i) => {
                const st = INVOICE_STATUS[i.status === 'open' && i.paidCents > 0 ? 'partial' : i.status] ?? INVOICE_STATUS.open!;
                return (
                  <li key={i.id}>
                    <Link href={`/${slug}/invoices?id=${i.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-[10px] px-2 py-2.5 hover:bg-hover">
                      <span className="min-w-0">
                        <span className="mono block text-[13px] text-fg">{i.number}</span>
                        <span className="block text-[12px] text-fg-2">
                          {(INVOICE_KIND[i.kind] ?? 'Invoice').replace(' invoice', '')}{i.status !== 'paid' && i.dueOn ? ` · due ${shortDay(i.dueOn)}` : ''}{i.autoCharge && i.status !== 'paid' ? ' · auto-charge' : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="mono text-sm font-semibold text-fg">{money(i.amountCents)}</span>
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-fg">Payments</h2>
          {order.payments.length === 0 ? (
            <p className="text-sm text-fg-2">{order.unpaidReason ? `Booked without payment: ${order.unpaidReason}${order.expectedPaymentOn ? `, expected ${order.expectedPaymentOn}` : ''}.` : 'Nothing paid yet.'}</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {order.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="mono block text-[13px] text-fg">{p.number}</span>
                    <span className="block text-[12px] text-fg-2">{p.cardLast4 ? `Card •${p.cardLast4}` : METHOD[p.method] ?? p.method}{p.reference ? ` · ${p.reference}` : ''} · {new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  </span>
                  <span className="mono text-sm font-semibold text-success-fg">{money(p.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {order.status !== 'cancelled' && (
          <Button variant="secondary" icon={<Copy className="size-4" />} pending={copying} onClick={copyLink}>Copy customer link</Button>
        )}
      </Card>
    </div>
  );
}
