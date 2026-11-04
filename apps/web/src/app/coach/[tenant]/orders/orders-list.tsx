'use client';

import { Lock, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatMoney } from '@rental/core';
import { Button, Card, EmptyState, FilterChips, Input, Modal } from '@/components/kit';
import { fmtWindow, PhaseBar, StatusPill } from '../ui';

type Row = {
  id: string; number: string; status: string; statusLabel: string; workable: boolean; customerName: string; startsAt: string; endsAt: string;
  timezone: string; totalCents: number; rating: number; phases: number[]; enRoute: string; completed: boolean; role: string;
};

const FILTERS = ['all', 'booked', 'quote', 'draft', 'completed', 'cancelled'] as const;
type Filter = (typeof FILTERS)[number];

const matches = (o: Row, f: Filter) =>
  f === 'all' ? true
  : f === 'booked' ? o.status === 'booked' && !o.completed
  : f === 'quote' ? o.status === 'quote_sent'
  : f === 'draft' ? o.status === 'draft'
  : f === 'completed' ? o.completed || o.status === 'completed'
  : o.status === 'cancelled';

const LABEL: Record<Filter, string> = { all: 'All', booked: 'Booked', quote: 'Quotes', draft: 'Drafts', completed: 'Completed', cancelled: 'Cancelled' };

export function OrdersList({ slug, orders, currency, initialFilter }: { slug: string; orders: Row[]; currency: string; initialFilter: string }) {
  const [filter, setFilter] = useState<Filter>((FILTERS as readonly string[]).includes(initialFilter) ? (initialFilter as Filter) : 'all');
  const [q, setQ] = useState('');
  const [locked, setLocked] = useState<Row | null>(null);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => matches(o, filter) && (!term || o.number.toLowerCase().includes(term) || o.customerName.toLowerCase().includes(term)));
  }, [orders, filter, q]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-fg-3">Assigned to you</p>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Your orders</h1>
      </div>
      <label className="relative block">
        <span className="sr-only">Search orders</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer or order #" className="pl-9" inputMode="search" />
      </label>
      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <FilterChips
          label="Status"
          value={filter}
          onChange={setFilter}
          chips={FILTERS.map((f) => ({ value: f, label: LABEL[f], count: orders.filter((o) => matches(o, f)).length }))}
        />
      </div>

      {shown.length === 0 ? (
        <Card><EmptyState title="No orders here" sub={q ? 'Nothing matches that search.' : 'Orders you are assigned to show up here.'} /></Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((o, i) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="mono text-[13px] font-semibold text-fg">{o.number}{o.role === 'crew' && <span className="ml-2 font-sans text-[11px] font-semibold text-fg-3">Crew</span>}</p>
                    <p className="truncate text-[15px] font-semibold text-fg">{o.customerName}</p>
                  </div>
                  <StatusPill label={o.statusLabel} />
                </div>
                <p className="mt-1 text-[12px] text-fg-2">{fmtWindow(o.startsAt, o.endsAt, o.timezone)}</p>
                <div className="mt-2.5 flex items-center gap-3 text-[12px]">
                  {o.workable ? <PhaseBar phases={o.phases} className="flex-1" /> : <span className="flex flex-1 items-center gap-1 text-fg-3"><Lock className="size-3.5" /> Locked</span>}
                  <span className="mono font-semibold text-fg">{Math.round(o.rating)}%</span>
                </div>
                <div className="mt-2 flex justify-between text-[12px] text-fg-2">
                  <span>En route: <span className="font-semibold text-fg">{o.enRoute}</span></span>
                  <span className="mono font-semibold text-fg">{formatMoney(o.totalCents, currency)}</span>
                </div>
              </>
            );
            const cls = 'lift anim-rise block w-full rounded-[var(--radius-card)] border border-subtle bg-surface p-3.5 text-left';
            return (
              <li key={o.id}>
                {o.workable ? (
                  <Link href={`/coach/${slug}/orders/${o.id}`} className={cls} style={{ '--d': `${Math.min(i, 8) * 30}ms` } as React.CSSProperties}>{body}</Link>
                ) : (
                  <button type="button" onClick={() => setLocked(o)} className={cls} style={{ '--d': `${Math.min(i, 8) * 30}ms` } as React.CSSProperties}>{body}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={!!locked} onClose={() => setLocked(null)} title="Order detail unavailable" footer={<Button onClick={() => setLocked(null)}>OK</Button>}>
        {locked && (
          <p className="text-sm text-fg-2">
            Order {locked.number} is a {locked.statusLabel} order. The detail page is only available for Booked orders.
          </p>
        )}
      </Modal>
    </div>
  );
}
