import { listLocations } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { BookingForm } from '../forms';
import { TravelCheck } from './travel-check';

export const metadata = { title: 'Booking rules' };

export default async function BookingSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, prefs } = await getTenantContext(slug);
  const origins = (await listLocations(db, tenant.id))
    .filter((l) => l.isActive && l.lat != null && l.lng != null)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((l) => ({ lat: l.lat!, lng: l.lng! }));
  return (
    <div className="flex flex-col gap-6">
      <TravelCheck
        slug={slug}
        country={tenant.country}
        currency={tenant.currency}
        origins={origins}
        radius={prefs.booking.serviceRadius}
        unit={prefs.formats.distanceUnit}
      />
      <BookingForm slug={slug} initial={prefs.booking} currency={tenant.currency} distanceUnit={prefs.formats.distanceUnit} />
    </div>
  );
}
