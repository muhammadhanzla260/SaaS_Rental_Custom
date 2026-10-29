import { listCategories, listProducts } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { ProductsView, type ProductCard } from './products-view';

export const metadata = { title: 'Products' };

export default async function ProductsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await pageContext(slug, 'orders.view');
  const [products, categories] = await Promise.all([listProducts(db, ctx.tenant.id, { includeArchived: true }), listCategories(db, ctx.tenant.id)]);
  const cards: ProductCard[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    kind: p.kind,
    status: p.status as ProductCard['status'],
    tracking: p.tracking as ProductCard['tracking'],
    icon: p.icon,
    tint: p.tint,
    categoryId: p.categoryId,
    fromCents: p.fromCents,
    staffedCents: p.priceStaffedCents,
    owned: p.owned,
    outOfService: Object.values(p.inventory).reduce((s, v) => s + v.outOfService, 0),
    units: p.unitCount,
    imageUrl: fileUrl(ctx.tenant.id, p.imageFileId),
  }));
  return (
    <ProductsView
      slug={slug}
      products={cards}
      categories={categories.map((c) => ({ id: c.id, name: c.name, count: c.count }))}
      currency={ctx.tenant.currency}
      canEdit={ctx.can('catalog.manage')}
    />
  );
}
