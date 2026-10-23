import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import { formatEventTime, formatPhone, ORDER_STATUS, type OrderStatus } from '@rental/core';
import { getCustomer, listLocations } from '@rental/db';
import { Badge, Card } from '@/components/ui';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { CustomerForm } from '../customer-form';

export const metadata = { title: 'Customer' };

export default async function CustomerPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { tenant } = await getTenantContext(slug);
  const isNew = id === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [c, locs] = await Promise.all([isNew ? null : getCustomer(db, tenant.id, id), listLocations(db, tenant.id)]);
  if (!isNew && !c) notFound();
  const primary = locs.find((l) => l.isPrimary && l.lat != null);
  const near = primary ? { lat: primary.lat!, lng: primary.lng! } : null;
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: tenant.currency });

  const initial = c
    ? {
        kind: c.kind, firstName: c.firstName ?? '', lastName: c.lastName ?? '', companyName: c.companyName ?? '', email: c.email ?? '',
        phone: formatPhone(c.phone, tenant.country), phoneSecondary: formatPhone(c.phoneSecondary, tenant.country), source: c.source ?? '',
        notes: c.notes ?? '', smsOptIn: c.smsOptIn, taxExempt: c.taxExempt,
        address: { line1: c.line1 ?? '', line2: c.line2 ?? '', city: c.city ?? '', region: c.region ?? '', postalCode: c.postalCode ?? '', country: c.country, lat: c.lat ?? undefined, lng: c.lng ?? undefined },
      }
    : { kind: 'individual', firstName: '', lastName: '', companyName: '', email: '', phone: '', phoneSecondary: '', source: '', notes: '', smsOptIn: true, taxExempt: false, address: { country: tenant.country } };

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${slug}/customers`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Customers
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-[28px]">{c?.displayName ?? 'New customer'}</h1>
        {c && (
          <Link href={`/${slug}/orders/new?customer=${c.id}`} className="btn-shine inline-flex min-h-10 items-center gap-2 rounded-ui-sm bg-brand px-4 font-medium text-brand-fg shadow-[0_6px_16px_-8px_var(--brand)]">
            <Plus aria-hidden className="size-4" /> New order
          </Link>
        )}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <CustomerForm key={c?.updatedAt.toISOString() ?? 'new'} slug={slug} id={c?.id ?? null} initial={initial} country={tenant.country} near={near} />
        {c && (
          <Card title="Orders" description={`${c.orders.length} in total`} className="self-start">
            {c.orders.length === 0 ? (
              <p className="text-sm text-muted">No orders yet.</p>
            ) : (
              <ul className="-my-2 divide-y divide-line">
                {c.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/${slug}/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-text">
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold">{o.number}</span>
                        <span className="block truncate text-xs text-muted">{formatEventTime(o.eventStartsAt, o.eventStartsAt, tenant.timezone).split(' · ')[0]}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={ORDER_STATUS[o.status as OrderStatus].tone}>{ORDER_STATUS[o.status as OrderStatus].label}</Badge>
                        <span className="text-xs tabular">{money.format(o.totalCents / 100)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
