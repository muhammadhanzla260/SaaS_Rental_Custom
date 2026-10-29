import type { ReactNode } from 'react';
import type { InvoiceDocData } from '@/lib/invoice-doc';
import { cx } from '@/components/kit';

/** The invoice as the customer receives it (screen preview and print). */
export function InvoiceDocument({ doc, children, className }: { doc: InvoiceDocData; children?: ReactNode; className?: string }) {
  const paidPct = doc.amountCents ? Math.min(100, Math.round((doc.paidCents / doc.amountCents) * 100)) : 0;
  return (
    <article className={cx('flex flex-col gap-5', className)} aria-label={`${doc.kindLabel} ${doc.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {doc.brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.brand.logoUrl} alt="" className="size-12 rounded-[12px] border border-subtle object-contain p-0.5" />
          ) : (
            <span className="grid size-12 shrink-0 place-items-center rounded-[12px] font-bold" style={{ background: doc.brand.color, color: doc.brand.onColor }}>{doc.brand.initials}</span>
          )}
          <span className="min-w-0">
            <span className="block truncate font-semibold text-fg">{doc.brand.name}</span>
            <span className="block truncate text-[13px] text-fg-2">{doc.brand.place}</span>
          </span>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-2">{doc.kindLabel}</p>
          <p className="mono text-lg font-bold text-fg">{doc.number}</p>
        </div>
      </header>
      <div className="flex flex-wrap justify-between gap-3 text-[14px]">
        <div>
          <p className="text-fg-2">Bill to</p>
          <p className="font-semibold text-fg">{doc.billTo.name}</p>
          {doc.billTo.email && <p className="text-fg-2">{doc.billTo.email}</p>}
        </div>
        <div className="text-right text-fg-2">
          <p>Order <span className="mono">{doc.orderNumber}</span></p>
          <p>Issued {doc.issued} · Due {doc.due}{doc.autoCharge && doc.status !== 'paid' ? ' · auto-charge' : ''}</p>
        </div>
      </div>
      <dl className="flex flex-col gap-2.5 border-y border-subtle py-4 text-[14px]">
        {doc.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-4">
            <dt className={cx(l.value ? 'text-fg' : 'text-fg-2')}>{l.label}</dt>
            {l.value && <dd className={cx('mono shrink-0', l.tone === 'credit' ? 'text-success-fg' : 'text-fg')}>{l.value}</dd>}
          </div>
        ))}
      </dl>
      <dl className="flex flex-col gap-1.5">
        <div className="flex justify-between"><dt className="font-semibold text-fg">Invoice total</dt><dd className="mono font-semibold text-fg">{doc.total}</dd></div>
        <div className="flex justify-between text-success-fg"><dt>Paid</dt><dd className="mono">{doc.paid}</dd></div>
        <div className="flex items-baseline justify-between">
          <dt className="text-lg font-bold text-fg">Amount due</dt>
          <dd className={cx('mono text-lg font-bold', doc.dueCents > 0 ? 'text-danger' : 'text-success-fg')}>{doc.amountDue}</dd>
        </div>
      </dl>
      <div className="h-1.5 overflow-hidden rounded-full bg-control" role="progressbar" aria-valuenow={paidPct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid">
        <span className="block h-full rounded-full bg-success transition-[width] duration-700" style={{ width: `${paidPct}%` }} />
      </div>
      {children}
    </article>
  );
}
