import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { listLocations } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { LocationForm } from '../../forms';

export const metadata = { title: 'Add location' };

export default async function NewLocation({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, prefs } = await getTenantContext(slug);
  // New locations search near the primary one (or the business address).
  const primary = (await listLocations(db, tenant.id)).find((l) => l.isPrimary && l.lat != null);
  const near = primary ? { lat: primary.lat!, lng: primary.lng! } : tenant.lat != null && tenant.lng != null ? { lat: tenant.lat, lng: tenant.lng } : null;
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${slug}/settings/locations`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All locations
      </Link>
      <h2 className="text-2xl font-bold">New location</h2>
      <LocationForm
        slug={slug}
        id={null}
        country={tenant.country}
        near={near}
        initial={{
          location: {
            name: '', code: '', timezone: '', phone: '', email: '', loadingNotes: '', isPrimary: false, isActive: true,
            address: { country: tenant.country },
          },
          taxPercent: prefs.booking.defaultTaxPercent,
        }}
      />
    </div>
  );
}
