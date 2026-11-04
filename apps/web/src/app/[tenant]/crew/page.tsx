import { coachBoard, listLocations } from '@rental/db';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { CrewBoard } from './crew-board';

export const metadata = { title: 'Coaches & crew' };

export default async function CrewPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { tenant: slug } = await params;
  const { tab } = await searchParams;
  const ctx = await pageContext(slug, 'coach.manage');
  const [board, locations] = await Promise.all([
    coachBoard(db, ctx.tenant.id, { timeZone: ctx.tenant.timezone }),
    listLocations(db, ctx.tenant.id),
  ]);
  return (
    <CrewBoard
      slug={slug}
      tz={ctx.tenant.timezone}
      currency={ctx.tenant.currency}
      tenantId={ctx.tenant.id}
      canAct={ctx.can('coach.manage')}
      initialTab={tab === 'checklists' || tab === 'roster' ? tab : 'live'}
      board={JSON.parse(JSON.stringify(board))}
      warehouses={locations.filter((l) => l.isActive && l.lat != null && l.lng != null).map((l) => ({ id: l.id, name: l.name, lat: l.lat!, lng: l.lng! }))}
    />
  );
}
