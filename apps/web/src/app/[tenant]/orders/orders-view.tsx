'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { formatEventTime, formatMoney, ORDER_STATUS, type OrderStatus } from '@rental/core';
import { Card, cx, EmptyState, FilterChips, Input, LinkButton, Pill, Select, Spinner } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';

export type OrderRow = {
  id: string; number: string; status: string; customerName: string; startsAt: string; endsAt: string; tz: string; items: string; locationCode: string;
  city: string | null; totalCents: number; paidCents: number; depositDueCents: number; unpaidReason: string | null;
};

export function payState(o: Pick<OrderRow, 'status' | 'totalCents' | 'paidCents' | 'depositDueCents' | 'unpaidReason'>) {
  if (o.status !== 'booked' && o.status !== 'completed') return null;
  if (o.paidCents >= o.totalCents && o.totalCents > 0) return { label: 'Paid', tone: 'success' as const };
  if (o.paidCents >= o.depositDueCents && o.paidCents > 0) return { label: 'Deposit paid', tone: 'info' as const };
  if (o.unpaidReason) return { label: `Unpaid · ${o.unpaidReason.toLowerCase()}`, tone: 'warning' as const };
  if (o.paidCents > 0) return { label: 'Part paid', tone: 'warning' as const };
  return { label: 'Unpaid', tone: 'warning' as const };
}

export function OrdersView({
  slug, rows, view, q, locations, locationId, currency, canCreate,
}: { slug: string; rows: OrderRow[]; view: string; q: string; locations: { id: string; name: string }[]; locationId: string; currency: string; canCreate: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const money = (c: number) => formatMoney(c, currency);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  useEffect(() => {
    if (search === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: search.trim() || null }), 250);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Orders' }]}
        actions={canCreate && <LinkButton href={`/${slug}/orders/new`} size="sm" icon={<Plus className="size-4" />}>New order</LinkButton>}
      />
      <PageBody wide>
        <h1 className="mb-6 font-display text-[32px] font-extrabold tracking-tight text-fg sm:text-4xl">Orders</h1>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <FilterChips
            label="Show"
            value={view}
            onChange={(v) => go({ v: v === 'upcoming' ? null : v })}
            chips={[
              { value: 'upcoming', label: 'Upcoming' }, { value: 'quotes', label: 'Drafts & quotes' }, { value: 'unpaid', label: 'Booked unpaid' },
              { value: 'past', label: 'Past' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' },
            ]}
          />
          <div className="flex flex-1 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
              <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, customer, city or street" aria-label="Search orders" className="pl-9" />
              {pending && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" />}
            </div>
            {locations.length > 1 && (
              <Select aria-label="Location" value={locationId} onChange={(e) => go({ loc: e.target.value || null })} className="w-40">
                <option value="">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>
        </div>

        <Card className={cx('overflow-hidden transition-opacity', pending && 'opacity-70')}>
          {rows.length === 0 ? (
            <EmptyState
              title={q ? 'No orders match' : view === 'upcoming' ? 'No upcoming bookings' : 'Nothing here'}
              sub={view === 'upcoming' ? 'Booked events from today on show here. Drafts and quotes are under “Drafts & quotes”.' : 'Try another filter.'}
              action={canCreate ? <LinkButton href={`/${slug}/orders/new`} icon={<Plus className="size-4" />}>New order</LinkButton> : undefined}
            />
          ) : (
            <>
              <div className="hidden grid-cols-[150px_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_110px_150px] gap-4 border-b border-subtle bg-sunken/60 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-fg-2 lg:grid">
                <span>Order</span><span>Customer</span><span>Event</span><span>Items</span><span className="text-right">Total</span><span>Payment</span>
              </div>
              <ul className="divide-y divide-subtle">
                {rows.map((o, i) => {
                  const st = ORDER_STATUS[o.status as OrderStatus];
                  const pay = payState(o);
                  return (
                    <li key={o.id} className="anim-rise" style={{ ['--d' as string]: `${Math.min(i, 12) * 20}ms` }}>
                      <Link href={`/${slug}/orders/${o.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-hover lg:grid-cols-[150px_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,1.6fr)_110px_150px] lg:items-center">
                        <span className="flex items-center gap-2 lg:flex-col lg:items-start lg:gap-1">
                          <span className="mono text-[13px] font-semibold text-fg">{o.number}</span>
                          <Pill tone={(st?.tone ?? 'neutral') as 'neutral'}>{st?.label ?? o.status}</Pill>
                        </span>
                        <span className="mono text-right text-sm font-semibold text-fg lg:hidden">{money(o.totalCents)}</span>
                        <span className="truncate font-semibold text-fg max-lg:col-span-2">{o.customerName}</span>
                        <span className="text-sm text-fg-2 max-lg:col-span-2">
                          {formatEventTime(new Date(o.startsAt), new Date(o.endsAt), o.tz)}
                          <span className="block text-[12px] text-fg-3">{[o.city, o.locationCode].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="truncate text-sm text-fg-2 max-lg:col-span-2">{o.items || '—'}</span>
                        <span className="mono hidden text-right text-sm font-semibold text-fg lg:block">{money(o.totalCents)}</span>
                        <span className="max-lg:col-span-2">{pay && <Pill tone={pay.tone}>{pay.label}</Pill>}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="border-t border-subtle px-5 py-3 text-[13px] text-fg-2">{rows.length} order{rows.length === 1 ? '' : 's'}{rows.length >= 300 && ' · search to narrow down'}</p>
            </>
          )}
        </Card>
      </PageBody>
    </>
  );
}
