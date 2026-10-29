/** Dev helper: list organizations. pnpm --filter @rental/db exec tsx scripts/list-orgs.ts */
import postgres from 'postgres';
import { requireEnv } from './env';
const sql = postgres(requireEnv('DATABASE_URL_OWNER'), { max: 1 });
const rows = await sql`select slug, status, plan, rollout_phase from tenants order by created_at`;
console.log(rows.map((r) => `${r.slug.padEnd(32)} ${r.status.padEnd(10)} ${r.plan.padEnd(8)} P${r.rollout_phase}`).join('\n'));
await sql.end();
