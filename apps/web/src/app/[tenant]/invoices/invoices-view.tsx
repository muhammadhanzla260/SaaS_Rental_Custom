'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Clock, Copy, Mail, Printer, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { InvoiceDocument } from '@/components/money/invoice-doc';
import {
  Button, Card, cx, Drawer, EmptyState, Field, FilterChips, Input, Kpi, Modal, Notice, Pill, Select, Spinner, Tabs, Toggle, useToast,
} from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import type { InvoiceDocData } from '@/lib/invoice-doc';
import { emailInvoiceAction, quoteLinkAction, recordInvoicePaymentAction, setAutoChargeAction } from '@/server/actions/money';

export type InvoiceRow = { id: string; number: string; kindLabel: string; customer: string; orderNumber: string; amount: string; status: string; sub: string };
export type PaymentRow = {
  id: string; number: string; customer: string; orderNumber: string; invoiceNumber: string | null; method: string; gateway: string | null; amount: string; tip: string | null;
  steps: Record<string, string>; status: string; at: string;
};

const STATUS: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }> = {
  paid: { tone: 'success', label: 'Paid' }, open: { tone: 'warning', label: 'Unpaid' }, partial: { tone: 'info', label: 'Part paid' }, overdue: { tone: 'danger', label: 'Overdue' },
  void: { tone: 'neutral', label: 'Void' },
};

export function InvoicesView({
  slug, tab, filter, q, rows, counts, kpis, doc, explicit, payments, currency, timezone, canRecord,
}: {
  slug: string; tab: 'invoices' | 'payments'; filter: string; q: string; rows: InvoiceRow[]; counts: Record<'all' | 'open' | 'overdue' | 'paid', number>;
  kpis: { outstanding: string; overdue: string; autoChargesWeek: string; collectedMonth: string }; doc: InvoiceDocData | null; explicit: boolean;
  payments: PaymentRow[]; currency: string; timezone: string; canRecord: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  const [narrow, setNarrow] = useState(false);
  const [paying, setPaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const m = window.matchMedia('(max-width: 1279px)');
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  useEffect(() => {
    if (search === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: search.trim() || null, id: null }), 250);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const panel = doc && <InvoicePanel slug={slug} doc={doc} canRecord={canRecord} onPay={() => setPaying(true)} />;

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Invoices & payments' }]}
        actions={
          <>
            <Link href={`/${slug}/settings/messaging`} className="press inline-flex h-9 items-center rounded-[var(--radius-control)] border border-control bg-surface px-3 text-sm font-semibold text-fg hover:bg-hover max-sm:hidden">Email settings</Link>
            {canRecord && doc && doc.dueCents > 0 && <Button size="sm" onClick={() => setPaying(true)}>Record payment</Button>}
          </>
        }
      />
      <PageBody wide>
        <h1 className="mb-5 font-display text-[32px] font-extrabold tracking-tight text-fg sm:text-4xl">Invoices &amp; payments</h1>
        <Tabs
          label="Invoices and payments"
          value={tab}
          tabs={[
            { value: 'invoices', label: 'Invoices', href: `/${slug}/invoices` },
            { value: 'payments', label: 'Payments', href: `/${slug}/invoices?tab=payments` },
          ]}
          className="mb-5"
        />
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Outstanding" value={kpis.outstanding} />
          <Kpi label="Overdue" value={kpis.overdue} tone="danger" style={{ ['--d' as string]: '40ms' }} />
          <Kpi label="Auto-charges this week" value={kpis.autoChargesWeek} tone="info" style={{ ['--d' as string]: '80ms' }} />
          <Kpi label="Collected this month" value={kpis.collectedMonth} tone="success" style={{ ['--d' as string]: '120ms' }} />
        </div>

        {tab === 'payments' ? (
          <PaymentsTable rows={payments} timezone={timezone} />
        ) : (
          <div className={cx('grid grid-cols-1 gap-6', doc && 'xl:grid-cols-[minmax(0,1fr)_500px]')}>
            <div className="min-w-0">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
                  <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, order or customer" aria-label="Search invoices" className="pl-9" />
                  {pending && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" />}
                </div>
                <FilterChips
                  label="Show"
                  value={filter}
                  onChange={(f) => go({ f: f === 'all' ? null : f, id: null })}
                  chips={[
                    { value: 'all', label: 'All', count: counts.all },
                    { value: 'open', label: 'Open', count: counts.open },
                    { value: 'overdue', label: 'Overdue', count: counts.overdue },
                    { value: 'paid', label: 'Paid', count: counts.paid },
                  ]}
                />
              </div>
              <Card className={cx('overflow-hidden transition-opacity', pending && 'opacity-70')}>
                {rows.length === 0 ? (
                  <EmptyState
                    title={q || filter !== 'all' ? 'No invoices match' : 'No invoices yet'}
                    sub={q || filter !== 'all' ? 'Try a different search or filter.' : 'Invoices appear when an order is booked: a deposit invoice, then the balance due on the event day.'}
                  />
                ) : (
                  <ul className="divide-y divide-subtle">
                    {rows.map((r, i) => {
                      const on = r.id === doc?.id && (explicit || !narrow);
                      const st = STATUS[r.status] ?? STATUS.open!;
                      return (
                        <li key={r.id} className="anim-rise" style={{ ['--d' as string]: `${Math.min(i, 12) * 25}ms` }}>
                          <button
                            type="button"
                            onClick={() => go({ id: r.id })}
                            aria-current={on || undefined}
                            className={cx(
                              'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-l-[3px] px-5 py-3.5 text-left transition-colors md:grid-cols-[150px_minmax(0,1fr)_110px_110px]',
                              on ? 'border-accent bg-accent-soft/30' : 'border-transparent hover:bg-hover',
                            )}
                          >
                            <span className="min-w-0">
                              <span className="mono block font-bold text-fg">{r.number}</span>
                              <span className="block text-[13px] text-fg-2">{r.kindLabel}</span>
                            </span>
                            <span className="mono text-right font-semibold text-fg md:hidden">{r.amount}</span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-fg">{r.customer}</span>
                              <span className="block truncate text-[13px] text-fg-2">{r.sub}</span>
                            </span>
                            <span className="mono font-semibold text-fg max-md:hidden">{r.amount}</span>
                            <span className="max-md:text-right"><Pill tone={st.tone}>{st.label}</Pill></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
            {doc && !narrow && <div className="anim-slide hidden self-start xl:sticky xl:top-24 xl:block">{panel}</div>}
          </div>
        )}
      </PageBody>

      {narrow && tab === 'invoices' && (
        <Drawer open={!!doc && explicit} onClose={() => go({ id: null })} title={doc?.number ?? ''} sub={doc?.kindLabel} width={560}>
          {panel}
        </Drawer>
      )}
      {doc && <RecordPaymentModal key={doc.id + doc.paidCents} slug={slug} doc={doc} currency={currency} open={paying} onClose={() => setPaying(false)} />}
    </>
  );
}

function InvoicePanel({ slug, doc, canRecord, onPay }: { slug: string; doc: InvoiceDocData; canRecord: boolean; onPay: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const sent = doc.sentAt ? new Date(doc.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5 shadow-[var(--shadow-lift)] sm:p-7">
        <InvoiceDocument doc={doc}>
          {doc.lastChargeError && doc.status === 'overdue' && <Notice kind="danger"><TriangleAlert className="mr-1 inline size-4" />Auto-charge failed: {doc.lastChargeError}</Notice>}
          <div className="flex flex-wrap gap-2">
            {canRecord && (
              <Button icon={<Mail className="size-4" />} pending={busy === 'email'} onClick={async () => {
                setBusy('email');
                const r = await emailInvoiceAction(slug, doc.id);
                setBusy(null);
                toast(r.ok ? r.message ?? 'Sent.' : r.error, r.ok ? 'ok' : 'error');
                if (r.ok) router.refresh();
              }}>{doc.sentAt ? 'Resend' : 'Email invoice'}</Button>
            )}
            {canRecord && doc.dueCents > 0 && <Button variant="secondary" onClick={onPay}>Record payment</Button>}
            <a href={`/print/${slug}/invoices/${doc.id}`} target="_blank" rel="noreferrer" className="press inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-control bg-surface px-4 text-sm font-semibold text-fg hover:bg-hover">
              <Printer className="size-4" /> PDF
            </a>
            <Button variant="ghost" icon={<Copy className="size-4" />} pending={busy === 'link'} onClick={async () => {
              setBusy('link');
              const r = await quoteLinkAction(slug, doc.orderId);
              setBusy(null);
              if (!r.ok) return toast(r.error, 'error');
              try { await navigator.clipboard.writeText(r.data!.url); toast('Pay link copied.', 'ok'); } catch { window.prompt('Copy the pay link', r.data!.url); }
            }}>Pay link</Button>
          </div>
          <p className="text-[13px] text-fg-2">
            {sent ? `Last emailed ${sent}` : 'Not emailed yet'} · <Link href={`/${slug}/orders/${doc.orderId}`} className="font-semibold text-accent-text hover:underline">Open order {doc.orderNumber}</Link>
          </p>
        </InvoiceDocument>
      </Card>
      <Schedule slug={slug} doc={doc} canRecord={canRecord} />
    </div>
  );
}

function Schedule({ slug, doc, canRecord }: { slug: string; doc: InvoiceDocData; canRecord: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base font-bold text-fg">Payment schedule · <span className="mono font-semibold">{doc.orderNumber}</span></h2>
      <ul className="mt-4 flex flex-col gap-3">
        {doc.schedule.map((s) => {
          const paid = s.status === 'paid';
          const over = s.status === 'overdue';
          const canAuto = (s.kind === 'balance' || s.kind === 'full') && !paid;
          return (
            <li key={s.id} className={cx('flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-sunken/60 p-4', s.selected && 'ring-1 ring-accent/40')}>
              <span className={cx('grid size-10 shrink-0 place-items-center rounded-full', paid ? 'bg-success-bg text-success-fg' : over ? 'bg-danger-bg text-danger' : 'bg-accent-soft text-accent-text')}>
                {paid ? <Check className="size-5" /> : over ? <TriangleAlert className="size-5" /> : <Clock className="size-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="mono block font-semibold text-fg">{s.label}</span>
                <span className="block text-[13px] text-fg-2">{s.note}</span>
              </span>
              {canAuto && canRecord && (
                <span className="flex items-center gap-2">
                  {busy === s.id && <Spinner className="size-4 text-fg-2" />}
                  <Toggle checked={s.autoCharge} label="Auto-charge" disabled={busy === s.id} onChange={async (on) => {
                    setBusy(s.id);
                    const r = await setAutoChargeAction(slug, s.id, on);
                    setBusy(null);
                    toast(r.ok ? r.message ?? 'Saved.' : r.error, r.ok ? 'ok' : 'error');
                    if (r.ok) router.refresh();
                  }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {doc.schedule.some((s) => s.autoCharge && s.status !== 'paid') && !doc.card && (
        <p className="mt-3 text-[13px] text-fg-2">No card on file yet. The customer saves one when paying the deposit on the quote page.</p>
      )}
    </Card>
  );
}

// --- record payment ---------------------------------------------------------------------------------------

function RecordPaymentModal({ slug, doc, currency, open, onClose }: { slug: string; doc: InvoiceDocData; currency: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const methods = [
    ...(doc.card?.last4 ? [{ value: 'card_on_file', label: `Card on file · ${(doc.card.brand ?? 'card').toUpperCase()} •${doc.card.last4}` }] : []),
    { value: 'pay_link', label: 'Send a pay link (new card)' },
    { value: 'cash', label: 'Cash' }, { value: 'check', label: 'Check' }, { value: 'zelle', label: 'Zelle' }, { value: 'venmo', label: 'Venmo' },
    { value: 'ach', label: 'ACH / bank transfer' }, { value: 'other', label: 'Other' },
  ];
  const [f, setF] = useState({ method: methods[0]!.value, amount: (doc.dueCents / 100).toFixed(2), tip: '', reference: '', receipt: true });
  const [state, setState] = useState<'form' | 'busy' | 'done'>('form');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState('');
  useEffect(() => { if (open) { setState('form'); setErr(null); } }, [open]);
  const link = f.method === 'pay_link';
  const card = f.method === 'card_on_file';
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  const total = (Number(f.amount) || 0) + (Number(f.tip) || 0);

  async function submit() {
    setErr(null);
    setState('busy');
    const r = await recordInvoicePaymentAction(slug, { invoiceId: doc.id, method: f.method, amount: link ? doc.dueCents / 100 : f.amount, tip: f.tip || 0, reference: f.reference || undefined, receipt: f.receipt });
    if (!r.ok) {
      setState('form');
      return setErr(r.fieldErrors ? Object.values(r.fieldErrors)[0]! : r.error);
    }
    setDone(r.message ?? 'Done.');
    setState('done');
    router.refresh();
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={state === 'done' ? (link ? 'Pay link sent' : 'Payment recorded') : `Record payment · ${doc.number}`}
      sub={state === 'done' ? undefined : `${doc.billTo.name} · ${doc.amountDue} due`}
      footer={
        state === 'done' ? <Button onClick={onClose}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={state === 'busy'}>Cancel</Button>
            <Button pending={state === 'busy'} onClick={submit}>{link ? 'Email pay link' : card ? `Charge ${fmt(total)}` : `Record ${fmt(total)}`}</Button>
          </>
        )
      }
    >
      {state === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="anim-pop grid size-14 place-items-center rounded-full bg-success text-white"><Check className="size-7" strokeWidth={3} /></span>
          <p className="text-fg">{done}</p>
          {!link && f.receipt && <p className="text-[13px] text-fg-2">The receipt is on its way to the customer.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Method" htmlFor="rp-method">
            <Select id="rp-method" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          {link ? (
            <Notice>We email {doc.billTo.email ?? 'the customer'} a secure link to pay {doc.amountDue} by card. The invoice updates by itself when they pay.</Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount" htmlFor="rp-amount" hint="Partial is fine.">
                  <Input id="rp-amount" mono inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                </Field>
                <Field label="Tip" htmlFor="rp-tip" optional>
                  <Input id="rp-tip" mono inputMode="decimal" value={f.tip} placeholder="0.00" onChange={(e) => setF({ ...f, tip: e.target.value })} />
                </Field>
              </div>
              {!card && (
                <Field label={f.method === 'check' ? 'Check number' : 'Reference'} htmlFor="rp-ref" optional>
                  <Input id="rp-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
                </Field>
              )}
              <Toggle checked={f.receipt} onChange={(v) => setF({ ...f, receipt: v })} label="Send receipt" sub="Emails the customer a receipt straight away." />
              {Number(f.amount) * 100 > doc.dueCents + 0.5 && <Notice kind="warning">That is more than is due. The extra becomes an overpayment you can move to the customer’s wallet from the order.</Notice>}
            </>
          )}
          {err && <Notice kind="danger">{err}</Notice>}
        </div>
      )}
    </Modal>
  );
}

// --- payments tab -----------------------------------------------------------------------------------------

const STEP_ORDER = [['authorizedAt', 'Authorised'], ['capturedAt', 'Captured'], ['fundedAt', 'Funded']] as const;

function PaymentsTable({ rows, timezone }: { rows: PaymentRow[]; timezone: string }) {
  if (rows.length === 0) return <Card><EmptyState title="No payments yet" sub="Deposits paid on the quote page, event-day charges and payments you record all land here." /></Card>;
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timezone });
  return (
    <Card className="overflow-hidden">
      <div className="hidden gap-4 border-b border-subtle bg-sunken/60 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-fg-2 lg:grid lg:grid-cols-[150px_minmax(0,1fr)_150px_110px_80px_minmax(0,1.2fr)_100px]">
        <span>Receipt</span><span>Customer</span><span>Method</span><span>Amount</span><span>Tip</span><span>Gateway</span><span>Status</span>
      </div>
      <ul className="divide-y divide-subtle">
        {rows.map((p, i) => (
          <li key={p.id} className="anim-rise grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3.5 lg:grid-cols-[150px_minmax(0,1fr)_150px_110px_80px_minmax(0,1.2fr)_100px]" style={{ ['--d' as string]: `${Math.min(i, 12) * 20}ms` }}>
            <span className="min-w-0">
              <span className="mono block font-bold text-fg">{p.number}</span>
              <span className="block text-[13px] text-fg-2">{when(p.at)}</span>
            </span>
            <span className="mono text-right font-semibold text-fg lg:hidden">{p.amount}</span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-fg">{p.customer}</span>
              <span className="mono block truncate text-[13px] text-fg-2">{p.orderNumber}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}</span>
            </span>
            <span className="mono text-sm text-fg max-lg:text-right">{p.method}</span>
            <span className="mono font-semibold text-fg max-lg:hidden">{p.amount}</span>
            <span className="mono text-sm text-fg-2 max-lg:hidden">{p.tip ?? '—'}</span>
            <span className="flex flex-wrap items-center gap-1 text-[12px] max-lg:col-span-2">
              {p.gateway && p.gateway !== 'manual' ? STEP_ORDER.map(([k, label], j) => (
                <span key={k} className="flex items-center gap-1">
                  {j > 0 && <span className="text-fg-3" aria-hidden>→</span>}
                  <span className={cx('rounded-full px-2 py-0.5 font-semibold', p.steps[k] ? 'bg-success-bg text-success-fg' : 'bg-sunken text-fg-3')} title={p.steps[k] ? when(p.steps[k]!) : 'Pending'}>{label}</span>
                </span>
              )) : <span className="text-fg-2">Recorded by staff</span>}
            </span>
            <span className="max-lg:hidden"><Pill tone={p.status === 'received' ? 'success' : p.status === 'refunded' ? 'neutral' : 'warning'}>{p.status === 'received' ? 'Received' : p.status}</Pill></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
