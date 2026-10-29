'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { UNIT_STATUS, type UnitStatus } from '@rental/core';
import { ProductArt } from '@/components/catalog/product-art';
import { Button, Card, cx, EmptyState, Kpi, LinkButton, Pill, Select, useToast } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { setUnitStatusAction } from '@/server/actions/commerce';

export type HeatRow = {
  id: string; name: string; kind: string; icon: string | null; tint: string | null; owned: number; tracking: string;
  cells: { owned: number; held: number }[];
};
export type UnitRow = {
  id: string; label: string; serial: string | null; status: string; productName: string;
  next: { at: string; number: string; orderId: string; clash: boolean } | null;
};
type Kpis = { owned: number; products: number; busiestDay: string | null; busiestHeld: number; held: number; utilization: number };

const dayName = (d: string, style: 'short' | 'long' = 'short') => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: style, timeZone: 'UTC' });
const dayNum = (d: string) => Number(d.slice(8, 10));
const weekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());

export function InventoryView({
  slug, locations, locationId, days, rows, units, kpis, canEdit, timezone, empty,
}: {
  slug: string; locations: { id: string; name: string }[]; locationId: string; days: string[]; rows: HeatRow[]; units: UnitRow[];
  kpis: Kpis | null; canEdit: boolean; timezone?: string; empty?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });

  async function setStatus(u: UnitRow, status: UnitStatus) {
    setBusy(u.id);
    const r = await setUnitStatusAction(slug, u.id, status);
    setBusy(null);
    toast(r.ok ? (r.message ?? 'Saved.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) router.refresh();
  }

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Inventory' }]}
        actions={
          locations.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <span className="max-sm:sr-only">Location</span>
              <Select value={locationId} onChange={(e) => router.push(`/${slug}/inventory?loc=${e.target.value}`)} className="h-9 w-40" aria-label="Location">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </label>
          )
        }
      />
      <PageBody wide>
        <h1 className="mb-6 font-display text-[32px] font-extrabold tracking-tight text-fg sm:text-4xl">Inventory</h1>
        {empty || !kpis ? (
          <Card className="p-2"><EmptyState title="Add a location first" sub="Inventory is counted per location." /></Card>
        ) : rows.length === 0 ? (
          <Card className="p-2">
            <EmptyState title="Nothing tracked here yet" sub="Add rental products and how many you own at this location." action={<LinkButton href={`/${slug}/products/new`}>Add a product</LinkButton>} />
          </Card>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
              <Kpi label="Units owned" value={kpis.owned} sub={`Across ${kpis.products} rental product${kpis.products === 1 ? '' : 's'}`} className="anim-rise" />
              <Kpi
                label={kpis.busiestDay ? `Out on ${dayName(kpis.busiestDay, 'long')}` : 'Out this week'}
                value={kpis.busiestHeld}
                sub="Busiest day this week"
                tone="info"
                className="anim-rise"
                style={{ ['--d' as string]: '60ms' }}
              />
              <Kpi label="In maintenance" value={kpis.held} sub="Blocked from booking" tone={kpis.held ? 'warning' : undefined} className="anim-rise" style={{ ['--d' as string]: '120ms' }} />
              <Kpi label="Utilization" value={`${kpis.utilization}%`} sub={`Next ${days.length} days, unit-days booked`} className="anim-rise" style={{ ['--d' as string]: '180ms' }} />
            </div>

            <Card className="mb-6 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-fg">Availability · next {days.length} days</h2>
                  <p className="text-[13px] text-fg-2">Number = units still free at the busiest moment of the day</p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[13px] text-fg-2" aria-hidden>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-success-bg" /> All free</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-warning-bg" /> Some booked</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-night" /> Fully booked</span>
                  <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] bg-sunken" /> None bookable (in repair)</span>
                </div>
              </div>
              <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
                <table className="w-full min-w-[900px] border-separate border-spacing-1">
                  <caption className="sr-only">Units free per product per day</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 z-10 w-56 bg-surface" />
                      {days.map((d) => (
                        <th key={d} scope="col" className={cx('pb-1 text-center text-xs font-semibold leading-tight', weekend(d) ? 'text-accent-text' : 'text-fg-2')}>
                          {dayName(d)}<br /><span className="text-[13px]">{dayNum(d)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={r.id} className="anim-rise" style={{ ['--d' as string]: `${Math.min(ri, 10) * 35}ms` }}>
                        <th scope="row" className="sticky left-0 z-10 bg-surface pr-3 text-left font-normal">
                          <Link href={`/${slug}/products/${r.id}?tab=inventory`} className="flex items-center gap-2.5 hover:underline">
                            <ProductArt product={r} size={28} className="max-sm:hidden" />
                            <span className="min-w-0">
                              <span className="block max-w-[180px] truncate text-sm font-semibold text-fg">{r.name}</span>
                              <span className="mono text-xs text-fg-2">{r.owned} owned</span>
                            </span>
                          </Link>
                        </th>
                        {r.cells.map((c, i) => {
                          const free = Math.max(0, c.owned - c.held);
                          const state = c.owned === 0 ? 'none' : free === 0 ? 'full' : c.held > 0 ? 'some' : 'free';
                          return (
                            <td
                              key={days[i]}
                              title={`${r.name} · ${dayName(days[i]!)} ${dayNum(days[i]!)}: ${free} of ${c.owned} free`}
                              className={cx(
                                'mono h-11 min-w-11 rounded-[9px] text-center text-[13px] font-semibold',
                                state === 'free' && 'bg-success-bg text-success-fg',
                                state === 'some' && 'bg-warning-bg text-warning-fg',
                                state === 'full' && 'bg-night text-volt',
                                state === 'none' && 'bg-sunken text-fg-3',
                              )}
                            >
                              {free}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4 sm:px-6">
                <h2 className="text-lg font-semibold text-fg">Units & maintenance</h2>
                <p className="text-[13px] text-fg-2">A unit in maintenance can’t be booked until it’s back.</p>
              </div>
              {units.length === 0 ? (
                <p className="border-t border-subtle px-6 py-6 text-sm text-fg-2">
                  No serialized units here. Switch a product to <b>Serialized</b> on its Inventory tab to track each unit and its repairs.
                </p>
              ) : (
                <>
                  <div className="hidden grid-cols-[1.4fr_1fr_1fr_1.8fr_auto] gap-4 border-y border-subtle bg-sunken/60 px-6 py-3 text-xs font-bold uppercase tracking-[0.06em] text-fg-2 md:grid">
                    <span>Unit</span><span>Serial</span><span>Status</span><span>Next booking</span><span className="w-44" />
                  </div>
                  <ul className="divide-y divide-subtle">
                    {units.map((u) => {
                      const s = UNIT_STATUS[u.status as UnitStatus];
                      const held = u.status === 'maintenance' || u.status === 'out_of_service';
                      return (
                        <li key={u.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.8fr_auto]">
                          <span className="min-w-0">
                            <span className="block font-semibold text-fg">{u.label}</span>
                            <span className="block truncate text-[13px] text-fg-2">{u.productName}</span>
                          </span>
                          <span className="mono text-[13px] text-fg-2 max-md:hidden">{u.serial ?? '—'}</span>
                          <span><Pill tone={s?.tone ?? 'neutral'}>{s?.label ?? u.status}</Pill></span>
                          <span className={cx('text-sm max-md:col-span-2', u.next?.clash ? 'font-medium text-danger' : 'text-fg')}>
                            {u.next ? (
                              <Link href={`/${slug}/orders/${u.next.orderId}`} className="hover:underline">
                                {when(u.next.at)} · <span className="mono">{u.next.number}</span>{u.next.clash && ' — needs reassigning'}
                              </Link>
                            ) : (
                              <span className="text-fg-2">No upcoming bookings</span>
                            )}
                          </span>
                          {canEdit && (
                            <span className="max-md:col-span-2 md:w-44">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-full"
                                pending={busy === u.id}
                                onClick={() => setStatus(u, held ? 'ready' : 'maintenance')}
                              >
                                {held ? 'Mark available' : 'Send to maintenance'}
                              </Button>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
