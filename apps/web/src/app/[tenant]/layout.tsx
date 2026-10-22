import type { Metadata } from 'next';
import { themeCss, type RadiusOption } from '@rental/core';
import { listUserTenants } from '@rental/db';
import { AppShell } from '@/components/app-shell';
import { TenantThemeDefault } from '@/components/theme';
import { themeScript } from '@/lib/theme-script';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await getTenantContext((await params).tenant);
  return { title: { default: tenant.name, template: `%s · ${tenant.name}` } };
}

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  const orgs = await listUserTenants(db, ctx.user.id);
  const { tenant } = ctx;
  return (
    <>
      {/* Tenant brand colours for light and dark mode. */}
      <style dangerouslySetInnerHTML={{ __html: themeCss(tenant.brandColor, tenant.radius as RadiusOption) }} />
      <TenantThemeDefault mode={tenant.themeMode} />
      <script dangerouslySetInnerHTML={{ __html: themeScript(tenant.themeMode) }} />
      <AppShell
        slug={slug}
        tenant={{
          name: tenant.name,
          logoUrl: fileUrl(tenant.id, tenant.logoFileId),
          logoDarkUrl: fileUrl(tenant.id, tenant.logoDarkFileId),
        }}
        user={{ name: ctx.user.name, email: ctx.user.email }}
        role={ctx.role}
        canManageSettings={ctx.canManageSettings}
        orgs={orgs.map((o) => ({ slug: o.slug, name: o.name, brandColor: o.brand_color }))}
      >
        {children}
      </AppShell>
    </>
  );
}
