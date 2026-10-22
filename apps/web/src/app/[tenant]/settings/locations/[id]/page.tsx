import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getLocation } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { LocationForm } from '../../forms';
import { locationValues } from '../../mappers';

export const metadata = { title: 'Location' };

export default async function EditLocation({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { tenant } = await getTenantContext(slug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const loc = await getLocation(db, tenant.id, id);
  if (!loc) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${slug}/settings/locations`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All locations
      </Link>
      <h2 className="text-2xl font-bold">{loc.name}</h2>
      <LocationForm
        key={loc.updatedAt.toISOString()}
        slug={slug}
        id={loc.id}
        country={tenant.country}
        canDelete={!loc.isPrimary}
        initial={locationValues(loc, loc.taxRate?.rate, tenant.country)}
      />
    </div>
  );
}
