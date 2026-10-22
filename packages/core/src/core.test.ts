import { describe, expect, it } from 'vitest';
import {
  buildPalette, contrastRatio, SURFACES, THEME_PRESETS, themeCss,
  slugify, slugSchema, normalizePhone, formatPhone, parsePreferences,
  onboardingSchema, isValidTimezone, timezoneOptions,
} from './index';

describe('theme palette', () => {
  it.each([...THEME_PRESETS.map((p) => p.hex), '#FFEB3B', '#FFFFFF', '#000000', '#7FFFD4'])(
    '%s gives readable button text and links in both modes',
    (hex) => {
      const p = buildPalette(hex);
      for (const [mode, t] of [['light', p.light], ['dark', p.dark]] as const) {
        expect(contrastRatio(t.brand, t.brandFg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t.brandText, SURFACES[mode])).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('warns about colours that are too light or too dark', () => {
    expect(buildPalette('#FFEB3B').warnings[0]).toMatch(/very light/);
    expect(buildPalette('#0A0A0A').warnings.some((w) => /very dark/.test(w))).toBe(true);
    expect(buildPalette('#2450C8').warnings).toEqual([]);
  });

  it('emits light and dark CSS variables', () => {
    const css = themeCss('#2450C8', 'round');
    expect(css).toContain(':root{--brand:#2450C8');
    expect(css).toContain('--radius:16px');
    expect(css).toContain(':root[data-theme=dark]{--brand:');
  });
});

describe('slugs', () => {
  it('turns business names into web addresses', () => {
    expect(slugify('Freedom Fun USA')).toBe('freedom-fun-usa');
    expect(slugify('  Café & Bounce!! ')).toBe('cafe-and-bounce');
  });
  it('rejects reserved and malformed slugs', () => {
    expect(slugSchema.safeParse('freedom-fun').success).toBe(true);
    expect(slugSchema.safeParse('api').success).toBe(false);
    expect(slugSchema.safeParse('-bad').success).toBe(false);
    expect(slugSchema.safeParse('ab').success).toBe(false);
  });
});

describe('phones', () => {
  it('normalises to E.164 and formats back', () => {
    expect(normalizePhone('(512) 981-5557')).toBe('+15129815557');
    expect(normalizePhone('0300 1234567', 'PK')).toBe('+923001234567');
    expect(normalizePhone('12345')).toBeNull();
    expect(formatPhone('+15129815557')).toBe('(512) 981-5557');
  });
});

describe('preferences', () => {
  it('fills defaults for missing or broken settings', () => {
    const p = parsePreferences({});
    expect(p.booking.depositPercent).toBe(30);
    expect(p.booking.cleanupBufferMinutes).toBe(180);
    expect(p.hours).toHaveLength(7);
    expect(parsePreferences({ booking: { depositPercent: 50 } }).booking.depositPercent).toBe(50);
    expect(parsePreferences({ booking: { depositPercent: 'x' } }).booking.depositPercent).toBe(30);
  });
});

describe('regional', () => {
  it('validates time zones and lists them by offset', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    const opts = timezoneOptions(new Date('2026-01-15T12:00:00Z'));
    expect(opts.find((o) => o.value === 'America/Chicago')?.label).toBe('(GMT-06:00) America/Chicago');
    expect(opts[0]!.offsetMinutes).toBeLessThanOrEqual(opts.at(-1)!.offsetMinutes);
  });
});

describe('onboarding', () => {
  it('accepts a complete organisation without any region questions', () => {
    const input = {
      slug: 'freedom-fun',
      profile: { name: 'Freedom Fun USA', email: 'hello@example.com', phone: '512-981-5557', address: { country: 'US' } },
      branding: { brandColor: '#d32f2f', themeMode: 'system', radius: 'soft' },
      location: { name: 'Austin', code: 'aus', address: { line1: '100 Main St', city: 'Austin', country: 'US', lat: 30.27, lng: -97.74 } },
      booking: {},
    };
    const r = onboardingSchema.safeParse(input);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.branding.brandColor).toBe('#D32F2F');
      expect(r.data.profile.phone).toBe('+15129815557');
      expect(r.data.location.code).toBe('AUS');
      expect(r.data.location.timezone).toBeUndefined();
      expect(r.data.booking.depositPercent).toBe(30);
    }
  });
  it('needs a street and city for the location', () => {
    const r = onboardingSchema.shape.location.safeParse({ name: 'Yard', code: 'YRD', address: { country: 'US' } });
    expect(r.success).toBe(false);
  });
});

describe('mapbox address mapping', () => {
  it('maps a street address result', async () => {
    const { mapboxToAddress } = await import('./mapbox');
    const a = mapboxToAddress(
      {
        name: '700 Congress Avenue', feature_type: 'address', full_address: '700 Congress Avenue, Austin, Texas 78701, United States',
        context: {
          address: { name: '700 Congress Avenue', address_number: '700', street_name: 'Congress Avenue' },
          place: { name: 'Austin' }, region: { name: 'Texas', region_code: 'TX' }, postcode: { name: '78701' },
          country: { name: 'United States', country_code: 'us' },
        },
      },
      [-97.7404, 30.2694],
    );
    expect(a).toEqual({
      label: '700 Congress Avenue, Austin, Texas 78701, United States',
      line1: '700 Congress Avenue', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', lat: 30.2694, lng: -97.7404,
    });
  });

  it('keeps a business name in line 2 and falls back to locality', async () => {
    const { mapboxToAddress } = await import('./mapbox');
    const a = mapboxToAddress({
      name: 'Dolmen Mall', feature_type: 'poi', address: 'Block 4, Clifton', place_formatted: 'Karachi, Sindh, Pakistan',
      context: { locality: { name: 'Karachi' }, region: { name: 'Sindh' }, country: { country_code: 'pk' } },
      coordinates: { latitude: 24.8021234567, longitude: 67.0298 },
    });
    expect(a).toMatchObject({ line1: 'Block 4, Clifton', line2: 'Dolmen Mall', city: 'Karachi', region: 'Sindh', country: 'PK', lat: 24.802123 });
    expect(a.label).toBe('Dolmen Mall, Karachi, Sindh, Pakistan');
  });
});

describe('region detection', () => {
  it('reads the time zone from the map pin and the rest from the country', async () => {
    const { detectRegion, timezoneAt, currencyForCountry } = await import('./regional');
    expect(timezoneAt(30.2672, -97.7431)).toBe('America/Chicago');
    expect(timezoneAt(34.0522, -118.2437)).toBe('America/Los_Angeles');
    expect(timezoneAt(24.8607, 67.0011)).toBe('Asia/Karachi');
    const austin = detectRegion('US', { lat: 30.2672, lng: -97.7431 }, 'Asia/Karachi');
    expect(austin).toMatchObject({ timezone: 'America/Chicago', currency: 'USD', timezoneSource: 'map', formats: { distanceUnit: 'mi', dateFormat: 'MM/DD/YYYY' } });
    expect(detectRegion('US', null, 'Asia/Karachi').timezone).toBe('America/Chicago');
    expect(detectRegion('PK', null).currency).toBe('PKR');
    expect(detectRegion('DE', { lat: 52.52, lng: 13.405 })).toMatchObject({ timezone: 'Europe/Berlin', currency: 'EUR', formats: { distanceUnit: 'km', weekStartsOn: 'monday' } });
    expect(currencyForCountry('SN')).toBe('XOF');
  });
});
