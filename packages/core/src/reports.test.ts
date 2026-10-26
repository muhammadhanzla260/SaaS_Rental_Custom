import { describe, expect, it } from 'vitest';
import { periodLabel, REPORTS, reportCsv, reportPeriod, reportText } from './reports';

describe('report periods', () => {
  it('this month, last month (across the year), quarter, year, custom', () => {
    expect(reportPeriod('this_month', '2026-10-23')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(reportPeriod('last_month', '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(reportPeriod('quarter', '2026-11-05')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(reportPeriod('year', '2026-02-28')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(reportPeriod('custom', '2026-10-23', { from: '2026-09-15', to: '2026-10-02' })).toEqual({ from: '2026-09-15', to: '2026-10-02' });
    expect(reportPeriod('custom', '2026-10-23', { from: '2026-10-05', to: '2026-10-01' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(reportPeriod('last_month', '2024-03-31')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('labels a period like the design', () => {
    expect(periodLabel('2026-10-01', '2026-10-23')).toBe('Oct 1 – 23, 2026');
    expect(periodLabel('2026-09-15', '2026-10-02')).toBe('Sep 15 – Oct 2, 2026');
  });

  it('has the 32 starred reports in six groups', () => {
    expect(REPORTS).toHaveLength(32);
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(32);
  });

  it('exports CSV with money as decimals, quoting, and a totals row', () => {
    const csv = reportCsv({
      kpis: [], columns: [{ key: 'name', label: 'Customer' }, { key: 'amount', label: 'Amount', kind: 'money' }],
      rows: [{ name: 'Lakeway HOA, VIP', amount: 123456 }, { name: 'Say "hi"', amount: 5 }], totals: { amount: 123461 },
    });
    expect(csv).toBe('Customer,Amount\r\n"Lakeway HOA, VIP",1234.56\r\n"Say ""hi""",0.05\r\nTotal,1234.61\r\n');
  });

  it('writes a report as text for the Monday email', () => {
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const text = reportText('Month to Date', 'Oct 1 – 26, 2026 · All locations', {
      kpis: [{ label: 'Revenue', value: 123456, kind: 'money', sub: '+12% vs last October' }],
      columns: [{ key: 'location', label: 'Location' }, { key: 'revenue', label: 'Revenue', kind: 'money' }],
      rows: [{ location: 'Austin', revenue: 100000 }, { location: 'Dallas', revenue: 23456 }],
    }, money, 'https://app.example/acme/reports?r=month_to_date', 1);
    expect(text.split('\n')).toEqual([
      'MONTH TO DATE', 'Oct 1 – 26, 2026 · All locations', '', 'Revenue: $1234.56 (+12% vs last October)', '', '• Austin · $1000.00', '…and 1 more', '',
      'Full report: https://app.example/acme/reports?r=month_to_date',
    ]);
  });
});
