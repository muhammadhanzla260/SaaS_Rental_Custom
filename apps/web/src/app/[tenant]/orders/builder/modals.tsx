'use client';

import { Check, CreditCard, Link2, Wallet, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MANUAL_METHODS, UNPAID_REASONS } from '@rental/core';
import { Button, Checkbox, cx, Field, Input, LinkButton, Modal, Notice, Select, Spinner, Textarea } from '@/components/kit';

export type BookChoice = (
  | { method: 'manual'; payMethod: string; amount: string; tip: string; reference: string; receipt: boolean }
  | { method: 'none'; reason: string; expectedOn: string; notes: string }
) & { policies: Record<string, boolean> };

type Plan = 'deposit' | 'full' | 'custom';
const TIPS = [0, 10, 15, 20] as const;

type Phase = { kind: 'choose' } | { kind: 'running'; step: number } | { kind: 'done'; number: string } | { kind: 'error'; message: string };

const METHODS = [
  { id: 'card', label: 'Charge a saved card', sub: 'After booking: Invoices → Record payment → Card on file', icon: CreditCard, enabled: false },
  { id: 'link', label: 'Send a pay link', sub: 'Use Send quote: the customer signs and pays online', icon: Link2, enabled: false },
  { id: 'manual', label: 'Cash, check, Zelle, Venmo or ACH', sub: 'Recorded now with a receipt number', icon: Wallet, enabled: true },
  { id: 'none', label: 'Book without payment', sub: 'Needs a reason and an expected payment date', icon: X, enabled: true },
] as const;

/**
 * Booking: pick how the deposit is handled, then watch the server lock, check
 * and reserve (the steps are real; the bar only animates while it waits).
 */
export function BookModal({
  open, onClose, depositLabel, depositCents, totalCents, totalLabel, tipBaseCents, money, policies, signedOnline, bufferLabel, number, onConfirm, calendarHref, canRecordPayment, booked,
}: {
  open: boolean; onClose: () => void; depositLabel: string; depositCents: number; totalCents: number; totalLabel: string;
  /** Tips are a share of the rental items (Odoo: "10% | $82.90"). */
  tipBaseCents: number; money: (c: number) => string;
  policies: { key: string; title: string; text: string }[]; signedOnline: boolean; bufferLabel: string; number: string;
  onConfirm: (c: BookChoice) => Promise<{ ok: true; number: string } | { ok: false; error: string }>; calendarHref: string; canRecordPayment: boolean; booked: boolean;
}) {
  const [method, setMethod] = useState<'manual' | 'none'>(canRecordPayment && depositCents > 0 ? 'manual' : 'none');
  const [manual, setManual] = useState({ payMethod: 'check', amount: '', tip: '', reference: '', receipt: true });
  const [plan, setPlan] = useState<Plan>('deposit');
  const [tipPct, setTipPct] = useState<number | 'custom'>(0);
  const [none, setNone] = useState({ reason: '', expectedOn: '', notes: '' });
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'choose' });
    setErrs({});
    setPlan(depositCents > 0 ? 'deposit' : 'full');
    setTipPct(0);
    setAgreed({});
    setManual({ payMethod: 'check', amount: ((depositCents > 0 ? depositCents : totalCents) / 100).toFixed(2), tip: '', reference: '', receipt: true });
    setMethod(canRecordPayment && depositCents > 0 ? 'manual' : 'none');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const choosePlan = (p: Plan) => {
    setPlan(p);
    if (p !== 'custom') setManual((m) => ({ ...m, amount: ((p === 'deposit' ? depositCents : totalCents) / 100).toFixed(2) }));
  };
  const chooseTip = (t: number | 'custom') => {
    setTipPct(t);
    if (t !== 'custom') setManual((m) => ({ ...m, tip: t ? ((Math.round((tipBaseCents * t) / 100)) / 100).toFixed(2) : '' }));
  };
  // Staff confirm the policies for the customer, unless the customer already signed online.
  const needPolicies = !signedOnline ? policies.filter((p) => !agreed[p.key]) : [];
  const recordTotal = (parseFloat(manual.amount) || 0) + (parseFloat(manual.tip) || 0);

  const payStep = method === 'manual' ? 'Recording the payment and receipt number' : 'Noting why it was booked without payment';
  const steps = ['Locking the order and re-checking availability', 'Reserving stock with the cleanup buffer', payStep, 'Recording the booking in order history'];

  async function confirm() {
    const e: Record<string, string> = {};
    if (method === 'manual' && !(parseFloat(manual.amount) > 0)) e.amount = 'Enter the amount received.';
    if (method === 'none' && !none.reason) e.reason = 'Choose a reason.';
    if (method === 'none' && !none.expectedOn) e.expectedOn = 'Pick the date you expect payment.';
    if (needPolicies.length) e.policies = `Confirm the customer agreed to: ${needPolicies.map((p) => p.title).join(', ')}.`;
    setErrs(e);
    if (Object.keys(e).length) return;
    setPhase({ kind: 'running', step: 0 });
    let step = 0;
    const tick = setInterval(() => {
      step = Math.min(step + 1, steps.length - 1);
      setPhase((p) => (p.kind === 'running' ? { kind: 'running', step } : p));
    }, 450);
    const r = await onConfirm(method === 'manual' ? { method, ...manual, policies: agreed } : { method, ...none, policies: agreed });
    clearInterval(tick);
    if (!r.ok) return setPhase({ kind: 'error', message: r.error });
    setPhase({ kind: 'running', step: steps.length });
    setTimeout(() => setPhase({ kind: 'done', number: r.number }), 350);
  }

  const running = phase.kind === 'running';
  return (
    <Modal
      open={open}
      onClose={() => { if (!running) onClose(); }}
      width={560}
      title={phase.kind === 'done' ? 'Booked' : running ? `Booking ${number}` : `Book & take the deposit · ${depositLabel}`}
      sub={phase.kind === 'choose' ? 'Booking re-checks availability inside the database, so two people can’t book the last unit at once.' : undefined}
      footer={
        phase.kind === 'done' ? (
          <>
            <LinkButton variant="secondary" href={calendarHref}>View on calendar</LinkButton>
            <Button onClick={onClose}>Keep editing</Button>
          </>
        ) : phase.kind === 'error' ? (
          <>
            <Button variant="secondary" onClick={onClose}>Back to the order</Button>
            <Button onClick={() => setPhase({ kind: 'choose' })}>Try again</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={running}>Cancel</Button>
            <Button onClick={confirm} pending={running} disabled={booked}>Confirm booking</Button>
          </>
        )
      }
    >
      {phase.kind === 'choose' && (
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Deposit method" className="flex flex-col gap-2">
            {METHODS.map((m) => {
              const enabled = m.enabled && (m.id !== 'manual' || canRecordPayment);
              const on = method === m.id;
              const Icon = m.icon;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={on} disabled={!enabled}
                  onClick={() => enabled && setMethod(m.id as 'manual' | 'none')}
                  className={cx('press flex items-center gap-3 rounded-[var(--radius-card)] border p-3.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    on ? 'border-accent bg-accent-soft/30 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
                  <span className={cx('grid size-9 shrink-0 place-items-center rounded-full', on ? 'bg-accent text-on-accent' : 'bg-sunken text-fg-2')}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">{m.label}</span>
                    <span className="block text-[13px] text-fg-2">{m.id === 'manual' && !canRecordPayment ? 'Your role cannot record payments' : m.sub}</span>
                  </span>
                  <span className={cx('grid size-[18px] shrink-0 place-items-center rounded-full border', on ? 'border-accent bg-accent' : 'border-control')}>{on && <span className="size-1.5 rounded-full bg-on-accent" />}</span>
                </button>
              );
            })}
          </div>
          {method === 'manual' && (
            <div className="anim-fade flex flex-col gap-3 rounded-[var(--radius-card)] bg-sunken/60 p-3.5">
              <div role="radiogroup" aria-label="Amount to collect" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {([['full', 'Full balance', money(totalCents)], ...(depositCents > 0 ? [['deposit', 'Deposit', depositLabel]] : []), ['custom', 'Custom amount', 'Enter it']] as [Plan, string, string][]).map(([key, label, amount]) => (
                  <button key={key} type="button" role="radio" aria-checked={plan === key} onClick={() => choosePlan(key)}
                    className={cx('press flex flex-col rounded-[var(--radius-control)] border bg-surface px-3 py-2 text-left', plan === key ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
                    <span className="text-[13px] font-semibold text-fg">Collect {label.toLowerCase()}</span>
                    <span className="mono text-[13px] text-fg-2">{amount}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Method" htmlFor="bk-method">
                  <Select id="bk-method" value={manual.payMethod} onChange={(e) => setManual({ ...manual, payMethod: e.target.value })}>
                    {MANUAL_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </Select>
                </Field>
                <Field label="Amount received" htmlFor="bk-amount" error={errs.amount}>
                  <Input id="bk-amount" mono inputMode="decimal" value={manual.amount} onChange={(e) => { setPlan('custom'); setManual({ ...manual, amount: e.target.value }); }} invalid={!!errs.amount} />
                </Field>
                <Field label="Reference" htmlFor="bk-ref" optional>
                  <Input id="bk-ref" value={manual.reference} onChange={(e) => setManual({ ...manual, reference: e.target.value })} placeholder="Check #1043" />
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-fg">Tip for the party coach</p>
                <div role="radiogroup" aria-label="Tip" className="flex flex-wrap gap-1.5">
                  {[...TIPS, 'custom' as const].map((t) => (
                    <button key={String(t)} type="button" role="radio" aria-checked={tipPct === t} onClick={() => chooseTip(t)}
                      className={cx('press h-8 rounded-[var(--radius-control)] border px-2.5 text-[12px] font-semibold', tipPct === t ? 'border-accent bg-accent text-on-accent' : 'border-control bg-surface text-fg hover:bg-hover')}>
                      {t === 0 ? 'No tip' : t === 'custom' ? 'Custom' : `${t}% | ${money(Math.round((tipBaseCents * t) / 100))}`}
                    </button>
                  ))}
                </div>
                {tipPct === 'custom' && <Input aria-label="Tip amount" mono inputMode="decimal" value={manual.tip} onChange={(e) => setManual({ ...manual, tip: e.target.value })} placeholder="0.00" className="anim-fade mt-2 w-32" />}
              </div>
              <Checkbox checked={manual.receipt} onChange={(x) => setManual({ ...manual, receipt: x })}>Email the payment receipt to the customer</Checkbox>
              <p className="flex justify-between text-sm"><span className="text-fg-2">Total payment to record</span><span className="mono font-bold text-fg">{money(Math.round(recordTotal * 100))}</span></p>
            </div>
          )}
          {method === 'none' && (
            <div className="anim-fade grid grid-cols-1 gap-3 rounded-[var(--radius-card)] bg-sunken/60 p-3.5 sm:grid-cols-2">
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
          )}
          {policies.length > 0 && (signedOnline ? (
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
        </div>
      )}
      {(running || phase.kind === 'error') && (
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
          {phase.kind === 'error' && <Notice kind="danger" className="mt-2">{phase.message}</Notice>}
        </ol>
      )}
      {phase.kind === 'done' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="anim-pop grid size-16 place-items-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></span>
          <p className="text-[15px] text-fg">
            <span className="mono font-semibold">{phase.number}</span> · {totalLabel} · deposit {depositLabel}.
            <br />Items are reserved until {bufferLabel}. You can keep editing this order.
          </p>
        </div>
      )}
    </Modal>
  );
}

export function OverpaidModal({ open, amountLabel, onChoose, canRefund }: { open: boolean; amountLabel: string; onChoose: (c: 'refund' | 'wallet' | 'keep') => void; canRefund: boolean }) {
  return (
    <Modal open={open} onClose={() => onChoose('keep')} title={`The customer has paid ${amountLabel} more than the new total`} sub="What should happen to the difference?">
      <div className="flex flex-col gap-2">
        <Button variant="secondary" disabled={!canRefund} onClick={() => onChoose('wallet')} className="h-auto justify-start py-3 text-left">Move it to their wallet credit (used on a later order)</Button>
        <Button variant="secondary" disabled={!canRefund} onClick={() => onChoose('refund')} className="h-auto justify-start py-3 text-left">Refund the difference (record it as owed back)</Button>
        <Button variant="ghost" onClick={() => onChoose('keep')} className="h-auto justify-start py-3 text-left">Keep it as an overpayment for now</Button>
        {!canRefund && <p className="text-[13px] text-fg-2">Your role cannot refund or issue credit; a manager can sort it out later.</p>}
      </div>
    </Modal>
  );
}

export function PaymentModal({ open, onClose, onSave, balanceCents }: { open: boolean; onClose: () => void; onSave: (p: { method: string; amount: string; reference: string }) => Promise<string | null>; balanceCents: number }) {
  const [p, setP] = useState({ method: 'cash', amount: '', reference: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setP({ method: 'cash', amount: (Math.max(0, balanceCents) / 100).toFixed(2), reference: '' }); setErr(null); } }, [open, balanceCents]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record a payment"
      sub="Cash, check and transfers. Card payments arrive with Phase 2."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button pending={busy} onClick={async () => { setBusy(true); setErr(await onSave(p)); setBusy(false); }}>Record payment</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Method" htmlFor="pm-method">
          <Select id="pm-method" value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}>
            {MANUAL_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Amount" htmlFor="pm-amount"><Input id="pm-amount" mono inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
        <Field label="Reference" htmlFor="pm-ref" optional><Input id="pm-ref" value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} /></Field>
      </div>
      {err && <Notice kind="danger" className="mt-3">{err}</Notice>}
    </Modal>
  );
}
