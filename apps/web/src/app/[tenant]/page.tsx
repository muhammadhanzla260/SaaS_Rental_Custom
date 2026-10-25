import Link from 'next/link';
import { ArrowRight, CalendarDays, Plus } from 'lucide-react';
import { formatEventTime, parseLocationSettings } from '@rental/core';
import { getIntegrations, listLocations, listOrders, listProducts, listTeam, orderStats } from '@rental/db';
import { Card, Kpi, LinkButton, Progress, Ring } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { LiveClock, SetupItem } from './home-client';

export const metadata = { title: 'Home' };

export default async function Home({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  const { tenant, prefs, user } = ctx;
  const [locs, team, products, integrations, stats, upcoming] = await Promise.all([
    listLocations(db, tenant.id),
    listTeam(db, tenant.id),
    listProducts(db, tenant.id),
    getIntegrations(db, tenant.id),
    orderStats(db, tenant.id, tenant.timezone),
    listOrders(db, tenant.id, { status: 'booked', from: new Date(), limit: 5 }),
  ]);
  const base = `/${slug}/settings`;
  const manual = new Set(prefs.setupDone);
  const active = locs.filter((l) => l.isActive);

  const items = [
    { id: 'locations', title: 'Add your locations', text: 'Timezone, address, free travel miles and service area for each branch.', auto: active.length > 0 && active.every((l) => l.lat != null), cta: 'Manage', href: `${base}/locations` },
    { id: 'tax', title: 'Set sales tax per location', text: 'Each branch gets a default rate. Staff can override per order with permission.', auto: active.length > 0 && active.every((l) => Number(l.taxRate?.rate ?? 0) > 0), cta: 'Set tax', href: `${base}/locations?tab=tax` },
    { id: 'team', title: 'Invite your team', text: 'Give each person a role and the branches they work at.', auto: team.members.length > 1 || team.invites.length > 0, cta: 'Invite', href: `${base}/team` },
    { id: 'email', title: 'Connect email sending', text: 'Quotes, invoices and reminders go out from your own mail server.', auto: integrations.orgMail?.mode === 'smtp' || integrations.mail.some((m) => m.locationId), cta: 'Connect', href: `${base}/workspace?tab=connect` },
    { id: 'numbers', title: 'Choose document numbers', text: 'Order and invoice prefixes, like Q-AUS-01042 and INV-2026-0001.', auto: false, cta: 'Choose', href: `${base}/locations?tab=tax` },
    { id: 'rules', title: 'Review rental rules', text: 'Deposit, cleanup buffer, overtime, damage waiver and surface fees.', auto: false, cta: 'Review', href: `${base}/workspace?tab=rules` },
    { id: 'products', title: 'Add products and prices', text: 'Catalog, price rules and inventory for what you rent.', auto: products.length > 0, cta: 'Add', href: `/${slug}/products/new` },
  ].map((i) => ({ ...i, done: i.auto || manual.has(i.id) }));
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  const ready = done === items.length;
  const canEdit = ctx.canManageSettings;
  const money = new Intl.NumberFormat(tenant.locale, { style: 'currency', currency: tenant.currency, maximumFractionDigits: 0 });

  const unlocks = [
    { tag: 'P1', title: 'Catalog, customers, booking', sub: 'Products, price rules, inventory, order builder, calendar' },
    { tag: 'P2', title: 'Quotes, deposits, payments', sub: 'Quote link, signature, 30% deposit, invoices, receipts' },
    { tag: 'P3', title: 'Operations', sub: 'Reminders, auto-charge, cancellations, reports' },
    { tag: 'P4', title: 'Growth', sub: 'Lead pipeline, website forms, coach app' },
  ];

  return (
    <>
      <Topbar
        crumbs={[{ label: tenant.name, href: `/${slug}` }, { label: 'Home' }]}
        actions={ctx.can('orders.create') ? <LinkButton href={`/${slug}/orders/new`} icon={<Plus className="size-4" />}><span className="max-sm:hidden">New order</span><span className="sm:hidden">New</span></LinkButton> : undefined}
      />
      <PageBody wide>
        {!tenant.onboardedAt && canEdit && (
          <Link href={`/onboarding/${slug}`} className="anim-rise mb-5 flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-accent/30 bg-accent-soft/40 px-5 py-4 text-sm">
            <span><strong className="text-fg">Finish setting up {tenant.name}.</strong> <span className="text-fg-2">Pick up where you left off.</span></span>
            <ArrowRight className="size-4 text-accent-text" />
          </Link>
        )}

        <section className="ink-grid anim-rise relative mb-8 overflow-hidden rounded-[var(--radius-panel)] px-6 py-7 text-white sm:px-10 sm:py-9">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-10">
            <Ring value={pct} size={128} stroke={11} label={`${pct}% ready`}>
              <span className="mono text-[28px] font-bold leading-none">{pct}%</span>
              <span className="mt-1 block text-xs text-[#A3ABB9]">ready</span>
            </Ring>
            <div className="min-w-0">
              <h1 className="font-display text-[30px] font-extrabold leading-[1.02] tracking-[-0.025em] sm:text-[44px]">
                {ready ? `Good to go, ${user.name.split(' ')[0]}` : `Get ${tenant.name} ready to take bookings`}
              </h1>
              <p className="mt-3 text-base text-[#A3ABB9] sm:text-lg">
                {ready
                  ? `${stats.upcoming} upcoming booking${stats.upcoming === 1 ? '' : 's'} · ${stats.quotesOpen} open quote${stats.quotesOpen === 1 ? '' : 's'}.`
                  : `${done} of ${items.length} setup steps done. Finish these and your team can start building orders.`}
              </p>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-8">
            {!ready && (
              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <h2 className="font-sans text-xl font-bold text-fg">Setup</h2>
                  {canEdit && <p className="text-[13px] text-fg-2">Click a circle to mark it done</p>}
                </div>
                <ol className="flex flex-col gap-3">
                  {items.map((i, n) => (
                    <SetupItem key={i.id} slug={slug} id={i.id} title={i.title} text={i.text} done={i.done} auto={i.auto} cta={i.cta} href={i.href} editable={canEdit && !i.auto} delay={n * 50} />
                  ))}
                </ol>
              </section>
            )}

            <section>
              <div className="mb-3 flex items-end justify-between gap-3">
                <h2 className="font-sans text-xl font-bold text-fg">Bookings</h2>
                <Link href={`/${slug}/calendar`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-text hover:underline"><CalendarDays className="size-4" />Open calendar</Link>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Upcoming" value={stats.upcoming} sub="Booked events ahead" />
                <Kpi label="This week" value={stats.thisWeek} sub="Events in the next 7 days" style={{ ['--d' as string]: '40ms' }} />
                <Kpi label="Open quotes" value={stats.quotesOpen} tone="info" sub="Sent, holding nothing" style={{ ['--d' as string]: '80ms' }} />
                <Kpi label="Booked this month" value={money.format(stats.bookedThisMonthCents / 100)} tone="success" sub="By event date" style={{ ['--d' as string]: '120ms' }} />
              </div>
              <Card className="overflow-hidden">
                {upcoming.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-fg-2">
                    No upcoming bookings yet.
                    {ctx.can('orders.create') && <> <Link href={`/${slug}/orders/new`} className="font-semibold text-accent-text underline">Create an order</Link>.</>}
                  </p>
                ) : (
                  <ul className="divide-y divide-subtle">
                    {upcoming.map((o) => (
                      <li key={o.id}>
                        <Link href={`/${slug}/orders/${o.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-hover">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold text-fg">{o.customerName}</span>
                            <span className="block truncate text-[13px] text-fg-2">{formatEventTime(o.eventStartsAt, o.eventEndsAt, tenant.timezone)}{o.eventCity ? ` · ${o.eventCity}` : ''} · {o.items}</span>
                          </span>
                          <span className="mono shrink-0 font-semibold text-fg">{money.format(o.totalCents / 100)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </section>
          </div>

          <aside className="flex flex-col gap-6">
            <Card className="anim-rise p-5" style={{ ['--d' as string]: '100ms' }}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-sans text-lg font-bold text-fg">Locations</h2>
                {canEdit && <Link href={`${base}/locations`} className="text-[13px] font-semibold text-accent-text underline">Manage</Link>}
              </div>
              <ul className="flex flex-col gap-4">
                {locs.length === 0 && <li className="text-sm text-fg-2">No locations yet.</li>}
                {locs.map((l) => {
                  const color = parseLocationSettings(l.settings).pillColor;
                  const ink = color.toUpperCase() === '#0B0D12';
                  return (
                    <li key={l.id} className="flex items-center gap-3">
                      <span className="mono grid h-10 min-w-12 place-items-center rounded-[10px] px-1.5 text-xs font-bold" style={{ background: ink ? '#0B0D12' : `${color}22`, color: ink ? '#D4FF3A' : color }}>{l.code}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-fg">{l.name}</span>
                        <span className="block truncate text-xs text-fg-2">{l.timezone.replace(/_/g, ' ')}</span>
                      </span>
                      <LiveClock tz={l.timezone} />
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card className="anim-rise p-5" style={{ ['--d' as string]: '160ms' }}>
              <h2 className="font-sans text-lg font-bold text-fg">What unlocks next</h2>
              <Progress value={25} className="my-4" label="Product rollout" />
              <ol className="flex flex-col gap-4">
                {unlocks.map((u, i) => (
                  <li key={u.tag} className="flex gap-3">
                    <span className={`mono grid h-7 min-w-9 place-items-center rounded-md text-[11px] font-bold ${i === 0 ? 'bg-night text-volt' : 'bg-sunken text-fg-2'}`}>{u.tag}</span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">{u.title}</span>
                      <span className="block text-[13px] text-fg-2">{u.sub}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
