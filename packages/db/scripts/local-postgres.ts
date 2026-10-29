/**
 * Local PostgreSQL 17 for development (same major version as Neon), no Docker needed.
 * Data lives in .data/pg at the repo root. Stop with Ctrl+C.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './env';

const databaseDir = resolve(repoRoot, '.data/pg');
const port = Number(process.env.LOCAL_PG_PORT ?? 54329);

const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  // UTF-8 like Neon (Windows would otherwise pick WIN1252, which cannot store emoji or most non-Latin names).
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
});

const fresh = !existsSync(resolve(databaseDir, 'PG_VERSION'));
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('rental');

console.log(`PostgreSQL ready on 127.0.0.1:${port} (database "rental"). Press Ctrl+C to stop.`);
if (fresh) console.log('New database: run `pnpm db:migrate` next.');

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
