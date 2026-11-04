/**
 * Progressive enhancement for every <form data-form>. Without JS the form posts normally and
 * the server redirects back with ?sent=<kind>. With JS it posts in place and flips the form's
 * root ([data-form-root], else the form) to data-state="sent".
 */
import { track } from './track';

function attribution(): Record<string, string> {
  const out: Record<string, string> = { page: location.pathname, vertical: document.documentElement.dataset.v ?? 'events' };
  try {
    Object.assign(out, JSON.parse(sessionStorage.getItem('rh_utm') ?? '{}'));
    const ref = sessionStorage.getItem('rh_ref');
    if (ref) out.referrer = ref;
  } catch { /* ignore */ }
  return out;
}

function sent(form: HTMLFormElement) {
  const root = form.closest<HTMLElement>('[data-form-root]') ?? form;
  root.dataset.state = 'sent';
  root.querySelector<HTMLElement>('[data-success]')?.focus();
  if (form.dataset.track) track(form.dataset.track, { form: form.dataset.form });
  form.dispatchEvent(new CustomEvent('rh:sent', { bubbles: true, detail: Object.fromEntries(new FormData(form)) }));
}

const stamp = String(Date.now());
const params = new URLSearchParams(location.search);
document.querySelectorAll<HTMLFormElement>('form[data-form]').forEach((form) => {
  const t = form.querySelector<HTMLInputElement>('input[name="_t"]');
  if (t) t.value = stamp;
  // Back from a no-JS post.
  if (params.get('sent') === form.dataset.form && form.dataset.formId === params.get('fid')) sent(form);
});

document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.matches('form[data-form]')) return;
  e.preventDefault();
  if (!form.reportValidity()) return;
  const err = form.querySelector<HTMLElement>('[data-error]');
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const label = btn?.innerHTML;
  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sending…'; }
  const fd = new FormData(form);
  for (const [k, v] of Object.entries(attribution())) fd.set(k, v);
  try {
    const res = await fetch(form.action, { method: 'POST', body: fd, headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) throw new Error(body.error ?? 'We couldn’t send that. Please try again.');
    sent(form);
  } catch (x) {
    if (err) err.textContent = (x as Error).message;
  } finally {
    if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = label ?? 'Send'; }
  }
});

// Clicks on tracked links: sign-up buttons report start_trial (the app records the finished sign-up).
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLElement>('[data-track]:not(form)');
  if (a) track(a.dataset.track!, { location: a.dataset.where ?? location.pathname });
});
