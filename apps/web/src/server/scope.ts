import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { cache } from 'react';
import { setLocationScope } from '@rental/db';

/**
 * Which locations the signed-in member may see, for this request only (QA B-14). getTenantContext
 * fills it in; withTenant passes it to the database, where row-level security does the limiting.
 * Server actions get their own holder from run(); pages share one per request through React cache.
 */
type Holder = { locationIds: string[] | null };
const actionScope = new AsyncLocalStorage<Holder>();
const pageScope = cache((): Holder => ({ locationIds: null }));

const holder = (): Holder => actionScope.getStore() ?? pageScope();

export function setRequestLocations(ids: string[] | null) {
  holder().locationIds = ids;
}

export function inActionScope<T>(fn: () => Promise<T>) {
  return actionScope.run({ locationIds: null }, fn);
}

setLocationScope(() => {
  try {
    return holder().locationIds;
  } catch {
    return null;
  }
});
