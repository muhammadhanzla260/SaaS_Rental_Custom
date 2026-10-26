/**
 * Reports (design 32): the registry of the 32 reports, the period switch and
 * the one result shape every report returns (KPI tiles, optional chart, table
 * with totals). Revenue means booked revenue by event date — confirmed orders
 * (booked or completed), order total after tax and credits, as in the Odoo
 * month-to-date report (rental.mtd.report, state sale/done).
 */
import { addDays } from './time';

export const REPORT_GROUPS = ['Sales', 'General', 'Payment gateway', 'Customers', 'Products', 'Employees'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export type ReportDef = { key: string; group: ReportGroup; title: string; description: string; asOf?: boolean };

export const REPORTS: ReportDef[] = [
  { key: 'sales_overview', group: 'Sales', title: 'Sales Overview', description: 'Booked revenue by event date, broken down like the order total.' },
  { key: 'sales_by_range', group: 'Sales', title: 'Sales Overview by Date Range', description: 'Orders, revenue, collected and outstanding for each day.' },
  { key: 'month_to_date', group: 'Sales', title: 'Month to Date', description: 'Booked revenue by event date, compared with the same days last year.' },
  { key: 'sales_by_city', group: 'Sales', title: 'Sales by City', description: 'Where the events are: orders and revenue per city.' },
  { key: 'payment_breakdown', group: 'Sales', title: 'Payment Breakdown List', description: 'Money received in the period, by payment method, less refunds.' },
  { key: 'payments', group: 'General', title: 'Payments', description: 'Every payment received in the period.' },
  { key: 'receivables', group: 'General', title: 'Receivables', description: 'What customers still owe today, by how late it is.', asOf: true },
  { key: 'credits_rain_checks', group: 'General', title: 'Credits and Rain Checks', description: 'Credits issued in the period: issued, used and remaining.' },
  { key: 'order_list', group: 'General', title: 'Order List', description: 'Every order with an event in the period.' },
  { key: 'cancelled_orders', group: 'General', title: 'Cancelled Order List', description: 'Orders cancelled in the period and what happened to the money.' },
  { key: 'coupons', group: 'General', title: 'Coupon Report', description: 'Coupons used on booked orders, and what they took off.' },
  { key: 'tips', group: 'General', title: 'Event Date Tip Report', description: 'Tips for the party coach, by event date.' },
  { key: 'gateway_reconciliation', group: 'Payment gateway', title: 'Gateway Reconciliation', description: 'Card payments taken through the gateway, refunds and the net.' },
  { key: 'gateway_not_funded', group: 'Payment gateway', title: 'Gateway Not Funded List', description: 'Card payments the gateway has not paid out yet.' },
  { key: 'survey_answers', group: 'Customers', title: 'Survey Answers', description: 'Answers to the post-event survey.' },
  { key: 'customer_sales', group: 'Customers', title: 'Customer Sales', description: 'Revenue per customer for events in the period.' },
  { key: 'customer_list', group: 'Customers', title: 'Customer List', description: 'Customers added in the period, with their orders and value.' },
  { key: 'customer_emails', group: 'Customers', title: 'Customer Email List', description: 'Customer email addresses and whether they get emails.', asOf: true },
  { key: 'customer_info', group: 'Customers', title: 'Customer Info List', description: 'Contact details, address, tags and source for every customer.', asOf: true },
  { key: 'signatures', group: 'Customers', title: 'Digital Signature & Waiver List', description: 'Agreements signed online in the period, with the waiver choice.' },
  { key: 'quotes_incomplete', group: 'Customers', title: 'All Quotes and Incomplete Orders', description: 'Drafts and sent quotes with an event in the period.' },
  { key: 'quotes_sent', group: 'Customers', title: 'Quotes Sent List', description: 'Quotes sent in the period and whether they were booked.' },
  { key: 'abandoned_quotes', group: 'Customers', title: 'Abandoned Quotes Created', description: 'Quotes sent in the period that expired or whose date passed unbooked.' },
  { key: 'signed_contracts', group: 'Customers', title: 'Signed Contract Orders', description: 'Booked orders with an event in the period and a signed agreement.' },
  { key: 'unsigned_contracts', group: 'Customers', title: 'Unsigned Contract Orders', description: 'Booked orders with an event in the period and no signed agreement.' },
  { key: 'sales_by_category', group: 'Products', title: 'Sales by Category', description: 'Rental revenue per product category (order lines).' },
  { key: 'sales_by_item', group: 'Products', title: 'Sales by Item', description: 'Rental revenue and quantity per product.' },
  { key: 'items_inventory', group: 'Products', title: 'Sales Items Inventory', description: 'What you own against what was rented: utilisation per product.' },
  { key: 'inventory_usage', group: 'Products', title: 'Inventory Usage Totals', description: 'Times rented and hours out per product.' },
  { key: 'employee_payments', group: 'Employees', title: 'Employee Sales by Payments', description: 'Money collected in the period on each salesperson’s orders.' },
  { key: 'employee_orders', group: 'Employees', title: 'Employee Orders', description: 'Orders booked in the period, per salesperson.' },
  { key: 'commission', group: 'Employees', title: 'Sales Commission Report', description: 'Booked revenue by event date per salesperson and their commission.' },
];
export const REPORT_KEYS = new Set(REPORTS.map((r) => r.key));

export type PeriodKind = 'this_month' | 'last_month' | 'quarter' | 'year' | 'custom';
export const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' },
  { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }, { value: 'custom', label: 'Custom' },
];

/** The dates a period covers (inclusive), from `today` in the workspace's time zone. */
export function reportPeriod(kind: PeriodKind, today: string, custom?: { from?: string; to?: string }) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const lastOf = (yy: number, mm: number) => addDays(mm === 12 ? first(yy + 1, 1) : first(yy, mm + 1), -1);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  switch (kind) {
    case 'last_month': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: first(py, pm), to: lastOf(py, pm) };
    }
    case 'quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: first(y, qm), to: lastOf(y, qm + 2) };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'custom':
      if (custom?.from && custom.to && iso.test(custom.from) && iso.test(custom.to) && custom.from <= custom.to) return { from: custom.from, to: custom.to };
      return { from: first(y, m), to: lastOf(y, m) };
    default:
      return { from: first(y, m), to: lastOf(y, m) };
  }
}

/** "Oct 1 – 23, 2026" / "Sep 1 – Oct 31, 2026". */
export function periodLabel(from: string, to: string) {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const a = d(from);
  const b = d(to);
  const m = (x: Date) => x.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) return `${m(a)} ${a.getUTCDate()} – ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${m(a)} ${a.getUTCDate()}${a.getUTCFullYear() === b.getUTCFullYear() ? '' : `, ${a.getUTCFullYear()}`} – ${m(b)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
}

export type ReportValueKind = 'text' | 'money' | 'number' | 'percent' | 'date';
export type ReportColumn = { key: string; label: string; kind?: ReportValueKind };
export type ReportCell = string | number | null;
export type ReportResult = {
  subtitle?: string;
  kpis: { label: string; value: ReportCell; kind?: ReportValueKind; sub?: string; tone?: 'success' | 'warning' | 'danger' }[];
  chart?: { title: string; kind: 'money' | 'number'; points: { label: string; value: number }[] };
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals?: Record<string, ReportCell>;
  note?: string;
};

/** One cell as text (money in cents → $1,234.56). */
export function formatCell(v: ReportCell, kind: ReportValueKind | undefined, money: (c: number) => string) {
  if (v == null || v === '') return '';
  if (kind === 'money') return money(Number(v));
  if (kind === 'percent') return `${Number(v)}%`;
  if (kind === 'number') return Number(v).toLocaleString('en-US');
  if (kind === 'date') return new Date(`${String(v).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return String(v);
}

/** CSV with a header row and the totals row; money as plain decimals for spreadsheets. */
export function reportCsv(r: ReportResult) {
  const cell = (v: ReportCell, kind?: ReportValueKind) => {
    const s = v == null ? '' : kind === 'money' ? (Number(v) / 100).toFixed(2) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => cell(c.label)).join(',')];
  for (const row of r.rows) lines.push(r.columns.map((c) => cell(row[c.key] ?? null, c.kind)).join(','));
  if (r.totals) lines.push(r.columns.map((c, i) => cell(i === 0 ? 'Total' : r.totals![c.key] ?? null, c.kind)).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** A report as plain text for the Monday email: the tiles, the first rows and a link to the rest. */
export function reportText(title: string, label: string, result: ReportResult, money: (c: number) => string, url: string, maxRows = 10) {
  const out = [title.toUpperCase(), label, ''];
  for (const k of result.kpis) out.push(`${k.label}: ${formatCell(k.value, k.kind, money)}${k.sub ? ` (${k.sub})` : ''}`);
  if (result.rows.length) {
    out.push('');
    for (const row of result.rows.slice(0, maxRows)) {
      out.push(`• ${result.columns.map((c) => formatCell(row[c.key] ?? null, c.kind, money)).filter(Boolean).join(' · ')}`);
    }
    if (result.rows.length > maxRows) out.push(`…and ${result.rows.length - maxRows} more`);
  }
  out.push('', `Full report: ${url}`);
  return out.join('\n');
}
