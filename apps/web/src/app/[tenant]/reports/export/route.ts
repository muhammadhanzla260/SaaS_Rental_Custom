import { reportCsv } from '@rental/core';
import { loadReport } from '@/lib/reports';
import { pageContext } from '@/server/guards';

export const dynamic = 'force-dynamic';

/** Export CSV: the report on screen (same period and location), every row, with the totals line. */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await pageContext(slug, 'reports.view');
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rep = await loadReport(ctx, sp);
  const name = `${rep.def.title} ${rep.def.asOf ? rep.today : `${rep.from} to ${rep.to}`}`.replace(/[^\w -]+/g, '').replace(/\s+/g, '-').toLowerCase();
  // A byte-order mark so Excel opens names with accents correctly.
  return new Response(`﻿${reportCsv(rep.result)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
