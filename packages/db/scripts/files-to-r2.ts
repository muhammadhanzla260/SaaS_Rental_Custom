/**
 * Moves uploaded files that are still kept in the database (storage = 'db') into object storage (R2),
 * one at a time: upload, then point the row at the bucket and clear its bytes. Safe to run again; a file
 * that is already in the bucket is skipped. Uses the owner connection and the R2_* settings.
 *   pnpm --filter @rental/db exec tsx scripts/files-to-r2.ts            move them
 *   pnpm --filter @rental/db exec tsx scripts/files-to-r2.ts --dry-run  only count
 */
import postgres from 'postgres';
import { objectKey, objectStore } from '../src/storage';
import { requireEnv } from './env';

const dry = process.argv.includes('--dry-run');
const store = objectStore();
if (!store && !dry) throw new Error('Object storage is not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
const sql = postgres(requireEnv('DATABASE_URL_OWNER'), { max: 1, onnotice: () => {} });
try {
  const [total] = await sql<{ n: number; bytes: string | null }[]>`select count(*)::int as n, sum(size_bytes)::text as bytes from files where storage = 'db'`;
  console.log(`${total!.n} file(s) in the database, ${(Number(total!.bytes ?? 0) / 1048576).toFixed(1)} MB`);
  if (!dry) {
    let moved = 0;
    for (;;) {
      // Ids only, then one file at a time, so a big photo never sits in memory with the rest.
      const ids = await sql<{ tenant_id: string; id: string }[]>`select tenant_id, id from files where storage = 'db' order by created_at limit 50`;
      if (!ids.length) break;
      for (const { tenant_id, id } of ids) {
        const [f] = await sql<{ content: Buffer | null; mime: string }[]>`select content, mime from files where tenant_id = ${tenant_id} and id = ${id} and storage = 'db'`;
        if (!f) continue;
        const key = objectKey(tenant_id, id);
        if (f.content) await store!.put(key, f.content, f.mime);
        await sql`update files set storage = 's3', storage_key = ${key}, content = null where tenant_id = ${tenant_id} and id = ${id}`;
        moved++;
      }
      console.log(`  moved ${moved}`);
    }
    console.log(`Done: ${moved} file(s) now in the bucket.`);
  }
} finally {
  await sql.end();
}
