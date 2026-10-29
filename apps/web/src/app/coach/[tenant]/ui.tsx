import { COACH_PHASES } from '@rental/core';
import { cx, Pill } from '@/components/kit';

export const STATUS_TONE: Record<string, 'info' | 'success' | 'violet' | 'neutral' | 'danger'> = {
  Booked: 'info', Completed: 'success', Done: 'success', Quote: 'violet', Draft: 'neutral', Cancelled: 'danger',
};

export function StatusPill({ label }: { label: string }) {
  return <Pill tone={STATUS_TONE[label] ?? 'neutral'}>{label}</Pill>;
}

export const fmtTime = (d: Date | string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(d));
export const fmtDay = (d: Date | string, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(d));
export const fmtWindow = (a: Date | string, b: Date | string, tz: string) => `${fmtDay(a, tz)} · ${fmtTime(a, tz)} – ${fmtTime(b, tz)}`;

/** Five segments, one per phase: green at 100, accent in progress, grey at 0. */
export function PhaseBar({ phases, className }: { phases: number[]; className?: string }) {
  return (
    <div className={cx('flex gap-1', className)} aria-label={`Phases: ${phases.map((p, i) => `${COACH_PHASES[i]!.short} ${Math.round(p)}%`).join(', ')}`}>
      {phases.map((p, i) => (
        <span key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
          <span className={cx('block h-full rounded-full', p >= 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(100, p))}%` }} />
        </span>
      ))}
    </div>
  );
}

/** One history line in plain words ("Saved Load Checklist · 67%"). */
export function activityText(action: string, changes: unknown): string {
  const c = (changes ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'coach.phase_saved': return `Saved ${c.title ?? 'a phase'} · ${Math.round(Number(c.percent ?? 0))}%`;
    case 'coach.photo': return `Added a ${c.kind === 'damage' ? 'damage' : String(c.kind ?? '')} photo`;
    case 'coach.photo_removed': return 'Removed a photo';
    case 'coach.en_route': return c.text1 ? 'Started en route · Text 1 sent' : 'Started en route';
    case 'coach.arriving': return `Text 2 sent · about ${c.etaMinutes ?? 5} min away`;
    case 'coach.tracking_on': return 'Live tracking on';
    case 'coach.tracking_off': return 'Live tracking off';
    case 'coach.arrived': return c.distanceM != null ? `Arrived · ${c.distanceM} m from the venue` : 'Arrived';
    case 'coach.event_start': return `EVENT START · ${c.label ?? ''}`;
    case 'coach.damage': return 'Reported damage · maintenance flag on';
    default: return action.replace('coach.', '').replace(/_/g, ' ');
  }
}

export function ago(d: Date | string) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
