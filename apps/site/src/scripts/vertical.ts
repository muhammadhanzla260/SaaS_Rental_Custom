/** The two-site rule on the client: remember the chosen business, and keep UTM tags for forms. */
const YEAR = 60 * 60 * 24 * 365;

export function setVertical(v: 'events' | 'cars') {
  document.cookie = `rh_vertical=${v}; Max-Age=${YEAR}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  document.documentElement.dataset.v = v;
}

document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLElement>('[data-set-vertical]');
  if (a) setVertical(a.dataset.setVertical as 'events' | 'cars');
});

// First-touch UTM parameters, kept for the session so a form three pages later still credits the ad.
try {
  const q = new URLSearchParams(location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].filter((k) => q.get(k));
  if (keys.length && !sessionStorage.getItem('rh_utm')) sessionStorage.setItem('rh_utm', JSON.stringify(Object.fromEntries(keys.map((k) => [k, q.get(k)]))));
  if (!sessionStorage.getItem('rh_ref') && document.referrer && !document.referrer.startsWith(location.origin)) sessionStorage.setItem('rh_ref', document.referrer);
} catch { /* storage blocked: forms go without attribution */ }
