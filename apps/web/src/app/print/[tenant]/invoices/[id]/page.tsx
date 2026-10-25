import { notFound } from 'next/navigation';
import { themeCss, type Corners } from '@rental/core';
import { getInvoice } from '@rental/db';
import { InvoiceDocument } from '@/components/money/invoice-doc';
import { PrintShell } from '@/components/money/print-shell';
import { invoiceDoc } from '@/lib/invoice-doc';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invoice', robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staff-side printable invoice (outside the app shell so it prints clean). */
export default async function InvoicePrintPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await pageContext(slug, 'orders.view');
  if (!UUID.test(id)) notFound();
  const detail = await getInvoice(db, ctx.tenant.id, id);
  if (!detail) notFound();
  const doc = invoiceDoc(detail, ctx.tenant);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(ctx.tenant.brandColor, ctx.tenant.radius as Corners) }} />
      <PrintShell title={`${doc.kindLabel} ${doc.number}`}>
        <InvoiceDocument doc={doc}>
          {doc.schedule.length > 1 && (
            <section className="border-t border-subtle pt-4">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-fg-2">Payment schedule</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-[14px]">
                {doc.schedule.map((s) => (
                  <li key={s.id} className="flex flex-wrap justify-between gap-x-4">
                    <span className={s.selected ? 'font-semibold text-fg' : 'text-fg'}>{s.label}</span>
                    <span className="text-fg-2">{s.note}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </InvoiceDocument>
      </PrintShell>
    </>
  );
}
