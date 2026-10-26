/**
 * Phase 3 · Ops board ("Action needed", design 30). Each card is an order that
 * needs a person, computed from the order itself whenever the board loads (so a
 * card is always current: paying a deposit or confirming the contact removes
 * it). Only "Snooze" and "Mark called" are stored.
 */
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { addDays, formatMoney, utcToWallTime } from '@rental/core';
import { withTenant, type Db } from '../client';
import { opsSnoozes, orders } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';
import { enqueueOrderMessage } from './messaging';
import { recordVersion } from './orders';

export type OpsRule = 'deposit' | 'final_payment' | 'call' | 'contact' | 'quote';
export type OpsAction = 'pay_link' | 'retry_charge' | 'mark_called' | 'text_contact' | 'follow_up' | 'open';

export const OPS_COLUMNS: { rule: OpsRule; label: string }[] = [
  { rule: 'deposit', label: 'Deposit needed' },
  { rule: 'final_payment', label: 'Final payment late' },
  { rule: 'call', label: 'Pre-event call due' },
  { rule: 'contact', label: 'Contact not confirmed' },
  { rule: 'quote', label: 'Quotes going cold' },
];

export type OpsCard = {
  rule: OpsRule; orderId: string; number: string; title: string; detail: string; locationId: string;
  /** Days from today (local) to when it matters; negative = overdue. Sorts the column. */
  dueIn: number; action: OpsAction;
  badge: string; tone: 'overdue' | 'today' | 'soon' | 'later';
};

const badgeFor = (dueIn: number): Pick<OpsCard, 'badge' | 'tone'> =>
  dueIn < 0 ? { badge: 'Overdue', tone: 'overdue' } : dueIn === 0 ? { badge: 'Today', tone: 'today' } : dueIn === 1 ? { badge: 'Tomorrow', tone: 'soon' } : { badge: `${dueIn} days`, tone: 'later' };

type Row = {
  id: string; number: string; status: string; location_id: string; tz: string; customer: string | null; event_type: string | null;
  starts: Date; total_cents: string; paid_cents: string; deposit_due_cents: string; unpaid_reason: string | null; expected_payment_on: string | null;
  contact_confirmed: boolean; contact_mobile: string | null; contact_name: string | null; pre_event_called_at: Date | null; quote_sent_at: Date | null;
  overdue_cents: string | null; overdue_due_on: string | null; charge_error: string | null; charge_at: Date | null; has_card: boolean;
};

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The cards, columns' counts, KPI tiles and tomorrow's events for the board. */
export function actionNeeded(db: Db, tenantId: string, opts: { locationId?: string | null; now?: Date; currency: string }) {
  const now = opts.now ?? new Date();
  const money = (c: number) => formatMoney(c, opts.currency);
  return withTenant(db, tenantId, async (tx) => {
    const loc = opts.locationId ? sql`and o.location_id = ${opts.locationId}::uuid` : sql``;
    const rows = (await tx.execute<Row>(sql`
      select o.id, o.number, o.status, o.location_id, coalesce(l.timezone, t.timezone) as tz, c.display_name as customer, o.event_type,
             o.event_starts_at as starts, o.total_cents::text, o.paid_cents::text, o.deposit_due_cents::text, o.unpaid_reason, o.expected_payment_on::text,
             o.contact_confirmed, o.event_contact_mobile as contact_mobile, o.event_contact_name as contact_name, o.pre_event_called_at, o.quote_sent_at,
             ov.cents::text as overdue_cents, ov.due_on::text as overdue_due_on, ov.err as charge_error, ov.charged as charge_at,
             exists (select 1 from payment_methods pm where pm.tenant_id = o.tenant_id and pm.customer_id = o.customer_id and pm.removed_at is null) as has_card
      from orders o
      join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id
      join tenants t on t.id = o.tenant_id
      left join lateral (
        select sum(i.amount_cents - i.paid_cents) as cents, min(i.due_on) as due_on, max(i.last_charge_error) as err, max(i.last_charge_at) as charged
        from invoices i where i.tenant_id = o.tenant_id and i.order_id = o.id and i.status = 'overdue'
      ) ov on true
      where o.tenant_id = ${tenantId}::uuid ${loc}
        and (
          (o.status = 'booked' and o.event_starts_at < ${new Date(now.getTime() + 15 * 86_400_000)}::timestamptz and o.event_ends_at > ${new Date(now.getTime() - 86_400_000)}::timestamptz)
          or (o.status in ('booked','completed') and ov.cents > 0)
          or (o.status = 'quote_sent' and o.event_starts_at > ${now}::timestamptz)
        )`)) as unknown as Row[];
    const snoozed = await tx.select({ orderId: opsSnoozes.orderId, rule: opsSnoozes.rule }).from(opsSnoozes)
      .where(and(eq(opsSnoozes.tenantId, tenantId), gt(opsSnoozes.until, now)));
    const hidden = new Set(snoozed.map((s) => `${s.orderId}:${s.rule}`));

    const cards: OpsCard[] = [];
    const add = (r: Row, rule: OpsRule, detail: string, dueIn: number, action: OpsAction, badge = badgeFor(dueIn)) => {
      if (hidden.has(`${r.id}:${rule}`)) return;
      cards.push({ rule, orderId: r.id, number: r.number, title: r.customer || 'Customer', detail, locationId: r.location_id, dueIn, action, ...badge });
    };
    for (const r of rows) {
      const today = utcToWallTime(now, r.tz).date;
      const day = utcToWallTime(r.starts, r.tz).date;
      const toEvent = days(today, day);
      const time = new Intl.DateTimeFormat('en-US', { timeZone: r.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(r.starts);
      const paid = Number(r.paid_cents);
      const deposit = Number(r.deposit_due_cents);
      if (Number(r.overdue_cents) > 0) {
        add(r, 'final_payment', r.charge_error
          ? `Auto-charge declined${r.charge_at ? ` ${short(utcToWallTime(r.charge_at, r.tz).date)}` : ''} · ${money(Number(r.overdue_cents))} due`
          : `${money(Number(r.overdue_cents))} was due ${short(r.overdue_due_on!)}`, Math.min(-1, days(today, r.overdue_due_on!)), r.has_card ? 'retry_charge' : 'pay_link');
      }
      if (r.status === 'booked' && toEvent >= 0) {
        if (paid < deposit) {
          const by = r.expected_payment_on ?? day;
          add(r, 'deposit', r.unpaid_reason
            ? `Booked without payment · ${r.unpaid_reason.toLowerCase()}${r.expected_payment_on ? ` · expected ${short(r.expected_payment_on)}` : ''}`
            : `${money(deposit - paid)} deposit not paid · event ${short(day)}`, days(today, by), 'pay_link');
        }
        if (toEvent <= 2 && !r.pre_event_called_at) add(r, 'call', `Event ${time} · confirm the setup spot and arrival`, Math.max(0, toEvent - 1), 'mark_called');
        if (toEvent <= 7 && (!r.contact_confirmed || !r.contact_mobile)) {
          add(r, 'contact', !r.contact_mobile ? 'On-site contact has no mobile number' : `${r.contact_name || 'On-site contact'} not confirmed yet`, Math.max(0, toEvent - 2), r.contact_mobile ? 'text_contact' : 'open');
        }
      }
      if (r.status === 'quote_sent' && r.quote_sent_at) {
        const age = days(utcToWallTime(r.quote_sent_at, r.tz).date, today);
        // Oldest quotes first; the badge says how old it is.
        if (age >= 3) add(r, 'quote', `Quote sent ${age} days ago · event ${short(day)}`, -age, 'follow_up', { badge: `${age} days`, tone: age >= 7 ? 'overdue' : 'later' });
      }
    }
    cards.sort((a, b) => a.dueIn - b.dueIn || a.number.localeCompare(b.number));

    // KPI tiles (design: quotes this week, quote → booking, open quote value, booked next 7 days).
    const week = 7 * 86_400_000;
    const [k] = (await tx.execute<Record<string, string>>(sql`
      select
        count(*) filter (where o.quote_sent_at >= ${new Date(now.getTime() - week)}::timestamptz)::text as quotes_week,
        count(*) filter (where o.quote_sent_at >= ${new Date(now.getTime() - 2 * week)}::timestamptz and o.quote_sent_at < ${new Date(now.getTime() - week)}::timestamptz)::text as quotes_prev,
        count(*) filter (where o.quote_sent_at >= ${new Date(now.getTime() - 30 * 86_400_000)}::timestamptz)::text as sent_30,
        count(*) filter (where o.quote_sent_at >= ${new Date(now.getTime() - 30 * 86_400_000)}::timestamptz and o.status in ('booked','completed'))::text as booked_30,
        count(*) filter (where o.quote_sent_at >= ${new Date(now.getTime() - 60 * 86_400_000)}::timestamptz and o.quote_sent_at < ${new Date(now.getTime() - 30 * 86_400_000)}::timestamptz)::text as sent_prev,
        count(*) filter (where o.quote_sent_at >= ${new Date(now.getTime() - 60 * 86_400_000)}::timestamptz and o.quote_sent_at < ${new Date(now.getTime() - 30 * 86_400_000)}::timestamptz and o.status in ('booked','completed'))::text as booked_prev,
        coalesce(sum(o.total_cents) filter (where o.status = 'quote_sent' and o.event_starts_at > ${now}::timestamptz), 0)::text as open_value,
        count(*) filter (where o.status = 'quote_sent' and o.event_starts_at > ${now}::timestamptz)::text as open_count,
        coalesce(sum(o.total_cents) filter (where o.status in ('booked','completed') and o.event_starts_at >= ${now}::timestamptz and o.event_starts_at < ${new Date(now.getTime() + week)}::timestamptz), 0)::text as next7,
        coalesce(sum(o.total_cents) filter (where o.status in ('booked','completed') and o.event_starts_at >= ${new Date(now.getTime() - 52 * week)}::timestamptz and o.event_starts_at < ${new Date(now.getTime() - 51 * week)}::timestamptz), 0)::text as next7_ly
      from orders o where o.tenant_id = ${tenantId}::uuid ${loc}`)) as unknown as Record<string, string>[];
    const n = (key: string) => Number(k?.[key] ?? 0);
    const rate = (b: number, s: number) => (s ? Math.round((b / s) * 100) : null);
    // Weekly bars for the tiles: the last 8 weeks.
    const series = (await tx.execute<{ w: number; quotes: string; booked_value: string }>(sql`
      select w, count(o.id) filter (where o.quote_sent_at >= ${now}::timestamptz - (w + 1) * interval '7 days' and o.quote_sent_at < ${now}::timestamptz - w * interval '7 days')::text as quotes,
             coalesce(sum(o.total_cents) filter (where o.status in ('booked','completed') and o.event_starts_at >= ${now}::timestamptz - (w + 1) * interval '7 days' and o.event_starts_at < ${now}::timestamptz - w * interval '7 days'), 0)::text as booked_value
      from generate_series(0, 7) w left join orders o on o.tenant_id = ${tenantId}::uuid ${loc}
      group by w order by w desc`)) as unknown as { w: number; quotes: string; booked_value: string }[];
    const kpis = {
      quotesWeek: n('quotes_week'), quotesDelta: n('quotes_week') - n('quotes_prev'),
      conversion: rate(n('booked_30'), n('sent_30')), conversionDelta: rate(n('booked_30'), n('sent_30')) != null && rate(n('booked_prev'), n('sent_prev')) != null ? rate(n('booked_30'), n('sent_30'))! - rate(n('booked_prev'), n('sent_prev'))! : null,
      openValue: money(n('open_value')), openCount: n('open_count'),
      next7: money(n('next7')), next7Change: n('next7_ly') ? Math.round(((n('next7') - n('next7_ly')) / n('next7_ly')) * 100) : null,
      quotesSeries: series.map((s) => Number(s.quotes)), bookedSeries: series.map((s) => Number(s.booked_value)),
    };

    // Tomorrow, in each location's time zone.
    const tomorrow = (await tx.execute<{ id: string; number: string; customer: string | null; event_type: string | null; starts: Date; tz: string; items: string | null; total_cents: string; paid_cents: string }>(sql`
      select o.id, o.number, c.display_name as customer, o.event_type, o.event_starts_at as starts, coalesce(l.timezone, t.timezone) as tz, o.total_cents::text, o.paid_cents::text,
             (select string_agg(ol.name || case when ol.quantity > 1 then ' ×' || ol.quantity else '' end, ' · ' order by ol.sort) from order_lines ol where ol.tenant_id = o.tenant_id and ol.order_id = o.id) as items
      from orders o join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      join locations l on l.tenant_id = o.tenant_id and l.id = o.location_id join tenants t on t.id = o.tenant_id
      where o.tenant_id = ${tenantId}::uuid ${loc} and o.status = 'booked'
        and (o.event_starts_at at time zone coalesce(l.timezone, t.timezone))::date = ((${now}::timestamptz at time zone coalesce(l.timezone, t.timezone))::date + 1)
      order by o.event_starts_at`)) as unknown as { id: string; number: string; customer: string | null; event_type: string | null; starts: Date; tz: string; items: string | null; total_cents: string; paid_cents: string }[];
    const tomorrowDay = addDays(utcToWallTime(now, rows[0]?.tz ?? tomorrow[0]?.tz ?? 'UTC').date, 1);

    return {
      cards,
      kpis,
      tomorrow: {
        date: tomorrowDay,
        events: tomorrow.map((e) => ({
          id: e.id, number: e.number, title: e.customer || 'Customer', items: e.items ?? '',
          time: new Intl.DateTimeFormat('en-US', { timeZone: e.tz, hour: 'numeric', minute: '2-digit' }).format(e.starts),
          pay: Number(e.paid_cents) >= Number(e.total_cents) ? 'Paid' : Number(e.paid_cents) > 0 ? 'Deposit paid' : 'Unpaid',
        })),
      },
    };
  });
}
export type ActionNeeded = Awaited<ReturnType<typeof actionNeeded>>;

/** Hide a card until later ("Snooze 1 day", or after an action that needs time to land). */
export function snoozeCard(db: Db, tenantId: string, actor: Actor, orderId: string, rule: OpsRule, hours = 24, reason = 'Snoozed') {
  return withTenant(db, tenantId, async (tx) => {
    const until = new Date(Date.now() + hours * 3_600_000);
    await tx.insert(opsSnoozes).values({ tenantId, orderId, rule, until, reason, createdByUserId: actor.userId ?? null })
      .onConflictDoUpdate({ target: [opsSnoozes.tenantId, opsSnoozes.orderId, opsSnoozes.rule], set: { until, reason, createdByUserId: actor.userId ?? null } });
    await audit(tx, tenantId, actor, { type: 'order', id: orderId }, 'ops.snoozed', { rule, hours, reason });
    return until;
  });
}

/** "Mark called": the pre-event call was made. Logged on the order (history). */
export function markPreEventCalled(db: Db, tenantId: string, actor: Actor, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).for('update').limit(1);
    if (!o) throw new OrgError('Order not found.', 'not_found');
    const [after] = await tx.update(orders).set({ preEventCalledAt: new Date(), version: o.version + 1 })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).returning();
    await recordVersion(tx, tenantId, actor, after!, 'call_logged', { 'Pre-event call': { from: '', to: 'made' } });
    await audit(tx, tenantId, actor, { type: 'order', id: orderId }, 'order.pre_event_called', { number: o.number });
    return after!;
  });
}

/** "Text contact": the quality-check text to the on-site contact, now (asks them to confirm time and spot). */
export function textOnsiteContact(db: Db, tenantId: string, actor: Actor, orderId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const msg = await enqueueOrderMessage(tx, tenantId, orderId, 'quality_check', `${orderId}:quality_check:manual:${Date.now()}`, {
      automatic: false, channel: 'sms', audience: 'contact',
    });
    await audit(tx, tenantId, actor, { type: 'order', id: orderId }, 'ops.contact_texted', {});
    return msg;
  });
}

/** Cards of these orders that are snoozed right now (used after an action to hide the card). */
export function snoozedRules(db: Db, tenantId: string, orderIds: string[]) {
  return withTenant(db, tenantId, (tx) =>
    orderIds.length ? tx.select().from(opsSnoozes).where(and(eq(opsSnoozes.tenantId, tenantId), inArray(opsSnoozes.orderId, orderIds), gt(opsSnoozes.until, new Date()))) : Promise.resolve([]));
}
