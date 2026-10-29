import { coachOrders } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { OrdersList } from './orders-list';

export const metadata = { title: 'Orders' };

export default async function CoachOrdersPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ filter?: string }> }) {
  const { tenant: slug } = await params;
  const { filter } = await searchParams;
  const ctx = await getTenantContext(slug);
  const orders = await coachOrders(db, ctx.tenant.id, ctx.user.id);
  return (
    <OrdersList
      slug={slug}
      currency={ctx.tenant.currency}
      initialFilter={filter ?? 'all'}
      orders={orders.map((o) => ({
        id: o.id, number: o.number, status: o.status, statusLabel: o.statusLabel, workable: o.workable, customerName: o.customerName ?? '',
        startsAt: o.eventStartsAt.toISOString(), endsAt: o.eventEndsAt.toISOString(), timezone: o.timezone, totalCents: o.totalCents, rating: o.rating,
        phases: o.phases, enRoute: o.arrivedAt ? 'Arrived' : o.enRouteAt ? (o.etaMinutes != null && !o.text2At ? `Yes · ${o.etaMinutes} min` : 'Yes') : '—',
        completed: o.completed, role: o.role,
      }))}
    />
  );
}
