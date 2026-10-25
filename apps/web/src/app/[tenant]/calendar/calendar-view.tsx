'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, CreditCard, MapPin, Package, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, formatMoney, utcToWallTime, wallTimeToUtc } from '@rental/core';
import { ProductArt } from '@/components/catalog/product-art';
import { Button, Card, cx, EmptyState, LinkButton, Modal, Pill, Segmented, Select } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { payState } from '../orders/orders-view';

export type CalOrder = {
  id: string; number: string; status: string; customerName: string; startsAt: string; endsAt: string; address: string; miles: number | null;
  items: string; totalCents: number; paidCents: number; depositDueCents: number; unpaidReason: string | null;
  lines: { productId: string; quantity: number; blockedMinutes: number }[];
};
export type CalRow = { productId: string; name: string; icon: string | null; tint: string | null; kind: string; owned: number; tracking: string };

type Block = { order: CalOrder; start: number; end: number; until: number };
type Lane = { productId: string; label: string; sub: string; extra: boolean; blocks: Block[]; row: CalRow };

const HOUR = 3_600_000;

/** Give each booking (and quote) a unit lane, first free lane wins; overlaps beyond what is owned get extra lanes. */
function buildLanes(rows: CalRow[], orders: CalOrder[]): Lane[] {
  const lanes: Lane[] = [];
  for (const row of rows) {
    const base = Math.max(1, row.owned);
    const mine: Lane[] = Array.from({ length: base }, (_, i) => ({
      productId: row.productId, row, extra: false, blocks: [],
      label: row.name,
      sub: row.tracking === 'serialized' ? `unit ${i + 1} · serialized` : base > 1 ? `unit ${i + 1} of ${base}` : `${row.owned} owned`,
    }));
    const occurrences = orders
      .flatMap((o) => o.lines.filter((l) => l.productId === row.productId).map((l) => ({ o, l })))
      .sort((a, b) => Number(a.o.status === 'quote_sent') - Number(b.o.status === 'quote_sent') || a.o.startsAt.localeCompare(b.o.startsAt));
    for (const { o, l } of occurrences) {
      const start = new Date(o.startsAt).getTime();
      const end = new Date(o.endsAt).getTime();
      const until = end + l.blockedMinutes * 60_000;
      for (let n = 0; n < l.quantity; n++) {
        let lane = mine.find((ln) => ln.blocks.every((b) => b.until <= start || b.start >= until));
        if (!lane) {
          lane = { productId: row.productId, row, extra: true, blocks: [], label: row.name, sub: o.status === 'quote_sent' ? 'quote · not held' : 'over capacity' };
          mine.push(lane);
        }
        lane.blocks.push({ order: o, start, end, until });
      }
    }
    // Pooled stock: show only the units in use this period (at least one row), so a stack of 6 tables is not 6 empty rows.
    if (row.tracking === 'pooled') {
      const used = mine.filter((ln) => ln.blocks.length > 0);
      const show = used.length ? used : [mine[0]!];
      show.forEach((ln, i) => {
        if (!ln.extra) ln.sub = row.owned > 1 ? `${used.length} of ${row.owned} in use${used.length > 1 ? ` · ${i + 1}` : ''}` : `${row.owned} owned`;
      });
      lanes.push(...show);
    } else lanes.push(...mine);
  }
  return lanes;
}

const fmtTime = (ms: number, tz: string) =>
  new Date(ms).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).replace(':00', '');

export function CalendarView({
  slug, view, anchor, today, days, tz, rows, orders, locations, locationId, products, itemId, currency, cleanupMinutes, canCreate, empty,
}: {
  slug: string; view: 'day' | 'week'; anchor: string; today: string; days: string[]; tz: string; rows: CalRow[]; orders: CalOrder[];
  locations: { id: string; name: string }[]; locationId: string; products: { id: string; name: string }[]; itemId: string; currency: string;
  cleanupMinutes: number; canCreate: boolean; empty?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<CalOrder | null>(null);
  const [wide, setWide] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1280px)');
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { m.removeEventListener('change', on); clearInterval(t); };
  }, []);
  const money = (c: number) => formatMoney(c, currency);
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ date: anchor, view, loc: locationId, ...(itemId ? { item: itemId } : {}) });
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    return `/${slug}/calendar?${p.toString()}`;
  };
  const step = view === 'day' ? 1 : 7;
  const lanes = useMemo(() => buildLanes(rows.filter((r) => !itemId || r.productId === itemId), orders), [rows, orders, itemId]);
  const dayOf = (ms: number) => utcToWallTime(new Date(ms), tz).date;
  const title = view === 'day'
    ? new Date(`${anchor}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : (() => {
        const a = new Date(`${days[0]}T12:00:00Z`);
        const b = new Date(`${days[days.length - 1]}T12:00:00Z`);
        const sameMonth = a.getUTCMonth() === b.getUTCMonth();
        const m = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        return `${m(a)} ${a.getUTCDate()} – ${sameMonth ? '' : `${m(b)} `}${b.getUTCDate()}, ${b.getUTCFullYear()}`;
      })();

  const kind = (o: CalOrder, b?: Block) =>
    o.status === 'quote_sent' ? 'quote' : o.status === 'completed' ? 'done' : b && now >= b.start && now < b.end ? 'live' : 'booked';
  const blockClass = (k: string) =>
    cx(
      'rounded-[10px] px-2.5 py-1.5 text-left text-[12px] leading-tight transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[var(--shadow-lift)] focus-visible:outline-2',
      k === 'booked' && 'bg-accent text-on-accent',
      k === 'live' && 'bg-night text-volt',
      k === 'done' && 'bg-sunken text-fg-2',
      k === 'quote' && 'border-[1.5px] border-dashed border-accent bg-surface text-accent-text',
    );

  // Day view spans 6 AM to midnight, stretched to fit early or late events.
  const dayRange = useMemo(() => {
    if (view !== 'day') return { from: 0, to: 0 };
    const startOfDay = wallTimeToUtc(anchor, '00:00', tz).getTime();
    const hrs = lanes.flatMap((l) => l.blocks).filter((b) => dayOf(b.start) === anchor);
    let lo = 6;
    let hi = 24;
    for (const b of hrs) {
      lo = Math.min(lo, Math.floor((b.start - startOfDay) / HOUR));
      hi = Math.max(hi, Math.min(30, Math.ceil((b.until - startOfDay) / HOUR)));
    }
    return { from: startOfDay + Math.max(0, lo) * HOUR, to: startOfDay + hi * HOUR };
  }, [view, anchor, tz, lanes]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = selected && (() => {
    const o = selected;
    const k = kind(o);
    const pay = payState(o);
    const until = Math.max(...o.lines.map((l) => new Date(o.endsAt).getTime() + l.blockedMinutes * 60_000));
    return (
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-subtle bg-surface shadow-[var(--shadow-float)]">
        <div className={cx('p-5', k === 'quote' ? 'bg-accent-soft text-fg' : k === 'live' ? 'bg-night text-white' : 'bg-accent text-on-accent')}>
          <div className="flex items-center justify-between gap-2">
            <span className="mono text-[13px] opacity-80">{o.number}</span>
            <span className="rounded-md bg-white/20 px-2 py-0.5 text-[11px] font-bold">{k === 'quote' ? 'Quote · holds nothing' : k === 'live' ? 'In progress' : k === 'done' ? 'Completed' : 'Booked'}</span>
          </div>
          <p className="mt-1 font-display text-xl font-bold">{o.customerName}</p>
          <p className="text-sm opacity-85">
            {new Date(o.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })} · {fmtTime(new Date(o.startsAt).getTime(), tz)} – {fmtTime(new Date(o.endsAt).getTime(), tz)}
          </p>
        </div>
        <div className="flex flex-col gap-3 p-5 text-sm">
          {o.address && <p className="flex gap-2.5 text-fg"><MapPin className="mt-0.5 size-4 shrink-0 text-fg-2" />{o.address}{o.miles != null && ` (${Number(o.miles).toFixed(1)} mi)`}</p>}
          <p className="flex gap-2.5 text-fg"><Package className="mt-0.5 size-4 shrink-0 text-fg-2" />{o.items}</p>
          <p className="flex flex-wrap items-center gap-2.5 text-fg"><CreditCard className="size-4 shrink-0 text-fg-2" /><span className="mono">{money(o.totalCents)}</span>{pay && <Pill tone={pay.tone}>{pay.label}</Pill>}</p>
          {k !== 'quote' && <p className="text-[13px] text-fg-2">Items blocked until {fmtTime(until, tz)} for cleanup.</p>}
          {k === 'quote' && <p className="text-[13px] text-fg-2">A sent quote does not reserve anything until it is booked.</p>}
          <div className="mt-1 flex gap-2">
            <LinkButton href={`/${slug}/orders/${o.id}`} className="flex-1">Open order</LinkButton>
            <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
          </div>
        </div>
      </div>
    );
  })();

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Calendar' }]}
        actions={canCreate && <LinkButton href={`/${slug}/orders/new?date=${anchor}&loc=${locationId}`} size="sm" icon={<Plus className="size-4" />}><span className="max-sm:hidden">New order</span><span className="sm:hidden">New</span></LinkButton>}
      />
      <PageBody wide>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h1 className="mr-1 font-display text-[26px] font-extrabold tracking-tight text-fg sm:text-[32px]">{title}</h1>
          <div className="flex items-center gap-1.5">
            <Link aria-label={view === 'day' ? 'Previous day' : 'Previous week'} href={href({ date: addDays(anchor, -step) })} className="press grid size-10 place-items-center rounded-[var(--radius-control)] border border-control bg-surface text-fg hover:bg-hover"><ChevronLeft className="size-5" /></Link>
            <Link href={href({ date: today })} className="press inline-flex h-10 items-center rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-semibold text-fg hover:bg-hover">Today</Link>
            <Link aria-label={view === 'day' ? 'Next day' : 'Next week'} href={href({ date: addDays(anchor, step) })} className="press grid size-10 place-items-center rounded-[var(--radius-control)] border border-control bg-surface text-fg hover:bg-hover"><ChevronRight className="size-5" /></Link>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Segmented label="View" value={view} onChange={(v) => router.push(href({ view: v }))} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
            {locations.length > 1 && (
              <Select aria-label="Location" value={locationId} onChange={(e) => router.push(href({ loc: e.target.value, item: null }))} className="h-10 w-36">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
            {products.length > 1 && (
              <Select aria-label="Item" value={itemId} onChange={(e) => router.push(href({ item: e.target.value || null }))} className="h-10 w-44">
                <option value="">All items</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-fg-2" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-accent" /> Booked</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-night" /> In progress</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] border-[1.5px] border-dashed border-accent" /> Quote sent · holds nothing</span>
          <span className="flex items-center gap-1.5"><span className="hatch size-3 rounded-[4px] border border-subtle" /> Cleanup buffer ({Math.round(cleanupMinutes / 60)} h)</span>
        </div>

        {empty ? (
          <Card className="p-2"><EmptyState title="Add a location first" sub="The calendar shows equipment per location." /></Card>
        ) : lanes.length === 0 ? (
          <Card className="p-2"><EmptyState title="No rental items here yet" sub="Add products and how many you own at this location to see them on the calendar." action={<LinkButton href={`/${slug}/products/new`}>Add a product</LinkButton>} /></Card>
        ) : (
          <div className={cx('grid grid-cols-1 gap-5', selected && wide && 'xl:grid-cols-[minmax(0,1fr)_340px]')}>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                {view === 'week' ? (
                  <table className="w-full min-w-[960px] table-fixed border-collapse">
                    <caption className="sr-only">Bookings per unit for the week</caption>
                    <thead>
                      <tr className="border-b border-subtle">
                        <th scope="col" className="sticky left-0 z-10 w-[220px] bg-surface px-4 py-3 text-left text-[13px] font-semibold text-fg-2">Item</th>
                        {days.map((d) => (
                          <th key={d} scope="col" className={cx('border-l border-subtle px-3 py-2 text-left', d === today && 'bg-accent-soft/40')}>
                            <span className={cx('block text-[11px] font-bold uppercase tracking-[0.06em]', d === today ? 'text-accent-text' : 'text-fg-2')}>
                              {new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}
                            </span>
                            <span className={cx('font-display text-xl font-bold', d === today ? 'text-accent-text' : 'text-fg')}>{Number(d.slice(8))}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lanes.map((ln, li) => (
                        <tr key={`${ln.productId}-${li}`} className="border-b border-subtle last:border-0">
                          <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-normal">
                            <span className="flex items-center gap-2.5">
                              <ProductArt product={ln.row} size={28} className="max-md:hidden" />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-fg">{ln.label}</span>
                                <span className={cx('mono block text-[11px]', ln.extra ? 'text-warning-fg' : 'text-fg-2')}>{ln.sub}</span>
                              </span>
                            </span>
                          </th>
                          {days.map((d) => {
                            const here = ln.blocks.filter((b) => dayOf(b.start) === d);
                            return (
                              <td key={d} className={cx('h-[88px] border-l border-subtle p-1.5 align-top', d === today && 'bg-accent-soft/20')}>
                                <div className="flex flex-col gap-1">
                                  {here.map((b) => {
                                    const k = kind(b.order, b);
                                    return (
                                      <div key={b.order.id + b.start} className="anim-pop">
                                        <button type="button" onClick={() => setSelected(b.order)} className={cx(blockClass(k), 'w-full', selected?.id === b.order.id && 'ring-2 ring-offset-1 ring-[var(--accent)]')}>
                                          <span className="block font-bold">{fmtTime(b.start, tz)} – {fmtTime(b.end, tz)}</span>
                                          <span className="block truncate opacity-90">{b.order.customerName}</span>
                                        </button>
                                        {k !== 'quote' && <span className="hatch mt-0.5 block h-1.5 rounded-full border border-subtle" title={`Cleanup until ${fmtTime(b.until, tz)}`} />}
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <DayGrid lanes={lanes} range={dayRange} tz={tz} now={now} selected={selected} onSelect={setSelected} blockClass={blockClass} kind={kind} anchor={anchor} dayOf={dayOf} />
                )}
              </div>
            </Card>
            {selected && wide && <aside className="anim-slide self-start xl:sticky xl:top-24">{card}</aside>}
          </div>
        )}
      </PageBody>
      {!wide && (
        <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.number ?? ''}>
          <div className="-mx-6 -my-4">{card}</div>
        </Modal>
      )}
    </>
  );
}

function DayGrid({
  lanes, range, tz, now, selected, onSelect, blockClass, kind, anchor, dayOf,
}: {
  lanes: Lane[]; range: { from: number; to: number }; tz: string; now: number; selected: CalOrder | null; onSelect: (o: CalOrder) => void;
  blockClass: (k: string) => string; kind: (o: CalOrder, b?: Block) => string; anchor: string; dayOf: (ms: number) => string;
}) {
  const span = range.to - range.from;
  const hours = Array.from({ length: Math.round(span / HOUR) }, (_, i) => range.from + i * HOUR);
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - range.from) / span) * 100))}%`;
  const showNow = now > range.from && now < range.to;
  return (
    <div className="min-w-[960px]">
      <div className="flex border-b border-subtle">
        <div className="sticky left-0 z-10 w-[220px] shrink-0 bg-surface px-4 py-3 text-[13px] font-semibold text-fg-2">Item</div>
        <div className="relative flex-1">
          {hours.map((h) => (
            <span key={h} className="absolute top-3 -translate-x-1/2 text-[11px] text-fg-2" style={{ left: pct(h) }}>
              {new Date(h).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric' })}
            </span>
          ))}
        </div>
      </div>
      {lanes.map((ln, li) => (
        <div key={`${ln.productId}-${li}`} className="flex border-b border-subtle last:border-0">
          <div className="sticky left-0 z-10 flex w-[220px] shrink-0 items-center gap-2.5 bg-surface px-4 py-3">
            <ProductArt product={ln.row} size={28} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-fg">{ln.label}</span>
              <span className={cx('mono block text-[11px]', ln.extra ? 'text-warning-fg' : 'text-fg-2')}>{ln.sub}</span>
            </span>
          </div>
          <div className="relative h-[72px] flex-1">
            {hours.map((h) => <span key={h} className="absolute inset-y-0 border-l border-subtle/70" style={{ left: pct(h) }} aria-hidden />)}
            {showNow && <span className="absolute inset-y-0 z-[1] w-0.5 bg-danger" style={{ left: pct(now) }} aria-hidden />}
            {ln.blocks.filter((b) => b.until > range.from && b.start < range.to && (dayOf(b.start) === anchor || b.start < range.to)).map((b) => {
              const k = kind(b.order, b);
              const left = pct(b.start);
              const width = `calc(${pct(b.end)} - ${left})`;
              return (
                <div key={b.order.id + b.start}>
                  {k !== 'quote' && <span className="hatch absolute top-2 bottom-2 rounded-r-[10px] border border-subtle" style={{ left: pct(b.end), width: `calc(${pct(b.until)} - ${pct(b.end)})` }} title={`Cleanup until ${fmtTime(b.until, tz)}`} />}
                  <button type="button" onClick={() => onSelect(b.order)} style={{ left, width }}
                    className={cx(blockClass(k), 'absolute top-2 bottom-2 overflow-hidden', selected?.id === b.order.id && 'ring-2 ring-offset-1 ring-[var(--accent)]')}>
                    <span className="block truncate font-bold">{fmtTime(b.start, tz)} – {fmtTime(b.end, tz)}</span>
                    <span className="block truncate opacity-90">{b.order.customerName}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
