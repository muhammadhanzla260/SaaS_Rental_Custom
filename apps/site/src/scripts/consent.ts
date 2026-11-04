/** Cookie banner: Essential is always on; Analytics and Advertising wait for an explicit yes. */
import { applyConsent, track } from './track';

const YEAR = 60 * 60 * 24 * 365;
const read = () => document.cookie.match(/(?:^|; )rh_consent=([^;]*)/)?.[1] ?? null;
const viewEvent = document.body.dataset.viewEvent;

function save(a: boolean, m: boolean) {
  document.cookie = `rh_consent=a${+a}m${+m}; Max-Age=${YEAR}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  applyConsent({ a, m });
}

const stored = read();
if (stored) {
  applyConsent({ a: stored.includes('a1'), m: stored.includes('m1') });
  if (viewEvent) track(viewEvent);
}

const banner = document.getElementById('cookie-banner');
if (banner) {
  if (!stored) banner.hidden = false;
  const prefs = banner.querySelector<HTMLElement>('[data-prefs]')!;
  const prefsBtn = banner.querySelector<HTMLButtonElement>('[data-cb="prefs"]')!;
  const sw = (k: string) => banner.querySelector<HTMLButtonElement>(`[data-switch="${k}"]`)!;
  const showPrefs = (open: boolean) => {
    prefs.hidden = !open;
    prefsBtn.textContent = open ? 'Hide choices' : 'Choose';
    prefsBtn.setAttribute('aria-expanded', String(open));
  };

  banner.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement>('[data-cb], [data-switch]');
    if (!t) return;
    if (t.dataset.switch) { t.setAttribute('aria-checked', String(t.getAttribute('aria-checked') !== 'true')); return; }
    const act = t.dataset.cb;
    if (act === 'prefs') return showPrefs(prefs.hidden);
    const first = !read();
    if (act === 'accept') save(true, true);
    if (act === 'reject') save(false, false);
    if (act === 'save') save(sw('a').getAttribute('aria-checked') === 'true', sw('m').getAttribute('aria-checked') === 'true');
    banner.hidden = true;
    if (first && viewEvent && act !== 'reject') track(viewEvent);
  });

  // "Cookie settings" in the footer reopens the banner with the choices showing.
  document.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('[data-cookie-settings]')) return;
    const s = read();
    sw('a').setAttribute('aria-checked', String(!!s?.includes('a1')));
    sw('m').setAttribute('aria-checked', String(!!s?.includes('m1')));
    showPrefs(true);
    banner.hidden = false;
    banner.querySelector<HTMLElement>('[data-cb="save"]')?.focus();
  });
}
