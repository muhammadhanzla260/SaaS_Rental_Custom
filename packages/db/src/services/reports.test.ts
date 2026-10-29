/**
 * Phase 3 Reports: every report runs against real orders, the month-to-date
 * bars add up to the Revenue tile, and credits show issued / used / remaining.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { addDays, customerSchema, orderSchema, parsePreferences, productSchema, REPORTS, utcToWallTime, wallTimeToUtc, type OrderInput } from '@rental/core';
import '../../scripts/env';
import { createDb } from '../client';
import { tenants, users } from '../schema';
import { createProduct } from './catalog';
import { createCustomer } from './customers';
import { listLocations } from './locations';
import { cancelOrder, createOrder, getOrder, transitionOrder } from './orders';
import { setupOrganization } from './organizations';
import { listReportSchedules, queueWeeklyReports, runReport, setReportSchedule, type ReportFilters } from './reports';

const app = createDb(process.env.DATABASE_URL!, { max: 4 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 2 });
const db = app.db;
const run = randomUUID().slice(0, 8);
const actor = { type: 'user' as const, userId: `rep-${run}` };
const prefs = parsePreferences({});
let tenantId = '';
let locationId = '';
let castleId = '';
let customerId = '';

const today = utcToWallTime(new Date(), 'America/Chicago').date;
// Next calendar month, so the events are always in the future and inside one month.
const [ty, tm] = today.split('-').map(Number) as [number, number];
const monthStart = tm === 12 ? `${ty + 1}-01-01` : `${ty}-${String(tm + 1).padStart(2, '0')}-01`;
const monthEnd = addDays(monthStart.slice(5, 7) === '12' ? `${Number(monthStart.slice(0, 4)) + 1}-01-01` : `${monthStart.slice(0, 5)}${String(Number(monthStart.slice(5, 7)) + 1).padStart(2, '0')}-01`, -1);
const on = (dayOfMonth: number) => addDays(monthStart, dayOfMonth - 1);
const input = (date: string, extra: Partial<Record<string, unknown>> = {}): OrderInput =>
  orderSchema.parse({
    customerId, locationId, startsAt: wallTimeToUtc(date, '13:00', 'America/Chicago'), endsAt: wallTimeToUtc(date, '18:00', 'America/Chicago'),
    eventAddress: { line1: '1100 Congress Ave', city: 'Austin', country: 'US' }, eventContactName: 'Maria', eventContactMobile: '512-555-0198', contactConfirmed: true,
    lines: [{ productId: castleId, quantity: 1 }], ...extra,
  });
const filters = (from: string, to: string, at = today): ReportFilters => ({ from, to, currency: 'USD', today: at });
async function booked(date: string, extra: Partial<Record<string, unknown>> = {}) {
  const o = await createOrder(db, tenantId, actor, input(date, extra), prefs);
  await transitionOrder(db, tenantId, actor, o.id, 'book', prefs, { booking: { method: 'manual', payMethod: 'cash', amount: o.depositDueCents / 100 } });
  return (await getOrder(db, tenantId, o.id))!;
}

beforeAll(async () => {
  await owner.db.insert(users).values({ id: actor.userId!, name: 'Report Owner', email: `rep-${run}@example.test` });
  const t = await setupOrganization(db, { userId: actor.userId! }, {
    slug: `rep-${run}`, name: 'Report Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
    taxPercent: 8.25,
  });
  tenantId = t.id;
  locationId = (await listLocations(db, tenantId))[0]!.id;
  castleId = (await createProduct(db, tenantId, actor, productSchema.parse({ name: 'Castle', priceStaffed: 225, baseHours: 4, inventory: { [locationId]: { owned: 10 } } }))).id;
  customerId = (await createCustomer(db, tenantId, actor, customerSchema.parse({ firstName: 'Maria', lastName: 'G', email: `m-${run}@example.test`, address: { country: 'US' } }))).id;
});

afterAll(async () => {
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${actor.userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('reports', () => {
  it('acceptance 5: month-to-date bars sum to the Revenue tile, which is booked orders by event date', async () => {
    const a = await booked(on(5));
    const b = await booked(on(12));
    await booked(on(12));
    await createOrder(db, tenantId, actor, input(on(14)), prefs); // a draft never counts
    const r = await runReport(db, tenantId, 'month_to_date', filters(monthStart, monthEnd, monthEnd));
    const revenue = r.kpis.find((k) => k.label === 'Revenue')!.value;
    expect(revenue).toBe(a.totalCents + b.totalCents * 2);
    expect(r.chart!.points.reduce((s, p) => s + p.value, 0)).toBe(revenue);
    expect(r.chart!.points).toHaveLength(Number(monthEnd.slice(8)));
    expect(r.totals!.revenue).toBe(revenue);
    expect(r.kpis.find((k) => k.label === 'Orders')!.value).toBe(3);
  });

  it('acceptance 3: credits show issued, used on a booked order, and remaining', async () => {
    const o = await booked(on(20));
    const c = await cancelOrder(db, tenantId, actor, o.id, prefs, { reason: 'Weather', outcome: 'rain_check', amount: o.paidCents / 100, goodwill: 10 });
    const issued = c.credit!.amountCents;
    await booked(on(22), { credits: [{ creditId: c.credit!.id, amount: 50 }] });
    const r = await runReport(db, tenantId, 'credits_rain_checks', filters(addDays(today, -1), addDays(today, 1)));
    const row = r.rows.find((x) => x.code === c.credit!.code)!;
    expect(row).toMatchObject({ kind: 'Rain check', amount: issued, used: 5000, remaining: issued - 5000, status: 'Active' });
    expect(r.kpis.map((k) => k.value)).toEqual([issued, 5000, issued - 5000, 1]);
    const cancelled = await runReport(db, tenantId, 'cancelled_orders', filters(addDays(today, -1), addDays(today, 1)));
    expect(cancelled.rows.find((x) => x.number === o.number)).toMatchObject({ outcome: 'Rain check', credited: issued });
  });

  it('all 32 reports run; totals match their rows', async () => {
    for (const def of REPORTS) {
      const r = await runReport(db, tenantId, def.key, filters(addDays(today, -1), monthEnd, today));
      expect(r.columns.length, def.key).toBeGreaterThan(0);
      for (const col of r.columns.filter((c) => c.kind === 'money' && r.totals?.[c.key] != null)) {
        expect(r.totals![col.key], `${def.key}.${col.key}`).toBe(r.rows.reduce((s, x) => s + Number(x[col.key] ?? 0), 0));
      }
    }
    await expect(runReport(db, tenantId, 'nope', filters(today, today))).rejects.toThrow(/Unknown report/);
  });

  it('Email weekly: scheduled reports go out together in one office email, once a day', async () => {
    await setReportSchedule(db, tenantId, actor, { key: 'receivables', on: true, period: 'this_month' });
    await setReportSchedule(db, tenantId, actor, { key: 'month_to_date', on: true, period: 'custom', locationId });
    await setReportSchedule(db, tenantId, actor, { key: 'coupons', on: true, period: 'year' });
    await setReportSchedule(db, tenantId, actor, { key: 'coupons', on: false, period: 'year' });
    const list = await listReportSchedules(db, tenantId);
    expect(list.map((s) => `${s.reportKey}:${s.period}`).sort()).toEqual(['month_to_date:this_month', 'receivables:this_month']);
    const tenant = { id: tenantId, slug: `rep-${run}`, currency: 'USD' };
    const row = await queueWeeklyReports(db, tenant, today, 'https://app.example');
    expect(row).toBeTruthy();
    const [m] = [...(await owner.db.execute<{ type: string; audience: string; meta: { reason: string } }>(
      sql`select type, audience, meta from messages where tenant_id = ${tenantId}::uuid and type = 'weekly_report'`,
    ))];
    expect(m!.audience).toBe('office');
    // Registry order: Month to Date (Sales) before Receivables (General), each with a link back.
    expect(m!.meta.reason.indexOf('MONTH TO DATE')).toBeLessThan(m!.meta.reason.indexOf('RECEIVABLES'));
    expect(m!.meta.reason).toContain(`https://app.example/rep-${run}/reports?r=month_to_date&p=this_month&loc=${locationId}`);
    expect(await queueWeeklyReports(db, tenant, today, 'https://app.example')).toBeNull();
  });
});
