import { getIntegrations, lastChange, listLocations } from '@rental/db';
import { formatPhone, parseLocationSettings, resolveAgreement } from '@rental/core';
import { timeAgo } from '@/lib/audit-text';
import { fileUrl } from '@/lib/urls';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { WorkspaceSettings, type WorkspaceInitial } from './workspace-settings';

export const metadata = { title: 'Workspace & brand' };

const TABS = ['brand', 'profile', 'warehouses', 'payments', 'rules', 'agreement'] as const;

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { tenant: slug } = await params;
  const { tab } = await searchParams;
  const ctx = await pageContext(slug, 'settings.manage');
  const { tenant, prefs } = ctx;
  const [locs, integrations, last] = await Promise.all([
    listLocations(db, tenant.id),
    getIntegrations(db, tenant.id),
    lastChange(db, tenant.id, 'tenant.'),
  ]);
  const mail = integrations.orgMail;
  const sms = integrations.sms;
  const pay = integrations.orgPayments;

  const initial: WorkspaceInitial = {
    brand: {
      branding: { brandColor: tenant.brandColor, themeMode: tenant.themeMode as 'light', radius: tenant.radius as 'round' },
      brand: prefs.brand,
    },
    profile: {
      profile: {
        name: tenant.name, legalName: tenant.legalName ?? '', phone: formatPhone(tenant.phone, tenant.country) || '', email: tenant.email ?? '', website: tenant.website ?? '', taxId: tenant.taxId ?? '',
        address: {
          line1: tenant.line1 ?? '', line2: tenant.line2 ?? '', city: tenant.city ?? '', region: tenant.region ?? '', postalCode: tenant.postalCode ?? '',
          country: tenant.addressCountry ?? tenant.country, lat: tenant.lat ?? undefined, lng: tenant.lng ?? undefined,
        },
      },
      timezone: tenant.timezone,
      currency: tenant.currency,
      dateFormat: prefs.formats.dateFormat === 'DD/MM/YYYY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY',
      weekStartsOn: prefs.formats.weekStartsOn,
    },
    payments: {
      provider: (pay?.provider as 'manual') ?? 'manual', publishableKey: pay?.publishableKey ?? '', secretKey: '', merchantId: pay?.merchantId ?? '',
      hasSecret: !!pay?.hasSecret, keyMode: pay?.keyMode ?? null,
    },
    mailReady: mail?.mode === 'smtp' ? (mail.verifiedAt ? 'verified' : 'untested') : 'platform',
    smsReady: !!sms && sms.provider !== 'none',
    rules: prefs.booking,
    agreement: resolveAgreement(prefs.agreement),
    warehouses: locs.map((l) => ({
      id: l.id, name: l.name, code: l.code, city: [l.city, l.region].filter(Boolean).join(', '), isPrimary: l.isPrimary, isActive: l.isActive,
      pinned: l.lat != null, freeMiles: parseLocationSettings(l.settings).freeTravelMiles ?? prefs.booking.freeTravelDistance, timezone: l.timezone,
    })),
  };

  return (
    <WorkspaceSettings
      slug={slug}
      // Old links (?tab=connect) land on Payments: mail and texts moved to Email & SMS.
      tab={tab === 'connect' ? 'payments' : (TABS as readonly string[]).includes(tab ?? '') ? (tab as (typeof TABS)[number]) : 'brand'}
      initial={initial}
      orgName={tenant.name}
      currency={tenant.currency}
      logoUrl={fileUrl(tenant.id, tenant.logoFileId)}
      readOnly={ctx.readOnly}
      lastChanged={last ? `Last changed by ${last.actorName} · ${timeAgo(last.at)}` : null}
    />
  );
}
