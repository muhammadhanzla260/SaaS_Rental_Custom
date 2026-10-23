'use client';

import Link from 'next/link';
import { ArrowRight, CalendarCheck2, CalendarDays, CircleCheck, CircleDashed, Clock, FileClock, MapPin, Phone, Plus, Sparkles, Wallet } from 'lucide-react';
import { motion } from 'motion/react';
import { AnimatedNumber, ProgressRing, Reveal, Stagger, StaggerItem } from '@/components/motion';
import { StaticMap } from '@/components/static-map';
import { Badge, cx } from '@/components/ui';

type Step = { done: boolean; title: string; text: string; href?: string; soon?: string };
type Loc = { id: string; name: string; code: string; city: string; lat: number | null; lng: number | null; isPrimary: boolean; href: string };

type Upcoming = { id: string; href: string; customer: string; items: string; when: string; totalCents: number; city: string | null };

export function DashboardView({
  welcome, greeting, today, localTime, tenantName, canManageSettings, steps, facts, locations, stats, currency, upcoming, newOrderHref,
}: {
  welcome: boolean; greeting: string; today: string; localTime: string; tenantName: string; canManageSettings: boolean;
  steps: Step[]; facts: { timezone: string; currency: string; phone: string; deposit: number; team: number }; locations: Loc[];
  stats: { upcoming: number; thisWeek: number; quotesOpen: number; bookedThisMonthCents: number }; currency: string; upcoming: Upcoming[]; newOrderHref: string;
}) {
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const setupDone = steps.filter((s) => !s.soon).every((s) => s.done);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.soon);

  return (
    <div className="flex flex-col gap-6">
      {/* hero */}
      <Reveal className="brand-gradient relative overflow-hidden rounded-[calc(var(--radius)*1.6)] p-6 text-brand-fg shadow-pop sm:p-8">
        <motion.div aria-hidden className="absolute -right-16 -top-20 size-64 rounded-full bg-white/10"
          animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div aria-hidden className="absolute -bottom-24 right-40 size-48 rounded-full bg-white/10"
          animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 max-w-xl">
            <p className="text-sm font-medium opacity-85">{today} · {localTime}</p>
            <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">{greeting}</h1>
            <p className="mt-2 text-[17px] opacity-90">
              {welcome ? `${tenantName} is live. A few quick steps and you're ready for your first booking.` : `Here's where ${tenantName} stands.`}
            </p>
            {next?.href && canManageSettings && (
              <Link href={next.href} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 font-semibold text-[#141822] shadow-lg transition-transform hover:-translate-y-0.5">
                <Sparkles aria-hidden className="size-4" /> Next: {next.title} <ArrowRight aria-hidden className="size-4" />
              </Link>
            )}
          </div>
          <div className="rounded-full bg-white/95 p-2 text-[#141822] shadow-lg">
            <ProgressRing value={done / steps.length} label={`Setup ${done} of ${steps.length} done`} size={104} />
          </div>
        </div>
      </Reveal>

      {/* key numbers */}
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4" delay={0.1}>
        {[
          { icon: CalendarCheck2, label: 'Upcoming bookings', value: <AnimatedNumber value={stats.upcoming} /> },
          { icon: CalendarDays, label: 'Events this week', value: <AnimatedNumber value={stats.thisWeek} /> },
          { icon: FileClock, label: 'Open quotes', value: <AnimatedNumber value={stats.quotesOpen} /> },
          { icon: Wallet, label: 'Booked this month', value: <AnimatedNumber value={stats.bookedThisMonthCents / 100} prefix={money.formatToParts(0).find((x) => x.type === 'currency')?.value ?? ''} /> },
        ].map((f) => (
          <StaggerItem key={f.label} className="flex min-w-0 flex-col gap-2 rounded-ui border border-line bg-surface p-4 shadow-card">
            <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
              <span className="grid size-8 place-items-center rounded-ui-sm bg-brand-soft text-brand-text"><f.icon aria-hidden className="size-4" /></span>
              {f.label}
            </span>
            <span className="font-display text-3xl font-bold">{f.value}</span>
          </StaggerItem>
        ))}
      </Stagger>

      {/* coming up */}
      <Reveal delay={0.12} className="rounded-[calc(var(--radius)*1.4)] border border-line bg-surface p-5 shadow-card sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Coming up</h2>
          <Link href={newOrderHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-text hover:underline"><Plus aria-hidden className="size-4" /> New order</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-muted">No bookings yet. Your next events will show here.</p>
        ) : (
          <Stagger as="ul" className="-mx-2 flex flex-col" gap={0.05}>
            {upcoming.map((o) => (
              <StaggerItem as="li" key={o.id}>
                <Link href={o.href} className="flex items-center gap-3 rounded-ui-sm px-2 py-2.5 hover:bg-surface-2">
                  <span className="brand-gradient size-2.5 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.customer} <span className="font-normal text-muted">· {o.items || 'No items'}</span></span>
                    <span className="flex flex-wrap gap-x-3 text-sm text-muted"><span>{o.when}</span>{o.city && <span className="inline-flex items-center gap-1"><MapPin aria-hidden className="size-3" />{o.city}</span>}</span>
                  </span>
                  <span className="font-semibold tabular">{money.format(o.totalCents / 100)}</span>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* checklist */}
        <Reveal delay={0.15} className={cx('rounded-[calc(var(--radius)*1.4)] border border-line bg-surface p-5 shadow-card sm:p-6', setupDone && 'opacity-80')}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Setup checklist</h2>
            <span className="text-sm text-muted tabular">{done} of {steps.length} done</span>
          </div>
          <Stagger as="ul" className="-mx-2 flex flex-col" delay={0.25}>
            {steps.map((s) => {
              const Icon = s.done ? CircleCheck : s.soon ? Clock : CircleDashed;
              const body = (
                <>
                  <motion.span initial={s.done ? { scale: 0 } : false} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.4 }}>
                    <Icon aria-hidden className={cx('mt-0.5 size-5 shrink-0', s.done ? 'text-ok' : 'text-muted')} />
                  </motion.span>
                  <span className="min-w-0 flex-1">
                    <span className={cx('block text-[15px] font-medium', s.done && 'text-muted line-through decoration-ok/50')}>{s.title}</span>
                    <span className="block text-sm text-muted">{s.text}</span>
                  </span>
                  {s.soon ? <Badge>{s.soon}</Badge> : !s.done && canManageSettings && <ArrowRight aria-hidden className="mt-0.5 size-4 text-muted transition-transform group-hover:translate-x-1" />}
                </>
              );
              return (
                <StaggerItem as="li" key={s.title}>
                  {s.href && !s.done && canManageSettings ? (
                    <Link href={s.href} className="group flex items-start gap-3 rounded-ui-sm px-2 py-3 transition-colors hover:bg-surface-2">{body}</Link>
                  ) : (
                    <div className="flex items-start gap-3 px-2 py-3">{body}</div>
                  )}
                </StaggerItem>
              );
            })}
          </Stagger>
        </Reveal>

        {/* locations */}
        <Reveal delay={0.2} className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Locations</h2>
            <span className="text-sm text-muted">{locations.length} ship-from {locations.length === 1 ? 'point' : 'points'}</span>
          </div>
          {locations.map((l) => (
            <motion.div key={l.id} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}>
              <Link href={canManageSettings ? l.href : '#'} className="block overflow-hidden rounded-ui border border-line bg-surface shadow-card">
                <StaticMap lat={l.lat} lng={l.lng} width={340} height={130} className="h-[120px] w-full" label={`Map of ${l.name}`} />
                <div className="flex items-center justify-between gap-2 px-4 py-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-semibold">{l.name} <span className="font-mono text-xs font-normal text-muted">{l.code}</span></span>
                    <span className="block truncate text-sm text-muted">{l.city || 'No address yet'}</span>
                  </span>
                  {l.isPrimary && <Badge tone="brand">Primary</Badge>}
                </div>
              </Link>
            </motion.div>
          ))}
          <p className="flex items-center gap-2 px-1 text-sm text-muted"><Phone aria-hidden className="size-4" /> Main line {facts.phone} · {facts.timezone}</p>
        </Reveal>
      </div>
    </div>
  );
}
