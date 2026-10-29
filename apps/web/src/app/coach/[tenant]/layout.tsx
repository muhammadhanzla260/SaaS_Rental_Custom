import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, themeCss, type Corners } from '@rental/core';
import { TenantThemeDefault } from '@/components/theme';
import { themeScript } from '@/lib/theme-script';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { PortalChrome } from './portal-chrome';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await getTenantContext((await params).tenant);
  return { title: { default: `${tenant.name} · Coach Portal`, template: `%s · ${tenant.name} Coach Portal` } };
}

/** The coach portal (phone first, 390 × 844): its own chrome, no staff sidebar. */
export default async function CoachLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  // Staff use the staff app; a support session may look at the portal.
  if (!ctx.impersonation && !can(ctx.role, 'coach.portal', ctx.membership?.permissions ?? [])) redirect(`/${slug}`);
  const { tenant } = ctx;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(tenant.brandColor, tenant.radius as Corners) }} />
      <TenantThemeDefault mode={tenant.themeMode} />
      <script dangerouslySetInnerHTML={{ __html: themeScript(tenant.themeMode) }} />
      <PortalChrome
        slug={slug}
        orgName={tenant.name}
        logoUrl={fileUrl(tenant.id, tenant.logoFileId)}
        user={{ name: ctx.user.name, image: ctx.user.image ?? null }}
        readOnly={ctx.readOnly}
      >
        {children}
      </PortalChrome>
    </>
  );
}
