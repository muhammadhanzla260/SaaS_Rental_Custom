/**
 * Analytics and ad tracking. Nothing loads until the visitor allows it in the cookie banner:
 * Google tag (GA4 + Ads) with "analytics", the Meta Pixel with "advertising".
 * `track()` can be called any time; events before consent are dropped, never queued for later.
 */
type Consent = { a: boolean; m: boolean };
type Params = Record<string, string | number | boolean | undefined>;
type Fbq = ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown; callMethod?: (...a: unknown[]) => void };
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void; fbq?: Fbq; _fbq?: unknown; rhTrack?: typeof track }
}

const GA = import.meta.env.PUBLIC_GA_ID as string | undefined;
const ADS = import.meta.env.PUBLIC_GOOGLE_ADS_ID as string | undefined;
const PIXEL = import.meta.env.PUBLIC_META_PIXEL_ID as string | undefined;
const META_EVENTS: Record<string, string> = { start_trial: 'StartTrial', join_waitlist: 'Lead', book_demo: 'Schedule' };

let consent: Consent = { a: false, m: false };
let googleOn = false;
let metaOn = false;

function script(src: string) {
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.append(s);
}

const grants = (c: Consent) => ({
  analytics_storage: c.a ? 'granted' : 'denied',
  ad_storage: c.m ? 'granted' : 'denied',
  ad_user_data: c.m ? 'granted' : 'denied',
  ad_personalization: c.m ? 'granted' : 'denied',
});

function loadGoogle() {
  if (googleOn || !(GA || ADS)) return;
  googleOn = true;
  window.dataLayer = window.dataLayer || [];
  // gtag must push the real `arguments` object.
  window.gtag = function gtag() { window.dataLayer!.push(arguments); };
  window.gtag('consent', 'default', grants(consent));
  window.gtag('js', new Date());
  if (GA) window.gtag('config', GA);
  if (ADS) window.gtag('config', ADS);
  script(`https://www.googletagmanager.com/gtag/js?id=${GA || ADS}`);
}

function loadMeta() {
  if (metaOn || !PIXEL) return;
  metaOn = true;
  const f = function (...a: unknown[]) { if (f.callMethod) f.callMethod(...a); else f.queue!.push(a); } as Fbq;
  f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
  window.fbq = f; window._fbq = f;
  script('https://connect.facebook.net/en_US/fbevents.js');
  f('init', PIXEL);
  f('track', 'PageView');
}

export function applyConsent(c: Consent) {
  consent = c;
  if (c.a || c.m) loadGoogle();
  if (googleOn) window.gtag!('consent', 'update', grants(c));
  if (c.m) loadMeta();
}

export function track(name: string, params: Params = {}) {
  const p = { vertical: document.documentElement.dataset.v ?? 'events', ...params };
  if (googleOn && window.gtag) window.gtag('event', name, p);
  if (metaOn && window.fbq) {
    if (META_EVENTS[name]) window.fbq('track', META_EVENTS[name], p);
    else window.fbq('trackCustom', name, p);
  }
  if (import.meta.env.DEV) console.debug('[track]', name, p);
}
window.rhTrack = track;
