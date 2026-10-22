import { getTenantContext } from '@/server/context';
import { BookingForm } from '../forms';

export const metadata = { title: 'Booking rules' };

export default async function BookingSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant, prefs } = await getTenantContext(slug);
  return <BookingForm slug={slug} initial={prefs.booking} currency={tenant.currency} distanceUnit={prefs.formats.distanceUnit} />;
}
