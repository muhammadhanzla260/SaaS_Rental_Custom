/**
 * Applies migrations as the database owner, then gives the runtime role
 * `rental_app` its login password (APP_DB_PASSWORD).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { repoRoot, requireEnv } from './env';

const client = postgres(requireEnv('DATABASE_URL_OWNER'), { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: resolve(repoRoot, 'packages/db/migrations') });
  const password = process.env.APP_DB_PASSWORD;
  if (password) {
    const literal = `'${password.replace(/'/g, "''")}'`;
    await client.unsafe(`ALTER ROLE rental_app WITH LOGIN PASSWORD ${literal}`);
  }
  console.log('Migrations applied.');
} finally {
  await client.end();
}
