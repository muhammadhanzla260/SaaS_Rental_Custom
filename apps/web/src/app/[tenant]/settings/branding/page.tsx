import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { BrandingForm } from '../forms';

export const metadata = { title: 'Branding' };

export default async function BrandingSettings({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenant } = await getTenantContext(slug);
  return (
    <BrandingForm
      key={`${tenant.logoFileId}-${tenant.logoDarkFileId}`}
      slug={slug}
      name={tenant.name}
      initial={{ brandColor: tenant.brandColor, themeMode: tenant.themeMode, radius: tenant.radius }}
      logoUrl={fileUrl(tenant.id, tenant.logoFileId)}
      logoDarkUrl={fileUrl(tenant.id, tenant.logoDarkFileId)}
    />
  );
}
