/**
 * Grants (or with --revoke, removes) platform console access for one login.
 * Runs as the database owner: the app's own role cannot change this flag.
 *   pnpm platform:admin you@example.com
 *   pnpm platform:admin you@example.com --revoke
 * Without an email, PLATFORM_OWNER_EMAIL from .env is used.
 */
import postgres from 'postgres';
import { requireEnv } from './env';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const email = (args.find((a) => !a.startsWith('--')) ?? process.env.PLATFORM_OWNER_EMAIL ?? '').trim();
if (!email) {
  console.error('Give an email: pnpm platform:admin you@example.com (or set PLATFORM_OWNER_EMAIL).');
  process.exit(1);
}

const sql = postgres(requireEnv('DATABASE_URL_OWNER'), { max: 1, onnotice: () => {} });
try {
  const rows = await sql`update users set is_platform_admin = ${!revoke}, updated_at = now() where email = ${email} returning name`;
  if (!rows.length) {
    console.error(`No login with ${email} yet. Register or sign up with that email first, then run this again.`);
    process.exitCode = 1;
  } else {
    console.log(revoke ? `${email} no longer has platform console access.` : `${email} (${rows[0]!.name}) can now open /console.`);
  }
} finally {
  await sql.end();
}
