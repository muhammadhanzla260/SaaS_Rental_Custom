/**
 * Form delivery: the CRM webhook, a copy to the team inbox and a thank-you email.
 * Mail uses PLATFORM_SMTP_URL (the same platform mailer the app uses). Outside production,
 * or unless MESSAGING_DELIVERY=live, emails are written to .data/outbox instead of sent.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Transporter } from 'nodemailer';

// Read at runtime (process.env), so secrets are never baked into the build.
const env = process.env;
// Live when asked to, or when a mail server is configured; otherwise emails land in .data/outbox.
const live = () => env.MESSAGING_DELIVERY === 'live' || (env.MESSAGING_DELIVERY !== 'outbox' && !!env.PLATFORM_SMTP_URL?.trim());
const FROM = () => env.SITE_MAIL_FROM || 'Rent Hatch <hello@renthatch.com>';

export type Attachment = { filename: string; content: string; contentType: string };
export type Mail = { to: string; subject: string; html: string; text: string; replyTo?: string; attachments?: Attachment[] };

function outboxDir() {
  if (env.MESSAGING_OUTBOX_DIR) return env.MESSAGING_OUTBOX_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6 && !existsSync(resolve(dir, 'pnpm-workspace.yaml')); i++) dir = dirname(dir);
  return resolve(dir, '.data/outbox');
}

let transport: Transporter | null = null;
export async function sendMail(m: Mail) {
  if (!live()) {
    const dir = outboxDir();
    await mkdir(dir, { recursive: true });
    const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-site-${m.to.replace(/[^a-z0-9@.+-]/gi, '_')}.html`);
    await writeFile(file, `<!-- From: ${FROM()} | To: ${m.to} | Subject: ${m.subject} -->\n${m.html}`);
    return;
  }
  const url = env.PLATFORM_SMTP_URL?.trim();
  if (!url) throw new Error('PLATFORM_SMTP_URL is not set');
  transport ??= (await import('nodemailer')).createTransport(url);
  await transport.sendMail({ from: FROM(), ...m });
}

/** POST the submission to the CRM (HubSpot / Zapier / Make / any webhook). Skipped when unset. */
export async function postToCrm(payload: Record<string, unknown>) {
  const url = env.CRM_WEBHOOK_URL?.trim();
  if (!url) return false;
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`CRM webhook answered ${res.status}`);
  return true;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A plain branded email: heading, paragraphs, optional key/value table. */
export function renderEmail(title: string, paras: string[], rows: [string, string][] = []) {
  const table = rows.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 16px">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-top:1px solid #E3E5DC;color:#535C6B;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #E3E5DC;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#FAFAF6;font-family:Helvetica,Arial,sans-serif;color:#10131A">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="font-weight:800;font-size:20px;letter-spacing:-.02em;margin-bottom:24px"><span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:#D4FF3A;vertical-align:-4px;margin-right:8px"></span>Rent Hatch</div>
<div style="background:#fff;border:1px solid #E3E5DC;border-radius:18px;padding:28px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(title)}</h1>
${paras.map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#353C48">${esc(p)}</p>`).join('')}${table}
</div>
<p style="font-size:12px;color:#8A93A3;margin:18px 4px 0">Rent Hatch · rental software for event and equipment rental businesses</p>
</div></body></html>`;
  const text = [title, '', ...paras, ...(rows.length ? ['', ...rows.map(([k, v]) => `${k}: ${v}`)] : [])].join('\n');
  return { html, text };
}

/** A calendar invite for a booked demo (30 minutes). */
export function demoInvite(startIso: string, name: string, company: string) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + 30 * 60_000);
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rent Hatch//Demo//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `UID:demo-${f(start)}-${Math.random().toString(36).slice(2, 10)}@renthatch.com`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:Rent Hatch demo · ${company}`,
    `DESCRIPTION:A 30-minute walkthrough of Rent Hatch for ${name}.`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return { filename: 'rent-hatch-demo.ics', content: ics, contentType: 'text/calendar; method=REQUEST' };
}
