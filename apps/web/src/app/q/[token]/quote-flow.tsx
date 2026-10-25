'use client';

import { useRouter } from 'next/navigation';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { CalendarPlus, Check, Download, FileSignature, Lock, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState, useTransition, type CSSProperties } from 'react';
import { ProductArt } from '@/components/catalog/product-art';
import { Button, Checkbox, cx, Field, Input, Modal, Notice, Spinner, Textarea, useToast } from '@/components/kit';
import {
  quoteBookAction, quoteFinishPaymentAction, quoteRequestChangesAction, quoteSignAction, quoteStartPaymentAction, quoteWaiverAction, type StartPayment,
} from '@/server/actions/quote';

export type QuoteView = {
  token: string;
  brand: { name: string; color: string; onColor: string; logoUrl: string | null; phone: string | null; location: string; reviewLink: string | null };
  firstName: string;
  order: {
    number: string; status: string; eventType: string; dateLong: string; dateShort: string; timeRange: string; setupFrom: string; where: string; address: string;
    surface: string | null; items: { name: string; quantity: number; total: string; icon: string | null; tint: string | null; kind: string; sub: string }[];
    summary: { label: string; value: string; tone?: 'credit' }[]; total: string; dueAfterCredits: string | null; deposit: string; depositCents: number; paid: string;
    balance: string; fullCents: number; full: string; validUntil: string | null; waiver: { on: boolean; percent: number; amount: string }; balanceDue: string | null; autoCharge: boolean;
  };
  state: 'quote' | 'balance' | 'done' | 'expired' | 'cancelled';
  due: { amountCents: number; label: string; amount: string };
  agreement: { title: string; version: string; sections: { heading: string | null; paragraphs: string[] }[]; policies: { key: string; title: string; text: string }[] };
  signature: { name: string; at: string; version: string } | null;
  gateway: { publishableKey: string; testMode: boolean } | null;
  card: { brand: string | null; last4: string | null } | null;
  payments: { number: string; amount: string; last4: string | null; brand: string | null; method: string; at: string }[];
  returningIntent: string | null;
  currency: string;
};

type Step = 'review' | 'policies' | 'sign' | 'pay' | 'done';
const STEPS: { key: Step; label: string }[] = [
  { key: 'review', label: 'Review' }, { key: 'policies', label: 'Policies' }, { key: 'sign', label: 'Sign' }, { key: 'pay', label: 'Pay' },
];

const stripeCache = new Map<string, Promise<Stripe | null>>();
const stripeFor = (key: string) => {
  if (!stripeCache.has(key)) stripeCache.set(key, loadStripe(key));
  return stripeCache.get(key)!;
};

export function QuoteFlow({ view }: { view: QuoteView }) {
  const v = view;
  const router = useRouter();
  const first: Step = v.state === 'done' ? 'done' : v.state === 'balance' ? 'review' : v.signature ? 'pay' : 'review';
  const [step, setStep] = useState<Step>(first);
  const [paid, setPaid] = useState<{ number: string; last4: string | null; brand: string | null } | null>(null);
  const [refreshing, startRefresh] = useTransition();
  /** Next step only once the page has the server's latest (signature, invoices), so it never shows stale. */
  const advance = (next: Step) => startRefresh(() => { router.refresh(); setStep(next); });
  const brandStyle = { '--qb': v.brand.color, '--qon': v.brand.onColor } as CSSProperties;
  const steps = v.state === 'balance' ? [STEPS[0]!, STEPS[3]!] : STEPS;
  const idx = steps.findIndex((s) => s.key === step);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);

  return (
    <div className="min-h-dvh bg-canvas" style={brandStyle}>
      <header style={{ background: 'var(--qb)', color: 'var(--qon)' }}>
        <div className="mx-auto flex max-w-[1080px] items-center gap-3 px-4 py-4 sm:px-6 sm:py-5">
          {v.brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.brand.logoUrl} alt="" className="size-11 rounded-[12px] bg-white object-contain p-1" />
          ) : (
            <span className="grid size-11 place-items-center rounded-[12px] bg-white/20 font-bold">{v.brand.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold sm:text-xl">{v.brand.name}</p>
            <p className="truncate text-[13px] opacity-80">{[v.brand.location, v.brand.phone].filter(Boolean).join(' · ')}</p>
          </div>
          <p className="mono hidden text-sm opacity-90 sm:block">Quote {v.order.number}</p>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 pb-20 pt-6 sm:px-6">
        {v.state === 'cancelled' && <Notice kind="danger">This order was cancelled. Please contact {v.brand.name} if this is a surprise.</Notice>}
        {v.state === 'expired' && (
          <div className="mx-auto max-w-lg rounded-[var(--radius-panel)] border border-subtle bg-surface p-8 text-center">
            <h1 className="font-display text-2xl font-bold text-fg">This quote has expired</h1>
            <p className="mt-2 text-fg-2">Prices and availability may have changed. Ask {v.brand.name} for a new one{v.brand.phone ? ` at ${v.brand.phone}` : ''}.</p>
          </div>
        )}
        {(v.state === 'quote' || v.state === 'balance' || v.state === 'done') && (
          <>
            {step !== 'done' && (
              <ol className="mb-6 grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }} aria-label="Progress">
                {steps.map((s, i) => (
                  <li key={s.key} aria-current={s.key === step ? 'step' : undefined}>
                    <span className={cx('block h-1.5 rounded-full transition-colors duration-500', i <= idx ? '' : 'bg-control')} style={i <= idx ? { background: 'var(--qb)' } : undefined} />
                    <span className={cx('mt-2 block text-[13px] font-semibold', i === idx ? 'text-fg' : 'text-fg-3')}>{i + 1} · {s.label}</span>
                  </li>
                ))}
              </ol>
            )}
            {step === 'done' ? (
              <Done view={v} paid={paid} />
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                <section className={cx('anim-rise min-w-0 rounded-[var(--radius-panel)] border border-subtle bg-surface p-5 transition-opacity sm:p-8', refreshing && 'pointer-events-none opacity-60')} aria-busy={refreshing} key={step}>
                  {step === 'review' && <Review view={v} onNext={() => setStep(v.state === 'balance' ? 'pay' : 'policies')} />}
                  {step === 'policies' && <Policies view={v} onNext={() => setStep('sign')} onChanged={() => router.refresh()} />}
                  {step === 'sign' && <Sign view={v} onNext={() => advance('pay')} />}
                  {step === 'pay' && <Pay view={v} onPaid={(p) => { setPaid(p); advance('done'); }} />}
                </section>
                <Summary view={v} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// --- review ----------------------------------------------------------------------------------------

function Review({ view: v, onNext }: { view: QuoteView; onNext: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const booked = v.state === 'balance';
  return (
    <>
      <h1 className="font-display text-[30px] font-extrabold leading-tight tracking-tight text-fg sm:text-[40px]">
        {booked ? `You’re booked, ${v.firstName}!` : `Hi ${v.firstName}, here’s your quote`}
      </h1>
      <p className="mt-2 text-[16px] text-fg-2">
        For your {v.order.eventType} on {v.order.dateLong}.{' '}
        {booked ? `The balance of ${v.due.amount} is due${v.order.balanceDue ? ` on ${v.order.balanceDue}` : ''}.` : 'Nothing is reserved until you sign and pay the deposit.'}
      </p>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] bg-sunken/70 p-4">
          <p className="text-[13px] text-fg-2">When</p>
          <p className="mt-1 font-semibold text-fg">{v.order.dateShort} · {v.order.timeRange}</p>
          <p className="text-[13px] text-fg-2">Setup from {v.order.setupFrom}</p>
        </div>
        <div className="rounded-[var(--radius-card)] bg-sunken/70 p-4">
          <p className="text-[13px] text-fg-2">Where</p>
          <p className="mt-1 font-semibold text-fg">{v.order.where}</p>
          <p className="text-[13px] text-fg-2">{[v.order.address, v.order.surface?.toLowerCase()].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {v.order.items.map((it, i) => (
          <li key={i} className="flex items-center gap-4 rounded-[var(--radius-card)] border border-subtle p-3.5">
            <ProductArt product={{ name: it.name, kind: it.kind, icon: it.icon, tint: it.tint }} size={52} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-fg">{it.name}</span>
              <span className="block text-[13px] text-fg-2">{it.sub}</span>
            </span>
            <span className="mono font-semibold text-fg">{it.total}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button size="lg" onClick={onNext} className="!bg-[var(--qb)] !text-[var(--qon)]">{booked ? `Pay ${v.due.amount}` : 'Looks good — continue'}</Button>
        {!booked && <Button size="lg" variant="secondary" onClick={() => setAsk(true)}>Request changes</Button>}
      </div>
      <Modal
        open={ask}
        onClose={() => setAsk(false)}
        title="What would you like to change?"
        sub={`${v.brand.name} gets your message and will send an updated quote.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsk(false)}>Cancel</Button>
            <Button pending={busy} onClick={async () => {
              setBusy(true);
              const r = await quoteRequestChangesAction(v.token, msg);
              setBusy(false);
              toast(r.ok ? (r.message ?? 'Sent.') : r.error, r.ok ? 'ok' : 'error');
              if (r.ok) { setAsk(false); setMsg(''); }
            }}>Send to {v.brand.name}</Button>
          </>
        }
      >
        <Textarea aria-label="Your message" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Could we start at 2 PM instead, and add a second popcorn machine?" />
      </Modal>
    </>
  );
}

// --- policies ------------------------------------------------------------------------------------------

function Policies({ view: v, onNext, onChanged }: { view: QuoteView; onNext: () => void; onChanged: () => void }) {
  const toast = useToast();
  const stored = useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem(`q:${v.token}:policies`) ?? '{}') as Record<string, boolean>; } catch { return {}; }
  }, [v.token]);
  const [ticks, setTicks] = useState<Record<string, boolean>>(stored);
  const [waiver, setWaiver] = useState<boolean | null>(stored.__waiverChosen ? v.order.waiver.on : null);
  const [busy, setBusy] = useState(false);
  const save = (t: Record<string, boolean>) => {
    setTicks(t);
    try { sessionStorage.setItem(`q:${v.token}:policies`, JSON.stringify(t)); } catch {}
  };
  async function chooseWaiver(accept: boolean) {
    setWaiver(accept);
    save({ ...ticks, __waiverChosen: true });
    if (accept === v.order.waiver.on) return;
    setBusy(true);
    const r = await quoteWaiverAction(v.token, accept);
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    onChanged();
  }
  const others = v.agreement.policies.filter((p) => p.key !== 'waiver');
  const waiverPolicy = v.agreement.policies.find((p) => p.key === 'waiver');
  const ready = others.every((p) => ticks[p.key]) && (!waiverPolicy || waiver !== null);
  return (
    <>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-fg sm:text-[34px]">A few things to agree on</h1>
      <p className="mt-2 text-fg-2">Tap each one to accept it.</p>
      <ul className="mt-6 flex flex-col gap-3">
        {others.map((p) => {
          const on = !!ticks[p.key];
          return (
            <li key={p.key}>
              <button type="button" aria-pressed={on} onClick={() => save({ ...ticks, [p.key]: !on })}
                className={cx('press flex w-full items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left transition-colors', on ? 'border-success bg-success-bg/60' : 'border-subtle hover:border-control')}>
                <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors', on ? 'border-success bg-success text-white' : 'border-control')}>
                  {on && <Check className="anim-pop size-3.5" strokeWidth={3.5} />}
                </span>
                <span><span className="block font-semibold text-fg">{p.title}</span><span className="mt-0.5 block text-[14px] text-fg-2">{p.text}</span></span>
              </button>
            </li>
          );
        })}
        {waiverPolicy && (
          <li className="rounded-[var(--radius-card)] border border-subtle p-4">
            <p className="font-semibold text-fg">{waiverPolicy.title} <span className="font-normal text-fg-2">· {v.order.waiver.percent}% ({v.order.waiver.amount})</span></p>
            <p className="mt-0.5 text-[14px] text-fg-2">{waiverPolicy.text}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[true, false].map((acc) => {
                const on = waiver === acc;
                return (
                  <button key={String(acc)} type="button" aria-pressed={on} disabled={busy} onClick={() => chooseWaiver(acc)}
                    className={cx('press h-11 rounded-[var(--radius-control)] border text-sm font-semibold transition-colors', on ? 'border-[var(--qb)] bg-[var(--qb)] text-[var(--qon)]' : 'border-control text-fg hover:bg-hover')}>
                    {busy && on ? <Spinner className="mx-auto size-4" /> : acc ? `Add it (+${v.order.waiver.amount})` : 'No thanks'}
                  </button>
                );
              })}
            </div>
          </li>
        )}
      </ul>
      <Button size="lg" className="mt-6 !bg-[var(--qb)] !text-[var(--qon)]" disabled={!ready || busy} onClick={onNext}>Continue to sign</Button>
    </>
  );
}

// --- sign ----------------------------------------------------------------------------------------------

function Sign({ view: v, onNext }: { view: QuoteView; onNext: () => void }) {
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function sign() {
    setErr(null);
    let policies: Record<string, boolean> = {};
    try { policies = JSON.parse(sessionStorage.getItem(`q:${v.token}:policies`) ?? '{}'); } catch {}
    setBusy(true);
    const r = await quoteSignAction(v.token, { typedName: name, consent, policies, waiverAccepted: v.order.waiver.on });
    setBusy(false);
    if (!r.ok) return setErr(r.fieldErrors ? Object.values(r.fieldErrors)[0]! : r.error);
    onNext();
  }
  return (
    <>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-fg sm:text-[34px]">{v.agreement.title}</h1>
      <p className="mt-1 text-[13px] text-fg-2">Version {v.agreement.version} · {v.order.number}</p>
      <div className="mt-5 max-h-[46dvh] overflow-y-auto rounded-[var(--radius-card)] border border-subtle bg-sunken/40 p-4 text-[14px] leading-relaxed text-fg" tabIndex={0} aria-label="Agreement text">
        {v.agreement.sections.map((s, i) => (
          <div key={i} className="mb-4 last:mb-0">
            {s.heading && <h2 className="mb-1 font-semibold text-fg">{s.heading}</h2>}
            {s.paragraphs.map((p, j) => <p key={j} className="mb-2 text-fg-2">{p}</p>)}
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-4">
        <Field label="Type your full name" htmlFor="q-name" hint="This is your signature.">
          <Input id="q-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="font-display text-xl" placeholder="Maria Gonzalez" />
        </Field>
        <Checkbox checked={consent} onChange={setConsent}>I agree to the rental agreement and the policies, and typing my name is my legal signature.</Checkbox>
        {err && <Notice kind="danger">{err}</Notice>}
        <Button size="lg" icon={<FileSignature className="size-4" />} className="self-start !bg-[var(--qb)] !text-[var(--qon)]" disabled={!consent || name.trim().length < 3} pending={busy} onClick={sign}>Sign and continue</Button>
      </div>
    </>
  );
}

// --- pay --------------------------------------------------------------------------------------------------

function Pay({ view: v, onPaid }: { view: QuoteView; onPaid: (p: { number: string; last4: string | null; brand: string | null }) => void }) {
  const toast = useToast();
  const [saveCard, setSaveCard] = useState(true);
  // Like the Odoo quote email: pay everything now, or the deposit and the rest later.
  const [plan, setPlan] = useState<'deposit' | 'full'>('deposit');
  const [intent, setIntent] = useState<StartPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const booked = v.state === 'balance';

  // Coming back from a bank's 3-D Secure page: finish the payment straight away.
  useEffect(() => {
    if (!v.returningIntent) return;
    setBusy(true);
    quoteFinishPaymentAction(v.token, v.returningIntent).then((r) => {
      setBusy(false);
      if (r.ok) onPaid({ number: r.data!.paymentNumber, last4: r.data!.last4, brand: r.data!.brand });
      else setErr(r.error);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(full = plan === 'full') {
    setErr(null);
    setBusy(true);
    const r = await quoteStartPaymentAction(v.token, saveCard, full);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setIntent(r.data!);
  }
  if (v.order.depositCents <= 0 && !booked && !intent) {
    return (
      <>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight text-fg">Nothing to pay today</h1>
        <p className="mt-2 text-fg-2">Your booking needs no deposit. The total of {v.order.full} is due {v.order.balanceDue ? `by ${v.order.balanceDue}` : 'on the event day'}.</p>
        {err && <Notice kind="danger" className="mt-4">{err}</Notice>}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" className="!bg-[var(--qb)] !text-[var(--qon)]" pending={busy} onClick={async () => {
            setBusy(true);
            const r = await quoteBookAction(v.token);
            setBusy(false);
            if (!r.ok) return setErr(r.error);
            onPaid({ number: '', last4: null, brand: null });
          }}>Book it</Button>
          {v.gateway && v.order.fullCents > 0 && <Button size="lg" variant="secondary" icon={<Lock className="size-4" />} disabled={busy} onClick={() => start(true)}>Pay {v.order.full} now</Button>}
        </div>
      </>
    );
  }
  const full = plan === 'full';
  const choose = !booked && v.order.fullCents > v.order.depositCents && v.order.depositCents > 0;
  return (
    <>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-fg sm:text-[34px]">{booked ? 'Pay the balance' : 'Pay to book'}</h1>
      <p className="mt-2 text-fg-2">
        {booked ? `${v.due.amount} for ${v.order.number}.` : full || v.order.depositCents <= 0 ? `Pay ${v.order.full} now and your ${v.order.dateShort} booking is all set.` : `The ${v.order.deposit} deposit reserves everything for ${v.order.dateShort}.`}
      </p>
      {choose && !intent && (
        <div role="radiogroup" aria-label="How much to pay" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([['full', 'Pay in full', v.order.full, 'Pay once now. Then relax knowing your event balance is taken care of.', 'Easiest option'],
            ['deposit', 'Pay deposit', v.order.deposit, `Reserve your date now. The balance of ${v.order.balance} is due ${v.order.balanceDue ? `by ${v.order.balanceDue}` : 'on the event day'}.`, 'Minimum payment']] as const).map(([key, title, amount, text, badge]) => (
            <button key={key} type="button" role="radio" aria-checked={plan === key} onClick={() => setPlan(key)}
              className={cx('press rounded-[var(--radius-card)] border-2 p-4 text-left transition-colors', plan === key ? 'border-[var(--qb)] bg-[color-mix(in_srgb,var(--qb)_6%,transparent)]' : 'border-subtle hover:border-control')}>
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg-2">{badge}</span>
              <span className="mt-1 flex items-baseline justify-between gap-2"><span className="font-semibold text-fg">{title}</span><span className="mono text-lg font-bold text-fg">{amount}</span></span>
              <span className="mt-1 block text-[13px] text-fg-2">{text}</span>
            </button>
          ))}
        </div>
      )}
      {v.signature && !booked && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-success-fg"><Check className="size-4" /> Signed by {v.signature.name}</p>}
      {!v.gateway ? (
        <Notice className="mt-6">{v.brand.name} hasn’t switched on card payments yet. Please call {v.brand.phone ?? 'the office'} to pay and book.</Notice>
      ) : !intent ? (
        <div className="mt-6 flex flex-col gap-4">
          {!booked && !full && (
            <Checkbox checked={saveCard} onChange={setSaveCard}>
              Save my card so the balance of {v.order.balance} is charged on the event day{v.order.balanceDue ? ` (${v.order.balanceDue})` : ''}. I authorise {v.brand.name} to make that charge.
            </Checkbox>
          )}
          {err && <Notice kind="danger">{err}</Notice>}
          <Button size="lg" icon={<Lock className="size-4" />} className="self-start !bg-[var(--qb)] !text-[var(--qon)]" pending={busy} onClick={() => start()}>Continue to card</Button>
        </div>
      ) : (
        <Elements stripe={stripeFor(intent.publishableKey)} options={{ clientSecret: intent.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: v.brand.color, borderRadius: '10px', fontFamily: 'Geist, system-ui, sans-serif' } } }}>
          <CardForm view={v} intent={intent} onPaid={onPaid} onError={(e) => toast(e, 'error')} />
        </Elements>
      )}
      {v.gateway?.testMode && <p className="mt-4 text-[12px] text-fg-3">Test mode: use card 4242 4242 4242 4242, any future date and any CVC. No real money moves.</p>}
      <p className="mt-6 flex items-center gap-1.5 text-[12px] text-fg-3"><ShieldCheck className="size-4" /> Card details go straight to the payment processor. {v.brand.name} never sees your card number.</p>
    </>
  );
}

function CardForm({ view: v, intent, onPaid, onError }: { view: QuoteView; intent: StartPayment; onPaid: (p: { number: string; last4: string | null; brand: string | null }) => void; onError: (e: string) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    const r = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: window.location.href.split('?')[0]! } });
    if (r.error) {
      setBusy(false);
      return onError(r.error.message ?? 'The card was declined.');
    }
    const done = await quoteFinishPaymentAction(v.token, r.paymentIntent!.id);
    setBusy(false);
    if (!done.ok) return onError(done.error);
    onPaid({ number: done.data!.paymentNumber, last4: done.data!.last4, brand: done.data!.brand });
  }
  return (
    <div className="mt-6 flex flex-col gap-5">
      <PaymentElement onReady={() => setReady(true)} options={{ layout: 'tabs' }} />
      <Button size="lg" icon={<Lock className="size-4" />} className="!bg-[var(--qb)] !text-[var(--qon)]" disabled={!ready || !stripe} pending={busy} onClick={pay}>
        Pay {new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currency }).format(intent.amountCents / 100)}
      </Button>
    </div>
  );
}

// --- summary & done -----------------------------------------------------------------------------------

function Summary({ view: v }: { view: QuoteView }) {
  return (
    <aside className="anim-rise self-start rounded-[var(--radius-panel)] border border-subtle bg-surface p-5 sm:p-6 lg:sticky lg:top-6" style={{ ['--d' as string]: '80ms' }}>
      <h2 className="text-lg font-semibold text-fg">Summary</h2>
      <dl className="mt-3 flex flex-col gap-2 text-[15px]">
        {v.order.summary.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-fg-2">{r.label}</dt>
            <dd className={cx('mono', r.tone === 'credit' ? 'text-success-fg' : 'text-fg')}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="my-4 border-t border-subtle" />
      <div className="flex items-baseline justify-between">
        <span className="font-semibold text-fg">Total</span>
        <span className="mono text-[26px] font-bold text-fg">{v.order.dueAfterCredits ?? v.order.total}</span>
      </div>
      <div className="mt-3 flex items-baseline justify-between rounded-[var(--radius-card)] px-4 py-3" style={{ background: 'color-mix(in srgb, var(--qb) 12%, transparent)' }}>
        <span className="font-semibold" style={{ color: 'var(--qb)' }}>{v.state === 'balance' ? 'Due now' : 'Deposit to book'}</span>
        <span className="mono font-bold" style={{ color: 'var(--qb)' }}>{v.due.amount}</span>
      </div>
      {v.state === 'quote' && <p className="mt-3 text-[13px] text-fg-2">{v.order.depositCents > 0 ? `Balance of ${v.order.balance} on the event day, or pay ${v.order.full} in full.` : `${v.order.full} due on the event day, or pay in full now.`}</p>}
      <p className="mt-3 text-[13px] text-fg-2">
        {v.order.validUntil && v.state === 'quote' ? `Quote valid until ${v.order.validUntil}. ` : ''}Questions? Reply to the email{v.brand.phone ? ` or call ${v.brand.phone}` : ''}.
      </p>
    </aside>
  );
}

function Done({ view: v, paid }: { view: QuoteView; paid: { number: string; last4: string | null; brand: string | null } | null }) {
  const last = v.payments[v.payments.length - 1];
  const receipt = paid?.number || last?.number;
  const last4 = paid?.last4 ?? last?.last4 ?? v.card?.last4;
  const doc = (d: string, extra = '') => `/q/${v.token}/print?doc=${d}${extra}`;
  return (
    <div className="anim-rise mx-auto max-w-2xl rounded-[var(--radius-panel)] border border-subtle bg-surface p-6 text-center sm:p-10">
      <span className="anim-pop mx-auto grid size-16 place-items-center rounded-full bg-success text-white"><Check className="size-8" strokeWidth={3} /></span>
      <h1 className="mt-5 font-display text-[30px] font-extrabold tracking-tight text-fg">You’re booked, {v.firstName}!</h1>
      <p className="mt-2 text-fg-2">{v.order.dateLong} · {v.order.timeRange} · {v.order.where}</p>
      <dl className="mx-auto mt-6 max-w-sm divide-y divide-subtle rounded-[var(--radius-card)] border border-subtle text-left text-[15px]">
        {receipt && <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-fg-2">Paid{last4 ? ` · card ending ${last4}` : ''}</dt><dd className="mono font-semibold text-fg">{last?.amount ?? v.order.paid}</dd></div>}
        <div className="flex justify-between gap-3 px-4 py-3">
          <dt className="text-fg-2">Balance{v.order.balanceDue ? ` · ${v.order.autoCharge ? 'charged' : 'due'} ${v.order.balanceDue}` : ''}</dt>
          <dd className="mono font-semibold text-fg">{v.order.balance}</dd>
        </div>
        {receipt && <div className="flex justify-between gap-3 px-4 py-3"><dt className="text-fg-2">Receipt</dt><dd className="mono text-fg">{receipt}</dd></div>}
      </dl>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {receipt && <a href={doc('receipt', `&n=${encodeURIComponent(receipt)}`)} target="_blank" rel="noreferrer" className="press inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-semibold text-fg hover:bg-hover"><Download className="size-4" /> Receipt</a>}
        {v.signature && <a href={doc('agreement')} target="_blank" rel="noreferrer" className="press inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-semibold text-fg hover:bg-hover"><FileSignature className="size-4" /> Signed agreement</a>}
        <a href={`/q/${v.token}/calendar.ics`} className="press inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-semibold text-fg hover:bg-hover"><CalendarPlus className="size-4" /> Add to calendar</a>
      </div>
      <p className="mt-6 flex items-center justify-center gap-4 text-[13px] text-fg-2">
        <span className="flex items-center gap-1"><MapPin className="size-3.5" /> {v.order.address || v.order.where}</span>
        {v.brand.phone && <a href={`tel:${v.brand.phone}`} className="flex items-center gap-1 hover:underline"><Phone className="size-3.5" /> {v.brand.phone}</a>}
      </p>
    </div>
  );
}
