/**
 * Recompute every order's invoice from the order (after migration 0030 merged
 * deposit and balance invoices into one per order). Safe to run again.
 *   pnpm --filter @rental/db exec tsx scripts/resync-invoices.ts
 */
import { sql } from 'drizzle-orm';
import { createDb } from '../src/client';
import { syncOrderInvoices } from '../src/services/money';
import './env';

const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
const app = createDb(process.env.DATABASE_URL!, { max: 2 });
try {
  const rows = [...(await owner.db.execute<{ tenant_id: string; id: string }>(sql`
    select o.tenant_id, o.id from orders o
    where o.status in ('booked','completed') or exists (select 1 from invoices i where i.tenant_id = o.tenant_id and i.order_id = o.id)`))];
  for (const r of rows) await syncOrderInvoices(app.db, r.tenant_id, r.id);
  console.log(`Invoices recomputed for ${rows.length} orders.`);
} finally {
  await owner.client.end();
  await app.client.end();
}
