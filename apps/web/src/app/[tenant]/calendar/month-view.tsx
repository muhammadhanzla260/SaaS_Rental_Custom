'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { DAY_COUNT_KEYS, type DayCountKey } from '@rental/core';
import { Card, cx, Drawer, LinkButton, Pill, Segmented, Select } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';

export type MonthOrder = { id: string; number: string; status: string; customerName: string; when: string; items: string; location: string; total: string };

/** The Odoo calendar's count circles: filled for booked work, outlined for quotes and drafts. */
export const COUNT_STYLE: Record<DayCountKey, { label: string; badge: string; text: string; legend: string }> = {
  delivery: { label: 'Delivery', badge: 'bg-[#1e7b34] text-white', text: 'text-[#1e7b34] dark:text-[#5fd17c]', legend: 'booked rentals starting this day.' },
  service: { label: 'Service / Time-in', badge: 'bg-[#1d5fc4] text-white', text: 'text-[#1d5fc4] dark:text-[#7aa7ff]', legend: 'multi-day rentals in progress this day.' },
  pickup: { label: 'Pickup', badge: 'bg-[#c62828] text-white', text: 'text-[#c62828] dark:text-[#ff8a8a]', legend: 'booked rentals ending this day that started on an earlier day.' },
  quote: { label: 'Quote', badge: 'border-2 border-[#d4b100] bg-[#fffbe6] text-[#5c4a00]', text: 'text-[#a08400] dark:text-[#f0d24a]', legend: 'open quotes starting this day.' },
  draft: { label: 'Draft', badge: 'border-2 border-[#90a4ae] bg-surface text-fg', text: 'text-[#546e7a] dark:text-[#b0bec5]', legend: 'unfinished drafts starting this day.' },
  cancel: { label: 'Cancelled', badge: 'bg-[#8a9099] text-white', text: 'text-fg-2', legend: 'cancelled events starting this day.' },
};

const STATUS_PILL: Record<string, { tone: 'success' | 'info' | 'warning' | 'neutral' | 'danger'; label: string }> = {
  booked: { tone: 'success', label: 'Booked' }, completed: { tone: 'neutral', label: 'Completed' }, quote_sent: { tone: 'warning', label: 'Quote sent' },
  draft: { tone: 'neutral', label: 'Draft' }, cancelled: { tone: 'danger', label: 'Cancelled' },
};

export function MonthView({
  slug, month, today, weeks, counts, orders, followUps, locations, locationId, weekdays, canCreate,
}: {
  slug: string; month: { date: string; title: string; prev: string; next: string }; today: string;
  weeks: { number: number; days: { date: string; inMonth: boolean }[] }[];
  counts: Record<string, Partial<Record<DayCountKey, string[]>>>; orders: Record<string, MonthOrder>;
  followUps: { id: string; label: string; daysLate: number }[]; locations: { id: string; name: string }[]; locationId: string; weekdays: string[]; canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ date: string; key: DayCountKey } | null>(null);
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ view: 'month', date: month.date, loc: locationId, ...patch });
    return `/${slug}/calendar?${p.toString()}`;
  };
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const listed = open ? (counts[open.date]?.[open.key] ?? []).map((id) => orders[id]).filter(Boolean) as MonthOrder[] : [];

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Calendar' }]}
        actions={canCreate && <LinkButton href={`/${slug}/orders/new${locationId !== 'all' ? `?loc=${locationId}` : ''}`} size="sm" icon={<Plus className="size-4" />}><span className="max-sm:hidden">Book now</span><span className="sm:hidden">New</span></LinkButton>}
      />
      <PageBody wide>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="mr-1 font-display text-[26px] font-extrabold tracking-tight text-fg sm:text-[32px]">{month.title}</h1>
          <div className="flex items-center gap-1.5">
            <Link aria-label="Previous month" href={href({ date: month.prev })} className="press grid size-10 place-items-center rounded-[var(--radius-control)] border border-control bg-surface text-fg hover:bg-hover"><ChevronLeft className="size-5" /></Link>
            <Link href={href({ date: today })} className="press inline-flex h-10 items-center rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-semibold text-fg hover:bg-hover">Today</Link>
            <Link aria-label="Next month" href={href({ date: month.next })} className="press grid size-10 place-items-center rounded-[var(--radius-control)] border border-control bg-surface text-fg hover:bg-hover"><ChevronRight className="size-5" /></Link>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Segmented label="View" value="month" onChange={(v) => router.push(`/${slug}/calendar?${new URLSearchParams({ view: v, date: month.date, ...(locationId !== 'all' ? { loc: locationId } : {}) })}`)}
              options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} />
            {locations.length > 1 && (
              <Select aria-label="Location" value={locationId} onChange={(e) => router.push(href({ loc: e.target.value }))} className="h-10 w-40">
                <option value="all">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="overflow-hidden">
            <div role="grid" aria-label={`${month.title} bookings`} className="text-fg">
              <div role="row" className="grid grid-cols-7 border-b border-subtle bg-sunken/50">
                {weekdays.map((w) => <div key={w} role="columnheader" className="py-2 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-fg-2"><span className="sm:hidden">{w.slice(0, 1)}</span><span className="max-sm:hidden">{w}</span></div>)}
              </div>
              {weeks.map((wk) => (
                <div key={wk.number + wk.days[0]!.date} role="row" className="grid grid-cols-7 border-b border-subtle last:border-b-0">
                  {wk.days.map((d, i) => {
                    const c = counts[d.date] ?? {};
                    const isToday = d.date === today;
                    return (
                      <div key={d.date} role="gridcell" aria-label={dayLabel(d.date)}
                        className={cx('relative flex min-h-[78px] flex-col gap-1.5 border-r border-subtle p-1.5 last:border-r-0 sm:min-h-[104px] sm:p-2', !d.inMonth && 'bg-sunken/40', isToday && 'bg-[color-mix(in_srgb,var(--color-danger)_6%,transparent)]')}>
                        <div className="flex items-center justify-between">
                          {i === 0 ? <span className="mono text-[10px] text-fg-3 max-sm:hidden" title="Week">{wk.number}</span> : <span />}
                          <Link href={`/${slug}/calendar?${new URLSearchParams({ view: 'day', date: d.date, ...(locationId !== 'all' ? { loc: locationId } : {}) })}`}
                            aria-label={`Open ${dayLabel(d.date)}`}
                            className={cx('grid size-7 place-items-center rounded-full text-[13px] font-semibold hover:bg-hover', isToday ? 'bg-danger text-white hover:bg-danger' : d.inMonth ? 'text-fg' : 'text-fg-3')}>
                            {Number(d.date.slice(8))}
                          </Link>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {DAY_COUNT_KEYS.filter((k) => c[k]?.length).map((k) => (
                            <button key={k} type="button" onClick={() => setOpen({ date: d.date, key: k })}
                              title={`${COUNT_STYLE[k].label}: ${c[k]!.length} — open the list`} aria-label={`${COUNT_STYLE[k].label}: ${c[k]!.length}`}
                              className={cx('press grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] font-bold leading-none transition-transform hover:scale-110 sm:h-7 sm:min-w-7', COUNT_STYLE[k].badge)}>
                              {c[k]!.length}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>

          <aside className="flex flex-col gap-4">
            {followUps.length > 0 && (
              <Card className="border-[#e6c800] bg-[#fffbe6] p-4 dark:bg-[#2a2508]">
                <h2 className="mb-2 text-sm font-bold text-fg">Quote follow-ups past due</h2>
                <ul className="flex flex-col">
                  {followUps.map((f) => (
                    <li key={f.id}>
                      <Link href={`/${slug}/orders/${f.id}`} className="-mx-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-[13px] hover:bg-black/5 dark:hover:bg-white/5">
                        <span className="min-w-0 truncate text-fg">{f.label}</span>
                        <span className="shrink-0 font-semibold text-danger">{f.daysLate} days</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-bold text-fg">Calendar counts</h2>
              <ul className="flex flex-col gap-2.5 text-[13px] text-fg-2">
                {DAY_COUNT_KEYS.map((k) => (
                  <li key={k} className="flex items-start gap-2.5">
                    <span className={cx('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold', COUNT_STYLE[k].badge)} aria-hidden>#</span>
                    <span><span className={cx('font-semibold', COUNT_STYLE[k].text)}>{COUNT_STYLE[k].label}</span> — {COUNT_STYLE[k].legend}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      </PageBody>

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `${COUNT_STYLE[open.key].label} · ${listed.length}` : ''} sub={open ? dayLabel(open.date) : undefined}>
        <ul className="flex flex-col gap-2">
          {listed.map((o) => {
            const st = STATUS_PILL[o.status] ?? STATUS_PILL.draft!;
            return (
              <li key={o.id}>
                <Link href={`/${slug}/orders/${o.id}`} className="press block rounded-[var(--radius-card)] border border-subtle p-3 hover:bg-hover">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-fg">{o.customerName || 'Customer'}</span>
                    <Pill tone={st.tone}>{st.label}</Pill>
                  </span>
                  <span className="mt-1 block text-[13px] text-fg-2">{o.when}{locations.length > 1 ? ` · ${o.location}` : ''}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-fg-2">{o.items || 'No items yet'}</span>
                  <span className="mt-1 flex justify-between text-[12px] text-fg-3"><span className="mono">{o.number}</span><span className="mono">{o.total}</span></span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Drawer>
    </>
  );
}
