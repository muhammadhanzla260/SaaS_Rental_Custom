import 'server-only';
import { createDb, type Db } from '@rental/db';

// One pool per server process; reused across hot reloads in development.
const globalForDb = globalThis as unknown as { rentalDb?: Db };

export const db: Db = globalForDb.rentalDb ?? createDb(process.env.DATABASE_URL ?? '', { max: 10 }).db;
if (process.env.NODE_ENV !== 'production') globalForDb.rentalDb = db;
