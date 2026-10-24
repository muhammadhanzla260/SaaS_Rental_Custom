import { and, asc, eq, gte, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { slugify, toCents, type ProductInput, type ProductPricing, type ServiceMode, type UnitInput, type UnitStatus } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { inventoryPools, inventoryUnits, orders, productCategories, productLocationPrices, products, reservations } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';

export type Product = typeof products.$inferSelect;
export type Category = typeof productCategories.$inferSelect;
export type InventoryUnit = typeof inventoryUnits.$inferSelect;
export type Pool = { owned: number; outOfService: number; allowOverbooking: boolean };
export type LocationPrice = { locationId: string; mode: ServiceMode; priceCents: number };

/**
 * The engine's view of a product. A branch price (if any) replaces the base
 * price for that service mode; included time and overtime stay the product's.
 */
export function pricingOf(p: Product, locationPrices: LocationPrice[] = [], locationId?: string | null): ProductPricing {
  const own = (mode: ServiceMode) => (locationId ? locationPrices.find((r) => r.locationId === locationId && r.mode === mode)?.priceCents : undefined);
  return {
    priceStaffedCents: own('staffed') ?? p.priceStaffedCents,
    pricePickupCents: own('pickup') ?? p.pricePickupCents,
    priceDropoffCents: own('dropoff') ?? p.priceDropoffCents,
    baseHours: p.baseHours,
    hourlyRateCents: p.hourlyRateCents,
    overtimeBlockMinutes: p.overtimeBlockMinutes,
    overtimeBlockCents: p.overtimeBlockCents,
  };
}

/** Lowest base price across modes ("from $175.00" on tiles). */
export function fromPriceCents(p: Pick<Product, 'priceStaffedCents' | 'pricePickupCents' | 'priceDropoffCents'>) {
  const prices = [p.priceStaffedCents, p.pricePickupCents, p.priceDropoffCents].filter((v): v is number => v != null && v > 0);
  return prices.length ? Math.min(...prices) : 0;
}

async function uniqueSlug(tx: Tx, tenantId: string, table: typeof products | typeof productCategories, base: string, exceptId?: string) {
  const root = slugify(base) || 'item';
  for (let i = 1; i < 500; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const conds = [eq(table.tenantId, tenantId), eq(table.slug, slug), exceptId ? ne(table.id, exceptId) : undefined];
    const clash = await tx.select({ id: table.id }).from(table).where(and(...conds)).limit(1);
    if (!clash.length) return slug;
  }
  throw new OrgError('Could not create a unique web name.', 'invalid');
}

// --- categories -------------------------------------------------------------------------

export function listCategories(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        category: productCategories,
        count: sql<number>`(select count(*)::int from products p where p.tenant_id = product_categories.tenant_id and p.category_id = product_categories.id and p.status <> 'archived')`,
      })
      .from(productCategories)
      .where(eq(productCategories.tenantId, tenantId))
      .orderBy(asc(productCategories.sort), asc(productCategories.name));
    return rows.map((r) => ({ ...r.category, count: r.count }));
  });
}

export function createCategory(db: Db, tenantId: string, actor: Actor, name: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [max] = await tx
      .select({ sort: sql<number>`coalesce(max(${productCategories.sort}), 0)::int` })
      .from(productCategories)
      .where(eq(productCategories.tenantId, tenantId));
    const [c] = await tx
      .insert(productCategories)
      .values({ tenantId, name, slug: await uniqueSlug(tx, tenantId, productCategories, name), sort: (max?.sort ?? 0) + 1 })
      .returning();
    await audit(tx, tenantId, actor, { type: 'category', id: c!.id }, 'category.created', { name });
    return c!;
  });
}

export function renameCategory(db: Db, tenantId: string, actor: Actor, id: string, name: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .update(productCategories)
      .set({ name })
      .where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.id, id)))
      .returning();
    if (!c) throw new OrgError('Category not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'category', id }, 'category.updated', { name });
    return c;
  });
}

/** Products in a deleted category become uncategorised (they are not deleted). */
export function deleteCategory(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [c] = await tx.delete(productCategories).where(and(eq(productCategories.tenantId, tenantId), eq(productCategories.id, id))).returning();
    if (!c) throw new OrgError('Category not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'category', id }, 'category.deleted', { name: c.name });
  });
}

// --- products ------------------------------------------------------------------------------

const productValues = (input: ProductInput) => ({
  name: input.name,
  kind: input.kind,
  tracking: input.kind === 'service' || input.kind === 'fee' ? 'none' : input.tracking,
  icon: input.icon ?? null,
  tint: input.tint ?? null,
  commissionable: input.commissionable,
  suggestedAddonIds: input.suggestedAddonIds,
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

async function saveStock(tx: Tx, tenantId: string, productId: string, input: ProductInput) {
  for (const [locationId, v] of Object.entries(input.inventory)) {
    const row = { quantityOwned: v.owned, outOfService: Math.min(v.outOfService, v.owned), allowOverbooking: v.allowOverbooking };
    await tx
      .insert(inventoryPools)
      .values({ tenantId, productId, locationId, ...row })
      .onConflictDoUpdate({ target: [inventoryPools.tenantId, inventoryPools.productId, inventoryPools.locationId], set: row });
  }
  await tx.delete(productLocationPrices).where(and(eq(productLocationPrices.tenantId, tenantId), eq(productLocationPrices.productId, productId)));
  if (input.locationPrices.length) {
    await tx
      .insert(productLocationPrices)
      .values(input.locationPrices.map((r) => ({ tenantId, productId, locationId: r.locationId, serviceMode: r.mode, priceCents: toCents(r.price) })));
  }
}

/** Keep only add-on ids that are this tenant's products (and not the product itself). */
async function checkAddons(tx: Tx, tenantId: string, selfId: string | null, ids: string[]) {
  const wanted = [...new Set(ids)].filter((id) => id !== selfId);
  if (!wanted.length) return [];
  const found = await tx.select({ id: products.id }).from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, wanted)));
  const ok = new Set(found.map((f) => f.id));
  return wanted.filter((id) => ok.has(id));
}

type StockRow = { productId: string; locationId: string; quantityOwned: number; outOfService: number; allowOverbooking: boolean };
type PriceRow = { productId: string; locationId: string; serviceMode: string; priceCents: number };
type UnitCount = { productId: string; locationId: string; total: number; held: number };

function withStock<P extends Product>(p: P, pools: StockRow[], prices: PriceRow[], units: UnitCount[]) {
  const inventory: Record<string, Pool> = {};
  for (const x of pools.filter((r) => r.productId === p.id)) {
    inventory[x.locationId] = { owned: x.quantityOwned, outOfService: x.outOfService, allowOverbooking: x.allowOverbooking };
  }
  // Serialized stock is the unit list: owned = units, out of service = units held for repair.
  if (p.tracking === 'serialized') {
    for (const u of units.filter((r) => r.productId === p.id)) {
      inventory[u.locationId] = { owned: u.total, outOfService: u.held, allowOverbooking: inventory[u.locationId]?.allowOverbooking ?? false };
    }
  }
  const locationPrices: LocationPrice[] = prices
    .filter((r) => r.productId === p.id)
    .map((r) => ({ locationId: r.locationId, mode: r.serviceMode as ServiceMode, priceCents: r.priceCents }));
  const owned = Object.values(inventory).reduce((sum, v) => sum + v.owned, 0);
  const unitCount = units.filter((r) => r.productId === p.id).reduce((sum, u) => sum + u.total, 0);
  return { ...p, inventory, locationPrices, owned, unitCount, fromCents: fromPriceCents(p) };
}

async function stockFor(tx: Tx, tenantId: string, productIds?: string[]) {
  const only = (col: typeof inventoryPools.productId | typeof productLocationPrices.productId | typeof inventoryUnits.productId): SQL | undefined =>
    productIds ? inArray(col, productIds) : undefined;
  const [pools, prices, units] = await Promise.all([
    tx.select().from(inventoryPools).where(and(eq(inventoryPools.tenantId, tenantId), only(inventoryPools.productId))),
    tx.select().from(productLocationPrices).where(and(eq(productLocationPrices.tenantId, tenantId), only(productLocationPrices.productId))),
    tx
      .select({
        productId: inventoryUnits.productId,
        locationId: inventoryUnits.locationId,
        total: sql<number>`count(*)::int`,
        held: sql<number>`(count(*) filter (where ${inventoryUnits.status} in ('maintenance','out_of_service')))::int`,
      })
      .from(inventoryUnits)
      .where(and(eq(inventoryUnits.tenantId, tenantId), only(inventoryUnits.productId)))
      .groupBy(inventoryUnits.productId, inventoryUnits.locationId),
  ]);
  return { pools, prices, units };
}

export function listProducts(db: Db, tenantId: string, opts: { includeArchived?: boolean } = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), opts.includeArchived ? undefined : ne(products.status, 'archived')))
      .orderBy(asc(products.sort), asc(products.name));
    const s = await stockFor(tx, tenantId);
    return rows.map((p) => withStock(p, s.pools, s.prices, s.units));
  });
}
export type ProductRow = Awaited<ReturnType<typeof listProducts>>[number];

export function getProduct(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.id, id))).limit(1);
    if (!p) return null;
    const s = await stockFor(tx, tenantId, [id]);
    const units = await tx
      .select()
      .from(inventoryUnits)
      .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.productId, id)))
      .orderBy(asc(inventoryUnits.label));
    return { ...withStock(p, s.pools, s.prices, s.units), units };
  });
}
export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

export function createProduct(db: Db, tenantId: string, actor: Actor, input: ProductInput, imageFileId?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const values = { ...productValues(input), suggestedAddonIds: await checkAddons(tx, tenantId, null, input.suggestedAddonIds) };
    const [p] = await tx
      .insert(products)
      .values({ tenantId, ...values, slug: await uniqueSlug(tx, tenantId, products, input.name), imageFileId: imageFileId ?? null })
      .returning();
    await saveStock(tx, tenantId, p!.id, input);
    await audit(tx, tenantId, actor, { type: 'product', id: p!.id }, 'product.created', { name: p!.name });
    return p!;
  });
}

export function updateProduct(db: Db, tenantId: string, actor: Actor, id: string, input: ProductInput, image?: { fileId: string | null } | null) {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.id, id))).limit(1);
    if (!before) throw new OrgError('Product not found.', 'not_found');
    const values = {
      ...productValues(input),
      suggestedAddonIds: await checkAddons(tx, tenantId, id, input.suggestedAddonIds),
      ...(image ? { imageFileId: image.fileId } : {}),
    };
    const [p] = await tx.update(products).set(values).where(and(eq(products.tenantId, tenantId), eq(products.id, id))).returning();
    await saveStock(tx, tenantId, id, input);
    const keys = ['name', 'status', 'priceStaffedCents', 'pricePickupCents', 'priceDropoffCents', 'baseHours', 'hourlyRateCents', 'tracking'] as const;
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of keys) if (before[k] !== p![k]) changed[k] = { from: before[k], to: p![k] };
    await audit(tx, tenantId, actor, { type: 'product', id }, 'product.updated', { name: p!.name, ...changed });
    return p!;
  });
}

/** Copy a product as a draft: prices, stock settings and add-ons, not its units or photo. */
export function duplicateProduct(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx.select().from(products).where(and(eq(products.tenantId, tenantId), eq(products.id, id))).limit(1);
    if (!p) throw new OrgError('Product not found.', 'not_found');
    const name = `${p.name} (copy)`;
    const { id: _id, createdAt: _c, updatedAt: _u, slug: _s, imageFileId: _i, externalRefs: _e, ...rest } = p;
    const [copy] = await tx
      .insert(products)
      .values({ ...rest, name, sku: p.sku ? `${p.sku}-COPY` : null, status: 'draft', slug: await uniqueSlug(tx, tenantId, products, name) })
      .returning();
    const pools = await tx.select().from(inventoryPools).where(and(eq(inventoryPools.tenantId, tenantId), eq(inventoryPools.productId, id)));
    if (pools.length) await tx.insert(inventoryPools).values(pools.map((r) => ({ ...r, productId: copy!.id })));
    const prices = await tx
      .select()
      .from(productLocationPrices)
      .where(and(eq(productLocationPrices.tenantId, tenantId), eq(productLocationPrices.productId, id)));
    if (prices.length) await tx.insert(productLocationPrices).values(prices.map((r) => ({ ...r, productId: copy!.id })));
    await audit(tx, tenantId, actor, { type: 'product', id: copy!.id }, 'product.duplicated', { from: p.name, name });
    return copy!;
  });
}

export function setProductStatus(db: Db, tenantId: string, actor: Actor, id: string, status: 'active' | 'draft' | 'archived') {
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx.update(products).set({ status }).where(and(eq(products.tenantId, tenantId), eq(products.id, id))).returning();
    if (!p) throw new OrgError('Product not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'product', id }, 'product.status', { name: p.name, status });
    return p;
  });
}

// --- units (serialized stock) ------------------------------------------------------------------

export function addUnit(db: Db, tenantId: string, actor: Actor, input: UnitInput) {
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx
      .select({ name: products.name })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, input.productId)))
      .limit(1);
    if (!p) throw new OrgError('Product not found.', 'not_found');
    const [u] = await tx
      .insert(inventoryUnits)
      .values({ tenantId, productId: input.productId, locationId: input.locationId, label: input.label, serial: input.serial ?? null, notes: input.notes ?? null })
      .returning();
    await audit(tx, tenantId, actor, { type: 'product', id: input.productId }, 'unit.added', { product: p.name, unit: u!.label });
    return u!;
  });
}

export function setUnitStatus(db: Db, tenantId: string, actor: Actor, id: string, status: UnitStatus, notes?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(inventoryUnits).where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, id))).limit(1);
    if (!before) throw new OrgError('Unit not found.', 'not_found');
    const [u] = await tx
      .update(inventoryUnits)
      .set({ status, statusChangedAt: new Date(), ...(notes !== undefined ? { notes } : {}) })
      .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, id)))
      .returning();
    await audit(tx, tenantId, actor, { type: 'product', id: before.productId }, 'unit.status', { unit: before.label, status: { from: before.status, to: status } });
    return u!;
  });
}

export function removeUnit(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [u] = await tx.delete(inventoryUnits).where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, id))).returning();
    if (!u) throw new OrgError('Unit not found.', 'not_found');
    await audit(tx, tenantId, actor, { type: 'product', id: u.productId }, 'unit.removed', { unit: u.label });
  });
}

// --- availability ---------------------------------------------------------------------------------

export type Availability = { owned: number; held: number; free: number; overbook: boolean };

/** Free quantity of each active product at a location for a time window (booked orders only). */
export async function productAvailability(db: Db, tenantId: string, locationId: string, from: Date, to: Date, excludeOrderId?: string | null) {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx.execute<{ product_id: string; owned: number; held: number; overbook: boolean }>(
      sql`select * from app_availability(${locationId}::uuid, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz, ${excludeOrderId ?? null}::uuid)`,
    );
    return Object.fromEntries(
      [...rows].map((r) => [r.product_id, { owned: r.owned, held: r.held, free: Math.max(0, r.owned - r.held), overbook: !!r.overbook }]),
    ) as Record<string, Availability>;
  });
}

/**
 * Inventory screen data for one location: free units at the busiest moment of
 * each day for `days` days from `from` (a local date), units, and upcoming holds.
 */
export function inventoryOverview(db: Db, tenantId: string, locationId: string, from: string, days: number, timezone: string) {
  return withTenant(db, tenantId, async (tx) => {
    const daily = await tx.execute<{ product_id: string; day: string; owned: number; held: number }>(
      sql`select product_id, day::text as day, owned, held from app_daily_availability(${locationId}::uuid, ${from}::date, ${days}::int, ${timezone})`,
    );
    const units = await tx
      .select({ unit: inventoryUnits, productName: products.name })
      .from(inventoryUnits)
      .innerJoin(products, and(eq(products.tenantId, inventoryUnits.tenantId), eq(products.id, inventoryUnits.productId)))
      .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.locationId, locationId)))
      .orderBy(asc(products.name), asc(inventoryUnits.label));
    const upcoming = await tx
      .select({
        productId: reservations.productId,
        quantity: reservations.quantity,
        startsAt: reservations.startsAt,
        blockedUntil: reservations.blockedUntil,
        orderId: orders.id,
        number: orders.number,
      })
      .from(reservations)
      .innerJoin(orders, and(eq(orders.tenantId, reservations.tenantId), eq(orders.id, reservations.orderId)))
      .where(and(eq(reservations.tenantId, tenantId), eq(reservations.locationId, locationId), gte(reservations.blockedUntil, new Date())))
      .orderBy(asc(reservations.startsAt))
      .limit(2000);
    return {
      daily: [...daily].map((r) => ({ productId: r.product_id, day: r.day, owned: r.owned, held: r.held })),
      units: units.map((r) => ({ ...r.unit, productName: r.productName })),
      upcoming,
    };
  });
}

/** Booked holds for a location in a window, for the calendar. */
export function listHolds(db: Db, tenantId: string, locationId: string, from: Date, to: Date) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({
        productId: reservations.productId,
        orderId: reservations.orderId,
        quantity: reservations.quantity,
        startsAt: reservations.startsAt,
        endsAt: reservations.endsAt,
        blockedUntil: reservations.blockedUntil,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.locationId, locationId),
          sql`${reservations.startsAt} < ${to.toISOString()}::timestamptz`,
          sql`${reservations.blockedUntil} > ${from.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(reservations.startsAt)),
  );
}
