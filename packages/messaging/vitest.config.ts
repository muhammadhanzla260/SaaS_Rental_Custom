import { defineConfig } from 'vitest/config';

// Database tests share one local Postgres; a cold first connection can take a few seconds.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false } });
