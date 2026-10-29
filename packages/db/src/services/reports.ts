/**
 * Phase 3 · Reports (design 32). One query per report, filtered by workspace,
 * location and period, returning the shared ReportResult (KPI tiles, chart,
 * table with totals). Money stays in cents end to end so totals reconcile with
 * Invoices / Payments to the cent.
 *
 * "Revenue" = booked revenue by event date: orders booked or completed whose
 * event falls in the period (in the location's time zone), at the order total
 * after tax and credits — the Odoo month-to-date definition (state sale/done).
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { addDays, formatMoney, periodLabel, REPORTS, reportPeriod, reportText, type PeriodKind, type ReportResult } from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { locations, reportSchedules } from '../schema';
import { audit, type Actor } from './audit';
import { enqueueOfficeAlert } from './messaging';

export type ReportFilters = { from: string; to: string; locationId?: string | null; currency: string; today: string };

type R = Record<string, string | number | null>;
const rowsOf = async (tx: Tx, q: SQL) => [...(await tx.execute<R>(q))] as R[];
const n = (v: unknown) => Number(v ?? 0);
const sum = (rows: R[], k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** Joins and filters every order-based report shares. */
function ctx(tenantId: string, f: ReportFilters) {
  const zone = sql`coalesce(l.timezone, t.timezone)`;
  const local = (col: SQL) => sql`(${col} at time zone ${zone})::date`;
  return {
    from: sql`from orders o join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id`,
    where: sql`o.tenant_id = ${tenantId}::uuid ${f.locationId ? sql`and o.location_id = ${f.locationId}::uuid` : sql``}`,
    local,
    event: local(sql`o.event_starts_at`),
    inPeriod: (col: SQL) => sql`${local(col)} between ${f.from}::date and ${f.to}::date`,
    confirmed: sql`o.status in ('booked','completed')`,
  };
}

type Builder = (tx: Tx, tenantId: string, f: ReportFilters, money: (c: number) => string) => Promise<ReportResult>;

const builders: Record<string, Builder> = {
  // --- Sales --------------------------------------------------------------------------------------------
  async sales_overview(tx, tenantId, f, money) {
    const c = ctx(tenantId, f);
    const [a] = await rowsOf(tx, sql`select count(*)::int as orders, coalesce(sum(o.merchandise_cents),0)::float8 as merch, coalesce(sum(o.extras_cents),0)::float8 as fees,
        coalesce(sum(o.discount_cents),0)::float8 as disc, coalesce(sum(o.credit_cents),0)::float8 as credits, coalesce(sum(o.tax_cents),0)::float8 as tax,
        coalesce(sum(o.total_cents),0)::float8 as total, coalesce(sum(o.paid_cents),0)::float8 as paid
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)}`);
    const weeks = await rowsOf(tx, sql`select date_trunc('week', ${c.event})::date::text as wk, sum(o.total_cents)::float8 as total
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by 1`);
    const total = n(a!.total);
    const rows = [
      { line: 'Rental items', amount: n(a!.merch) },
      { line: 'Fees (waiver, travel, surfaces, location)', amount: n(a!.fees) },
      { line: 'Discounts and coupons', amount: -n(a!.disc) },
      { line: 'Sales tax', amount: n(a!.tax) },
      { line: 'Rain checks and credits applied', amount: -n(a!.credits) },
    ];
    return {
      kpis: [
        { label: 'Revenue', value: total, kind: 'money' }, { label: 'Orders', value: n(a!.orders), kind: 'number', sub: n(a!.orders) ? `avg ${money(Math.round(total / n(a!.orders)))} per order` : undefined },
        { label: 'Collected', value: n(a!.paid), kind: 'money', tone: 'success', sub: `${pct(n(a!.paid), total)}% of revenue` },
        { label: 'Sales tax', value: n(a!.tax), kind: 'money' },
      ],
      chart: { title: 'Revenue per week (event date)', kind: 'money', points: weeks.map((w) => ({ label: String(w.wk).slice(5), value: n(w.total) })) },
      columns: [{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Amount', kind: 'money' }],
      rows, totals: { amount: rows.reduce((s, r) => s + r.amount, 0) },
      note: 'Totals follow each order’s price breakdown; Revenue is the order total after tax and credits.',
    };
  },

  async sales_by_range(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const days = await rowsOf(tx, sql`select ${c.event}::text as day, count(*)::int as orders, sum(o.total_cents)::float8 as revenue, sum(o.paid_cents)::float8 as collected,
        sum(greatest(o.total_cents - o.paid_cents, 0))::float8 as outstanding
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by 1`);
    return {
      kpis: [{ label: 'Revenue', value: sum(days, 'revenue'), kind: 'money' }, { label: 'Orders', value: sum(days, 'orders'), kind: 'number' },
        { label: 'Collected', value: sum(days, 'collected'), kind: 'money', tone: 'success' }, { label: 'Outstanding', value: sum(days, 'outstanding'), kind: 'money', tone: 'warning' }],
      chart: { title: 'Revenue per day', kind: 'money', points: days.map((d) => ({ label: String(d.day).slice(8), value: n(d.revenue) })) },
      columns: [{ key: 'day', label: 'Event date', kind: 'date' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'revenue', label: 'Revenue', kind: 'money' },
        { key: 'collected', label: 'Collected', kind: 'money' }, { key: 'outstanding', label: 'Outstanding', kind: 'money' }],
      rows: days, totals: { orders: sum(days, 'orders'), revenue: sum(days, 'revenue'), collected: sum(days, 'collected'), outstanding: sum(days, 'outstanding') },
    };
  },

  async month_to_date(tx, tenantId, f, money) {
    // Month to date: the month of `from`, up to today when it is the current month.
    const monthStart = `${f.from.slice(0, 7)}-01`;
    const cap = f.today.slice(0, 7) === monthStart.slice(0, 7) ? f.today : f.to;
    const g = { ...f, from: monthStart, to: cap };
    const c = ctx(tenantId, g);
    const days = await rowsOf(tx, sql`select ${c.event}::text as day, sum(o.total_cents)::float8 as revenue
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by 1`);
    const locs = await rowsOf(tx, sql`select l.name as location, count(*)::int as orders, sum(o.total_cents)::float8 as revenue, sum(o.paid_cents)::float8 as collected,
        sum(greatest(o.total_cents - o.paid_cents, 0))::float8 as outstanding, count(*) filter (where o.total_cents > o.paid_cents)::int as unpaid
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by l.name order by revenue desc`);
    const ly = { ...g, from: `${Number(monthStart.slice(0, 4)) - 1}${monthStart.slice(4)}`, to: `${Number(cap.slice(0, 4)) - 1}${cap.slice(4)}` };
    const cl = ctx(tenantId, ly);
    const [last] = await rowsOf(tx, sql`select coalesce(sum(o.total_cents),0)::float8 as revenue ${cl.from} where ${cl.where} and ${cl.confirmed} and ${cl.inPeriod(sql`o.event_starts_at`)}`);
    const revenue = sum(locs, 'revenue');
    const orders = sum(locs, 'orders');
    const change = n(last!.revenue) ? Math.round(((revenue - n(last!.revenue)) / n(last!.revenue)) * 100) : null;
    // One bar per calendar day (empty days included), so the bars always sum to the Revenue tile.
    const byDay = new Map(days.map((d) => [String(d.day), n(d.revenue)]));
    const points: { label: string; value: number }[] = [];
    for (let d = monthStart; d <= cap; d = addDays(d, 1)) points.push({ label: String(Number(d.slice(8))), value: byDay.get(d) ?? 0 });
    const monthName = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    return {
      subtitle: `Booked revenue by event date · ${monthName} 1 – ${Number(cap.slice(8))}`,
      kpis: [
        { label: 'Revenue', value: revenue, kind: 'money', sub: change == null ? 'No bookings this time last year' : `${change >= 0 ? '+' : '−'}${Math.abs(change)}% vs last ${monthName}` },
        { label: 'Orders', value: orders, kind: 'number', sub: orders ? `avg ${money(Math.round(revenue / orders))} per order` : undefined },
        { label: 'Collected', value: sum(locs, 'collected'), kind: 'money', tone: 'success', sub: `${pct(sum(locs, 'collected'), revenue)}% of revenue` },
        { label: 'Outstanding', value: sum(locs, 'outstanding'), kind: 'money', tone: 'warning', sub: `${sum(locs, 'unpaid')} orders` },
      ],
      chart: { title: `Revenue per day, ${monthName}`, kind: 'money', points },
      columns: [{ key: 'location', label: 'Location' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'revenue', label: 'Revenue', kind: 'money' },
        { key: 'collected', label: 'Collected', kind: 'money' }, { key: 'outstanding', label: 'Outstanding', kind: 'money' }],
      rows: locs.map(({ unpaid: _u, ...r }) => r),
      totals: { orders, revenue, collected: sum(locs, 'collected'), outstanding: sum(locs, 'outstanding') },
    };
  },

  async sales_by_city(tx, tenantId, f, money) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce(nullif(o.event_city, ''), 'No city') as city, count(*)::int as orders, sum(o.total_cents)::float8 as revenue
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by revenue desc`);
    const revenue = sum(rows, 'revenue');
    return {
      kpis: [{ label: 'Cities', value: rows.length, kind: 'number' }, { label: 'Revenue', value: revenue, kind: 'money' },
        { label: 'Top city', value: rows[0] ? String(rows[0].city) : '—', sub: rows[0] ? `${money(n(rows[0].revenue))} · ${pct(n(rows[0].revenue), revenue)}%` : undefined }],
      chart: { title: 'Revenue by city', kind: 'money', points: rows.slice(0, 12).map((r) => ({ label: String(r.city), value: n(r.revenue) })) },
      columns: [{ key: 'city', label: 'City' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'revenue', label: 'Revenue', kind: 'money' }, { key: 'share', label: 'Share', kind: 'percent' }],
      rows: rows.map((r) => ({ ...r, share: pct(n(r.revenue), revenue) })), totals: { orders: sum(rows, 'orders'), revenue, share: 100 },
    };
  },

  async payment_breakdown(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const pays = await rowsOf(tx, sql`select case when p.card_last4 is not null then 'Card' else initcap(p.method) end as method, count(*)::int as count,
        sum(p.amount_cents)::float8 as amount, sum(p.tip_cents)::float8 as tips
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and p.status = 'received' and ${c.inPeriod(sql`p.received_at`)} group by 1 order by amount desc`);
    const [rf] = await rowsOf(tx, sql`select count(*)::int as count, coalesce(sum(r.amount_cents),0)::float8 as amount
      from refunds r join orders o on o.tenant_id = r.tenant_id and o.id = r.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and ${c.inPeriod(sql`r.created_at`)}`);
    const rows: R[] = [...pays, ...(n(rf!.count) ? [{ method: 'Refunds', count: n(rf!.count), amount: -n(rf!.amount), tips: 0 }] : [])];
    return {
      kpis: [{ label: 'Received', value: sum(pays, 'amount'), kind: 'money', tone: 'success' }, { label: 'Tips', value: sum(pays, 'tips'), kind: 'money' },
        { label: 'Refunded', value: n(rf!.amount), kind: 'money', tone: 'danger' }, { label: 'Net', value: sum(pays, 'amount') - n(rf!.amount), kind: 'money' }],
      chart: { title: 'By method', kind: 'money', points: pays.map((p) => ({ label: String(p.method), value: n(p.amount) })) },
      columns: [{ key: 'method', label: 'Method' }, { key: 'count', label: 'Payments', kind: 'number' }, { key: 'amount', label: 'Amount', kind: 'money' }, { key: 'tips', label: 'Tips', kind: 'money' }],
      rows, totals: { count: sum(rows, 'count'), amount: sum(rows, 'amount'), tips: sum(rows, 'tips') },
      note: 'By the date the money was received. Tips are on top of the payment and not part of order revenue.',
    };
  },

  // --- General ---------------------------------------------------------------------------------------------
  async payments(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select p.number, ${c.local(sql`p.received_at`)}::text as date, c.display_name as customer, o.number as order_number,
        case when p.card_last4 is not null then coalesce(initcap(p.card_brand), 'Card') || ' •' || p.card_last4 else initcap(p.method) end as method,
        p.amount_cents::float8 as amount, p.tip_cents::float8 as tip, initcap(p.status) as status
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and ${c.inPeriod(sql`p.received_at`)} order by p.received_at desc`);
    const ok = rows.filter((r) => r.status === 'Received');
    return {
      kpis: [{ label: 'Payments', value: ok.length, kind: 'number' }, { label: 'Collected', value: sum(ok, 'amount'), kind: 'money', tone: 'success' }, { label: 'Tips', value: sum(ok, 'tip'), kind: 'money' }],
      columns: [{ key: 'number', label: 'Receipt' }, { key: 'date', label: 'Received', kind: 'date' }, { key: 'customer', label: 'Customer' }, { key: 'order_number', label: 'Order' },
        { key: 'method', label: 'Method' }, { key: 'amount', label: 'Amount', kind: 'money' }, { key: 'tip', label: 'Tip', kind: 'money' }, { key: 'status', label: 'Status' }],
      rows, totals: { amount: sum(ok, 'amount'), tip: sum(ok, 'tip') },
    };
  },

  async receivables(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select i.number as invoice, o.number as order_number, c.display_name as customer, ${c.event}::text as event_date, i.due_on::text as due_on,
        (i.amount_cents - i.paid_cents)::float8 as balance, (${f.today}::date - i.due_on)::int as late
      from invoices i join orders o on o.tenant_id = i.tenant_id and o.id = i.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and ${c.confirmed} and i.status in ('open','overdue') and i.amount_cents > i.paid_cents order by i.due_on`);
    const bucket = (late: number) => (late <= 0 ? 'Not due' : late <= 7 ? '1–7 d' : late <= 30 ? '8–30 d' : late <= 60 ? '31–60 d' : '60+ d');
    const buckets = ['Not due', '1–7 d', '8–30 d', '31–60 d', '60+ d'];
    const withB: R[] = rows.map((r) => ({ ...r, bucket: bucket(n(r.late)) }));
    const by = (b: string) => withB.filter((r) => r.bucket === b).reduce((s, r) => s + n(r.balance), 0);
    return {
      subtitle: 'What customers owe today, by days past the invoice due date',
      kpis: buckets.map((b) => ({ label: b, value: by(b), kind: 'money' as const, tone: b === 'Not due' ? undefined : b === '1–7 d' ? 'warning' as const : 'danger' as const })),
      chart: { title: 'Aging', kind: 'money', points: buckets.map((b) => ({ label: b, value: by(b) })) },
      columns: [{ key: 'invoice', label: 'Invoice' }, { key: 'order_number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'event_date', label: 'Event', kind: 'date' },
        { key: 'due_on', label: 'Due', kind: 'date' }, { key: 'bucket', label: 'Age' }, { key: 'balance', label: 'Balance', kind: 'money' }],
      rows: withB.map(({ late: _l, ...r }) => r), totals: { balance: sum(rows, 'balance') },
      note: 'Open and overdue invoice balances on booked orders. Same figures as Invoices & payments → Outstanding.',
    };
  },

  async credits_rain_checks(tx, tenantId, f) {
    const loc = f.locationId ? sql`and exists (select 1 from orders so where so.tenant_id = cr.tenant_id and so.id = cr.source_order_id and so.location_id = ${f.locationId}::uuid)` : sql``;
    const rows = await rowsOf(tx, sql`select cr.code, upper(left(cr.kind, 1)) || replace(substr(cr.kind, 2), '_', ' ') as kind, c.display_name as customer,
        (cr.created_at at time zone t.timezone)::date::text as issued, cr.amount_cents::float8 as amount,
        coalesce((select sum(ca.amount_cents) from credit_applications ca join orders uo on uo.tenant_id = ca.tenant_id and uo.id = ca.order_id
                  where ca.tenant_id = cr.tenant_id and ca.credit_id = cr.id and uo.status in ('booked','completed')), 0)::float8 as used,
        cr.valid_until::text as valid_until,
        case when cr.voided_at is not null then 'Voided' when cr.valid_until < ${f.today}::date then 'Expired' else 'Active' end as status
      from credits cr join customers c on c.tenant_id = cr.tenant_id and c.id = cr.customer_id join tenants t on t.id = cr.tenant_id
      where cr.tenant_id = ${tenantId}::uuid ${loc} and (cr.created_at at time zone t.timezone)::date between ${f.from}::date and ${f.to}::date
      order by cr.created_at desc`);
    const out: R[] = rows.map((r) => ({ ...r, remaining: r.status === 'Active' ? Math.max(0, n(r.amount) - n(r.used)) : 0 }));
    return {
      kpis: [{ label: 'Issued', value: sum(out, 'amount'), kind: 'money' }, { label: 'Used', value: sum(out, 'used'), kind: 'money', tone: 'success' },
        { label: 'Remaining', value: sum(out, 'remaining'), kind: 'money', tone: 'warning' },
        { label: 'Rain checks', value: out.filter((r) => r.kind === 'Rain check').length, kind: 'number' }],
      columns: [{ key: 'code', label: 'Code' }, { key: 'kind', label: 'Kind' }, { key: 'customer', label: 'Customer' }, { key: 'issued', label: 'Issued', kind: 'date' },
        { key: 'amount', label: 'Issued', kind: 'money' }, { key: 'used', label: 'Used', kind: 'money' }, { key: 'remaining', label: 'Remaining', kind: 'money' },
        { key: 'valid_until', label: 'Valid until', kind: 'date' }, { key: 'status', label: 'Status' }],
      rows: out, totals: { amount: sum(out, 'amount'), used: sum(out, 'used'), remaining: sum(out, 'remaining') },
      note: 'Used = applied to orders that are booked or completed. Expired and voided credits have nothing remaining.',
    };
  },

  async order_list(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, ${c.event}::text as event_date, initcap(replace(o.status, '_', ' ')) as status, l.name as location,
        o.total_cents::float8 as total, o.paid_cents::float8 as paid, greatest(o.total_cents - o.paid_cents, 0)::float8 as balance,
        (select u.name from users u where u.id = o.salesperson_user_id) as salesperson
      ${c.from} where ${c.where} and o.status <> 'draft' and ${c.inPeriod(sql`o.event_starts_at`)} order by o.event_starts_at`);
    return {
      kpis: [{ label: 'Orders', value: rows.length, kind: 'number' }, { label: 'Booked', value: rows.filter((r) => r.status === 'Booked' || r.status === 'Completed').length, kind: 'number' },
        { label: 'Value', value: sum(rows, 'total'), kind: 'money' }],
      columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'event_date', label: 'Event', kind: 'date' }, { key: 'status', label: 'Status' },
        { key: 'location', label: 'Location' }, { key: 'salesperson', label: 'Salesperson' }, { key: 'total', label: 'Total', kind: 'money' }, { key: 'paid', label: 'Paid', kind: 'money' },
        { key: 'balance', label: 'Balance', kind: 'money' }],
      rows, totals: { total: sum(rows, 'total'), paid: sum(rows, 'paid'), balance: sum(rows, 'balance') },
    };
  },

  async cancelled_orders(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, ${c.local(sql`o.cancelled_at`)}::text as cancelled, ${c.event}::text as event_date,
        coalesce(o.cancel_reason, '') as reason,
        case o.cancel_outcome when 'wallet' then 'Wallet credit' when 'refund' then 'Refund' when 'rain_check' then 'Rain check' else 'Nothing paid' end as outcome,
        (select coalesce(sum(cr.amount_cents), 0) from credits cr where cr.tenant_id = o.tenant_id and cr.source_order_id = o.id and cr.voided_at is null)::float8 as credited,
        (select coalesce(sum(r.amount_cents), 0) from refunds r where r.tenant_id = o.tenant_id and r.order_id = o.id)::float8 as refunded,
        o.total_cents::float8 as total
      ${c.from} where ${c.where} and o.status = 'cancelled' and o.cancelled_at is not null and ${c.inPeriod(sql`o.cancelled_at`)} order by o.cancelled_at desc`);
    return {
      kpis: [{ label: 'Cancelled', value: rows.length, kind: 'number' }, { label: 'Rained out', value: rows.filter((r) => r.outcome === 'Rain check').length, kind: 'number' },
        { label: 'Credited', value: sum(rows, 'credited'), kind: 'money' }, { label: 'Refunded', value: sum(rows, 'refunded'), kind: 'money', tone: 'danger' }],
      columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'cancelled', label: 'Cancelled', kind: 'date' }, { key: 'event_date', label: 'Event', kind: 'date' },
        { key: 'reason', label: 'Reason' }, { key: 'outcome', label: 'Outcome' }, { key: 'credited', label: 'Credited', kind: 'money' }, { key: 'refunded', label: 'Refunded', kind: 'money' },
        { key: 'total', label: 'Order total', kind: 'money' }],
      rows, totals: { credited: sum(rows, 'credited'), refunded: sum(rows, 'refunded'), total: sum(rows, 'total') },
    };
  },

  async coupons(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select upper(o.coupon_code) as code, count(*)::int as uses, sum(o.coupon_cents)::float8 as discount, sum(o.total_cents)::float8 as revenue
      ${c.from} where ${c.where} and ${c.confirmed} and coalesce(o.coupon_code, '') <> '' and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by uses desc`);
    return {
      kpis: [{ label: 'Coupons used', value: sum(rows, 'uses'), kind: 'number' }, { label: 'Discount given', value: sum(rows, 'discount'), kind: 'money' },
        { label: 'Revenue with coupons', value: sum(rows, 'revenue'), kind: 'money' }],
      columns: [{ key: 'code', label: 'Coupon' }, { key: 'uses', label: 'Orders', kind: 'number' }, { key: 'discount', label: 'Discount', kind: 'money' }, { key: 'revenue', label: 'Revenue', kind: 'money' }],
      rows, totals: { uses: sum(rows, 'uses'), discount: sum(rows, 'discount'), revenue: sum(rows, 'revenue') },
    };
  },

  async tips(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select ${c.event}::text as event_date, o.number, c.display_name as customer, p.number as receipt,
        (select u.name from users u where u.id = o.salesperson_user_id) as salesperson, p.tip_cents::float8 as tip
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and p.status = 'received' and p.tip_cents > 0 and ${c.inPeriod(sql`o.event_starts_at`)} order by o.event_starts_at`);
    return {
      kpis: [{ label: 'Tips', value: sum(rows, 'tip'), kind: 'money', tone: 'success' }, { label: 'Events with a tip', value: new Set(rows.map((r) => r.number)).size, kind: 'number' }],
      columns: [{ key: 'event_date', label: 'Event', kind: 'date' }, { key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'receipt', label: 'Receipt' },
        { key: 'salesperson', label: 'Salesperson' }, { key: 'tip', label: 'Tip', kind: 'money' }],
      rows, totals: { tip: sum(rows, 'tip') },
      note: 'Party-coach tips by event date. Coaches are assigned in Phase 4; until then tips are listed per order.',
    };
  },

  // --- Payment gateway ---------------------------------------------------------------------------------------
  async gateway_reconciliation(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select p.number, ${c.local(sql`p.received_at`)}::text as date, o.number as order_number, initcap(p.gateway) as gateway, p.gateway_ref as reference,
        coalesce(initcap(p.card_brand), 'Card') || coalesce(' •' || p.card_last4, '') as card, p.amount_cents::float8 as amount,
        coalesce((select sum(r.amount_cents) from refunds r where r.tenant_id = p.tenant_id and r.payment_id = p.id), 0)::float8 as refunded,
        case when p.steps ? 'fundedAt' then 'Funded' when p.steps ? 'capturedAt' then 'Captured' else 'Authorized' end as stage
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and p.gateway <> 'manual' and ${c.inPeriod(sql`p.received_at`)} order by p.received_at desc`);
    const out = rows.map((r) => ({ ...r, net: n(r.amount) - n(r.refunded) }));
    return {
      kpis: [{ label: 'Captured', value: sum(out, 'amount'), kind: 'money' }, { label: 'Refunded', value: sum(out, 'refunded'), kind: 'money', tone: 'danger' },
        { label: 'Net', value: sum(out, 'net'), kind: 'money', tone: 'success' }, { label: 'Payments', value: out.length, kind: 'number' }],
      columns: [{ key: 'number', label: 'Receipt' }, { key: 'date', label: 'Date', kind: 'date' }, { key: 'order_number', label: 'Order' }, { key: 'gateway', label: 'Gateway' },
        { key: 'reference', label: 'Gateway reference' }, { key: 'card', label: 'Card' }, { key: 'stage', label: 'Stage' }, { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'refunded', label: 'Refunded', kind: 'money' }, { key: 'net', label: 'Net', kind: 'money' }],
      rows: out, totals: { amount: sum(out, 'amount'), refunded: sum(out, 'refunded'), net: sum(out, 'net') },
      note: 'Match the gateway reference against your Stripe dashboard. Funded = paid out to your bank.',
    };
  },

  async gateway_not_funded(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select p.number, ${c.local(sql`p.received_at`)}::text as date, o.number as order_number, c.display_name as customer, p.gateway_ref as reference,
        p.amount_cents::float8 as amount, (${f.today}::date - ${c.local(sql`p.received_at`)})::int as days
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and p.gateway <> 'manual' and p.status = 'received' and not (p.steps ? 'fundedAt') and ${c.inPeriod(sql`p.received_at`)} order by p.received_at`);
    return {
      kpis: [{ label: 'Not funded yet', value: sum(rows, 'amount'), kind: 'money', tone: 'warning' }, { label: 'Payments', value: rows.length, kind: 'number' }],
      columns: [{ key: 'number', label: 'Receipt' }, { key: 'date', label: 'Taken', kind: 'date' }, { key: 'days', label: 'Days waiting', kind: 'number' }, { key: 'order_number', label: 'Order' },
        { key: 'customer', label: 'Customer' }, { key: 'reference', label: 'Gateway reference' }, { key: 'amount', label: 'Amount', kind: 'money' }],
      rows, totals: { amount: sum(rows, 'amount') },
      note: 'Payouts are marked funded when the gateway reports them (payout sync arrives with deployment webhooks).',
    };
  },

  // --- Customers -------------------------------------------------------------------------------------------------
  async survey_answers() {
    return {
      kpis: [{ label: 'Answers', value: 0, kind: 'number' }],
      columns: [{ key: 'customer', label: 'Customer' }, { key: 'order', label: 'Order' }, { key: 'score', label: 'Score' }, { key: 'comment', label: 'Comment' }],
      rows: [],
      note: 'The thank-you email links to the survey; collecting answers in the app arrives with the coach portal (Phase 4).',
    };
  },

  async customer_sales(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select c.display_name as customer, c.email, count(*)::int as orders, sum(o.total_cents)::float8 as revenue, sum(o.paid_cents)::float8 as collected,
        max(${c.event})::text as last_event
      ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by c.id, c.display_name, c.email order by revenue desc`);
    return {
      kpis: [{ label: 'Customers', value: rows.length, kind: 'number' }, { label: 'Revenue', value: sum(rows, 'revenue'), kind: 'money' },
        { label: 'Repeat (2+ orders)', value: rows.filter((r) => n(r.orders) > 1).length, kind: 'number' }],
      chart: { title: 'Top customers', kind: 'money', points: rows.slice(0, 10).map((r) => ({ label: String(r.customer ?? '—').split(' ')[0]!, value: n(r.revenue) })) },
      columns: [{ key: 'customer', label: 'Customer' }, { key: 'email', label: 'Email' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'revenue', label: 'Revenue', kind: 'money' },
        { key: 'collected', label: 'Collected', kind: 'money' }, { key: 'last_event', label: 'Last event', kind: 'date' }],
      rows, totals: { orders: sum(rows, 'orders'), revenue: sum(rows, 'revenue'), collected: sum(rows, 'collected') },
    };
  },

  async customer_list(tx, tenantId, f) {
    const rows = await rowsOf(tx, sql`select c.display_name as customer, c.email, c.phone, coalesce(c.city, '') as city, coalesce(c.source, '') as source,
        (c.created_at at time zone t.timezone)::date::text as added,
        (select count(*) from orders o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.status in ('booked','completed'))::int as orders,
        (select coalesce(sum(o.total_cents), 0) from orders o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.status in ('booked','completed'))::float8 as lifetime
      from customers c join tenants t on t.id = c.tenant_id
      where c.tenant_id = ${tenantId}::uuid and (c.created_at at time zone t.timezone)::date between ${f.from}::date and ${f.to}::date order by c.created_at desc`);
    return {
      kpis: [{ label: 'New customers', value: rows.length, kind: 'number' }, { label: 'Booked since', value: rows.filter((r) => n(r.orders) > 0).length, kind: 'number' },
        { label: 'Their revenue', value: sum(rows, 'lifetime'), kind: 'money' }],
      columns: [{ key: 'customer', label: 'Customer' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'city', label: 'City' }, { key: 'source', label: 'Source' },
        { key: 'added', label: 'Added', kind: 'date' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'lifetime', label: 'Lifetime value', kind: 'money' }],
      rows, totals: { orders: sum(rows, 'orders'), lifetime: sum(rows, 'lifetime') },
    };
  },

  async customer_emails(tx, tenantId) {
    const rows = await rowsOf(tx, sql`select c.display_name as customer, c.email, case when c.marketing_opt_in then 'Yes' else 'No' end as marketing,
        (select max(o.event_starts_at)::date from orders o where o.tenant_id = c.tenant_id and o.customer_id = c.id and o.status in ('booked','completed'))::text as last_event
      from customers c where c.tenant_id = ${tenantId}::uuid and coalesce(c.email, '') <> '' order by c.display_name`);
    return {
      kpis: [{ label: 'With an email', value: rows.length, kind: 'number' }, { label: 'Marketing opt-in', value: rows.filter((r) => r.marketing === 'Yes').length, kind: 'number' }],
      columns: [{ key: 'customer', label: 'Customer' }, { key: 'email', label: 'Email' }, { key: 'marketing', label: 'Marketing emails' }, { key: 'last_event', label: 'Last event', kind: 'date' }],
      rows,
    };
  },

  async customer_info(tx, tenantId) {
    const rows = await rowsOf(tx, sql`select c.display_name as customer, initcap(c.kind) as kind, coalesce(c.company_name, '') as company, c.email, c.phone, coalesce(c.phone_secondary, '') as phone2,
        concat_ws(', ', nullif(c.line1, ''), nullif(c.city, ''), nullif(c.region, ''), nullif(c.postal_code, '')) as address,
        array_to_string(c.tags, ', ') as tags, coalesce(c.source, '') as source, case when c.tax_exempt then 'Yes' else '' end as tax_exempt
      from customers c where c.tenant_id = ${tenantId}::uuid order by c.display_name`);
    return {
      kpis: [{ label: 'Customers', value: rows.length, kind: 'number' }, { label: 'Organizations', value: rows.filter((r) => r.kind === 'Organization').length, kind: 'number' }],
      columns: [{ key: 'customer', label: 'Customer' }, { key: 'kind', label: 'Kind' }, { key: 'company', label: 'Company' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
        { key: 'phone2', label: 'Mobile' }, { key: 'address', label: 'Address' }, { key: 'tags', label: 'Tags' }, { key: 'source', label: 'Source' }, { key: 'tax_exempt', label: 'Tax exempt' }],
      rows,
    };
  },

  async signatures(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, s.typed_name as signed_by, ${c.local(sql`s.signed_at`)}::text as signed, s.agreement_version as version,
        case when s.waiver_accepted then 'Accepted' else 'Declined' end as waiver, coalesce(s.ip, '') as ip
      from signatures s join orders o on o.tenant_id = s.tenant_id and o.id = s.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and ${c.inPeriod(sql`s.signed_at`)} order by s.signed_at desc`);
    return {
      kpis: [{ label: 'Signed', value: rows.length, kind: 'number' }, { label: 'Waiver accepted', value: rows.filter((r) => r.waiver === 'Accepted').length, kind: 'number' }],
      columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'signed_by', label: 'Typed name' }, { key: 'signed', label: 'Signed', kind: 'date' },
        { key: 'version', label: 'Version' }, { key: 'waiver', label: 'Damage waiver' }, { key: 'ip', label: 'IP address' }],
      rows,
    };
  },

  async quotes_incomplete(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, initcap(replace(o.status, '_', ' ')) as status, ${c.event}::text as event_date,
        ${c.local(sql`o.created_at`)}::text as created, o.total_cents::float8 as total
      ${c.from} where ${c.where} and o.status in ('draft','quote_sent') and ${c.inPeriod(sql`o.event_starts_at`)} order by o.event_starts_at`);
    return {
      kpis: [{ label: 'Open', value: rows.length, kind: 'number' }, { label: 'Drafts', value: rows.filter((r) => r.status === 'Draft').length, kind: 'number' },
        { label: 'Value', value: sum(rows, 'total'), kind: 'money' }],
      columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'status', label: 'Status' }, { key: 'event_date', label: 'Event', kind: 'date' },
        { key: 'created', label: 'Created', kind: 'date' }, { key: 'total', label: 'Total', kind: 'money' }],
      rows, totals: { total: sum(rows, 'total') },
    };
  },

  async quotes_sent(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, ${c.local(sql`o.quote_sent_at`)}::text as sent, ${c.event}::text as event_date, o.total_cents::float8 as total,
        case when o.status in ('booked','completed') then 'Booked' when o.status = 'cancelled' then 'Cancelled' else 'Open' end as outcome
      ${c.from} where ${c.where} and o.quote_sent_at is not null and ${c.inPeriod(sql`o.quote_sent_at`)} order by o.quote_sent_at desc`);
    const booked = rows.filter((r) => r.outcome === 'Booked');
    return {
      kpis: [{ label: 'Quotes sent', value: rows.length, kind: 'number' }, { label: 'Booked', value: booked.length, kind: 'number', sub: `${pct(booked.length, rows.length)}% conversion`, tone: 'success' },
        { label: 'Quoted value', value: sum(rows, 'total'), kind: 'money' }, { label: 'Booked value', value: sum(booked, 'total'), kind: 'money' }],
      columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'sent', label: 'Sent', kind: 'date' }, { key: 'event_date', label: 'Event', kind: 'date' },
        { key: 'outcome', label: 'Outcome' }, { key: 'total', label: 'Total', kind: 'money' }],
      rows, totals: { total: sum(rows, 'total') },
    };
  },

  async abandoned_quotes(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, c.email, ${c.local(sql`o.quote_sent_at`)}::text as sent, ${c.event}::text as event_date,
        case when o.quote_expires_on < ${f.today}::date then 'Expired' else 'Event date passed' end as why, o.total_cents::float8 as total
      ${c.from} where ${c.where} and o.status = 'quote_sent' and o.quote_sent_at is not null and ${c.inPeriod(sql`o.quote_sent_at`)}
        and (o.quote_expires_on < ${f.today}::date or ${c.event} < ${f.today}::date) order by o.quote_sent_at desc`);
    return {
      kpis: [{ label: 'Abandoned', value: rows.length, kind: 'number', tone: 'warning' }, { label: 'Lost value', value: sum(rows, 'total'), kind: 'money' }],
      columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'email', label: 'Email' }, { key: 'sent', label: 'Sent', kind: 'date' },
        { key: 'event_date', label: 'Event', kind: 'date' }, { key: 'why', label: 'Why' }, { key: 'total', label: 'Total', kind: 'money' }],
      rows, totals: { total: sum(rows, 'total') },
    };
  },

  async signed_contracts(tx, tenantId, f) {
    return contracts(tx, tenantId, f, true);
  },
  async unsigned_contracts(tx, tenantId, f) {
    return contracts(tx, tenantId, f, false);
  },

  // --- Products ---------------------------------------------------------------------------------------------------
  async sales_by_category(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce(pc.name, case when ol.product_id is null then 'Custom lines' else 'No category' end) as category,
        sum(ol.quantity)::int as quantity, sum(ol.line_total_cents)::float8 as revenue
      from order_lines ol join orders o on o.tenant_id = ol.tenant_id and o.id = ol.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      left join products p on p.tenant_id = ol.tenant_id and p.id = ol.product_id left join product_categories pc on pc.tenant_id = p.tenant_id and pc.id = p.category_id
      where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by revenue desc`);
    const revenue = sum(rows, 'revenue');
    return {
      kpis: [{ label: 'Rental revenue', value: revenue, kind: 'money' }, { label: 'Items rented', value: sum(rows, 'quantity'), kind: 'number' }],
      chart: { title: 'Revenue by category', kind: 'money', points: rows.map((r) => ({ label: String(r.category), value: n(r.revenue) })) },
      columns: [{ key: 'category', label: 'Category' }, { key: 'quantity', label: 'Quantity', kind: 'number' }, { key: 'revenue', label: 'Revenue', kind: 'money' }, { key: 'share', label: 'Share', kind: 'percent' }],
      rows: rows.map((r) => ({ ...r, share: pct(n(r.revenue), revenue) })), totals: { quantity: sum(rows, 'quantity'), revenue, share: 100 },
      note: 'Order line totals (before order-level fees, discounts and tax).',
    };
  },

  async sales_by_item(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce(p.name, ol.name) as item, count(distinct o.id)::int as orders, sum(ol.quantity)::int as quantity, sum(ol.line_total_cents)::float8 as revenue
      from order_lines ol join orders o on o.tenant_id = ol.tenant_id and o.id = ol.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      left join products p on p.tenant_id = ol.tenant_id and p.id = ol.product_id
      where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by revenue desc`);
    return {
      kpis: [{ label: 'Rental revenue', value: sum(rows, 'revenue'), kind: 'money' }, { label: 'Items', value: rows.length, kind: 'number' }],
      chart: { title: 'Top items', kind: 'money', points: rows.slice(0, 12).map((r) => ({ label: String(r.item).slice(0, 14), value: n(r.revenue) })) },
      columns: [{ key: 'item', label: 'Item' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'quantity', label: 'Quantity', kind: 'number' }, { key: 'revenue', label: 'Revenue', kind: 'money' }],
      rows, totals: { orders: sum(rows, 'orders'), quantity: sum(rows, 'quantity'), revenue: sum(rows, 'revenue') },
    };
  },

  async items_inventory(tx, tenantId, f) {
    const days = Math.max(1, Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000) + 1);
    const loc = f.locationId ? sql`and ip.location_id = ${f.locationId}::uuid` : sql``;
    const rloc = f.locationId ? sql`and r.location_id = ${f.locationId}::uuid` : sql``;
    const rows = await rowsOf(tx, sql`select p.name as item, coalesce(pc.name, '') as category,
        coalesce((select sum(ip.quantity_owned - ip.out_of_service) from inventory_pools ip where ip.tenant_id = p.tenant_id and ip.product_id = p.id ${loc}), 0)::int as owned,
        coalesce((select sum(r.quantity) from reservations r join orders o on o.tenant_id = r.tenant_id and o.id = r.order_id
                  where r.tenant_id = p.tenant_id and r.product_id = p.id ${rloc} and o.status in ('booked','completed')
                    and r.starts_at::date between ${f.from}::date and ${f.to}::date), 0)::int as rented,
        coalesce((select sum(r.quantity * greatest(1, ceil(extract(epoch from (r.ends_at - r.starts_at)) / 86400.0))) from reservations r join orders o on o.tenant_id = r.tenant_id and o.id = r.order_id
                  where r.tenant_id = p.tenant_id and r.product_id = p.id ${rloc} and o.status in ('booked','completed')
                    and r.starts_at::date between ${f.from}::date and ${f.to}::date), 0)::int as unit_days
      from products p left join product_categories pc on pc.tenant_id = p.tenant_id and pc.id = p.category_id
      where p.tenant_id = ${tenantId}::uuid and p.status = 'active' and p.tracking <> 'none' order by p.name`);
    const out: R[] = rows.map((r) => ({ ...r, utilisation: n(r.owned) ? Math.min(100, Math.round((n(r.unit_days) / (n(r.owned) * days)) * 100)) : 0 }));
    return {
      kpis: [{ label: 'Tracked items', value: out.length, kind: 'number' }, { label: 'Units owned', value: sum(out, 'owned'), kind: 'number' },
        { label: 'Rentals', value: sum(out, 'rented'), kind: 'number' }, { label: 'Busiest', value: [...out].sort((a, b) => n(b.utilisation) - n(a.utilisation))[0]?.item ?? '—', kind: 'text' }],
      chart: { title: 'Utilisation (% of owned unit-days)', kind: 'number', points: out.map((r) => ({ label: String(r.item).slice(0, 14), value: n(r.utilisation) })) },
      columns: [{ key: 'item', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'owned', label: 'Owned', kind: 'number' }, { key: 'rented', label: 'Rented', kind: 'number' },
        { key: 'unit_days', label: 'Unit-days out', kind: 'number' }, { key: 'utilisation', label: 'Utilisation', kind: 'percent' }],
      rows: out, totals: { owned: sum(out, 'owned'), rented: sum(out, 'rented'), unit_days: sum(out, 'unit_days') },
    };
  },

  async inventory_usage(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce(p.name, ol.name) as item, count(distinct o.id)::int as times, sum(ol.quantity)::int as units,
        round(sum(ol.quantity * extract(epoch from (o.event_ends_at - o.event_starts_at)) / 3600.0)::numeric, 1)::float8 as hours
      from order_lines ol join orders o on o.tenant_id = ol.tenant_id and o.id = ol.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      left join products p on p.tenant_id = ol.tenant_id and p.id = ol.product_id
      where ${c.where} and ${c.confirmed} and ol.product_id is not null and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by times desc`);
    return {
      kpis: [{ label: 'Rentals', value: sum(rows, 'times'), kind: 'number' }, { label: 'Units out', value: sum(rows, 'units'), kind: 'number' }, { label: 'Hours out', value: Math.round(sum(rows, 'hours')), kind: 'number' }],
      columns: [{ key: 'item', label: 'Item' }, { key: 'times', label: 'Times rented', kind: 'number' }, { key: 'units', label: 'Units', kind: 'number' }, { key: 'hours', label: 'Unit-hours', kind: 'number' }],
      rows, totals: { times: sum(rows, 'times'), units: sum(rows, 'units'), hours: Math.round(sum(rows, 'hours') * 10) / 10 },
    };
  },

  // --- Employees ---------------------------------------------------------------------------------------------------
  async employee_payments(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce((select u.name from users u where u.id = o.salesperson_user_id), 'No salesperson') as salesperson,
        count(*)::int as payments, sum(p.amount_cents)::float8 as collected, sum(p.tip_cents)::float8 as tips
      from payments p join orders o on o.tenant_id = p.tenant_id and o.id = p.order_id join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where ${c.where} and p.status = 'received' and ${c.inPeriod(sql`p.received_at`)} group by 1 order by collected desc`);
    return {
      kpis: [{ label: 'Collected', value: sum(rows, 'collected'), kind: 'money', tone: 'success' }, { label: 'Payments', value: sum(rows, 'payments'), kind: 'number' }],
      chart: { title: 'Collected per salesperson', kind: 'money', points: rows.map((r) => ({ label: String(r.salesperson).split(' ')[0]!, value: n(r.collected) })) },
      columns: [{ key: 'salesperson', label: 'Salesperson' }, { key: 'payments', label: 'Payments', kind: 'number' }, { key: 'collected', label: 'Collected', kind: 'money' }, { key: 'tips', label: 'Tips', kind: 'money' }],
      rows, totals: { payments: sum(rows, 'payments'), collected: sum(rows, 'collected'), tips: sum(rows, 'tips') },
    };
  },

  async employee_orders(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce((select u.name from users u where u.id = o.salesperson_user_id), 'No salesperson') as salesperson,
        count(*)::int as orders, sum(o.total_cents)::float8 as value
      ${c.from} where ${c.where} and ${c.confirmed} and o.booked_at is not null and ${c.inPeriod(sql`o.booked_at`)} group by 1 order by orders desc`);
    return {
      kpis: [{ label: 'Orders booked', value: sum(rows, 'orders'), kind: 'number' }, { label: 'Value', value: sum(rows, 'value'), kind: 'money' }],
      chart: { title: 'Orders booked per salesperson', kind: 'number', points: rows.map((r) => ({ label: String(r.salesperson).split(' ')[0]!, value: n(r.orders) })) },
      columns: [{ key: 'salesperson', label: 'Salesperson' }, { key: 'orders', label: 'Orders booked', kind: 'number' }, { key: 'value', label: 'Value', kind: 'money' }],
      rows, totals: { orders: sum(rows, 'orders'), value: sum(rows, 'value') },
      note: 'By the date the order was booked.',
    };
  },

  async commission(tx, tenantId, f) {
    const c = ctx(tenantId, f);
    const rows = await rowsOf(tx, sql`select coalesce(u.name, 'No salesperson') as salesperson, count(*)::int as orders, sum(o.total_cents - o.tax_cents)::float8 as base,
        coalesce(max(m.commission_rate), 0)::float8 as rate
      ${c.from} left join users u on u.id = o.salesperson_user_id
      left join memberships m on m.tenant_id = o.tenant_id and m.user_id = o.salesperson_user_id
      where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)} group by 1 order by base desc`);
    const out: R[] = rows.map((r) => ({ ...r, commission: Math.round((n(r.base) * n(r.rate)) / 100) }));
    return {
      kpis: [{ label: 'Commission', value: sum(out, 'commission'), kind: 'money', tone: 'success' }, { label: 'Commissionable sales', value: sum(out, 'base'), kind: 'money' },
        { label: 'Salespeople', value: out.filter((r) => r.salesperson !== 'No salesperson').length, kind: 'number' }],
      columns: [{ key: 'salesperson', label: 'Salesperson' }, { key: 'orders', label: 'Orders', kind: 'number' }, { key: 'base', label: 'Sales before tax', kind: 'money' },
        { key: 'rate', label: 'Rate', kind: 'percent' }, { key: 'commission', label: 'Commission', kind: 'money' }],
      rows: out, totals: { orders: sum(out, 'orders'), base: sum(out, 'base'), commission: sum(out, 'commission') },
      note: 'Booked revenue by event date, before tax, times each salesperson’s rate (Settings → Team).',
    };
  },
};

async function contracts(tx: Tx, tenantId: string, f: ReportFilters, signed: boolean): Promise<ReportResult> {
  const c = ctx(tenantId, f);
  const rows = await rowsOf(tx, sql`select o.number, c.display_name as customer, c.email, ${c.event}::text as event_date, o.total_cents::float8 as total,
      (select s.typed_name from signatures s where s.tenant_id = o.tenant_id and s.order_id = o.id order by s.signed_at desc limit 1) as signed_by,
      case when o.policy_acks <> '{}'::jsonb then 'Confirmed by staff' else '' end as policies
    ${c.from} where ${c.where} and ${c.confirmed} and ${c.inPeriod(sql`o.event_starts_at`)}
      and ${signed ? sql`exists` : sql`not exists`} (select 1 from signatures s where s.tenant_id = o.tenant_id and s.order_id = o.id)
    order by o.event_starts_at`);
  return {
    kpis: [{ label: signed ? 'Signed' : 'Unsigned', value: rows.length, kind: 'number', tone: signed ? 'success' : 'warning' }, { label: 'Value', value: sum(rows, 'total'), kind: 'money' }],
    columns: [{ key: 'number', label: 'Order' }, { key: 'customer', label: 'Customer' }, { key: 'email', label: 'Email' }, { key: 'event_date', label: 'Event', kind: 'date' },
      ...(signed ? [{ key: 'signed_by', label: 'Signed by' }] : [{ key: 'policies', label: 'Policies' }]), { key: 'total', label: 'Total', kind: 'money' as const }],
    rows, totals: { total: sum(rows, 'total') },
    note: signed ? undefined : 'Send the customer link from the order so they can sign before the event.',
  };
}

/** Run one report for a workspace. Unknown keys are refused. */
export async function runReport(db: Db, tenantId: string, key: string, f: ReportFilters): Promise<ReportResult> {
  const build = builders[key];
  if (!build || !REPORTS.some((r) => r.key === key)) throw new Error(`Unknown report: ${key}`);
  const money = (c: number) => formatMoney(c, f.currency);
  return withTenant(db, tenantId, (tx) => build(tx, tenantId, f, money));
}

// --- Email weekly ------------------------------------------------------------------------------------------

export type ReportScheduleInput = { key: string; on: boolean; period: string; locationId?: string | null };

export function listReportSchedules(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) => tx.select().from(reportSchedules).where(eq(reportSchedules.tenantId, tenantId)));
}

/** Turn "Email weekly" on or off for one report (with the period and location it was looking at). */
export function setReportSchedule(db: Db, tenantId: string, actor: Actor, input: ReportScheduleInput) {
  if (!REPORTS.some((r) => r.key === input.key)) throw new Error(`Unknown report: ${input.key}`);
  const period = ['this_month', 'last_month', 'quarter', 'year'].includes(input.period) ? input.period : 'this_month';
  return withTenant(db, tenantId, async (tx) => {
    if (!input.on) {
      await tx.delete(reportSchedules).where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.reportKey, input.key)));
    } else {
      const values = { period, locationId: input.locationId ?? null, createdByUserId: actor.userId ?? null };
      await tx.insert(reportSchedules).values({ tenantId, reportKey: input.key, ...values })
        .onConflictDoUpdate({ target: [reportSchedules.tenantId, reportSchedules.reportKey], set: values });
    }
    await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, input.on ? 'report.scheduled' : 'report.unscheduled', { report: input.key, period });
  });
}

/**
 * Monday morning: every scheduled report of a workspace in one office email
 * (Settings → Email & SMS → Weekly reports). Sent once per day at most.
 */
export async function queueWeeklyReports(db: Db, tenant: { id: string; slug: string; currency: string }, today: string, baseUrl: string) {
  const due = (await listReportSchedules(db, tenant.id)).filter((s) => s.lastSentOn !== today);
  if (!due.length) return null;
  const names = new Map((await withTenant(db, tenant.id, (tx) => tx.select({ id: locations.id, name: locations.name }).from(locations))).map((l) => [l.id, l.name]));
  const money = (c: number) => formatMoney(c, tenant.currency);
  const order = new Map(REPORTS.map((r, i) => [r.key, i]));
  const parts: string[] = [];
  for (const s of due.sort((a, b) => (order.get(a.reportKey) ?? 0) - (order.get(b.reportKey) ?? 0))) {
    const def = REPORTS.find((r) => r.key === s.reportKey);
    if (!def) continue;
    const { from, to } = reportPeriod(s.period as PeriodKind, today);
    const locationId = s.locationId && names.has(s.locationId) ? s.locationId : null;
    const result = await runReport(db, tenant.id, def.key, { from, to, locationId, currency: tenant.currency, today });
    const query = new URLSearchParams({ r: def.key, p: s.period, ...(locationId ? { loc: locationId } : {}) });
    const label = `${def.asOf ? `As of ${periodLabel(today, today).replace(/ – \d+/, '')}` : periodLabel(from, to)} · ${locationId ? names.get(locationId) : 'All locations'}`;
    parts.push(reportText(def.title, label, result, money, `${baseUrl}/${tenant.slug}/reports?${query}`));
  }
  return withTenant(db, tenant.id, async (tx) => {
    const row = await enqueueOfficeAlert(tx, tenant.id, 'weekly_report', `reports:${today}`, null, { reason: parts.join('\n\n\n') });
    await tx.update(reportSchedules).set({ lastSentOn: today }).where(eq(reportSchedules.tenantId, tenant.id));
    return row;
  });
}
