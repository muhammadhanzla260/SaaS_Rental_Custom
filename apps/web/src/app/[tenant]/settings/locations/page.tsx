import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatPhone } from '@rental/core';
import { listLocations } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { LocationCards } from './location-cards';

export const metadata = { title: 'Locations' };

export default async function LocationsSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await getTenantContext(slug);
  const locs = await listLocations(db, tenant.id);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-muted">Every place your equipment ships from: branches, warehouses, yards. Each has its own pin, time zone and tax rate.</p>
        <Link href={`/${slug}/settings/locations/new`}
          className="btn-shine inline-flex min-h-10 items-center gap-2 rounded-ui-sm bg-brand px-4 font-medium text-brand-fg shadow-[0_6px_16px_-8px_var(--brand)] transition-transform hover:bg-brand-strong active:scale-[0.97]">
          <Plus aria-hidden className="size-4" /> Add location
        </Link>
      </div>
      <LocationCards
        locations={locs.map((l) => ({
          id: l.id,
          href: `/${slug}/settings/locations/${l.id}`,
          name: l.name,
          code: l.code,
          address: [l.line1, l.city, l.region].filter(Boolean).join(', '),
          phone: formatPhone(l.phone, tenant.country),
          timezone: l.timezone.replace(/_/g, ' '),
          tax: Number(l.taxRate?.rate ?? 0),
          lat: l.lat,
          lng: l.lng,
          isPrimary: l.isPrimary,
          isActive: l.isActive,
        }))}
      />
    </div>
  );
}
