'use server';

import { z } from 'zod';
import { REPORTS, resolveMessaging } from '@rental/core';
import { setReportSchedule } from '@rental/db';
import type { ActionResult } from '@/lib/result';
import { requirePermission } from '../context';
import { db } from '../db';
import { run } from './run';

const input = z.object({ key: z.string().max(40), on: z.boolean(), period: z.string().max(20), locationId: z.string().uuid().nullable() });

/** "Email weekly" on a report: it goes to the office every Monday at 8:00 AM with the other scheduled reports. */
export async function scheduleReportAction(slug: string, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const p = input.safeParse(raw);
    const def = p.success ? REPORTS.find((r) => r.key === p.data.key) : null;
    if (!p.success || !def) return { ok: false, error: 'Unknown report.' };
    const ctx = await requirePermission(slug, 'reports.view');
    await setReportSchedule(db, ctx.tenant.id, ctx.actor, p.data);
    if (!p.data.on) return { ok: true, message: 'Schedule removed.' };
    const m = resolveMessaging(ctx.prefs.messaging);
    const to = m.alertsTo[0] ?? ctx.tenant.email;
    if (!to) return { ok: true, message: `${def.title} is scheduled. Add an alerts email in Settings → Email & SMS so it can be sent.` };
    return { ok: true, message: `${def.title} will be emailed every Monday at 8:00 AM to ${to}.` };
  });
}
