import { notFound } from 'next/navigation';
import { agreementSections, checkAccent, formatMoney, formatPhone, resolveAgreement } from '@rental/core';
import { quoteContext, resolveOrderToken, type QuoteContext } from '@rental/db';
import { PrintShell } from '@/components/money/print-shell';
import { INVOICE_KIND } from '@/lib/invoice-doc';
import { orderSummaryRows } from '@/lib/order-summary';
import { fileUrl } from '@/lib/urls';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your documents', robots: { index: false, follow: false } };

const METHOD: Record<string, string> = { cash: 'Cash', check: 'Check', zelle: 'Zelle', venmo: 'Venmo', ach: 'ACH', link: 'Payment link', other: 'Other', card: 'Card' };

/** The customer's receipt (?doc=receipt&n=PAY-…) or signed agreement (?doc=agreement), from the quote link. */
export default async function QuotePrintPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ doc?: string; n?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ref = await resolveOrderToken(db, token);
  if (!ref) notFound();
  const q = await quoteContext(db, ref.tenantId, ref.orderId);
  if (!q) notFound();
  const tz = q.location.timezone || q.tenant.timezone;
  const at = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d);

  if (sp.doc === 'agreement') {
    if (!q.signature) notFound();
    return (
      <PrintShell title={`Signed agreement · ${q.order.number}`}>
        <Agreement q={q} at={at} />
      </PrintShell>
    );
  }
  const pay = sp.n ? q.payments.find((p) => p.number === sp.n) : q.payments.at(-1);
  if (!pay) notFound();
  return (
    <PrintShell title={`Receipt ${pay.number}`}>
      <Receipt q={q} pay={pay} at={at} />
    </PrintShell>
  );
}

function Letterhead({ q, kind, number }: { q: QuoteContext; kind: string; number: string }) {
  const color = q.tenant.brandColor || '#2C4FE0';
  const logo = fileUrl(q.tenant.id, q.tenant.logoFileId);
  const phone = formatPhone(q.location.phone ?? q.tenant.phone, q.tenant.country);
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="size-12 rounded-[12px] border border-subtle object-contain p-0.5" />
        ) : (
          <span className="grid size-12 shrink-0 place-items-center rounded-[12px] font-bold" style={{ background: color, color: checkAccent(color).onAccent }}>
            {q.tenant.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate font-semibold text-fg">{q.tenant.name}</span>
          <span className="block truncate text-[13px] text-fg-2">{[q.location.name, phone].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      <div className="text-right">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-2">{kind}</p>
        <p className="mono text-lg font-bold text-fg">{number}</p>
      </div>
    </header>
  );
}

function Receipt({ q, pay, at }: { q: QuoteContext; pay: QuoteContext['payments'][number]; at: (d: Date) => string }) {
  const money = (c: number) => formatMoney(c, q.tenant.currency);
  const o = q.order;
  const inv = q.invoices.find((i) => i.id === pay.invoiceId);
  const paidToDate = q.payments.filter((p) => p.receivedAt <= pay.receivedAt).reduce((s, p) => s + p.amountCents, 0);
  const method = pay.cardLast4 ? `${(pay.cardBrand ?? 'Card').toUpperCase()} ending ${pay.cardLast4}` : METHOD[pay.method] ?? pay.method;
  const rows: [string, string][] = [
    ['Paid on', at(pay.receivedAt)],
    ['Paid by', method],
    ['Order', o.number],
    ...(inv ? [['For', `${INVOICE_KIND[inv.kind] ?? 'Invoice'} ${inv.number}`] as [string, string]] : []),
    ['Event', new Intl.DateTimeFormat('en-US', { timeZone: q.location.timezone || q.tenant.timezone, dateStyle: 'full' }).format(o.eventStartsAt)],
  ];
  return (
    <article className="flex flex-col gap-5" aria-label={`Receipt ${pay.number}`}>
      <Letterhead q={q} kind="Payment receipt" number={pay.number} />
      <p className="text-[14px] text-fg-2">Received from <span className="font-semibold text-fg">{q.customer.displayName ?? 'Customer'}</span>{q.customer.email ? ` · ${q.customer.email}` : ''}</p>
      <dl className="flex flex-col gap-2.5 border-y border-subtle py-4 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-fg-2">{k}</dt><dd className="text-right text-fg">{v}</dd></div>
        ))}
      </dl>
      <dl className="flex flex-col gap-1.5">
        <div className="flex justify-between"><dt className="text-fg">Payment</dt><dd className="mono text-fg">{money(pay.amountCents)}</dd></div>
        {pay.tipCents > 0 && <div className="flex justify-between"><dt className="text-fg">Tip · thank you!</dt><dd className="mono text-fg">{money(pay.tipCents)}</dd></div>}
        <div className="flex items-baseline justify-between">
          <dt className="text-lg font-bold text-fg">Amount paid</dt>
          <dd className="mono text-lg font-bold text-success-fg">{money(pay.amountCents + pay.tipCents)}</dd>
        </div>
      </dl>
      <section className="rounded-[var(--radius-card)] border border-subtle p-4 text-[14px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-2">Order {o.number}</h2>
        <dl className="mt-2 flex flex-col gap-1.5">
          {orderSummaryRows(o, q.tenant.currency).map((r) => (
            <div key={r.label} className="flex justify-between gap-4"><dt className="text-fg-2">{r.label}</dt><dd className={r.tone === 'credit' ? 'mono text-success-fg' : 'mono text-fg'}>{r.value}</dd></div>
          ))}
          <div className="flex justify-between gap-4 border-t border-subtle pt-1.5 font-semibold"><dt className="text-fg">Order total</dt><dd className="mono text-fg">{money(o.totalCents)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-fg-2">Paid to date</dt><dd className="mono text-fg">{money(paidToDate)}</dd></div>
          <div className="flex justify-between gap-4 font-semibold"><dt className="text-fg">Balance remaining</dt><dd className="mono text-fg">{money(Math.max(0, o.totalCents - paidToDate))}</dd></div>
        </dl>
      </section>
    </article>
  );
}

function Agreement({ q, at }: { q: QuoteContext; at: (d: Date) => string }) {
  const s = q.signature!;
  // The signed text is the snapshot taken at signing ("title\n\nbody"), not today's settings.
  const [title, ...rest] = s.agreementText.split('\n\n');
  const sections = agreementSections(rest.join('\n\n'));
  const titles = Object.fromEntries(resolveAgreement(q.prefs.agreement).policies.map((p) => [p.key, p.title]));
  const accepted = Object.entries((s.policies ?? {}) as Record<string, string>);
  return (
    <article className="flex flex-col gap-5" aria-label="Signed rental agreement">
      <Letterhead q={q} kind="Rental agreement" number={q.order.number} />
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-fg">{title}</h1>
      <div className="flex flex-col gap-4 text-[14px] leading-relaxed text-fg">
        {sections.map((sec, i) => (
          <section key={i} className="break-inside-avoid">
            {sec.heading && <h2 className="mb-1 font-semibold">{sec.heading}</h2>}
            {sec.paragraphs.map((p, j) => <p key={j} className="text-fg-2">{p}</p>)}
          </section>
        ))}
      </div>
      <section className="break-inside-avoid rounded-[var(--radius-card)] border border-subtle p-4 text-[14px]">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-2">Signature</h2>
        <p className="mt-2 font-display text-2xl italic text-fg">{s.typedName}</p>
        <dl className="mt-3 flex flex-col gap-1.5">
          <div className="flex justify-between gap-4"><dt className="text-fg-2">Signed</dt><dd className="text-right text-fg">{at(s.signedAt)} · online</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-fg-2">Agreement version</dt><dd className="mono text-fg">{s.agreementVersion}</dd></div>
          {accepted.map(([k, when]) => (
            <div key={k} className="flex justify-between gap-4"><dt className="text-fg-2">Accepted · {titles[k] ?? k}</dt><dd className="text-right text-fg">{at(new Date(when))}</dd></div>
          ))}
          <div className="flex justify-between gap-4"><dt className="text-fg-2">Damage waiver</dt><dd className="text-fg">{s.waiverAccepted ? 'Accepted' : 'Declined'}</dd></div>
          {s.ip && <div className="flex justify-between gap-4"><dt className="text-fg-2">IP address</dt><dd className="mono text-fg">{s.ip}</dd></div>}
        </dl>
      </section>
    </article>
  );
}
