import { describe, expect, it } from 'vitest';
import {
  accentTokens, checkAccent, contrastRatio, initials, SURFACES, THEME_PRESETS, themeCss,
  slugify, slugSchema, normalizePhone, formatPhone, parsePreferences,
  isValidTimezone, timezoneOptions, registerSchema, passwordScore, profileStepSchema, brandStepSchema,
  warehouseStepSchema, documentNumberingSchema, exampleNumber, renderPrefix, sequenceScope, parseZipList,
  onboardingPercent, can,
} from './index';

describe('tenant theme', () => {
  it.each(THEME_PRESETS.map((p) => p.hex))('preset %s passes for all text sizes and links stay readable', (hex) => {
    expect(checkAccent(hex).level).toBe('all');
    const t = accentTokens(hex);
    expect(contrastRatio(t.light.text, SURFACES.light)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.dark.text, SURFACES.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it('picks white or ink text, whichever contrasts more, and reports the ratio', () => {
    expect(checkAccent('#2C4FE0')).toMatchObject({ onAccent: '#FFFFFF', level: 'all' });
    expect(checkAccent('#2C4FE0').message).toMatch(/^Button text contrast \d+\.\d:1 · passes for all text sizes$/);
    expect(checkAccent('#D4FF3A').onAccent).toBe('#0B0D12');
  });

  it('never drops below 3:1 because it picks white or ink (mid-greys are the worst case)', () => {
    for (let v = 0; v <= 255; v += 5) {
      const h = v.toString(16).padStart(2, '0');
      const c = checkAccent(`#${h}${h}${h}`.toUpperCase());
      expect(c.ratio).toBeGreaterThanOrEqual(3);
      expect(c.level).not.toBe('fail');
    }
  });

  it('emits light and dark CSS variables with the corner scale', () => {
    const css = themeCss('#2C4FE0', 'round');
    expect(css).toContain(':root{--accent:#2C4FE0');
    expect(css).toContain('--radius-card:18px');
    expect(themeCss('#2C4FE0', 'sharp')).toContain('--radius-control:4px');
    expect(css).toContain(':root[data-theme=dark]{--accent:');
  });

  it('makes initials', () => {
    expect(initials('Freedom Fun USA')).toBe('FF');
    expect(initials('  ')).toBe('?');
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

describe('registration and onboarding steps', () => {
  const reg = {
    businessName: 'Lakeside Party Rentals', slug: 'lakeside', ownerName: 'Jordan Reyes', country: 'US',
    email: 'jordan@example.com', password: 'Lakeside-2026', acceptTerms: true,
  };
  it('registers a workspace and requires the terms', () => {
    expect(registerSchema.safeParse(reg).success).toBe(true);
    expect(registerSchema.safeParse({ ...reg, acceptTerms: false }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg, password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg, slug: 'console' }).success).toBe(false);
  });
  it('scores passwords on the 4-segment meter', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('abcdefgh')).toBe(1);
    expect(passwordScore('Abcdefg1!')).toBe(4);
  });
  it('step 1 needs the business phone and a real time zone', () => {
    const ok = profileStepSchema.safeParse({
      profile: { name: 'Lakeside Party Rentals', phone: '512-555-0100', address: { country: 'US' } },
      timezone: 'America/Chicago', currency: 'USD', dateFormat: 'MM/DD/YYYY', weekStartsOn: 'sunday',
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.profile.phone).toBe('+15125550100');
    expect(profileStepSchema.safeParse({ profile: { name: 'X Y', address: {} }, timezone: 'America/Chicago', currency: 'USD', dateFormat: 'MM/DD/YYYY', weekStartsOn: 'sunday' }).success).toBe(false);
  });
  it('step 2 refuses an unreadable brand colour', () => {
    expect(brandStepSchema.safeParse({ branding: { brandColor: '#b0306a' }, brand: {} }).success).toBe(true);
    expect(brandStepSchema.safeParse({ branding: { brandColor: '#7a7a7a' }, brand: {} }).success).toBe(checkAccent('#7A7A7A').level !== 'fail');
  });
  it('step 3 needs a street and city for the warehouse', () => {
    const r = warehouseStepSchema.shape.location.safeParse({ name: 'Yard', code: 'YRD', address: { country: 'US' } });
    expect(r.success).toBe(false);
    const ok = warehouseStepSchema.shape.location.safeParse({ name: 'Austin', code: 'aus', address: { line1: '1 Main', city: 'Austin', country: 'US' } });
    expect(ok.success && ok.data.code).toBe('AUS');
  });
  it('renders document numbers per location and year', () => {
    const n = documentNumberingSchema.parse({});
    expect(exampleNumber(n, 'quote', 'aus')).toBe('Q-AUS-01042');
    expect(exampleNumber(n, 'invoice', 'AUS', 1)).toBe(`INV-${new Date().getUTCFullYear()}-0001`);
    expect(sequenceScope('quote', renderPrefix(n.quotePrefix, { loc: 'DAL' }))).toBe('quote:Q-DAL-');
  });
  it('parses ZIP lists', () => {
    expect(parseZipList('78701, 78702 78701;x')).toEqual(['78701', '78702']);
  });
  it('reports onboarding progress', () => {
    expect(onboardingPercent({ done: ['profile', 'brand'], skipped: ['connect'], current: 3 }, false)).toBe(50);
    expect(onboardingPercent({ done: [], skipped: [], current: 0 }, true)).toBe(100);
  });
});

describe('permissions', () => {
  it('follows the design matrix', () => {
    expect(can('sales', 'orders.create')).toBe(true);
    expect(can('sales', 'orders.override_price')).toBe(false);
    expect(can('manager', 'orders.override_price')).toBe(true);
    expect(can('accountant', 'payments.refund')).toBe(true);
    expect(can('admin', 'billing.manage')).toBe(false);
    expect(can('coach', 'coach.portal')).toBe(true);
    expect(can('viewer', 'orders.create')).toBe(false);
  });
  it('allows extra grants for grantable permissions only', () => {
    expect(can('sales', 'orders.override_price', ['orders.override_price'])).toBe(true);
    expect(can('sales', 'settings.manage', ['settings.manage'])).toBe(false);
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
    const { detectRegion, timezoneAt } = await import('./geo-tz');
    const { currencyForCountry } = await import('./regional');
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

describe('travel fee (Odoo POS parity)', () => {
  it('matches the POS formula: (miles - 10 free) x $2.50 staffed, $3.00 if any drop-off, $0 pick-up', async () => {
    const { travelFee } = await import('./travel');
    const rules = { freeDistance: 10, rateStaffed: 2.5, rateDropoff: 3, unit: 'mi' as const };
    expect(travelFee(25, ['staffed'], rules)).toMatchObject({ billable: 15, rate: 2.5, fee: 37.5 });
    expect(travelFee(25, ['staffed', 'dropoff'], rules)).toMatchObject({ rate: 3, fee: 45 });
    expect(travelFee(25, ['pickup', 'pickup'], rules)).toMatchObject({ fee: 0, reason: 'pickup' });
    expect(travelFee(8, ['staffed'], rules).fee).toBe(0);
    expect(travelFee(12.345, ['staffed'], rules).fee).toBe(5.86);
  });

  it('picks the nearest location by driving among the 3 closest, falling back to straight line', async () => {
    const { findNearestOrigin, haversineMiles } = await import('./travel');
    const austin = { name: 'AUS', lat: 30.2672, lng: -97.7431 };
    const roundRock = { name: 'RR', lat: 30.5083, lng: -97.6789 };
    const houston = { name: 'HOU', lat: 29.7604, lng: -95.3698 };
    const noPin = { name: 'X', lat: null, lng: null };
    const party = { lat: 30.45, lng: -97.7 };
    // Round Rock is closer in a straight line, but pretend the road from Austin is shorter.
    const drive = async (from: { lat: number }) => (from.lat === roundRock.lat ? 20 : from.lat === austin.lat ? 14 : 170);
    const best = await findNearestOrigin([austin, roundRock, houston, noPin], party, drive);
    expect(best).toMatchObject({ origin: { name: 'AUS' }, miles: 14, isDriving: true });
    const fallback = await findNearestOrigin([austin, roundRock], party, async () => null);
    expect(fallback!.origin.name).toBe('RR');
    expect(fallback!.miles).toBeCloseTo(haversineMiles(roundRock, party), 6);
    expect(await findNearestOrigin([noPin], party, drive)).toBeNull();
  });

  it('builds a service-area box around the locations, like the Austin box in Odoo', async () => {
    const { serviceArea } = await import('./travel');
    const area = serviceArea([{ lat: 30.2672, lng: -97.7431 }], 80)!;
    const [w, s, e, n] = area.bbox.split(',').map(Number);
    // Odoo's hand-made box was -99.45,29.5,-96.65,31.3
    expect(w).toBeCloseTo(-99.13, 1);
    expect(e).toBeCloseTo(-96.36, 1);
    expect(s).toBeCloseTo(29.11, 1);
    expect(n).toBeCloseTo(31.43, 1);
    expect(area.center).toBe('-97.7431,30.2672');
    expect(serviceArea([], 80)).toBeNull();
  });
});
