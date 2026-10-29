/**
 * Sets up (or updates) a hosted database from .env.production, for `production` or `staging`:
 *   1. a password for the app's restricted login (rental_app), generated once and kept in .env.production
 *   2. every migration, as the owner, over Supabase's session pooler (tables, row-level security,
 *      functions, and no access for Supabase's public API roles), and rental_app's password
 *   3. the app's connection string (transaction pooler, as rental_app), saved to .env.production as
 *      <TARGET>_DATABASE_URL for Vercel, and a test connection with it
 * Prints no secrets. Safe to run again: migrations only apply what is new.
 *   pnpm --filter @rental/db exec tsx scripts/deploy-db.ts production
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import postgres from 'postgres';
import { repoRoot } from './env';

const target = process.argv[2];
if (target !== 'production' && target !== 'staging') throw new Error('Use: deploy-db.ts production | staging');
const P = target === 'production' ? 'PROD' : 'STAGING';
const file = resolve(repoRoot, process.env.DEPLOY_ENV_FILE ?? '.env.production');
const read = () => parse(readFileSync(file, 'utf8'));
let env = read();

const need = (k: string) => {
  const v = env[k]?.trim();
  if (!v) throw new Error(`${k} is empty in .env.production`);
  if (v.includes('[YOUR-PASSWORD]')) throw new Error(`${k} still contains [YOUR-PASSWORD]: replace it with the database password.`);
  return v;
};
/** Sets KEY=value in .env.production (replacing the line, or adding it). */
const save = (k: string, v: string) => {
  const text = readFileSync(file, 'utf8');
  const line = new RegExp(`^${k}=.*$`, 'm');
  if (line.test(text)) writeFileSync(file, text.replace(line, `${k}=${v}`));
  else appendFileSync(file, `${text.endsWith('\n') ? '' : '\n'}${k}=${v}\n`);
  env = read();
};

const session = need(`${P}_DB_SESSION_URL`);
const transaction = need(`${P}_DB_TRANSACTION_URL`);
if (!env[`${P}_APP_DB_PASSWORD`]) {
  save(`${P}_APP_DB_PASSWORD`, randomBytes(24).toString('base64url'));
  console.log(`Generated a password for rental_app (saved as ${P}_APP_DB_PASSWORD).`);
}
const appPassword = env[`${P}_APP_DB_PASSWORD`]!;

// Supabase's poolers name the login as "<role>.<project ref>": the app logs in as rental_app.<ref>.
const t = new URL(transaction);
const ref = t.username.includes('.') ? t.username.split('.').slice(1).join('.') : '';
const app = new URL(transaction);
app.username = ref ? `rental_app.${ref}` : 'rental_app';
app.password = encodeURIComponent(appPassword);

console.log(`Migrating the ${target} database (${new URL(session).host}) ...`);
const r = spawnSync(process.execPath, ['--import', 'tsx', resolve(repoRoot, 'packages/db/scripts/migrate.ts')], {
  cwd: resolve(repoRoot, 'packages/db'),
  env: { ...process.env, DATABASE_URL_OWNER: session, APP_DB_PASSWORD: appPassword },
  stdio: 'inherit',
});
if (r.status !== 0) throw new Error('Migrations failed (see above).');

save(`${P}_DATABASE_URL`, app.toString());
console.log(`Saved the app's connection string as ${P}_DATABASE_URL.`);

const sql = postgres(app.toString(), { prepare: false, max: 1, onnotice: () => {} });
try {
  const [me] = await sql<{ who: string; tables: number }[]>`select current_user as who, (select count(*)::int from information_schema.tables where table_schema = 'public') as tables`;
  console.log(`Connected as ${me!.who}: ${me!.tables} tables. The ${target} database is ready.`);
} finally {
  await sql.end();
}
