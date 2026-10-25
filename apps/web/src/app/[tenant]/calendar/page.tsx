import { addDays, utcToWallTime, wallTimeToUtc } from '@rental/core';
import { listLocations, listOrders, listProducts } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { CalendarView, type CalOrder, type CalRow } from './calendar-view';

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
  const view = sp.view === 'day' ? 'day' : 'week';

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
