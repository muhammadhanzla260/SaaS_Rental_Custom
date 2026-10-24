import { notFound, redirect } from 'next/navigation';
import { getProduct, listCategories, listLocations } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { ProductForm } from '../product-form';

export const metadata = { title: 'Product' };

const dollars = (c: number | null) => (c == null ? null : c / 100);

export default async function ProductPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { tenant, prefs, role } = await getTenantContext(slug);
  if (!['owner', 'admin', 'manager'].includes(role)) redirect(`/${slug}/catalog`);
  const isNew = id === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [product, categories, locations] = await Promise.all([
    isNew ? null : getProduct(db, tenant.id, id),
    listCategories(db, tenant.id),
    listLocations(db, tenant.id),
  ]);
  if (!isNew && !product) notFound();

  const initial = product
    ? {
        name: product.name, kind: product.kind, categoryId: product.categoryId, sku: product.sku ?? '', description: product.description ?? '',
        status: product.status, priceStaffed: dollars(product.priceStaffedCents), pricePickup: dollars(product.pricePickupCents),
        priceDropoff: dollars(product.priceDropoffCents), baseHours: product.baseHours, hourlyRate: dollars(product.hourlyRateCents),
        minHours: product.minHours, overtimeBlockMinutes: product.overtimeBlockMinutes, overtimeBlockPrice: dollars(product.overtimeBlockCents),
        turnaroundMinutes: product.turnaroundMinutes, taxable: product.taxable,
        inventory: Object.fromEntries(locations.map((l) => [l.id, product.inventory[l.id] ?? 0])),
      }
    : {
        name: '', kind: 'rental', categoryId: null, sku: '', description: '', status: 'active', priceStaffed: null, pricePickup: null,
        priceDropoff: null, baseHours: 4, hourlyRate: null, minHours: null, overtimeBlockMinutes: 15, overtimeBlockPrice: 25,
        turnaroundMinutes: null, taxable: true, inventory: Object.fromEntries(locations.map((l) => [l.id, l.isPrimary ? 1 : 0])),
      };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold sm:text-[28px]">{product?.name ?? 'New product'}</h1>
      <ProductForm
        key={product?.updatedAt.toISOString() ?? 'new'}
        slug={slug}
        id={product?.id ?? null}
        initial={initial}
        imageUrl={product ? fileUrl(tenant.id, product.imageFileId) : null}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
        currency={tenant.currency}
        defaultTurnaround={prefs.booking.cleanupBufferMinutes}
      />
    </>
  );
}
