/**
 * Time zone from a map pin (offline lookup). Kept apart from regional.ts so
 * browser bundles that only need the zone list never load the lookup data.
 */
import tzlookup from '@photostructure/tz-lookup';
import { isValidTimezone, regionDefaults } from './regional';

/** IANA time zone at a point on the map, or null. */
export function timezoneAt(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  try {
    const tz = tzlookup(lat, lng);
    return isValidTimezone(tz) ? tz : null;
  } catch {
    return null;
  }
}

export type DetectedRegion = {
  country: string;
  timezone: string;
  currency: string;
  locale: string;
  formats: { dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY'; timeFormat: '12h' | '24h'; weekStartsOn: 'sunday' | 'monday'; distanceUnit: 'mi' | 'km' };
  /** Where the time zone came from, for the "detected from ..." note. */
  timezoneSource: 'map' | 'device' | 'default';
};

/**
 * Everything regional, worked out from the country and a map pin.
 * Map pin first. Without one, the country's main zone beats the device's:
 * staff often set up from abroad (a Karachi laptop must not make Austin "Asia/Karachi").
 */
export function detectRegion(country: string, point?: { lat?: number | null; lng?: number | null } | null, deviceTimezone?: string | null): DetectedRegion {
  const d = regionDefaults(country);
  const fromMap = timezoneAt(point?.lat, point?.lng);
  const device = deviceTimezone && isValidTimezone(deviceTimezone) ? deviceTimezone : null;
  const timezone = fromMap ?? d.timezone ?? device ?? 'UTC';
  return {
    country: d.country,
    timezone,
    currency: d.currency,
    locale: d.locale,
    formats: d.formats,
    timezoneSource: fromMap ? 'map' : d.timezone ? 'default' : device ? 'device' : 'default',
  };
}
