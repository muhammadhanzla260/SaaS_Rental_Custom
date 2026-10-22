/**
 * Background worker (runs on Railway). Jobs live in Postgres via graphile-worker,
 * so the web app can enqueue them in the same transaction as the change.
 *
 * Phase 0: housekeeping only. Later phases add: relay-outbox, send-email,
 * send-sms, run-automations (reminders), auto-charge-balance, sync-settlements.
 *
 * Connects as the database owner. Tenant data jobs must still scope every
 * query to one tenant (withTenant) - the owner role is not limited by RLS.
 */
import { config } from 'dotenv';
import { run, type Task } from 'graphile-worker';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) throw new Error('DATABASE_URL_OWNER is not set. Copy .env.example to .env.');

const tasks: Record<string, Task> = {
  /** Creates next month's audit_log partition before it is needed. */
  ensure_partitions: async (_payload, { withPgClient, logger }) => {
    await withPgClient(async (pg) => {
      const { rows } = await pg.query<{ part: string }>(
        `select app_ensure_audit_partition((date_trunc('month', now()) + interval '1 month')::date) as part`,
      );
      logger.info(`audit partition ready: ${rows[0]?.part}`);
    });
  },
  heartbeat: async (_payload, { logger }) => {
    logger.info('worker alive');
  },
};

// Times are UTC. Fields: minute hour day month weekday task
const crontab = ['15 3 * * * ensure_partitions', '*/30 * * * * heartbeat'].join('\n');

const once = process.argv.includes('--once');
const runner = await run({
  connectionString,
  concurrency: 5,
  noHandleSignals: false,
  pollInterval: 2000,
  taskList: tasks,
  crontab: once ? '' : crontab,
});

if (once) {
  // Smoke test: enqueue both jobs, let them run, exit.
  await runner.addJob('ensure_partitions', {});
  await runner.addJob('heartbeat', {});
  await new Promise((r) => setTimeout(r, 5000));
  await runner.stop();
  console.log('Worker smoke test finished.');
} else {
  await runner.promise;
}
