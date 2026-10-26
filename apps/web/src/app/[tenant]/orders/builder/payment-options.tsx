'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Check, CreditCard, Lock, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MANUAL_METHODS, UNPAID_REASONS } from '@rental/core';
import { Button, Checkbox, cx, Field, Input, LinkButton, Modal, Notice, Select, Spinner, Textarea } from '@/components/kit';
import {
  collectTipAction, recordPaymentAction, savedCardChargeAction, staffCardFinishAction, staffCardStartAction, type StaffCardIntent,
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
  | { kind: 'card'; intent: StaffCardIntent; purpose: 'book' | 'payment' | 'tip'; id: string }
  | { kind: 'done'; title: string; text: string; booked: boolean }
  | { kind: 'error'; message: string };

const TIPS = [0, 10, 15, 20] as const;
const TABS: { value: PayTab; label: string }[] = [
  { value: 'pay', label: 'Record Payment Received' },
  { value: 'none', label: 'Submit Order Without Payment' },
  { value: 'quote', label: 'Send Quote Only' },
  { value: 'tip', label: 'Collect Tip' },
];

const stripeCache = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!stripeCache.has(key)) stripeCache.set(key, loadStripe(key));
  return stripeCache.get(key)!;
};
const cents = (s: string) => Math.round((parseFloat(s) || 0) * 100);

type SavedCard = { brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null };

/**
 * Payment Options (Odoo POS): record a payment (card or offline), book without
 * payment, send the quote only, or collect a tip once booked. Before booking,
 * the first two book the order; after booking, payments go toward the balance.
 * Card numbers go straight to Stripe's field; the server only sees the result.
 */
export function PaymentOptionsModal({
  open, onClose, booked, initialTab = 'pay', slug, orderId, number, money, depositCents, totalCents, paidCents, tipBaseCents, policies, signedOnline,
  bufferLabel, calendarHref, canRecordPayment, cards, customerEmail, country, prepare, onBookOffline, onSendQuote, onChanged,
}: {
  open: boolean; onClose: () => void; booked: boolean; initialTab?: PayTab; slug: string; orderId: string | null; number: string;
  money: (c: number) => string; depositCents: number; totalCents: number; paidCents: number;
  /** Tips are a share of the rental items (Odoo: "10% | $82.90"). */
  tipBaseCents: number;
  policies: { key: string; title: string; text: string }[]; signedOnline: boolean; bufferLabel: string; calendarHref: string;
  canRecordPayment: boolean;
  /** Stripe connected for this order's location (and its mode), and the customer's saved card. */
  cards: { available: boolean; testMode: boolean; saved: SavedCard | null };
  customerEmail: string | null;
  /** The workspace's country: the card field's default (not the browser's). */
  country: string;
  /** Saves the order first when needed (a new or changed order) and returns its id. */
  prepare: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** Cash, check, Zelle, Venmo, ACH, or no payment: books through the booking step. */
  onBookOffline: (c: BookChoice) => Promise<{ ok: true; number: string } | { ok: false; error: string }>;
  onSendQuote: () => Promise<void>;
  /** Something changed on the server (the order reloads when the window closes). */
  onChanged: () => void;
}) {
  const dueCents = Math.max(0, totalCents - paidCents);
  const firstMethod = cards.available && canRecordPayment ? 'card' : 'check';
  const [tab, setTab] = useState<PayTab>(initialTab);
  const [method, setMethod] = useState<string>(firstMethod);
  const [source, setSource] = useState<Source>(cards.saved ? 'saved' : 'new');
  const [plan, setPlan] = useState<Plan>('deposit');
  const [amount, setAmount] = useState('');
  const [tipPct, setTipPct] = useState<number | 'custom'>(0);
  const [tip, setTip] = useState('');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState(true);
  const [saveCard, setSaveCard] = useState(true);
  const [none, setNone] = useState({ reason: '', expectedOn: '', notes: '' });
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const p: Plan = booked ? 'full' : depositCents > 0 ? 'deposit' : 'full';
    setTab(initialTab);
    setPhase({ kind: 'choose' });
    setErrs({});
    setPlan(p);
    setAmount(((p === 'deposit' ? depositCents : dueCents) / 100).toFixed(2));
    setTipPct(0);
    setTip('');
    setReference('');
    setReceipt(true);
    setSaveCard(true);
    setAgreed({});
    setMethod(firstMethod);
    setSource(cards.saved ? 'saved' : 'new');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = method === 'card';
  const tipping = tab === 'tip';
  const amountCents = tipping ? 0 : cents(amount);
  const tipCents = cents(tip);
  const totalNow = amountCents + tipCents;
  // Paying everything leaves no balance to auto-charge, so there is no card to keep.
  const canSave = card && source === 'new' && !tipping && amountCents < dueCents;
  const needPolicies = !booked && !signedOnline ? policies.filter((p) => !agreed[p.key]) : [];
  const brand = (c: SavedCard) => `${c.brand ? c.brand[0]!.toUpperCase() + c.brand.slice(1) : 'Card'} •${c.last4 ?? '••••'}${c.expMonth ? ` · exp ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear ?? '').slice(-2)}` : ''}`;

  const choosePlan = (p: Plan) => {
    setPlan(p);
    if (p !== 'custom') setAmount(((p === 'deposit' ? depositCents : dueCents) / 100).toFixed(2));
  };
  const chooseTip = (t: number | 'custom') => {
    setTipPct(t);
    if (t !== 'custom') setTip(t ? (Math.round((tipBaseCents * t) / 100) / 100).toFixed(2) : '');
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
      setPhase((p) => (p.kind === 'running' ? { kind: 'running', step } : p));
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
    if (!booked && (tab === 'pay' || tab === 'none') && needPolicies.length) e.policies = `Confirm the customer agreed to: ${needPolicies.map((p) => p.title).join(', ')}.`;
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

  async function confirm() {
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
    const ready = await prepare();
    if (!ready.ok) {
      setBusy(false);
      return setPhase({ kind: 'error', message: ready.error });
    }
    const id = ready.id;
    const input = { purpose, amount: amountCents / 100, tip: tipCents / 100, receipt, saveCard: canSave && saveCard, policies: agreed };
    if (card && source === 'new') {
      const r = await staffCardStartAction(slug, id, input);
      setBusy(false);
      if (!r.ok) return setPhase({ kind: 'error', message: r.error });
      return setPhase({ kind: 'card', intent: r.data!, purpose, id });
    }
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

  const running = phase.kind === 'running';
  const showSteps = running || (phase.kind === 'error' && !booked && (tab === 'pay' || tab === 'none'));
  const primary =
    tab === 'quote' ? null
      : tab === 'none' ? 'Confirm booking'
        : card && source === 'new' ? 'Continue to card'
          : card ? `Charge ${money(totalNow)}${!booked && !tipping ? ' & book' : ''}`
            : tipping ? 'Collect tip' : booked ? 'Record payment' : 'Confirm booking';
  const unavailable = (tab === 'tip' && !booked) || ((tab === 'none' || tab === 'quote') && booked) || ((tab === 'pay' || tab === 'tip') && !canRecordPayment);

  const methodPicker = (
    <Field label="Payment method" htmlFor="po-method">
      <Select id="po-method" value={method} onChange={(e) => setMethod(e.target.value)}>
        <option value="card" disabled={!cards.available}>Credit card{cards.available ? '' : ' (connect Stripe first)'}</option>
        {MANUAL_METHODS.filter((m) => m.value !== 'other').map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </Select>
    </Field>
  );
  const cardSource = card && (
    <div role="radiogroup" aria-label="Which card" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {([...(cards.saved ? [['saved', 'Saved card', brand(cards.saved)]] : []), ['new', 'New card', 'Typed into Stripe’s secure field']] as [Source, string, string][]).map(([key, label, sub]) => (
        <button key={key} type="button" role="radio" aria-checked={source === key} onClick={() => setSource(key)}
          className={cx('press flex items-center gap-2.5 rounded-[var(--radius-control)] border bg-surface px-3 py-2 text-left', source === key ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
          <CreditCard className="size-4 shrink-0 text-fg-2" />
          <span className="min-w-0"><span className="block text-[13px] font-semibold text-fg">{label}</span><span className="block truncate text-[12px] text-fg-2">{sub}</span></span>
        </button>
      ))}
    </div>
  );
  const tipPicker = (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold text-fg">Tip for the party coach</p>
      <div role="radiogroup" aria-label="Tip" className="flex flex-wrap gap-1.5">
        {[...TIPS.filter((t) => !tipping || t > 0), 'custom' as const].map((t) => (
          <button key={String(t)} type="button" role="radio" aria-checked={tipPct === t} onClick={() => chooseTip(t)}
            className={cx('press h-8 rounded-[var(--radius-control)] border px-2.5 text-[12px] font-semibold', tipPct === t ? 'border-accent bg-accent text-on-accent' : 'border-control bg-surface text-fg hover:bg-hover')}>
            {t === 0 ? 'No tip' : t === 'custom' ? 'Custom' : `${t}% | ${money(Math.round((tipBaseCents * t) / 100))}`}
          </button>
        ))}
      </div>
      {tipPct === 'custom' && <Input aria-label="Tip amount" mono inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="0.00" className="anim-fade mt-2 w-32" invalid={!!errs.tip} />}
      {errs.tip && <p role="alert" className="mt-1 text-[13px] font-medium text-danger">{errs.tip}</p>}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={() => { if (!running && !busy) onClose(); }}
      width={620}
      title={phase.kind === 'done' ? phase.title : running ? `Booking ${number}` : phase.kind === 'card' ? `Card payment · ${money(phase.intent.amountCents)}` : `Payment options · ${number}`}
      sub={phase.kind === 'choose' ? (booked ? `${money(dueCents)} due of ${money(totalCents)}.` : `Total ${money(totalCents)} · deposit ${money(depositCents)}. Booking re-checks availability inside the database.`) : undefined}
      footer={
        phase.kind === 'done' ? (
          phase.booked
            ? <><LinkButton variant="secondary" href={calendarHref}>View on calendar</LinkButton><Button onClick={onClose}>Keep editing</Button></>
            : <Button onClick={onClose}>Done</Button>
        ) : phase.kind === 'error' ? (
          <><Button variant="secondary" onClick={onClose}>Back to the order</Button><Button onClick={() => setPhase({ kind: 'choose' })}>Try again</Button></>
        ) : phase.kind === 'card' ? (
          <Button variant="secondary" onClick={() => setPhase({ kind: 'choose' })}>Back</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={running || busy}>Cancel</Button>
            {tab === 'quote'
              ? <Button onClick={sendQuote} pending={busy} disabled={booked}>Send quote</Button>
              : <Button onClick={confirm} pending={running || busy} disabled={unavailable}>{primary}</Button>}
          </>
        )
      }
    >
      {phase.kind === 'choose' && (
        <div className="flex flex-col gap-4">
          {/* All four tabs stay in view (they wrap on a phone), like the Odoo POS screen. */}
          <div role="tablist" aria-label="Payment options" className="grid grid-cols-2 gap-1 rounded-[calc(var(--radius-control)+2px)] bg-sunken p-1 sm:grid-cols-4">
            {TABS.map((t) => (
              <button
                key={t.value} type="button" role="tab" aria-selected={tab === t.value}
                onClick={() => { setTab(t.value); setErrs({}); setTipPct(t.value === 'tip' ? 'custom' : 0); setTip(''); }}
                className={cx('min-h-10 rounded-[var(--radius-control)] px-2 py-1.5 text-[12.5px] font-semibold leading-tight transition-[background-color,color,box-shadow]',
                  tab === t.value ? 'bg-surface text-fg shadow-[0_1px_3px_rgb(16_19_26/0.15)]' : 'text-fg-2 hover:text-fg')}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'pay' && (!canRecordPayment ? (
            <Notice>Your role cannot record payments. Book without payment or send the quote instead.</Notice>
          ) : (
            <div className="anim-fade flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {methodPicker}
                {!card && (
                  <Field label="Reference" htmlFor="po-ref" optional>
                    <Input id="po-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #1043" />
                  </Field>
                )}
              </div>
              {cardSource}
              <div role="radiogroup" aria-label="Amount to collect" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([['full', booked ? 'Collect balance' : 'Collect full balance', money(dueCents)], ...(!booked && depositCents > 0 ? [['deposit', 'Collect deposit', money(depositCents)]] : []), ['custom', 'Custom amount', 'Enter it']] as [Plan, string, string][]).map(([key, label, value]) => (
                  <button key={key} type="button" role="radio" aria-checked={plan === key} onClick={() => choosePlan(key)}
                    className={cx('press flex flex-col rounded-[var(--radius-control)] border bg-surface px-3 py-2 text-left', plan === key ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
                    <span className="text-[13px] font-semibold text-fg">{label}</span>
                    <span className="mono text-[13px] text-fg-2">{value}</span>
                  </button>
                ))}
              </div>
              <Field label={card ? 'Amount to charge' : 'Amount received'} htmlFor="po-amount" error={errs.amount}>
                <Input id="po-amount" mono inputMode="decimal" value={amount} onChange={(e) => { setPlan('custom'); setAmount(e.target.value); }} invalid={!!errs.amount} className="sm:w-40" />
              </Field>
              {tipPicker}
              {canSave && (
                <Checkbox checked={saveCard} onChange={setSaveCard}>
                  Save card info for auto-charge (the {money(dueCents - amountCents)} left is charged on the event day)
                </Checkbox>
              )}
              <Checkbox checked={receipt} onChange={setReceipt}>Email the payment receipt{customerEmail ? ` to ${customerEmail}` : ' to the customer'}</Checkbox>
              <p className="flex justify-between border-t border-subtle pt-3 text-sm"><span className="text-fg-2">{card ? 'Total to charge' : 'Total payment to record'}</span><span className="mono font-bold text-fg">{money(totalNow)}</span></p>
            </div>
          ))}

          {tab === 'none' && (booked ? (
            <Notice>This order is already booked.</Notice>
          ) : (
            <div className="anim-fade grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          ))}

          {tab === 'quote' && (booked ? (
            <Notice>This order is already booked, so there is no quote to send.</Notice>
          ) : (
            <div className="anim-fade flex flex-col gap-2 text-[14px] text-fg">
              <p>Emails the quote{customerEmail ? <> to <span className="font-semibold">{customerEmail}</span></> : ''} with the link to review, sign and pay. Nothing is reserved until the customer pays or you book it.</p>
              <p className="text-[13px] text-fg-2">The order stays a quote; it shows under Quotes going cold on the Ops board if nothing happens.</p>
            </div>
          ))}

          {tab === 'tip' && (!booked ? (
            <Notice>Tips are collected on their own once the order is booked. To add a tip now, use Record Payment Received.</Notice>
          ) : !canRecordPayment ? (
            <Notice>Your role cannot record payments.</Notice>
          ) : (
            <div className="anim-fade flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {methodPicker}
                {!card && (
                  <Field label="Reference" htmlFor="po-ref" optional>
                    <Input id="po-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Venmo @name" />
                  </Field>
                )}
              </div>
              {cardSource}
              {tipPicker}
              <p className="flex justify-between border-t border-subtle pt-3 text-sm"><span className="text-fg-2">Tip to {card ? 'charge' : 'record'}</span><span className="mono font-bold text-fg">{money(tipCents)}</span></p>
              <p className="text-[12px] text-fg-2">A tip does not change the order total or its invoices.</p>
            </div>
          ))}

          {!booked && (tab === 'pay' || tab === 'none') && policies.length > 0 && (signedOnline ? (
            <Notice kind="success">The customer signed the agreement and accepted the policies online.</Notice>
          ) : (
            <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-subtle p-3.5">
              <p className="text-[13px] font-semibold text-fg">The customer agreed to</p>
              {policies.map((p) => (
                <Checkbox key={p.key} checked={!!agreed[p.key]} onChange={(x) => setAgreed((a) => ({ ...a, [p.key]: x }))} invalid={!!errs.policies && !agreed[p.key]}>
                  <span className="font-semibold text-fg">{p.title}.</span> {p.text}
                </Checkbox>
              ))}
              {errs.policies && <p role="alert" className="text-[13px] font-medium text-danger">{errs.policies}</p>}
            </div>
          ))}
          {card && (tab === 'pay' || tab === 'tip') && cards.testMode && <p className="text-[12px] text-fg-3">Stripe test mode: card 4242 4242 4242 4242, any future date, any CVC. No real money moves.</p>}
        </div>
      )}

      {phase.kind === 'card' && (
        <Elements stripe={stripeFor(phase.intent.publishableKey)} options={{ clientSecret: phase.intent.clientSecret, appearance: { theme: 'stripe', variables: { borderRadius: '10px', fontFamily: 'Geist, system-ui, sans-serif' } } }}>
          <StaffCardForm
            slug={slug} orderId={phase.id} intent={phase.intent} policies={agreed} money={money} country={country}
            onDone={(r) => finished(phase.purpose === 'tip' ? 'Tip collected' : r.booked ? 'Booked' : 'Payment recorded', r.message, r.booked)}
            onError={(message) => setPhase({ kind: 'error', message })}
          />
        </Elements>
      )}

      {showSteps && (
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
      {phase.kind === 'error' && <Notice kind="danger" className="mt-2">{phase.message}</Notice>}

      {phase.kind === 'done' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="anim-pop grid size-16 place-items-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></span>
          <p className="max-w-md text-[15px] text-fg">{phase.text}</p>
        </div>
      )}
    </Modal>
  );
}

/** Stripe's card field: the card is confirmed in the browser, then the server reads the result from Stripe. */
function StaffCardForm({
  slug, orderId, intent, policies, money, country, onDone, onError,
}: {
  slug: string; orderId: string; intent: StaffCardIntent; policies: Record<string, boolean>; money: (c: number) => string; country: string;
  onDone: (r: { booked: boolean; message: string }) => void; onError: (message: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);
  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setDeclined(null);
    const r = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: window.location.href.split('?')[0]! } });
    if (r.error) {
      setBusy(false);
      // A decline can be retried with another card in the same field.
      return setDeclined(r.error.message ?? 'The card was declined.');
    }
    const done = await staffCardFinishAction(slug, orderId, r.paymentIntent!.id, policies);
    setBusy(false);
    if (!done.ok) return onError(done.error);
    onDone({ booked: done.data!.booked, message: done.message ?? 'Charged.' });
  }
  return (
    <div className="flex flex-col gap-4">
      {/* Staff type the customer's card: no Link sign-up, bank or wallets, and the workspace's country. */}
      <PaymentElement
        onReady={() => setReady(true)}
        options={{ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' }, defaultValues: { billingDetails: { address: { country } } } }}
      />
      {declined && <Notice kind="danger">{declined}</Notice>}
      <Button size="lg" icon={<Lock className="size-4" />} disabled={!ready || !stripe} pending={busy} onClick={pay}>Charge {money(intent.amountCents)}</Button>
      {intent.testMode && <p className="text-[12px] text-fg-3">Stripe test mode: card 4242 4242 4242 4242, any future date, any CVC.</p>}
      <p className="flex items-center gap-1.5 text-[12px] text-fg-3"><ShieldCheck className="size-4" /> The card number goes straight to Stripe. It is never stored or seen by this app.</p>
    </div>
  );
}
