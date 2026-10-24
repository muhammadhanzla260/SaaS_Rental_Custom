import { listCategories, listLocations, listProducts } from '@rental/db';
import { PageHeader } from '@/components/ui';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { CatalogView } from './catalog-view';

export const metadata = { title: 'Catalog' };

export default async function CatalogPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, role } = await getTenantContext(slug);
  const [products, categories, locations] = await Promise.all([
    listProducts(db, tenant.id, { includeArchived: true }),
    listCategories(db, tenant.id),
    listLocations(db, tenant.id),
  ]);
  return (
    <>
      <PageHeader title="Catalog" description="Everything you rent: prices for staffed, pick-up and drop-off, included hours and how many you own." />
      <CatalogView
        slug={slug}
        currency={tenant.currency}
        canEdit={['owner', 'admin', 'manager'].includes(role)}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        locationCount={locations.length}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          status: p.status,
          categoryId: p.categoryId,
          imageUrl: fileUrl(tenant.id, p.imageFileId),
          priceStaffedCents: p.priceStaffedCents,
          pricePickupCents: p.pricePickupCents,
          baseHours: p.baseHours,
          owned: Object.values(p.inventory).reduce((a, b) => a + b, 0) || 1,
        }))}
      />
    </>
  );
}
