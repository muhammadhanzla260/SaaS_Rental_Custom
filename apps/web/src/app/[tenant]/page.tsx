import { listLocations, listOrders, listProducts, listTeam, orderStats } from '@rental/db';
import { formatEventTime, formatPhone } from '@rental/core';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { DashboardView } from './dashboard-view';

export const metadata = { title: 'Dashboard' };

export default async function Dashboard({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { tenant: slug } = await params;
  const { welcome } = await searchParams;
  const { tenant, prefs, canManageSettings, user } = await getTenantContext(slug);
  const [locs, team, products, stats, upcoming] = await Promise.all([
    listLocations(db, tenant.id),
    listTeam(db, tenant.id),
    listProducts(db, tenant.id),
    orderStats(db, tenant.id, tenant.timezone),
    listOrders(db, tenant.id, { status: 'booked', from: new Date(), limit: 6 }),
  ]);
  const base = `/${slug}/settings`;

  const steps = [
    { done: products.length > 0, title: 'Add your first product', text: 'Photos, staffed, pick-up and drop-off prices, and how many you own.', href: `/${slug}/catalog/new` },
    { done: stats.upcoming > 0 || stats.bookedThisMonthCents > 0, title: 'Take your first booking', text: 'Customer, time, address and items: the price works itself out.', href: `/${slug}/orders/new` },
    { done: !!(tenant.email && tenant.phone && tenant.line1), title: 'Complete your business profile', text: 'Email, phone and address appear on quotes and invoices.', href: `${base}/general` },
    { done: !!tenant.logoFileId, title: 'Upload your logo', text: 'Shown in the app, on emails, quotes and invoices.', href: `${base}/branding` },
    { done: locs.length > 0 && locs.every((l) => l.lat != null && l.lng != null), title: 'Pin every location on the map', text: 'Delivery distance and travel fees are measured from these points.', href: `${base}/locations` },
    { done: team.members.length > 1 || team.invites.length > 0, title: 'Invite your team', text: 'Add sales staff, managers and crew.', href: `${base}/team` },
    { done: false, soon: 'Phase 2', title: 'Connect your email server', text: 'Quotes, invoices and reminders go out from your own address.' },
    { done: false, soon: 'Phase 2', title: 'Connect Stripe', text: 'Take deposits and card payments online.' },
  ];

  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tenant.timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const localTime = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, hour: 'numeric', minute: '2-digit' }).format(now);

  return (
    <DashboardView
      welcome={!!welcome}
      greeting={`${greeting}, ${user.name.split(' ')[0]}`}
      today={today}
      localTime={localTime}
      tenantName={tenant.name}
      canManageSettings={canManageSettings}
      steps={steps}
      stats={stats}
      currency={tenant.currency}
      upcoming={upcoming.map((o) => ({
        id: o.id, href: `/${slug}/orders/${o.id}`, customer: o.customerName, items: o.items, when: formatEventTime(o.eventStartsAt, o.eventEndsAt, tenant.timezone),
        totalCents: o.totalCents, city: o.eventCity,
      }))}
      newOrderHref={`/${slug}/orders/new`}
      facts={{
        timezone: tenant.timezone.replace(/_/g, ' '),
        currency: tenant.currency,
        phone: formatPhone(tenant.phone, tenant.country) || 'Not set',
        deposit: prefs.booking.depositPercent,
        team: team.members.length,
      }}
      locations={locs.map((l) => ({
        id: l.id, name: l.name, code: l.code, city: [l.line1, l.city].filter(Boolean).join(', '), lat: l.lat, lng: l.lng, isPrimary: l.isPrimary,
        href: `${base}/locations/${l.id}`,
      }))}
    />
  );
}
