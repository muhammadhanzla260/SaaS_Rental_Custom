import { formatPhone } from '@rental/core';
import { quoteContext, resolveOrderToken } from '@rental/db';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 lines are at most 75 octets; longer ones continue on a line starting with a space. */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** "Add to calendar" for the customer: the event window, address and who to call. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ref = await resolveOrderToken(db, token);
  const q = ref ? await quoteContext(db, ref.tenantId, ref.orderId) : null;
  if (!q || q.order.status === 'cancelled') return new Response('Not found', { status: 404 });
  const o = q.order;
  const phone = formatPhone(q.location.phone ?? q.tenant.phone, q.tenant.country);
  const what = o.eventType && !/^other$/i.test(o.eventType) ? o.eventType : 'Event';
  const where = [o.eventLocationName, o.eventLine1, o.eventCity, o.eventRegion].filter(Boolean).join(', ');
  const items = q.lines.map((l) => `${l.name}${l.quantity > 1 ? ` × ${l.quantity}` : ''}`).join(', ');
  const description = [`Order ${o.number} with ${q.tenant.name}.`, items && `Rentals: ${items}.`, phone && `Questions? Call ${phone}.`].filter(Boolean).join('\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tentpole//Rentals//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${o.id}@tentpole`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(o.eventStartsAt)}`,
    `DTEND:${stamp(o.eventEndsAt)}`,
    `SUMMARY:${esc(`${what} · ${q.tenant.name} rentals`)}`,
    ...(where ? [`LOCATION:${esc(where)}`] : []),
    `DESCRIPTION:${esc(description)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n');
  return new Response(`${ics}\r\n`, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `attachment; filename="${o.number.replace(/[^\w-]/g, '')}.ics"`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
    },
  });
}
