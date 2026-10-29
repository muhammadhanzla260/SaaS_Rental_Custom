import { and, eq } from 'drizzle-orm';
import { renderMessage, type Channel, type MessageType } from '@rental/core';
import {
  claimDueMessages, claimMessage, decryptSecret, dueForOrder, finishMessage, getMailCredentials, messageContext, releaseStuckMessages, schema,
  withTenant, type Db, type MessageContext, type SendOutcome,
} from '@rental/db';
import { brandOf, fieldValues, summaryFor, type Extra } from './fields';
import { sendMail, sendSms } from './transport';

/** Optional work done before a message (Phase 2b: charge the saved card for charge_balance). */
export type Hooks = {
  chargeBalance?: (ctx: MessageContext) => Promise<{ ok: true; payment: NonNullable<Extra['payment']> } | { ok: false; skip?: string; error?: string }>;
};

async function paymentOf(db: Db, tenantId: string, id: unknown): Promise<Extra['payment']> {
  if (typeof id !== 'string') return null;
  return withTenant(db, tenantId, async (tx) => {
    const [p] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.tenantId, tenantId), eq(schema.payments.id, id)))
      .limit(1);
    if (!p) return null;
    const meta = (p as unknown as { cardLast4?: string | null }).cardLast4 ?? null;
    return { number: p.number, amountCents: p.amountCents, method: p.method, last4: meta };
  });
}

async function smsAccount(db: Db, tenantId: string) {
  return withTenant(db, tenantId, async (tx) => {
    const [a] = await tx.select().from(schema.smsAccounts).where(eq(schema.smsAccounts.tenantId, tenantId)).limit(1);
    return a ? { provider: a.provider, sendingNumber: a.sendingNumber, accountId: a.accountId, secret: a.secretEnc ? decryptSecret(a.secretEnc) : null } : null;
  });
}

/** Render a message for preview or sending (no side effects). */
export function render(ctx: MessageContext, extra: Extra = {}) {
  const type = ctx.message.type as MessageType;
  const values = fieldValues(ctx, extra);
  return renderMessage({
    channel: ctx.message.channel as Channel,
    template: ctx.template,
    values,
    brand: brandOf(ctx),
    summary: summaryFor(type, values),
    links: { pay_link: ctx.payUrl, review_link: ctx.prefs.brand.reviewLink ?? null },
  });
}

/** Send one message that has already been claimed (status 'sending'). */
async function deliver(db: Db, tenantId: string, id: string, hooks: Hooks): Promise<SendOutcome & { retries?: number }> {
  const ctx = await messageContext(db, tenantId, id);
  if (!ctx) return { skipped: 'Message no longer exists' };
  const m = ctx.message;
  const meta = (m.meta ?? {}) as Record<string, unknown>;
  const retries = ctx.messaging.retries;
  if (ctx.order?.status === 'cancelled' && m.type !== 'cancellation') return { skipped: 'Order cancelled' };

  let extra: Extra = { payment: await paymentOf(db, tenantId, meta.paymentId) };
  if (meta.invoiceNumber) extra.invoice = { number: String(meta.invoiceNumber), amountCents: Number(meta.invoiceAmountCents ?? 0) };

  if (m.type === 'charge_balance') {
    if (!ctx.order || ctx.order.paidCents >= ctx.order.totalCents) return { skipped: 'Nothing left to pay' };
    if (meta.charge === false) return { skipped: 'Charging is switched off for this message' };
    if (!hooks.chargeBalance) return { skipped: 'No card charging set up yet' };
    const r = await hooks.chargeBalance(ctx);
    if (!r.ok) return r.skip ? { skipped: r.skip } : { ok: false, error: r.error ?? 'Charge failed', permanent: true };
    extra = { ...extra, payment: r.payment };
  }
  if (!m.toAddress) return { skipped: m.channel === 'sms' ? 'No mobile number' : 'No email address' };

  const out = render(ctx, extra);
  try {
    if (m.channel === 'sms') {
      const r = await sendSms(await smsAccount(db, tenantId), m.toAddress, out.text);
      return { ok: true, subject: null, html: null, text: out.text, providerRef: r.ref, to: m.toAddress, retries };
    }
    const acc = await getMailCredentials(db, tenantId, m.locationId);
    const fromEmail = acc?.mode === 'smtp' && acc.fromEmail ? acc.fromEmail : process.env.PLATFORM_MAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? 'no-reply@localhost';
    const fromName = acc?.fromName || ctx.tenant.name;
    const customer = m.audience !== 'office';
    const r = await sendMail(acc ? { mode: acc.mode, smtp: { ...acc, password: acc.password } } : null, {
      from: `"${fromName.replace(/"/g, '')}" <${fromEmail}>`,
      to: m.toName ? `"${m.toName.replace(/"/g, '')}" <${m.toAddress}>` : m.toAddress,
      replyTo: ctx.messaging.replyTo || acc?.replyTo || undefined,
      cc: customer ? ctx.messaging.cc : ((meta.cc as string[] | undefined) ?? []),
      bcc: customer ? ctx.messaging.bcc : [],
      subject: out.subject,
      html: out.html ?? '',
      text: out.text,
      ref: m.idempotencyKey,
    });
    return { ok: true, subject: out.subject, html: out.html, text: out.text, providerRef: r.ref, to: m.toAddress, retries };
  } catch (e) {
    const err = e as Error & { permanent?: boolean };
    return { ok: false, error: err.message, permanent: !!err.permanent, subject: out.subject, html: out.html, text: out.text, retries };
  }
}

async function run(db: Db, tenantId: string, id: string, hooks: Hooks) {
  let outcome: SendOutcome & { retries?: number };
  try {
    outcome = await deliver(db, tenantId, id, hooks);
  } catch (e) {
    outcome = { ok: false, error: (e as Error).message };
  }
  return finishMessage(db, tenantId, id, outcome, outcome && 'retries' in outcome ? outcome.retries : 3);
}

/** Send one queued message now (claims it first, so it can never go out twice). */
export async function dispatchMessage(db: Db, tenantId: string, id: string, hooks: Hooks = {}) {
  const claimed = await claimMessage(db, tenantId, id);
  if (!claimed) return 'not_claimed' as const;
  return run(db, tenantId, id, hooks);
}

/** Send whatever an order has due right now (called right after a staff action). */
export async function dispatchOrder(db: Db, tenantId: string, orderId: string, hooks: Hooks = {}) {
  const due = await dueForOrder(db, tenantId, orderId);
  const results = [];
  for (const d of due) results.push(await dispatchMessage(db, tenantId, d.id, hooks));
  return results;
}

/** Worker: claim due messages across workspaces (owner connection) and send them with the app connection. */
export async function dispatchDue(ownerDb: Db, appDb: Db, hooks: Hooks = {}, limit = 20) {
  await releaseStuckMessages(ownerDb);
  const claimed = await claimDueMessages(ownerDb, limit);
  const results = [];
  for (const c of claimed) results.push({ ...c, result: await run(appDb, c.tenantId, c.id, hooks) });
  return results;
}
