import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(url: string, options: { max?: number } = {}) {
  if (!url) throw new Error('Database URL is not set. Copy .env.example to .env.');
  // prepare:false keeps us compatible with Neon's pooled (PgBouncer) endpoint.
  const client = postgres(url, { prepare: false, max: options.max ?? 10, idle_timeout: 20 });
  return { db: drizzle(client, { schema }), client };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction scoped to one tenant. Row-level security reads
 * app.tenant_id, so every query inside only sees and writes this tenant's rows.
 * set_config(..., true) is transaction-local, so pooled connections never leak it.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error('Invalid tenant id');
  const locations = scopeOf()?.filter((id) => UUID_RE.test(id)) ?? null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.location_ids', ${locations ? locations.join(',') || 'none' : ''}, true)`);
    return fn(tx);
  });
}

let scopeOf: () => string[] | null = () => null;

/**
 * The web app tells withTenant which locations the signed-in member may see (null: all of them).
 * Row-level security then limits orders, invoices, payments and messages to those locations.
 * The worker never sets one, so it always sees everything.
 */
export function setLocationScope(resolve: () => string[] | null) {
  scopeOf = resolve;
}
