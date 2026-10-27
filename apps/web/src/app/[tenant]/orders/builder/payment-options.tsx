'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { ArrowLeft, Check, Info, RotateCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MANUAL_METHODS, UNPAID_REASONS } from '@rental/core';
import { ProductArt } from '@/components/catalog/product-art';
import { Button, Checkbox, cx, Field, Input, LinkButton, Modal, Notice, Select, Spinner, Textarea } from '@/components/kit';
import {
  collectTipAction, recordPaymentAction, savedCardChargeAction, staffCardFinishAction, staffCardStartAction,
} from '@/server/actions/commerce';

export type BookChoice = (
  | { method: 'manual'; payMethod: string; amount: string; tip: string; reference: string; receipt: boolean }
  | { method: 'none'; reason: string; expectedOn: string; notes: string }
) & { policies: Record<string, boolean> };

export type PayTab = 'pay' | 'none' | 'quote' | 'tip';
type Plan = 'deposit' | 'full' | 'custom';
type Source = 'saved' | 'new';
type Phase =
  | { kind: 'choose' }
  | { kind: 'running'; step: number }
  | { kind: 'done'; title: string; text: string; booked: boolean }
  | { kind: 'error'; message: string };

/** The Odoo POS "Order and Pricing Summary" beside the payment form. */
export type PaySummary = {
  lines: { key: string; name: string; mode: string | null; hours: string; quantity: number; totalCents: number; product: { name: string; kind?: string; icon?: string | null; tint?: string | null; imageUrl: string | null } | null }[];
  event: { when: string; address: string; place: string | null; eventType: string | null; waiver: boolean };
  rows: { label: string; cents: number; minus?: boolean }[];
  totalCents: number;
  depositCents: number;
  depositPercent: number;
};

const TIPS = [0, 10, 15, 20] as const;
const TABS: { value: PayTab; label: string }[] = [
  { value: 'pay', label: 'Record Payment Received' },
  { value: 'none', label: 'Submit Order Without Payment' },
  { value: 'quote', label: 'Send Quote Only' },
  { value: 'tip', label: 'Collect Tip' },
];
const METHOD_LABEL: Record<string, string> = { card: 'Credit Card', ...Object.fromEntries(MANUAL_METHODS.map((m) => [m.value, m.label])) };

const stripeCache = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!stripeCache.has(key)) stripeCache.set(key, loadStripe(key));
  return stripeCache.get(key)!;
};
const cents = (s: string) => Math.round((parseFloat(s) || 0) * 100);

type SavedCard = { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };

type Props = {
  open: boolean; onClose: () => void; booked: boolean; initialTab?: PayTab; slug: string; orderId: string | null; number: string;
  money: (c: number) => string; currency: string; depositCents: number; totalCents: number; paidCents: number;
  /** Tips are a share of the rental items (Odoo: "10% | $82.90"). */
  tipBaseCents: number;
  policies: { key: string; title: string; text: string }[]; signedOnline: boolean; bufferLabel: string; calendarHref: string;
  canRecordPayment: boolean;
  /** Stripe connected for this order's location (its mode and public key), and the customer's saved card. */
  cards: { available: boolean; testMode: boolean; publishableKey: string | null; saved: SavedCard | null };
  customerEmail: string | null;
  /** The workspace's country: the card field's default (not the browser's). */
  country: string;
  summary: PaySummary;
  invoiceCount: number;
  /** Saves the order first when needed (a new or changed order) and returns its id. */
  prepare: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** Cash, check, Zelle, Venmo, ACH, or no payment: books through the booking step. */
  onBookOffline: (c: BookChoice) => Promise<{ ok: true; number: string } | { ok: false; error: string }>;
  onSendQuote: () => Promise<void>;
  /** Odoo "Resend Current Customer Document": the quote before booking, the open invoice after. */
  onResend: () => Promise<void>;
  /** Something changed on the server (the order reloads when the window closes). */
  onChanged: () => void;
};

/**
 * Payment Options (Odoo POS, step 3): record a payment (card typed into Stripe's
 * field right here, a saved card, or offline), book without payment, send the
 * quote only, or collect a tip once booked, beside the order and pricing summary.
 * Card numbers go straight to Stripe; the server only sees the result.
 */
export function PaymentOptionsModal(p: Props) {
  const [locked, setLocked] = useState(false);
  const stripe = p.cards.available && p.cards.publishableKey ? stripeFor(p.cards.publishableKey) : null;
  return (
    <Modal open={p.open} onClose={() => { if (!locked) p.onClose(); }} width={1240} title={`Payment options · ${p.number}`}
      sub={p.booked ? 'Payments go toward the balance. Tips are collected on their own.' : 'Booking re-checks availability inside the database, so two people can’t book the last unit at once.'}>
      {/* The card field is ready before anything is charged (Stripe's deferred intent); the amount follows the form. */}
      <Elements stripe={stripe} options={{
        mode: 'payment', amount: Math.max(p.depositCents || p.totalCents, 100), currency: p.currency.toLowerCase(), allowedPaymentMethodTypes: ['card'],
        appearance: { theme: 'stripe', variables: { borderRadius: '10px', fontFamily: 'Geist, system-ui, sans-serif' } },
      }}>
        <Body {...p} setLocked={setLocked} />
      </Elements>
    </Modal>
  );
}

function Body({
  onClose, booked, initialTab = 'pay', slug, number, money, depositCents, totalCents, paidCents, tipBaseCents, policies, signedOnline,
  bufferLabel, calendarHref, canRecordPayment, cards, customerEmail, country, summary, invoiceCount, prepare, onBookOffline, onSendQuote, onResend, onChanged, setLocked,
}: Props & { setLocked: (x: boolean) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const dueCents = Math.max(0, totalCents - paidCents);
  const startPlan: Plan = booked ? 'full' : depositCents > 0 ? 'deposit' : 'full';
  const [tab, setTab] = useState<PayTab>(initialTab);
  const [method, setMethod] = useState<string>(cards.available && canRecordPayment ? 'card' : 'check');
  const [source, setSource] = useState<Source>(cards.saved ? 'saved' : 'new');
  const [plan, setPlan] = useState<Plan>(startPlan);
  const [amount, setAmount] = useState(((startPlan === 'deposit' ? depositCents : dueCents) / 100).toFixed(2));
  const [tipPct, setTipPct] = useState<number | 'custom'>(initialTab === 'tip' ? 'custom' : 0);
  const [tip, setTip] = useState('');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState(true);
  const [saveCard, setSaveCard] = useState(true);
  const [none, setNone] = useState({ reason: '', expectedOn: '', notes: '' });
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [declined, setDeclined] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);

  const card = method === 'card';
  const newCard = card && source === 'new';
  const tipping = tab === 'tip';
  const amountCents = tipping ? 0 : cents(amount);
  const tipCents = cents(tip);
  const totalNow = amountCents + tipCents;
  const saveNow = newCard && saveCard;
  const needPolicies = !booked && !signedOnline ? policies.filter((x) => !agreed[x.key]) : [];
  const running = phase.kind === 'running';
  useEffect(() => setLocked(running || busy), [running, busy, setLocked]);
  // Stripe's field shows what will be charged, and saving the card must match the intent made at the end.
  useEffect(() => {
    elements?.update({ amount: Math.max(totalNow, 100), setupFutureUsage: saveNow ? 'off_session' : null });
  }, [elements, totalNow, saveNow]);

  const brand = (c: SavedCard) => `${c.brand ? c.brand[0]!.toUpperCase() + c.brand.slice(1) : 'Card'} •${c.last4 ?? '••••'}${c.expMonth ? ` · exp ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear ?? '').slice(-2)}` : ''}`;
  const choosePlan = (x: Plan) => {
    setPlan(x);
    if (x !== 'custom') setAmount(((x === 'deposit' ? depositCents : dueCents) / 100).toFixed(2));
  };
  const chooseTip = (t: number | 'custom') => {
    setTipPct(t);
    if (t !== 'custom') setTip(t ? (Math.round((tipBaseCents * t) / 100) / 100).toFixed(2) : '');
  };
  const switchTab = (t: PayTab) => {
    setTab(t);
    setErrs({});
    setDeclined(null);
    setTipPct(t === 'tip' ? 'custom' : 0);
    setTip('');
  };

  const steps = [
    'Locking the order and re-checking availability',
    'Reserving stock with the cleanup buffer',
    tab === 'none' ? 'Noting why it was booked without payment' : card ? 'Charging the card and recording the receipt' : 'Recording the payment and receipt number',
    'Recording the booking in order history',
  ];

  /** Animate the booking steps while the server works (the steps are real; the bar only animates). */
  async function withSteps<T>(work: () => Promise<T>) {
    setPhase({ kind: 'running', step: 0 });
    let step = 0;
    const tick = setInterval(() => {
      step = Math.min(step + 1, steps.length - 1);
      setPhase((x) => (x.kind === 'running' ? { kind: 'running', step } : x));
    }, 450);
    try {
      return await work();
    } finally {
      clearInterval(tick);
    }
  }

  function validate() {
    const e: Record<string, string> = {};
    if (tipping) {
      if (!(tipCents > 0)) e.tip = 'Enter the tip amount.';
    } else if (tab === 'pay') {
      if (!(amountCents > 0)) e.amount = booked ? 'Enter the amount received.' : 'Enter the amount to collect.';
      else if (amountCents > dueCents) e.amount = `That is more than the ${money(dueCents)} due.`;
    } else if (tab === 'none') {
      if (!none.reason) e.reason = 'Choose a reason.';
      if (!none.expectedOn) e.expectedOn = 'Pick the date you expect payment.';
    }
    if (!booked && (tab === 'pay' || tab === 'none') && needPolicies.length) e.policies = `Confirm the customer agreed to: ${needPolicies.map((x) => x.title).join(', ')}.`;
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  function finished(title: string, text: string, didBook: boolean) {
    onChanged();
    if (didBook) {
      setPhase({ kind: 'running', step: steps.length });
      setTimeout(() => setPhase({ kind: 'done', title, text, booked: true }), 350);
    } else setPhase({ kind: 'done', title, text, booked: false });
  }

  /** A new card: Stripe checks the field, we make the intent, Stripe confirms it here, the server reads the result. */
  async function payNewCard(id: string, purpose: 'book' | 'payment' | 'tip') {
    const r = await staffCardStartAction(slug, id, { purpose, amount: amountCents / 100, tip: tipCents / 100, receipt, saveCard: saveNow, policies: agreed });
    if (!r.ok) return { error: r.error };
    const c = await stripe!.confirmPayment({ elements: elements!, clientSecret: r.data!.clientSecret, redirect: 'if_required', confirmParams: { return_url: window.location.href.split('?')[0]! } });
    // A decline stays on the form: the same field takes another card.
    if (c.error) return { declined: c.error.message ?? 'The card was declined.' };
    const done = await staffCardFinishAction(slug, id, c.paymentIntent!.id, agreed);
    if (!done.ok) return { error: done.error };
    return { booked: done.data!.booked, message: done.message ?? 'Charged.' };
  }

  async function confirm() {
    setDeclined(null);
    if (!validate()) return;
    const purpose = tipping ? 'tip' : booked ? 'payment' : 'book';
    // Offline booking (cash, check, transfers, or no payment) goes through the booking step as before.
    if (!booked && (tab === 'none' || (tab === 'pay' && !card))) {
      const r = await withSteps(() => onBookOffline(tab === 'none'
        ? { method: 'none', ...none, policies: agreed }
        : { method: 'manual', payMethod: method, amount, tip, reference, receipt, policies: agreed }));
      if (!r.ok) return setPhase({ kind: 'error', message: r.error });
      return finished('Booked', `${r.number} is booked. Items are reserved until ${bufferLabel}.`, true);
    }
    setBusy(true);
    if (newCard) {
      if (!stripe || !elements) { setBusy(false); return setDeclined('The card field is still loading.'); }
      const check = await elements.submit();
      if (check.error) { setBusy(false); return setDeclined(check.error.message ?? 'Check the card details.'); }
    }
    const ready = await prepare();
    if (!ready.ok) {
      setBusy(false);
      return setPhase({ kind: 'error', message: ready.error });
    }
    const id = ready.id;
    if (newCard) {
      const r = purpose === 'book' ? await withSteps(() => payNewCard(id, purpose)) : await payNewCard(id, purpose);
      setBusy(false);
      if ('declined' in r) { setPhase({ kind: 'choose' }); return setDeclined(r.declined!); }
      if ('error' in r) return setPhase({ kind: 'error', message: r.error! });
      return finished(purpose === 'tip' ? 'Tip collected' : r.booked ? 'Booked' : 'Payment recorded', r.message, r.booked);
    }
    const input = { purpose, amount: amountCents / 100, tip: tipCents / 100, receipt, saveCard: false, policies: agreed };
    if (card) {
      const r = purpose === 'book' ? await withSteps(() => savedCardChargeAction(slug, id, input)) : await savedCardChargeAction(slug, id, input);
      setBusy(false);
      if (!r.ok) return setPhase({ kind: 'error', message: r.error });
      return finished(purpose === 'tip' ? 'Tip collected' : r.data!.booked ? 'Booked' : 'Payment recorded', r.message ?? 'Charged.', r.data!.booked);
    }
    const r = tipping
      ? await collectTipAction(slug, id, { method, tip: tipCents / 100, reference: reference || undefined })
      : await recordPaymentAction(slug, id, { method, amount: amountCents / 100, tip: tipCents / 100, reference: reference || undefined, receipt });
    setBusy(false);
    if (!r.ok) return setPhase({ kind: 'error', message: r.error });
    finished(tipping ? 'Tip collected' : 'Payment recorded', r.message ?? 'Recorded.', false);
  }

  async function sendQuote() {
    setBusy(true);
    await onSendQuote();
    setBusy(false);
    onClose();
  }
  async function resend() {
    setResending(true);
    await onResend();
    setResending(false);
  }

  const primary =
    tab === 'quote' ? 'Send Quote Only'
      : tab === 'none' ? 'Submit Order Without Payment'
        : tipping ? `Collect ${money(tipCents)} Tip`
          : `Record ${METHOD_LABEL[method] ?? 'the'} Payment`;
  const unavailable = (tab === 'tip' && !booked) || ((tab === 'none' || tab === 'quote') && booked) || ((tab === 'pay' || tab === 'tip') && !canRecordPayment)
    || (newCard && (tab === 'pay' || tab === 'tip') && !cardReady);

  const methodPicker = (
    <Field label="Payment method" htmlFor="po-method" hint={card ? 'Typed into Stripe’s secure field. The card number never reaches this app.' : undefined}>
      <Select id="po-method" value={method} onChange={(e) => { setMethod(e.target.value); setDeclined(null); }}>
        <option value="card" disabled={!cards.available}>Credit Card{cards.available ? '' : ' (connect Stripe first)'}</option>
        {MANUAL_METHODS.filter((m) => m.value !== 'other').map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
    </Field>
  );
  const cardBlock = card && (
    <div className="flex flex-col gap-3">
      {cards.saved && (
        <Field label="Card" htmlFor="po-card">
          <Select id="po-card" value={source} onChange={(e) => { setSource(e.target.value as Source); setDeclined(null); }} className="sm:max-w-sm">
            <option value="saved">{brand(cards.saved)}</option>
            <option value="new">New card</option>
          </Select>
        </Field>
      )}
      {/* Stays mounted while the card is chosen, so typed details survive a switch of tab or amount. */}
      <div className={cx('flex flex-col gap-3', !newCard && 'hidden')}>
        <PaymentElement
          onReady={() => setCardReady(true)}
          options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' }, defaultValues: { billingDetails: { address: { country } } } }}
        />
        <Checkbox checked={saveCard} onChange={setSaveCard}>
          Save card info{!tipping && amountCents < dueCents ? ` · the ${money(dueCents - amountCents)} left is charged to it on the event day` : ''}
        </Checkbox>
      </div>
      {declined && <Notice kind="danger">{declined}</Notice>}
    </div>
  );
  const tipPicker = (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold text-fg">Tip for Party Coach</p>
      <div role="radiogroup" aria-label="Tip" className="flex flex-wrap gap-1.5">
        {[...TIPS.filter((t) => !tipping || t > 0), 'custom' as const].map((t) => (
          <button key={String(t)} type="button" role="radio" aria-checked={tipPct === t} onClick={() => chooseTip(t)}
            className={cx('press h-9 rounded-[var(--radius-control)] border px-3 text-[13px] font-semibold', tipPct === t ? 'border-accent bg-accent text-on-accent' : 'border-control bg-surface text-fg hover:bg-hover')}>
            {t === 0 ? 'No Tip' : t === 'custom' ? 'Custom' : `${t}% | ${money(Math.round((tipBaseCents * t) / 100))}`}
          </button>
        ))}
      </div>
      {tipPct === 'custom' && <Input aria-label="Tip amount" mono inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" className="anim-fade mt-2 w-32" invalid={!!errs.tip} />}
      {errs.tip && <p role="alert" className="mt-1 text-[13px] font-medium text-danger">{errs.tip}</p>}
    </div>
  );
  const option = (key: Plan, label: string, value: React.ReactNode, className?: string) => (
    <div role="radio" aria-checked={plan === key} tabIndex={0} onClick={() => choosePlan(key)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choosePlan(key); } }}
      className={cx('press flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3', plan === key ? 'border-accent bg-accent-soft/25 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle bg-surface hover:border-control', className)}>
      <span className={cx('grid size-[18px] shrink-0 place-items-center rounded-full border', plan === key ? 'border-accent bg-accent' : 'border-control')}>{plan === key && <span className="size-1.5 rounded-full bg-on-accent" />}</span>
      <span className="flex-1 text-[14px] font-semibold text-fg">{label}</span>
      {value}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-info-bg px-3 py-2 text-center text-[13px] text-info-fg">
          {invoiceCount === 0 ? 'No customer invoices linked to this order yet.' : `${invoiceCount} customer invoice${invoiceCount === 1 ? '' : 's'} linked to this order.`}
        </p>
        {dueCents > 0 && (
          <p className="flex items-center gap-2 rounded-[var(--radius-control)] bg-warning-bg px-3 py-2 text-[13px] font-medium text-warning-fg">
            <Info className="size-4 shrink-0" /><span>Outstanding balance: <span className="mono">{money(dueCents)}</span>.</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-subtle">
          {phase.kind === 'choose' && (
            <div role="tablist" aria-label="Payment options" className="grid grid-cols-2 border-b border-subtle bg-sunken/60 sm:grid-cols-4">
              {TABS.map((t) => (
                <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} onClick={() => switchTab(t.value)}
                  className={cx('min-h-12 border-b-2 px-2 py-2 text-[13px] font-semibold leading-tight transition-colors',
                    tab === t.value ? 'border-accent bg-surface text-accent-text' : 'border-transparent text-fg-2 hover:text-fg')}>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <div className="p-4 sm:p-6">
            {/* Hidden, not removed, while the steps run: Stripe confirms the card from the field in here. */}
            {(phase.kind === 'choose' || running) && (
              <div className={cx('flex flex-col gap-5', running && 'hidden')}>
                {tab === 'pay' && (!canRecordPayment ? (
                  <Notice>Your role cannot record payments. Book without payment or send the quote instead.</Notice>
                ) : (
                  <div className="anim-fade flex flex-col gap-5">
                    <Heading n={1} title={booked ? 'Record a payment toward the balance.' : 'Record a payment already received.'}
                      sub="Use this workflow only when money is being collected now or has already been received." />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {methodPicker}
                      {!card && (
                        <Field label="Reference" htmlFor="po-ref" optional>
                          <Input id="po-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #1043" />
                        </Field>
                      )}
                    </div>
                    {cardBlock}
                    <div>
                      <p className="mb-2 text-[13px] font-semibold text-fg">Amount to collect</p>
                      <div role="radiogroup" aria-label="Amount to collect" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {option('full', booked ? 'Collect Balance' : 'Collect Full Balance', <span className="mono text-[15px] font-bold text-fg">{money(dueCents)}</span>)}
                        {option('custom', 'Collect Custom Amount', (
                          <Input aria-label="Custom amount" mono inputMode="decimal" value={plan === 'custom' ? amount : ''} placeholder="Enter an amount" invalid={!!errs.amount}
                            onClick={(e) => e.stopPropagation()} onFocus={() => { if (plan !== 'custom') { setPlan('custom'); setAmount(''); } }}
                            onChange={(e) => { setPlan('custom'); setAmount(e.target.value); }} className="h-9 w-40 text-right" />
                        ))}
                        {!booked && depositCents > 0 && option('deposit', `Collect Deposit (${summary.depositPercent.toFixed(2)}%)`, <span className="mono text-[15px] font-bold text-fg">{money(depositCents)}</span>, 'sm:col-span-2')}
                      </div>
                      {errs.amount && <p role="alert" className="mt-1.5 text-[13px] font-medium text-danger">{errs.amount}</p>}
                      {!booked && plan !== 'full' && (
                        <p className="mt-2 rounded-[var(--radius-control)] border-l-4 border-warning-mark bg-warning-bg/60 px-4 py-2.5 text-[13px] text-fg">
                          Many customers pay in full so they do not have to worry about the remaining balance later.
                        </p>
                      )}
                    </div>
                    {tipPicker}
                    <div className="rounded-[var(--radius-card)] border border-info-fg/20 bg-info-bg/60 p-3.5">
                      <Checkbox checked={receipt} onChange={setReceipt}>Email payment receipt to the customer{customerEmail ? ` (${customerEmail})` : ''}</Checkbox>
                      <p className="mt-1 pl-7 text-[12px] text-fg-2">Selected by default. Clear only when the customer specifically requests no receipt.</p>
                    </div>
                    <p className="flex items-center justify-between rounded-[var(--radius-card)] border border-info-fg/20 bg-info-bg/60 px-4 py-3.5">
                      <span className="text-[15px] text-fg">Total payment to record</span>
                      <span className="mono text-[22px] font-bold text-accent-text">{money(totalNow)}</span>
                    </p>
                  </div>
                ))}

                {tab === 'none' && (booked ? (
                  <Notice>This order is already booked.</Notice>
                ) : (
                  <div className="anim-fade flex flex-col gap-4">
                    <Heading n={2} title="Submit the order without payment." sub="Books the order and holds the equipment. It shows on the Ops board until it is paid." />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Reason" htmlFor="bk-reason" error={errs.reason}>
                        <Select id="bk-reason" value={none.reason} onChange={(e) => setNone({ ...none, reason: e.target.value })} invalid={!!errs.reason}>
                          <option value="">Choose…</option>
                          {UNPAID_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </Select>
                      </Field>
                      <Field label="Expected payment" htmlFor="bk-date" error={errs.expectedOn}>
                        <Input id="bk-date" type="date" value={none.expectedOn} onChange={(e) => setNone({ ...none, expectedOn: e.target.value })} invalid={!!errs.expectedOn} />
                      </Field>
                      <Field label="Follow-up notes" htmlFor="bk-notes" optional className="sm:col-span-2">
                        <Textarea id="bk-notes" rows={2} value={none.notes} onChange={(e) => setNone({ ...none, notes: e.target.value })} placeholder="Shows on the Ops board until it is paid." />
                      </Field>
                    </div>
                  </div>
                ))}

                {tab === 'quote' && (booked ? (
                  <Notice>This order is already booked, so there is no quote to send.</Notice>
                ) : (
                  <div className="anim-fade flex flex-col gap-3">
                    <Heading n={3} title="Send the quote only." sub="Nothing is reserved until the customer pays or you book it." />
                    <p className="text-[14px] text-fg">Emails the quote{customerEmail ? <> to <span className="font-semibold">{customerEmail}</span></> : ''} with the link to review, sign and pay the deposit online.</p>
                    <p className="text-[13px] text-fg-2">The order stays a quote; it shows under Quotes going cold on the Ops board if nothing happens.</p>
                  </div>
                ))}

                {tab === 'tip' && (!booked ? (
                  <Notice>Tips are collected on their own once the order is booked. To add a tip now, use Record Payment Received.</Notice>
                ) : !canRecordPayment ? (
                  <Notice>Your role cannot record payments.</Notice>
                ) : (
                  <div className="anim-fade flex flex-col gap-4">
                    <Heading n={4} title="Collect a tip for the party coach." sub="A tip does not change the order total or its invoices." />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {methodPicker}
                      {!card && (
                        <Field label="Reference" htmlFor="po-ref" optional>
                          <Input id="po-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Venmo @name" />
                        </Field>
                      )}
                    </div>
                    {cardBlock}
                    {tipPicker}
                    <p className="flex items-center justify-between rounded-[var(--radius-card)] border border-info-fg/20 bg-info-bg/60 px-4 py-3.5">
                      <span className="text-[15px] text-fg">Tip to {card ? 'charge' : 'record'}</span>
                      <span className="mono text-[22px] font-bold text-accent-text">{money(tipCents)}</span>
                    </p>
                  </div>
                ))}

                {!booked && (tab === 'pay' || tab === 'none') && policies.length > 0 && (signedOnline ? (
                  <Notice kind="success">The customer signed the agreement and accepted the policies online.</Notice>
                ) : (
                  <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-subtle p-3.5">
                    <p className="text-[13px] font-semibold text-fg">The customer agreed to</p>
                    {policies.map((x) => (
                      <Checkbox key={x.key} checked={!!agreed[x.key]} onChange={(v) => setAgreed((a) => ({ ...a, [x.key]: v }))} invalid={!!errs.policies && !agreed[x.key]}>
                        <span className="font-semibold text-fg">{x.title}.</span> {x.text}
                      </Checkbox>
                    ))}
                    {errs.policies && <p role="alert" className="text-[13px] font-medium text-danger">{errs.policies}</p>}
                  </div>
                ))}

                {card && (tab === 'pay' || tab === 'tip') && cards.testMode && <p className="text-[12px] text-fg-3">Stripe test mode: card 4242 4242 4242 4242, any future date, any CVC. No real money moves.</p>}

                <Button size="lg" className="w-full text-[16px]" onClick={tab === 'quote' ? sendQuote : confirm} pending={busy} disabled={unavailable}>{primary}</Button>
                {newCard && (tab === 'pay' || tab === 'tip') && (
                  <p className="-mt-2 flex items-center justify-center gap-1.5 text-[12px] text-fg-3"><ShieldCheck className="size-4" /> The card number goes straight to Stripe. It is never stored or seen by this app.</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-4">
                  <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-[14px] font-semibold text-accent-text hover:underline"><ArrowLeft className="size-4" /> Back to the order</button>
                  <button type="button" onClick={resend} disabled={resending} className="flex items-center gap-1.5 text-[14px] font-semibold text-accent-text hover:underline disabled:opacity-60">
                    {resending ? <Spinner className="size-3.5" /> : <RotateCw className="size-3.5" />} Resend Current Customer Document
                  </button>
                </div>
              </div>
            )}

            {(running || (phase.kind === 'error' && !booked && (tab === 'pay' || tab === 'none'))) && (
              <ol className="flex flex-col gap-3 py-2" aria-live="polite">
                {steps.map((label, i) => {
                  const done = running && phase.step > i;
                  const doing = running && phase.step === i;
                  const failed = phase.kind === 'error' && i === 0;
                  return (
                    <li key={label} className="flex items-center gap-3">
                      <span className={cx('grid size-7 shrink-0 place-items-center rounded-full transition-colors', done ? 'bg-success text-white' : failed ? 'bg-danger text-white' : doing ? 'bg-accent-soft text-accent-text' : 'bg-sunken text-fg-3')}>
                        {done ? <Check className="size-4 anim-pop" strokeWidth={3} /> : failed ? <X className="size-4" /> : doing ? <Spinner className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                      </span>
                      <span className={cx('text-sm', done || doing ? 'text-fg' : 'text-fg-3')}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {phase.kind === 'error' && (
              <div className="flex flex-col gap-3">
                <Notice kind="danger">{phase.message}</Notice>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={onClose}>Back to the order</Button>
                  <Button onClick={() => setPhase({ kind: 'choose' })}>Try again</Button>
                </div>
              </div>
            )}
            {phase.kind === 'done' && (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <span className="anim-pop grid size-16 place-items-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></span>
                <p className="font-display text-xl font-bold text-fg">{phase.title}</p>
                <p className="max-w-md text-[15px] text-fg">{phase.text}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {phase.booked && <LinkButton variant="secondary" href={calendarHref}>View on calendar</LinkButton>}
                  <Button onClick={onClose}>{phase.booked ? 'Keep editing' : 'Done'}</Button>
                </div>
              </div>
            )}
          </div>
        </section>

        <OrderPricingSummary number={number} booked={booked} summary={summary} paidCents={paidCents} money={money} />
      </div>
    </div>
  );
}

function Heading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-[14px] font-bold text-on-accent">{n}</span>
      <div>
        <p className="text-[16px] font-semibold text-fg">{title}</p>
        <p className="text-[13px] text-fg-2">{sub}</p>
      </div>
    </div>
  );
}

/** Right column, as on the Odoo POS: the items, the event, every price line, the total, and what is due. */
function OrderPricingSummary({ number, booked, summary, paidCents, money }: { number: string; booked: boolean; summary: PaySummary; paidCents: number; money: (c: number) => string }) {
  const balance = Math.max(0, summary.totalCents - (booked ? paidCents : summary.depositCents));
  return (
    <aside aria-label="Order and pricing summary" className="overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface lg:sticky lg:top-0">
      <header className="border-b border-subtle px-5 py-4">
        <p className="eyebrow text-accent-text">{booked ? 'Order' : 'Quote'} #{number}</p>
        <p className="mt-0.5 text-[17px] font-bold text-fg">Order and Pricing Summary</p>
      </header>
      <div className="flex flex-col gap-4 p-5">
        <ul className="flex flex-col gap-3">
          {summary.lines.map((l) => (
            <li key={l.key} className="flex items-start gap-3">
              {l.product ? <ProductArt product={l.product} size={48} imageUrl={l.product.imageUrl} /> : <span className="grid size-12 shrink-0 place-items-center rounded-[var(--radius-control)] bg-sunken text-[11px] font-bold text-fg-2">Custom</span>}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-fg">
                  {l.quantity > 1 ? `${l.quantity} × ` : ''}{l.name}
                  {l.mode && <span className="rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success-fg">{l.mode}</span>}
                </p>
                <p className="text-[12px] text-fg-2">{l.hours}</p>
              </div>
              <span className="mono text-[14px] font-semibold text-fg">{money(l.totalCents)}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-[var(--radius-control)] border border-subtle p-3.5 text-[13px]">
          <p className="mb-1 font-semibold text-warning-fg">Event Details</p>
          <p className="font-semibold text-fg">{summary.event.when}</p>
          {summary.event.address && <p className="text-fg-2">{summary.event.address}</p>}
          {summary.event.place && <p className="text-fg-2">{summary.event.place}</p>}
          {summary.event.eventType && <p className="text-fg-2">{summary.event.eventType}</p>}
          <p className="text-fg-2">Damage Waiver: {summary.event.waiver ? 'Accepted' : 'Declined'}</p>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-accent-text">Pricing Summary</p>
          <dl className="flex flex-col gap-1.5 text-[14px]">
            {summary.rows.map((r) => (
              <div key={r.label} className={cx('flex justify-between gap-3', r.minus ? 'text-danger' : 'text-fg-2')}>
                <dt>{r.label}</dt>
                <dd className="mono text-fg">{r.minus ? <span className="text-danger">−{money(r.cents)}</span> : money(r.cents)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="flex items-center justify-between rounded-[var(--radius-control)] bg-night px-4 py-3 text-white">
          <span className="text-[15px] font-semibold">Grand Total</span>
          <span className="mono text-[19px] font-bold">{money(summary.totalCents)}</span>
        </p>
        {booked ? (
          <div className="rounded-[var(--radius-control)] border border-success/40 bg-success-bg px-4 py-3">
            <div className="flex items-baseline justify-between"><span className="font-semibold text-success-fg">Paid</span><span className="mono text-[19px] font-bold text-success-fg">{money(paidCents)}</span></div>
          </div>
        ) : (
          <div className="rounded-[var(--radius-control)] border border-warning-mark/40 bg-warning-bg px-4 py-3">
            <div className="flex items-baseline justify-between"><span className="font-semibold text-warning-fg">Deposit Due</span><span className="mono text-[19px] font-bold text-warning-fg">{money(summary.depositCents)}</span></div>
            <p className="text-[12px] text-warning-fg/80">Required to book your event ({summary.depositPercent.toFixed(2)}%)</p>
          </div>
        )}
        <div className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-bg px-4 py-3">
          <div className="flex items-baseline justify-between"><span className="font-semibold text-danger-fg">Balance Due</span><span className="mono text-[19px] font-bold text-danger-fg">{money(balance)}</span></div>
          <p className="text-[12px] text-danger-fg/80">{booked ? 'Still to pay on this order' : 'Remaining after deposit'}</p>
        </div>
      </div>
    </aside>
  );
}
