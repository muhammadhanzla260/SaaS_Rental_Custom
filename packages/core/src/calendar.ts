/**
 * Month-calendar counts and quote follow-ups, as in the FreedomFun Odoo
 * calendar (custom_rental/static/src/js/calendar_view.js):
 *   delivery  booked rentals starting this day
 *   service   multi-day rentals in progress this day (between start and end)
 *   pickup    booked rentals ending this day that started on an earlier day
 *   quote     open quotes starting this day
 *   draft     unfinished drafts starting this day
 *   cancel    cancelled events starting this day
 * Days are calendar days in each order's location time zone.
 */
import { addDays, utcToWallTime } from './time';

export const DAY_COUNT_KEYS = ['delivery', 'service', 'pickup', 'quote', 'draft', 'cancel'] as const;
export type DayCountKey = (typeof DAY_COUNT_KEYS)[number];

export type CalendarOrder = { id: string; status: string; startsAt: Date; endsAt: Date; timeZone: string };

/** For each day (yyyy-mm-dd), the ids of the orders under each count. */
export function calendarDayCounts(orders: CalendarOrder[]): Record<string, Partial<Record<DayCountKey, string[]>>> {
  const out: Record<string, Partial<Record<DayCountKey, string[]>>> = {};
  const bump = (day: string, key: DayCountKey, id: string) => ((out[day] ??= {})[key] ??= []).push(id);
  for (const o of orders) {
    const start = utcToWallTime(o.startsAt, o.timeZone).date;
    const end = utcToWallTime(o.endsAt, o.timeZone).date;
    if (o.status === 'booked' || o.status === 'completed') {
      bump(start, 'delivery', o.id);
      if (end > start) {
        bump(end, 'pickup', o.id);
        for (let d = addDays(start, 1); d < end; d = addDays(d, 1)) bump(d, 'service', o.id);
      }
    } else if (o.status === 'quote_sent') bump(start, 'quote', o.id);
    else if (o.status === 'draft') bump(start, 'draft', o.id);
    else if (o.status === 'cancelled') bump(start, 'cancel', o.id);
  }
  return out;
}

export type FollowUpOrder = { id: string; status: string; startsAt: Date; timeZone: string; sentAt: Date | null; label: string };

/**
 * Open quotes and drafts that need a follow-up: the event date has passed
 * (days since the event), or the quote is at least 3 days old with no answer
 * (days since it was sent). Most overdue first, at most `limit`.
 */
export function quoteFollowUps(orders: FollowUpOrder[], now = new Date(), limit = 12) {
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
  const items: { id: string; label: string; daysLate: number }[] = [];
  for (const o of orders) {
    if (o.status !== 'draft' && o.status !== 'quote_sent') continue;
    const today = utcToWallTime(now, o.timeZone).date;
    const start = utcToWallTime(o.startsAt, o.timeZone).date;
    let late = start < today ? days(start, today) : 0;
    if (!late && o.sentAt) {
      const age = days(utcToWallTime(o.sentAt, o.timeZone).date, today);
      if (age >= 3) late = age;
    }
    if (late > 0) items.push({ id: o.id, label: o.label, daysLate: late });
  }
  return items.sort((a, b) => b.daysLate - a.daysLate).slice(0, limit);
}
