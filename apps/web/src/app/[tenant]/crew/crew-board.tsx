'use client';

import { ClipboardCheck, FileWarning, MapPin, Navigation, PackageX, Play, Star, UserPlus, Wallet, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { COACH_PHASES, formatMoney, type CoachPhaseKey } from '@rental/core';
import type { coachBoard } from '@rental/db';
import { Avatar, Button, Card, cx, EmptyState, FilterChips, Kpi, LinkButton, Pill, Tabs } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { ChecklistDrawer } from './checklist-drawer';
import { LiveMap, STAGE_COLOR, STAGE_LABEL, type Van } from './live-map';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
export type Board = Jsonify<Awaited<ReturnType<typeof coachBoard>>>;
type Order = Board['orders'][number];
type Tab = 'live' | 'checklists' | 'roster';
const REFRESH_MS = 20_000;

const time = (d: string | null, tz: string) => (d ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '');
const variance = (m: number | null) => (m == null ? '' : m === 0 ? 'on time' : m > 0 ? `${m} min late` : `${-m} min early`);

function feedText(action: string, c: Record<string, unknown>) {
  switch (action) {
    case 'coach.phase_saved': return `saved ${c.title} · ${Math.round(Number(c.percent))}%`;
    case 'coach.photo': return `added a ${c.kind} photo`;
    case 'coach.en_route': return c.text1 ? 'started en route · Text 1 sent' : 'started en route';
    case 'coach.arriving': return `Text 2 sent · ETA ~${c.etaMinutes} min`;
    case 'coach.arrived': return `arrived${c.distanceM != null ? ` · ${c.distanceM} m from the venue` : ''}`;
    case 'coach.event_start': return `EVENT START · ${c.label}`;
    case 'coach.damage': return 'reported damage · maintenance flag on';
    case 'coach.tracking_on': return 'turned live tracking on';
    case 'coach.tracking_off': return 'turned live tracking off';
    case 'coach.reopened': return `reopened ${c.title}: ${c.reason}`;
    case 'coach.maintenance_ticket': return `created ${c.number} (${c.item})`;
    case 'coach.maintenance_closed': return `closed ${c.number}`;
    default: return action.replace('coach.', '').replace(/_/g, ' ');
  }
}

function StagePill({ stage }: { stage: Order['stage'] }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold text-white" style={{ background: STAGE_COLOR[stage] }}>
      {STAGE_LABEL[stage]}
    </span>
  );
}

function PhaseCells({ o, compact }: { o: Order; compact?: boolean }) {
  return (
    <div className={cx('flex', compact ? 'gap-0.5' : 'gap-1')}>
      {o.phases.map((p, i) => {
        const gap = o.closed && p.percent < 100;
        const cls = p.percent >= 100 ? 'bg-success text-white' : gap ? 'bg-warning text-white' : p.percent > 0 ? 'bg-info-bg text-info-fg' : 'bg-sunken text-fg-3';
        return compact ? (
          <span key={p.key} title={`P${i + 1} ${Math.round(p.percent)}%`} className={cx('h-1.5 flex-1 rounded-full', p.percent >= 100 ? 'bg-success' : gap ? 'bg-warning' : p.percent > 0 ? 'bg-accent' : 'bg-sunken')} />
        ) : (
          <span key={p.key} className={cx('mono grid h-7 w-11 place-items-center rounded-md text-[11px] font-bold', cls)} title={COACH_PHASES[i]!.title}>{Math.round(p.percent)}</span>
        );
      })}
    </div>
  );
}

export function CrewBoard({ slug, tz, currency, tenantId, canAct, initialTab, board, warehouses }: {
  slug: string; tz: string; currency: string; tenantId: string; canAct: boolean; initialTab: Tab; board: Board; warehouses: { id: string; name: string; lat: number; lng: number }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [drawer, setDrawer] = useState<{ orderId: string; phase: CoachPhaseKey | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'today' | 'progress' | 'gaps' | 'damage' | 'completed'>('all');
  const [coach, setCoach] = useState<string>('all');

  // Live: refresh while the page is visible (and right away when coming back to it).
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') router.refresh(); };
    const t = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [router]);

  const today = board.orders.filter((o) => o.isToday);
  const k = board.kpis;
  const coaches = board.roster.filter((m) => m.role === 'coach');
  const crew = board.roster.filter((m) => m.role === 'crew');
  const sel = board.roster.find((m) => m.userId === selected) ?? coaches.find((m) => m.current) ?? null;
  const selOrder = sel?.current ? board.orders.find((o) => o.id === sel.current!.id) ?? null : null;

  const events = useMemo(() => today.filter((o) => o.eventLat != null && o.eventLng != null).map((o) => ({ id: o.id, lat: o.eventLat!, lng: o.eventLng!, label: o.number, stage: o.stage })), [today]);
  const vans = useMemo<Van[]>(() => today.flatMap((o) => {
    if (!o.lead) return [];
    // A van is where its last fix was while en route; at the event it sits on the venue.
    const atVenue = o.stage === 'event' || o.stage === 'completed';
    const lat = atVenue ? o.eventLat : o.lastLat;
    const lng = atVenue ? o.eventLng : o.lastLng;
    if (lat == null || lng == null || o.stage === 'pre_departure') return [];
    return [{ id: o.id, lat, lng, label: `${o.lead.name}${o.tracking && o.etaMinutes != null ? ` · ${o.etaMinutes} min` : ''}`, stage: o.stage, frozen: o.stage === 'en_route' && !!o.text2At && !o.tracking }];
  }), [today]);

  const rows = board.orders
    .filter((o) => {
      if (coach !== 'all' && !o.coaches.some((c) => c.userId === coach)) return false;
      switch (filter) {
        case 'today': return o.isToday;
        case 'progress': return !o.completed && o.phases.some((p) => p.percent > 0);
        case 'gaps': return o.flags.gaps;
        case 'damage': return o.flags.damage;
        case 'completed': return o.completed;
        default: return true;
      }
    })
    .slice()
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  const open = (orderId: string, phase: CoachPhaseKey | null = null) => setDrawer({ orderId, phase });
  const flagPills = (o: Order) => (
    <div className="flex flex-wrap gap-1">
      {o.flags.damage && <Pill tone="danger">Damage</Pill>}
      {o.flags.gaps && <Pill tone="warning">Gaps</Pill>}
      {o.flags.unsigned && !o.completed && <Pill tone="violet">Unsigned</Pill>}
      {o.flags.dueCents > 0 && !o.completed && <Pill tone="info">{formatMoney(o.flags.dueCents, currency)} due</Pill>}
    </div>
  );

  return (
    <>
      <Topbar crumbs={[{ label: 'Coaches & crew' }]} actions={<LinkButton href={`/${slug}/settings/team`} variant="secondary" size="sm" icon={<UserPlus className="size-4" />}>Add coach or crew</LinkButton>} />
      <PageBody wide>
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-fg sm:text-[32px]">Coaches &amp; crew</h1>
          <span className="mb-1 inline-flex items-center gap-1.5 text-sm text-fg-2"><span className="size-2 rounded-full bg-success anim-blink" aria-hidden="true" /> Live · updates every 20 s</span>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="On duty" value={`${k.onDuty.coaches} · ${k.onDuty.crew}`} sub="coaches · crew" />
          <Kpi label="En route" value={k.enRoute.length} sub={k.enRoute.map((e) => `${e.coach}${e.eta != null ? ` ${e.eta} min` : ''}`).join(', ') || 'Nobody'} tone={k.enRoute.length ? 'info' : undefined} />
          <Kpi label="At an event" value={k.atEvent} />
          <Kpi label="Completed today" value={k.completedToday} tone={k.completedToday ? 'success' : undefined} />
          <Kpi label="Avg coach rating" value={<span className="flex items-center gap-1">{k.rating.stars.toFixed(1)} <Star className="size-5 fill-volt text-volt" /></span>} sub={`${Math.round(k.rating.percent)}% over ${k.rating.orders} orders`} />
          <Kpi label="Open flags" value={k.flags.damage + k.flags.gaps + k.flags.unsigned} sub={`${k.flags.damage} damage · ${k.flags.gaps} gaps · ${k.flags.unsigned} unsigned`} tone={k.flags.damage + k.flags.gaps ? 'danger' : undefined} />
        </div>

        <Tabs
          label="Coaches & crew"
          value={tab}
          onSelect={setTab}
          className="mb-5"
          tabs={[
            { value: 'live', label: 'Live today', badge: today.length || undefined },
            { value: 'checklists', label: 'Checklists & ratings' },
            { value: 'roster', label: 'Coaches & crew', badge: board.roster.length || undefined },
          ]}
        />

        {tab === 'live' && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-5">
              <Card className="overflow-hidden">
                <div className="h-[420px]">
                  <LiveMap warehouses={warehouses.map((w) => ({ id: w.id, lat: w.lat, lng: w.lng, label: w.name }))} events={events} vans={vans} onSelect={(id) => open(id)} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-subtle px-4 py-2.5 text-[12px] text-fg-2">
                  {(Object.keys(STAGE_LABEL) as Order['stage'][]).map((s) => <span key={s} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: STAGE_COLOR[s] }} />{STAGE_LABEL[s]}</span>)}
                  <span className="ml-auto">GPS every 25 s while en route</span>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="font-display text-lg font-bold text-fg">Coaches today</h2>
                {coaches.length === 0 && crew.length === 0 ? (
                  <EmptyState title="No coaches or crew yet" sub="Invite them in Team with the Coach or Crew role." action={<LinkButton href={`/${slug}/settings/team`}>Add coach or crew</LinkButton>} />
                ) : (
                  <ul className="mt-3 flex flex-col divide-y divide-subtle">
                    {[...coaches, ...crew].map((m) => (
                      <li key={m.userId}>
                        <button type="button" onClick={() => setSelected(m.userId)} className={cx('flex w-full items-center gap-3 rounded-[var(--radius-control)] px-2 py-2.5 text-left', sel?.userId === m.userId && 'bg-accent-soft')}>
                          <Avatar name={m.name} src={m.image} size={34} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-fg">{m.name} <span className="font-normal text-fg-3">· {m.role === 'coach' ? 'Coach' : 'Crew'}</span></p>
                            <p className="truncate text-[12px] text-fg-3">
                              {m.current ? (m.role === 'crew' ? `With ${m.current.withCoach ?? 'a coach'} · ${m.current.number}` : `${m.current.number}${m.current.etaMinutes != null ? ` · ETA ${m.current.etaMinutes} min` : ''}`) : 'No event today'}
                            </p>
                          </div>
                          {m.current && <StagePill stage={m.current.stage} />}
                          {m.current && m.role === 'coach' && <div className="hidden w-28 sm:block"><PhaseCells o={board.orders.find((o) => o.id === m.current!.id)!} compact /></div>}
                          {m.role === 'coach' && <span className="mono w-14 text-right text-[12px] font-semibold text-fg">★ {m.rating.stars.toFixed(1)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              {sel && (
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={sel.name} src={sel.image} size={40} />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{sel.name}</p>
                      <p className="truncate text-[12px] text-fg-3">{sel.role === 'coach' ? 'Coach' : 'Crew'}{sel.vehicle ? ` · ${sel.vehicle}` : ''}</p>
                    </div>
                  </div>
                  {!selOrder ? (
                    <p className="mt-3 text-[13px] text-fg-2">No event today.</p>
                  ) : (
                    <>
                      <p className="mt-3 text-sm font-semibold text-fg">{selOrder.number} · {selOrder.customerName}</p>
                      <p className="text-[12px] text-fg-3">{time(selOrder.startsAt, tz)} · {selOrder.address}</p>
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {selOrder.phases.map((p, i) => (
                          <li key={p.key}>
                            <button type="button" onClick={() => open(selOrder.id, p.key)} className="flex w-full items-center gap-2 text-left text-[13px]">
                              <span className="w-28 shrink-0 text-fg-2">{i + 1}. {COACH_PHASES[i]!.short}</span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"><span className={cx('block h-full rounded-full', p.percent >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${p.percent}%` }} /></span>
                              <span className="mono w-10 text-right font-semibold">{Math.round(p.percent)}%</span>
                              <span className="w-16 text-right text-[11px] text-fg-3">{p.savedAt ? time(p.savedAt, tz) : '—'}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-subtle pt-3 text-[12px]">
                        <dt className="text-fg-3">Text 1</dt><dd className="text-right text-fg">{selOrder.text1At ? `sent ${time(selOrder.text1At, tz)}` : '—'}</dd>
                        <dt className="text-fg-3">ETA</dt><dd className="text-right text-fg">{selOrder.etaMinutes != null && !selOrder.arrivedAt ? `~${selOrder.etaMinutes} min` : '—'}</dd>
                        <dt className="text-fg-3">Text 2</dt><dd className="text-right text-fg">{selOrder.text2At ? `sent ${time(selOrder.text2At, tz)}` : selOrder.enRouteAt ? 'waiting' : '—'}</dd>
                        <dt className="text-fg-3">Live tracking</dt><dd className="text-right text-fg">{selOrder.tracking ? 'on' : 'off'}</dd>
                        <dt className="text-fg-3">I have arrived</dt><dd className="text-right text-fg">{selOrder.arrivedAt ? `${time(selOrder.arrivedAt, tz)}${selOrder.arrivedDistanceM != null ? ` · ${selOrder.arrivedDistanceM} m` : ''}` : '—'}</dd>
                        <dt className="text-fg-3">EVENT START</dt><dd className="text-right text-fg">{selOrder.eventStartedAt ? `${time(selOrder.eventStartedAt, tz)} · ${variance(selOrder.varianceMin)}` : '—'}</dd>
                        <dt className="text-fg-3">Contract</dt><dd className="text-right text-fg">{selOrder.flags.unsigned ? 'not signed' : 'signed'}</dd>
                        <dt className="text-fg-3">Balance</dt><dd className="text-right text-fg">{selOrder.flags.dueCents > 0 ? `${formatMoney(selOrder.flags.dueCents, currency)} to collect` : 'paid'}</dd>
                        <dt className="text-fg-3">Damage</dt><dd className="text-right text-fg">{selOrder.flags.damage ? 'reported' : 'none'}</dd>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="secondary" className="flex-1" onClick={() => open(selOrder.id)}>View full checklist</Button>
                        <LinkButton size="sm" variant="ghost" className="flex-1" href={`/${slug}/orders/${selOrder.id}`}>Open order</LinkButton>
                      </div>
                    </>
                  )}
                </Card>
              )}

              <Card className="p-5">
                <h2 className="font-display text-lg font-bold text-fg">Needs attention</h2>
                {board.attention.length === 0 ? (
                  <p className="mt-2 text-[13px] text-fg-2">Nothing needs attention.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {board.attention.map((a, i) => {
                      const Icon = { damage: Wrench, gaps: ClipboardCheck, balance: Wallet, unsigned: FileWarning, load: PackageX }[a.kind];
                      return (
                        <li key={i} className={cx('flex items-start gap-3 rounded-[var(--radius-control)] border p-3', a.kind === 'damage' ? 'border-danger/40 bg-danger-bg/40' : 'border-subtle')}>
                          <Icon className={cx('mt-0.5 size-4 shrink-0', a.kind === 'damage' ? 'text-danger' : 'text-warning')} />
                          <div className="min-w-0 flex-1 text-[13px]">
                            <p className="font-semibold text-fg">{a.number} · {a.coach}</p>
                            <p className="text-fg-2">{a.text}</p>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => open(a.orderId, a.phase)}>Review</Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              <Card className="p-5">
                <h2 className="font-display text-lg font-bold text-fg">Live feed · all coaches</h2>
                {board.feed.length === 0 ? (
                  <p className="mt-2 text-[13px] text-fg-2">Saves, texts, arrivals and starts from today appear here.</p>
                ) : (
                  <ol className="mt-3 flex flex-col gap-2.5">
                    {board.feed.map((f, i) => (
                      <li key={i} className="flex gap-2.5 text-[13px]">
                        <span className="mono w-16 shrink-0 text-[12px] text-fg-3">{time(f.at, tz)}</span>
                        <span className="min-w-0 flex-1 text-fg"><span className="font-semibold">{f.actor ?? 'Someone'}</span> {feedText(f.action, (f.changes ?? {}) as Record<string, unknown>)}</span>
                        <button type="button" onClick={() => open(f.orderId)} className="mono shrink-0 text-[12px] font-semibold text-accent-text">{f.number}</button>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>
        )}

        {tab === 'checklists' && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <FilterChips
                label="Show"
                value={filter}
                onChange={setFilter}
                chips={[
                  { value: 'all', label: 'All', count: board.orders.length },
                  { value: 'today', label: 'Today', count: today.length },
                  { value: 'progress', label: 'In progress', count: board.orders.filter((o) => !o.completed && o.phases.some((p) => p.percent > 0)).length },
                  { value: 'gaps', label: 'Gaps', count: board.orders.filter((o) => o.flags.gaps).length },
                  { value: 'damage', label: 'Damage', count: board.orders.filter((o) => o.flags.damage).length },
                  { value: 'completed', label: 'Completed', count: board.orders.filter((o) => o.completed).length },
                ]}
              />
            </div>
            {coaches.length > 1 && (
              <div className="mb-4">
                <FilterChips label="Coach" value={coach} onChange={setCoach} chips={[{ value: 'all', label: 'All coaches' }, ...coaches.map((c) => ({ value: c.userId, label: c.name }))]} />
              </div>
            )}
            <Card className="overflow-x-auto">
              {rows.length === 0 ? (
                <EmptyState title="No checklists here" sub="Orders with a coach show up here, from 30 days back to 14 days ahead." />
              ) : (
                <table className="w-full min-w-[980px] text-left text-[13px]">
                  <thead className="border-b border-subtle text-[11px] font-bold uppercase tracking-wide text-fg-3">
                    <tr>
                      <th className="px-4 py-3">Order</th><th className="px-3 py-3">Coach</th><th className="px-3 py-3">Customer · event</th>
                      <th className="px-3 py-3">P1–P5 %</th><th className="px-3 py-3">Rating</th><th className="px-3 py-3">En route · arrival · start</th><th className="px-3 py-3">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {rows.map((o) => (
                      <tr key={o.id} onClick={() => open(o.id)} className="cursor-pointer hover:bg-sunken/60">
                        <td className="px-4 py-3"><p className="mono font-semibold text-fg">{o.number}</p><div className="mt-1"><StagePill stage={o.stage} /></div></td>
                        <td className="px-3 py-3 text-fg">{o.lead?.name ?? '—'}{o.crew.length > 0 && <p className="text-[11px] text-fg-3">+ {o.crew.map((c) => c.name).join(', ')}</p>}</td>
                        <td className="px-3 py-3"><p className="text-fg">{o.customerName}</p><p className="text-[11px] text-fg-3">{new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(o.startsAt))} · {time(o.startsAt, tz)}</p></td>
                        <td className="px-3 py-3"><PhaseCells o={o} /></td>
                        <td className="px-3 py-3">
                          <p className="mono font-semibold text-fg">{Math.round(o.rating)}%</p>
                          <span className="mt-1 block h-1.5 w-20 overflow-hidden rounded-full bg-sunken"><span className={cx('block h-full rounded-full', o.rating >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${o.rating}%` }} /></span>
                        </td>
                        <td className="px-3 py-3 text-[12px] text-fg-2">
                          <p className="flex items-center gap-1"><Navigation className="size-3" />{o.enRouteAt ? `${time(o.enRouteAt, tz)}${o.text2At ? ' · Text 2 ✓' : ''}` : '—'}</p>
                          <p className="flex items-center gap-1"><MapPin className="size-3" />{o.arrivedAt ? `${time(o.arrivedAt, tz)}${o.arrivedDistanceM != null ? ` · ${o.arrivedDistanceM} m` : ''}` : '—'}</p>
                          <p className="flex items-center gap-1"><Play className="size-3" />{o.eventStartedAt ? `${time(o.eventStartedAt, tz)} · ${variance(o.varianceMin)}` : '—'}</p>
                        </td>
                        <td className="px-3 py-3">{flagPills(o)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <p className="mt-3 text-[12px] text-fg-3">
              Phase % = (ticked items + required photo present) ÷ (items + 1 when a photo is required). Order rating = average of the five phases. Coach rating = average order rating ÷ 20 (out of 5), over Booked and Completed orders.
              Green = 100%, blue = in progress, grey = not started, amber = a gap on an event that has ended.
            </p>
          </>
        )}

        {tab === 'roster' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {coaches.map((m) => (
              <Card key={m.userId} className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} src={m.image} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{m.name}</p>
                    <p className="truncate text-[12px] text-fg-3">Coach{m.vehicle ? ` · ${m.vehicle}` : ''}{m.status !== 'active' ? ' · disabled' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center justify-end gap-0.5" aria-label={`${m.rating.stars} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={i <= Math.round(m.rating.stars) ? 'size-3.5 fill-volt text-volt' : 'size-3.5 text-fg-3/40'} />)}</p>
                    <p className="text-[11px] text-fg-3">Coach rating · {m.closed} closed events</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <dt className="text-fg-3">Orders</dt><dd className="text-right font-semibold text-fg">{m.orders}</dd>
                  <dt className="text-fg-3">Fully checked</dt><dd className="text-right font-semibold text-fg">{m.fullyChecked} / {m.orders}</dd>
                  <dt className="text-fg-3">On-time start</dt><dd className="text-right font-semibold text-fg">{m.onTimePct == null ? '—' : `${m.onTimePct}%`}</dd>
                  <dt className="text-fg-3">Avg arrival distance</dt><dd className="text-right font-semibold text-fg">{m.avgArrivalM == null ? '—' : `${m.avgArrivalM} m`}</dd>
                  <dt className="text-fg-3">Damage reports</dt><dd className={cx('text-right font-semibold', m.damageReports ? 'text-danger' : 'text-fg')}>{m.damageReports}</dd>
                  <dt className="text-fg-3">Email</dt><dd className="truncate text-right text-fg">{m.email}</dd>
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => { setCoach(m.userId); setFilter('all'); setTab('checklists'); }}>Checklists</Button>
                  <LinkButton size="sm" variant="ghost" className="flex-1" href={`/${slug}/orders`}>Assign events</LinkButton>
                </div>
              </Card>
            ))}
            {crew.map((m) => (
              <Card key={m.userId} className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={m.name} src={m.image} size={44} />
                  <div className="min-w-0"><p className="truncate font-semibold text-fg">{m.name}</p><p className="text-[12px] text-fg-3">Crew</p></div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <dt className="text-fg-3">Events helped</dt><dd className="text-right font-semibold text-fg">{m.helped}</dd>
                  <dt className="text-fg-3">Works with</dt><dd className="truncate text-right text-fg">{m.worksWith.join(', ') || '—'}</dd>
                  <dt className="text-fg-3">Email</dt><dd className="truncate text-right text-fg">{m.email}</dd>
                </dl>
              </Card>
            ))}
            {board.invites.map((i) => (
              <Card key={i.id} className="border-dashed p-5">
                <p className="font-semibold text-fg">{i.name || i.email}</p>
                <p className="text-[12px] text-fg-3">{i.role === 'coach' ? 'Coach' : 'Crew'} · invite pending</p>
                <p className="mt-2 text-[12px] text-fg-2">{i.email}</p>
              </Card>
            ))}
            <Card className="grid place-items-center border-dashed p-5">
              <div className="text-center">
                <p className="text-sm font-semibold text-fg">Add coach or crew</p>
                <p className="mt-1 text-[12px] text-fg-2">Invite them from Team with the Coach or Crew role, their vehicle and location. They get a link to the coach portal.</p>
                <LinkButton href={`/${slug}/settings/team`} size="sm" className="mt-3" icon={<UserPlus className="size-4" />}>Invite</LinkButton>
              </div>
            </Card>
          </div>
        )}
      </PageBody>

      {drawer && (
        <ChecklistDrawer slug={slug} tz={tz} tenantId={tenantId} orderId={drawer.orderId} initialPhase={drawer.phase} canAct={canAct} onClose={() => setDrawer(null)} onChanged={() => router.refresh()} />
      )}
    </>
  );
}
