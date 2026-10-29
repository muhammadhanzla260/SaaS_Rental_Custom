/**
 * One-off, safe to rerun: give the demo workspace Freedom Fun's Odoo-style emails.
 * A template someone already edited is left alone.
 *
 *   pnpm --filter @rental/db exec tsx ../../apps/web/scripts/upgrade-emails.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createDb, getTemplate, saveTemplate } from '@rental/db';
import { freedomFunEmailTemplates } from './freedomfun-emails';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });

const [t] = await owner<{ id: string }[]>`select id from tenants where slug = 'freedom-fun-demo'`;
if (!t) throw new Error('No freedom-fun-demo workspace.');
for (const { type, template } of freedomFunEmailTemplates()) {
  const current = await getTemplate(db, t.id, type, 'email');
  if (current.custom) {
    console.log(`${type}: kept (edited in the app)`);
    continue;
  }
  await saveTemplate(db, t.id, { type: 'system' }, type, 'email', template);
  console.log(`${type}: Freedom Fun template saved`);
}
await app.end();
await owner.end();
