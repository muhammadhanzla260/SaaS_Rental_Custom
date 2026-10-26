'use server';

import { after } from 'next/server';
import { z } from 'zod';
import {
  emailInvoice, getOrder, markPreEventCalled, orderInvoices, snoozeCard, textOnsiteContact, transitionOrder, type OpsRule,
} from '@rental/db';
import { dispatchOrder } from '@rental/messaging';
import { balanceCharger, chargeCardOnFile } from '@rental/payments';
import type { ActionResult } from '@/lib/result';
import { requirePermission } from '../context';
import { db } from '../db';
import { run } from './run';

const input = z.object({
  orderId: z.string().uuid(),
  rule: z.enum(['deposit', 'final_payment', 'call', 'contact', 'quote']),
  action: z.enum(['pay_link', 'retry_charge', 'mark_called', 'text_contact', 'follow_up', 'snooze']),
});

/**
 * One button on an Ops board card. Each does its job, then hides the card for
 * as long as the job needs to land (a pay link gets 2 days to be paid).
 */
export async function opsCardAction(slug: string, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const p = input.safeParse(raw);
    if (!p.success) return { ok: false, error: 'Unknown action.' };
    const { orderId, rule, action } = p.data;
    const ctx = await requirePermission(slug, action === 'retry_charge' ? 'payments.record' : 'orders.create');
    const t = ctx.tenant.id;
    const send = () => after(() => dispatchOrder(db, t, orderId, { chargeBalance: balanceCharger(db) }).catch((e) => console.error('[dispatch]', e)));
    const hide = (hours: number, reason: string) => snoozeCard(db, t, ctx.actor, orderId, rule as OpsRule, hours, reason);
    switch (action) {
      case 'snooze':
        await hide(24, 'Snoozed 1 day');
        return { ok: true, message: 'Snoozed until tomorrow.' };
      case 'pay_link': {
        const inv = (await orderInvoices(db, t, orderId)).find((i) => i.status === 'open' || i.status === 'overdue');
        if (!inv) return { ok: false, error: 'Nothing is owed on this order any more.' };
        await emailInvoice(db, t, ctx.actor, inv.id);
        send();
        await hide(48, 'Pay link sent');
        return { ok: true, message: `Pay link sent for invoice ${inv.number}.` };
      }
      case 'retry_charge': {
        const o = await getOrder(db, t, orderId);
        if (!o) return { ok: false, error: 'Order not found.' };
        const due = o.totalCents - o.paidCents;
        if (due <= 0) return { ok: true, message: 'Already paid in full.' };
        const r = await chargeCardOnFile(db, t, orderId, ctx.actor, { amountCents: due, tipCents: 0, receipt: true });
        send();
        return { ok: true, message: `Charged ${r.brand ? r.brand.toUpperCase() : 'card'} •${r.last4} · ${r.number}. Receipt on its way.` };
      }
      case 'mark_called':
        await markPreEventCalled(db, t, ctx.actor, orderId);
        return { ok: true, message: 'Call logged on the order.' };
      case 'text_contact':
        await textOnsiteContact(db, t, ctx.actor, orderId);
        send();
        await hide(24, 'Contact texted');
        return { ok: true, message: 'Quality-check text sent to the on-site contact.' };
      case 'follow_up':
        await transitionOrder(db, t, ctx.actor, orderId, 'send_quote', ctx.prefs);
        send();
        await hide(72, 'Followed up');
        return { ok: true, message: 'Follow-up quote email sent.' };
    }
  });
}
