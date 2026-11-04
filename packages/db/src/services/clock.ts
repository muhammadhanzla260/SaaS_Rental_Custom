import { and, eq } from 'drizzle-orm';
import { utcToWallTime } from '@rental/core';
import type { Tx } from '../client';
import { locations, tenants } from '../schema';

/**
 * Today's date where the business is (the location's time zone, else the workspace's), not in UTC:
 * every US evening UTC is already tomorrow, so quotes and coupons would expire hours early.
 */
export async function localToday(tx: Tx, tenantId: string, locationId?: string | null, now = new Date()) {
  const [loc] = locationId
    ? await tx.select({ tz: locations.timezone }).from(locations).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId))).limit(1)
    : [];
  const tz = loc?.tz ?? (await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0]?.tz ?? 'UTC';
  return utcToWallTime(now, tz).date;
}
