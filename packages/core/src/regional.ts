/**
 * Time zones, countries and currencies. Lists come from generated static data
 * (regions-data.ts) so server and browser render identical options.
 */
import { COUNTRIES, CURRENCIES, TIMEZONES } from './regions-data';

const TZ_SET = new Set<string>(TIMEZONES);

export function listTimezones(): readonly string[] {
  return TIMEZONES;
}

export function isValidTimezone(tz: string): boolean {
  if (tz === 'UTC' || TZ_SET.has(tz)) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.includes('/');
  } catch {
    return false;
  }
}

/** "GMT-05:00" style offset for a zone at a given instant (DST aware). */
export function timezoneOffsetLabel(tz: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  const v = part?.value ?? 'GMT';
  return v === 'GMT' ? 'GMT+00:00' : v;
}

export type TimezoneOption = { value: string; label: string; offsetMinutes: number };

export function timezoneOptions(at = new Date()): TimezoneOption[] {
  return TIMEZONES.map((tz) => {
    const offset = timezoneOffsetLabel(tz, at);
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(offset);
    const offsetMinutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
    return { value: tz, label: `(${offset}) ${tz.replace(/_/g, ' ')}`, offsetMinutes };
  }).sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.value.localeCompare(b.value));
}

export function countryOptions(): { value: string; label: string }[] {
  return COUNTRIES.map(([value, label]) => ({ value, label }));
}

export function countryName(code: string): string {
  return COUNTRIES.find(([c]) => c === code)?.[1] ?? code;
}

export function currencyOptions(): { value: string; label: string }[] {
  return CURRENCIES.map(([value, name]) => ({ value, label: `${value} · ${name}` }));
}

/** Sensible starting values when a country is picked during onboarding. */
export const COUNTRY_DEFAULTS: Record<string, { currency: string; locale: string; timezone: string; distanceUnit: 'mi' | 'km'; dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' }> = {
  US: { currency: 'USD', locale: 'en-US', timezone: 'America/Chicago', distanceUnit: 'mi', dateFormat: 'MM/DD/YYYY' },
  CA: { currency: 'CAD', locale: 'en-CA', timezone: 'America/Toronto', distanceUnit: 'km', dateFormat: 'YYYY-MM-DD' },
  GB: { currency: 'GBP', locale: 'en-GB', timezone: 'Europe/London', distanceUnit: 'mi', dateFormat: 'DD/MM/YYYY' },
  AU: { currency: 'AUD', locale: 'en-AU', timezone: 'Australia/Sydney', distanceUnit: 'km', dateFormat: 'DD/MM/YYYY' },
  PK: { currency: 'PKR', locale: 'en-PK', timezone: 'Asia/Karachi', distanceUnit: 'km', dateFormat: 'DD/MM/YYYY' },
  AE: { currency: 'AED', locale: 'en-AE', timezone: 'Asia/Dubai', distanceUnit: 'km', dateFormat: 'DD/MM/YYYY' },
  IN: { currency: 'INR', locale: 'en-IN', timezone: 'Asia/Kolkata', distanceUnit: 'km', dateFormat: 'DD/MM/YYYY' },
  DE: { currency: 'EUR', locale: 'de-DE', timezone: 'Europe/Berlin', distanceUnit: 'km', dateFormat: 'DD/MM/YYYY' },
};

/** Locales offered for number and date formatting, with fixed English labels. */
export const LOCALE_OPTIONS: readonly (readonly [string, string])[] = [
  ['en-US', 'English (United States)'],
  ['en-CA', 'English (Canada)'],
  ['en-GB', 'English (United Kingdom)'],
  ['en-AU', 'English (Australia)'],
  ['en-IN', 'English (India)'],
  ['en-PK', 'English (Pakistan)'],
  ['en-AE', 'English (United Arab Emirates)'],
  ['es-US', 'Spanish (United States)'],
  ['fr-CA', 'French (Canada)'],
  ['de-DE', 'German (Germany)'],
];

// --- automatic detection ---------------------------------------------------------

/** ISO 3166 country -> ISO 4217 currency in everyday use. */
const COUNTRY_CURRENCY: Record<string, string> = Object.fromEntries(
  ('AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AQ:USD AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN ' +
    'BA:BAM BB:BBD BD:BDT BE:EUR BF:XOF BG:EUR BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL BS:BSD ' +
    'BT:BTN BV:NOK BW:BWP BY:BYN BZ:BZD CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF CN:CNY ' +
    'CO:COP CR:CRC CU:CUP CV:CVE CW:XCG CX:AUD CY:EUR CZ:CZK DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR ' +
    'EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD FO:DKK FR:EUR GA:XAF GB:GBP GD:XCD GE:GEL GF:EUR ' +
    'GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GS:GBP GT:GTQ GU:USD GW:XOF GY:GYD HK:HKD HM:AUD ' +
    'HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IO:USD IQ:IQD IR:IRR IS:ISK IT:EUR JE:GBP JM:JMD ' +
    'JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LC:XCD ' +
    'LI:CHF LK:LKR LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD MA:MAD MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ' +
    'ML:XOF MM:MMK MN:MNT MO:MOP MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NA:NAD ' +
    'NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR NO:NOK NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR PA:PAB PE:PEN PF:XPF PG:PGK ' +
    'PH:PHP PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR PW:USD PY:PYG QA:QAR RE:EUR RO:RON RS:RSD RU:RUB RW:RWF ' +
    'SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SI:EUR SJ:NOK SK:EUR SL:SLE SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP ' +
    'ST:STN SV:USD SX:XCG SY:SYP SZ:SZL TC:USD TD:XAF TF:EUR TG:XOF TH:THB TJ:TJS TK:NZD TL:USD TM:TMT TN:TND TO:TOP ' +
    'TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS UA:UAH UG:UGX UM:USD US:USD UY:UYU UZ:UZS VA:EUR VC:XCD VE:VES VG:USD VI:USD ' +
    'VN:VND VU:VUV WF:XPF WS:WST YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:ZWG')
    .split(' ')
    .map((p) => p.split(':') as [string, string]),
);

const MILES = new Set(['US', 'GB', 'LR', 'MM', 'PR', 'VI', 'GU', 'AS', 'MP']);
const MONTH_FIRST = new Set(['US', 'PR', 'VI', 'GU', 'AS', 'MP', 'UM', 'PH', 'FM', 'MH', 'PW']);
const SUNDAY_FIRST = new Set(['US', 'CA', 'MX', 'BR', 'JP', 'PH', 'IL', 'SA', 'AE', 'PK', 'IN', 'KR', 'TW', 'HK', 'ZA', 'PR', 'GU']);

export function currencyForCountry(country: string): string {
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD';
}

/** Formats and money for a country (no map lookup: safe for the browser). */
export function regionDefaults(country: string) {
  const c = (country || 'US').toUpperCase();
  return {
    country: c,
    currency: currencyForCountry(c),
    locale: COUNTRY_DEFAULTS[c]?.locale ?? `en-${c}`,
    timezone: COUNTRY_DEFAULTS[c]?.timezone ?? null,
    formats: {
      dateFormat: (MONTH_FIRST.has(c) ? 'MM/DD/YYYY' : 'DD/MM/YYYY') as 'MM/DD/YYYY' | 'DD/MM/YYYY',
      timeFormat: (MONTH_FIRST.has(c) || ['CA', 'AU', 'NZ', 'PK', 'IN'].includes(c) ? '12h' : '24h') as '12h' | '24h',
      weekStartsOn: (SUNDAY_FIRST.has(c) ? 'sunday' : 'monday') as 'sunday' | 'monday',
      distanceUnit: (MILES.has(c) ? 'mi' : 'km') as 'mi' | 'km',
    },
  };
}
