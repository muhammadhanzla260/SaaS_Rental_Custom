'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, PartyPopper } from 'lucide-react';
import { useState } from 'react';
import type { ActionNeeded, OpsAction, OpsCard, OpsRule } from '@rental/db';
import { Button, Card, cx, EmptyState, Pill, Segmented, Select, useToast } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { opsCardAction } from '@/server/actions/ops';

const DOT: Record<OpsRule, string> = { deposit: 'bg-[#f59e0b]', final_payment: 'bg-danger', call: 'bg-[#1d5fc4]', contact: 'bg-[#0e7490]', quote: 'bg-[#7c3aed]' };
const ACTION_LABEL: Record<OpsAction, string> = {
  pay_link: 'Send pay link', retry_charge: 'Retry charge', mark_called: 'Mark called', text_contact: 'Text contact', follow_up: 'Follow up', open: 'Open order',
};
const TONE = { overdue: 'bg-danger-bg text-danger', today: 'bg-warning-bg text-warning-fg', soon: 'bg-sunken text-fg', later: 'bg-sunken text-fg-2' } as const;

/** A tiny bar chart for a KPI tile (last 8 weeks, this week highlighted). */
function Bars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-10 items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <span key={i} className={cx('w-[6px] rounded-sm', i === values.length - 1 ? color : 'bg-control')} style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </span>
  );
}

function Tile({ label, value, sub, subTone, bars, color }: { label: string; value: string; sub: string; subTone?: 'up' | 'down'; bars: number[]; color: string }) {
  return (
    <Card className="flex items-end justify-between gap-3 p-4 sm:p-5">
      <span className="min-w-0">
        <span className="block text-[13px] text-fg-2">{label}</span>
        <span className="tnum mt-1 block font-display text-[28px] font-extrabold leading-none tracking-tight text-fg">{value}</span>
        <span className={cx('mt-1.5 block text-[12px] font-semibold', subTone === 'up' ? 'text-success-fg' : subTone === 'down' ? 'text-danger' : 'text-fg-2')}>{sub}</span>
      </span>
      <Bars values={bars} color={color} />
    </Card>
  );
}

export function OpsBoard({
  slug, columns, cards, kpis, tomorrow, locations, locationId, show, canAct, canCharge,
}: {
  slug: string; columns: { rule: OpsRule; label: string }[]; cards: OpsCard[]; kpis: ActionNeeded['kpis']; tomorrow: ActionNeeded['tomorrow'];
  locations: { id: string; name: string }[]; locationId: string; show: 'all' | 'today'; canAct: boolean; canCharge: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const href = (patch: Record<string, string>) => `/${slug}/actions?${new URLSearchParams({ loc: locationId, show, ...patch })}`;
  const visible = cards.filter((c) => !gone.has(`${c.orderId}:${c.rule}`) && (show === 'all' || c.dueIn <= 0));
  const signed = (n: number | null, unit = '') => (n == null ? '' : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}${unit}`);

  async function act(c: OpsCard, action: OpsAction | 'snooze') {
    const key = `${c.orderId}:${c.rule}:${action}`;
    setBusy(key);
    const r = await opsCardAction(slug, { orderId: c.orderId, rule: c.rule, action });
    setBusy(null);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Done.');
    // The card collapses now; the board reloads to pick up anything that changed.
    setGone((g) => new Set(g).add(`${c.orderId}:${c.rule}`));
    router.refresh();
  }

  return (
    <>
      <Topbar crumbs={[{ label: 'Action needed' }]} />
      <PageBody wide>
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-fg sm:text-[32px]">Action needed</h1>
          <span className="mb-1 text-sm text-fg-2"><span className="tnum">{visible.length}</span> open</span>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Segmented label="Show" value={show} onChange={(v) => router.push(href({ show: v }))} options={[{ value: 'all', label: 'Everything' }, { value: 'today', label: 'Due today' }]} />
            {locations.length > 1 && (
              <Select aria-label="Location" value={locationId} onChange={(e) => router.push(href({ loc: e.target.value }))} className="h-10 w-40">
                <option value="all">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Quotes sent this week" value={String(kpis.quotesWeek)} sub={`${signed(kpis.quotesDelta)} vs last week`} subTone={kpis.quotesDelta > 0 ? 'up' : kpis.quotesDelta < 0 ? 'down' : undefined} bars={kpis.quotesSeries} color="bg-[#1d5fc4]" />
          <Tile label="Quote → booking (30 days)" value={kpis.conversion == null ? '—' : `${kpis.conversion}%`} sub={kpis.conversionDelta == null ? 'No quotes the month before' : `${signed(kpis.conversionDelta)} pts`} subTone={(kpis.conversionDelta ?? 0) > 0 ? 'up' : (kpis.conversionDelta ?? 0) < 0 ? 'down' : undefined} bars={kpis.quotesSeries} color="bg-[#15803d]" />
          <Tile label="Open quote value" value={kpis.openValue} sub={`${kpis.openCount} quote${kpis.openCount === 1 ? '' : 's'}`} bars={kpis.quotesSeries} color="bg-[#7c3aed]" />
          <Tile label="Booked for next 7 days" value={kpis.next7} sub={kpis.next7Change == null ? 'No bookings this week last year' : `${signed(kpis.next7Change, '%')} vs last year`} subTone={(kpis.next7Change ?? 0) > 0 ? 'up' : (kpis.next7Change ?? 0) < 0 ? 'down' : undefined} bars={kpis.bookedSeries} color="bg-[#f59e0b]" />
        </div>

        {visible.length === 0 ? (
          <Card className="mb-6"><EmptyState icon={<PartyPopper className="size-6" />} title="All clear" sub={show === 'today' ? 'Nothing is due today. Switch to Everything to see what is coming up.' : 'No order needs a person right now. Cards appear as deposits, calls and quotes come due.'} /></Card>
        ) : (
          <div className="-mx-4 mb-6 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
            <div className="flex gap-4" style={{ minWidth: 'min-content' }}>
              {columns.map((col) => {
                const list = visible.filter((c) => c.rule === col.rule);
                return (
                  <section key={col.rule} aria-label={col.label} className="flex w-[300px] shrink-0 flex-col gap-3 rounded-[var(--radius-panel)] bg-sunken/70 p-3">
                    <header className="flex items-center gap-2 px-1">
                      <span className={cx('size-2.5 rounded-sm', DOT[col.rule])} aria-hidden />
                      <h2 className="flex-1 text-sm font-bold text-fg">{col.label}</h2>
                      <span className="tnum rounded-md bg-surface px-2 py-0.5 text-[12px] font-semibold text-fg-2">{list.length}</span>
                    </header>
                    {list.length === 0 && <p className="px-1 pb-2 text-[13px] text-fg-3">Nothing here.</p>}
                    {list.map((c) => {
                      const can = c.action === 'retry_charge' ? canCharge : canAct;
                      return (
                        <article key={`${c.orderId}:${c.rule}`} className={cx('anim-rise flex flex-col gap-2 rounded-[var(--radius-card)] border bg-surface p-3.5', c.tone === 'overdue' ? 'border-danger/40 shadow-[0_0_0_3px_rgb(220_38_38/0.08)]' : 'border-subtle')}>
                          <div className="flex items-center justify-between gap-2">
                            <Link href={`/${slug}/orders/${c.orderId}`} className="mono text-[13px] font-semibold text-accent-text underline-offset-2 hover:underline">{c.number}</Link>
                            <span className={cx('rounded-full px-2 py-0.5 text-[12px] font-semibold', TONE[c.tone])}>{c.badge}</span>
                          </div>
                          <p className="font-semibold text-fg">{c.title}</p>
                          <p className="text-[13px] leading-snug text-fg-2">{c.detail}</p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {c.action === 'open'
                              ? <Link href={`/${slug}/orders/${c.orderId}`} className="press inline-flex h-9 items-center rounded-[var(--radius-control)] bg-night px-3 text-[13px] font-semibold text-white">Open order</Link>
                              : <Button size="sm" variant="dark" disabled={!can} title={can ? undefined : 'Your role cannot do this'} pending={busy === `${c.orderId}:${c.rule}:${c.action}`} onClick={() => act(c, c.action)}>{ACTION_LABEL[c.action]}</Button>}
                            <Button size="sm" variant="secondary" disabled={!canAct} pending={busy === `${c.orderId}:${c.rule}:snooze`} onClick={() => act(c, 'snooze')}>Snooze 1 day</Button>
                          </div>
                        </article>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
        )}

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-5 py-4">
            <h2 className="text-lg font-bold text-fg">Tomorrow · {new Date(`${tomorrow.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</h2>
            <span className="text-[13px] text-fg-2">Tap an event to open the order</span>
          </div>
          {tomorrow.events.length === 0 ? (
            <p className="px-5 py-6 text-sm text-fg-2">No events tomorrow.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {tomorrow.events.map((e) => (
                <li key={e.id}>
                  <Link href={`/${slug}/orders/${e.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-hover">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent-soft/50 text-accent-text"><CalendarDays className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-fg">{e.title} <span className="mono text-[13px] font-normal text-fg-2">{e.number}</span></span>
                      <span className="block truncate text-[13px] text-fg-2">{e.items}</span>
                    </span>
                    <span className="mono shrink-0 text-sm text-fg">{e.time}</span>
                    <Pill tone={e.pay === 'Paid' ? 'success' : e.pay === 'Unpaid' ? 'danger' : 'info'}>{e.pay}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}
