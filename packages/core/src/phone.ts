import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/** Normalise any typed phone number to E.164 (+15125551234), or null if invalid. */
export function normalizePhone(input: string, defaultCountry = 'US'): string | null {
  const parsed = parsePhoneNumberFromString(input, defaultCountry as CountryCode);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** Human format for display: (512) 555-1234 at home, +44 20 7946 0958 abroad. */
export function formatPhone(e164: string | null | undefined, homeCountry = 'US'): string {
  if (!e164) return '';
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === homeCountry ? parsed.formatNational() : parsed.formatInternational();
}
