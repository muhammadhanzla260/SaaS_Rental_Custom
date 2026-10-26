import { formatCell, formatMoney, REPORT_GROUPS, REPORTS, type ReportResult } from '@rental/core';
import { listReportSchedules } from '@rental/db';
import { loadReport, type ReportSearch } from '@/lib/reports';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { ReportsView, type ReportView } from './reports-view';

export const metadata = { title: 'Reports' };

/** Rows drawn on the page; the CSV export has all of them. */
const PAGE_ROWS = 500;

/** Bars on a rounded scale (1, 2 or 5 × a power of ten), with whole-number axis labels. */
function chartView(chart: NonNullable<ReportResult['chart']>, money: (c: number) => string): NonNullable<ReportView['chart']> {
  const fmt = (v: number) => (chart.kind === 'money' ? money(v).replace(/\.00$/, '') : v.toLocaleString('en-US'));
  const max = Math.max(0, ...chart.points.map((p) => p.value));
  const unit = 10 ** Math.floor(Math.log10(Math.max(max, 1)));
  const top = max <= 0 ? 1 : ([1, 2, 5, 10].map((m) => m * unit).find((t) => t >= max) ?? 10 * unit);
  return {
    title: chart.title, top, axisTop: fmt(top), axisMid: fmt(top / 2), zero: fmt(0),
    points: chart.points.map((p) => ({ label: p.label, value: p.value, tip: `${p.label} · ${chart.kind === 'money' ? money(p.value) : p.value.toLocaleString('en-US')}` })),
  };
}

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<ReportSearch> }) {
  const { tenant: slug } = await params;
  const ctx = await pageContext(slug, 'reports.view');
  const [rep, schedules] = await Promise.all([loadReport(ctx, await searchParams), listReportSchedules(db, ctx.tenant.id)]);
  const money = (c: number) => formatMoney(c, ctx.tenant.currency);
  const r = rep.result;
  const numeric = (kind?: string) => kind === 'money' || kind === 'number' || kind === 'percent';
  const view: ReportView = {
    key: rep.key, title: rep.def.title, description: rep.def.description, asOf: !!rep.def.asOf, subtitle: r.subtitle ?? null,
    kpis: r.kpis.map((k) => ({ label: k.label, value: formatCell(k.value, k.kind, money) || '—', sub: k.sub ?? null, tone: k.tone ?? null })),
    chart: r.chart && r.chart.points.length ? chartView(r.chart, money) : null,
    columns: r.columns.map((c) => ({ key: c.key, label: c.label, numeric: numeric(c.kind) })),
    rows: r.rows.slice(0, PAGE_ROWS).map((row) => r.columns.map((c) => formatCell(row[c.key] ?? null, c.kind, money))),
    totals: r.totals ? r.columns.map((c, i) => (i === 0 ? 'Total' : formatCell(r.totals![c.key] ?? null, c.kind, money))) : null,
    rowCount: r.rows.length,
    note: r.note ?? null,
  };
  return (
    <ReportsView
      slug={slug}
      groups={REPORT_GROUPS.map((g) => ({ label: g, items: REPORTS.filter((x) => x.group === g).map((x) => ({ key: x.key, title: x.title })) }))}
      report={view}
      period={rep.period}
      from={rep.from}
      to={rep.to}
      periodLabel={rep.label}
      locations={rep.locations}
      locationId={rep.locationId}
      location={rep.location}
      query={rep.query}
      scheduled={schedules.map((s) => s.reportKey)}
      canSchedule={!ctx.readOnly}
    />
  );
}
