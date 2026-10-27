'use server';

import { z } from 'zod';
import { getOrder, orderInvoices } from '@rental/db';
import type { ActionResult } from '@/lib/result';
import { requireView } from '../context';
import { db } from '../db';
import { run } from './run';

export type OrderMoney = { status: string; totalCents: number; paidCents: number; depositDueCents: number; invoiceCount: number };

/** An order's money as stored right now: what Payment Options shows after each payment. */
export async function orderMoneyAction(slug: string, id: string): Promise<ActionResult<OrderMoney>> {
  return run<OrderMoney>(async () => {
    const ctx = await requireView(slug);
    const orderId = z.string().uuid().parse(id);
    const [o, inv] = await Promise.all([getOrder(db, ctx.tenant.id, orderId), orderInvoices(db, ctx.tenant.id, orderId)]);
    if (!o) return { ok: false, error: 'Order not found.' };
    return { ok: true, data: { status: o.status, totalCents: o.totalCents, paidCents: o.paidCents, depositDueCents: o.depositDueCents, invoiceCount: inv.length } };
  });
}
