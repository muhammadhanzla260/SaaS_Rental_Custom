import { OrderBuilder } from '../builder/order-builder';
import { loadBuilder } from '../builder/load';

export const metadata = { title: 'New order' };

export default async function NewOrderPage({
  params, searchParams,
}: { params: Promise<{ tenant: string }>; searchParams: Promise<{ customer?: string; date?: string; loc?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const data = await loadBuilder(slug, null, { customerId: sp.customer, date: sp.date, locationId: sp.loc });
  return <OrderBuilder key={`new-${sp.customer ?? ''}`} data={data} />;
}
