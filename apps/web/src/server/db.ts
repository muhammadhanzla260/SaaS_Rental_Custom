import 'server-only';
import { createDb, type Db } from '@rental/db';

// One pool per server process; reused across hot reloads in development.
const globalForDb = globalThis as unknown as { rentalDb?: Db };

/** Opened on first use, not on import: `next build` loads every route without a database. */
function open(): Db {
  if (globalForDb.rentalDb) return globalForDb.rentalDb;
  const db = createDb(process.env.DATABASE_URL ?? '', { max: 10 }).db;
  globalForDb.rentalDb = db;
  return db;
}

export const db: Db = new Proxy({} as Db, {
  get(_, key) {
    const real = open();
    const value = Reflect.get(real, key, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
