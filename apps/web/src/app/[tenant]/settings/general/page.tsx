import { listLocations } from '@rental/db';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { ProfileForm } from '../forms';
import { profileValues } from '../mappers';

export const metadata = { title: 'Business profile' };

export default async function GeneralSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await getTenantContext(slug);
  const primary = (await listLocations(db, tenant.id)).find((l) => l.isPrimary);
  const point = primary?.lat != null && primary.lng != null ? { lat: primary.lat, lng: primary.lng } : null;
  return <ProfileForm slug={slug} initial={profileValues(tenant)} point={point} />;
}
