/**
 * Tim Masters, the salesperson in the walkthrough video: an admin of Freedom Fun
 * USA (every location), signing in with the demo password. Safe to run again.
 *   pnpm --filter @rental/db exec tsx ../../apps/web/scripts/seed-video-user.ts
 */
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { hashPassword } from 'better-auth/crypto';
import { acceptInvitation, createDb, createInvitation } from '@rental/db';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
const EMAIL = 'tim@demo.tentpole.test';
const PASSWORD = 'Tentpole-2026!';
const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
try {
  const [t] = await owner<{ id: string }[]>`select id from tenants where slug = 'freedom-fun-demo'`;
  const [jordan] = await owner<{ id: string }[]>`select id from users where email = 'jordan@demo.tentpole.test'`;
  if (!t || !jordan) throw new Error('Freedom Fun USA (freedom-fun-demo) and its owner are needed first.');
  let [tim] = await owner<{ id: string }[]>`select id from users where email = ${EMAIL}`;
  if (!tim) {
    const id = randomUUID();
    await owner`insert into users (id, name, email, email_verified, is_platform_admin) values (${id}, 'Tim Masters', ${EMAIL}, true, false)`;
    await owner`insert into accounts (id, account_id, provider_id, user_id, password) values (${randomUUID()}, ${id}, 'credential', ${id}, ${await hashPassword(PASSWORD)})`;
    tim = { id };
  }
  const [member] = await owner<{ role: string }[]>`select role from memberships where tenant_id = ${t.id} and user_id = ${tim.id}`;
  if (!member) {
    const { token } = await createInvitation(db, t.id, { type: 'user', userId: jordan.id }, { email: EMAIL, name: 'Tim Masters', role: 'admin' });
    await acceptInvitation(db, token, { id: tim.id, email: EMAIL });
  }
  const [now] = await owner<{ role: string }[]>`select role from memberships where tenant_id = ${t.id} and user_id = ${tim.id}`;
  console.log(`Tim Masters · ${EMAIL} · ${now?.role} of Freedom Fun USA · password ${PASSWORD}`);
} finally {
  await app.end();
  await owner.end();
}
