'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Code2, Download, FileUp, ListChecks, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  checkTemplateSource, MESSAGE_TYPES, renderMessage, SAMPLE_FIELDS, smsSegments, TEMPLATE_FIELDS,
  type Channel, type EmailBrand, type MessageType, type TemplateInput,
} from '@rental/core';
import { Button, Card, Checkbox, cx, Field, Input, Modal, Notice, Segmented, Textarea, useToast } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { timeAgo } from '@/lib/audit-text';
import { useForm } from '@/lib/form';
import { restoreTemplateAction, saveTemplateAction, sendTestTemplateAction } from '@/server/actions/messaging';

type Tpl = TemplateInput & { button: 'pay_link' | 'review_link' | null; custom: boolean; version: number; updatedByName: string | null; updatedAt: string | null };

const GROUPS: { label: string; types: MessageType[] }[] = [
  { label: 'Sent right away', types: ['quote', 'invoice', 'receipt', 'booking_confirmation', 'cancellation', 'card_declined'] },
  { label: 'Scheduled', types: ['pre_event', 'quality_check', 'day_before', 'charge_balance', 'review_request', 'thank_you', 'survey_reminder'] },
  { label: 'Alerts', types: ['declined_alert', 'last_minute', 'change_request', 'daily_digest'] },
];
const SAMPLE_SUMMARY = [{ label: 'Order', value: 'Q-AUS-01043' }, { label: 'Event', value: 'Saturday, Nov 7 · 1:00 – 6:00 PM' }, { label: 'Deposit to book', value: '$185.43' }];

export function TemplateEditor({
  slug, type, channel, template, edited, brand, fromLine, readOnly,
}: { slug: string; type: MessageType; channel: Channel; template: Tpl; edited: string[]; brand: EmailBrand; fromLine: string; readOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const initial: TemplateInput = {
    subject: template.subject, body: template.body, buttonText: template.buttonText, mode: template.mode, rawSource: template.rawSource, rawKind: template.rawKind,
    attachDocument: template.attachDocument, attachAgreement: template.attachAgreement, tracking: template.tracking, autoPlainText: template.autoPlainText,
  };
  const form = useForm<TemplateInput>(initial);
  const v = form.values;
  const [device, setDevice] = useState<'desktop' | 'phone' | 'text'>('desktop');
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'test' | 'restore' | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState<'subject' | 'body'>('body');
  const fileRef = useRef<HTMLInputElement>(null);
  const meta = MESSAGE_TYPES[type];

  const rendered = useMemo(
    () => renderMessage({ channel, template: { ...v, button: template.button }, values: SAMPLE_FIELDS, brand, summary: type === 'quote' ? SAMPLE_SUMMARY : [], links: { pay_link: '#', review_link: '#' } }),
    [v, channel, brand, template.button, type],
  );
  const checks = v.mode === 'raw' ? checkTemplateSource(v.rawSource, v.rawKind) : [];
  const seg = channel === 'sms' ? smsSegments(rendered.text) : null;

  function insert(field: string) {
    const token = `{${field}}`;
    const el = focus === 'subject' ? subjectRef.current : bodyRef.current;
    const key = focus === 'subject' ? 'subject' : 'body';
    const cur = v[key];
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    form.set(key, cur.slice(0, start) + token + cur.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  async function upload(f: File) {
    if (f.size > 400_000) return toast('Keep templates under 400 KB.', 'error');
    const text = await f.text();
    form.set('rawSource', text);
    form.set('rawKind', /\.xml$/i.test(f.name) || /^\s*<\?xml/.test(text) ? 'xml' : 'html');
    form.set('mode', 'raw');
  }
  const save = () => form.submit(() => saveTemplateAction(slug, type, channel, v), (r) => { toast(r.message ?? 'Saved.'); router.refresh(); });
  async function restore() {
    setBusy('restore');
    const r = await restoreTemplateAction(slug, type, channel);
    setBusy(null);
    toast(r.ok ? (r.message ?? 'Restored.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) router.refresh();
  }
  async function sendTest() {
    setBusy('test');
    const r = await sendTestTemplateAction(slug, channel, v, testTo);
    setBusy(null);
    toast(r.ok ? (r.message ?? 'Sent.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) setTestOpen(false);
  }

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Email & SMS', href: `/${slug}/settings/messaging?tab=auto` }, { label: 'Templates' }]}
        actions={
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-fg-2 lg:inline">
              {template.custom ? `v${template.version} · saved by ${template.updatedByName ?? 'someone'}${template.updatedAt ? ` · ${timeAgo(new Date(template.updatedAt))}` : ''}` : 'Default template'}
            </span>
            {template.custom && !readOnly && <Button variant="secondary" size="sm" onClick={restore} pending={busy === 'restore'}>Restore default</Button>}
            {channel === 'email' && <Button variant="secondary" size="sm" onClick={() => setTestOpen(true)} className="max-sm:hidden">Send test</Button>}
            {!readOnly && <Button size="sm" onClick={save} pending={form.pending} disabled={!form.dirty}>Save template</Button>}
          </div>
        }
      />
      <PageBody wide>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[230px_minmax(0,1fr)_minmax(0,1fr)]">
          <nav aria-label="Templates" className="flex flex-col gap-4 max-xl:hidden">
            {GROUPS.map((g) => (
              <div key={g.label}>
                <p className="eyebrow mb-2 px-3">{g.label}</p>
                <ul className="flex flex-col gap-0.5">
                  {g.types.flatMap((t) => (MESSAGE_TYPES[t].channels as readonly Channel[]).map((c) => ({ t, c }))).map(({ t, c }) => {
                    const on = t === type && c === channel;
                    return (
                      <li key={`${t}:${c}`}>
                        <Link href={`/${slug}/settings/messaging/templates?type=${t}&channel=${c}`}
                          className={cx('flex items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors', on ? 'bg-surface font-semibold text-fg shadow-[0_1px_3px_rgb(16_19_26/0.08)]' : 'text-fg-2 hover:bg-hover hover:text-fg')}>
                          <span className="truncate">{MESSAGE_TYPES[t].label}{edited.includes(`${t}:${c}`) && <span className="ml-1 text-accent-text">•</span>}</span>
                          <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', c === 'sms' ? 'bg-teal-bg text-teal-fg' : 'bg-info-bg text-info-fg')}>{c}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <Card className="flex min-w-0 flex-col gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="font-display text-[28px] font-extrabold tracking-tight text-fg">{meta.label}{channel === 'sms' && ' · text'}</h1>
              <p className="text-[13px] text-fg-2">{meta.when}</p>
            </div>
            {readOnly && <Notice>Read-only.</Notice>}
            <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
              {channel === 'email' && (
                <div role="radiogroup" aria-label="Template type" className="grid grid-cols-2 gap-1 rounded-[calc(var(--radius-control)+4px)] bg-sunken p-1">
                  {([['builder', 'Builder', 'Write text, we style it', ListChecks], ['raw', 'Upload HTML or XML', 'Sent exactly as uploaded', Code2]] as const).map(([m, label, sub, Icon]) => (
                    <button key={m} type="button" role="radio" aria-checked={v.mode === m} onClick={() => form.set('mode', m)}
                      className={cx('flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left transition-colors', v.mode === m ? 'bg-surface shadow-[0_1px_3px_rgb(16_19_26/0.15)]' : 'text-fg-2 hover:text-fg')}>
                      <Icon className="size-4 shrink-0" />
                      <span className="min-w-0"><span className="block text-sm font-semibold text-fg">{label}</span><span className="block truncate text-[12px] text-fg-2">{sub}</span></span>
                    </button>
                  ))}
                </div>
              )}
              {channel === 'email' && (
                <Field label="Subject" htmlFor="tp-subject" error={form.error('subject')}>
                  <Input id="tp-subject" ref={subjectRef} value={v.subject} onFocus={() => setFocus('subject')} onChange={(e) => form.set('subject', e.target.value)} />
                </Field>
              )}
              {v.mode === 'builder' || channel === 'sms' ? (
                <>
                  <Field label={channel === 'sms' ? 'Text' : 'Message'} htmlFor="tp-body" hint={channel === 'sms' ? `${seg?.length} characters · ${seg?.segments} segment${seg?.segments === 1 ? '' : 's'} (${seg?.encoding})` : 'Fields in braces are filled in for each order. The order summary is added below your message.'}>
                    <Textarea id="tp-body" ref={bodyRef} rows={channel === 'sms' ? 4 : 9} value={v.body} onFocus={() => setFocus('body')} onChange={(e) => form.set('body', e.target.value)} />
                  </Field>
                  <div>
                    <p className="mb-2 text-[13px] font-semibold text-fg">Insert a field</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TEMPLATE_FIELDS.map((f) => (
                        <button key={f.key} type="button" onClick={() => insert(f.key)} title={f.label} className="press mono rounded-md border border-dashed border-accent/50 bg-accent-soft/30 px-2 py-1 text-[12px] text-accent-text hover:bg-accent-soft">
                          {`{${f.key}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                  {channel === 'email' && (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Button text" htmlFor="tp-button" hint={template.button ? (template.button === 'pay_link' ? 'Links to the sign & pay page.' : 'Links to your review page.') : 'This message has no button.'}>
                        <Input id="tp-button" value={v.buttonText} disabled={!template.button} onChange={(e) => form.set('buttonText', e.target.value)} />
                      </Field>
                      <div className="flex flex-col gap-2">
                        <p className="text-[13px] font-semibold text-fg">Attach</p>
                        <Checkbox checked={v.attachDocument} onChange={(x) => form.set('attachDocument', x)}>Quote / invoice PDF</Checkbox>
                        <Checkbox checked={v.attachAgreement} onChange={(x) => form.set('attachAgreement', x)}>Signed rental agreement</Checkbox>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="press flex cursor-pointer items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-control px-4 py-4 hover:bg-hover"
                      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); }}>
                      <FileUp className="size-5 text-fg-2" aria-hidden />
                      <span className="text-sm text-fg"><b>Drop a .html or .xml file</b> or click to choose. You can also paste the code below.</span>
                      <input ref={fileRef} type="file" accept=".html,.htm,.xml,text/html,application/xml" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
                    </label>
                    <div className="flex items-center gap-2">
                      <Segmented label="Source type" size="sm" value={v.rawKind} onChange={(k) => form.set('rawKind', k)} options={[{ value: 'html', label: 'HTML' }, { value: 'xml', label: 'XML' }]} />
                      <span className="flex-1" />
                      <Button variant="ghost" size="sm" icon={<Download className="size-3.5" />} disabled={!v.rawSource}
                        onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([v.rawSource], { type: 'text/html' })); a.download = `${type}.${v.rawKind}`; a.click(); }}>Download</Button>
                      <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} disabled={!v.rawSource} onClick={() => form.set('rawSource', '')}>Remove</Button>
                    </div>
                    <Textarea aria-label="Template source" rows={12} spellCheck={false} value={v.rawSource} onChange={(e) => form.set('rawSource', e.target.value)} className="mono text-[12px]" placeholder="<html>…</html>" />
                  </div>
                  <ul className="flex flex-col gap-1.5 rounded-[var(--radius-card)] bg-sunken/60 p-3">
                    {checks.map((c) => (
                      <li key={c.key} className="flex items-start gap-2 text-[13px]">
                        <span className={cx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full', c.level === 'pass' ? 'bg-success text-white' : c.level === 'warn' ? 'bg-warning text-white' : 'bg-danger text-white')}>
                          {c.level === 'pass' ? <Check className="size-2.5" strokeWidth={4} /> : c.level === 'warn' ? <AlertTriangle className="size-2.5" /> : <X className="size-2.5" strokeWidth={4} />}
                        </span>
                        <span className="text-fg">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-2">
                    <p className="text-[13px] text-fg-2">Sent as uploaded: we only add the legally required business address footer.</p>
                    <Checkbox checked={v.autoPlainText} onChange={(x) => form.set('autoPlainText', x)}>Make a plain-text version automatically</Checkbox>
                    <Checkbox checked={v.tracking} onChange={(x) => form.set('tracking', x)}>Track opens and clicks</Checkbox>
                  </div>
                </>
              )}
            </fieldset>
            {form.status?.kind === 'error' && <Notice kind="danger">{form.status.text}</Notice>}
          </Card>

          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="eyebrow">Preview · Maria’s order</p>
              {channel === 'email' && (
                <Segmented label="Preview size" size="sm" value={device} onChange={setDevice} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'phone', label: 'Phone' }, { value: 'text', label: 'Plain text' }]} />
              )}
            </div>
            <div className="rounded-[var(--radius-panel)] bg-sunken p-3 sm:p-4">
              {channel === 'sms' ? (
                <div className="mx-auto flex max-w-[320px] flex-col gap-2 rounded-[28px] border-8 border-night bg-surface p-4">
                  <p className="text-center text-[11px] text-fg-3">Text message</p>
                  <div className="anim-pop self-start rounded-[18px] rounded-bl-[6px] bg-[#E9E9EB] px-3.5 py-2 text-[14px] leading-snug text-[#10131A]">{rendered.text}</div>
                  <p className="text-center text-[11px] text-fg-3">{seg?.segments} segment{seg?.segments === 1 ? '' : 's'} · {seg?.encoding}</p>
                </div>
              ) : (
                <div className={cx('mx-auto overflow-hidden rounded-[14px] border border-subtle bg-white shadow-[var(--shadow-float)] transition-[max-width] duration-300', device === 'phone' ? 'max-w-[380px]' : 'max-w-full')}>
                  <div className="border-b border-[#EEF0F3] px-4 py-3 text-[13px] text-[#10131A]">
                    <p><b>{fromLine}</b></p>
                    <p className="truncate font-semibold">{rendered.subject || 'No subject'}</p>
                  </div>
                  {device === 'text' ? (
                    <pre className="max-h-[70dvh] overflow-auto whitespace-pre-wrap p-4 text-[13px] text-[#10131A]">{rendered.text}</pre>
                  ) : (
                    <iframe title="Email preview" sandbox="" srcDoc={rendered.html ?? ''} className="h-[70dvh] w-full bg-white" />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </PageBody>

      <Modal open={testOpen} onClose={() => setTestOpen(false)} title="Send a test" sub="Sample values from Maria’s order; your unsaved edits are included."
        footer={<><Button variant="secondary" onClick={() => setTestOpen(false)}>Cancel</Button><Button onClick={sendTest} pending={busy === 'test'}>Send test</Button></>}>
        <Field label="Send to" htmlFor="tp-test-to"><Input id="tp-test-to" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourbusiness.com" /></Field>
      </Modal>
    </>
  );
}
