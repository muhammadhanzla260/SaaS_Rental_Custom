import { formatCell, formatMoney, themeCss, type Corners } from '@rental/core';
import { PrintShell } from '@/components/money/print-shell';
import { loadReport, type ReportSearch } from '@/lib/reports';
import { pageContext } from '@/server/guards';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report', robots: { index: false, follow: false } };

/** A report on paper (the PDF button): tiles and the full table, outside the app shell. */
export default async function ReportPrintPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<ReportSearch> }) {
  const { tenant: slug } = await params;
  const ctx = await pageContext(slug, 'reports.view');
  const rep = await loadReport(ctx, await searchParams);
  const r = rep.result;
  const money = (c: number) => formatMoney(c, ctx.tenant.currency);
  const numeric = (kind?: string) => kind === 'money' || kind === 'number' || kind === 'percent';
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `${themeCss(ctx.tenant.brandColor, ctx.tenant.radius as Corners)} @page { size: landscape; margin: 12mm; }` }} />
      <PrintShell title={`${rep.def.title} · ${rep.label}`}>
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-subtle pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-2">{ctx.tenant.name}</p>
            <h1 className="mt-1 font-display text-[26px] font-extrabold tracking-tight text-fg">{rep.def.title}</h1>
            <p className="mt-1 text-[13px] text-fg-2">{r.subtitle ?? rep.def.description} · {rep.label} · {rep.location}</p>
          </div>
          <p className="text-[12px] text-fg-2">Printed {formatCell(rep.today, 'date', money)}</p>
        </header>
        {r.kpis.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {r.kpis.map((k) => (
              <div key={k.label} className="rounded-[var(--radius-card)] border border-subtle px-3 py-2.5">
                <dt className="text-[12px] text-fg-2">{k.label}</dt>
                <dd className="mono mt-0.5 text-[18px] font-semibold text-fg">{formatCell(k.value, k.kind, money) || '—'}</dd>
                {k.sub && <dd className="text-[11px] text-fg-2">{k.sub}</dd>}
              </div>
            ))}
          </dl>
        )}
        {r.rows.length === 0 ? (
          <p className="mt-6 text-sm text-fg-2">Nothing in this period.</p>
        ) : (
          <table className="mt-5 w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-control">
                {r.columns.map((c) => <th key={c.key} scope="col" className={`px-2 py-1.5 font-semibold text-fg-2 ${numeric(c.kind) ? 'text-right' : 'text-left'}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row, i) => (
                <tr key={i} className="break-inside-avoid border-b border-subtle">
                  {r.columns.map((c) => <td key={c.key} className={`px-2 py-1.5 text-fg ${numeric(c.kind) ? 'mono whitespace-nowrap text-right' : ''}`}>{formatCell(row[c.key] ?? null, c.kind, money)}</td>)}
                </tr>
              ))}
            </tbody>
            {r.totals && (
              <tfoot>
                <tr className="border-t-2 border-control font-semibold">
                  {r.columns.map((c, i) => <td key={c.key} className={`px-2 py-2 text-fg ${numeric(c.kind) ? 'mono whitespace-nowrap text-right' : ''}`}>{i === 0 ? 'Total' : formatCell(r.totals![c.key] ?? null, c.kind, money)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        )}
        {r.note && <p className="mt-4 text-[11px] text-fg-2">{r.note}</p>}
      </PrintShell>
    </>
  );
}
