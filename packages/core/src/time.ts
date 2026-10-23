/**
 * Wall-clock time in a location's time zone <-> UTC instants. Event times are
 * typed as "Saturday 2:00 PM in Austin" and stored as UTC; daylight saving is
 * handled by asking Intl for the zone's offset at that moment.
 */

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** "2026-11-07" + "14:00" in America/Chicago -> the UTC instant. */
export function wallTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset across a DST change.
  let instant = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60_000);
  instant = new Date(guess - offsetMinutes(instant, timeZone) * 60_000);
  return instant;
}

/** UTC instant -> { date: "YYYY-MM-DD", time: "HH:MM" } in the zone. */
export function utcToWallTime(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * Event window from the order form. Same-day events whose end time is before
 * the start run past midnight (Odoo POS rule); multi-day events use the end date.
 */
export function eventWindow(
  input: { date: string; startTime: string; endTime: string; multiDay: boolean; endDate?: string },
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = wallTimeToUtc(input.date, input.startTime, timeZone);
  const endDate = input.multiDay ? input.endDate || input.date : input.endTime <= input.startTime ? addDays(input.date, 1) : input.date;
  return { startsAt, endsAt: wallTimeToUtc(endDate, input.endTime, timeZone) };
}

export function formatEventTime(start: Date, end: Date, timeZone: string, locale = 'en-US') {
  const day = new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  const sameDay = utcToWallTime(start, timeZone).date === utcToWallTime(end, timeZone).date;
  const nextDay = !sameDay && end.getTime() - start.getTime() < 24 * 3_600_000;
  return sameDay || nextDay
    ? `${day.format(start)} · ${time.format(start)} – ${time.format(end)}`
    : `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}`;
}
