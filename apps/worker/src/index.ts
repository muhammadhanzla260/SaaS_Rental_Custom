/**
 * Background worker (runs on Railway). Jobs live in Postgres via graphile-worker.
 *
 *   dispatch_due      every minute: send queued emails/texts that are due (exactly once)
 *   daily_digest      every 15 min: tomorrow's events to the office at each workspace's digest time
 *   ensure_partitions nightly: next month's audit_log partition
 *
 * Two connections: the owner (cross-workspace scans, SKIP LOCKED claims) and the
 * restricted app role (everything that reads or writes one workspace's data, with
 * row-level security on, exactly like the web app).
 */
import { config } from 'dotenv';
import { run, type Task } from 'graphile-worker';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { parsePreferences, resolveMessaging, utcToWallTime } from '@rental/core';
import { createDb, enqueueMessage, tomorrowsEvents, withTenant } from '@rental/db';
import { dispatchDue } from '@rental/messaging';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const connectionString = process.env.DATABASE_URL_OWNER;
if (!connectionString) throw new Error('DATABASE_URL_OWNER is not set. Copy .env.example to .env.');
const owner = createDb(connectionString, { max: 3 });
const app = createDb(process.env.DATABASE_URL!, { max: 5 });

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

  dispatch_due: async (_payload, { logger }) => {
    // Loop until the backlog is empty (20 per claim), so a burst at 09:00 clears in one run.
    for (let i = 0; i < 25; i++) {
      const results = await dispatchDue(owner.db, app.db);
      for (const r of results) logger.info(`message ${r.id} (${r.tenantId}): ${r.result}`);
      if (results.length < 20) break;
    }
  },

  /** At each live workspace's digest time (its own time zone): tomorrow's events to the office. */
  daily_digest: async (_payload, { logger }) => {
    const tenants = await owner.db.execute<{ id: string; timezone: string; settings: unknown; email: string | null }>(
      sql`select id, timezone, settings, email from tenants where status in ('active','trial','past_due')`,
    );
    for (const t of tenants) {
      const m = resolveMessaging(parsePreferences(t.settings).messaging);
      if (!m.live || !m.internal.daily_digest) continue;
      const { date, time } = utcToWallTime(new Date(), t.timezone);
      if (time < m.digestTime) continue;
      const { date: tomorrow, events } = await tomorrowsEvents(app.db, t.id, t.timezone);
      const lines = events.length
        ? events
            .map((e) => `• ${new Date(e.starts).toLocaleTimeString('en-US', { timeZone: t.timezone, hour: 'numeric', minute: '2-digit' })} · ${e.number} · ${e.name} · ${e.items ?? ''}${e.city ? ` · ${e.city}` : ''}`)
            .join('\n')
        : 'No events tomorrow.';
      const to = m.alertsTo[0] ?? t.email;
      const row = await withTenant(app.db, t.id, (tx) =>
        enqueueMessage(tx, t.id, {
          key: `digest:${date}`, type: 'daily_digest', channel: 'email', audience: 'office', toAddress: to, toName: 'Office',
          meta: { reason: `Events for ${tomorrow}:\n\n${lines}`, cc: m.alertsTo.slice(1) }, skip: to ? null : 'No alerts email set',
        }),
      );
      if (row) logger.info(`digest queued for ${t.id} (${events.length} events)`);
    }
  },
};

// Times are UTC. Fields: minute hour day month weekday task
const crontab = ['* * * * * dispatch_due', '*/15 * * * * daily_digest', '15 3 * * * ensure_partitions'].join('\n');

const once = process.argv.includes('--once');
const runner = await run({
  connectionString,
  concurrency: 3,
  noHandleSignals: false,
  pollInterval: 2000,
  taskList: tasks,
  crontab: once ? '' : crontab,
});

if (once) {
  await runner.addJob('dispatch_due', {});
  await runner.addJob('ensure_partitions', {});
  await new Promise((r) => setTimeout(r, 6000));
  await runner.stop();
  await owner.client.end();
  await app.client.end();
  console.log('Worker smoke test finished.');
} else {
  await runner.promise;
}
