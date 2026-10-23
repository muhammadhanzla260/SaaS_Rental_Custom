import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { slugify, toCents, type ProductInput, type ProductPricing } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { inventoryPools, productCategories, products } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';

export type Product = typeof products.$inferSelect;
export type Category = typeof productCategories.$inferSelect;

export function pricingOf(p: Product): ProductPricing {
  return {
    priceStaffedCents: p.priceStaffedCents,
    pricePickupCents: p.pricePickupCents,
    priceDropoffCents: p.priceDropoffCents,
    baseHours: p.baseHours,
    hourlyRateCents: p.hourlyRateCents,
    overtimeBlockMinutes: p.overtimeBlockMinutes,
    overtimeBlockCents: p.overtimeBlockCents,
  };
}

async function uniqueSlug(tx: Tx, table: typeof products | typeof productCategories, base: string, exceptId?: string) {
  const root = slugify(base) || 'item';
  for (let i = 1; i < 500; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const where = exceptId ? and(eq(table.slug, slug), ne(table.id, exceptId)) : eq(table.slug, slug);
    const clash = await tx.select({ id: table.id }).from(table).where(where).limit(1);
    if (!clash.length) return slug;
  }
  throw new OrgError('Could not create a unique web name.', 'invalid');
}

// --- categories -------------------------------------------------------------------------

export function listCategories(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) => tx.select().from(productCategories).orderBy(asc(productCategories.sort), asc(productCategories.name)));
}

export function createCategory(db: Db, tenantId: string, actor: Actor, name: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.insert(productCategories).values({ tenantId, name, slug: await uniqueSlug(tx, productCategories, name) }).returning();
    await audit(tx, tenantId, actor, { type: 'category', id: c!.id }, 'category.created', { name });
    return c!;
  });
}

export function renameCategory(db: Db, tenantId: string, actor: Actor, id: string, name: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.update(productCategories).set({ name }).where(eq(productCategories.id, id)).returning();
    if (!c) throw new OrgError('Category not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'category', id }, 'category.updated', { name });
    return c;
  });
}

export function deleteCategory(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.delete(productCategories).where(eq(productCategories.id, id)).returning();
    if (!c) throw new OrgError('Category not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'category', id }, 'category.deleted', { name: c.name });
  });
}

// --- products ------------------------------------------------------------------------------

const productValues = (input: ProductInput) => ({
  name: input.name,
  kind: input.kind,
  categoryId: input.categoryId ?? null,
  sku: input.sku ?? null,
  description: input.description ?? null,
  status: input.status,
  priceStaffedCents: toCents(input.priceStaffed),
  pricePickupCents: input.pricePickup == null ? null : toCents(input.pricePickup),
  priceDropoffCents: input.priceDropoff == null ? null : toCents(input.priceDropoff),
  baseHours: input.baseHours,
  hourlyRateCents: input.hourlyRate == null ? null : toCents(input.hourlyRate),
  minHours: input.minHours,
  overtimeBlockMinutes: input.overtimeBlockMinutes,
  overtimeBlockCents: toCents(input.overtimeBlockPrice),
  turnaroundMinutes: input.turnaroundMinutes,
  taxable: input.taxable,
});

async function saveInventory(tx: Tx, tenantId: string, productId: string, inventory: Record<string, number>) {
  for (const [locationId, qty] of Object.entries(inventory)) {
    await tx
      .insert(inventoryPools)
      .values({ tenantId, productId, locationId, quantityOwned: qty })
      .onConflictDoUpdate({ target: [inventoryPools.tenantId, inventoryPools.productId, inventoryPools.locationId], set: { quantityOwned: qty } });
  }
}

export function listProducts(db: Db, tenantId: string, opts: { includeArchived?: boolean } = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(products)
      .where(opts.includeArchived ? undefined : ne(products.status, 'archived'))
      .orderBy(asc(products.sort), asc(products.name));
    const pools = await tx.select().from(inventoryPools);
    return rows.map((p) => ({
      ...p,
      inventory: Object.fromEntries(pools.filter((x) => x.productId === p.id).map((x) => [x.locationId, x.quantityOwned])) as Record<string, number>,
    }));
  });
}

export function getProduct(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx.select().from(products).where(eq(products.id, id)).limit(1);
    if (!p) return null;
    const pools = await tx.select().from(inventoryPools).where(eq(inventoryPools.productId, id));
    return { ...p, inventory: Object.fromEntries(pools.map((x) => [x.locationId, x.quantityOwned])) as Record<string, number> };
  });
}

export function createProduct(db: Db, tenantId: string, actor: Actor, input: ProductInput, imageFileId?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({ tenantId, ...productValues(input), slug: await uniqueSlug(tx, products, input.name), imageFileId: imageFileId ?? null })
      .returning();
    await saveInventory(tx, tenantId, p!.id, input.inventory);
    await audit(tx, tenantId, actor, { type: 'product', id: p!.id }, 'product.created', { name: p!.name });
    return p!;
  });
}

export function updateProduct(db: Db, tenantId: string, actor: Actor, id: string, input: ProductInput, image?: { fileId: string | null } | null) {
  return withTenant(db, tenantId, async (tx) => {
    const values = { ...productValues(input), ...(image ? { imageFileId: image.fileId } : {}) };
    const [p] = await tx.update(products).set(values).where(eq(products.id, id)).returning();
    if (!p) throw new OrgError('Product not found.', 'not_found');
    await saveInventory(tx, tenantId, id, input.inventory);
    await audit(tx, tenantId, actor, { type: 'product', id }, 'product.updated', { name: p.name });
    return p;
  });
}

/** Free quantity of each active product at a location for a time window (booked orders only). */
export async function productAvailability(db: Db, tenantId: string, locationId: string, from: Date, to: Date, excludeOrderId?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.execute<{ product_id: string; owned: number; held: number }>(
      sql`select * from app_availability(${locationId}::uuid, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, ${excludeOrderId ?? null}::uuid)`,
    );
    return Object.fromEntries([...rows].map((r) => [r.product_id, { owned: r.owned, held: r.held, free: Math.max(0, r.owned - r.held) }])) as Record<
      string,
      { owned: number; held: number; free: number }
    >;
  });
}
