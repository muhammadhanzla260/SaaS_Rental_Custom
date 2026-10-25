/**
 * One-off after Phase 2b, safe to rerun, nothing deleted:
 *   - invoices for every booked/completed order that has none
 *   - the demo workspace gets Freedom Fun's lease as its agreement (only while it has none of its own)
 *
 *   pnpm --filter @rental/db exec tsx ../../apps/web/scripts/upgrade-phase2b.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { parsePreferences } from '@rental/core';
import { backfillInvoices, createDb, updatePreferences } from '@rental/db';
import { FREEDOM_FUN_AGREEMENT } from './freedomfun-agreement';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });

const tenants = await owner<{ id: string; slug: string; settings: unknown }[]>`select id, slug, settings from tenants where status <> 'closed' order by created_at`;
for (const t of tenants) {
  const n = await backfillInvoices(db, t.id);
  if (n) console.log(`${t.slug}: invoices for ${n} order${n === 1 ? '' : 's'}`);
  if (t.slug === 'freedom-fun-demo' && !parsePreferences(t.settings).agreement.body.trim()) {
    await updatePreferences(db, t.id, { type: 'system' }, 'agreement', FREEDOM_FUN_AGREEMENT);
    console.log(`${t.slug}: Freedom Fun lease set as the rental agreement`);
  }
}
console.log(`Checked ${tenants.length} workspaces.`);
await app.end();
await owner.end();
