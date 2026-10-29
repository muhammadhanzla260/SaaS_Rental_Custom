import { ChevronRight, Navigation, Star } from 'lucide-react';
import Link from 'next/link';
import { COACH_PHASES } from '@rental/core';
import { coachHome } from '@rental/db';
import { Card, Progress, Ring } from '@/components/kit';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { activityText, ago, fmtTime } from './ui';

export const metadata = { title: 'Dashboard' };

export default async function CoachDashboard({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  const tz = ctx.tenant.timezone;
  const home = await coachHome(db, ctx.tenant.id, ctx.user.id, tz);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()));
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = ctx.user.name.split(/\s+/)[0];
  const base = `/coach/${slug}`;
  const tiles = [
    { key: 'all', label: 'Total', n: home.counts.total },
    { key: 'booked', label: 'Booked', n: home.counts.booked },
    { key: 'quote', label: 'Quotes', n: home.counts.quotes },
    { key: 'draft', label: 'Drafts', n: home.counts.drafts },
    { key: 'completed', label: 'Completed', n: home.counts.completed },
    { key: 'cancelled', label: 'Cancelled', n: home.counts.cancelled },
  ];
  const er = home.enRoute;

  return (
    <div className="flex flex-col gap-4">
      <section className="anim-rise">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">{hello}, {first}</h1>
        <p className="mt-1 text-sm text-fg-2">Your assigned rental events and checklist progress.</p>
        <span className="mt-2 inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent-text">
          {home.today.length} event{home.today.length === 1 ? '' : 's'} today
        </span>
      </section>

      <section className="anim-rise ink-dots flex items-center gap-4 rounded-[var(--radius-card)] p-4 text-white" style={{ '--d': '60ms' } as React.CSSProperties}>
        <Ring value={home.rating.percent} size={96} stroke={9} label={`Coach rating ${home.rating.stars} out of 5`}>
          <span className="font-display text-2xl font-bold">{home.rating.stars.toFixed(1)}</span>
          <span className="text-[10px] text-white/60">of 5</span>
        </Ring>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Coach rating</p>
          <p className="mt-1 flex items-center gap-0.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={i <= Math.round(home.rating.stars) ? 'size-4 fill-volt text-volt' : 'size-4 text-white/25'} />)}
          </p>
          <p className="mt-1.5 text-[13px] text-white/75">{home.rating.fullyChecked} fully checked · {home.rating.enRouteNow} en route now</p>
        </div>
      </section>

      {er ? (
        <Card className="anim-rise overflow-hidden" style={{ '--d': '120ms' } as React.CSSProperties}>
          <div className="flex items-center gap-2 bg-accent px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-on-accent">
            <Navigation className="size-3.5" /> En route{er.tracking ? ' · live' : ''}
          </div>
          <div className="p-4">
            <p className="font-semibold text-fg">{er.number} · {er.customerName}</p>
            <p className="mt-0.5 text-[13px] text-fg-2">{er.address || er.locationName}</p>
            <p className="mt-2 text-[12px] text-fg-3">
              {er.text1At ? 'Customer notified by SMS ✓' : 'Customer not texted'}{er.tracking ? ' · Live tracking active' : ''}
            </p>
            {er.etaMinutes != null && !er.arrivedAt && (
              <p className="mt-2 font-display text-xl font-bold tracking-tight text-accent-text">ARRIVING IN {er.etaMinutes} MIN</p>
            )}
            <Link href={`${base}/orders/${er.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-text">Open order <ChevronRight className="size-4" /></Link>
          </div>
        </Card>
      ) : (
        <Card className="anim-rise p-4 text-[13px] text-fg-2" style={{ '--d': '120ms' } as React.CSSProperties}>Nothing is currently en route.</Card>
      )}

      <div className="grid grid-cols-3 gap-2">
        {tiles.map((t, i) => (
          <Link key={t.key} href={`${base}/orders?filter=${t.key}`} className="lift anim-rise rounded-[var(--radius-card)] border border-subtle bg-surface px-3 py-3" style={{ '--d': `${160 + i * 30}ms` } as React.CSSProperties}>
            <p className="mono text-xl font-bold text-fg">{t.n}</p>
            <p className="text-[12px] font-medium text-fg-2">{t.label}</p>
          </Link>
        ))}
      </div>

      <Card className="p-4">
        <h2 className="font-display text-base font-bold text-fg">Today’s schedule</h2>
        {home.today.length === 0 ? (
          <p className="mt-2 text-[13px] text-fg-2">No events today.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-subtle">
            {home.today.map((o) => {
              const tag = !o.workable ? 'quote · locked' : o.arrivedAt ? 'arrived' : o.enRouteAt ? 'en route' : o.loadSaved ? 'loaded' : 'load pending';
              return (
                <li key={o.id}>
                  <Link href={`${base}/orders/${o.id}`} className="flex items-center gap-3 py-2.5">
                    <span className="mono w-16 shrink-0 text-[13px] font-semibold text-fg">{fmtTime(o.eventStartsAt, o.timezone)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg">{o.address || o.customerName}</span>
                      <span className="block truncate text-[12px] text-fg-3">{o.number} · {o.eventCity ?? o.locationName}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[11px] font-semibold text-fg-2">{tag}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-base font-bold text-fg">Phase completion</h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {COACH_PHASES.map((p, i) => (
            <li key={p.key}>
              <div className="mb-1 flex justify-between text-[12px]"><span className="font-medium text-fg-2">{p.n}. {p.short}</span><span className="mono font-semibold text-fg">{home.phaseAverages[i]}%</span></div>
              <Progress value={home.phaseAverages[i]!} label={`${p.short} average`} />
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="font-display text-base font-bold text-fg">Recent activity</h2>
        {home.activity.length === 0 ? (
          <p className="mt-2 text-[13px] text-fg-2">Your saves, texts and arrivals show here.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {home.activity.map((a, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px]">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1 text-fg">{activityText(a.action, a.changes)} <span className="text-fg-3">· {a.number}</span></span>
                <span className="shrink-0 text-[11px] text-fg-3">{ago(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link href={`${base}/orders`} className="press flex items-center justify-center gap-1 rounded-[var(--radius-control)] border border-subtle bg-surface py-3 text-sm font-semibold text-fg">
        View all orders <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
