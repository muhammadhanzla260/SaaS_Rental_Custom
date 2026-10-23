'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { addDays, ORDER_STATUS, type OrderStatus } from '@rental/core';
import { Badge, cx } from '@/components/ui';

type Ev = { id: string; date: string; time: string; title: string; items: string; status: string; number: string };

const DOT: Record<string, string> = {
  booked: 'bg-brand', quote_sent: 'bg-warn', draft: 'bg-muted', completed: 'bg-ok',
};

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export function CalendarView({
  slug, month, today, gridStart, weekStart, events,
}: { slug: string; month: string; today: string; gridStart: string; weekStart: number; events: Ev[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(today.startsWith(month) ? today : `${month}-01`);
  const [dir, setDir] = useState(0);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, Ev[]>();
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [events]);
  const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
  const dayNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + ((i + weekStart) % 7)))));
  const go = (by: number) => { setDir(by); router.push(`/${slug}/calendar?m=${shiftMonth(month, by)}`); };
  const dayEvents = byDay.get(selected) ?? [];
  const booked = events.filter((e) => e.date.startsWith(month) && e.status === 'booked').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" onClick={() => go(-1)} className="grid size-10 place-items-center rounded-ui-sm border border-line bg-surface hover:bg-surface-2"><ChevronLeft aria-hidden className="size-5" /></button>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h2 key={month} initial={{ opacity: 0, x: dir * 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -20 }} className="min-w-44 text-center font-display text-xl font-bold">{title}</motion.h2>
          </AnimatePresence>
          <button type="button" aria-label="Next month" onClick={() => go(1)} className="grid size-10 place-items-center rounded-ui-sm border border-line bg-surface hover:bg-surface-2"><ChevronRight aria-hidden className="size-5" /></button>
          {!today.startsWith(month) && (
            <Link href={`/${slug}/calendar`} className="rounded-ui-sm px-3 py-2 text-sm font-medium text-brand-text hover:bg-brand-soft">Today</Link>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="font-medium text-ink">{booked} booked this month</span>
          {Object.entries(DOT).map(([s, c]) => (
            <span key={s} className="inline-flex items-center gap-1.5"><span className={cx('size-2.5 rounded-full', c)} />{ORDER_STATUS[s as OrderStatus].label}</span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-[calc(var(--radius)*1.3)] border border-line bg-surface shadow-card">
          <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
            {dayNames.map((d) => <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">{d}</div>)}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={month} initial={{ opacity: 0, x: dir * 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -30 }} transition={{ duration: 0.25 }}
              className="grid grid-cols-7">
              {days.map((d) => {
                const inMonth = d.startsWith(month);
                const list = byDay.get(d) ?? [];
                const isSel = d === selected;
                return (
                  <button key={d} type="button" onClick={() => setSelected(d)} aria-pressed={isSel} aria-label={`${d}: ${list.length} events`}
                    className={cx('relative flex min-h-16 flex-col items-stretch gap-1 border-b border-r border-line p-1.5 text-left transition-colors sm:min-h-28',
                      !inMonth && 'bg-surface-2/40 text-muted', isSel ? 'bg-brand-soft' : 'hover:bg-surface-2/70')}>
                    <span className={cx('grid size-7 place-items-center self-start rounded-full text-sm font-medium tabular', d === today && 'brand-gradient text-brand-fg')}>{Number(d.slice(8))}</span>
                    <span className="hidden flex-col gap-0.5 sm:flex">
                      {list.slice(0, 3).map((e) => (
                        <span key={e.id} className={cx('truncate rounded px-1.5 py-0.5 text-[11px] font-medium',
                          e.status === 'booked' ? 'bg-brand text-brand-fg' : e.status === 'completed' ? 'bg-ok-soft text-ok' : e.status === 'quote_sent' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted')}>
                          {e.time} {e.title}
                        </span>
                      ))}
                      {list.length > 3 && <span className="px-1 text-[11px] text-muted">+{list.length - 3} more</span>}
                    </span>
                    <span className="flex flex-wrap gap-0.5 sm:hidden">
                      {list.slice(0, 4).map((e) => <span key={e.id} className={cx('size-1.5 rounded-full', DOT[e.status] ?? 'bg-muted')} />)}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        <aside className="flex flex-col gap-3 rounded-[calc(var(--radius)*1.3)] border border-line bg-surface p-4 shadow-card xl:self-start">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${selected}T12:00:00Z`))}</h3>
            <Link href={`/${slug}/orders/new?date=${selected}`} aria-label="New order on this day" className="grid size-9 place-items-center rounded-ui-sm bg-brand text-brand-fg hover:bg-brand-strong"><Plus aria-hidden className="size-4" /></Link>
          </div>
          <AnimatePresence mode="popLayout">
            {dayEvents.length === 0 ? (
              <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-muted">Nothing on this day.</motion.p>
            ) : (
              dayEvents.map((e, i) => (
                <motion.div key={e.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}>
                  <Link href={`/${slug}/orders/${e.id}`} className="flex flex-col gap-0.5 rounded-ui-sm border border-line p-3 hover:border-brand">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{e.time} · {e.title}</span>
                      <Badge tone={ORDER_STATUS[e.status as OrderStatus].tone}>{ORDER_STATUS[e.status as OrderStatus].label}</Badge>
                    </span>
                    <span className="truncate text-sm text-muted">{e.items || 'No items'}</span>
                    <span className="font-mono text-xs text-muted">{e.number}</span>
                  </Link>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}
