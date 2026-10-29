/** Dev helper: run one SQL statement as the owner and print rows. tsx scripts/sql.ts "select 1" */
import postgres from 'postgres';
import { requireEnv } from './env';
const sql = postgres(requireEnv('DATABASE_URL_OWNER'), { max: 1 });
const rows = await sql.unsafe(process.argv[2]!);
console.log(JSON.stringify(rows, null, 1));
await sql.end();
