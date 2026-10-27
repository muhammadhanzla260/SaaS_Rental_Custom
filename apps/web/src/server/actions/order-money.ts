'use server';

import { z } from 'zod';
import { getOrder, orderInvoices } from '@rental/db';
import type { ActionResult } from '@/lib/result';
import { requireView } from '../context';
import { db } from '../db';
import { run } from './run';

export type OrderMoney = {
  status: string; version: number; totalCents: number; paidCents: number; depositDueCents: number; invoiceCount: number;
  /** What the latest version changed and who did it ("Customer declined the damage waiver"). */
  change: string | null;
};

const ACTION: Record<string, string> = { updated: 'Changed', booked: 'Booked', send_quote: 'Quote sent', cancel: 'Cancelled', payment: 'Payment recorded', tip: 'Tip collected' };

/**
 * An order's money and version as stored right now: Payment Options shows it after
 * each payment, and the order screen uses it to notice changes made elsewhere
 * (the customer on the quote page, another staff member).
 */
export async function orderMoneyAction(slug: string, id: string): Promise<ActionResult<OrderMoney>> {
  return run<OrderMoney>(async () => {
    const ctx = await requireView(slug);
    const orderId = z.string().uuid().parse(id);
    const [o, inv] = await Promise.all([getOrder(db, ctx.tenant.id, orderId), orderInvoices(db, ctx.tenant.id, orderId)]);
    if (!o) return { ok: false, error: 'Order not found.' };
    const last = o.versions[0];
    const change = last ? last.reason ?? `${ACTION[last.action] ?? 'Changed'} by ${last.actorName ?? 'the customer'}` : null;
    return {
      ok: true,
      data: { status: o.status, version: o.version, totalCents: o.totalCents, paidCents: o.paidCents, depositDueCents: o.depositDueCents, invoiceCount: inv.length, change },
    };
  });
}
