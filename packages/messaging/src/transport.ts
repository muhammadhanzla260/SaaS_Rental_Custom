/**
 * Delivery: SMTP (each workspace's own server, or a location's), Twilio and Quo
 * for texts, and a local outbox for development. MESSAGING_DELIVERY=live sends
 * for real; anything else (the default outside production) writes the message
 * to .data/outbox so demo customers never receive anything.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Transporter } from 'nodemailer';

export type SmtpAccount = {
  host: string | null; port: number; security: string; username: string | null; password: string | null; fromName: string | null; fromEmail: string | null;
};
export type Mail = { from: string; to: string; replyTo?: string; cc?: string[]; bcc?: string[]; subject: string; html: string; text: string; ref: string };
export type SmsAccount = { provider: string; sendingNumber: string | null; accountId: string | null; secret: string | null };

export const liveDelivery = () => (process.env.MESSAGING_DELIVERY ?? (process.env.NODE_ENV === 'production' ? 'live' : 'outbox')) === 'live';

/** .data/outbox at the repo root (the folder with pnpm-workspace.yaml), wherever the process runs from. */
function outboxDir() {
  if (process.env.MESSAGING_OUTBOX_DIR) return process.env.MESSAGING_OUTBOX_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6 && !existsSync(resolve(dir, 'pnpm-workspace.yaml')); i++) dir = dirname(dir);
  return resolve(dir, '.data/outbox');
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const safe = (s: string) => s.replace(/[^a-z0-9@.+-]/gi, '_').slice(0, 60);

export async function writeOutbox(kind: 'email' | 'sms', to: string, content: string) {
  const dir = outboxDir();
  await mkdir(dir, { recursive: true });
  const file = resolve(dir, `${stamp()}-${kind}-${safe(to)}.${kind === 'email' ? 'html' : 'txt'}`);
  await writeFile(file, content);
  return file;
}

async function smtpTransport(a: SmtpAccount, timeoutMs = 15000): Promise<Transporter> {
  const nodemailer = await import('nodemailer');
  return nodemailer.createTransport({
    host: a.host ?? undefined,
    port: a.port,
    secure: a.security === 'ssl',
    requireTLS: a.security === 'starttls',
    ignoreTLS: a.security === 'none',
    auth: a.username ? { user: a.username, pass: a.password ?? '' } : undefined,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs * 2,
  });
}

let platform: Transporter | null = null;
async function platformTransport() {
  const url = process.env.PLATFORM_SMTP_URL?.trim();
  if (!url) return null;
  if (!platform) platform = (await import('nodemailer')).createTransport(url);
  return platform;
}

/** Turn transport errors into something an owner can act on. */
export function explainMailError(e: unknown): { step: 'connect' | 'auth' | 'send'; message: string } {
  const err = e as { code?: string; responseCode?: number; message?: string; command?: string };
  const code = err.code ?? '';
  if (code === 'EAUTH' || err.responseCode === 535) return { step: 'auth', message: 'Sign-in was refused. Check the username, and use an app password if your provider requires one.' };
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) {
    return { step: 'connect', message: `Couldn’t reach the mail server (${code}). Check the host, port and security.` };
  }
  if (err.responseCode && err.responseCode >= 500) return { step: 'send', message: `The server refused the message: ${err.message ?? err.responseCode}` };
  return { step: 'send', message: err.message ?? 'Sending failed.' };
}

export async function sendMail(account: { mode: string; smtp: SmtpAccount } | null, mail: Mail): Promise<{ ref: string }> {
  if (!liveDelivery()) {
    const head = `<!-- From: ${mail.from} | To: ${mail.to}${mail.cc?.length ? ` | Cc: ${mail.cc.join(', ')}` : ''} | Subject: ${mail.subject} -->\n`;
    return { ref: `outbox:${await writeOutbox('email', mail.to, head + mail.html)}` };
  }
  const t = account?.mode === 'smtp' ? await smtpTransport(account.smtp) : await platformTransport();
  if (!t) throw Object.assign(new Error('No mail server is set up. Connect one in Settings → Email & SMS.'), { permanent: true });
  const info = await t.sendMail({
    from: mail.from, to: mail.to, replyTo: mail.replyTo || undefined, cc: mail.cc, bcc: mail.bcc, subject: mail.subject, html: mail.html, text: mail.text,
    headers: { 'X-Entity-Ref-ID': mail.ref },
  });
  return { ref: info.messageId ?? mail.ref };
}

export type TestStep = { key: 'connect' | 'auth' | 'send' | 'delivered'; label: string; ok: boolean | null };

/** Send test email (design 20): connect → sign in → send → delivered, each with pass/fail. */
export async function testSmtp(a: SmtpAccount, to: string, mail: Omit<Mail, 'to' | 'ref'>) {
  const steps: TestStep[] = [
    { key: 'connect', label: 'Connect', ok: null },
    { key: 'auth', label: 'Sign in', ok: null },
    { key: 'send', label: 'Send', ok: null },
    { key: 'delivered', label: 'Delivered', ok: null },
  ];
  const mark = (upTo: TestStep['key'], ok: boolean) => {
    for (const s of steps) {
      if (s.ok === null) s.ok = s.key === upTo ? ok : true;
      if (s.key === upTo) break;
    }
  };
  try {
    const t = await smtpTransport(a, 12000);
    await t.verify();
    mark('auth', true);
    const info = await t.sendMail({ ...mail, to, headers: { 'X-Entity-Ref-ID': `test-${Date.now()}` } });
    mark('send', true);
    const accepted = ((info.accepted ?? []) as unknown[]).map(String).some((x: string) => x.toLowerCase() === to.toLowerCase());
    mark('delivered', accepted);
    return { ok: accepted, steps, error: accepted ? null : 'The server did not accept the recipient.' };
  } catch (e) {
    const x = explainMailError(e);
    mark(x.step, false);
    return { ok: false, steps, error: x.message };
  }
}

export async function sendSms(account: SmsAccount | null, to: string, body: string): Promise<{ ref: string }> {
  if (!liveDelivery()) return { ref: `outbox:${await writeOutbox('sms', to, `To: ${to}\n\n${body}`)}` };
  if (!account || account.provider === 'none' || !account.secret || !account.sendingNumber) {
    throw Object.assign(new Error('Texts are not set up. Connect Twilio or Quo in Settings → Email & SMS.'), { permanent: true });
  }
  if (account.provider === 'twilio') {
    const sid = account.accountId ?? '';
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${account.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: account.sendingNumber, To: to, Body: body }),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) throw Object.assign(new Error(`Twilio: ${json.message ?? res.statusText}`), { permanent: res.status === 400 || res.status === 401 });
    return { ref: json.sid ?? 'twilio' };
  }
  // Quo (formerly OpenPhone)
  const res = await fetch('https://api.openphone.com/v1/messages', {
    method: 'POST',
    headers: { Authorization: account.secret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: body, from: account.sendingNumber, to: [to] }),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; message?: string };
  if (!res.ok) throw Object.assign(new Error(`Quo: ${json.message ?? res.statusText}`), { permanent: res.status === 400 || res.status === 401 });
  return { ref: json.data?.id ?? 'quo' };
}
