import { notFound } from 'next/navigation';
import { getProduct, listCategories, listLocations, listProducts } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { ProductEditor, type EditorProduct } from './product-editor';

export const metadata = { title: 'Product' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductPage({ params, searchParams }: { params: Promise<{ tenant: string; id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { tenant: slug, id } = await params;
  const { tab } = await searchParams;
  const ctx = await pageContext(slug, 'orders.view');
  const isNew = id === 'new';
  if (!isNew && !UUID.test(id)) notFound();
  const [product, categories, locations, all] = await Promise.all([
    isNew ? Promise.resolve(null) : getProduct(db, ctx.tenant.id, id),
    listCategories(db, ctx.tenant.id),
    listLocations(db, ctx.tenant.id),
    listProducts(db, ctx.tenant.id),
  ]);
  if (!isNew && !product) notFound();

  const editor: EditorProduct | null = product
    ? {
        id: product.id,
        name: product.name,
        sku: product.sku,
        kind: product.kind,
        status: product.status,
        tracking: product.tracking,
        icon: product.icon,
        tint: product.tint,
        categoryId: product.categoryId,
        description: product.description,
        commissionable: product.commissionable,
        taxable: product.taxable,
        priceStaffedCents: product.priceStaffedCents,
        pricePickupCents: product.pricePickupCents,
        priceDropoffCents: product.priceDropoffCents,
        baseHours: product.baseHours,
        hourlyRateCents: product.hourlyRateCents,
        minHours: product.minHours,
        overtimeBlockMinutes: product.overtimeBlockMinutes,
        overtimeBlockCents: product.overtimeBlockCents,
        turnaroundMinutes: product.turnaroundMinutes,
        suggestedAddonIds: product.suggestedAddonIds,
        inventory: product.inventory,
        locationPrices: product.locationPrices,
        units: product.units.map((u) => ({ id: u.id, label: u.label, serial: u.serial, status: u.status, locationId: u.locationId, notes: u.notes })),
        imageUrl: fileUrl(ctx.tenant.id, product.imageFileId),
      }
    : null;

  return (
    <ProductEditor
      key={product?.id ?? 'new'}
      slug={slug}
      product={editor}
      initialTab={(['details', 'pricing', 'inventory', 'addons'] as const).find((t) => t === tab) ?? (isNew ? 'details' : 'pricing')}
      categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      locations={locations.map((l) => ({ id: l.id, name: l.name, code: l.code }))}
      others={all.filter((p) => p.id !== id && p.status !== 'archived').map((p) => ({ id: p.id, name: p.name, kind: p.kind, icon: p.icon, tint: p.tint, fromCents: p.fromCents }))}
      currency={ctx.tenant.currency}
      defaults={{ cleanupMinutes: ctx.prefs.booking.cleanupBufferMinutes, blockMinutes: ctx.prefs.booking.overtimeBlockMinutes, blockCents: ctx.prefs.booking.overtimeBlockCents }}
      canEdit={ctx.can('catalog.manage')}
    />
  );
}
