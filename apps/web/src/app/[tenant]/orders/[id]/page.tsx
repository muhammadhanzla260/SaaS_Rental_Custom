import { OrderBuilder } from '../builder/order-builder';
import { loadBuilder } from '../builder/load';

export const metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const data = await loadBuilder(slug, id);
  // Remount on each saved version so the editor starts from what the server stored.
  return <OrderBuilder key={`${id}-${data.order?.version}`} data={data} />;
}
