import Link from 'next/link';
import { Mail, Phone, Plus, UserRound } from 'lucide-react';
import { formatPhone } from '@rental/core';
import { listCustomers } from '@rental/db';
import { Stagger, StaggerItem } from '@/components/motion';
import { PageHeader } from '@/components/ui';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { SearchBox } from './search-box';

export const metadata = { title: 'Customers' };

export default async function CustomersPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ q?: string }> }) {
  const { tenant: slug } = await params;
  const { q = '' } = await searchParams;
  const { tenant } = await getTenantContext(slug);
  const rows = await listCustomers(db, tenant.id, q, 100);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: tenant.currency, maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone who has booked or asked for a quote."
        actions={
          <Link href={`/${slug}/customers/new`} className="btn-shine inline-flex min-h-10 items-center gap-2 rounded-ui-sm bg-brand px-4 font-medium text-brand-fg shadow-[0_6px_16px_-8px_var(--brand)] hover:bg-brand-strong">
            <Plus aria-hidden className="size-4" /> Add customer
          </Link>
        }
      />
      <div className="mb-4 max-w-md"><SearchBox initial={q} placeholder="Search name, company, email or phone" /></div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[calc(var(--radius)*1.4)] border border-dashed border-line-strong bg-surface p-10 text-center">
          <UserRound aria-hidden className="size-10 text-brand-text" />
          <p className="font-semibold">{q ? `No customers match "${q}".` : 'No customers yet.'}</p>
          <p className="text-muted">Customers are also added when you create an order.</p>
        </div>
      ) : (
        <Stagger as="ul" className="grid gap-3 md:grid-cols-2" gap={0.03}>
          {rows.map((c) => (
            <StaggerItem as="li" key={c.id}>
              <Link href={`/${slug}/customers/${c.id}`} className="flex items-center gap-4 rounded-ui border border-line bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-pop">
                <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded-full font-semibold text-brand-fg">
                  {(c.displayName ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.displayName}{c.companyName && c.firstName ? <span className="font-normal text-muted"> · {c.companyName}</span> : null}</span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                    {c.phone && <span className="inline-flex items-center gap-1"><Phone aria-hidden className="size-3.5" />{formatPhone(c.phone, tenant.country)}</span>}
                    {c.email && <span className="inline-flex min-w-0 items-center gap-1 truncate"><Mail aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{c.email}</span></span>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm">
                  <span className="block font-semibold tabular">{c.orderCount} {c.orderCount === 1 ? 'order' : 'orders'}</span>
                  <span className="block text-muted tabular">{c.bookedCents ? money.format(c.bookedCents / 100) : c.lastEventAt ? date.format(new Date(c.lastEventAt)) : 'New'}</span>
                </span>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}
