import { addDays, utcToWallTime, wallTimeToUtc } from '@rental/core';
import { listOrders } from '@rental/db';
import { PageHeader } from '@/components/ui';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { CalendarView } from './calendar-view';

export const metadata = { title: 'Calendar' };

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ m?: string }> }) {
  const { tenant: slug } = await params;
  const { m } = await searchParams;
  const { tenant, prefs } = await getTenantContext(slug);
  const tz = tenant.timezone;
  const today = utcToWallTime(new Date(), tz).date;
  const month = m && /^\d{4}-\d{2}$/.test(m) ? m : today.slice(0, 7);
  const first = `${month}-01`;
  // Grid: whole weeks covering the month.
  const firstDow = new Date(`${first}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const weekStart = prefs.formats.weekStartsOn === 'monday' ? 1 : 0;
  const gridStart = addDays(first, -((firstDow - weekStart + 7) % 7));
  const gridEnd = addDays(gridStart, 42);
  const orders = await listOrders(db, tenant.id, {
    status: 'all',
    from: wallTimeToUtc(gridStart, '00:00', tz),
    to: wallTimeToUtc(gridEnd, '00:00', tz),
    limit: 1000,
  });
  const time = new Intl.DateTimeFormat(tenant.locale, { timeZone: tz, hour: 'numeric', minute: '2-digit' });

  return (
    <>
      <PageHeader title="Calendar" description="Every quote and booking by event date." />
      <CalendarView
        slug={slug}
        month={month}
        today={today}
        gridStart={gridStart}
        weekStart={weekStart}
        events={orders
          .filter((o) => o.status !== 'cancelled')
          .map((o) => ({
            id: o.id,
            date: utcToWallTime(o.eventStartsAt, tz).date,
            time: time.format(o.eventStartsAt),
            title: o.customerName,
            items: o.items,
            status: o.status,
            number: o.number,
          }))}
      />
    </>
  );
}
