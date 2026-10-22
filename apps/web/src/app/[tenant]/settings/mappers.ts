import { formatPhone, timezoneAt } from '@rental/core';
import type { Location, Tenant } from '@rental/db';

const opt = (v: string | null | undefined) => v ?? '';
const coord = (v: number | null | undefined) => (v == null ? undefined : v);

/** Database rows to form values (phones shown in local format, nulls as empty strings). */
export function profileValues(t: Tenant) {
  return {
    profile: {
      name: t.name,
      legalName: opt(t.legalName),
      email: opt(t.email),
      phone: formatPhone(t.phone, t.country),
      website: opt(t.website),
      taxId: opt(t.taxId),
      address: {
        line1: opt(t.line1), line2: opt(t.line2), city: opt(t.city), region: opt(t.region), postalCode: opt(t.postalCode),
        country: t.addressCountry ?? t.country, lat: coord(t.lat), lng: coord(t.lng),
      },
    },
    regional: { country: t.country, timezone: t.timezone, currency: t.currency, locale: t.locale },
  };
}

export function locationValues(l: Location, taxRate: string | null | undefined, country: string) {
  // An empty time zone means "follow the map pin"; keep it only if it was set by hand.
  const fromPin = timezoneAt(l.lat, l.lng);
  return {
    location: {
      name: l.name, code: l.code, timezone: fromPin && fromPin === l.timezone ? '' : l.timezone,
      phone: formatPhone(l.phone, country), email: opt(l.email), loadingNotes: opt(l.loadingNotes),
      isPrimary: l.isPrimary, isActive: l.isActive,
      address: {
        line1: opt(l.line1), line2: opt(l.line2), city: opt(l.city), region: opt(l.region), postalCode: opt(l.postalCode),
        country: l.country, lat: coord(l.lat), lng: coord(l.lng),
      },
    },
    taxPercent: taxRate == null ? 0 : Number(taxRate),
  };
}
