'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, Eye, Pencil, RotateCw, Search, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  describeRule, INSTANT_TYPES, MESSAGE_TYPES, SCHEDULED_TYPES, type MessageType, type ResolvedMessaging, type ScheduleRule,
} from '@rental/core';
import { scope } from '@/components/fields/scope';
import {
  Button, Card, cx, Drawer, EmptyState, Field, FilterChips, Input, Notice, PageTitle, Pill, SaveBar, Select, Spinner, Tabs, Toggle, useToast,
} from '@/components/kit';
import { MailFields, SmsFields, type ConnectDraft } from '@/components/settings/connect-fields';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { timeAgo } from '@/lib/audit-text';
import { useForm } from '@/lib/form';
import {
  getMessageAction, resendMessageAction, saveMailServerAction, saveMessagingAction, testEmailAction, type MessageView, type TestResult,
} from '@/server/actions/messaging';

type Tab = 'server' | 'auto' | 'log';
export type LogRow = {
  id: string; status: string; channel: string; type: MessageType; toAddress: string | null; subject: string | null; orderNumber: string | null;
  orderId: string | null; when: string; key: string; lastError: string | null; attempts: number;
};
type ServerDraft = { mail: ConnectDraft['mail'] & { lastError?: string | null }; replyTo: string; cc: string; bcc: string; alertsTo: string; sms: ConnectDraft['sms'] };

const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  sent: 'success', delivered: 'success', queued: 'info', sending: 'info', failed: 'danger', bounced: 'danger', skipped: 'neutral', cancelled: 'neutral',
};
const STATUS_LABEL: Record<string, string> = { queued: 'Queued', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', bounced: 'Bounced', skipped: 'Skipped', cancelled: 'Cancelled' };

export function MessagingSettings({
  slug, tab, orgName, timezone, readOnly, outbox, settings, server, locations, customTemplates, log,
}: {
  slug: string; tab: Tab; orgName: string; timezone: string; readOnly: boolean; outbox: boolean; settings: ResolvedMessaging; server: ServerDraft;
  locations: { id: string; name: string; code: string; own: { fromEmail: string | null; verified: boolean } | null }[];
  customTemplates: string[]; log: { rows: LogRow[]; counts: { all: number; upcoming: number; sent: number; failed: number; skipped: number }; status: string; q: string };
}) {
  const verified = !!server.mail.verifiedAt && server.mail.mode === 'smtp';
  const scheduledOn = SCHEDULED_TYPES.filter((t) => settings.schedules[t]?.enabled).length;
  const instantOn = INSTANT_TYPES.filter((t) => settings.instant[t]).length;
  const steps = [
    { title: 'Connect mail server', sub: verified ? 'Verified' : server.mail.mode === 'smtp' ? 'Send a test email' : 'Using Tentpole for now', done: verified },
    { title: 'Choose what to send', sub: `${scheduledOn} scheduled · ${instantOn} instant`, done: true },
    { title: 'Review templates', sub: customTemplates.length ? `${customTemplates.length} edited · branded with your logo` : 'Branded with your logo', done: true },
    { title: 'Go live', sub: settings.live ? 'Sending automatically' : 'Switch on under Automations', done: settings.live },
  ];
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Settings', href: `/${slug}/settings` }, { label: 'Email, SMS & automations' }]}
        actions={
          <span className={cx('flex items-center gap-2 text-[13px] font-semibold', settings.live ? 'text-success-fg' : 'text-warning-fg')}>
            <span className={cx('size-2 rounded-full', settings.live ? 'anim-glow bg-success' : 'bg-warning-mark')} aria-hidden />
            {settings.live ? 'Automations are live' : 'Not live yet'}
          </span>
        }
      />
      <PageBody wide>
        <PageTitle title="Email, SMS & automations" sub="Set this up once. Quotes, invoices, receipts and reminders then go out on their own, from your own mail server, on the schedule you choose." />
        {outbox && (
          <Notice className="mb-5">Development mode: emails and texts are written to <code className="mono">.data/outbox</code> instead of being delivered. Set <code className="mono">MESSAGING_DELIVERY=live</code> to send for real.</Notice>
        )}
        <ol className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className={cx('anim-rise flex items-center gap-3 rounded-[var(--radius-card)] border p-4', s.done ? 'border-success/30 bg-success-bg/60' : 'border-subtle bg-surface')} style={{ ['--d' as string]: `${i * 60}ms` }}>
              <span className={cx('grid size-8 shrink-0 place-items-center rounded-full', s.done ? 'bg-success text-white' : 'border-2 border-dashed border-control text-fg-3')}>
                {s.done ? <Check className="size-4" strokeWidth={3} /> : <span className="mono text-xs">{i + 1}</span>}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{s.title}</span>
                <span className="block truncate text-[13px] text-fg-2">{s.sub}</span>
              </span>
            </li>
          ))}
        </ol>
        <Tabs
          label="Email and SMS sections"
          value={tab}
          className="mb-6"
          tabs={[
            { value: 'server', label: 'Mail server & SMS', href: `/${slug}/settings/messaging` },
            { value: 'auto', label: 'Automations & schedules', href: `/${slug}/settings/messaging?tab=auto` },
            { value: 'log', label: 'Message log', href: `/${slug}/settings/messaging?tab=log`, badge: log.counts.failed ? <span className="rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">{log.counts.failed}</span> : undefined },
          ]}
        />
        {tab === 'server' && <ServerTab slug={slug} orgName={orgName} initial={server} locations={locations} readOnly={readOnly} />}
        {tab === 'auto' && <AutomationsTab slug={slug} initial={settings} customTemplates={customTemplates} readOnly={readOnly} timezone={timezone} />}
        {tab === 'log' && <LogTab slug={slug} log={log} readOnly={readOnly} timezone={timezone} />}
      </PageBody>
    </>
  );
}

// --- Mail server & SMS ---------------------------------------------------------------------------------

function ServerTab({ slug, orgName, initial, locations, readOnly }: { slug: string; orgName: string; initial: ServerDraft; locations: { id: string; name: string; code: string; own: { fromEmail: string | null; verified: boolean } | null }[]; readOnly: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const form = useForm<ServerDraft>(initial);
  const v = form.values;
  const [testTo, setTestTo] = useState('');
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const save = () =>
    form.submit(
      () => saveMailServerAction(slug, { ...v, mail: { ...v.mail, password: v.mail.password || undefined }, sms: { ...v.sms, apiKey: v.sms.apiKey || undefined } }),
      (r) => { toast(r.message ?? 'Saved.'); router.refresh(); },
    );
  async function runTest() {
    if (form.dirty) return toast('Save your changes first, then send the test.', 'info');
    setTesting(true);
    setTest(null);
    const r = await testEmailAction(slug, testTo);
    setTesting(false);
    if (!r.ok) return toast(r.error, 'error');
    setTest(r.data!);
    router.refresh();
  }
  const verified = !!initial.mail.verifiedAt;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold text-fg">Mail server (SMTP)</h2>
          <p className="mt-1 text-[13px] text-fg-2">Used for every customer email from this workspace. Locations can use their own account.</p>
        </div>
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
          <MailFields s={scope(form, 'mail')} orgName={orgName} />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="Reply-to" htmlFor="ms-reply" optional error={form.error('replyTo')}>
              <Input id="ms-reply" type="email" value={v.replyTo} onChange={(e) => form.set('replyTo', e.target.value)} placeholder="office@yourbusiness.com" />
            </Field>
            <Field label="CC on customer emails" htmlFor="ms-cc" optional error={form.error('cc')}>
              <Input id="ms-cc" value={v.cc} onChange={(e) => form.set('cc', e.target.value)} placeholder="office@…" />
            </Field>
            <Field label="BCC" htmlFor="ms-bcc" optional error={form.error('bcc')}>
              <Input id="ms-bcc" value={v.bcc} onChange={(e) => form.set('bcc', e.target.value)} placeholder="archive@…" />
            </Field>
          </div>
          <Field label="Internal alerts go to" htmlFor="ms-alerts" hint="Declined cards, last-minute bookings, change requests and tomorrow’s events. Separate several with commas." error={form.error('alertsTo')}>
            <Input id="ms-alerts" value={v.alertsTo} onChange={(e) => form.set('alertsTo', e.target.value)} placeholder="office@yourbusiness.com" />
          </Field>
        </fieldset>

        {v.mail.mode === 'smtp' && (
          <div className={cx('flex flex-col gap-3 rounded-[var(--radius-card)] p-4 sm:flex-row sm:items-center', test ? (test.ok ? 'bg-success-bg' : 'bg-danger-bg') : verified ? 'bg-success-bg' : 'bg-warning-bg')}>
            <div className="min-w-0 flex-1">
              <p className={cx('text-sm font-semibold', test ? (test.ok ? 'text-success-fg' : 'text-danger-fg') : verified ? 'text-success-fg' : 'text-warning-fg')}>
                {testing ? 'Sending a test email…' : test ? (test.ok ? `Verified — test email delivered to ${testTo}` : 'Test failed') : verified ? `Verified ${timeAgo(new Date(initial.mail.verifiedAt!))}` : 'Not verified — send a test to go live'}
              </p>
              {(test || testing) && (
                <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {(test?.steps ?? [{ key: 'connect', label: 'Connect', ok: null }, { key: 'auth', label: 'Sign in', ok: null }, { key: 'send', label: 'Send', ok: null }, { key: 'delivered', label: 'Delivered', ok: null }]).map((s) => (
                    <li key={s.key} className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
                      <span className={cx('grid size-4 place-items-center rounded-full', s.ok === true ? 'bg-success text-white' : s.ok === false ? 'bg-danger text-white' : 'bg-control/60')}>
                        {s.ok === true ? <Check className="size-2.5" strokeWidth={4} /> : s.ok === false ? <X className="size-2.5" strokeWidth={4} /> : testing ? <Spinner className="size-2.5" /> : null}
                      </span>
                      {s.label}
                    </li>
                  ))}
                </ol>
              )}
              {test?.error && <p className="mt-2 text-[13px] text-danger-fg">{test.error}</p>}
              {!test && !testing && initial.mail.lastError && <p className="mt-1 text-[13px] text-danger-fg">Last check: {initial.mail.lastError}</p>}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@yourbusiness.com" aria-label="Send the test to" className="sm:w-56" />
              <Button onClick={runTest} pending={testing} icon={<Send className="size-4" />} disabled={readOnly || !testTo}>Send test email</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-6">
        <Card className="p-5 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold text-fg">Per location</h2>
          <ul className="flex flex-col gap-3">
            {locations.map((l) => (
              <li key={l.id} className="flex items-center gap-3">
                <span className="mono grid h-9 w-11 shrink-0 place-items-center rounded-md bg-sunken text-[11px] font-bold text-fg-2">{l.code}</span>
                <span className="min-w-0 flex-1 text-[13px]">
                  <span className="block text-sm font-semibold text-fg">{l.name}</span>
                  <span className="block truncate text-fg-2">{l.own ? `Own account · ${l.own.fromEmail ?? ''}${l.own.verified ? ' · verified' : ''}` : 'Uses the workspace mail server'}</span>
                </span>
                <Link href={`/${slug}/settings/locations?id=${l.id}&tab=email`} className="shrink-0 rounded-[var(--radius-control)] border border-control px-3 py-1.5 text-[13px] font-semibold text-fg hover:bg-hover">
                  {l.own ? 'Use workspace' : 'Use own account'}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-fg">Text messages</h2>
          <fieldset disabled={readOnly}><SmsFields s={scope(form, 'sms')} /></fieldset>
          <p className="text-[13px] text-fg-2">Texts only go to customers who haven’t opted out. STOP replies are honoured by the provider.</p>
        </Card>
      </div>
      <div className="xl:col-span-2">
        <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial)} readOnly={readOnly} />
        {form.status?.kind === 'error' && <Notice kind="danger">{form.status.text}</Notice>}
      </div>
    </div>
  );
}

// --- Automations & schedules ---------------------------------------------------------------------------

function Timeline({ rules }: { rules: [MessageType, ScheduleRule][] }) {
  // Position on a -7 … +8 day axis around the event (start = 0, end = +1).
  const at = (r: ScheduleRule) => (r.anchor === 'start' ? 0 : 1) + (r.direction === 'before' ? -r.days : r.days) + Number(r.time.slice(0, 2)) / 24;
  const min = -7;
  const max = 9;
  const pct = (d: number) => `${((Math.min(max, Math.max(min, d)) - min) / (max - min)) * 100}%`;
  const on = rules.filter(([, r]) => r.enabled);
  return (
    <div className="relative mt-2 h-32" aria-label="Around every event">
      <div className="absolute inset-x-0 top-14 h-px bg-control" />
      {[-7, -3, 0, 1, 3, 7].map((d) => (
        <span key={d} className="absolute top-[62px] -translate-x-1/2 text-[11px] text-fg-3" style={{ left: pct(d) }}>{d === 0 ? 'Event' : d > 0 ? `+${d - 1}d` : `${d}d`}</span>
      ))}
      <div className="absolute top-10 h-8 rounded-[8px] bg-accent text-center text-[11px] font-bold leading-8 text-on-accent" style={{ left: pct(0), width: `calc(${pct(1)} - ${pct(0)})` }}>Event</div>
      {on.map(([type, r], i) => (
        <div key={type} className="absolute flex -translate-x-1/2 flex-col items-center transition-[left] duration-500 ease-[var(--ease-out)]" style={{ left: pct(at(r)), top: i % 2 ? 78 : 0 }}>
          {i % 2 === 0 && <span className="mb-1 whitespace-nowrap rounded-md bg-night px-1.5 py-0.5 text-[10px] font-semibold text-white">{MESSAGE_TYPES[type].label}</span>}
          <span className={cx('size-3 rounded-full border-2 border-surface', type === 'charge_balance' ? 'bg-volt' : r.channels.includes('sms') ? 'bg-violet' : 'bg-accent')} />
          {i % 2 === 1 && <span className="mt-1 whitespace-nowrap rounded-md bg-sunken px-1.5 py-0.5 text-[10px] font-semibold text-fg">{MESSAGE_TYPES[type].label}</span>}
        </div>
      ))}
    </div>
  );
}

function AutomationsTab({ slug, initial, customTemplates, readOnly, timezone }: { slug: string; initial: ResolvedMessaging; customTemplates: string[]; readOnly: boolean; timezone: string }) {
  const toast = useToast();
  const router = useRouter();
  const form = useForm<ResolvedMessaging>(initial);
  const v = form.values;
  const save = () => form.submit(() => saveMessagingAction(slug, v), (r) => { toast(r.message ?? 'Saved.'); router.refresh(); });
  const tpl = (type: MessageType, channel = MESSAGE_TYPES[type].channels[0]) => `/${slug}/settings/messaging/templates?type=${type}&channel=${channel}`;
  const edited = (type: MessageType) => customTemplates.some((c) => c.startsWith(`${type}:`));
  const rules = SCHEDULED_TYPES.map((t) => [t, v.schedules[t]!] as [MessageType, ScheduleRule]);
  const setRule = (t: string, patch: Partial<ScheduleRule>) => form.set(`schedules.${t}`, { ...v.schedules[t], ...patch });
  return (
    <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
      <Card className={cx('flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:p-6', v.live ? 'border-success/30' : 'border-warning/30')}>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-fg">{v.live ? 'Sending automatically' : 'Automations are off'}</h2>
          <p className="mt-1 text-[13px] text-fg-2">
            {v.live ? 'Receipts, confirmations and every scheduled message below go out on their own.' : 'Nothing goes to customers on its own until you switch this on. Quotes still send when staff press Send quote.'}
          </p>
        </div>
        <Toggle checked={v.live} onChange={(x) => form.set('live', x)} label={v.live ? 'Live' : 'Off'} />
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">Around every event</h2>
          <p className="text-[13px] text-fg-2">Moves as you change the timings below. Times use each location’s clock.</p>
        </div>
        <Timeline rules={rules} />
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-fg">Sent right away</h2>
        <p className="mb-4 text-[13px] text-fg-2">Triggered by something happening on an order.</p>
        <ul className="divide-y divide-subtle">
          {INSTANT_TYPES.map((t) => (
            <li key={t} className="flex flex-wrap items-center gap-3 py-3">
              <Toggle checked={!!v.instant[t]} onChange={(x) => form.set(`instant.${t}`, x)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-fg">{MESSAGE_TYPES[t].label}{edited(t) && <Pill tone="info" dot={false}>Edited</Pill>}</span>
                <span className="block text-[13px] text-fg-2">{MESSAGE_TYPES[t].when}</span>
              </span>
              <span className="flex gap-1">{MESSAGE_TYPES[t].channels.map((c) => <span key={c} className="rounded-md bg-info-bg px-2 py-0.5 text-[11px] font-bold uppercase text-info-fg">{c}</span>)}</span>
              <Link href={tpl(t)} className="flex items-center gap-1 text-[13px] font-semibold text-accent-text hover:underline"><Pencil className="size-3.5" /> Edit template</Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-fg">Scheduled</h2>
        <p className="mb-4 text-[13px] text-fg-2">Times use each location’s clock ({timezone} for the workspace). Each message is sent once per order, even if a job re-runs.</p>
        <ul className="flex flex-col gap-3">
          {rules.map(([t, r]) => (
            <li key={t} className={cx('rounded-[var(--radius-card)] border p-3.5 transition-colors', r.enabled ? 'border-subtle' : 'border-dashed border-subtle bg-sunken/40')}>
              <div className="flex flex-wrap items-center gap-3">
                <Toggle checked={r.enabled} onChange={(x) => setRule(t, { enabled: x })} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-fg">{MESSAGE_TYPES[t].label}{edited(t) && <Pill tone="info" dot={false}>Edited</Pill>}</span>
                  <span className="block text-[13px] text-fg-2">{MESSAGE_TYPES[t].when}</span>
                </span>
                <span className="mono text-[12px] text-fg-2">{describeRule(r)}</span>
              </div>
              {r.enabled && (
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-[52px] max-sm:pl-0">
                  <Input aria-label={`${MESSAGE_TYPES[t].label} days`} mono inputMode="numeric" value={String(r.days)} onChange={(e) => setRule(t, { days: Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0) })} className="h-9 w-16 text-center" />
                  <span className="text-[13px] text-fg-2">days</span>
                  <Select aria-label={`${MESSAGE_TYPES[t].label} before or after`} value={r.direction} onChange={(e) => setRule(t, { direction: e.target.value as 'before' })} className="h-9 w-28">
                    <option value="before">before</option><option value="after">after</option>
                  </Select>
                  <Select aria-label={`${MESSAGE_TYPES[t].label} anchor`} value={r.anchor} onChange={(e) => setRule(t, { anchor: e.target.value as 'start' })} className="h-9 w-36">
                    <option value="start">event start</option><option value="end">event end</option>
                  </Select>
                  <span className="text-[13px] text-fg-2">at</span>
                  <Input type="time" aria-label={`${MESSAGE_TYPES[t].label} send time`} mono value={r.time} onChange={(e) => e.target.value && setRule(t, { time: e.target.value })} className="h-9 w-32" />
                  <span className="ml-auto flex items-center gap-1.5">
                    {(t === 'charge_balance' ? ['charge', 'email'] : (['email', 'sms'] as const)).map((c) => {
                      const onC = r.channels.includes(c as 'email');
                      return (
                        <button key={c} type="button" aria-pressed={onC}
                          onClick={() => setRule(t, { channels: onC ? r.channels.filter((x) => x !== c) : [...r.channels, c as 'email'] })}
                          className={cx('h-7 rounded-md border px-2 text-[11px] font-bold uppercase transition-colors', onC ? 'border-accent bg-accent-soft text-accent-text' : 'border-control text-fg-3')}>
                          {c}
                        </button>
                      );
                    })}
                    <Link href={tpl(t, r.channels.includes('sms') && !r.channels.includes('email') ? 'sms' : 'email')} className="ml-2 text-[13px] font-semibold text-accent-text hover:underline">Template</Link>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <h2 className="mb-3 text-lg font-semibold text-fg">Internal alerts</h2>
          <ul className="flex flex-col gap-3">
            {(['declined_alert', 'last_minute', 'change_request', 'daily_digest'] as const).map((t) => (
              <li key={t}>
                <Toggle checked={!!v.internal[t]} onChange={(x) => form.set(`internal.${t}`, x)} label={MESSAGE_TYPES[t].label} sub={t === 'daily_digest' ? `Every day at ${v.digestTime}` : t === 'last_minute' ? `Booked less than ${v.lastMinuteHours} h before the event` : MESSAGE_TYPES[t].when} />
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 className="text-lg font-semibold text-fg">Quiet hours & limits</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
            Don’t send texts between
            <Input type="time" mono aria-label="Quiet hours from" value={v.quietFrom} onChange={(e) => e.target.value && form.set('quietFrom', e.target.value)} className="h-9 w-32" />
            and
            <Input type="time" mono aria-label="Quiet hours to" value={v.quietTo} onChange={(e) => e.target.value && form.set('quietTo', e.target.value)} className="h-9 w-32" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
            If a send fails, retry
            <Input mono inputMode="numeric" aria-label="Retries" value={String(v.retries)} onChange={(e) => form.set('retries', Math.min(10, Number(e.target.value.replace(/\D/g, '')) || 0))} className="h-9 w-16 text-center" />
            times, then mark it failed.
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
            Skip reminders for orders booked less than
            <Input mono inputMode="numeric" aria-label="Skip reminders within hours" value={String(v.skipRemindersWithinHours)} onChange={(e) => form.set('skipRemindersWithinHours', Math.min(240, Number(e.target.value.replace(/\D/g, '')) || 0))} className="h-9 w-16 text-center" />
            hours before the event.
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
            Tomorrow’s events go out at
            <Input type="time" mono aria-label="Digest time" value={v.digestTime} onChange={(e) => e.target.value && form.set('digestTime', e.target.value)} className="h-9 w-32" />
          </div>
        </Card>
      </div>
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial)} readOnly={readOnly} />
    </fieldset>
  );
}

// --- Message log ---------------------------------------------------------------------------------------

function LogTab({ slug, log, readOnly, timezone }: { slug: string; log: { rows: LogRow[]; counts: { all: number; upcoming: number; sent: number; failed: number; skipped: number }; status: string; q: string }; readOnly: boolean; timezone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(log.q);
  const [view, setView] = useState<MessageView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', 'log');
    for (const [k, val] of Object.entries(patch)) (val ? next.set(k, val) : next.delete(k));
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  useEffect(() => {
    if (search === log.q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: search.trim() || null }), 250);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  // The workspace's clock (scheduled sends follow each location's; the default location is the workspace's).
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  async function open(id: string) {
    setBusy(id);
    const r = await getMessageAction(slug, id);
    setBusy(null);
    if (!r.ok) return toast(r.error, 'error');
    setView(r.data!);
  }
  async function resend(id: string) {
    setBusy(id);
    const r = await resendMessageAction(slug, id);
    setBusy(null);
    toast(r.ok ? (r.message ?? 'Sent.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) router.refresh();
  }
  const preview = useMemo(() => view?.html ?? null, [view]);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <FilterChips label="Status" value={log.status} onChange={(s) => go({ status: s === 'all' ? null : s })}
          chips={[
            { value: 'all', label: 'All', count: log.counts.all }, { value: 'upcoming', label: 'Upcoming', count: log.counts.upcoming },
            { value: 'sent', label: 'Sent', count: log.counts.sent }, { value: 'failed', label: 'Failed', count: log.counts.failed }, { value: 'skipped', label: 'Skipped', count: log.counts.skipped },
          ]} />
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Recipient, subject or order" aria-label="Search messages" className="pl-9" />
          {pending && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" />}
        </div>
      </div>
      <Card className={cx('overflow-hidden transition-opacity', pending && 'opacity-70')}>
        <p className="border-b border-subtle px-5 py-3 text-[13px] text-fg-2">Every email and text, exactly as the customer received it. Kept for 2 years.</p>
        {log.rows.length === 0 ? (
          <EmptyState title="No messages yet" sub="Send a quote or book an order, and its emails show up here." />
        ) : (
          <ul className="divide-y divide-subtle">
            {log.rows.map((m) => (
              <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-5 py-3.5 lg:grid-cols-[110px_minmax(0,1.3fr)_minmax(0,2fr)_110px_minmax(0,1.2fr)_auto] lg:items-center">
                <span className="flex items-center gap-2"><Pill tone={STATUS_TONE[m.status] ?? 'neutral'}>{STATUS_LABEL[m.status] ?? m.status}</Pill></span>
                <span className="min-w-0 text-sm text-fg max-lg:order-3 max-lg:col-span-2">
                  <span className="mr-1.5 rounded bg-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase text-fg-2">{m.channel}</span>
                  <span className="truncate">{m.toAddress ?? '—'}</span>
                </span>
                <span className="min-w-0 max-lg:order-2 max-lg:col-span-2">
                  <span className="block truncate text-sm font-semibold text-fg">{m.subject ?? MESSAGE_TYPES[m.type]?.label ?? m.type}</span>
                  <span className={cx('block truncate text-[12px]', m.status === 'failed' ? 'text-danger' : 'text-fg-2')}>
                    {MESSAGE_TYPES[m.type]?.label ?? m.type}{m.lastError ? ` · ${m.lastError}` : ''}{m.attempts > 1 ? ` · ${m.attempts} tries` : ''}
                  </span>
                </span>
                <span className="text-sm max-lg:order-4">{m.orderId ? <Link href={`/${slug}/orders/${m.orderId}`} className="mono text-[13px] text-accent-text hover:underline">{m.orderNumber}</Link> : <span className="text-fg-3">—</span>}</span>
                <span className="min-w-0 text-[12px] text-fg-2 max-lg:order-5">
                  <span className="block">{m.status === 'queued' ? `Sends ${when(m.when)}` : when(m.when)}</span>
                  <span className="mono block truncate text-fg-3" title={m.key}>{m.key}</span>
                </span>
                <span className="flex justify-end gap-1 max-lg:order-1">
                  {['sent', 'delivered', 'failed'].includes(m.status) && (
                    <button type="button" onClick={() => open(m.id)} aria-label="View message" className="grid size-8 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
                      {busy === m.id ? <Spinner className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                  {!readOnly && ['sent', 'delivered', 'failed', 'skipped'].includes(m.status) && (
                    <button type="button" onClick={() => resend(m.id)} aria-label="Resend" className="grid size-8 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
                      <RotateCw className="size-4" />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Drawer open={!!view} onClose={() => setView(null)} width={680} title={view?.subject ?? 'Text message'} sub={view ? `To ${view.toAddress} · ${view.idempotencyKey}` : undefined}>
        {view && (preview ? (
          <iframe title="Message as received" sandbox="" srcDoc={preview} className="h-[70dvh] w-full rounded-[var(--radius-card)] border border-subtle bg-white" />
        ) : (
          <pre className="whitespace-pre-wrap rounded-[var(--radius-card)] bg-sunken p-4 text-sm text-fg">{view.text}</pre>
        ))}
        {view?.lastError && <Notice kind="danger" className="mt-3">{view.lastError}</Notice>}
      </Drawer>
    </>
  );
}
