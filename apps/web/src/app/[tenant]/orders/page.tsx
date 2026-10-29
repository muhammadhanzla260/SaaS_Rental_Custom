import { listLocations, listOrders, type OrderListFilters } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { OrdersView, type OrderRow } from './orders-view';

export const metadata = { title: 'Orders' };

const VIEWS = ['upcoming', 'quotes', 'unpaid', 'past', 'cancelled', 'all'] as const;
type View = (typeof VIEWS)[number];

export default async function OrdersPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ v?: string; q?: string; loc?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const view: View = (VIEWS as readonly string[]).includes(sp.v ?? '') ? (sp.v as View) : 'upcoming';
  const q = (sp.q ?? '').trim().slice(0, 80);
  const locations = await listLocations(db, ctx.tenant.id);
  const locationId = locations.some((l) => l.id === sp.loc) ? sp.loc : undefined;
  const now = new Date();
  const filters: Record<View, OrderListFilters> = {
    upcoming: { status: 'booked', from: now },
    quotes: { status: 'quotes' },
    unpaid: { unpaid: true },
    past: { status: 'booked', to: now },
    cancelled: { status: 'cancelled' },
    all: { status: 'all' },
  };
  const rows = await listOrders(db, ctx.tenant.id, { ...filters[view], search: q || undefined, locationId, limit: 300 });
  const tzOf = new Map(locations.map((l) => [l.id, l.timezone || ctx.tenant.timezone]));
  const data: OrderRow[] = rows.map((o) => ({
    id: o.id, number: o.number, status: o.status, customerName: o.customerName, startsAt: o.eventStartsAt.toISOString(), endsAt: o.eventEndsAt.toISOString(),
    tz: tzOf.get(o.locationId) ?? ctx.tenant.timezone, items: o.items, locationCode: o.locationCode, city: o.eventCity, totalCents: o.totalCents,
    paidCents: o.paidCents, depositDueCents: o.depositDueCents, unpaidReason: o.unpaidReason,
  }));
  return (
    <OrdersView
      slug={slug}
      rows={data}
      view={view}
      q={q}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      locationId={locationId ?? ''}
      currency={ctx.tenant.currency}
      canCreate={ctx.can('orders.create')}
    />
  );
}
