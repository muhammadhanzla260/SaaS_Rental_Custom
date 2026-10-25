'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, MapPin, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  agreementSchema, agreementSections, bookingDefaultsSchema, brandStepSchema, checkAccent, connectStepSchema, CURRENCIES, profileStepSchema, themeStyle,
  type Agreement, type BookingDefaults, type BrandSettings, type Corners,
} from '@rental/core';
import {
  AffixInput, Button, Card, cx, Field, Input, Notice, PageTitle, Pill, SaveBar, Segmented, Select, Slider, Tabs, Textarea, Toggle, useToast,
} from '@/components/kit';
import { LogoEditor, type LogoValue } from '@/components/brand/logo-editor';
import { logoImgStyle } from '@/components/brand/logo-mark';
import { ThemePicker } from '@/components/brand/theme-picker';
import { AddressBlock } from '@/components/fields/address';
import { scope } from '@/components/fields/scope';
import { localTime, TimezoneSelect } from '@/components/fields/timezone-select';
import { connectPayload, MailFields, PaymentFields, SmsFields, type ConnectDraft } from '@/components/settings/connect-fields';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { useForm } from '@/lib/form';
import { zodFieldErrors } from '@/lib/result';
import { saveAgreementAction, saveBrandAction, saveBusinessProfileAction, saveIntegrationsAction, saveRentalRulesAction } from '@/server/actions/settings';

type Tab = 'brand' | 'profile' | 'warehouses' | 'connect' | 'rules' | 'agreement';

export type WorkspaceInitial = {
  brand: { branding: { brandColor: string; themeMode: 'light' | 'dark' | 'system'; radius: Corners }; brand: BrandSettings };
  profile: {
    profile: { name: string; legalName: string; phone: string; email: string; website: string; taxId: string; address: Record<string, unknown> };
    timezone: string; currency: string; dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY'; weekStartsOn: 'sunday' | 'monday';
  };
  connect: ConnectDraft;
  rules: BookingDefaults;
  agreement: Agreement;
  warehouses: { id: string; name: string; code: string; city: string; isPrimary: boolean; isActive: boolean; pinned: boolean; freeMiles: number; timezone: string }[];
};

type Props = { slug: string; tab: Tab; initial: WorkspaceInitial; orgName: string; currency: string; logoUrl: string | null; readOnly: boolean; lastChanged: string | null };

export function WorkspaceSettings(props: Props) {
  const { slug, tab, lastChanged } = props;
  const tabs = [
    { value: 'brand', label: 'Brand & theme' },
    { value: 'profile', label: 'Business profile' },
    { value: 'warehouses', label: 'Warehouses' },
    { value: 'connect', label: 'Email & payments' },
    { value: 'rules', label: 'Rental rules' },
    { value: 'agreement', label: 'Agreement' },
  ] as const;
  return (
    <>
      <Topbar
        crumbs={[{ label: 'Settings', href: `/${slug}/settings` }, { label: 'Workspace & brand' }]}
        actions={lastChanged ? <span className="text-[13px] text-fg-2 max-md:hidden">{lastChanged}</span> : undefined}
      />
      <PageBody wide>
        <PageTitle title="Workspace & brand" sub="Everything set during onboarding, editable any time. Changes apply to the app, customer pages, emails and PDFs." />
        <Tabs label="Workspace settings" value={tab} tabs={tabs.map((t) => ({ ...t, href: `/${slug}/settings/workspace${t.value === 'brand' ? '' : `?tab=${t.value}`}` }))} className="mb-6" />
        <div key={tab} className="anim-rise">
          {tab === 'brand' && <BrandTab {...props} />}
          {tab === 'profile' && <ProfileTab {...props} />}
          {tab === 'warehouses' && <WarehousesTab {...props} />}
          {tab === 'connect' && <ConnectTab {...props} />}
          {tab === 'rules' && <RulesTab {...props} />}
          {tab === 'agreement' && <AgreementTab {...props} />}
        </div>
      </PageBody>
    </>
  );
}

function useSaved() {
  const router = useRouter();
  const toast = useToast();
  return (msg?: string) => { if (msg) toast(msg); router.refresh(); };
}

// --- Brand & theme ------------------------------------------------------------------------

function BrandTab({ slug, initial, orgName, logoUrl, readOnly }: Props) {
  const saved = useSaved();
  const form = useForm(initial.brand);
  const v = form.values;
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  const src = objectUrl ?? (removed ? null : logoUrl);
  const dirty = form.dirty || !!file || removed;

  const save = () => {
    const p = brandStepSchema.safeParse(v);
    if (!p.success) { form.setErrors(zodFieldErrors(p.error)); return; }
    const fd = new FormData();
    fd.set('payload', JSON.stringify(v));
    if (file) fd.set('logo', file);
    if (removed && !file) fd.set('removeLogo', '1');
    form.submit(() => saveBrandAction(slug, fd), (r) => { setFile(null); setRemoved(false); saved(r.message); });
  };
  const discard = () => { form.reset(initial.brand); setFile(null); setRemoved(false); };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        <Card className="p-5 sm:p-6">
          <h2 className="text-base font-bold text-fg">Logo</h2>
          <p className="mb-5 mt-1 text-[13px] text-fg-2">Upload once, then adjust size, position, padding, background and shape for each version.</p>
          <LogoEditor
            src={src}
            fileName={file ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : null}
            value={v.brand.logo as LogoValue}
            onChange={(l) => form.set('brand.logo', l)}
            onFile={(f) => { setFile(f); setRemoved(false); }}
            onRemove={() => { setFile(null); setRemoved(true); }}
            brandColor={v.branding.brandColor}
            name={orgName}
          />
        </Card>

        <Card className="flex flex-col gap-6 p-5 sm:p-6">
          <h2 className="text-base font-bold text-fg">Theme</h2>
          <Field label="Brand colour" error={form.error('branding.brandColor')}>
            <ThemePicker value={v.branding.brandColor} onChange={(hex) => form.set('branding.brandColor', hex)} />
          </Field>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field label="Sidebar">
              <Segmented label="Sidebar" fill value={v.brand.sidebar} onChange={(x) => form.set('brand.sidebar', x)} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'brand', label: 'Brand colour' }]} />
            </Field>
            <Field label="Corners">
              <Segmented label="Corners" fill value={v.branding.radius} onChange={(x) => form.set('branding.radius', x)} options={[{ value: 'round', label: 'Rounded' }, { value: 'soft', label: 'Soft' }, { value: 'sharp', label: 'Sharp' }]} />
            </Field>
            <Field label="Default appearance">
              <Segmented label="Default appearance" fill value={v.branding.themeMode} onChange={(x) => form.set('branding.themeMode', x)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
            </Field>
          </div>
          <Field label="Heading font on customer pages">
            <Segmented
              label="Heading font"
              value={v.brand.headingFont}
              onChange={(x) => form.set('brand.headingFont', x)}
              options={[
                { value: 'modern', label: <span className="font-display">Modern</span> },
                { value: 'classic', label: <span style={{ fontFamily: 'Georgia, serif' }}>Classic</span> },
                { value: 'friendly', label: <span style={{ fontFamily: 'ui-rounded, "Nunito", system-ui' }}>Friendly</span> },
              ]}
            />
          </Field>
        </Card>

        <Card className="flex flex-col gap-5 p-5 sm:p-6">
          <h2 className="text-base font-bold text-fg">Customer-facing details</h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <Field label="Email header">
              <Segmented label="Email header" fill value={v.brand.emailHeader} onChange={(x) => form.set('brand.emailHeader', x)} options={[{ value: 'band', label: 'Brand colour band' }, { value: 'white', label: 'White with logo' }]} />
            </Field>
            <Field label="Custom domain" htmlFor="ws-domain" error={form.error('brand.customDomain')} hint={v.brand.customDomain ? (v.brand.customDomainVerified ? 'DNS verified.' : 'Quote, sign and pay links use it once DNS is verified.') : 'Quote, sign and pay links use it once DNS is verified.'}>
              <Input id="ws-domain" mono placeholder="book.yourbusiness.com" value={v.brand.customDomain ?? ''} onChange={(e) => form.set('brand.customDomain', e.target.value)} invalid={!!form.error('brand.customDomain')} />
            </Field>
            <Field label="Review link" htmlFor="ws-review" error={form.error('brand.reviewLink')} hint="Sent in the review request after each event.">
              <Input id="ws-review" placeholder="https://g.page/r/…" value={v.brand.reviewLink ?? ''} onChange={(e) => form.set('brand.reviewLink', e.target.value)} invalid={!!form.error('brand.reviewLink')} />
            </Field>
            <Field label="Social profile" htmlFor="ws-social" error={form.error('brand.socialUrl')}>
              <Input id="ws-social" placeholder="https://instagram.com/…" value={v.brand.socialUrl ?? ''} onChange={(e) => form.set('brand.socialUrl', e.target.value)} invalid={!!form.error('brand.socialUrl')} />
            </Field>
          </div>
          <Field label="Footer on quotes and invoices" htmlFor="ws-footer" error={form.error('brand.invoiceFooter')}>
            <Textarea id="ws-footer" rows={3} placeholder="Thank you for choosing us! Payment terms, cancellation policy summary, licence numbers…" value={v.brand.invoiceFooter ?? ''} onChange={(e) => form.set('brand.invoiceFooter', e.target.value)} />
          </Field>
        </Card>
        {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
        <SaveBar dirty={dirty} pending={form.pending} onSave={save} onDiscard={discard} readOnly={readOnly} />
      </div>
      <aside className="xl:sticky xl:top-24 xl:self-start">
        <p className="eyebrow mb-3">Customer quote page · live</p>
        <QuotePreview name={orgName} src={src} brand={v.brand} accent={v.branding.brandColor} corners={v.branding.radius} />
      </aside>
    </div>
  );
}

function QuotePreview({ name, src, brand, accent, corners }: { name: string; src: string | null; brand: BrandSettings; accent: string; corners: Corners }) {
  const on = checkAccent(accent).onAccent;
  const r = corners === 'sharp' ? 4 : corners === 'soft' ? 11 : 18;
  const head = brand.headingFont === 'classic' ? 'Georgia, serif' : brand.headingFont === 'friendly' ? 'ui-rounded, "Nunito", system-ui' : 'var(--font-display)';
  const band = brand.emailHeader === 'band';
  const a = brand.logo.onDark;
  return (
    <div className="overflow-hidden border border-subtle bg-white text-[#10131A] shadow-[var(--shadow-lift)] transition-[border-radius] duration-300" style={{ borderRadius: r, ...(themeStyle(accent, corners) as CSSProperties) }}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 transition-colors duration-300" style={{ background: band ? accent : '#FFFFFF', color: band ? on : '#10131A', borderBottom: band ? 'none' : '1px solid #E2E5EA' }}>
        {src ? (
          <span className="grid h-9 w-28 place-items-center overflow-hidden" style={{ padding: Math.round(a.padding * 0.3) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="size-full object-contain" style={logoImgStyle(band ? a : brand.logo.main)} />
          </span>
        ) : <span className="text-lg font-bold" style={{ fontFamily: head }}>{name}</span>}
        <span className="mono text-xs opacity-80">Q-ABC-01001</span>
      </div>
      <div className="flex flex-col gap-4 p-5">
        <h3 className="text-[26px] font-bold leading-tight tracking-tight" style={{ fontFamily: head }}>Your Saturday party is almost booked</h3>
        <div className="rounded-xl border border-[#E2E5EA] p-3 text-[13px]">
          <div className="flex justify-between py-1"><span>Bounce house · 4 h</span><span className="mono">$325.00</span></div>
          <div className="flex justify-between py-1"><span>Delivery &amp; setup</span><span className="mono">$21.00</span></div>
          <div className="mt-1 flex justify-between border-t border-[#E2E5EA] pt-2 font-semibold"><span>Deposit due today</span><span className="mono">$103.80</span></div>
        </div>
        <span className="grid h-11 place-items-center text-sm font-semibold transition-[border-radius] duration-300" style={{ background: accent, color: on, borderRadius: Math.max(4, r * 0.55) }}>Sign &amp; pay deposit</span>
        <p className="text-xs text-[#535C6B]">{brand.invoiceFooter || `${name} · Sample quote for illustration`}</p>
      </div>
    </div>
  );
}

// --- Business profile ---------------------------------------------------------------------

function ProfileTab({ slug, initial, readOnly }: Props) {
  const saved = useSaved();
  const form = useForm(initial.profile);
  const v = form.values;
  const s = scope(form, 'profile');
  const text = (name: string, label: string, opts: { hint?: string; optional?: boolean; type?: string; placeholder?: string } = {}) => (
    <Field label={label} htmlFor={`pf-${name}`} hint={opts.hint} error={s.err(name)} optional={opts.optional}>
      <Input id={`pf-${name}`} type={opts.type ?? 'text'} placeholder={opts.placeholder} value={(s.v[name] as string) ?? ''} invalid={!!s.err(name)} onChange={(e) => s.set(name, e.target.value)} />
    </Field>
  );
  const save = () => {
    const p = profileStepSchema.safeParse(v);
    if (!p.success) { form.setErrors(zodFieldErrors(p.error)); form.setStatus({ kind: 'error', text: 'A few fields need attention.' }); return; }
    form.submit(() => saveBusinessProfileAction(slug, v), (r) => saved(r.message));
  };
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card className="p-5 sm:p-6">
        <h2 className="mb-5 text-base font-bold text-fg">How customers see you</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {text('name', 'Display name')}
          {text('legalName', 'Legal name', { hint: 'Printed on invoices and the rental agreement.', optional: true })}
          {text('phone', 'Business phone', { type: 'tel' })}
          {text('email', 'Customer-facing email', { type: 'email', optional: true })}
          {text('website', 'Website', { type: 'url', optional: true, placeholder: 'https://' })}
          {text('taxId', 'Tax ID / EIN', { optional: true })}
        </div>
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="mb-5 text-base font-bold text-fg">Business address</h2>
        <AddressBlock s={scope(form, 'profile.address')} showMap={false} />
      </Card>
      <Card className="p-5 sm:p-6">
        <h2 className="mb-5 text-base font-bold text-fg">Region</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Time zone" htmlFor="pf-tz" hint={<>Local time now: <span className="mono font-semibold text-fg">{localTime(v.timezone)}</span>. Each location can run on its own clock.</>}>
            <TimezoneSelect id="pf-tz" value={v.timezone} onChange={(tz) => form.set('timezone', tz)} />
          </Field>
          <Field label="Currency" htmlFor="pf-cur">
            <Select id="pf-cur" value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{`${c.code} — ${c.name}`}</option>)}
            </Select>
          </Field>
          <Field label="Date format">
            <Segmented label="Date format" fill value={v.dateFormat} onChange={(x) => form.set('dateFormat', x)} options={[{ value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' }, { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' }]} />
          </Field>
          <Field label="Week starts on">
            <Segmented label="Week starts on" fill value={v.weekStartsOn} onChange={(x) => form.set('weekStartsOn', x)} options={[{ value: 'sunday', label: 'Sunday' }, { value: 'monday', label: 'Monday' }]} />
          </Field>
        </div>
      </Card>
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial.profile)} readOnly={readOnly} />
    </div>
  );
}

// --- Warehouses (location = warehouse) -------------------------------------------------------

function WarehousesTab({ slug, initial }: Props) {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <p className="text-[15px] text-fg-2">Every location is a warehouse your equipment ships from. Travel fees are measured by driving distance from the nearest one.</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {initial.warehouses.map((w, i) => (
          <li key={w.id} className="anim-rise" style={{ ['--d' as string]: `${i * 40}ms` }}>
            <Link href={`/${slug}/settings/locations?id=${w.id}`} className="lift flex items-start gap-3 rounded-[var(--radius-card)] border border-subtle bg-surface p-4">
              <span className="mono grid h-10 min-w-12 place-items-center rounded-[10px] bg-night px-2 text-xs font-bold text-volt">{w.code}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate font-semibold text-fg">{w.name}</span>{w.isPrimary && <Pill tone="info" dot={false}>Primary</Pill>}{!w.isActive && <Pill tone="neutral">Inactive</Pill>}</span>
                <span className="block truncate text-[13px] text-fg-2">{w.city || 'No address yet'} · free within {w.freeMiles} mi</span>
                <span className={cx('mt-1 flex items-center gap-1 text-xs', w.pinned ? 'text-success' : 'text-warning')}><MapPin className="size-3.5" />{w.pinned ? 'Pinned on the map' : 'Not pinned: travel fees cannot be measured'}</span>
              </span>
              <ArrowRight className="mt-1 size-4 text-fg-2" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/${slug}/settings/locations?new=1`} className="inline-flex items-center gap-2 self-start rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold text-accent-text hover:bg-sunken">
        <Plus className="size-4" /> Add another warehouse
      </Link>
    </div>
  );
}

// --- Email & payments ----------------------------------------------------------------------

function ConnectTab({ slug, initial, orgName, readOnly }: Props) {
  const saved = useSaved();
  const form = useForm(initial.connect);
  const save = () => {
    const body = connectPayload(form.values);
    const p = connectStepSchema.safeParse(body);
    if (!p.success) { form.setErrors(zodFieldErrors(p.error)); form.setStatus({ kind: 'error', text: 'A few fields need attention.' }); return; }
    form.submit(() => saveIntegrationsAction(slug, body), (r) => saved(r.message));
  };
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-fg">Email sending</h2>
          {initial.connect.mail.mode === 'smtp' && (initial.connect.mail.verifiedAt ? <Pill tone="success">Verified</Pill> : <Pill tone="warning">Not tested yet</Pill>)}
        </div>
        <MailFields s={scope(form, 'mail')} orgName={orgName} />
        <p className="text-[13px] text-fg-2">Each location can use its own mail server: Settings → Locations → Email (SMTP).</p>
      </Card>
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Text messages</h2>
        <SmsFields s={scope(form, 'sms')} />
      </Card>
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Card payments</h2>
        <PaymentFields s={scope(form, 'payments')} />
      </Card>
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial.connect)} readOnly={readOnly} />
    </div>
  );
}

// --- Rental rules --------------------------------------------------------------------------

function MoneyField({ id, label, cents, onChange, hint, suffix, currency }: { id: string; label: ReactNode; cents: number; onChange: (c: number) => void; hint?: ReactNode; suffix?: string; currency: string }) {
  const [txt, setTxt] = useState((cents / 100).toFixed(2));
  useEffect(() => { setTxt((t) => (Math.round(Number(t) * 100) === cents ? t : (cents / 100).toFixed(2))); }, [cents]);
  const sym = { USD: '$', GBP: '£', AED: 'AED', CAD: 'CA$' }[currency] ?? '$';
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <AffixInput id={id} mono inputMode="decimal" prefix={sym} suffix={suffix} value={txt} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); setTxt(t); if (t !== '' && !Number.isNaN(Number(t))) onChange(Math.round(Number(t) * 100)); }} />
    </Field>
  );
}

function RulesTab({ slug, initial, currency, readOnly }: Props) {
  const saved = useSaved();
  const form = useForm(initial.rules);
  const v = form.values;
  const save = () => {
    const p = bookingDefaultsSchema.safeParse(v);
    if (!p.success) { form.setErrors(zodFieldErrors(p.error)); form.setStatus({ kind: 'error', text: 'A few fields need attention.' }); return; }
    form.submit(() => saveRentalRulesAction(slug, v), (r) => saved(r.message));
  };
  const surfaces = v.setupSurfaces;
  const fmtBuffer = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card className="flex flex-col gap-6 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-fg">Deposits and quotes</h2>
          <p className="mt-1 text-[13px] text-fg-2">Every new quote starts with these. Staff can change them on an order.</p>
        </div>
        <Slider id="rr-deposit" label="Deposit to book" min={0} max={100} step={5} value={v.depositPercent} onChange={(n) => form.set('depositPercent', n)} display={`${v.depositPercent}%`} />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Quotes expire after" htmlFor="rr-expiry">
            <div className="flex items-center gap-3">
              <AffixInput id="rr-expiry" mono inputMode="numeric" suffix="days" disabled={v.quoteValidDays === null} value={v.quoteValidDays === null ? '' : String(v.quoteValidDays)} onChange={(e) => form.set('quoteValidDays', Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
              <Toggle checked={v.quoteValidDays === null} onChange={(never) => form.set('quoteValidDays', never ? null : 14)} label="Never" />
            </div>
          </Field>
          <MoneyField id="rr-min" label="Minimum booking" currency={currency} cents={v.minimumBookingCents} onChange={(c) => form.set('minimumBookingCents', c)} hint="0 = no minimum." />
        </div>
      </Card>

      <Card className="flex flex-col gap-6 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-fg">Time and overtime</h2>
          <p className="mt-1 text-[13px] text-fg-2">An item is busy from event start until return plus the cleanup buffer.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Slider id="rr-buffer" label="Cleanup buffer after return" min={0} max={480} step={15} value={v.cleanupBufferMinutes} onChange={(n) => form.set('cleanupBufferMinutes', n)} display={v.cleanupNextDay ? 'Next day' : fmtBuffer(v.cleanupBufferMinutes)} />
            <Toggle checked={v.cleanupNextDay} onChange={(x) => form.set('cleanupNextDay', x)} label="Next day" sub="Busy until the next morning instead." />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <MoneyField id="rr-ot" label="Overtime when there is no hourly rate" currency={currency} cents={v.overtimeBlockCents} onChange={(c) => form.set('overtimeBlockCents', c)} />
            <Field label="Per" htmlFor="rr-ot-min">
              <AffixInput id="rr-ot-min" mono inputMode="numeric" suffix="min" value={String(v.overtimeBlockMinutes)} onChange={(e) => form.set('overtimeBlockMinutes', Math.max(5, Number(e.target.value.replace(/\D/g, '')) || 5))} />
            </Field>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col gap-6 p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Fees</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="Damage waiver" htmlFor="rr-waiver" hint="Applied to rental items before discounts.">
              <AffixInput id="rr-waiver" mono inputMode="decimal" suffix="%" value={String(v.damageWaiverPercent)} onChange={(e) => form.set('damageWaiverPercent', Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
            </Field>
            <Toggle checked={v.damageWaiverDefaultOn} onChange={(x) => form.set('damageWaiverDefaultOn', x)} label="On by default" sub="Customers can decline it on the quote page." />
          </div>
          <MoneyField id="rr-locfee" label="Event location fee" currency={currency} cents={v.eventLocationFeeCents} onChange={(c) => form.set('eventLocationFeeCents', c)} hint="Parks and venues with permits. Added per order when turned on." />
        </div>
        <div>
          <p className="mb-3 text-[13px] font-semibold text-fg">Setup surfaces (fee per rental item)</p>
          <ul className="flex flex-col gap-2">
            {surfaces.map((sf, i) => (
              <li key={sf.code + i} className="grid grid-cols-[minmax(0,1fr)_150px_40px] items-center gap-2">
                <Input aria-label={`Surface ${i + 1} name`} value={sf.label} onChange={(e) => form.set(`setupSurfaces.${i}.label`, e.target.value)} />
                <MoneyField id={`rr-sf-${i}`} label={<span className="sr-only">Fee</span>} currency={currency} cents={sf.feeCents} onChange={(c) => form.set(`setupSurfaces.${i}.feeCents`, c)} />
                <Button variant="ghost" aria-label={`Remove ${sf.label}`} onClick={() => form.set('setupSurfaces', surfaces.filter((_, j) => j !== i))} disabled={surfaces.length <= 1}><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={() => form.set('setupSurfaces', [...surfaces, { code: `custom_${Date.now().toString(36)}`, label: 'New surface', feeCents: 0 }])}>Add surface</Button>
        </div>
      </Card>
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial.rules)} readOnly={readOnly} />
    </div>
  );
}

// --- Agreement & policies ------------------------------------------------------------------

function AgreementTab({ slug, initial, readOnly }: Props) {
  const saved = useSaved();
  const form = useForm(initial.agreement);
  const v = form.values;
  const start = initial.agreement;
  const reworded = v.title !== start.title || v.body !== start.body || JSON.stringify(v.policies) !== JSON.stringify(start.policies);
  const sections = useMemo(() => agreementSections(v.body).length, [v.body]);
  const save = () => {
    const p = agreementSchema.safeParse(v);
    if (!p.success) { form.setErrors(zodFieldErrors(p.error)); form.setStatus({ kind: 'error', text: 'A few fields need attention.' }); return; }
    form.submit(() => saveAgreementAction(slug, v), (r) => saved(r.message));
  };
  const today = new Date().toISOString().slice(0, 10);
  const addPolicy = () => {
    const used = new Set(v.policies.map((p) => p.key));
    let n = 1;
    while (used.has(`custom_${String.fromCharCode(96 + n)}`)) n++;
    form.set('policies', [...v.policies, { key: `custom_${String.fromCharCode(96 + n)}`, title: 'New policy', text: 'Describe what the customer agrees to.' }]);
  };
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <Card className="flex flex-col gap-6 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-fg">Rental agreement</h2>
          <p className="mt-1 text-[13px] text-fg-2">Customers read and sign this on the quote page. Each signature keeps the exact wording and version it was signed with.</p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_180px_170px]">
          <Field label="Title" htmlFor="ag-title" error={form.error('title')}>
            <Input id="ag-title" value={v.title} onChange={(e) => form.set('title', e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Version" htmlFor="ag-version" error={form.error('version')}>
            <Input id="ag-version" className="mono" value={v.version} onChange={(e) => form.set('version', e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="Rain checks valid for" htmlFor="ag-rain" error={form.error('rainCheckMonths')}>
            <AffixInput id="ag-rain" mono inputMode="numeric" suffix="months" value={String(v.rainCheckMonths)} onChange={(e) => form.set('rainCheckMonths', Math.min(60, Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1)))} disabled={readOnly} />
          </Field>
        </div>
        {reworded && v.version === start.version && (
          <Notice kind="warning">
            The wording changed but the version did not.{' '}
            <button type="button" className="font-semibold underline" onClick={() => form.set('version', today)}>Use {today}</button> so new signatures show which wording they agreed to.
          </Notice>
        )}
        <Field label="Agreement text" htmlFor="ag-body" error={form.error('body')} hint={`Start a line with "## " to make a heading · ${sections} section${sections === 1 ? '' : 's'}`}>
          <Textarea id="ag-body" rows={16} value={v.body} onChange={(e) => form.set('body', e.target.value)} disabled={readOnly} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-fg">Policies to accept</h2>
          <p className="mt-1 text-[13px] text-fg-2">
            Each one is ticked before signing. The damage waiver is answered accept or decline, and the price updates. <span className="mono">{'{months}'}</span> becomes the rain-check months.
          </p>
        </div>
        <ul className="flex flex-col gap-4">
          {v.policies.map((p, i) => (
            <li key={p.key} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-subtle p-4">
              <div className="flex items-end gap-2">
                <Field label={p.key === 'waiver' ? 'Title · accept or decline' : 'Title'} htmlFor={`ag-p-${i}`} error={form.error(`policies.${i}.title`)} className="min-w-0 flex-1">
                  <Input id={`ag-p-${i}`} value={p.title} onChange={(e) => form.set(`policies.${i}.title`, e.target.value)} disabled={readOnly} />
                </Field>
                <Button variant="ghost" aria-label={`Remove ${p.title}`} onClick={() => form.set('policies', v.policies.filter((_, j) => j !== i))} disabled={readOnly || v.policies.length <= 1}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Field label="What the customer agrees to" htmlFor={`ag-pt-${i}`} error={form.error(`policies.${i}.text`)}>
                <Textarea id={`ag-pt-${i}`} rows={2} value={p.text} onChange={(e) => form.set(`policies.${i}.text`, e.target.value)} disabled={readOnly} />
              </Field>
            </li>
          ))}
        </ul>
        {v.policies.length < 10 && !readOnly && (
          <Button variant="secondary" size="sm" className="self-start" icon={<Plus className="size-4" />} onClick={addPolicy}>Add policy</Button>
        )}
      </Card>
      {form.status?.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{form.status.text}</p>}
      <SaveBar dirty={form.dirty} pending={form.pending} onSave={save} onDiscard={() => form.reset(initial.agreement)} readOnly={readOnly} />
    </div>
  );
}
