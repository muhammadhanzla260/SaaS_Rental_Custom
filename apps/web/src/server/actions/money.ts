'use server';

/**
 * Invoices & payments (staff). Card-on-file charges go through the workspace's
 * own Stripe account; everything else is recorded like the order builder does.
 */
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { emailInvoice, ensureOrderToken, getInvoice, getMessage, quoteUrl, recordPayment, setAutoCharge, withTenant } from '@rental/db';
import { dispatchMessage, dispatchOrder } from '@rental/messaging';
import { chargeCardOnFile } from '@rental/payments';
import { invalid, type ActionResult } from '@/lib/result';
import { requirePermission, requireView } from '../context';
import { db } from '../db';
import { run } from './run';

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');
const uuid = z.string().uuid();

export async function setAutoChargeAction(slug: string, id: string, on: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'payments.record');
    const inv = await setAutoCharge(db, ctx.tenant.id, ctx.actor, uuid.parse(id), !!on);
    refresh(slug);
    return { ok: true, message: on ? `${inv.number} will be charged to the saved card on its due date.` : `Auto-charge off for ${inv.number}.` };
  });
}

/** Staff are waiting: send now and say where it went. */
async function sendNow(tenantId: string, messageId: string | undefined, label: string) {
  if (!messageId) return `${label} queued.`;
  await dispatchMessage(db, tenantId, messageId);
  const m = await getMessage(db, tenantId, messageId);
  return m?.status === 'sent' ? `${label} emailed to ${m.toAddress}.` : m?.status === 'skipped' ? `${label} not emailed: ${m.lastError}.` : `${label} ${m?.status ?? 'queued'}${m?.lastError ? ` (${m.lastError})` : ''}.`;
}

export async function emailInvoiceAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'payments.record');
    const r = await emailInvoice(db, ctx.tenant.id, ctx.actor, uuid.parse(id));
    const message = await sendNow(ctx.tenant.id, r.message?.id, `${r.invoice.number}`);
    refresh(slug);
    return { ok: true, message };
  });
}

const paySchema = z.object({
  invoiceId: z.string().uuid(),
  method: z.enum(['card_on_file', 'pay_link', 'cash', 'check', 'zelle', 'venmo', 'ach', 'other']),
  amount: z.coerce.number().positive('Enter the amount.').max(1_000_000),
  tip: z.coerce.number().min(0).max(100_000).optional().default(0),
  reference: z.string().trim().max(80).optional(),
  receipt: z.boolean().default(true),
});

export async function recordInvoicePaymentAction(slug: string, input: unknown): Promise<ActionResult<{ number: string | null }>> {
  return run<{ number: string | null }>(async () => {
    const ctx = await requirePermission(slug, 'payments.record');
    const p = paySchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    const d = p.data;
    const inv = await getInvoice(db, ctx.tenant.id, d.invoiceId);
    if (!inv) return { ok: false, error: 'Invoice not found.' };
    if (d.method === 'pay_link') {
      const r = await emailInvoice(db, ctx.tenant.id, ctx.actor, d.invoiceId);
      const message = await sendNow(ctx.tenant.id, r.message?.id, `Pay link for ${inv.invoice.number}`);
      refresh(slug);
      return { ok: true, data: { number: null }, message };
    }
    if (d.method === 'card_on_file') {
      const r = await chargeCardOnFile(db, ctx.tenant.id, inv.order.id, ctx.actor, {
        amountCents: Math.round(d.amount * 100), tipCents: Math.round(d.tip * 100), receipt: d.receipt,
      });
      refresh(slug);
      after(() => dispatchOrder(db, ctx.tenant.id, inv.order.id).catch((e) => console.error('[dispatch]', e)));
      return { ok: true, data: { number: r.number }, message: `Charged ${r.brand ? r.brand.toUpperCase() : 'card'} •${r.last4} · ${r.number}.` };
    }
    const r = await recordPayment(db, ctx.tenant.id, ctx.actor, inv.order.id, ctx.prefs, {
      method: d.method, amount: d.amount, tip: d.tip, invoiceId: d.invoiceId, reference: d.reference, receipt: d.receipt,
    });
    refresh(slug);
    after(() => dispatchOrder(db, ctx.tenant.id, r.order.id).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { number: r.payment.number }, message: `${r.payment.number} recorded.` };
  });
}

/** The customer's quote / pay link for an order (to copy and paste into a text). */
export async function quoteLinkAction(slug: string, orderId: string): Promise<ActionResult<{ url: string }>> {
  return run<{ url: string }>(async () => {
    const ctx = await requireView(slug);
    const token = await withTenant(db, ctx.tenant.id, (tx) => ensureOrderToken(tx, ctx.tenant.id, uuid.parse(orderId)));
    return { ok: true, data: { url: quoteUrl(token) } };
  });
}
