import { describe, expect, it } from 'vitest';
import { calendarDayCounts, quoteFollowUps } from './calendar';
import { wallTimeToUtc } from './time';

const TZ = 'America/Chicago';
const at = (date: string, time: string) => wallTimeToUtc(date, time, TZ);
const order = (id: string, status: string, start: [string, string], end: [string, string]) =>
  ({ id, status, startsAt: at(...start), endsAt: at(...end), timeZone: TZ });

describe('calendarDayCounts (Odoo month counts)', () => {
  it('counts a same-day booking as a delivery only', () => {
    const c = calendarDayCounts([order('a', 'booked', ['2026-10-24', '13:00'], ['2026-10-24', '17:00'])]);
    expect(c).toEqual({ '2026-10-24': { delivery: ['a'] } });
  });

  it('counts a multi-day rental: delivery, service days between, pickup on the last day', () => {
    const c = calendarDayCounts([order('a', 'booked', ['2026-10-24', '09:00'], ['2026-10-27', '10:00'])]);
    expect(c['2026-10-24']).toEqual({ delivery: ['a'] });
    expect(c['2026-10-25']).toEqual({ service: ['a'] });
    expect(c['2026-10-26']).toEqual({ service: ['a'] });
    expect(c['2026-10-27']).toEqual({ pickup: ['a'] });
  });

  it('uses the location’s calendar day (a 7 PM Chicago event is not tomorrow in UTC)', () => {
    const c = calendarDayCounts([order('a', 'booked', ['2026-10-24', '19:00'], ['2026-10-24', '22:00'])]);
    expect(Object.keys(c)).toEqual(['2026-10-24']);
  });

  it('puts quotes, drafts and cancellations on their start day; completed counts as booked', () => {
    const c = calendarDayCounts([
      order('q', 'quote_sent', ['2026-10-24', '10:00'], ['2026-10-24', '12:00']),
      order('d', 'draft', ['2026-10-24', '10:00'], ['2026-10-26', '12:00']),
      order('x', 'cancelled', ['2026-10-24', '10:00'], ['2026-10-24', '12:00']),
      order('c', 'completed', ['2026-10-24', '10:00'], ['2026-10-24', '12:00']),
    ]);
    expect(c['2026-10-24']).toEqual({ quote: ['q'], draft: ['d'], cancel: ['x'], delivery: ['c'] });
    expect(c['2026-10-26']).toBeUndefined();
  });
});

describe('quoteFollowUps', () => {
  const now = at('2026-10-25', '12:00');
  const q = (id: string, status: string, start: string, sent: string | null) =>
    ({ id, status, startsAt: at(start, '13:00'), timeZone: TZ, sentAt: sent ? at(sent, '10:00') : null, label: id });

  it('flags quotes whose event date passed, and quotes 3+ days old; most overdue first', () => {
    const r = quoteFollowUps([
      q('past', 'quote_sent', '2026-10-20', '2026-10-01'),
      q('old', 'quote_sent', '2026-11-20', '2026-10-21'),
      q('fresh', 'quote_sent', '2026-11-20', '2026-10-24'),
      q('draft', 'draft', '2026-10-01', null),
      q('booked', 'booked', '2026-10-01', '2026-09-01'),
    ], now);
    expect(r).toEqual([
      { id: 'draft', label: 'draft', daysLate: 24 },
      { id: 'past', label: 'past', daysLate: 5 },
      { id: 'old', label: 'old', daysLate: 4 },
    ]);
  });
});
