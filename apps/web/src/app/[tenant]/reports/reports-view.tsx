'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Download, FileText, Mail, Search } from 'lucide-react';
import { useState, useTransition } from 'react';
import { PERIODS, type PeriodKind } from '@rental/core';
import { Button, buttonClass, Card, cx, EmptyState, Input, Segmented, Select, useToast } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { scheduleReportAction } from '@/server/actions/reports';

export type ReportView = {
  key: string; title: string; description: string; asOf: boolean; subtitle: string | null;
  kpis: { label: string; value: string; sub: string | null; tone: 'success' | 'warning' | 'danger' | null }[];
  chart: { title: string; top: number; axisTop: string; axisMid: string; zero: string; points: { label: string; value: number; tip: string }[] } | null;
  columns: { key: string; label: string; numeric: boolean }[];
  rows: string[][];
  totals: string[] | null;
  rowCount: number;
  note: string | null;
};

const KPI_TONE = { success: 'text-success-fg', warning: 'text-warning-fg', danger: 'text-danger' } as const;

/** Bars like the design: the highest one in the accent, a tooltip with the exact figure on hover or focus. */
function BarChart({ chart }: { chart: NonNullable<ReportView['chart']> }) {
  const max = Math.max(...chart.points.map((p) => p.value));
  const sparse = chart.points.length > 12;
  return (
    <Card className="anim-rise flex flex-col gap-3 p-4 sm:p-5" aria-label={chart.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-fg">{chart.title}</h3>
        <span className="text-xs text-fg-2">Hover a bar for the exact amount</span>
      </div>
      <div className="flex h-[200px] gap-2.5">
        <div className="mono flex min-w-11 flex-col justify-between pb-5 text-right text-[10px] text-fg-2" aria-hidden>
          <span>{chart.axisTop}</span><span>{chart.axisMid}</span><span>{chart.zero}</span>
        </div>
        <div role="img" aria-label={`${chart.title}: ${chart.points.map((p) => p.tip).join(', ')}`} className="flex flex-1 items-stretch gap-1 border-b border-subtle bg-[linear-gradient(var(--color-sunken)_1px,transparent_1px)] bg-[length:100%_50%]">
          {chart.points.map((p, i) => (
            <div key={`${p.label}-${i}`} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="mono pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-night px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition group-hover:-translate-y-1 group-hover:opacity-100">{p.tip}</span>
              <span
                className={cx('w-full max-w-[26px] origin-bottom rounded-t-[5px] rounded-b-[2px] transition-[filter] group-hover:brightness-110', p.value === max && max > 0 ? 'bg-accent' : 'bg-accent/40')}
                style={{ height: `calc(${(p.value / chart.top) * 100}% - 20px)`, minHeight: p.value > 0 ? 2 : 0 }}
              />
              <span className="mono h-3.5 max-w-full truncate text-[9.5px] text-fg-2">{sparse && i % 3 !== 0 ? '' : p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function ReportsView({
  slug, groups, report, period, from, to, periodLabel, locations, locationId, location, query, scheduled, canSchedule,
}: {
  slug: string; groups: { label: string; items: { key: string; title: string }[] }[]; report: ReportView;
  period: PeriodKind; from: string; to: string; periodLabel: string; locations: { id: string; name: string }[]; locationId: string; location: string;
  query: string; scheduled: string[]; canSchedule: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [range, setRange] = useState({ from, to });
  const [sched, setSched] = useState(() => new Set(scheduled));
  const [busy, setBusy] = useState(false);
  const isScheduled = sched.has(report.key);

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) (v == null ? p.delete(k) : p.set(k, v));
    if (p.get('p') !== 'custom') { p.delete('from'); p.delete('to'); }
    return `/${slug}/reports?${p}`;
  };
  const go = (patch: Record<string, string | null>) => start(() => router.push(href(patch), { scroll: false }));

  async function toggleSchedule() {
    setBusy(true);
    const r = await scheduleReportAction(slug, { key: report.key, on: !isScheduled, period: period === 'custom' ? 'this_month' : period, locationId: locationId === 'all' ? null : locationId });
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    setSched((s) => { const n = new Set(s); if (isScheduled) n.delete(report.key); else n.add(report.key); return n; });
    toast(r.message ?? 'Saved.');
  }

  const needle = q.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, items: g.items.filter((x) => !needle || x.title.toLowerCase().includes(needle)) })).filter((g) => g.items.length);

  return (
    <>
      <Topbar crumbs={[{ label: 'Reports' }]} />
      <PageBody wide>
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <h1 className="font-display text-[26px] font-extrabold tracking-tight text-fg sm:text-[32px]">Reports</h1>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <Segmented label="Period" value={period} onChange={(v) => (v === 'custom' ? go({ p: 'custom', from: range.from, to: range.to }) : go({ p: v }))} options={PERIODS} />
            {locations.length > 1 && (
              <Select aria-label="Location" value={locationId} onChange={(e) => go({ loc: e.target.value === 'all' ? null : e.target.value })} className="h-10 w-44">
                <option value="all">All locations</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </div>
        </div>
        {period === 'custom' && (
          <form
            className="mb-5 flex flex-wrap items-end justify-end gap-2"
            onSubmit={(e) => { e.preventDefault(); go({ p: 'custom', from: range.from, to: range.to }); }}
          >
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-fg">From
              <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-10 w-44" required />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-fg">To
              <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-10 w-44" required />
            </label>
            <Button type="submit" variant="secondary" pending={pending}>Apply</Button>
          </form>
        )}

        <div className="flex flex-wrap items-start gap-5">
          <nav aria-label="Reports" className="flex max-w-full flex-[1_1_230px] flex-col gap-0.5 lg:max-w-[260px]">
            <label className="relative mb-1">
              <span className="sr-only">Find a report</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report" className="h-10 pl-9" />
            </label>
            {shown.length === 0 && <p className="px-3 py-2 text-[13px] text-fg-2">No report matches “{q}”.</p>}
            {shown.map((g) => (
              <div key={g.label} className="flex flex-col gap-0.5">
                <span className="px-3 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-fg-2">{g.label}</span>
                {g.items.map((x) => {
                  const on = x.key === report.key;
                  return (
                    <Link
                      key={x.key}
                      href={href({ r: x.key })}
                      scroll={false}
                      aria-current={on ? 'page' : undefined}
                      className={cx('flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] transition-colors', on ? 'bg-surface font-semibold text-fg shadow-[0_1px_3px_rgb(16_19_26/0.08)]' : 'font-medium text-fg-2 hover:bg-hover hover:text-fg')}
                    >
                      <span className={cx('size-1.5 shrink-0 rounded-full', on ? 'bg-accent' : sched.has(x.key) ? 'bg-success' : 'bg-control')} aria-hidden />
                      <span className="min-w-0 flex-1">{x.title}</span>
                      {sched.has(x.key) && <Mail className="size-3.5 shrink-0 text-success-fg" aria-label="Emailed weekly" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <main className={cx('flex min-w-0 flex-[999_1_560px] flex-col gap-4 transition-opacity', pending && 'opacity-60')} aria-busy={pending}>
            <div className="anim-rise flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="font-display text-[26px] font-extrabold tracking-tight text-fg sm:text-[30px]">{report.title}</h2>
                <span className="text-[13px] text-fg-2">{report.subtitle ?? report.description} · {periodLabel}{locations.length > 1 ? ` · ${location}` : ''}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/${slug}/reports/export?${query}`} download className={buttonClass('secondary', 'sm')}><Download className="size-4" /> Export CSV</a>
                <a href={`/print/${slug}/reports?${query}`} target="_blank" rel="noopener" className={buttonClass('secondary', 'sm')}><FileText className="size-4" /> PDF</a>
                <Button
                  size="sm"
                  variant="secondary"
                  pending={busy}
                  disabled={!canSchedule}
                  onClick={toggleSchedule}
                  aria-pressed={isScheduled}
                  className={isScheduled ? 'border-success/40 bg-success-bg text-success-fg hover:bg-success-bg' : undefined}
                  icon={isScheduled ? <Check className="size-4" /> : <Mail className="size-4" />}
                >
                  {isScheduled ? 'Emailed Mondays' : 'Email weekly'}
                </Button>
              </div>
            </div>
            {report.asOf && <p className="-mt-2 text-xs text-fg-2">This report is always as of today; the period switch does not change it.</p>}

            {report.kpis.length > 0 && (
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3">
                {report.kpis.map((k, i) => (
                  <div key={k.label} className="anim-rise flex flex-col gap-1 rounded-[var(--radius-card)] border border-subtle bg-surface px-4 py-3.5" style={{ animationDelay: `${i * 50}ms` }}>
                    <span className="text-[13px] text-fg-2">{k.label}</span>
                    <span className={cx('mono truncate text-[24px] font-semibold', k.tone ? KPI_TONE[k.tone] : 'text-fg')} title={k.value}>{k.value}</span>
                    {k.sub && <span className="text-xs text-fg-2">{k.sub}</span>}
                  </div>
                ))}
              </div>
            )}

            {report.chart && <BarChart chart={report.chart} />}

            <Card className="anim-rise overflow-hidden" aria-label="Report rows">
              {report.rows.length === 0 ? (
                <EmptyState icon={<FileText className="size-6" />} title="Nothing in this period" sub="Try another period or location." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-sunken/60">
                        {report.columns.map((c) => (
                          <th key={c.key} scope="col" className={cx('whitespace-nowrap px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-fg-2', c.numeric ? 'text-right' : 'text-left')}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row, i) => (
                        <tr key={i} className="border-t border-subtle hover:bg-hover/60">
                          {row.map((v, j) => (
                            <td key={j} className={cx('px-4 py-2.5', report.columns[j]!.numeric ? 'mono whitespace-nowrap text-right' : 'text-fg', j === 0 && 'font-medium')}>{v}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {report.totals && (
                      <tfoot>
                        <tr className="border-t-2 border-control bg-sunken/40 font-semibold">
                          {report.totals.map((v, j) => (
                            <td key={j} className={cx('px-4 py-3', report.columns[j]!.numeric ? 'mono whitespace-nowrap text-right' : 'text-fg')}>{v}</td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </Card>
            {report.rowCount > report.rows.length && (
              <p className="text-xs text-fg-2">Showing {report.rows.length.toLocaleString('en-US')} of {report.rowCount.toLocaleString('en-US')} rows. Export CSV for all of them.</p>
            )}
            {report.note && <p className="text-xs leading-relaxed text-fg-2">{report.note}</p>}
          </main>
        </div>
      </PageBody>
    </>
  );
}
