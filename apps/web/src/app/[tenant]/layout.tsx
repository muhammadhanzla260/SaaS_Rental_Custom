import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, FIELD_ROLES, ROLE_LABELS, themeCss, type Corners } from '@rental/core';
import { listUserTenants } from '@rental/db';
import { AppShell } from '@/components/shell/app-shell';
import { LiveRefresh } from '@/components/shell/live-refresh';
import { ORG_NAV, type NavGroup } from '@/components/shell/nav';
import { TenantCard } from '@/components/shell/tenant-card';
import { TenantThemeDefault } from '@/components/theme';
import { themeScript } from '@/lib/theme-script';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { EndSupportButton } from './end-support-button';

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await getTenantContext((await params).tenant);
  return { title: { default: tenant.name, template: `%s · ${tenant.name}` } };
}

export default async function TenantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  const { tenant, prefs, role } = ctx;
  // Coaches and crew work in the coach portal (support sessions still see the staff app).
  if (!ctx.impersonation && FIELD_ROLES.includes(role)) redirect(`/coach/${slug}`);
  const orgs = await listUserTenants(db, ctx.user.id);
  const mine = orgs.find((o) => o.tenant_id === tenant.id);
  const extra = ctx.membership?.permissions ?? [];

  // Role logic stays on the server: the browser only receives the items this person may see.
  const groups: NavGroup[] = ORG_NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.permission || can(role, it.permission, extra) || (ctx.impersonation && it.permission !== 'orders.create')),
  })).filter((g) => g.items.length);

  const locCount = mine?.locations ?? 0;
  const sub = ctx.impersonation ? 'Support · read-only' : `${ROLE_LABELS[role].label} · ${locCount} location${locCount === 1 ? '' : 's'}`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(tenant.brandColor, tenant.radius as Corners) }} />
      <TenantThemeDefault mode={tenant.themeMode} />
      <script dangerouslySetInnerHTML={{ __html: themeScript(tenant.themeMode) }} />
      <AppShell
        base={`/${slug}`}
        groups={groups}
        sidebar={prefs.brand.sidebar}
        header={
          <TenantCard
            name={tenant.name}
            sub={sub}
            brandColor={tenant.brandColor}
            logoUrl={fileUrl(tenant.id, tenant.logoFileId)}
            logoAdjust={prefs.brand.logo.icon}
            switchHref={orgs.length > 1 ? '/orgs' : undefined}
            sidebar={prefs.brand.sidebar}
          />
        }
        user={{ name: ctx.user.name, email: ctx.user.email, image: ctx.user.image }}
        jumps={orgs.filter((o) => o.slug !== slug).map((o) => ({ label: `Switch to ${o.name}`, href: `/${o.slug}`, hint: 'Organization' }))}
      >
        <LiveRefresh slug={slug} />
        {ctx.impersonation && (
          <div role="status" className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-danger px-4 py-2 text-center text-[13px] font-semibold text-white">
            <span>Support session · read-only · every action is audited. Reason: {ctx.impersonation.reason}</span>
            <EndSupportButton />
          </div>
        )}
        {!ctx.impersonation && ctx.suspended && (
          <div role="status" className="sticky top-0 z-40 bg-warning-bg px-4 py-2 text-center text-[13px] font-semibold text-warning-fg">
            This workspace is suspended. You can look around, but nothing can be changed and scheduled messages are paused. Contact support to reactivate it.
          </div>
        )}
        {children}
      </AppShell>
    </>
  );
}
