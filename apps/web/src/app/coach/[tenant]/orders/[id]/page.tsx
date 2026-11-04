import { Lock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { coachOrderDetail, OrgError } from '@rental/db';
import { Card, EmptyState, LinkButton } from '@/components/kit';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { OrderView } from './order-view';

export const metadata = { title: 'Order' };

export default async function CoachOrderPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getTenantContext(slug);
  let detail;
  try {
    detail = await coachOrderDetail(db, ctx.tenant.id, ctx.user.id, id);
  } catch (e) {
    if (e instanceof OrgError && e.code === 'forbidden') {
      return (
        <Card>
          <EmptyState icon={<Lock className="size-6" />} title="Order detail unavailable" sub={e.message} action={<LinkButton href={`/coach/${slug}/orders`} variant="secondary">All orders</LinkButton>} />
        </Card>
      );
    }
    if (e instanceof OrgError) notFound();
    throw e;
  }
  const tz = detail.location?.timezone ?? ctx.tenant.timezone;
  return (
    <OrderView
      slug={slug}
      tz={tz}
      currency={ctx.tenant.currency}
      readOnly={ctx.readOnly}
      setupMapUrl={fileUrl(ctx.tenant.id, detail.order.setupMapFileId)}
      detail={JSON.parse(JSON.stringify(detail))}
      photoBase={`/api/files/${ctx.tenant.id}/`}
    />
  );
}
