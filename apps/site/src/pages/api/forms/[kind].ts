/**
 * POST /api/forms/:kind — every website form (newsletter, early-access, demo, contact).
 * Works with and without JavaScript: fetch callers get JSON, plain form posts are redirected back
 * with ?sent=<kind> (or ?error=…) so the page can show its success state.
 */
import type { APIRoute } from 'astro';
import { FORMS, inboxFor, isFormKind } from '~/lib/server/forms';
import { checkSpam, HONEYPOT } from '~/lib/server/spam';
import { demoInvite, postToCrm, renderEmail, sendMail } from '~/lib/server/deliver';

export const prerender = false;

const META_KEYS = ['page', 'vertical', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer'];
const LABELS: Record<string, string> = {
  email: 'Email', name: 'Name', company: 'Company', phone: 'Phone', rents: 'What they rent', size: 'Business size',
  current_tool: 'Current tool', fleet_size: 'Fleet size', topic: 'Topic', message: 'Message', slot: 'Time (UTC)', timezone: 'Their time zone', source: 'Form location',
};

export const POST: APIRoute = async ({ params, request, clientAddress, redirect }) => {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  let fid = '';
  const back = (q: Record<string, string>) => {
    const ref = request.headers.get('referer');
    const url = new URL(ref && new URL(ref).origin === new URL(request.url).origin ? ref : '/', request.url);
    for (const [k, v] of Object.entries({ ...q, fid })) url.searchParams.set(k, v);
    return redirect(url.pathname + url.search + (fid ? `#${fid}` : ''), 303);
  };
  const reply = (status: number, body: { ok: boolean; error?: string; fields?: Record<string, string> }) =>
    wantsJson ? Response.json(body, { status }) : back(body.ok ? { sent: String(params.kind) } : { error: body.error ?? 'Something went wrong.' });

  const kind = params.kind;
  if (!isFormKind(kind)) return reply(404, { ok: false, error: 'Unknown form.' });
  const form = FORMS[kind];

  let fd: FormData;
  try { fd = await request.formData(); } catch { return reply(400, { ok: false, error: 'Unreadable submission.' }); }
  fid = String(fd.get('_fid') ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
  const spam = await checkSpam(fd, ip);
  if (!spam.ok) return spam.silent ? reply(200, { ok: true }) : reply(429, { ok: false, error: spam.reason });

  const raw: Record<string, string> = {};
  for (const [k, v] of fd) if (typeof v === 'string' && v.trim() && !k.startsWith('_') && k !== HONEYPOT && !k.startsWith('cf-') && !META_KEYS.includes(k)) raw[k] = v;
  const parsed = form.schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] ??= issue.message;
    return reply(422, { ok: false, error: Object.values(fields)[0] ?? 'Please check the form.', fields });
  }
  const data = parsed.data as Record<string, string | undefined>;
  const meta = Object.fromEntries(META_KEYS.map((k) => [k, String(fd.get(k) ?? '').slice(0, 300)]).filter(([, v]) => v));
  const rows = Object.entries(data).filter(([, v]) => v).map(([k, v]) => [LABELS[k] ?? k, String(v)] as [string, string]);

  const jobs: Promise<unknown>[] = [];
  jobs.push(postToCrm({ form: kind, list: kind === 'contact' ? `Contact · ${data.topic}` : form.list, submittedAt: new Date().toISOString(), fields: data, meta }));
  // Without a CRM, every submission (newsletter included) still lands in the sales inbox.
  const crmOn = !!import.meta.env.CRM_WEBHOOK_URL;
  const inbox = inboxFor(kind, data) ?? (crmOn ? null : import.meta.env.INBOX_SALES || 'sales@renthatch.com');
  if (inbox) {
    const mail = renderEmail(`New ${form.list.toLowerCase()} submission`, [`From the website (${meta.page ?? 'unknown page'}).`], [...rows, ...Object.entries(meta).map(([k, v]) => [k, v] as [string, string])]);
    jobs.push(sendMail({ to: inbox, replyTo: data.email, subject: `[Website] ${form.list}${data.company ? ` · ${data.company}` : ''}${data.name ? ` · ${data.name}` : ''}`, ...mail }));
  }
  const thanks = renderEmail(form.thanks.subject, [...form.thanks.lines], kind === 'newsletter' ? [] : rows.filter(([k]) => !['Form location', 'Time (UTC)'].includes(k)));
  jobs.push(sendMail({
    to: data.email!, subject: form.thanks.subject, ...thanks,
    attachments: kind === 'demo' ? [demoInvite(data.slot!, data.name!, data.company!)] : undefined,
  }));

  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  for (const f of failed) console.error(`[forms:${kind}]`, f.reason);
  // The visitor only sees an error if nothing reached us: the CRM post and the inbox copy both failed.
  const reachedUs = (crmOn && results[0]!.status === 'fulfilled') || (!!inbox && results[1]!.status === 'fulfilled');
  if (!reachedUs) return reply(502, { ok: false, error: 'We couldn’t send that just now. Please try again, or email hello@renthatch.com.' });
  return reply(200, { ok: true });
};

export const ALL: APIRoute = () => new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
