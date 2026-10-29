import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Platform email (verification, invitations, owner invites). Org email to
 * customers goes through each org's own SMTP in Phase 2, not through here.
 * Without PLATFORM_SMTP_URL (development), messages are written to
 * .data/mail/ so links can still be opened.
 */

export type PlatformMail = { to: string; subject: string; html: string; text: string };

let transport: import('nodemailer').Transporter | null = null;

async function getTransport() {
  const url = process.env.PLATFORM_SMTP_URL?.trim();
  if (!url) return null;
  if (!transport) {
    const nodemailer = await import('nodemailer');
    transport = nodemailer.createTransport(url);
  }
  return transport;
}

export async function sendPlatformEmail(mail: PlatformMail): Promise<{ delivered: boolean; previewPath?: string }> {
  const t = await getTransport();
  if (t) {
    await t.sendMail({ from: process.env.PLATFORM_MAIL_FROM || 'Tentpole <no-reply@localhost>', ...mail });
    return { delivered: true };
  }
  const dir = resolve(process.cwd(), '../../.data/mail');
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mail.to.replace(/[^a-z0-9@.-]/gi, '_')}.html`);
  await writeFile(file, `<!-- To: ${mail.to} | Subject: ${mail.subject} -->\n${mail.html}`);
  console.info(`[mail] ${mail.subject} → ${mail.to} (dev outbox: ${file})`);
  return { delivered: false, previewPath: file };
}

/**
 * For emails that carry a link the screen can also show (invites): a refused
 * recipient or a mail-server outage must not undo the work already saved, so
 * the failure is logged and the caller offers "copy link" instead.
 */
export async function sendPlatformEmailOrLink(mail: PlatformMail): Promise<{ delivered: boolean }> {
  try {
    return await sendPlatformEmail(mail);
  } catch (e) {
    console.error(`[mail] ${mail.subject} → ${mail.to} not sent: ${(e as Error).message.split('\n')[0]}`);
    return { delivered: false };
  }
}

export function appUrl(path = '') {
  return `${(process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${path}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Plain, branded-neutral layout for platform emails. */
export function platformEmail(opts: { title: string; lines: string[]; cta: { label: string; url: string }; footer?: string }): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#F3F4F6;font-family:Geist,Segoe UI,Helvetica,Arial,sans-serif;color:#10131A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #E2E5EA;border-radius:18px">
<tr><td style="padding:28px 28px 8px"><div style="display:inline-block;background:#D4FF3A;border-radius:8px;padding:6px 10px;font-weight:700;font-size:13px;color:#0B0D12">Tentpole</div>
<h1 style="font-size:22px;line-height:1.25;margin:20px 0 12px">${esc(opts.title)}</h1>
${opts.lines.map((l) => `<p style="font-size:15px;line-height:1.55;color:#353C48;margin:0 0 12px">${esc(l)}</p>`).join('')}
<p style="margin:22px 0 26px"><a href="${esc(opts.cta.url)}" style="display:inline-block;background:#2C4FE0;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:10px">${esc(opts.cta.label)}</a></p>
<p style="font-size:12px;color:#535C6B;margin:0 0 24px;word-break:break-all">Or open this link: ${esc(opts.cta.url)}</p>
</td></tr></table>
<p style="font-size:12px;color:#7D8594;margin-top:16px">${esc(opts.footer ?? 'You received this because someone used your email on Tentpole.')}</p>
</td></tr></table></body></html>`;
  const text = [opts.title, '', ...opts.lines, '', `${opts.cta.label}: ${opts.cta.url}`].join('\n');
  return { html, text };
}
