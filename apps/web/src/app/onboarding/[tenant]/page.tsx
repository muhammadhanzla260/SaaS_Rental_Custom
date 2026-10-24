import { notFound, redirect } from 'next/navigation';
import { themeCss, type Corners } from '@rental/core';
import { getIntegrations, listLocations, listTeam } from '@rental/db';
import { fileUrl } from '@/lib/urls';
import { getTenantContext } from '@/server/context';
import { db } from '@/server/db';
import { OnboardingWizard, type WizardInitial } from './wizard';

export const metadata = { title: 'Set up your workspace' };

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ step?: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getTenantContext(slug);
  if (!ctx.canManageSettings) {
    if (ctx.readOnly) notFound();
    redirect(`/${slug}`);
  }
  const { tenant, prefs } = ctx;
  const [locs, integrations, team] = await Promise.all([listLocations(db, tenant.id), getIntegrations(db, tenant.id), listTeam(db, tenant.id)]);
  const primary = locs.find((l) => l.isPrimary) ?? locs[0] ?? null;
  const mail = integrations.orgMail;
  const pay = integrations.orgPayments;
  const sms = integrations.sms;

  const initial: WizardInitial = {
    profile: {
      name: tenant.name, legalName: tenant.legalName ?? '', phone: tenant.phone ?? '', email: tenant.email ?? '', website: tenant.website ?? '',
      taxId: tenant.taxId ?? '', address: { country: tenant.addressCountry ?? tenant.country },
    },
    timezone: tenant.timezone,
    currency: tenant.currency,
    dateFormat: prefs.formats.dateFormat === 'DD/MM/YYYY' ? 'DD/MM/YYYY' : 'MM/DD/YYYY',
    weekStartsOn: prefs.formats.weekStartsOn,
    branding: { brandColor: tenant.brandColor, themeMode: tenant.themeMode as 'light' | 'dark' | 'system', radius: tenant.radius as Corners },
    brand: prefs.brand,
    warehouse: {
      location: primary
        ? {
            name: primary.name, code: primary.code, phone: primary.phone ?? '', email: primary.email ?? '',
            address: {
              line1: primary.line1 ?? '', line2: primary.line2 ?? '', city: primary.city ?? '', region: primary.region ?? '',
              postalCode: primary.postalCode ?? '', country: primary.country, lat: primary.lat ?? undefined, lng: primary.lng ?? undefined,
            },
            settings: primary.settings as Record<string, unknown>,
          }
        : { name: '', code: '', phone: '', email: '', address: { country: tenant.country }, settings: {} },
      travel: {
        freeTravelDistance: prefs.booking.freeTravelDistance,
        travelRateStaffed: prefs.booking.travelRateStaffed,
        travelRateDropoff: prefs.booking.travelRateDropoff,
      },
      taxPercent: primary?.taxRate ? Number(primary.taxRate.rate) : 0,
    },
    connect: {
      mail: {
        mode: (mail?.mode as 'platform' | 'smtp') ?? 'smtp', provider: (mail?.provider as 'google') ?? 'google', host: mail?.host ?? 'smtp.gmail.com',
        port: mail?.port ?? 587, security: (mail?.security as 'starttls') ?? 'starttls', username: mail?.username ?? '', password: '',
        fromName: mail?.fromName ?? '', fromEmail: mail?.fromEmail ?? '', hasSecret: !!mail?.hasSecret,
      },
      sms: { provider: (sms?.provider as 'none') ?? 'none', sendingNumber: sms?.sendingNumber ?? '', accountId: sms?.accountId ?? '', apiKey: '', hasSecret: !!sms?.hasSecret },
      payments: {
        provider: (pay?.provider as 'stripe') ?? 'stripe', publishableKey: pay?.publishableKey ?? '', secretKey: '', merchantId: pay?.merchantId ?? '',
        hasSecret: !!pay?.hasSecret,
      },
    },
    invites: team.invites.map((i) => ({ email: i.email, role: i.role })),
    plan: tenant.plan as 'starter' | 'growth' | 'scale',
    progress: prefs.onboarding,
    launched: !!tenant.onboardedAt,
  };

  const requested = Number(searchParams ? (await searchParams).step : NaN);
  const startStep = Number.isInteger(requested) && requested >= 1 && requested <= 6 ? requested - 1 : prefs.onboarding.current;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: themeCss(tenant.brandColor, tenant.radius as Corners) }} />
      <OnboardingWizard
        slug={slug}
        initial={initial}
        startStep={startStep}
        logoUrl={fileUrl(tenant.id, tenant.logoFileId)}
        ownerEmail={ctx.user.email}
      />
    </>
  );
}
