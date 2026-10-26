import { actionNeeded, listLocations, OPS_COLUMNS } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { OpsBoard } from './ops-board';

export const metadata = { title: 'Action needed' };

export default async function ActionNeededPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ loc?: string; show?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const locations = (await listLocations(db, ctx.tenant.id)).filter((l) => l.isActive);
  const locationId = locations.some((l) => l.id === sp.loc) ? sp.loc! : 'all';
  const data = await actionNeeded(db, ctx.tenant.id, { locationId: locationId === 'all' ? null : locationId, currency: ctx.tenant.currency });
  return (
    <OpsBoard
      slug={slug}
      columns={OPS_COLUMNS}
      cards={data.cards}
      kpis={data.kpis}
      tomorrow={data.tomorrow}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      locationId={locationId}
      show={sp.show === 'today' ? 'today' : 'all'}
      canAct={ctx.can('orders.create') && !ctx.readOnly}
      canCharge={ctx.can('payments.record') && !ctx.readOnly}
    />
  );
}
