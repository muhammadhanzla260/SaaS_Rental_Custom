import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays, defaultTemplate, MESSAGE_TYPES, outsideQuietHours, parsePreferences, resolveMessaging, SCHEDULED_TYPES, scheduledAt, templateSchema,
  utcToWallTime, type Channel, type MessageType, type TemplateInput, type TenantPreferences,
} from '@rental/core';
import { withTenant, type Db, type Tx } from '../client';
import { decryptSecret, encryptSecret, sha256Hex } from '../crypto';
import { customers, locations, messages, messageTemplates, orders, payments, signatures, tenants, users } from '../schema';
import { audit, type Actor } from './audit';
import { OrgError } from './errors';

export type Message = typeof messages.$inferSelect;
export type MessageStatus = Message['status'];

// --- templates ------------------------------------------------------------------------------------

/** The workspace's template, or the built-in default when it never changed it. */
export async function templateFor(tx: Tx, tenantId: string, type: MessageType, channel: Channel) {
  const [row] = await tx
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.tenantId, tenantId), eq(messageTemplates.type, type), eq(messageTemplates.channel, channel)))
    .limit(1);
  const base = defaultTemplate(type, channel);
  if (!row) return { ...base, custom: false as const, version: 0, updatedByName: null as string | null, updatedAt: null as Date | null };
  return {
    ...base,
    subject: row.subject, body: row.body, buttonText: row.buttonText, mode: row.mode as 'builder' | 'raw', rawSource: row.rawSource,
    rawKind: row.rawKind as 'html' | 'xml', attachDocument: row.attachDocument, attachAgreement: row.attachAgreement, tracking: row.tracking,
    autoPlainText: row.autoPlainText, custom: true as const, version: row.version, updatedByName: row.updatedByName, updatedAt: row.updatedAt,
  };
}
export type ResolvedTemplate = Awaited<ReturnType<typeof templateFor>>;

export function getTemplate(db: Db, tenantId: string, type: MessageType, channel: Channel) {
  return withTenant(db, tenantId, (tx) => templateFor(tx, tenantId, type, channel));
}

/** Which templates a workspace changed (for the list's "edited" marks). */
export function customTemplates(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({ type: messageTemplates.type, channel: messageTemplates.channel, version: messageTemplates.version, updatedAt: messageTemplates.updatedAt })
      .from(messageTemplates)
      .where(eq(messageTemplates.tenantId, tenantId)),
  );
}

export function saveTemplate(db: Db, tenantId: string, actor: Actor, type: MessageType, channel: Channel, input: TemplateInput) {
  return withTenant(db, tenantId, async (tx) => {
    const t = templateSchema.parse(input);
    const [u] = actor.userId ? await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1) : [];
    const [row] = await tx
      .insert(messageTemplates)
      .values({ tenantId, type, channel, ...t, updatedByName: u?.name ?? null })
      .onConflictDoUpdate({
        target: [messageTemplates.tenantId, messageTemplates.type, messageTemplates.channel],
        set: { ...t, updatedByName: u?.name ?? null, version: sql`${messageTemplates.version} + 1`, updatedAt: new Date() },
      })
      .returning();
    await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, 'template.saved', { type, channel, version: row!.version, mode: t.mode });
    return row!;
  });
}

export function restoreTemplate(db: Db, tenantId: string, actor: Actor, type: MessageType, channel: Channel) {
  return withTenant(db, tenantId, async (tx) => {
    await tx
      .delete(messageTemplates)
      .where(and(eq(messageTemplates.tenantId, tenantId), eq(messageTemplates.type, type), eq(messageTemplates.channel, channel)));
    await audit(tx, tenantId, actor, { type: 'tenant', id: tenantId }, 'template.restored', { type, channel });
  });
}

// --- quote links ----------------------------------------------------------------------------------

/** The order's quote-page token: made once, kept encrypted so every email links to the same page. */
export async function ensureOrderToken(tx: Tx, tenantId: string, orderId: string): Promise<string> {
  const [o] = await tx
    .select({ enc: orders.accessTokenEnc })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  if (!o) throw new OrgError('Order not found.', 'not_found');
  if (o.enc) return decryptSecret(o.enc);
  const token = randomBytes(24).toString('base64url');
  await tx
    .update(orders)
    .set({ accessTokenEnc: encryptSecret(token), accessTokenHash: sha256Hex(token) })
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
  return token;
}

/** Which workspace and order a quote link belongs to (null if unknown). */
export async function resolveOrderToken(db: Db, token: string): Promise<{ tenantId: string; orderId: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const rows = await db.execute<{ tenant_id: string; order_id: string }>(sql`select * from app_order_by_token(${sha256Hex(token)})`);
  const r = [...rows][0];
  return r ? { tenantId: r.tenant_id, orderId: r.order_id } : null;
}

export const quoteUrl = (token: string) => `${(process.env.APP_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000').replace(/\/$/, '')}/q/${token}`;

// --- queue --------------------------------------------------------------------------------------------

export type Enqueue = {
  key: string;
  type: MessageType;
  channel: Channel;
  orderId?: string | null;
  locationId?: string | null;
  audience?: 'customer' | 'contact' | 'office';
  toAddress?: string | null;
  toName?: string | null;
  scheduledFor?: Date;
  meta?: Record<string, unknown>;
  /** Already decided not to send (no address, opted out): logged as skipped with the reason. */
  skip?: string | null;
};

/** Add a message unless one with the same key exists. Returns the new row, or null for a duplicate. */
export async function enqueueMessage(tx: Tx, tenantId: string, m: Enqueue) {
  const [row] = await tx
    .insert(messages)
    .values({
      tenantId, idempotencyKey: m.key, type: m.type, channel: m.channel, orderId: m.orderId ?? null, locationId: m.locationId ?? null,
      audience: m.audience ?? 'customer', toAddress: m.toAddress ?? null, toName: m.toName ?? null, scheduledFor: m.scheduledFor ?? new Date(),
      meta: m.meta ?? {}, status: m.skip ? 'skipped' : 'queued', lastError: m.skip ?? null,
    })
    // Same key again: a row cancelled by an earlier re-plan comes back (a rule changed and changed back);
    // anything queued, sent or skipped is left alone, so a message can never go out twice.
    .onConflictDoUpdate({
      target: [messages.tenantId, messages.idempotencyKey],
      set: { status: m.skip ? 'skipped' : 'queued', lastError: m.skip ?? null, scheduledFor: m.scheduledFor ?? new Date(), updatedAt: new Date() },
      setWhere: sql`${messages.status} = 'cancelled'`,
    })
    .returning();
  return row ?? null;
}

async function orderForMessages(tx: Tx, tenantId: string, orderId: string) {
  const [row] = await tx
    .select({ order: orders, customer: customers, location: locations })
    .from(orders)
    .innerJoin(customers, and(eq(customers.tenantId, orders.tenantId), eq(customers.id, orders.customerId)))
    .innerJoin(locations, and(eq(locations.tenantId, orders.tenantId), eq(locations.id, orders.locationId)))
    .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)))
    .limit(1);
  return row ?? null;
}

/** Who a customer message goes to: the billing email on the order, else the customer's. */
function recipient(r: NonNullable<Awaited<ReturnType<typeof orderForMessages>>>, channel: Channel, audience: 'customer' | 'contact') {
  const billing = (r.order.billing ?? {}) as { email?: string; phone?: string; name?: string };
  if (channel === 'sms') {
    const phone = audience === 'contact' ? r.order.eventContactMobile ?? r.customer.phone : billing.phone ?? r.customer.phone;
    if (!phone) return { to: null, name: null, skip: 'No mobile number on the order' };
    if (!r.customer.smsOptIn) return { to: phone, name: null, skip: 'Customer opted out of texts' };
    return { to: phone, name: audience === 'contact' ? r.order.eventContactName : billing.name ?? r.customer.displayName, skip: null };
  }
  const email = billing.email || r.customer.email;
  return email ? { to: email, name: billing.name || r.customer.displayName, skip: null } : { to: null, name: null, skip: 'No email address on the order' };
}

/**
 * Queue an instant customer message for an order. `automatic` messages (receipts,
 * confirmations) only go out when automations are live and that type is on;
 * staff-pressed ones (Send quote, Email invoice) always go.
 */
export async function enqueueOrderMessage(
  tx: Tx, tenantId: string, orderId: string, type: MessageType, key: string,
  opts: {
    automatic: boolean; meta?: Record<string, unknown>; channel?: Channel; audience?: 'customer' | 'contact';
    /** A staff-pressed send that still honours its own on/off switch (coach texts). */
    honourSwitch?: boolean;
  } = { automatic: true },
) {
  const r = await orderForMessages(tx, tenantId, orderId);
  if (!r) return null;
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const m = resolveMessaging(parsePreferences(t?.settings).messaging);
  const channel = opts.channel ?? 'email';
  const on = m.instant[type] ?? true;
  let skip: string | null = null;
  if (opts.automatic && !m.live) skip = 'Automations are off';
  else if ((opts.automatic || opts.honourSwitch) && !on) skip = `${MESSAGE_TYPES[type].label} is switched off`;
  const to = recipient(r, channel, opts.audience ?? 'customer');
  skip = skip ?? to.skip;
  return enqueueMessage(tx, tenantId, {
    key, type, channel, orderId, locationId: r.order.locationId, audience: opts.audience ?? 'customer', toAddress: to.to, toName: to.name,
    meta: opts.meta, skip,
  });
}

/**
 * The payment confirmation (Odoo's payment_partial / payment_paid): "partial"
 * while money is still owed, "paid" once the order is paid in full. One per payment.
 */
export function enqueuePaymentConfirmation(
  tx: Tx, tenantId: string, order: { id: string; totalCents: number; paidCents: number }, paymentId: string, automatic = true,
) {
  const type: MessageType = order.paidCents >= order.totalCents ? 'payment_paid' : 'payment_partial';
  return enqueueOrderMessage(tx, tenantId, order.id, type, `${paymentId}:payment`, { automatic, meta: { paymentId } });
}

/** An alert to the office (declined card, last-minute booking, change request). */
export async function enqueueOfficeAlert(tx: Tx, tenantId: string, type: MessageType, key: string, orderId: string | null, meta: Record<string, unknown> = {}) {
  const [t] = await tx.select({ settings: tenants.settings, email: tenants.email }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const m = resolveMessaging(parsePreferences(t?.settings).messaging);
  const to = m.alertsTo[0] ?? t?.email ?? null;
  const skip = !m.internal[type] ? 'Alert switched off' : !to ? 'No alerts email set' : null;
  return enqueueMessage(tx, tenantId, { key, type, channel: 'email', orderId, audience: 'office', toAddress: to, toName: 'Office', meta: { ...meta, cc: m.alertsTo.slice(1) }, skip });
}

const REMINDERS = new Set(['pre_event', 'quality_check', 'day_before']);

/**
 * (Re)plan a booked order's scheduled messages from the automation rules, in
 * the location's time zone. Keys carry the due time, so moving the event or a
 * rule creates new rows and the stale queued ones are cancelled.
 */
export async function planOrderMessages(tx: Tx, tenantId: string, orderId: string, prefs?: TenantPreferences) {
  const r = await orderForMessages(tx, tenantId, orderId);
  if (!r) return { planned: 0, cancelled: 0 };
  const p = prefs ?? parsePreferences((await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0]?.s);
  const m = resolveMessaging(p.messaging);
  const keep: string[] = [];
  const now = Date.now();
  if (r.order.status === 'booked' && m.live) {
    const tz = r.location.timezone;
    const event = { startsAt: r.order.eventStartsAt, endsAt: r.order.eventEndsAt };
    const bookedLate = r.order.bookedAt && event.startsAt.getTime() - r.order.bookedAt.getTime() < m.skipRemindersWithinHours * 3_600_000;
    for (const type of SCHEDULED_TYPES) {
      const rule = m.schedules[type]!;
      if (!rule.enabled) continue;
      if (REMINDERS.has(type) && bookedLate) continue;
      const at = scheduledAt(rule, event, tz);
      if (at.getTime() <= now) continue;
      const channels: Channel[] = type === 'charge_balance' ? ['email'] : (rule.channels.filter((c) => c !== 'charge') as Channel[]);
      for (const channel of channels) {
        const when = channel === 'sms' ? outsideQuietHours(at, tz, m.quietFrom, m.quietTo) : at;
        const key = `${orderId}:${type}:${channel}:${when.toISOString()}`;
        keep.push(key);
        const audience = type === 'quality_check' ? 'contact' : 'customer';
        const to = recipient(r, channel, audience);
        await enqueueMessage(tx, tenantId, {
          key, type, channel, orderId, locationId: r.order.locationId, audience, toAddress: to.to, toName: to.name, scheduledFor: when,
          meta: type === 'charge_balance' ? { charge: rule.channels.includes('charge') } : {}, skip: type === 'charge_balance' ? null : to.skip,
        });
      }
    }
  }
  const stale = await tx
    .update(messages)
    .set({ status: 'cancelled', lastError: r.order.status === 'cancelled' ? 'Order cancelled' : 'Rescheduled or switched off' })
    .where(
      and(
        eq(messages.tenantId, tenantId),
        eq(messages.orderId, orderId),
        eq(messages.status, 'queued'),
        inArray(messages.type, SCHEDULED_TYPES as string[]),
        keep.length ? notInArray(messages.idempotencyKey, keep) : undefined,
      ),
    )
    .returning({ id: messages.id });
  return { planned: keep.length, cancelled: stale.length };
}

/** After automations or schedules change: re-plan every upcoming booked order. */
export function replanAll(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const upcoming = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.status, ['booked', 'cancelled']), sql`${orders.eventEndsAt} > now() - interval '8 days'`));
    let planned = 0;
    for (const o of upcoming) planned += (await planOrderMessages(tx, tenantId, o.id)).planned;
    return { orders: upcoming.length, planned };
  });
}

// --- log --------------------------------------------------------------------------------------------

export type MessageFilters = { status?: MessageStatus | 'all' | 'upcoming'; type?: string; orderId?: string; search?: string; limit?: number };

export function listMessages(db: Db, tenantId: string, f: MessageFilters = {}) {
  return withTenant(db, tenantId, async (tx) => {
    const conds: (SQL | undefined)[] = [
      eq(messages.tenantId, tenantId),
      f.status === 'upcoming' ? eq(messages.status, 'queued') : f.status && f.status !== 'all' ? eq(messages.status, f.status) : undefined,
      f.type ? eq(messages.type, f.type) : undefined,
      f.orderId ? eq(messages.orderId, f.orderId) : undefined,
      f.search ? or(ilike(messages.toAddress, `%${f.search}%`), ilike(messages.subject, `%${f.search}%`), ilike(orders.number, `%${f.search}%`)) : undefined,
    ];
    const rows = await tx
      .select({ m: messages, orderNumber: orders.number })
      .from(messages)
      .leftJoin(orders, and(eq(orders.tenantId, messages.tenantId), eq(orders.id, messages.orderId)))
      .where(and(...conds))
      .orderBy(f.status === 'upcoming' ? asc(messages.scheduledFor) : desc(sql`coalesce(${messages.sentAt}, ${messages.scheduledFor})`))
      .limit(f.limit ?? 200);
    const [counts] = await tx
      .select({
        all: sql<number>`count(*)::int`,
        upcoming: sql<number>`(count(*) filter (where ${messages.status} = 'queued'))::int`,
        sent: sql<number>`(count(*) filter (where ${messages.status} in ('sent','delivered')))::int`,
        failed: sql<number>`(count(*) filter (where ${messages.status} in ('failed','bounced')))::int`,
        skipped: sql<number>`(count(*) filter (where ${messages.status} in ('skipped','cancelled')))::int`,
      })
      .from(messages)
      .where(eq(messages.tenantId, tenantId));
    return { rows: rows.map((r) => ({ ...r.m, orderNumber: r.orderNumber })), counts: counts! };
  });
}

export function getMessage(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.id, id))).limit(1);
    return m ?? null;
  });
}

/** Send a logged message again: a new row (new key), same type and order. */
export function resendMessage(db: Db, tenantId: string, actor: Actor, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.id, id))).limit(1);
    if (!m) throw new OrgError('Message not found.', 'not_found');
    const row = await enqueueMessage(tx, tenantId, {
      key: `${m.idempotencyKey}:resend:${Date.now()}`, type: m.type as MessageType, channel: m.channel as Channel, orderId: m.orderId,
      locationId: m.locationId, audience: m.audience as 'customer', toAddress: m.toAddress, toName: m.toName, meta: { ...(m.meta as object), resendOf: m.id },
    });
    await audit(tx, tenantId, actor, { type: 'order', id: m.orderId ?? tenantId }, 'message.resent', { type: m.type, to: m.toAddress });
    return row!;
  });
}

// --- delivery bookkeeping (used by the dispatcher) --------------------------------------------------------

/** Take one queued message for sending (no-one else can take it after this). */
export function claimMessage(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx
      .update(messages)
      .set({ status: 'sending', attempts: sql`${messages.attempts} + 1` })
      .where(and(eq(messages.tenantId, tenantId), eq(messages.id, id), eq(messages.status, 'queued'), lte(messages.scheduledFor, new Date())))
      .returning();
    return m ?? null;
  });
}

/** Queued messages of one order that are due now (sent right after a staff action). */
export function dueForOrder(db: Db, tenantId: string, orderId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.tenantId, tenantId), eq(messages.orderId, orderId), eq(messages.status, 'queued'), lte(messages.scheduledFor, new Date()))),
  );
}

/**
 * Worker only (owner connection, all workspaces): claim up to `limit` due
 * messages with SKIP LOCKED so parallel workers never take the same one.
 */
export async function claimDueMessages(ownerDb: Db, limit = 20) {
  const rows = await ownerDb.execute<{ tenant_id: string; id: string }>(sql`
    update messages set status = 'sending', attempts = attempts + 1, updated_at = now()
    where (tenant_id, id) in (
      select tenant_id, id from messages where status = 'queued' and scheduled_for <= now()
      order by scheduled_for limit ${limit} for update skip locked)
    returning tenant_id, id`);
  return [...rows].map((r) => ({ tenantId: r.tenant_id, id: r.id }));
}

/** Messages stuck in 'sending' (a crash mid-send) go back to the queue after 10 minutes. */
export async function releaseStuckMessages(ownerDb: Db) {
  await ownerDb.execute(sql`update messages set status = 'queued' where status = 'sending' and updated_at < now() - interval '10 minutes'`);
}

export type SendOutcome =
  | { ok: true; subject: string | null; html: string | null; text: string; providerRef: string | null; to: string | null }
  | { ok: false; error: string; permanent?: boolean; subject?: string | null; html?: string | null; text?: string | null }
  | { skipped: string };

/** Record how a send went. Failures retry with backoff (5, 15, 45 min…) up to the workspace's retry limit. */
export function finishMessage(db: Db, tenantId: string, id: string, outcome: SendOutcome, retries = 3) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.id, id))).limit(1);
    if (!m) return null;
    if ('skipped' in outcome) {
      await tx.update(messages).set({ status: 'skipped', lastError: outcome.skipped }).where(and(eq(messages.tenantId, tenantId), eq(messages.id, id)));
      return 'skipped';
    }
    if (outcome.ok) {
      await tx
        .update(messages)
        .set({ status: 'sent', sentAt: new Date(), subject: outcome.subject, html: outcome.html, text: outcome.text, providerRef: outcome.providerRef, lastError: null, toAddress: outcome.to ?? m.toAddress })
        .where(and(eq(messages.tenantId, tenantId), eq(messages.id, id)));
      return 'sent';
    }
    const again = !outcome.permanent && m.attempts <= retries;
    await tx
      .update(messages)
      .set({
        status: again ? 'queued' : 'failed',
        lastError: outcome.error.slice(0, 1000),
        scheduledFor: again ? new Date(Date.now() + 5 * 60_000 * 3 ** Math.max(0, m.attempts - 1)) : m.scheduledFor,
        ...(outcome.subject !== undefined ? { subject: outcome.subject, html: outcome.html ?? null, text: outcome.text ?? null } : {}),
      })
      .where(and(eq(messages.tenantId, tenantId), eq(messages.id, id)));
    return again ? 'retrying' : 'failed';
  });
}

/** Everything a message needs to be rendered: the order with customer, location, lines and payments. */
export function messageContext(db: Db, tenantId: string, messageId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(messages).where(and(eq(messages.tenantId, tenantId), eq(messages.id, messageId))).limit(1);
    if (!m) return null;
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const prefs = parsePreferences(tenant!.settings);
    const template = await templateFor(tx, tenantId, m.type as MessageType, m.channel as Channel);
    const r = m.orderId ? await orderForMessages(tx, tenantId, m.orderId) : null;
    const token = m.orderId ? await ensureOrderToken(tx, tenantId, m.orderId) : null;
    type Line = { name: string; quantity: number; service_mode: 'staffed' | 'pickup' | 'dropoff'; line_total_cents: string; image_file_id: string | null };
    const lines = m.orderId
      ? ((await tx.execute<Line>(sql`
          select l.name, l.quantity, l.service_mode, l.line_total_cents::text, p.image_file_id
          from order_lines l left join products p on p.tenant_id = l.tenant_id and p.id = l.product_id
          where l.tenant_id = ${tenantId}::uuid and l.order_id = ${m.orderId}::uuid order by l.sort`)) as unknown as Line[])
      : [];
    // For the order blocks (payment history, contract status, "prepared by").
    const paid = m.orderId
      ? await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, m.orderId), eq(payments.status, 'received'))).orderBy(asc(payments.receivedAt))
      : [];
    const [sig] = m.orderId
      ? await tx.select({ id: signatures.id }).from(signatures).where(and(eq(signatures.tenantId, tenantId), eq(signatures.orderId, m.orderId))).limit(1)
      : [];
    const sp = r?.order.salespersonUserId;
    const [seller] = sp ? await tx.select({ name: users.name }).from(users).where(eq(users.id, sp)).limit(1) : [];
    return {
      message: m, tenant: tenant!, prefs, messaging: resolveMessaging(prefs.messaging), template, order: r?.order ?? null, customer: r?.customer ?? null,
      location: r?.location ?? null, lines: [...lines], payments: paid, signed: !!sig, preparedBy: seller?.name ?? null, token,
      payUrl: token ? quoteUrl(token) : null,
    };
  });
}
export type MessageContext = NonNullable<Awaited<ReturnType<typeof messageContext>>>;

// --- daily digest (worker) -------------------------------------------------------------------------------

/** Tomorrow's booked events for the office digest, in the tenant's time zone. */
export function tomorrowsEvents(db: Db, tenantId: string, timeZone: string) {
  return withTenant(db, tenantId, async (tx) => {
    const today = utcToWallTime(new Date(), timeZone).date;
    const tomorrow = addDays(today, 1);
    const rows = await tx.execute<{ number: string; name: string; starts: string; city: string | null; items: string | null }>(sql`
      select o.number, c.display_name as name, o.event_starts_at::text as starts, o.event_city as city,
             (select string_agg(l.name || case when l.quantity > 1 then ' ×' || l.quantity else '' end, ', ' order by l.sort) from order_lines l where l.tenant_id = o.tenant_id and l.order_id = o.id) as items
      from orders o join customers c on c.tenant_id = o.tenant_id and c.id = o.customer_id
      where o.tenant_id = ${tenantId}::uuid and o.status = 'booked'
        and (o.event_starts_at at time zone ${timeZone})::date = ${tomorrow}::date
      order by o.event_starts_at`);
    return { date: tomorrow, events: [...rows] };
  });
}
