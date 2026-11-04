/**
 * Spam protection for public forms, in layers:
 *   1. honeypot: a hidden field people never fill;
 *   2. timing: the page script stamps when the form appeared, and humans take more than 2.5 s;
 *   3. Cloudflare Turnstile, when TURNSTILE_SECRET is set;
 *   4. a per-IP rate limit (best effort: per server instance).
 */
const env = import.meta.env as Record<string, string | undefined>;
export const HONEYPOT = 'company_website';

export type Verdict = { ok: true } | { ok: false; silent: boolean; reason: string };

const hits = new Map<string, number[]>();
function rateLimited(ip: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > max;
}

export async function checkSpam(fd: FormData, ip: string): Promise<Verdict> {
  // Bots get a normal-looking success so they don't learn what tripped them.
  if (String(fd.get(HONEYPOT) ?? '').trim()) return { ok: false, silent: true, reason: 'honeypot' };
  const shown = Number(fd.get('_t'));
  const age = Date.now() - shown;
  if (!shown || age < 2500 || age > 24 * 3_600_000) return { ok: false, silent: true, reason: 'timing' };
  if (rateLimited(ip)) return { ok: false, silent: false, reason: 'Too many submissions from your network. Please try again in a few minutes.' };
  const secret = env.TURNSTILE_SECRET;
  if (secret) {
    const token = String(fd.get('cf-turnstile-response') ?? '');
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body }).then((r) => r.json()).catch(() => null);
    if (!res?.success) return { ok: false, silent: false, reason: 'We couldn’t confirm you’re human. Please try again.' };
  }
  return { ok: true };
}
