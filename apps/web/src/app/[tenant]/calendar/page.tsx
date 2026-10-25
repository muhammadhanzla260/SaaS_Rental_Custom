import { addDays, calendarDayCounts, formatMoney, quoteFollowUps, utcToWallTime, wallTimeToUtc } from '@rental/core';
import { listLocations, listOrders, listProducts } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { CalendarView, type CalOrder, type CalRow } from './calendar-view';
import { MonthView, type MonthOrder } from './month-view';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ date?: string; view?: string; loc?: string; item?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const locations = (await listLocations(db, ctx.tenant.id)).filter((l) => l.isActive);
  const location = locations.find((l) => l.id === sp.loc) ?? locations.find((l) => l.isPrimary) ?? locations[0];
  const tz = location?.timezone || ctx.tenant.timezone;
  const today = utcToWallTime(new Date(), tz).date;
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  // Month (Odoo's count view) by default; week and day show equipment lanes.
  const view = sp.view === 'day' ? 'day' : sp.view === 'week' ? 'week' : 'month';
  if (view === 'month') return monthPage(slug, ctx, locations, sp.loc === 'all' ? 'all' : location?.id ?? 'all', anchor, today);

  // Week starts on the workspace's chosen day.
  const weekStart = (() => {
    const dow = new Date(`${anchor}T12:00:00Z`).getUTCDay();
    const first = ctx.prefs.formats.weekStartsOn === 'monday' ? 1 : 0;
    return addDays(anchor, -((dow - first + 7) % 7));
  })();
  const days = view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const from = wallTimeToUtc(days[0]!, '00:00', tz);
  const to = wallTimeToUtc(addDays(days[days.length - 1]!, 1), '00:00', tz);

  if (!location) {
    return <CalendarView slug={slug} empty view={view} anchor={anchor} today={today} days={days} tz={tz} rows={[]} orders={[]} locations={[]} locationId="" products={[]} itemId="" currency={ctx.tenant.currency} cleanupMinutes={0} canCreate={false} />;
  }

  const [orders, products] = await Promise.all([
    listOrders(db, ctx.tenant.id, { status: 'all', locationId: location.id, from: new Date(from.getTime() - 3 * 86_400_000), to, limit: 1000 }),
    listProducts(db, ctx.tenant.id),
  ]);
  const cleanup = ctx.prefs.booking.cleanupBufferMinutes;
  const turnaround = new Map(products.map((p) => [p.id, p.turnaroundMinutes ?? cleanup]));
  const shown = orders.filter((o) => (o.status === 'booked' || o.status === 'quote_sent' || o.status === 'completed') && o.lineItems.some((l) => l.productId));
  const calOrders: CalOrder[] = shown.map((o) => ({
    id: o.id, number: o.number, status: o.status, customerName: o.customerName, startsAt: o.eventStartsAt.toISOString(), endsAt: o.eventEndsAt.toISOString(),
    address: [o.eventLocationName, o.eventLine1, o.eventCity].filter(Boolean).join(' · '), miles: o.eventMiles, items: o.items, totalCents: o.totalCents,
    paidCents: o.paidCents, depositDueCents: o.depositDueCents, unpaidReason: o.unpaidReason,
    lines: o.lineItems.filter((l) => l.productId).map((l) => ({ productId: l.productId!, quantity: l.quantity, blockedMinutes: turnaround.get(l.productId!) ?? cleanup })),
  }));

  // One row per unit: serialized units by label, pooled stock as "unit 1 of 2". Extra lanes appear when quotes overlap.
  const tracked = products.filter((p) => p.status === 'active' && p.tracking !== 'none' && (p.kind === 'rental' || p.kind === 'addon'));
  const rows: CalRow[] = tracked
    .map((p) => {
      const owned = p.inventory[location.id]?.owned ?? (p.tracking === 'pooled' ? 1 : 0);
      return { productId: p.id, name: p.name, icon: p.icon, tint: p.tint, kind: p.kind, owned, tracking: p.tracking };
    })
    .filter((r) => r.owned > 0 || calOrders.some((o) => o.lines.some((l) => l.productId === r.productId)));

  return (
    <CalendarView
      slug={slug}
      view={view}
      anchor={anchor}
      today={today}
      days={days}
      tz={tz}
      rows={rows}
      orders={calOrders}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      locationId={location.id}
      products={rows.map((r) => ({ id: r.productId, name: r.name }))}
      itemId={rows.some((r) => r.productId === sp.item) ? sp.item! : ''}
      currency={ctx.tenant.currency}
      cleanupMinutes={cleanup}
      canCreate={ctx.can('orders.create')}
    />
  );
}

type Ctx = Awaited<ReturnType<typeof pageContext>>;
type Loc = Awaited<ReturnType<typeof listLocations>>[number];

/** ISO week number of a yyyy-mm-dd day. */
function isoWeek(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** Month grid with Odoo's per-day counts, the legend and quote follow-ups. */
async function monthPage(slug: string, ctx: Ctx, locations: Loc[], locationId: string, anchor: string, today: string) {
  const first = `${anchor.slice(0, 7)}-01`;
  const startsMonday = ctx.prefs.formats.weekStartsOn === 'monday';
  const dow = new Date(`${first}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -((dow - (startsMonday ? 1 : 0) + 7) % 7));
  const nextMonth = (() => { const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();
  const prevMonth = (() => { const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
  const weeksCount = Math.ceil(((Date.parse(nextMonth) - Date.parse(gridStart)) / 86_400_000) / 7);
  const days = Array.from({ length: weeksCount * 7 }, (_, i) => addDays(gridStart, i));
  const gridEnd = addDays(days.at(-1)!, 1);

  const zone = new Map(locations.map((l) => [l.id, l.timezone || ctx.tenant.timezone]));
  const loc = locationId === 'all' ? undefined : locationId;
  const [inRange, open] = await Promise.all([
    // A day of slack each side: an event's local day can differ from its UTC day.
    listOrders(db, ctx.tenant.id, { status: 'all', locationId: loc, from: wallTimeToUtc(addDays(gridStart, -1), '00:00', ctx.tenant.timezone), to: wallTimeToUtc(addDays(gridEnd, 1), '00:00', ctx.tenant.timezone), limit: 5000 }),
    listOrders(db, ctx.tenant.id, { status: 'quotes', locationId: loc, limit: 2000 }),
  ]);
  const tzOf = (id: string) => zone.get(id) ?? ctx.tenant.timezone;
  const counts = calendarDayCounts(inRange.map((o) => ({ id: o.id, status: o.status, startsAt: o.eventStartsAt, endsAt: o.eventEndsAt, timeZone: tzOf(o.locationId) })));
  const money = (c: number) => formatMoney(c, ctx.tenant.currency);
  const orders: Record<string, MonthOrder> = Object.fromEntries(inRange.map((o) => {
    const z = tzOf(o.locationId);
    const t = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', minute: '2-digit' }).format(d);
    const multi = utcToWallTime(o.eventStartsAt, z).date !== utcToWallTime(o.eventEndsAt, z).date;
    const end = multi ? new Intl.DateTimeFormat('en-US', { timeZone: z, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(o.eventEndsAt) : t(o.eventEndsAt);
    return [o.id, { id: o.id, number: o.number, status: o.status, customerName: o.customerName, when: `${t(o.eventStartsAt)} – ${end}`, items: o.items, location: o.locationName, total: money(o.totalCents) }];
  }));
  const followUps = quoteFollowUps(open.map((o) => ({
    id: o.id, status: o.status, startsAt: o.eventStartsAt, timeZone: tzOf(o.locationId), sentAt: o.quoteSentAt ?? o.createdAt, label: o.customerName || o.number,
  })));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(`${days[i]}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }));
  const weeks = Array.from({ length: weeksCount }, (_, w) => ({
    number: isoWeek(days[w * 7]!),
    days: days.slice(w * 7, w * 7 + 7).map((d) => ({ date: d, inMonth: d.slice(0, 7) === first.slice(0, 7) })),
  }));
  return (
    <MonthView
      slug={slug}
      month={{ date: first, title: new Date(`${first}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }), prev: prevMonth, next: nextMonth }}
      today={today}
      weeks={weeks}
      counts={counts}
      orders={orders}
      followUps={followUps}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      locationId={locationId}
      weekdays={weekdays}
      canCreate={ctx.can('orders.create')}
    />
  );
}
