import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { timezoneAt, type LocationValues } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { locations, taxRates, tenants } from '../schema';
import { audit, diff, type Actor } from './audit';
import { OrgError } from './errors';

export type Location = typeof locations.$inferSelect;

/** Location row values. The time zone comes from the map pin unless set by hand. */
export function locationValues(input: LocationValues, fallbackTimezone: string) {
  return {
    name: input.name,
    code: input.code,
    timezone: input.timezone || timezoneAt(input.address.lat, input.address.lng) || fallbackTimezone,
    phone: input.phone ?? null,
    email: input.email ?? null,
    line1: input.address.line1 ?? null,
    line2: input.address.line2 ?? null,
    city: input.address.city ?? null,
    region: input.address.region ?? null,
    postalCode: input.address.postalCode ?? null,
    country: input.address.country,
    lat: input.address.lat ?? null,
    lng: input.address.lng ?? null,
    loadingNotes: input.loadingNotes ?? null,
    isPrimary: input.isPrimary,
    isActive: input.isActive,
    settings: input.settings,
  };
}

async function assertCodeFree(tx: Tx, code: string, exceptId?: string) {
  const clash = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(exceptId ? and(eq(locations.code, code), ne(locations.id, exceptId)) : eq(locations.code, code))
    .limit(1);
  if (clash.length) throw new OrgError(`Another location already uses the code ${code}.`, 'invalid');
}

export async function setTaxRate(tx: Tx, tenantId: string, locationId: string, ratePercent: number) {
  const updated = await tx
    .update(taxRates)
    .set({ rate: String(ratePercent) })
    .where(and(eq(taxRates.locationId, locationId), eq(taxRates.isDefault, true)))
    .returning({ id: taxRates.id });
  if (!updated.length) {
    await tx.insert(taxRates).values({ tenantId, locationId, name: 'Sales tax', rate: String(ratePercent), isDefault: true });
  }
}

/** Exactly one primary location: the default ship-from point. */
async function makeOnlyPrimary(tx: Tx, keepId: string) {
  await tx.update(locations).set({ isPrimary: false }).where(and(eq(locations.isPrimary, true), ne(locations.id, keepId)));
  await tx.update(locations).set({ isPrimary: true }).where(eq(locations.id, keepId));
}

async function tenantTimezone(tx: Tx, tenantId: string) {
  const [t] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return t?.timezone ?? 'UTC';
}

export function listLocations(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const locs = await tx.select().from(locations).orderBy(sql`${locations.isPrimary} desc`, asc(locations.name));
    const taxes = await tx.select().from(taxRates).where(eq(taxRates.isDefault, true));
    return locs.map((l) => ({ ...l, taxRate: taxes.find((t) => t.locationId === l.id) ?? null }));
  });
}

export function getLocation(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [loc] = await tx.select().from(locations).where(eq(locations.id, id)).limit(1);
    if (!loc) return null;
    const [tax] = await tx
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.locationId, id), eq(taxRates.isDefault, true)))
      .limit(1);
    return { ...loc, taxRate: tax ?? null };
  });
}

export function createLocation(db: Db, tenantId: string, actor: Actor, input: LocationValues, taxPercent: number) {
  return withTenant(db, tenantId, async (tx) => {
    await assertCodeFree(tx, input.code);
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(locations)) as [{ n: number }];
    const values = locationValues(input, await tenantTimezone(tx, tenantId));
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, ...values, isPrimary: false })
      .returning();
    if (input.isPrimary || n === 0) await makeOnlyPrimary(tx, loc!.id);
    await setTaxRate(tx, tenantId, loc!.id, taxPercent);
    await audit(tx, tenantId, actor, { type: 'location', id: loc!.id }, 'location.created', { name: loc!.name });
    return loc!;
  });
}

export function updateLocation(db: Db, tenantId: string, actor: Actor, id: string, input: LocationValues, taxPercent: number) {
  return withTenant(db, tenantId, async (tx) => {
    const [before] = await tx.select().from(locations).where(eq(locations.id, id)).limit(1);
    if (!before) throw new OrgError('Location not found.', 'not_found');
    await assertCodeFree(tx, input.code, id);
    if (before.isPrimary && !input.isPrimary) throw new OrgError('Make another location the primary one first.', 'invalid');
    if (before.isPrimary && !input.isActive) throw new OrgError('The primary location must stay active.', 'invalid');
    if (!input.isActive && before.isActive) {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(locations).where(eq(locations.isActive, true))) as [{ n: number }];
      if (n <= 1) throw new OrgError('Keep at least one active location.', 'invalid');
    }
    const values = locationValues(input, before.timezone);
    const [after] = await tx.update(locations).set({ ...values, isPrimary: before.isPrimary }).where(eq(locations.id, id)).returning();
    if (input.isPrimary && !before.isPrimary) await makeOnlyPrimary(tx, id);
    await setTaxRate(tx, tenantId, id, taxPercent);
    const changes = diff(before as unknown as Record<string, unknown>, { ...after!, isPrimary: input.isPrimary } as unknown as Record<string, unknown>);
    delete changes.updatedAt;
    if (Object.keys(changes).length) await audit(tx, tenantId, actor, { type: 'location', id }, 'location.updated', changes);
    return after!;
  });
}

export function deleteLocation(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [loc] = await tx.select().from(locations).where(eq(locations.id, id)).limit(1);
    if (!loc) throw new OrgError('Location not found.', 'not_found');
    if (loc.isPrimary) throw new OrgError('Make another location the primary one before removing this one.', 'invalid');
    await tx.delete(locations).where(eq(locations.id, id));
    await audit(tx, tenantId, actor, { type: 'location', id }, 'location.deleted', { name: loc.name });
  });
}
