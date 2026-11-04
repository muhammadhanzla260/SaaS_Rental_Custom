import { coachCandidates, orderCoachSummary } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { OrderBuilder } from '../builder/order-builder';
import { loadBuilder } from '../builder/load';
import type { CoachCardData } from '../builder/coach-card';

export const metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const data = await loadBuilder(slug, id);
  const ctx = await getTenantContext(slug);
  let coach: CoachCardData | null = null;
  if (data.order) {
    const [summary, candidates] = await Promise.all([orderCoachSummary(db, ctx.tenant.id, id), coachCandidates(db, ctx.tenant.id)]);
    coach = JSON.parse(JSON.stringify({ ...summary, checklist: { ...summary.checklist, phases: summary.checklist.phases.map((p) => p.percent) }, candidates }));
  }
  // Remount on each saved version so the editor starts from what the server stored.
  return <OrderBuilder key={`${id}-${data.order?.version}`} data={data} coach={coach} />;
}
