'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  documentNumberingSchema, exampleNumber, LOCATION_PILL_COLORS, locationSchema, mailAccountSchema, parseZipList, paymentAccountSchema,
  type DocumentNumbering, type LocationSettings,
} from '@rental/core';
import { AffixInput, Button, Card, cx, Field, Input, LinkButton, Modal, PageTitle, Pill, SaveBar, Tabs, Textarea, Toggle, useToast } from '@/components/kit';
import { AddressBlock } from '@/components/fields/address';
import { scope } from '@/components/fields/scope';
import { localTime, TimezoneSelect, zoneLabel } from '@/components/fields/timezone-select';
import { MailFields, PaymentFields } from '@/components/settings/connect-fields';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { useForm } from '@/lib/form';
import { zodFieldErrors } from '@/lib/result';
import { deleteLocationAction, saveLocationAction, saveLocationMailAction, saveLocationPaymentsAction, saveNumberingAction } from '@/server/actions/settings';

type Tab = 'general' | 'tax' | 'area' | 'email' | 'payments';

export type LocationRow = {
  id: string; name: string; code: string; timezone: string; phone: string; email: string; address: Record<string, unknown>;
  loadingNotes: string; isPrimary: boolean; isActive: boolean; settings: LocationSettings; taxPercent: number;
  mail: { host: string; port: number; security: 'starttls' | 'ssl' | 'none'; username: string; fromName: string; fromEmail: string; provider: 'google' | 'microsoft' | 'zoho' | 'other'; hasSecret: boolean } | null;
  payments: { provider: 'manual' | 'stripe' | 'ipos'; publishableKey: string; merchantId: string; hasSecret: boolean; keyMode: string | null } | null;
  ready: boolean;
};

type Props = {
  slug: string; rows: LocationRow[]; selectedId: string | null; creating: boolean; tab: Tab; numbering: DocumentNumbering;
  nextNumbers: { quote: number; invoice: number; receipt: number } | null;
  orgDefaults: { freeMiles: number; rateStaffed: number; rateDropoff: number };
  orgName: string; currency: string; orgTimezone: string; readOnly: boolean;
};

const blankRow = (tz: string): LocationRow => ({
  id: '', name: '', code: '', timezone: '', phone: '', email: '', address: { country: 'US' }, loadingNotes: '', isPrimary: false, isActive: true,
  settings: { freeTravelMiles: null, travelRateStaffed: null, travelRateDropoff: null, servedZips: [], pillColor: '#0B0D12', paused: false, ownMailServer: false },
  taxPercent: 0, mail: null, payments: null, ready: false,
});

function StatusPill({ r }: { r: LocationRow }) {
  if (!r.isActive) return <Pill tone="neutral">Inactive</Pill>;
  if (r.settings.paused) return <Pill tone="warning">Paused</Pill>;
  return r.ready ? <Pill tone="success">Ready</Pill> : <Pill tone="warning">Email needed</Pill>;
}

function CodeBadge({ code, color, size = 'md' }: { code: string; color: string; size?: 'md' | 'lg' }) {
  const dark = color.toUpperCase() === '#0B0D12';
  return (
    <span
      className={cx('mono grid shrink-0 place-items-center rounded-[10px] font-bold', size === 'lg' ? 'h-14 min-w-14 px-2 text-base' : 'h-10 min-w-11 px-1.5 text-xs')}
      style={{ background: dark ? '#0B0D12' : `${color}22`, color: dark ? '#D4FF3A' : color }}
    >
      {code || '—'}
    </span>
  );
}

export function LocationsSettings(props: Props) {
  const { slug, rows, selectedId, creating, tab } = props;
  const selected = creating ? null : rows.find((r) => r.id === selectedId) ?? null;
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Settings', href: `/${slug}/settings` }, { label: 'Locations' }]}
        actions={<LinkButton href={`/${slug}/settings/locations?new=1`} icon={<Plus className="size-4" />}><span className="max-sm:hidden">Add location</span><span className="sm:hidden">Add</span></LinkButton>}
      />
      <PageBody wide>
        <PageTitle title="Locations" sub="Each branch has its own timezone, tax, travel rules, mail server and payment gateway." />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="no-scrollbar flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Locations">
            {rows.map((r, i) => {
              const on = !creating && r.id === selectedId;
              return (
                <li key={r.id} className="anim-rise min-w-[240px] lg:min-w-0" style={{ ['--d' as string]: `${i * 40}ms` }}>
                  <Link
                    href={`/${slug}/settings/locations?id=${r.id}${tab !== 'general' ? `&tab=${tab}` : ''}`}
                    aria-current={on ? 'true' : undefined}
                    scroll={false}
                    className={cx('flex items-center gap-3 rounded-[var(--radius-card)] border p-3 transition-[background-color,border-color,box-shadow] duration-200', on ? 'border-control bg-surface shadow-[var(--shadow-lift)]' : 'border-transparent hover:bg-surface/70')}
                  >
                    <CodeBadge code={r.code} color={r.settings.pillColor} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-fg">{r.name}{r.isPrimary && <span className="ml-1.5 text-xs font-medium text-fg-2">· primary</span>}</span>
                      <span className="block truncate text-[13px] text-fg-2">{[r.address.city, r.address.region].filter(Boolean).join(', ') || 'No address'}</span>
                    </span>
                    <StatusPill r={r} />
                  </Link>
                </li>
              );
            })}
            {creating && (
              <li className="min-w-[240px] lg:min-w-0">
                <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-accent bg-surface p-3 shadow-[var(--shadow-lift)]">
                  <span className="grid h-10 min-w-11 place-items-center rounded-[10px] bg-accent-soft text-accent-text"><Plus className="size-4" /></span>
                  <span className="font-semibold text-fg">New location</span>
                </div>
              </li>
            )}
          </ul>
          <div className="min-w-0">
            {creating ? <LocationPanel key="new" {...props} row={blankRow(props.orgTimezone)} tab="general" isNew /> : selected ? <LocationPanel key={selected.id} {...props} row={selected} tab={tab} /> : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}

function LocationPanel(props: Props & { row: LocationRow; tab: Tab; isNew?: boolean }) {
  const { slug, row, tab, isNew, readOnly, rows } = props;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  const tabs = [
    { value: 'general', label: 'General' },
    { value: 'tax', label: 'Tax & numbering' },
    { value: 'area', label: 'Service area' },
    { value: 'email', label: 'Email (SMTP)' },
    { value: 'payments', label: 'Payments' },
  ] as const;
  const tz = row.timezone || props.orgTimezone;
  return (
    <Card className="anim-slide overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-5 sm:p-6">
        <CodeBadge code={row.code} color={row.settings.pillColor} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-[26px] font-bold tracking-[-0.01em] text-fg">{isNew ? 'New location' : row.name}</h2>
          {!isNew && <p className="text-[13px] text-fg-2">{zoneLabel(tz).split(' — ')[0]} time · local time <span className="mono font-semibold text-fg">{localTime(tz, now)}</span></p>}
        </div>
        {!isNew && !row.isPrimary && rows.length > 1 && <DeleteLocation slug={slug} row={row} readOnly={readOnly} />}
      </div>
      {!isNew && (
        <div className="px-5 sm:px-6">
          <Tabs label="Location settings" value={tab} tabs={tabs.map((t) => ({ ...t, href: `/${slug}/settings/locations?id=${row.id}${t.value === 'general' ? '' : `&tab=${t.value}`}` }))} />
        </div>
      )}
      <div key={tab} className="anim-rise p-5 sm:p-6">
        {(tab === 'general' || tab === 'area' || isNew) && <LocationForm {...props} section={isNew ? 'general' : tab === 'area' ? 'area' : 'general'} />}
        {tab === 'tax' && !isNew && <TaxNumbering {...props} />}
        {tab === 'email' && !isNew && <LocationMail {...props} />}
        {tab === 'payments' && !isNew && <LocationPayments {...props} />}
      </div>
    </Card>
  );
}

function useAfterSave() {
  const router = useRouter();
  const toast = useToast();
  return (msg?: string, href?: string) => { if (msg) toast(msg); if (href) router.push(href, { scroll: false }); router.refresh(); };
}

function LocationForm({ slug, row, isNew, readOnly, orgDefaults, currency, section, numbering, orgTimezone }: Props & { row: LocationRow; isNew?: boolean; section: 'general' | 'area' }) {
  const after = useAfterSave();
  const initial = useMemo(() => ({ ...row, zipsText: row.settings.servedZips.join(', ') }), [row]);
  const form = useForm(initial);
  const v = form.values;
  const [codeTouched, setCodeTouched] = useState(!isNew);
  useEffect(() => {
    if (codeTouched) return;
    const src = String(v.address.city || v.name || '');
    form.set('code', src.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase());
  }, [v.address.city, v.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const location = {
      name: v.name, code: v.code, timezone: v.timezone || undefined, phone: v.phone, email: v.email, address: v.address, loadingNotes: v.loadingNotes,
      isPrimary: v.isPrimary, isActive: v.isActive, settings: { ...v.settings, servedZips: parseZipList(v.zipsText) },
    };
    const p = locationSchema.safeParse(location);
    if (!p.success) {
      form.setErrors(Object.fromEntries(Object.entries(zodFieldErrors(p.error)).map(([k, m]) => [k, m])));
      form.setStatus({ kind: 'error', text: 'A few fields need attention.' });
      return;
    }
    form.submit(() => saveLocationAction(slug, isNew ? null : row.id, { location, taxPercent: v.taxPercent }), (r) => {
      form.reset({ ...v, zipsText: parseZipList(v.zipsText).join(', ') });
      after(r.message, isNew && r.data ? `/${slug}/settings/locations?id=${r.data.id}` : undefined);
    });
  };

  const sym = { USD: '$', GBP: '£', AED: 'AED', CAD: 'CA$' }[currency] ?? '$';
  const num = (path: string, value: number | null, fallback: number) => (
    <AffixInput
      id={`loc-${path}`}
      mono
      inputMode="decimal"
      prefix={path.startsWith('settings.travelRate') ? sym : undefined}
      suffix={path === 'settings.freeTravelMiles' ? 'mi' : undefined}
      placeholder={`${fallback} (org default)`}
      value={value == null ? '' : String(value)}
      onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); form.set(path, t === '' ? null : Number(t)); }}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      {section === 'general' && (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Name" htmlFor="loc-name" error={form.error('name')}>
              <Input id="loc-name" value={v.name} invalid={!!form.error('name')} onChange={(e) => form.set('name', e.target.value)} />
            </Field>
            <Field label="Code" htmlFor="loc-code" error={form.error('code')} hint={`Used in document numbers, like ${exampleNumber(numbering, 'quote', v.code || 'AUS')}.`}>
              <Input id="loc-code" mono maxLength={8} value={v.code} invalid={!!form.error('code')} onChange={(e) => { setCodeTouched(true); form.set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} />
            </Field>
            <Field label="Timezone" htmlFor="loc-tz" hint={v.timezone ? 'Reminders and event times use this clock.' : 'Set from the map pin when you save.'}>
              <TimezoneSelect id="loc-tz" value={v.timezone || orgTimezone} onChange={(tz) => form.set('timezone', tz)} />
            </Field>
            <Field label="Free travel miles" htmlFor="loc-settings.freeTravelMiles" hint="Travel fee starts after this distance from the nearest depot.">
              {num('settings.freeTravelMiles', v.settings.freeTravelMiles, orgDefaults.freeMiles)}
            </Field>
            <Field label="Phone" htmlFor="loc-phone" optional error={form.error('phone')}>
              <Input id="loc-phone" type="tel" value={v.phone} invalid={!!form.error('phone')} onChange={(e) => form.set('phone', e.target.value)} />
            </Field>
            <Field label="Email" htmlFor="loc-email" optional error={form.error('email')}>
              <Input id="loc-email" type="email" value={v.email} invalid={!!form.error('email')} onChange={(e) => form.set('email', e.target.value)} />
            </Field>
          </div>
          <AddressBlock s={scope(form, 'address')} requireStreet />
          <Field label="Loading notes for crew" htmlFor="loc-notes" optional hint="Gate codes, where to park, what to load first.">
            <Textarea id="loc-notes" rows={2} value={v.loadingNotes} onChange={(e) => form.set('loadingNotes', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Brand colour" hint="Used for the pill on emails and PDFs.">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Location colour">
                {LOCATION_PILL_COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={v.settings.pillColor === c} aria-label={c} onClick={() => form.set('settings.pillColor', c)}
                    className={cx('size-9 rounded-full transition-transform duration-250 ease-[var(--ease-pop)]', v.settings.pillColor === c ? 'scale-110' : 'hover:scale-105')}
                    style={{ background: c, boxShadow: v.settings.pillColor === c ? `0 0 0 2px var(--bg-surface), 0 0 0 4px ${c}` : '0 0 0 1px var(--border-control)' }} />
                ))}
              </div>
            </Field>
            <div className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-sunken p-4">
              <Toggle checked={v.settings.paused} onChange={(x) => form.set('settings.paused', x)} label="Pause new orders" sub="Stops new orders here, e.g. during a season close." />
              {!isNew && <Toggle checked={v.isPrimary} disabled={row.isPrimary} onChange={(x) => form.set('isPrimary', x)} label="Primary location" sub={row.isPrimary ? 'The default ship-from point. Make another primary to change it.' : 'Make this the default ship-from point.'} />}
              {!isNew && !row.isPrimary && <Toggle checked={v.isActive} onChange={(x) => form.set('isActive', x)} label="Active" sub="Inactive locations take no orders and are hidden from pickers." />}
            </div>
          </div>
          {isNew && (
            <Field label="Default sales tax" htmlFor="loc-tax" hint="Orders from here start with this rate.">
              <AffixInput id="loc-tax" mono inputMode="decimal" suffix="%" value={String(v.taxPercent)} onChange={(e) => form.set('taxPercent', Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
            </Field>
          )}
        </>
      )}
      {section === 'area' && (
        <>
          <p className="text-[15px] text-fg-2">Travel is measured by driving distance from the nearest active location. Leave a field empty to use the organization default.</p>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Free travel miles" htmlFor="loc-settings.freeTravelMiles">{num('settings.freeTravelMiles', v.settings.freeTravelMiles, orgDefaults.freeMiles)}</Field>
            <Field label="Rate per extra mile" htmlFor="loc-settings.travelRateStaffed" hint="Staffed orders.">{num('settings.travelRateStaffed', v.settings.travelRateStaffed, orgDefaults.rateStaffed)}</Field>
            <Field label="Rate per mile, drop-off" htmlFor="loc-settings.travelRateDropoff" hint="Any drop-off line uses this rate.">{num('settings.travelRateDropoff', v.settings.travelRateDropoff, orgDefaults.rateDropoff)}</Field>
          </div>
          <Field label="ZIP codes this location serves" htmlFor="loc-zips" optional hint={`Orders outside are flagged, not blocked. ${parseZipList(v.zipsText).length} ZIP codes.`}>
            <Textarea id="loc-zips" className="mono" rows={4} value={v.zipsText} onChange={(e) => form.set('zipsText', e.target.value)} placeholder="78701, 78702, 78703" />
          </Field>
        </>
      )}
      {isNew ? (
        <div className="flex justify-end gap-2 border-t border-subtle pt-5">
          <LinkButton variant="secondary" href={`/${slug}/settings/locations`}>Cancel</LinkButton>
          <Button onClick={save} pending={form.pending} disabled={readOnly}>Add location</Button>
        </div>
      ) : (
        <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => { form.reset(initial); setCodeTouched(true); }} readOnly={readOnly} />
      )}
    </div>
  );
}

function TaxNumbering({ slug, row, numbering, nextNumbers, readOnly }: Props & { row: LocationRow }) {
  const after = useAfterSave();
  const initial = useMemo(() => ({ taxPercent: row.taxPercent, numbering, next: nextNumbers ?? { quote: 1, invoice: 1, receipt: 1 } }), [row, numbering, nextNumbers]);
  const form = useForm(initial);
  const v = form.values;
  const save = () => {
    const p = documentNumberingSchema.safeParse(v.numbering);
    if (!p.success) { form.setErrors(Object.fromEntries(Object.entries(zodFieldErrors(p.error)).map(([k, m]) => [`numbering.${k}`, m]))); return; }
    form.submit(async () => {
      if (v.taxPercent !== row.taxPercent) {
        const loc = { name: row.name, code: row.code, timezone: row.timezone, phone: row.phone, email: row.email, address: row.address, loadingNotes: row.loadingNotes, isPrimary: row.isPrimary, isActive: row.isActive, settings: row.settings };
        const r = await saveLocationAction(slug, row.id, { location: loc, taxPercent: v.taxPercent });
        if (!r.ok) return r;
      }
      return saveNumberingAction(slug, { numbering: v.numbering, next: v.next, locationCode: row.code });
    }, (r) => { form.reset(v); after(r.message ?? 'Saved.'); });
  };
  const kinds = [
    { kind: 'quote', label: 'Orders and quotes' },
    { kind: 'invoice', label: 'Invoices' },
    { kind: 'receipt', label: 'Payments and receipts' },
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <Field label="Default sales tax rate" htmlFor="tx-rate" hint="Each order starts with this rate. People with the “Override the tax rate” permission can change it per order.">
        <AffixInput id="tx-rate" className="max-w-[220px]" mono inputMode="decimal" suffix="%" value={String(v.taxPercent)} onChange={(e) => form.set('taxPercent', Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
      </Field>
      <div>
        <h3 className="text-sm font-bold text-fg">Document numbers</h3>
        <p className="mt-1 text-[13px] text-fg-2">Prefixes are shared by every location: <span className="mono">{'{LOC}'}</span> becomes this location&apos;s code and <span className="mono">{'{YYYY}'}</span> the year. Each prefix keeps its own counter.</p>
        <div className="mt-4 flex flex-col divide-y divide-subtle rounded-[var(--radius-card)] border border-subtle">
          {kinds.map(({ kind, label }) => (
            <div key={kind} className="grid grid-cols-1 items-end gap-4 p-4 md:grid-cols-[minmax(0,1fr)_100px_140px_170px]">
              <Field label={`${label} prefix`} htmlFor={`nb-${kind}`} error={form.error(`numbering.${kind}Prefix`)}>
                <Input id={`nb-${kind}`} mono value={v.numbering[`${kind}Prefix`]} onChange={(e) => form.set(`numbering.${kind}Prefix`, e.target.value)} />
              </Field>
              <Field label="Digits" htmlFor={`nb-${kind}-pad`}>
                <Input id={`nb-${kind}-pad`} mono inputMode="numeric" value={String(v.numbering[`${kind}Padding`])} onChange={(e) => form.set(`numbering.${kind}Padding`, Math.min(8, Math.max(3, Number(e.target.value.replace(/\D/g, '')) || 3)))} />
              </Field>
              <Field label="Next number" htmlFor={`nb-${kind}-next`} hint="Can only move forward.">
                <Input id={`nb-${kind}-next`} mono inputMode="numeric" value={String(v.next[kind])} onChange={(e) => form.set(`next.${kind}`, Number(e.target.value.replace(/\D/g, '')) || 1)} />
              </Field>
              <div className="pb-2.5">
                <span className="eyebrow block">Next here</span>
                <span className="mono text-sm font-semibold text-fg">{exampleNumber(v.numbering, kind, row.code, v.next[kind])}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial)} readOnly={readOnly} />
    </div>
  );
}

function LocationMail({ slug, row, orgName, readOnly }: Props & { row: LocationRow }) {
  const after = useAfterSave();
  const initial = useMemo(() => ({
    own: !!row.mail,
    mail: {
      mode: 'smtp' as const, provider: row.mail?.provider ?? 'google', host: row.mail?.host ?? 'smtp.gmail.com', port: row.mail?.port ?? 587, security: row.mail?.security ?? 'starttls',
      username: row.mail?.username ?? '', password: '', fromName: row.mail?.fromName ?? '', fromEmail: row.mail?.fromEmail ?? '', hasSecret: !!row.mail?.hasSecret,
    },
  }), [row]);
  const form = useForm(initial);
  const v = form.values;
  const save = () => {
    const mail = { ...v.mail, password: v.mail.password || undefined };
    if (v.own) {
      const p = mailAccountSchema.safeParse(mail);
      if (!p.success) { form.setErrors(Object.fromEntries(Object.entries(zodFieldErrors(p.error)).map(([k, m]) => [`mail.${k}`, m]))); return; }
    }
    form.submit(() => saveLocationMailAction(slug, row.id, { own: v.own, mail: v.own ? mail : undefined }), (r) => { form.reset({ ...v, mail: { ...v.mail, password: '' } }); after(r.message); });
  };
  return (
    <div className="flex flex-col gap-6">
      <Toggle checked={v.own} onChange={(x) => form.set('own', x)} label="Use this location's own mail server" sub="Off: emails for this location go through the organization's mail server (Settings → Email & SMS)." />
      {v.own && <MailFields s={scope(form, 'mail')} orgName={orgName} platformOption={false} />}
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial)} readOnly={readOnly} />
    </div>
  );
}

function LocationPayments({ slug, row, readOnly }: Props & { row: LocationRow }) {
  const after = useAfterSave();
  const initial = useMemo(() => ({
    own: !!row.payments,
    payments: { provider: row.payments?.provider ?? 'stripe', publishableKey: row.payments?.publishableKey ?? '', secretKey: '', merchantId: row.payments?.merchantId ?? '', hasSecret: !!row.payments?.hasSecret, keyMode: row.payments?.keyMode ?? null },
  }), [row]);
  const form = useForm(initial);
  const v = form.values;
  const save = () => {
    const payments = { ...v.payments, secretKey: v.payments.secretKey || undefined };
    if (v.own) {
      const p = paymentAccountSchema.safeParse(payments);
      if (!p.success) { form.setErrors(Object.fromEntries(Object.entries(zodFieldErrors(p.error)).map(([k, m]) => [`payments.${k}`, m]))); return; }
    }
    form.submit(() => saveLocationPaymentsAction(slug, row.id, { own: v.own, payments: v.own ? payments : undefined }), (r) => { form.reset({ ...v, payments: { ...v.payments, secretKey: '' } }); after(r.message); });
  };
  return (
    <div className="flex flex-col gap-6">
      <Toggle checked={v.own} onChange={(x) => form.set('own', x)} label="Use a separate payment account here" sub="Off: payments for this location go to the organization's gateway." />
      {v.own && <PaymentFields s={scope(form, 'payments')} />}
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial)} readOnly={readOnly} />
    </div>
  );
}

function DeleteLocation({ slug, row, readOnly }: { slug: string; row: LocationRow; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const form = useForm({});
  return (
    <>
      <Button variant="danger-ghost" size="sm" onClick={() => setOpen(true)} disabled={readOnly}>Remove</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Remove ${row.name}?`}
        sub="Only possible while no orders use it. To stop new orders but keep history, turn on “Pause new orders” instead."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
            <Button variant="danger" pending={form.pending} onClick={() => form.submit(() => deleteLocationAction(slug, row.id), (r) => { setOpen(false); toast(r.message ?? 'Removed.'); router.push(`/${slug}/settings/locations`); router.refresh(); })}>Remove location</Button>
          </>
        }
      >
        {form.status?.kind === 'error' ? <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p> : <p className="text-sm text-fg-2">This cannot be undone.</p>}
      </Modal>
    </>
  );
}
