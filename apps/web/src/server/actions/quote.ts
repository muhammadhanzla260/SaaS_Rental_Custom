'use server';

/**
 * The customer's quote page (public). Every action starts from the link's token:
 * it names exactly one order, and everything else is read inside that order's
 * workspace with row-level security on. Customer edits go through the same
 * services as staff edits (pricing, versions, messages).
 */
import { headers } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { parsePreferences, signSchema } from '@rental/core';
import {
  enqueueOfficeAlert, getOrder, orderInputFrom, quoteContext, resolveOrderToken, signAgreement, transitionOrder, updateOrder, withTenant,
} from '@rental/db';
import { dispatchMessage, dispatchOrder } from '@rental/messaging';
import { finishCardPayment, startCardPayment } from '@rental/payments';
import { invalid, type ActionResult } from '@/lib/result';
import { db } from '../db';
import { run } from './run';

async function load(token: string) {
  const ref = await resolveOrderToken(db, token);
  if (!ref) throw Object.assign(new Error('This link is not valid any more.'), { expected: true });
  const q = await quoteContext(db, ref.tenantId, ref.orderId);
  if (!q) throw Object.assign(new Error('This link is not valid any more.'), { expected: true });
  if (q.order.status === 'cancelled') throw Object.assign(new Error('This order was cancelled.'), { expected: true });
  return q;
}
const open = (q: Awaited<ReturnType<typeof load>>) => q.order.status === 'draft' || q.order.status === 'quote_sent';
const expired = (q: Awaited<ReturnType<typeof load>>) => open(q) && !!q.order.quoteExpiresOn && q.order.quoteExpiresOn < new Date().toISOString().slice(0, 10);

/** Expected problems become a friendly message; anything else is logged and hidden. */
async function safe<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run<T>(fn);
  } catch (e) {
    if ((e as { expected?: boolean }).expected) return { ok: false, error: (e as Error).message };
    throw e;
  }
}

/** Accept or decline the damage waiver (re-prices the quote, before signing). */
export async function quoteWaiverAction(token: string, accept: boolean): Promise<ActionResult<{ totalCents: number; depositCents: number; waiverCents: number }>> {
  return safe<{ totalCents: number; depositCents: number; waiverCents: number }>(async () => {
    const q = await load(token);
    if (!open(q) || expired(q)) return { ok: false, error: 'This quote can no longer be changed.' };
    if (q.order.damageWaiver !== accept) {
      const full = await getOrder(db, q.tenant.id, q.order.id);
      const input = orderInputFrom(full!, full!.lines, full!.creditApplications, { damageWaiver: accept });
      await updateOrder(db, q.tenant.id, { type: 'customer' }, q.order.id, input, parsePreferences(q.tenant.settings), full!.version, accept ? 'Customer accepted the damage waiver' : 'Customer declined the damage waiver');
    }
    const after2 = await quoteContext(db, q.tenant.id, q.order.id);
    const s = (after2!.order.summary ?? {}) as { damageWaiverCents?: number };
    return { ok: true, data: { totalCents: after2!.order.totalCents, depositCents: after2!.order.depositDueCents, waiverCents: s.damageWaiverCents ?? 0 } };
  });
}

export async function quoteRequestChangesAction(token: string, message: string): Promise<ActionResult> {
  return safe(async () => {
    const q = await load(token);
    const text = z.string().trim().min(3, 'Tell us what you would like to change.').max(2000).safeParse(message);
    if (!text.success) return { ok: false, error: text.error.issues[0]!.message };
    const row = await withTenant(db, q.tenant.id, (tx) =>
      enqueueOfficeAlert(tx, q.tenant.id, 'change_request', `${q.order.id}:change_request:${Date.now()}`, q.order.id, { reason: text.data }),
    );
    if (row) after(() => dispatchMessage(db, q.tenant.id, row.id).then(() => undefined).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, message: `Thanks! ${q.tenant.name} will get back to you.` };
  });
}

export async function quoteSignAction(token: string, input: unknown): Promise<ActionResult<{ signedAt: string }>> {
  return safe<{ signedAt: string }>(async () => {
    const q = await load(token);
    if (expired(q)) return { ok: false, error: 'This quote has expired. Ask for a new one.' };
    const parsed = signSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const h = await headers();
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
    const s = await signAgreement(db, q.tenant.id, q.order.id, parsed.data, { ip, userAgent: h.get('user-agent') });
    return { ok: true, data: { signedAt: s.signedAt.toISOString() } };
  });
}

export type StartPayment = { clientSecret: string; intentId: string; publishableKey: string; amountCents: number };

export async function quoteStartPaymentAction(token: string, saveCard: boolean, payFull = false): Promise<ActionResult<StartPayment>> {
  return safe<StartPayment>(async () => {
    const q = await load(token);
    if (expired(q)) return { ok: false, error: 'This quote has expired. Ask for a new one.' };
    if (open(q) && !q.signature) return { ok: false, error: 'Please sign the agreement first.' };
    const r = await startCardPayment(db, q, { saveCard, payFull: payFull === true });
    return { ok: true, data: { clientSecret: r.clientSecret, intentId: r.intentId, publishableKey: r.publishableKey, amountCents: r.amountCents } };
  });
}

export async function quoteFinishPaymentAction(token: string, intentId: string): Promise<ActionResult<{ paymentNumber: string; last4: string | null; brand: string | null }>> {
  return safe<{ paymentNumber: string; last4: string | null; brand: string | null }>(async () => {
    const q = await load(token);
    const r = await finishCardPayment(db, q, z.string().regex(/^pi_[A-Za-z0-9]+$/).parse(intentId));
    if (!r.ok) return { ok: false, error: r.error };
    // Receipt and booking confirmation go out right after the response.
    after(() => dispatchOrder(db, q.tenant.id, q.order.id).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { paymentNumber: r.paymentNumber, last4: r.last4, brand: r.brand } };
  });
}

/** No deposit asked: signing books the order. */
export async function quoteBookAction(token: string): Promise<ActionResult> {
  return safe(async () => {
    const q = await load(token);
    if (!open(q)) return { ok: true };
    if (q.order.depositDueCents > 0) return { ok: false, error: 'A deposit is needed to book.' };
    if (!q.signature) return { ok: false, error: 'Please sign the agreement first.' };
    await transitionOrder(db, q.tenant.id, { type: 'customer' }, q.order.id, 'book', parsePreferences(q.tenant.settings));
    after(() => dispatchOrder(db, q.tenant.id, q.order.id).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, message: 'Booked!' };
  });
}
