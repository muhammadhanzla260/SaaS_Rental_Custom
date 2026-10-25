'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  checkAccent, defaultTemplate, mailAccountSchema, MESSAGE_TYPES, messagingSettingsSchema, renderMessage, SAMPLE_FIELDS, smsAccountSchema,
  templateSchema, type Channel, type MessageType,
} from '@rental/core';
import {
  getMailCredentials, getMessage, recordMailCheck, replanAll, resendMessage, restoreTemplate, saveMailAccount, saveSmsAccount, saveTemplate,
  updatePreferences,
} from '@rental/db';
import { dispatchMessage, sendMail, testSmtp, type TestStep } from '@rental/messaging';
import { invalid, type ActionResult } from '@/lib/result';
import { requireSettingsAccess, requireView } from '../context';
import { db } from '../db';
import { run } from './run';

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');
const typeSchema = z.enum(Object.keys(MESSAGE_TYPES) as [MessageType, ...MessageType[]]);
const channelSchema = z.enum(['email', 'sms']);

/** Automations, schedules, quiet hours and recipients. Re-plans every upcoming order. */
export async function saveMessagingAction(slug: string, input: unknown): Promise<ActionResult<{ planned: number }>> {
  return run<{ planned: number }>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = messagingSettingsSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'messaging', parsed.data);
    const r = await replanAll(db, ctx.tenant.id);
    refresh(slug);
    return {
      ok: true,
      data: { planned: r.planned },
      message: parsed.data.live ? `Saved. ${r.planned} scheduled message${r.planned === 1 ? '' : 's'} across ${r.orders} order${r.orders === 1 ? '' : 's'}.` : 'Saved. Automations are off.',
    };
  });
}

const mailForm = z.object({
  mail: mailAccountSchema,
  replyTo: z.union([z.literal(''), z.email('Enter a valid email address.')]).default(''),
  cc: z.string().max(500).default(''),
  bcc: z.string().max(500).default(''),
  alertsTo: z.string().max(500).default(''),
  sms: smsAccountSchema,
});
const emails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

export async function saveMailServerAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = mailForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const f = parsed.data;
    const lists = { cc: emails(f.cc), bcc: emails(f.bcc), alertsTo: emails(f.alertsTo) };
    for (const [k, list] of Object.entries(lists)) {
      const bad = list.find((e) => !z.email().safeParse(e).success);
      if (bad) return { ok: false, error: 'Some fields need attention.', fieldErrors: { [k]: `“${bad}” is not a valid email address.` } };
    }
    await saveMailAccount(db, ctx.tenant.id, ctx.actor, null, { ...f.mail, replyTo: f.replyTo || undefined });
    await saveSmsAccount(db, ctx.tenant.id, ctx.actor, f.sms);
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'messaging', { ...ctx.prefs.messaging, replyTo: f.replyTo, ...lists });
    refresh(slug);
    return { ok: true, message: 'Mail server and texts saved.' };
  });
}

export type TestResult = { ok: boolean; steps: TestStep[]; error: string | null };

/** Send test email: connect, sign in, send, delivered — each step pass/fail. */
export async function testEmailAction(slug: string, to: string): Promise<ActionResult<TestResult>> {
  return run<TestResult>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const addr = z.email('Enter the address to send the test to.').safeParse(to.trim());
    if (!addr.success) return { ok: false, error: addr.error.issues[0]!.message };
    const acc = await getMailCredentials(db, ctx.tenant.id, null);
    if (!acc || acc.mode !== 'smtp' || !acc.host) return { ok: false, error: 'Save your mail server first.' };
    const color = ctx.tenant.brandColor || '#2C4FE0';
    const rendered = renderMessage({
      channel: 'email',
      template: { ...defaultTemplate('quote', 'email'), subject: `Test email from ${ctx.tenant.name}`, body: `Hi,\n\nThis is a test from ${ctx.tenant.name}. If you can read this, quotes, invoices and reminders will reach your customers.` , buttonText: '' },
      values: SAMPLE_FIELDS,
      brand: { orgName: ctx.tenant.name, brandColor: color, onBrand: checkAccent(color).onAccent },
      links: {},
    });
    const r = await testSmtp(
      { host: acc.host, port: acc.port, security: acc.security, username: acc.username, password: acc.password, fromName: acc.fromName, fromEmail: acc.fromEmail },
      addr.data,
      { from: `"${(acc.fromName || ctx.tenant.name).replace(/"/g, '')}" <${acc.fromEmail ?? acc.username}>`, subject: rendered.subject, html: rendered.html!, text: rendered.text },
    );
    await recordMailCheck(db, ctx.tenant.id, acc.id, r.ok, r.error);
    refresh(slug);
    return { ok: true, data: r };
  });
}

export async function saveTemplateAction(slug: string, type: unknown, channel: unknown, input: unknown): Promise<ActionResult<{ version: number }>> {
  return run<{ version: number }>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const t = typeSchema.parse(type);
    const c = channelSchema.parse(channel);
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (c === 'email' && parsed.data.mode === 'builder' && !parsed.data.subject) return { ok: false, error: 'Some fields need attention.', fieldErrors: { subject: 'Add a subject line.' } };
    if (parsed.data.mode === 'raw' && !parsed.data.rawSource.trim()) return { ok: false, error: 'Upload or paste the HTML first.' };
    const row = await saveTemplate(db, ctx.tenant.id, ctx.actor, t, c, parsed.data);
    refresh(slug);
    return { ok: true, data: { version: row.version }, message: `Template saved (v${row.version}).` };
  });
}

export async function restoreTemplateAction(slug: string, type: unknown, channel: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    await restoreTemplate(db, ctx.tenant.id, ctx.actor, typeSchema.parse(type), channelSchema.parse(channel));
    refresh(slug);
    return { ok: true, message: 'Default template restored.' };
  });
}

/** Send the template being edited (with sample values) to one address. */
export async function sendTestTemplateAction(slug: string, channel: unknown, input: unknown, to: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const c = channelSchema.parse(channel) as Channel;
    if (c === 'sms') return { ok: false, error: 'Test texts arrive with SMS delivery checks. Use the SMS preview for now.' };
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const addr = z.email('Enter an email address.').safeParse(to.trim());
    if (!addr.success) return { ok: false, error: addr.error.issues[0]!.message };
    const color = ctx.tenant.brandColor || '#2C4FE0';
    const out = renderMessage({
      channel: 'email', template: { ...parsed.data, button: 'pay_link' }, values: SAMPLE_FIELDS,
      brand: { orgName: ctx.tenant.name, brandColor: color, onBrand: checkAccent(color).onAccent },
      summary: [{ label: 'Order', value: 'Q-AUS-01043' }, { label: 'Deposit to book', value: '$185.43' }], links: { pay_link: '#' },
    });
    const acc = await getMailCredentials(db, ctx.tenant.id, null);
    const r = await sendMail(acc ? { mode: acc.mode, smtp: acc } : null, {
      from: `"${(acc?.fromName || ctx.tenant.name).replace(/"/g, '')}" <${acc?.fromEmail ?? 'no-reply@localhost'}>`, to: addr.data,
      subject: `[Test] ${out.subject}`, html: out.html!, text: out.text, ref: `template-test-${Date.now()}`,
    });
    return { ok: true, message: r.ref.startsWith('outbox:') ? 'Test written to the local outbox (development).' : `Test sent to ${addr.data}.` };
  });
}

export async function resendMessageAction(slug: string, id: string): Promise<ActionResult<{ status: string }>> {
  return run<{ status: string }>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const row = await resendMessage(db, ctx.tenant.id, ctx.actor, z.string().uuid().parse(id));
    const result = await dispatchMessage(db, ctx.tenant.id, row.id);
    refresh(slug);
    return { ok: true, data: { status: String(result) }, message: result === 'sent' ? 'Sent again.' : `Queued again (${result}).` };
  });
}

export type MessageView = { id: string; subject: string | null; html: string | null; text: string | null; toAddress: string | null; status: string; lastError: string | null; idempotencyKey: string };

export async function getMessageAction(slug: string, id: string): Promise<ActionResult<MessageView>> {
  return run<MessageView>(async () => {
    const ctx = await requireView(slug, 'settings.manage');
    const m = await getMessage(db, ctx.tenant.id, z.string().uuid().parse(id));
    if (!m) return { ok: false, error: 'Message not found.' };
    return { ok: true, data: { id: m.id, subject: m.subject, html: m.html, text: m.text, toAddress: m.toAddress, status: m.status, lastError: m.lastError, idempotencyKey: m.idempotencyKey } };
  });
}
