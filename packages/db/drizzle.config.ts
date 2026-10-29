import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '../../.env', quiet: true });

export default defineConfig({
  dialect: 'postgresql',
  // audit.ts is partitioned and created by hand-written SQL, so it is not listed.
  schema: [
    './src/schema/auth.ts', './src/schema/org.ts', './src/schema/commerce.ts',
    './src/schema/platform.ts', './src/schema/integrations.ts', './src/schema/messaging.ts',
  ],
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL_OWNER ?? '' },
  strict: true,
});
