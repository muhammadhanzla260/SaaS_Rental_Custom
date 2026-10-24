import { getIntegrations, getNextNumbers, listLocations } from '@rental/db';
import { formatPhone, parseLocationSettings } from '@rental/core';
import { pageContext } from '@/server/guards';
import { db } from '@/server/db';
import { LocationsSettings, type LocationRow } from './locations-settings';

export const metadata = { title: 'Locations' };
const TABS = ['general', 'tax', 'area', 'email', 'payments'] as const;

export default async function LocationsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ id?: string; tab?: string; new?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await pageContext(slug, 'settings.manage');
  const { tenant, prefs } = ctx;
  const [locs, integrations] = await Promise.all([listLocations(db, tenant.id), getIntegrations(db, tenant.id)]);
  const orgMailReady = integrations.orgMail?.mode === 'smtp';

  const rows: LocationRow[] = locs.map((l) => {
    const mail = integrations.mail.find((m) => m.locationId === l.id) ?? null;
    const pay = integrations.payments.find((p) => p.locationId === l.id) ?? null;
    return {
      id: l.id, name: l.name, code: l.code, timezone: l.timezone, phone: formatPhone(l.phone, l.country) || '', email: l.email ?? '',
      address: { line1: l.line1 ?? '', line2: l.line2 ?? '', city: l.city ?? '', region: l.region ?? '', postalCode: l.postalCode ?? '', country: l.country, lat: l.lat ?? undefined, lng: l.lng ?? undefined },
      loadingNotes: l.loadingNotes ?? '', isPrimary: l.isPrimary, isActive: l.isActive, settings: parseLocationSettings(l.settings),
      taxPercent: l.taxRate ? Number(l.taxRate.rate) : 0,
      mail: mail ? { host: mail.host ?? '', port: mail.port, security: mail.security as 'starttls', username: mail.username ?? '', fromName: mail.fromName ?? '', fromEmail: mail.fromEmail ?? '', provider: mail.provider as 'other', hasSecret: mail.hasSecret } : null,
      payments: pay ? { provider: pay.provider as 'stripe', publishableKey: pay.publishableKey ?? '', merchantId: pay.merchantId ?? '', hasSecret: pay.hasSecret, keyMode: pay.keyMode } : null,
      ready: !!mail || orgMailReady,
    };
  });
  const selected = sp.new ? null : rows.find((r) => r.id === sp.id) ?? rows.find((r) => r.isPrimary) ?? rows[0] ?? null;
  const next = selected ? await getNextNumbers(db, tenant.id, prefs.numbering, selected.code) : null;

  return (
    <LocationsSettings
      slug={slug}
      rows={rows}
      selectedId={selected?.id ?? null}
      creating={!!sp.new || rows.length === 0}
      tab={(TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as (typeof TABS)[number]) : 'general'}
      numbering={prefs.numbering}
      nextNumbers={next ? { quote: next.quote.next, invoice: next.invoice.next, receipt: next.receipt.next } : null}
      orgDefaults={{ freeMiles: prefs.booking.freeTravelDistance, rateStaffed: prefs.booking.travelRateStaffed, rateDropoff: prefs.booking.travelRateDropoff }}
      orgName={tenant.name}
      currency={tenant.currency}
      orgTimezone={tenant.timezone}
      readOnly={ctx.readOnly}
    />
  );
}
