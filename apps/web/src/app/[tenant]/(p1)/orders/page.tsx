import Link from 'next/link';
import { ClipboardList, MapPin, Plus } from 'lucide-react';
import { formatEventTime, ORDER_STATUS, type OrderStatus } from '@rental/core';
import { listOrders, type OrderListFilters } from '@rental/db';
import { Stagger, StaggerItem } from '@/components/motion';
import { Badge, cx, PageHeader } from '@/components/ui';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { SearchBox } from '../customers/search-box';

export const metadata = { title: 'Orders' };

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
] as const;

export default async function OrdersPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { tenant: slug } = await params;
  const { tab = 'upcoming', q = '' } = await searchParams;
  const { tenant } = await getTenantContext(slug);
  const now = new Date();
  const filters: Record<string, OrderListFilters> = {
    upcoming: { status: 'booked', from: now },
    quotes: { status: 'open', from: new Date(now.getTime() - 86_400_000) },
    past: { status: 'all', to: now },
    cancelled: { status: 'cancelled' },
    all: { status: 'all' },
  };
  let rows = await listOrders(db, tenant.id, { ...(filters[tab] ?? filters.upcoming), search: q || undefined });
  if (tab === 'quotes') rows = rows.filter((r) => r.status === 'draft' || r.status === 'quote_sent');
  if (tab === 'past') rows = rows.filter((r) => r.status !== 'cancelled');
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: tenant.currency });
  const monthDay = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tenant.timezone, month: 'short', day: 'numeric', weekday: 'short' }).formatToParts(d);
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return { month: g('month'), day: g('day'), weekday: g('weekday') };
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description="Quotes and bookings. Booked orders hold their equipment."
        actions={
          <Link href={`/${slug}/orders/new`} className="btn-shine inline-flex min-h-10 items-center gap-2 rounded-ui-sm bg-brand px-4 font-medium text-brand-fg shadow-[0_6px_16px_-8px_var(--brand)] hover:bg-brand-strong">
            <Plus aria-hidden className="size-4" /> New order
          </Link>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <nav aria-label="Order views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <Link key={t.key} href={`/${slug}/orders?tab=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ''}`} aria-current={tab === t.key ? 'page' : undefined}
              className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', tab === t.key ? 'brand-gradient text-brand-fg' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="w-full sm:ml-auto sm:w-72"><SearchBox initial={q} placeholder="Search number, customer or address" /></div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[calc(var(--radius)*1.4)] border border-dashed border-line-strong bg-surface p-10 text-center">
          <ClipboardList aria-hidden className="size-10 text-brand-text" />
          <p className="font-semibold">{q ? `No orders match "${q}".` : tab === 'upcoming' ? 'No upcoming bookings yet.' : 'Nothing here yet.'}</p>
          <Link href={`/${slug}/orders/new`} className="mt-1 font-medium text-brand-text underline">Create an order</Link>
        </div>
      ) : (
        <Stagger as="ul" className="flex flex-col gap-2.5" gap={0.03}>
          {rows.map((o) => {
            const d = monthDay(o.eventStartsAt);
            const st = ORDER_STATUS[o.status as OrderStatus];
            return (
              <StaggerItem as="li" key={o.id}>
                <Link href={`/${slug}/orders/${o.id}`} className="flex items-center gap-4 rounded-ui border border-line bg-surface p-3.5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
                  <span className={cx('flex w-14 shrink-0 flex-col items-center rounded-ui-sm py-1.5', o.status === 'booked' ? 'brand-gradient text-brand-fg' : 'bg-surface-2')}>
                    <span className="text-[11px] font-semibold uppercase">{d.month}</span>
                    <span className="font-display text-xl font-bold leading-none">{d.day}</span>
                    <span className="text-[11px]">{d.weekday}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{o.customerName}</span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="font-mono text-xs text-muted">{o.number}</span>
                    </span>
                    <span className="block truncate text-sm text-muted">{o.items || 'No items yet'}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>{formatEventTime(o.eventStartsAt, o.eventEndsAt, tenant.timezone).split(' · ')[1]}</span>
                      {(o.eventCity || o.eventLine1) && <span className="inline-flex items-center gap-1"><MapPin aria-hidden className="size-3" />{[o.eventLine1, o.eventCity].filter(Boolean).join(', ')}</span>}
                      <span>{o.locationName}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-lg font-bold tabular">{money.format(o.totalCents / 100)}</span>
                    <span className="block text-xs text-muted tabular">deposit {money.format(o.depositDueCents / 100)}</span>
                  </span>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </>
  );
}
