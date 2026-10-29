'use client';

import { ArrowLeft, Camera, Check, FileSignature, Lock, MapPin, Navigation, Phone, Play, Radio, Trash2, TriangleAlert, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  coachPhase, formatMoney, formatPhone, phaseItems, type CoachPhaseKey, type CoachPhotoKind, type OrderSummary, type PhaseStatus,
} from '@rental/core';
import type { coachOrderDetail } from '@rental/db';
import { Button, Card, cx, Notice, Sheet, Textarea, useToast } from '@/components/kit';
import type { ActionResult } from '@/lib/result';
import {
  arrivedAction, enRouteAction, eventStartAction, removePhotoAction, savePhaseAction, trackingAction, uploadPhotoAction,
} from '@/server/actions/coach';
import { getFix } from '../../gps';
import { useTracking } from '../../portal-chrome';
import { fmtTime, fmtWindow, StatusPill } from '../../ui';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Detail = Jsonify<Awaited<ReturnType<typeof coachOrderDetail>>>;
type Photo = Detail['photos'][number];

function statusText(s: PhaseStatus) {
  switch (s.kind) {
    case 'open': return 'Open';
    case 'saved': return s.locked ? 'Saved · locked' : 'Saved';
    case 'saved_on_arrival': return 'Saved on arrival';
    case 'reopened': return 'Reopened by admin';
    case 'locked_until': return `Locked until phase ${s.phase} is saved`;
    case 'after_arrival': return 'Opens after “I have arrived”';
  }
}

export function OrderView({ slug, tz, currency, readOnly, setupMapUrl, detail, photoBase }: {
  slug: string; tz: string; currency: string; readOnly: boolean; setupMapUrl: string | null; detail: Detail; photoBase: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const tracking = useTracking();
  const [sheet, setSheet] = useState<CoachPhaseKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { order, checklist: c } = detail;
  const id = order.id;
  const coach = detail.me.role === 'coach' && !readOnly;
  const money = (cents: number) => formatMoney(cents, currency);
  const live = tracking.orderId === id;
  const s = order.summary as Partial<OrderSummary>;

  async function act<T>(key: string, fn: () => Promise<ActionResult<T>>, ok?: (data: T | undefined) => string | void) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    const msg = ok?.(r.data);
    if (msg) toast(msg);
    router.refresh();
  }

  const startEnRoute = () => act('enroute', async () => enRouteAction(slug, id, await getFix()), (d) => {
    if (d?.tracking) tracking.start(id, d.etaMinutes);
    return d?.text1 ? `Customer texted${d.etaMinutes != null ? ` · ETA ~${d.etaMinutes} min` : ''}` : 'En route';
  });
  const toggleTracking = (on: boolean) => act('track', () => trackingAction(slug, id, on), (d) => {
    if (d?.tracking) tracking.start(id, c.etaMinutes);
    else tracking.stop();
    return d?.tracking ? 'Live tracking on' : 'Live tracking off';
  });
  const arrived = () => act('arrived', async () => arrivedAction(slug, id, await getFix()), (d) => {
    tracking.stop();
    return d?.distanceM != null ? `Arrived · ${d.distanceM} m from the venue` : 'Arrived';
  });

  const overall = Math.round(c.rating);
  const statusLabel = c.completed ? 'Completed' : 'Booked';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/coach/${slug}/orders`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent-text"><ArrowLeft className="size-4" /> All orders</Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mono text-[13px] font-semibold text-fg-2">{order.number}</p>
            <h1 className="truncate font-display text-2xl font-bold tracking-tight text-fg">{detail.customer.name}</h1>
          </div>
          <StatusPill label={statusLabel} />
        </div>
      </div>

      {c.completed && <Notice kind="success">Completed: you arrived and every phase is saved.</Notice>}
      {c.maintenanceFlag && <Notice kind="danger">Warehouse maintenance flag is ON (damage reported at close-out).</Notice>}
      {detail.me.role === 'crew' && <Notice kind="info">You are crew on this order. The coach ticks the checklist.</Notice>}

      {/* Checklist */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-fg">Coach checklist · 5 phases</h2>
          <span className="mono text-lg font-bold text-fg">{overall}%</span>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          {c.phases.map((p) => {
            const def = coachPhase(p.key);
            const st = p.status as PhaseStatus;
            const closed = !p.open;
            return (
              <li key={p.key} className={def.n === 5 ? 'min-[380px]:col-span-2' : undefined}>
                <button
                  type="button"
                  onClick={() => setSheet(p.key)}
                  className={cx('press flex w-full flex-col gap-1.5 rounded-[var(--radius-control)] border p-3 text-left', closed ? 'border-subtle bg-sunken/60' : p.percent >= 100 ? 'border-success/40 bg-success-bg/50' : 'border-subtle bg-surface')}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-fg">{def.n}. {def.short}</span>
                    <span className="mono text-[13px] font-bold text-fg">{Math.round(p.percent)}%</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
                    <span className={cx('block h-full rounded-full', p.percent >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${p.percent}%` }} />
                  </span>
                  <span className={cx('flex items-center gap-1 text-[11px] font-medium', closed ? 'text-fg-3' : 'text-fg-2')}>
                    {closed && <Lock className="size-3" />}{statusText(st)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>

      {/* En route & live tracking */}
      <Card className="p-4">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg"><Navigation className="size-4" /> En route &amp; live tracking</h2>
        {!c.enRouteAt ? (
          <div className="mt-3">
            <Button size="lg" className="w-full" icon={<Navigation className="size-4" />} disabled={!coach || !c.enRouteReady || !!c.arrivedAt} pending={busy === 'enroute'} onClick={startEnRoute}>
              Start En Route
            </Button>
            {!c.enRouteReady && <p className="mt-2 text-[12px] text-fg-3">Unlocks once Pre-Departure and Load are saved.</p>}
            {busy === 'enroute' && <p className="mt-2 text-[12px] text-fg-3">Getting a precise GPS fix…</p>}
          </div>
        ) : (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-fg-3">Text 1 (en route)</dt><dd className="text-right font-semibold text-fg">{c.text1At ? `Sent ${fmtTime(c.text1At, tz)}` : '—'}</dd>
            <dt className="text-fg-3">Text 2 (5 min away)</dt><dd className="text-right font-semibold text-fg">{c.text2At ? `Sent ${fmtTime(c.text2At, tz)}` : 'Waiting'}</dd>
            <dt className="text-fg-3">ETA</dt><dd className="text-right font-semibold text-fg">{c.arrivedAt ? '—' : (live ? tracking.etaMinutes : c.etaMinutes) != null ? `~${live ? tracking.etaMinutes : c.etaMinutes} min` : '—'}</dd>
            <dt className="text-fg-3">Live tracking</dt>
            <dd className={cx('flex items-center justify-end gap-1 font-semibold', live || c.tracking ? 'text-success' : 'text-fg-2')}>
              {live || c.tracking ? <><Radio className="size-3.5" /> On</> : 'Off'}
            </dd>
          </dl>
        )}
        {c.enRouteAt && !c.arrivedAt && coach && (
          <div className="mt-3 flex gap-2">
            {live || c.tracking ? (
              <Button variant="secondary" className="flex-1" pending={busy === 'track'} onClick={() => toggleTracking(false)}>Stop Tracking</Button>
            ) : (
              <Button variant="secondary" className="flex-1" pending={busy === 'track'} disabled={!!c.text2At} onClick={() => toggleTracking(true)}>Start Tracking</Button>
            )}
          </div>
        )}
        <div className="mt-3 border-t border-subtle pt-3">
          {c.arrivedAt ? (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-success"><Check className="size-4" /> Arrived {fmtTime(c.arrivedAt, tz)}{c.arrivedDistanceM != null ? ` · ${c.arrivedDistanceM} m` : ''}</p>
          ) : (
            <Button variant="volt" size="lg" className="w-full" icon={<MapPin className="size-4" />} disabled={!coach} pending={busy === 'arrived'} onClick={arrived}>I have arrived</Button>
          )}
          {c.eventStartedAt && (
            <p className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-fg"><Play className="size-4" /> EVENT START {fmtTime(c.eventStartedAt, tz)}{c.eventStartVarianceMin != null ? ` · ${c.eventStartVarianceMin === 0 ? 'on time' : c.eventStartVarianceMin > 0 ? `${c.eventStartVarianceMin} min late` : `${-c.eventStartVarianceMin} min early`}` : ''}</p>
          )}
        </div>
      </Card>

      {/* Order sections */}
      <Card className="divide-y divide-subtle">
        <Section title="Customer">
          <p className="font-semibold text-fg">{detail.customer.name}</p>
          {detail.customer.phone && <a href={`tel:${detail.customer.phone}`} className="mt-1 flex items-center gap-1.5 text-accent-text"><Phone className="size-3.5" />{formatPhone(detail.customer.phone, 'US')}</a>}
          {detail.customer.email && <p className="mt-0.5 text-fg-2">{detail.customer.email}</p>}
        </Section>
        {(detail.contact.name || detail.contact.mobile) && (
          <Section title="Event day contact">
            <p className="font-semibold text-fg">{detail.contact.name}</p>
            {detail.contact.mobile && <a href={`tel:${detail.contact.mobile}`} className="mt-1 flex items-center gap-1.5 text-accent-text"><Phone className="size-3.5" />{formatPhone(detail.contact.mobile, 'US')}</a>}
          </Section>
        )}
        <Section title="Rental contract">
          {detail.contract.signedAt ? (
            <p className="flex items-center gap-1.5 font-semibold text-success"><Check className="size-4" /> Signed</p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-fg-2">Not signed yet. Have the customer sign on site.</p>
              {detail.contract.url && <a href={detail.contract.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-accent px-3 py-2 text-[13px] font-semibold text-on-accent"><FileSignature className="size-4" /> Show Contract</a>}
            </div>
          )}
        </Section>
        <Section title="Event schedule"><p className="text-fg">{fmtWindow(order.eventStartsAt, order.eventEndsAt, tz)}</p></Section>
        <Section title="Event location">
          <p className="text-fg">{order.address || '—'}</p>
          {order.address && (
            <a
              href={order.eventLat != null && order.eventLng != null ? `https://www.google.com/maps/dir/?api=1&destination=${order.eventLat},${order.eventLng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`}
              target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 font-semibold text-accent-text"
            ><MapPin className="size-3.5" /> Open in Maps</a>
          )}
          {order.setupSurface && <p className="mt-1 text-fg-2">Setup surface: {order.setupSurface}</p>}
          {setupMapUrl && <a href={setupMapUrl} target="_blank" rel="noreferrer" className="mt-1 block font-semibold text-accent-text">Setup map</a>}
        </Section>
        <Section title="Order items">
          <ul className="flex flex-col gap-1.5">
            {detail.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3"><span className="text-fg">{l.quantity > 1 ? `${l.quantity} × ` : ''}{l.name}</span><span className="mono text-fg">{money(l.lineTotalCents)}</span></li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t border-subtle pt-2 text-[13px]">
            <dt className="text-fg-2">SubTotal</dt><dd className="mono text-right">{money(s.merchandiseCents ?? order.totals.merchandiseCents)}</dd>
            {!!s.damageWaiverCents && <><dt className="text-fg-2">Damage waiver</dt><dd className="mono text-right">{money(s.damageWaiverCents)}</dd></>}
            {!!s.travelFeeCents && <><dt className="text-fg-2">Travel fee</dt><dd className="mono text-right">{money(s.travelFeeCents)}</dd></>}
            {!!order.totals.discountCents && <><dt className="text-fg-2">Discount</dt><dd className="mono text-right">−{money(order.totals.discountCents)}</dd></>}
            <dt className="text-fg-2">Tax</dt><dd className="mono text-right">{money(order.totals.taxCents)}</dd>
            <dt className="font-semibold text-fg">Total</dt><dd className="mono text-right font-semibold">{money(order.totals.totalCents)}</dd>
            <dt className="text-fg-2">Deposit</dt><dd className="mono text-right">{money(order.totals.depositDueCents)}</dd>
            <dt className="font-semibold text-fg">Due</dt><dd className={cx('mono text-right font-bold', order.totals.dueCents > 0 ? 'text-danger' : 'text-success')}>{money(order.totals.dueCents)}</dd>
          </dl>
        </Section>
        <Section title="Notes for coach">
          <p className="whitespace-pre-wrap text-fg">{order.coachNotes || detail.location?.loadingNotes || 'No notes.'}</p>
        </Section>
        {detail.team.length > 1 && (
          <Section title="Team">
            <ul className="flex flex-col gap-1">{detail.team.map((t) => <li key={t.userId} className="text-fg">{t.name} <span className="text-fg-3">· {t.isLead ? 'Lead coach' : t.role === 'coach' ? 'Coach' : 'Crew'}</span></li>)}</ul>
          </Section>
        )}
      </Card>

      {sheet && (
        <PhaseSheet
          key={`${sheet}-${c.state.saved[sheet] ?? ''}-${c.state.reopened[sheet] ?? ''}`}
          phase={sheet}
          slug={slug}
          orderId={id}
          tz={tz}
          detail={detail}
          editable={coach}
          dueCents={order.totals.dueCents}
          money={money}
          photoBase={photoBase}
          onClose={() => setSheet(null)}
          onEventStart={() => act('start', async () => eventStartAction(slug, id, await getFix()), (d) => `EVENT START · ${d?.label ?? ''}`)}
          startBusy={busy === 'start'}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3.5 text-sm">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

function PhaseSheet({ phase, slug, orderId, tz, detail, editable, dueCents, money, photoBase, onClose, onEventStart, startBusy }: {
  phase: CoachPhaseKey; slug: string; orderId: string; tz: string; detail: Detail; editable: boolean; dueCents: number; money: (c: number) => string;
  photoBase: string; onClose: () => void; onEventStart: () => void; startBusy: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const def = coachPhase(phase);
  const c = detail.checklist;
  const view = c.phases.find((p) => p.key === phase)!;
  const savedTicks = c.state.ticks;
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(phaseItems(def).map((i) => i.key).filter((k) => savedTicks[k])));
  const [override, setOverride] = useState(c.overrideReason ?? '');
  const [sop, setSop] = useState(c.sopNotes ?? '');
  const [damage, setDamage] = useState(c.damage);
  const [damageNotes, setDamageNotes] = useState(c.damageNotes ?? '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<CoachPhotoKind | null>(null);
  const canEdit = editable && view.open && !view.locked;
  const st = view.status as PhaseStatus;

  const items = phaseItems(def);
  const photoDone = def.photo ? detail.photos.some((p) => p.kind === def.photo!.kind) : false;
  const pct = Math.round(((items.filter((i) => ticked.has(i.key)).length + (def.photo && photoDone ? 1 : 0)) / (items.length + (def.photo ? 1 : 0))) * 100);

  async function save() {
    setSaving(true);
    const r = await savePhaseAction(slug, orderId, {
      phase, ticked: [...ticked],
      ...(phase === 'arrival' ? { overrideReason: override } : {}),
      ...(phase === 'setup' ? { sopNotes: sop } : {}),
      ...(phase === 'closeout' ? { damage, damageNotes } : {}),
    });
    setSaving(false);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Saved');
    router.refresh();
    onClose();
  }

  const lockedNote = !view.open
    ? statusText(st)
    : view.locked
      ? `Saved ${c.state.locked[phase] ? fmtTime(c.state.locked[phase]!, tz) : ''} · locked at 100%`
      : null;

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Phase ${def.n}: ${def.title}`}
      sub={
        <div className="mt-2">
          <div className="flex justify-between gap-3 text-[12px]"><span>{lockedNote ?? (st.kind === 'saved' ? `Saved ${fmtTime(st.at, tz)}` : st.kind === 'saved_on_arrival' ? 'Saved on arrival' : 'Not saved yet')}</span><span className="mono font-semibold text-fg">{pct}%</span></div>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-sunken"><span className={cx('block h-full rounded-full transition-[width] duration-300', pct >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${pct}%` }} /></span>
        </div>
      }
      footer={canEdit ? <Button size="lg" className="w-full" pending={saving} onClick={save}>{def.button}</Button> : undefined}
    >
      {def.note && <p className="mb-3 rounded-[var(--radius-control)] bg-info-bg px-3 py-2 text-[13px] text-info-fg">{def.note}</p>}

      {phase === 'setup' && c.arrivedAt && (
        <div className="mb-3 rounded-[var(--radius-control)] bg-success-bg px-3 py-2 text-[13px] text-success-fg">
          Reached destination {fmtTime(c.arrivedAt, tz)}{c.arrivedDistanceM != null ? ` · ${c.arrivedDistanceM} m from the venue` : ''}
        </div>
      )}

      {def.groups.map((g, gi) => (
        <fieldset key={gi} className="mb-3">
          {g.label && <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-fg-3">{g.label}</legend>}
          <ul className="flex flex-col gap-2">
            {g.items.map((it) => {
              const final = !!savedTicks[it.key];
              const on = ticked.has(it.key);
              return (
                <li key={it.key}>
                  <button
                    type="button"
                    disabled={!canEdit || final}
                    aria-pressed={on}
                    onClick={() => setTicked((s) => { const n = new Set(s); if (n.has(it.key)) n.delete(it.key); else n.add(it.key); return n; })}
                    className={cx('press flex w-full items-start gap-3 rounded-[var(--radius-control)] border px-3 py-3 text-left text-sm disabled:cursor-default', on ? 'border-success/50 bg-success-bg/60' : 'border-subtle bg-surface', !on && view.status && (view.status as PhaseStatus).kind === 'saved' && 'border-warning/50')}
                  >
                    <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2', on ? 'anim-pop border-success bg-success text-white' : 'border-strong/40')}>{on && <Check className="size-3.5" strokeWidth={3} />}</span>
                    <span className="flex-1 text-fg">{it.label}</span>
                    {final && <Lock className="mt-1 size-3.5 shrink-0 text-fg-3" aria-label="Saved" />}
                  </button>
                  {phase === 'arrival' && it.key === 'arrival_contract' && (
                    <p className="ml-12 mt-1 text-[12px]">
                      {detail.contract.signedAt ? <span className="font-semibold text-success">Contract signed</span> : detail.contract.url ? <a className="font-semibold text-accent-text" href={detail.contract.url} target="_blank" rel="noreferrer">Show Contract</a> : null}
                    </p>
                  )}
                  {phase === 'arrival' && it.key === 'arrival_payment' && (
                    <p className="ml-12 mt-1 text-[12px] text-fg-2">{dueCents > 0 ? <><span className="font-semibold text-danger">Due {money(dueCents)}</span> · the portal takes no payment</> : <span className="font-semibold text-success">Paid in full</span>}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {def.photo && <PhotoBlock kind={def.photo.kind} label={def.photo.label} required slug={slug} orderId={orderId} photos={detail.photos} canEdit={canEdit} photoBase={photoBase} uploading={uploading} setUploading={setUploading} />}

      {phase === 'arrival' && (
        <label className="mt-2 block text-[13px] font-semibold text-fg">
          Manager override reason
          <Textarea className="mt-1 min-h-20" value={override} onChange={(e) => setOverride(e.target.value)} disabled={!canEdit} placeholder="Why a step could not be done" />
        </label>
      )}

      {phase === 'setup' && (
        <>
          <label className="mt-2 block text-[13px] font-semibold text-fg">
            SOP / setup notes
            <Textarea className="mt-1 min-h-20" value={sop} onChange={(e) => setSop(e.target.value)} disabled={!canEdit} />
          </label>
          <div className="mt-3 rounded-[var(--radius-control)] border border-subtle p-3">
            {c.eventStartedAt ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-fg"><Play className="size-4" /> EVENT START {fmtTime(c.eventStartedAt, tz)}{c.eventStartVarianceMin != null ? ` · ${c.eventStartVarianceMin === 0 ? 'On time' : c.eventStartVarianceMin > 0 ? `${c.eventStartVarianceMin} min late` : `${-c.eventStartVarianceMin} min early`}` : ''}</p>
            ) : (
              <>
                <Button variant="dark" size="lg" className="w-full" icon={<Play className="size-4" />} disabled={!editable || !view.open} pending={startBusy} onClick={onEventStart}>EVENT START</Button>
                <p className="mt-1.5 text-[12px] text-fg-3">Captures the time and GPS. Can be pressed once.</p>
              </>
            )}
          </div>
        </>
      )}

      {phase === 'closeout' && (
        <div className="mt-2 rounded-[var(--radius-control)] border border-subtle p-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg"><TriangleAlert className="size-4 text-warning" /> Damage report (optional)</p>
          <label className="mt-2 flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" className="size-5 accent-[var(--danger)]" checked={damage} disabled={!canEdit} onChange={(e) => setDamage(e.target.checked)} /> Damage
          </label>
          <Textarea className="mt-2 min-h-20" value={damageNotes} onChange={(e) => setDamageNotes(e.target.value)} disabled={!canEdit} placeholder="What is damaged, and how" />
          <PhotoBlock kind="damage" label="Damage photos" slug={slug} orderId={orderId} photos={detail.photos} canEdit={canEdit} photoBase={photoBase} uploading={uploading} setUploading={setUploading} />
          {(c.maintenanceFlag || damage || damageNotes.trim()) && (
            <p className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger"><Wrench className="size-4" /> {c.maintenanceFlag ? 'Warehouse maintenance flag is ON' : 'Saving turns the warehouse maintenance flag ON'}</p>
          )}
        </div>
      )}

      {!editable && <p className="mt-3 text-[12px] text-fg-3">{detail.me.role === 'crew' ? 'Crew can see the checklist; the coach ticks it.' : 'Read-only.'}</p>}
    </Sheet>
  );
}

function PhotoBlock({ kind, label, required, slug, orderId, photos, canEdit, photoBase, uploading, setUploading }: {
  kind: CoachPhotoKind; label: string; required?: boolean; slug: string; orderId: string; photos: Photo[]; canEdit: boolean; photoBase: string;
  uploading: CoachPhotoKind | null; setUploading: (k: CoachPhotoKind | null) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const mine = photos.filter((p) => p.kind === kind);

  async function upload(file: File) {
    setUploading(kind);
    const form = new FormData();
    form.set('kind', kind);
    form.set('file', file);
    form.set('takenAt', String(file.lastModified || Date.now()));
    const r = await uploadPhotoAction(slug, orderId, form);
    setUploading(null);
    if (!r.ok) return toast(r.error, 'error');
    toast('Photo added');
    router.refresh();
  }

  async function remove(id: string) {
    const r = await removePhotoAction(slug, orderId, id);
    if (!r.ok) return toast(r.error, 'error');
    router.refresh();
  }

  return (
    <div className="mt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
        <Camera className="size-4" /> {label}{required && (mine.length ? <Check className="size-4 text-success" /> : <span className="text-[11px] font-semibold text-danger">Required photo missing</span>)}
      </p>
      <div className="flex flex-wrap gap-2">
        {mine.map((p) => (
          <div key={p.id} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${photoBase}${p.fileId}`} alt={label} className="size-20 rounded-[var(--radius-control)] object-cover" />
            {canEdit && (
              <button type="button" onClick={() => remove(p.id)} aria-label="Remove photo" className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-night text-white"><Trash2 className="size-3" /></button>
            )}
          </div>
        ))}
        {canEdit && (
          <button type="button" onClick={() => input.current?.click()} disabled={uploading !== null} className="press grid size-20 place-items-center rounded-[var(--radius-control)] border-2 border-dashed border-strong/30 text-fg-2">
            {uploading === kind ? <span className="text-[11px]">Uploading…</span> : <Camera className="size-6" />}
          </button>
        )}
      </div>
      <input
        ref={input} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }}
      />
    </div>
  );
}
