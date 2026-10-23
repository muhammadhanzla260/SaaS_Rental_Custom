import { describe, expect, it } from 'vitest';
import { eventWindow, formatEventTime, utcToWallTime, wallTimeToUtc } from './time';

describe('wall time <-> UTC', () => {
  it('converts in and out of a zone, across daylight saving', () => {
    expect(wallTimeToUtc('2026-11-07', '14:00', 'America/Chicago').toISOString()).toBe('2026-11-07T20:00:00.000Z'); // CST
    expect(wallTimeToUtc('2026-07-04', '14:00', 'America/Chicago').toISOString()).toBe('2026-07-04T19:00:00.000Z'); // CDT
    expect(wallTimeToUtc('2026-11-01', '01:30', 'America/Chicago').toISOString()).toMatch(/2026-11-01T0[67]:30:00.000Z/); // repeated hour
    expect(wallTimeToUtc('2026-07-04', '14:00', 'Asia/Karachi').toISOString()).toBe('2026-07-04T09:00:00.000Z');
    expect(utcToWallTime(new Date('2026-11-07T20:00:00Z'), 'America/Chicago')).toEqual({ date: '2026-11-07', time: '14:00' });
  });
  it('runs a same-day event past midnight when the end is before the start', () => {
    const w = eventWindow({ date: '2026-11-07', startTime: '21:00', endTime: '01:00', multiDay: false }, 'America/Chicago');
    expect((w.endsAt.getTime() - w.startsAt.getTime()) / 3_600_000).toBe(4);
    const m = eventWindow({ date: '2026-11-07', startTime: '10:00', endTime: '10:00', multiDay: true, endDate: '2026-11-09' }, 'America/Chicago');
    expect((m.endsAt.getTime() - m.startsAt.getTime()) / 3_600_000).toBe(48);
    expect(formatEventTime(w.startsAt, w.endsAt, 'America/Chicago')).toBe('Sat, Nov 7 · 9:00 PM – 1:00 AM');
  });
});
