/**
 * Copies one workspace, with all of its data, from the local database into a hosted one (staging or
 * production), for going live. Everything that belongs to the workspace comes along: settings, locations,
 * products and photos, customers, orders, payments, invoices, messages, history, document numbers.
 *
 * Sign-in is not copied: no memberships, invitations or sessions. The person named by --owner becomes the
 * workspace's only owner (with their own local password); everyone else who appears in its history is
 * kept as a name only (no password, no membership), so nobody can sign in as them.
 * Saved secrets (SMTP, SMS and gateway keys, quote-link tokens) are decrypted with the local key and
 * encrypted again with the target's own key. Refuses to overwrite an existing workspace unless --replace.
 *
 *   pnpm --filter @rental/db exec tsx scripts/copy-tenant.ts --slug freedom-fun-demo --owner you@example.com --to staging
 *   ... --to production
 * Rehearsal against any database: COPY_TARGET_URL and COPY_TARGET_KEY instead of --to.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { decryptSecret, encryptSecret } from '../src/crypto';
import { repoRoot, requireEnv } from './env';

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const slug = arg('slug');
const ownerEmail = arg('owner')?.toLowerCase();
const to = arg('to');
const replace = process.argv.includes('--replace');
if (!slug || !ownerEmail) throw new Error('Use: copy-tenant.ts --slug <workspace> --owner <email> --to staging|production [--replace]');

// --- where to: .env.production (staging / production), or a rehearsal target ---
let targetUrl = process.env.COPY_TARGET_URL;
let targetKey = process.env.COPY_TARGET_KEY;
if (!targetUrl) {
  if (to !== 'production' && to !== 'staging') throw new Error('--to must be production or staging');
  const P = to === 'production' ? 'PROD' : 'STAGING';
  const file = resolve(repoRoot, '.env.production');
  const env = parse(readFileSync(file, 'utf8'));
  targetUrl = env[`${P}_DB_SESSION_URL`];
  if (!targetUrl) throw new Error(`${P}_DB_SESSION_URL is empty in .env.production`);
  targetKey = env[`${P}_APP_ENCRYPTION_KEY`];
  if (!targetKey) {
    // The target's own key, made once; Vercel and Railway get the same value as APP_ENCRYPTION_KEY.
    targetKey = randomBytes(32).toString('base64url');
    appendFileSync(file, `\n${P}_APP_ENCRYPTION_KEY=${targetKey}\n`);
    console.log(`Generated the ${to} encryption key (saved as ${P}_APP_ENCRYPTION_KEY).`);
  }
}
if (!targetKey) throw new Error('COPY_TARGET_KEY is not set');
const sourceKey = requireEnv('APP_ENCRYPTION_KEY');

/** Tables about signing in, not data: never copied. */
const SKIP = new Set(['memberships', 'membership_locations', 'invitations', 'platform_impersonations']);
/** Encrypted columns: decrypted with the local key, encrypted with the target's. */
const SEALED: Record<string, string> = { mail_accounts: 'secret_enc', sms_accounts: 'secret_enc', payment_accounts: 'secret_enc', orders: 'access_token_enc' };

const src = postgres(requireEnv('DATABASE_URL_OWNER'), { max: 1, onnotice: () => {} });
const dst = postgres(targetUrl, { max: 1, prepare: false, onnotice: () => {} });
const UUID = /^[0-9a-f-]{36}$/i;

try {
  const [tenant] = await src<{ id: string; name: string }[]>`select id, name from tenants where slug = ${slug}`;
  if (!tenant) throw new Error(`No workspace "${slug}" in the local database.`);
  const tid = tenant.id;
  if (!UUID.test(tid)) throw new Error('Unexpected tenant id');
  const [owner] = await src<{ id: string }[]>`select id from users where lower(email) = ${ownerEmail}`;
  if (!owner) throw new Error(`No local user with the email ${ownerEmail}.`);
  console.log(`Copying ${tenant.name} (${slug}) to ${to ?? 'the rehearsal database'} (${new URL(targetUrl).host}) ...`);

  const existing = await dst`select 1 from tenants where id = ${tid} or slug = ${slug}`;
  if (existing.length && !replace) throw new Error('That workspace already exists there. Re-run with --replace to overwrite it.');

  // Columns per table, in the target's order (the same migrations ran on both). Generated columns
  // (like a customer's display name) are left out: the target computes them itself.
  const colsOf = async (db: postgres.Sql, table: string) =>
    (await db<{ c: string }[]>`select column_name as c from information_schema.columns
      where table_schema = 'public' and table_name = ${table} and is_generated = 'NEVER' order by ordinal_position`).map((r) => r.c);
  const tables = (await dst<{ t: string }[]>`
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)`).map((r) => r.t).filter((t) => !SKIP.has(t));
  // Parents before children (foreign keys).
  const edges = await dst<{ child: string; parent: string }[]>`
    select conrelid::regclass::text as child, confrelid::regclass::text as parent from pg_constraint
    where contype = 'f' and connamespace = 'public'::regnamespace and conrelid <> confrelid`;
  const order: string[] = [];
  const visit = (t: string, path: string[] = []) => {
    if (order.includes(t) || !tables.includes(t)) return;
    if (path.includes(t)) throw new Error(`Foreign-key cycle: ${[...path, t].join(' -> ')}`);
    for (const e of edges) if (e.child === t && e.parent !== 'tenants') visit(e.parent, [...path, t]);
    order.push(t);
  };
  tables.forEach((t) => visit(t));

  /**
   * Copies the rows matching `where`, 25 at a time: read as JSON on one side, turned back into rows with
   * the table's own column types on the other (bytes, money, dates and lists round-trip exactly).
   */
  const copyRows = async (table: string, where: string) => {
    const [srcCols, dstCols] = await Promise.all([colsOf(src, table), colsOf(dst, table)]);
    const cols = dstCols.filter((c) => srcCols.includes(c)).map((c) => `"${c}"`).join(', ');
    let mb = 0;
    for (let offset = 0; ; offset += 25) {
      const [page] = await src.unsafe(`select json_agg(t)::text as rows from (select ${cols} from ${table} where ${where} order by 1, 2 limit 25 offset ${offset}) t`);
      const rows = page?.rows as string | null;
      if (!rows) break;
      mb += rows.length / 1048576;
      await dst.unsafe(`insert into ${table} (${cols}) select ${cols} from json_populate_recordset(null::${table}, ($1::text)::json)`, [rows]);
    }
    if (process.env.COPY_DEBUG) console.log(`  copied ${table} (${mb.toFixed(1)} MB)`);
  };

  if (replace) {
    // The activity log has no foreign key to the workspace, so it is cleared by hand.
    await dst`delete from audit_log where tenant_id = ${tid}`;
    await dst`delete from tenants where id = ${tid} or slug = ${slug}`;
  }

  // People: the owner (with their password) and everyone named in the history (names only).
  const people = await src<{ id: string }[]>`
    select user_id as id from memberships where tenant_id = ${tid}
    union select actor_user_id from audit_log where tenant_id = ${tid} and actor_user_id is not null
    union select actor_user_id from order_versions where tenant_id = ${tid} and actor_user_id is not null
    union select salesperson_user_id from orders where tenant_id = ${tid} and salesperson_user_id is not null
    union select ${owner.id}`;
  for (const { id } of people) {
    const [u] = await src`select id, name, email, email_verified, image, created_at, updated_at from users where id = ${id}`;
    if (!u) continue;
    const [clash] = await dst<{ id: string }[]>`select id from users where lower(email) = lower(${u.email})`;
    if (clash) continue; // already there (an earlier copy, or they signed up)
    await dst`insert into users (id, name, email, email_verified, image, is_platform_admin, created_at, updated_at)
      values (${u.id}, ${u.name}, ${u.email}, ${u.email_verified}, ${u.image}, false, ${u.created_at}, ${u.updated_at})`;
    if (id === owner.id) await copyRows('accounts', `user_id = '${id.replace(/'/g, "''")}' and provider_id = 'credential'`);
  }
  const [ownerThere] = await dst<{ id: string }[]>`select id from users where lower(email) = ${ownerEmail}`;

  // The workspace, then its tables in order.
  await copyRows('tenants', `id = '${tid}'`);
  for (const t of order) {
    await copyRows(t, `tenant_id = '${tid}'`);
    const sealed = SEALED[t];
    if (sealed) {
      const rows = await src.unsafe(`select id, ${sealed} as v from ${t} where tenant_id = '${tid}' and ${sealed} is not null`);
      for (const r of rows) {
        await dst.unsafe(`update ${t} set ${sealed} = $1 where tenant_id = $2 and id = $3`, [encryptSecret(decryptSecret(r.v, sourceKey), targetKey), tid, r.id]);
      }
      if (rows.length) console.log(`  ${t}: ${rows.length} secret(s) re-encrypted`);
    }
  }
  await dst`insert into memberships (tenant_id, user_id, role, status, all_locations) values (${tid}, ${ownerThere!.id}, 'owner', 'active', true)`;

  // Check: every table has the same number of rows on both sides.
  let bad = 0;
  for (const t of ['tenants', ...order]) {
    const where = t === 'tenants' ? `id = '${tid}'` : `tenant_id = '${tid}'`;
    const count = async (db: postgres.Sql) => ((await db.unsafe(`select count(*)::int as n from ${t} where ${where}`))[0]?.n ?? 0) as number;
    const [a, b] = await Promise.all([count(src), count(dst)]);
    if (a !== b) { bad++; console.log(`  MISMATCH ${t}: ${a} local, ${b} copied`); }
    else if (a) console.log(`  ${t}: ${a}`);
  }
  if (bad) throw new Error(`${bad} table(s) do not match.`);
  console.log(`Done. ${ownerEmail} is the owner; nobody else can sign in.`);
} finally {
  await src.end();
  await dst.end();
}
