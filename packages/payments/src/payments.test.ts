import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import type { QuoteContext } from '@rental/db';
import { amountDue } from './flows';
import { chargeSaved } from './stripe';

const quote = (o: { status: string; totalCents: number; paidCents: number; depositDueCents: number }) => ({ order: o }) as unknown as QuoteContext;

describe('amountDue', () => {
  it('asks for the deposit while the order is a quote', () => {
    expect(amountDue(quote({ status: 'quote_sent', totalCents: 61811, paidCents: 0, depositDueCents: 18543 }))).toEqual({ amountCents: 18543, purpose: 'deposit', label: 'Deposit to book' });
  });
  it('books without payment when there is no deposit', () => {
    expect(amountDue(quote({ status: 'draft', totalCents: 61811, paidCents: 0, depositDueCents: 0 })).purpose).toBe('none');
  });
  it('asks for what is left once booked', () => {
    expect(amountDue(quote({ status: 'booked', totalCents: 61811, paidCents: 18543, depositDueCents: 18543 }))).toEqual({ amountCents: 43268, purpose: 'balance', label: 'Balance due' });
  });
  it('is paid in full when nothing is left (overpaid never goes negative)', () => {
    expect(amountDue(quote({ status: 'completed', totalCents: 61811, paidCents: 70000, depositDueCents: 18543 }))).toEqual({ amountCents: 0, purpose: 'none', label: 'Paid in full' });
  });
});

/** A Stripe stand-in: only the calls chargeSaved makes. */
function fakeStripe(create: () => Promise<unknown>) {
  const calls: { params: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
  const stripe = {
    paymentIntents: {
      create: (params: Record<string, unknown>, opts: Record<string, unknown>) => { calls.push({ params, opts }); return create(); },
      retrieve: async (id: string) => ({
        id, status: 'succeeded', amount: 43268, amount_received: 43268, currency: 'usd', metadata: {}, customer: 'cus_1', setup_future_usage: null, created: 1_790_000_000,
        payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } },
      }),
    },
  } as unknown as Stripe;
  return { stripe, calls };
}

const charge = { amountCents: 43268, currency: 'USD', customerId: 'cus_1', paymentMethodId: 'pm_1', description: 'balance', metadata: {}, idempotencyKey: 'o1:auto-balance:2026-11-07:43268' };

describe('chargeSaved (event-day balance)', () => {
  it('charges off-session once, with the idempotency key, and reads back the card', async () => {
    const { stripe, calls } = fakeStripe(async () => ({ id: 'pi_1', status: 'succeeded' }));
    const r = await chargeSaved(stripe, charge);
    expect(r).toEqual({ ok: true, intentId: 'pi_1', card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toMatchObject({ amount: 43268, currency: 'usd', off_session: true, confirm: true, payment_method: 'pm_1' });
    expect(calls[0]!.opts).toEqual({ idempotencyKey: charge.idempotencyKey });
  });

  it('treats a card error as a decline (customer gets the card-declined message)', async () => {
    const { stripe } = fakeStripe(async () => {
      throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', raw: { payment_intent: { id: 'pi_2' } } });
    });
    expect(await chargeSaved(stripe, charge)).toEqual({ ok: false, declined: true, message: 'Your card was declined.', intentId: 'pi_2' });
  });

  it('treats 3-D Secure as a decline the customer must fix', async () => {
    const { stripe } = fakeStripe(async () => ({ id: 'pi_3', status: 'requires_action' }));
    expect(await chargeSaved(stripe, charge)).toEqual({ ok: false, declined: true, message: 'The bank asked the customer to approve this payment.', intentId: 'pi_3' });
  });

  it('keeps network and key errors apart from declines', async () => {
    const { stripe } = fakeStripe(async () => { throw Object.assign(new Error('Invalid API Key provided'), { type: 'StripeAuthenticationError' }); });
    expect(await chargeSaved(stripe, charge)).toMatchObject({ ok: false, declined: false, message: 'Invalid API Key provided' });
  });
});
