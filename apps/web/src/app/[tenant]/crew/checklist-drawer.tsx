'use client';

import { Check, Wrench } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { COACH_PHASES, type CoachPhaseKey } from '@rental/core';
import { Button, cx, Drawer, LinkButton, Notice, Select, Spinner, Textarea, useToast } from '@/components/kit';
import { adminChecklistAction, closeTicketAction, createTicketAction, reopenPhaseAction, type AdminChecklist } from '@/server/actions/coach';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<AdminChecklist>;

/** One order's checklist for the office: every item with its time, photos, extras, reopen and maintenance tickets. */
export function ChecklistDrawer({ slug, tz, tenantId, orderId, initialPhase, canAct, onClose, onChanged }: {
  slug: string; tz: string; tenantId: string; orderId: string; initialPhase: CoachPhaseKey | null; canAct: boolean; onClose: () => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [phase, setPhase] = useState<CoachPhaseKey>(initialPhase ?? 'pre_departure');
  const [reopen, setReopen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [ticket, setTicket] = useState({ productId: '', unitId: '', notes: '' });
  const time = (d: string | null) => (d ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : '');

  const load = useCallback(async () => {
    const r = await adminChecklistAction(slug, orderId);
    if (!r.ok) return toast(r.error, 'error');
    setData(r.data as unknown as Data);
  }, [slug, orderId, toast]);
  useEffect(() => { void load(); }, [load]);

  const p = data?.phases.find((x) => x.key === phase);
  const def = COACH_PHASES.find((x) => x.key === phase)!;

  async function doReopen() {
    setBusy('reopen');
    const r = await reopenPhaseAction(slug, orderId, phase, reopen);
    setBusy(null);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Reopened');
    setReopen('');
    await load();
    onChanged();
  }
  async function doTicket() {
    setBusy('ticket');
    const r = await createTicketAction(slug, { orderId, productId: ticket.productId, unitId: ticket.unitId || null, notes: ticket.notes || data?.damageNotes });
    setBusy(null);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Ticket created');
    setTicket({ productId: '', unitId: '', notes: '' });
    await load();
    onChanged();
  }
  async function doClose(id: string) {
    setBusy(id);
    const r = await closeTicketAction(slug, id);
    setBusy(null);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Closed');
    await load();
    onChanged();
  }

  const status = (x: NonNullable<typeof p>) => {
    if (x.reopenedAt && (!x.savedAt || x.reopenedAt > x.savedAt)) return `Reopened by admin ${time(x.reopenedAt)}`;
    if (x.locked) return `Saved ${time(x.lockedAt)} · locked at 100%`;
    if (x.savedAt) return `Saved ${time(x.savedAt)} · ${Math.round(x.percent)}% complete`;
    if (phase === 'arrival' && !data?.arrivedAt) return 'Locked · opens after I have arrived';
    return 'Not saved yet';
  };
  const product = data?.products.find((x) => x.productId === ticket.productId);

  return (
    <Drawer
      open
      onClose={onClose}
      width={620}
      title={data ? `Checklist · ${data.order.number}` : 'Checklist'}
      footer={<LinkButton href={`/${slug}/orders/${orderId}`} variant="secondary">Open order</LinkButton>}
    >
      {!data ? (
        <div className="grid place-items-center py-16"><Spinner className="size-6" /></div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Rating', `${Math.round(data.rating)}% · ★ ${(data.rating / 20).toFixed(1)}`],
              ['En route', data.enRouteAt ? `Text 1 ${time(data.text1At)}${data.text2At ? ` · Text 2 ${time(data.text2At)}` : ''}` : '—'],
              ['Arrived', data.arrivedAt ? `${time(data.arrivedAt)}${data.arrivedDistanceM != null ? ` · ${data.arrivedDistanceM} m` : ''}` : '—'],
              ['Event start', data.eventStartedAt ? `${time(data.eventStartedAt)} · ${data.varianceMin === 0 ? 'on time' : data.varianceMin! > 0 ? `${data.varianceMin} min late` : `${-data.varianceMin!} min early`}` : '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[var(--radius-control)] bg-sunken px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">{k}</dt>
                <dd className="mt-0.5 text-[13px] font-semibold text-fg">{v}</dd>
              </div>
            ))}
          </dl>

          <div role="tablist" aria-label="Phases" className="flex gap-1 overflow-x-auto border-b border-subtle">
            {data.phases.map((x, i) => (
              <button key={x.key} type="button" role="tab" aria-selected={x.key === phase} onClick={() => setPhase(x.key as CoachPhaseKey)}
                className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold', x.key === phase ? 'border-accent text-fg' : 'border-transparent text-fg-3')}>
                P{i + 1} <span className={cx('mono', x.percent >= 100 ? 'text-success' : 'text-fg-2')}>{Math.round(x.percent)}%</span>
              </button>
            ))}
          </div>

          {p && (
            <section>
              <h3 className="font-display text-lg font-bold text-fg">Phase {def.n}: {p.title}</h3>
              <p className="text-[13px] text-fg-2">{status(p)}</p>
              {p.note && <p className="mt-2 rounded-[var(--radius-control)] bg-info-bg px-3 py-2 text-[13px] text-info-fg">{p.note}</p>}
              {p.groups.map((g, gi) => (
                <div key={gi} className="mt-3">
                  {g.label && <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-fg-3">{g.label}</p>}
                  <ul className="flex flex-col gap-1.5">
                    {g.items.map((it) => (
                      <li key={it.key} className={cx('flex items-start gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13px]', it.tickedAt ? 'bg-success-bg/50' : p.savedAt ? 'bg-warning-bg/60' : 'bg-sunken/60')}>
                        <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', it.tickedAt ? 'bg-success text-white' : 'border-2 border-strong/30')}>{it.tickedAt && <Check className="size-3" strokeWidth={3} />}</span>
                        <span className="flex-1 text-fg">{it.label}</span>
                        <span className="mono shrink-0 text-[11px] text-fg-3">{it.tickedAt ? time(it.tickedAt) : p.savedAt ? 'not ticked' : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {p.photo && (
                <div className="mt-3">
                  <p className="text-[13px] font-semibold text-fg">{p.photo.label}</p>
                  <Photos list={data.photos.filter((x) => x.kind === p.photo!.kind)} base={`/api/files/${tenantId}/`} time={time} empty="Required photo missing" />
                </div>
              )}
              {phase === 'arrival' && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-fg-3">Contract</dt><dd className="text-fg">{data.contractSignedAt ? 'Signed' : 'Not signed'}</dd>
                  <dt className="text-fg-3">Balance</dt><dd className="text-fg">{data.order.totalCents > data.order.paidCents ? 'To collect on arrival' : 'Paid'}</dd>
                  <dt className="text-fg-3">Manager override</dt><dd className="text-fg">{data.overrideReason || '—'}</dd>
                </dl>
              )}
              {phase === 'setup' && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-fg-3">Reached destination</dt><dd className="text-fg">{data.arrivedAt ? `${time(data.arrivedAt)}${data.arrivedDistanceM != null ? ` · ${data.arrivedDistanceM} m` : ''}` : '—'}</dd>
                  <dt className="text-fg-3">SOP notes</dt><dd className="whitespace-pre-wrap text-fg">{data.sopNotes || '—'}</dd>
                  <dt className="text-fg-3">EVENT START</dt><dd className="text-fg">{data.eventStartedAt ? time(data.eventStartedAt) : '—'}</dd>
                </dl>
              )}
              {phase === 'closeout' && (
                <div className="mt-3 flex flex-col gap-2">
                  {data.maintenanceFlag && <Notice kind="danger"><span className="flex items-center gap-1.5"><Wrench className="size-4" /> Warehouse maintenance flag is ON</span></Notice>}
                  <p className="text-[13px]"><span className="text-fg-3">Damage notes: </span><span className="text-fg">{data.damageNotes || (data.damage ? 'Damage ticked, no notes' : 'None')}</span></p>
                  <Photos list={data.photos.filter((x) => x.kind === 'damage')} base={`/api/files/${tenantId}/`} time={time} empty="" />
                  {data.tickets.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 rounded-[var(--radius-control)] border border-subtle px-3 py-2 text-[13px]">
                      <span className="mono font-semibold text-fg">{t.number}</span>
                      <span className="flex-1 text-fg-2">{data.products.find((x) => x.productId === t.productId)?.name ?? 'Item'} · {t.status === 'open' ? 'held from bookings' : `closed ${time(t.closedAt)}`}</span>
                      {t.status === 'open' && canAct && <Button size="sm" variant="ghost" pending={busy === t.id} onClick={() => doClose(t.id)}>Back in service</Button>}
                    </div>
                  ))}
                  {(data.damage || data.maintenanceFlag) && canAct && (
                    <div className="rounded-[var(--radius-control)] border border-subtle p-3">
                      <p className="text-[13px] font-semibold text-fg">Create maintenance ticket</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Select aria-label="Damaged item" value={ticket.productId} onChange={(e) => setTicket({ ...ticket, productId: e.target.value, unitId: '' })}>
                          <option value="">Damaged item…</option>
                          {data.products.map((x) => <option key={x.productId} value={x.productId}>{x.name}</option>)}
                        </Select>
                        {product?.serialized && (
                          <Select aria-label="Unit" value={ticket.unitId} onChange={(e) => setTicket({ ...ticket, unitId: e.target.value })}>
                            <option value="">Which unit…</option>
                            {product.units.map((u) => <option key={u.id} value={u.id}>{u.label} ({u.status})</option>)}
                          </Select>
                        )}
                      </div>
                      <Textarea className="mt-2 min-h-16" placeholder={data.damageNotes ?? 'What needs fixing'} value={ticket.notes} onChange={(e) => setTicket({ ...ticket, notes: e.target.value })} />
                      <Button className="mt-2" size="sm" pending={busy === 'ticket'} disabled={!ticket.productId || (product?.serialized && !ticket.unitId)} onClick={doTicket}>Create ticket</Button>
                      <p className="mt-1 text-[11px] text-fg-3">{product?.serialized ? 'The unit is set to Maintenance' : 'One unit is taken out of service'} and held from bookings until the ticket is closed.</p>
                    </div>
                  )}
                </div>
              )}

              {canAct && p.savedAt && (
                <div className="mt-4 rounded-[var(--radius-control)] border border-subtle p-3">
                  <p className="text-[13px] font-semibold text-fg">Reopen phase for coach</p>
                  <p className="text-[12px] text-fg-3">Unlocks this phase so the coach can correct it. The reason is written to the order history.</p>
                  <Textarea className="mt-2 min-h-16" placeholder="Why (e.g. the load photo is blurry)" value={reopen} onChange={(e) => setReopen(e.target.value)} />
                  <Button className="mt-2" size="sm" variant="secondary" pending={busy === 'reopen'} disabled={reopen.trim().length < 3} onClick={doReopen}>Reopen phase</Button>
                </div>
              )}
            </section>
          )}

          {data.history.length > 0 && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-fg-3">History</h3>
              <ul className="mt-1.5 flex flex-col gap-1 text-[12px] text-fg-2">
                {data.history.map((h, i) => {
                  const c = (h.changes ?? {}) as Record<string, string>;
                  return <li key={i}>{time(h.at)} · {h.actor ?? 'Someone'} {h.action === 'coach.reopened' ? `reopened ${c.title}: ${c.reason}` : `created ${c.number} (${c.item})`}</li>;
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Photos({ list, base, time, empty }: { list: { id: string; fileId: string; takenAt: string }[]; base: string; time: (d: string) => string; empty: string }) {
  if (!list.length) return empty ? <p className="mt-1 text-[12px] font-semibold text-danger">{empty}</p> : null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {list.map((x) => (
        <a key={x.id} href={`${base}${x.fileId}`} target="_blank" rel="noreferrer" className="relative block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${base}${x.fileId}`} alt="" className="size-24 rounded-[var(--radius-control)] object-cover" />
          <span className="mono absolute bottom-1 left-1 rounded bg-night/80 px-1 text-[10px] text-white">{time(x.takenAt)}</span>
        </a>
      ))}
    </div>
  );
}
