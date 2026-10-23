import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { getTenantContext } from '@/server/context';
import { SettingsNav } from './settings-nav';

export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!ctx.canManageSettings) redirect(`/${slug}`);
  return (
    <>
      <PageHeader title="Settings" description="Your business, brand, locations and team." />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <SettingsNav slug={slug} />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
