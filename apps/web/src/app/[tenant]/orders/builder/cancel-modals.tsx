'use client';

import { Check, CloudRain, CreditCard, Gift, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addDays, CANCEL_REASONS, wallTimeToUtc } from '@rental/core';
import { Button, cx, Field, Input, Modal, Notice, Select, Spinner, Textarea } from '@/components/kit';
import { availabilityAction, cancelOrderAction, rescheduleOrderAction } from '@/server/actions/commerce';

type Outcome = 'wallet' | 'refund' | 'rain_check';
type Phase = { kind: 'form' } | { kind: 'running'; step: number } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

const dollars = (c: number) => (c / 100).toFixed(2);
const cents = (v: string) => Math.round((parseFloat(v) || 0) * 100);
const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Steps the server really runs; the list animates while it works. */
function Steps({ steps, phase }: { steps: string[]; phase: Phase }) {
  return (
    <ol className="flex flex-col gap-3 py-2" aria-live="polite">
      {steps.map((label, i) => {
        const done = phase.kind === 'running' ? phase.step > i : phase.kind === 'done';
        const doing = phase.kind === 'running' && phase.step === i;
        const failed = phase.kind === 'error' && i === 0;
        return (
          <li key={label} className="flex items-center gap-3">
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full transition-colors', done ? 'bg-success text-white' : failed ? 'bg-danger text-white' : doing ? 'bg-accent-soft text-accent-text' : 'bg-sunken text-fg-3')}>
              {done ? <Check className="anim-pop size-4" strokeWidth={3} /> : failed ? <X className="size-4" /> : doing ? <Spinner className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className={cx('text-sm', done || doing ? 'text-fg' : 'text-fg-3')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function useRun(steps: string[]) {
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  async function go(work: () => Promise<{ ok: true; text: string } | { ok: false; text: string }>) {
    setPhase({ kind: 'running', step: 0 });
    let step = 0;
    const tick = setInterval(() => { step = Math.min(step + 1, steps.length - 1); setPhase((p) => (p.kind === 'running' ? { kind: 'running', step } : p)); }, 450);
    const r = await work();
    clearInterval(tick);
    setPhase(r.ok ? { kind: 'done', text: r.text } : { kind: 'error', text: r.text });
  }
  return { phase, setPhase, go };
}

const OUTCOMES: { id: Outcome; label: string; sub: string; icon: typeof Wallet }[] = [
  { id: 'wallet', label: 'Wallet credit', sub: 'Kept for the customer’s next booking', icon: Wallet },
  { id: 'refund', label: 'Refund', sub: 'Card payments go back to the card; cash and checks are handed back', icon: CreditCard },
  { id: 'rain_check', label: 'Rain check', sub: 'A coded credit for a new date, with an expiry', icon: CloudRain },
];

/**
 * Cancel an order (design 31): "Maria paid $185.43. Choose what happens to it."
 * Always releases the items, stops reminders and the balance charge, and emails the cancellation.
 */
export function CancelOrderModal({
  open, onClose, onDone, slug, orderId, number, firstName, paidCents, cardPaidCents, money, canSettle, rainCheckMonths, walletCents,
}: {
  open: boolean; onClose: () => void; onDone: () => void; slug: string; orderId: string; number: string; firstName: string; paidCents: number; cardPaidCents: number;
  money: (c: number) => string; canSettle: boolean; rainCheckMonths: number; walletCents: number;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('wallet');
  const [amount, setAmount] = useState('');
  const [goodwill, setGoodwill] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const paid = paidCents > 0;
  const steps = ['Releasing the reserved items', paid ? 'Settling what was paid' : 'Closing the order', 'Stopping reminders and the balance charge', 'Emailing the cancellation'];
  const { phase, setPhase, go } = useRun(steps);
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'form' }); setReason(''); setNote(''); setOutcome('wallet'); setAmount(dollars(paidCents)); setGoodwill(''); setErr(null);
    setValidUntil(addDays(today, rainCheckMonths * 30));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const amt = cents(amount);
  const gw = cents(goodwill);
  const credit = outcome === 'refund' ? gw : amt + gw;

  async function confirm() {
    setErr(null);
    if (!reason) return setErr('Choose a reason.');
    if (paid && amt > paidCents) return setErr(`That is more than the ${money(paidCents)} paid.`);
    await go(async () => {
      const r = await cancelOrderAction(slug, orderId, {
        reason, note: note || undefined, outcome: paid ? outcome : 'none', amount: paid ? amt / 100 : 0, goodwill: gw / 100, validUntil: outcome === 'rain_check' ? validUntil : null,
      });
      return r.ok ? { ok: true, text: r.message ?? 'Cancelled.' } : { ok: false, text: r.error };
    });
  }
  const running = phase.kind === 'running';
  return (
    <Modal
      open={open}
      onClose={() => { if (!running) { if (phase.kind === 'done') onDone(); else onClose(); } }}
      width={600}
      title={phase.kind === 'done' ? 'Cancelled' : `Cancel ${number}?`}
      sub={phase.kind === 'form' ? (paid ? `${firstName} paid ${money(paidCents)}. Choose what happens to it.` : 'Nothing was paid. The items are released straight away.') : undefined}
      footer={
        phase.kind === 'done' ? <Button onClick={onDone}>Done</Button>
          : phase.kind === 'error' ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => setPhase({ kind: 'form' })}>Try again</Button></>
            : <><Button variant="secondary" onClick={onClose} disabled={running}>Keep the order</Button><Button variant="danger" pending={running} onClick={confirm} disabled={paid && !canSettle}>Cancel order</Button></>
      }
    >
      {phase.kind === 'form' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Reason" htmlFor="cx-reason">
              <Select id="cx-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose…</option>
                {CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Note" htmlFor="cx-note" optional>
              <Input id="cx-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown in the history and the email" />
            </Field>
          </div>
          {paid && !canSettle && <Notice kind="warning">Your role cannot refund or issue credit. Ask a manager to cancel this order.</Notice>}
          {paid && canSettle && (
            <>
              <div role="radiogroup" aria-label="What happens to the money" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {OUTCOMES.map((o) => {
                  const on = outcome === o.id;
                  const Icon = o.icon;
                  return (
                    <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => setOutcome(o.id)}
                      className={cx('press flex flex-col gap-1.5 rounded-[var(--radius-card)] border p-3 text-left transition-colors', on ? 'border-accent bg-accent-soft/30 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
                      <span className={cx('grid size-8 place-items-center rounded-full', on ? 'bg-accent text-on-accent' : 'bg-sunken text-fg-2')}><Icon className="size-4" /></span>
                      <span className="text-sm font-semibold text-fg">{o.label}</span>
                      <span className="text-[12px] leading-snug text-fg-2">{o.sub}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] bg-sunken/60 p-3.5 sm:grid-cols-3">
                <Field label={outcome === 'refund' ? 'Refund amount' : outcome === 'rain_check' ? 'Rain check amount' : 'Credit amount'} htmlFor="cx-amount" hint={`Up to ${money(paidCents)}`}>
                  <Input id="cx-amount" mono inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Goodwill credit" htmlFor="cx-gw" optional hint="Extra, on top">
                  <Input id="cx-gw" mono inputMode="decimal" value={goodwill} placeholder="0.00" onChange={(e) => setGoodwill(e.target.value)} />
                </Field>
                {outcome === 'rain_check' && (
                  <Field label="Valid until" htmlFor="cx-until">
                    <Input id="cx-until" type="date" mono value={validUntil} min={today} onChange={(e) => setValidUntil(e.target.value)} />
                  </Field>
                )}
              </div>
              <p className="text-[13px] text-fg-2">
                {outcome === 'refund'
                  ? `${money(Math.min(amt, cardPaidCents))} back to the card${amt > cardPaidCents ? `, ${money(amt - cardPaidCents)} handed back (cash or check)` : ''}${gw ? `, plus ${money(gw)} goodwill credit` : ''}.`
                  : `${firstName}’s wallet: ${money(walletCents)} → ${money(walletCents + (outcome === 'wallet' ? credit : 0))}${outcome === 'rain_check' ? ` · rain check ${money(credit)} until ${longDate(validUntil)}` : ''}.`}
              </p>
            </>
          )}
          {err && <p role="alert" className="text-sm font-medium text-danger">{err}</p>}
        </div>
      )}
      {(running || phase.kind === 'error') && (
        <>
          <Steps steps={steps} phase={phase} />
          {phase.kind === 'error' && <Notice kind="danger" className="mt-2">{phase.text}</Notice>}
        </>
      )}
      {phase.kind === 'done' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="anim-pop grid size-16 place-items-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></span>
          <p className="max-w-sm text-[15px] text-fg">{phase.text}</p>
          <p className="text-[13px] text-fg-2">The items are free again and the customer was emailed.</p>
        </div>
      )}
    </Modal>
  );
}

/**
 * Rain check (design 31): "Weather stopped the event. What Maria paid becomes
 * credit she can use on a new date." Use later (RC credit, order rained out)
 * or reschedule now (same order, new date, availability checked live).
 */
export function RainCheckModal({
  open, onClose, onDone, slug, orderId, number, firstName, paidCents, money, canSettle, rainCheckMonths, locationId, tz, start, end, durationMin, lines,
}: {
  open: boolean; onClose: () => void; onDone: () => void; slug: string; orderId: string; number: string; firstName: string; paidCents: number;
  money: (c: number) => string; canSettle: boolean; rainCheckMonths: number; locationId: string; tz: string; start: string; end: string; durationMin: number;
  lines: { productId: string | null; name: string; quantity: number }[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<'later' | 'reschedule'>('later');
  const [reason, setReason] = useState('Weather');
  const [amount, setAmount] = useState('');
  const [goodwill, setGoodwill] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [avail, setAvail] = useState<{ checking: boolean; short: string[] } | null>(null);
  const steps = mode === 'later'
    ? ['Issuing the rain check', 'Releasing the reserved items and the balance charge', 'Emailing the customer']
    : ['Checking the new date', 'Moving the booking and its reminders', 'Saving a new version'];
  const { phase, setPhase, go } = useRun(steps);
  useEffect(() => {
    if (!open) return;
    setPhase({ kind: 'form' }); setMode('later'); setReason('Weather'); setAmount(dollars(paidCents)); setGoodwill(''); setNote(''); setDate(''); setAvail(null);
    setValidUntil(addDays(today, rainCheckMonths * 30));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const newTimes = useMemo(() => {
    if (!date) return null;
    const startsAt = wallTimeToUtc(date, start, tz);
    return { startsAt, endsAt: new Date(startsAt.getTime() + durationMin * 60_000) };
  }, [date, start, durationMin, tz]);
  // Live availability for the new date (this order's own reservation does not count).
  useEffect(() => {
    if (mode !== 'reschedule' || !newTimes) return;
    let gone = false;
    setAvail({ checking: true, short: [] });
    availabilityAction(slug, { locationId, startsAt: newTimes.startsAt, endsAt: newTimes.endsAt, excludeOrderId: orderId }).then((r) => {
      if (gone) return;
      const a = r.ok ? r.data ?? {} : {};
      const need = new Map<string, { name: string; qty: number }>();
      for (const l of lines) if (l.productId) need.set(l.productId, { name: l.name, qty: (need.get(l.productId)?.qty ?? 0) + l.quantity });
      setAvail({ checking: false, short: [...need].filter(([id, n]) => a[id] && !a[id]!.overbook && a[id]!.free < n.qty).map(([, n]) => n.name) });
    });
    return () => { gone = true; };
  }, [mode, newTimes, slug, locationId, orderId, lines]);

  const credit = cents(amount) + cents(goodwill);
  async function confirm() {
    if (mode === 'later') {
      await go(async () => {
        const r = await cancelOrderAction(slug, orderId, { reason, note: note || undefined, outcome: 'rain_check', amount: cents(amount) / 100, goodwill: cents(goodwill) / 100, validUntil });
        return r.ok ? { ok: true, text: r.message ?? 'Rain check issued.' } : { ok: false, text: r.error };
      });
    } else {
      if (!newTimes) return;
      await go(async () => {
        const r = await rescheduleOrderAction(slug, orderId, { startsAt: newTimes.startsAt, endsAt: newTimes.endsAt, reason, note: note || undefined });
        return r.ok ? { ok: true, text: `${number} moved to ${longDate(date)}. ${r.message ?? ''}` } : { ok: false, text: r.error };
      });
    }
  }
  const running = phase.kind === 'running';
  const blocked = mode === 'reschedule' ? !newTimes || !!avail?.checking || !!avail?.short.length : paidCents > 0 && !canSettle;
  return (
    <Modal
      open={open}
      onClose={() => { if (!running) { if (phase.kind === 'done') onDone(); else onClose(); } }}
      width={600}
      title={phase.kind === 'done' ? (mode === 'later' ? 'Rain check issued' : 'Rescheduled') : `Rain check · ${number}`}
      sub={phase.kind === 'form' ? `Weather stopped the event. What ${firstName} paid becomes credit for a new date, or move the booking now.` : undefined}
      footer={
        phase.kind === 'done' ? <Button onClick={onDone}>Done</Button>
          : phase.kind === 'error' ? <><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => setPhase({ kind: 'form' })}>Try again</Button></>
            : <><Button variant="secondary" onClick={onClose} disabled={running}>Keep the order</Button><Button pending={running} disabled={blocked} onClick={confirm}>{mode === 'later' ? 'Issue rain check' : 'Reschedule'}</Button></>
      }
    >
      {phase.kind === 'form' && (
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Rain check" className="grid grid-cols-2 gap-2">
            {([['later', 'Use later', 'Rain check credit; the order is rained out'], ['reschedule', 'Reschedule now', 'Same order on a new date']] as const).map(([k, label, sub]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                className={cx('press rounded-[var(--radius-card)] border p-3 text-left', mode === k ? 'border-accent bg-accent-soft/30 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
                <span className="block text-sm font-semibold text-fg">{label}</span>
                <span className="block text-[12px] text-fg-2">{sub}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Reason" htmlFor="rc-reason">
              <Select id="rc-reason" value={reason} onChange={(e) => setReason(e.target.value)}>{CANCEL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
            </Field>
            <Field label="Note" htmlFor="rc-note" optional><Input id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Storm warning for the afternoon" /></Field>
          </div>
          {mode === 'later' ? (
            <>
              {paidCents > 0 && !canSettle && <Notice kind="warning">Your role cannot issue credit. Ask a manager.</Notice>}
              <div className="grid grid-cols-1 gap-3 rounded-[var(--radius-card)] bg-sunken/60 p-3.5 sm:grid-cols-3">
                <Field label="Rain check amount" htmlFor="rc-amount" hint={`Paid so far: ${money(paidCents)}`}><Input id="rc-amount" mono inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <Field label="Goodwill" htmlFor="rc-gw" optional hint="Added to the rain check"><Input id="rc-gw" mono inputMode="decimal" placeholder="0.00" value={goodwill} onChange={(e) => setGoodwill(e.target.value)} /></Field>
                <Field label="Valid until" htmlFor="rc-until"><Input id="rc-until" type="date" mono min={today} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
              </div>
              <div className="anim-rise flex items-center gap-4 rounded-[var(--radius-card)] bg-gradient-to-br from-[#0B2A4A] to-[#1D5FC4] p-4 text-white shadow-[var(--shadow-lift)]" aria-label="Rain check preview">
                <CloudRain className="size-9 shrink-0 opacity-90" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="mono block text-[11px] font-bold tracking-[0.14em] opacity-80">RAIN CHECK · RC-····</span>
                  <span className="mono block text-2xl font-bold">{money(credit)}</span>
                  <span className="block text-[12px] opacity-80">For {firstName} · valid until {longDate(validUntil || today)}</span>
                </span>
                {cents(goodwill) > 0 && <Gift className="size-5 opacity-80" aria-label="Includes goodwill" />}
              </div>
              <p className="flex items-center gap-2 text-[13px] text-fg-2"><Check className="size-4 text-success" /> Releases the reserved items and stops the event-day balance charge.</p>
            </>
          ) : (
            <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-sunken/60 p-3.5">
              <Field label="New date" htmlFor="rc-date" hint={`Same time: ${start}–${end}. Payments stay on the order.`}>
                <Input id="rc-date" type="date" mono min={today} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {avail && (avail.checking
                ? <p className="flex items-center gap-2 text-[13px] text-fg-2"><Spinner className="size-3.5" /> Checking that day…</p>
                : avail.short.length
                  ? <Notice kind="danger">Not free that day: {avail.short.join(', ')}.</Notice>
                  : <p className="flex items-center gap-2 text-[13px] font-semibold text-success-fg"><Check className="size-4" /> {lines.filter((l) => l.productId).length > 1 ? 'All items are' : 'The item is'} free that day.</p>)}
            </div>
          )}
        </div>
      )}
      {(running || phase.kind === 'error') && (
        <>
          <Steps steps={steps} phase={phase} />
          {phase.kind === 'error' && <Notice kind="danger" className="mt-2">{phase.text}</Notice>}
        </>
      )}
      {phase.kind === 'done' && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="anim-pop grid size-16 place-items-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></span>
          <p className="max-w-sm text-[15px] text-fg">{phase.text}</p>
        </div>
      )}
    </Modal>
  );
}
