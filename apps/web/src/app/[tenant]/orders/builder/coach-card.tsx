'use client';

import { MapPin, Navigation, Pencil, Play, Users, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { COACH_PHASES } from '@rental/core';
import { Avatar, Button, Card, cx, Drawer, Notice, Textarea, useToast } from '@/components/kit';
import { saveOrderStaffAction } from '@/server/actions/coach';

export type CoachCardData = {
  staff: { userId: string; name: string; image: string | null; role: string; isLead: boolean }[];
  candidates: { userId: string; name: string; image: string | null; role: string; vehicle: string | null }[];
  coachNotes: string | null;
  checklist: {
    phases: number[]; rating: number; completed: boolean; maintenanceFlag: boolean;
    enRouteAt: string | null; tracking: boolean; etaMinutes: number | null; arrivedAt: string | null; arrivedDistanceM: number | null; eventStartedAt: string | null;
  };
};

type Pick = { role: 'coach' | 'crew' | null; lead: boolean };

/** "Coaches & crew" on the order page: who runs the event, and how far the coach checklist is. */
export function CoachCard({ slug, orderId, data, canEdit, tz }: { slug: string; orderId: string; data: CoachCardData; canEdit: boolean; tz: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [notes, setNotes] = useState('');
  const c = data.checklist;
  const time = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d));

  function edit() {
    setPicks(Object.fromEntries(data.staff.map((s) => [s.userId, { role: s.role as 'coach' | 'crew', lead: s.isLead }])));
    setNotes(data.coachNotes ?? '');
    setOpen(true);
  }

  function setRole(userId: string, role: Pick['role']) {
    setPicks((p) => {
      const next = { ...p, [userId]: { role, lead: role === 'coach' ? p[userId]?.lead ?? false : false } };
      const coaches = Object.entries(next).filter(([, v]) => v.role === 'coach');
      // One lead among the coaches: the only coach, or the first one if the lead was removed.
      if (coaches.length && !coaches.some(([, v]) => v.lead)) next[coaches[0]![0]] = { role: 'coach', lead: true };
      return next;
    });
  }

  async function save() {
    setBusy(true);
    const staff = Object.entries(picks).filter(([, v]) => v.role).map(([userId, v]) => ({ userId, role: v.role!, isLead: v.lead }));
    const r = await saveOrderStaffAction(slug, orderId, { staff, coachNotes: notes });
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Saved');
    setOpen(false);
    router.refresh();
  }

  const coachCount = Object.values(picks).filter((v) => v.role === 'coach').length;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg"><Users className="size-4" /> Coaches &amp; crew</h2>
        {canEdit && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={edit}>Edit</Button>}
      </div>
      {data.staff.length === 0 ? (
        <p className="mt-2 text-[13px] text-fg-2">Nobody assigned yet. A coach runs the checklist and the en route texts on their phone.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {data.staff.map((s) => (
            <li key={s.userId} className="flex items-center gap-2.5 text-sm">
              <Avatar name={s.name} src={s.image} size={28} />
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{s.name}</span>
              <span className="text-[12px] text-fg-3">{s.isLead ? 'Lead coach' : s.role === 'coach' ? 'Coach' : 'Crew'}</span>
            </li>
          ))}
        </ul>
      )}

      {data.staff.some((s) => s.role === 'coach') && (
        <div className="mt-3 border-t border-subtle pt-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-semibold text-fg-2">Checklist {c.completed ? '· Completed' : ''}</span>
            <span className="mono font-bold text-fg">{Math.round(c.rating)}%</span>
          </div>
          <div className="mt-1.5 flex gap-1" aria-label={c.phases.map((p, i) => `${COACH_PHASES[i]!.short} ${Math.round(p)}%`).join(', ')}>
            {c.phases.map((p, i) => (
              <span key={i} title={`${COACH_PHASES[i]!.short} ${Math.round(p)}%`} className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                <span className={cx('block h-full rounded-full', p >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${p}%` }} />
              </span>
            ))}
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-[12px] text-fg-2">
            {c.enRouteAt && <li className="flex items-center gap-1.5"><Navigation className="size-3.5" /> En route {time(c.enRouteAt)}{c.tracking ? ` · live${c.etaMinutes != null ? ` · ETA ~${c.etaMinutes} min` : ''}` : ''}</li>}
            {c.arrivedAt && <li className="flex items-center gap-1.5"><MapPin className="size-3.5" /> Arrived {time(c.arrivedAt)}{c.arrivedDistanceM != null ? ` · ${c.arrivedDistanceM} m` : ''}</li>}
            {c.eventStartedAt && <li className="flex items-center gap-1.5"><Play className="size-3.5" /> EVENT START {time(c.eventStartedAt)}</li>}
          </ul>
          {c.maintenanceFlag && <Notice kind="danger" className="mt-2"><span className="flex items-center gap-1.5"><Wrench className="size-3.5" /> Damage reported · maintenance flag on</span></Notice>}
        </div>
      )}
      {data.coachNotes && <p className="mt-3 whitespace-pre-wrap rounded-[var(--radius-control)] bg-sunken px-3 py-2 text-[12px] text-fg-2">{data.coachNotes}</p>}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Coaches & crew"
        sub="Coaches run the checklist, en route texts and EVENT START. Crew see the order and help."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button pending={busy} onClick={save}>Save</Button></>}
      >
        {data.candidates.length === 0 ? (
          <Notice kind="info">No coaches or crew yet. Invite them in Settings → Team with the Coach or Crew role.</Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.candidates.map((m) => {
              const p = picks[m.userId] ?? { role: null, lead: false };
              const options: Pick['role'][] = m.role === 'coach' ? [null, 'coach', 'crew'] : [null, 'crew'];
              return (
                <li key={m.userId} className="rounded-[var(--radius-control)] border border-subtle p-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={m.name} src={m.image} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{m.name}</p>
                      <p className="truncate text-[12px] text-fg-3">{m.role === 'coach' ? 'Coach' : 'Crew'}{m.vehicle ? ` · ${m.vehicle}` : ''}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={`${m.name} on this order`}>
                    {options.map((o) => (
                      <button
                        key={o ?? 'none'}
                        type="button"
                        role="radio"
                        aria-checked={p.role === o}
                        onClick={() => setRole(m.userId, o)}
                        className={cx('press rounded-full px-3 py-1 text-[12px] font-semibold', p.role === o ? 'bg-accent text-on-accent' : 'bg-sunken text-fg-2')}
                      >
                        {o === null ? 'Not on it' : o === 'coach' ? 'Coach' : 'Crew'}
                      </button>
                    ))}
                    {p.role === 'coach' && coachCount > 1 && (
                      <label className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-fg">
                        <input type="radio" name="lead" checked={p.lead} onChange={() => setPicks((all) => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, lead: k === m.userId }])))} />
                        Lead
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <label className="mt-4 block text-[13px] font-semibold text-fg">
          Notes for coach
          <Textarea className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gate code, where to set up, who to ask for…" />
        </label>
      </Drawer>
    </Card>
  );
}
