import 'server-only';
import { PERIODS, periodLabel, REPORT_KEYS, REPORTS, reportPeriod, utcToWallTime, type PeriodKind } from '@rental/core';
import { listLocations, runReport } from '@rental/db';
import type { TenantContext } from '@/server/context';
import { db } from '@/server/db';

export type ReportSearch = { r?: string; p?: string; from?: string; to?: string; loc?: string };

/**
 * One reading of the report URL (?r=&p=&from=&to=&loc=) shared by the page,
 * the CSV export and the PDF print page, so all three show the same figures.
 */
export async function loadReport(ctx: TenantContext, sp: ReportSearch) {
  const today = utcToWallTime(new Date(), ctx.tenant.timezone).date;
  const key = sp.r && REPORT_KEYS.has(sp.r) ? sp.r : 'month_to_date';
  const def = REPORTS.find((x) => x.key === key)!;
  const period: PeriodKind = PERIODS.some((x) => x.value === sp.p) ? (sp.p as PeriodKind) : 'this_month';
  const { from, to } = reportPeriod(period, today, { from: sp.from, to: sp.to });
  const locations = (await listLocations(db, ctx.tenant.id)).filter((l) => l.isActive);
  const locationId = locations.some((l) => l.id === sp.loc) ? sp.loc! : 'all';
  const result = await runReport(db, ctx.tenant.id, key, { from, to, locationId: locationId === 'all' ? null : locationId, currency: ctx.tenant.currency, today });
  const location = locations.find((l) => l.id === locationId)?.name ?? 'All locations';
  return {
    def, key, period, from, to, today, locationId, location, result,
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    label: def.asOf ? `As of ${periodLabel(today, today).replace(/ – \d+/, '')}` : periodLabel(from, to),
    query: new URLSearchParams({ r: key, p: period, ...(period === 'custom' ? { from, to } : {}), ...(locationId !== 'all' ? { loc: locationId } : {}) }).toString(),
  };
}
