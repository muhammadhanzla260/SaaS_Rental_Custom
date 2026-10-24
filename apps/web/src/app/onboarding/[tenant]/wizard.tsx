'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Copy, Plus, Rocket, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type ReactNode } from 'react';
import {
  brandStepSchema, checkAccent, connectStepSchema, CURRENCIES, initials, ONBOARDING_INVITE_ROLES,
  ONBOARDING_STEPS, parseZipList, PAYMENT_PROVIDERS, profileStepSchema, ROLE_LABELS, themeStyle, warehouseStepSchema,
  type BrandSettings, type Corners, type OnboardingProgress, type Role,
} from '@rental/core';
import {
  AffixInput, Button, cx, Field, Input, Notice, RadioCards, Segmented, Select, Textarea, useToast,
} from '@/components/kit';
import { LogoEditor, type LogoValue } from '@/components/brand/logo-editor';
import { logoImgStyle } from '@/components/brand/logo-mark';
import { ThemePicker } from '@/components/brand/theme-picker';
import { connectPayload, MailFields, PaymentFields, SmsFields } from '@/components/settings/connect-fields';
import { AddressBlock } from '@/components/fields/address';
import { scope, type Scope } from '@/components/fields/scope';
import { localTime, TimezoneSelect, zoneLabel } from '@/components/fields/timezone-select';
import { useForm } from '@/lib/form';
import { zodFieldErrors } from '@/lib/result';
import {
  launchAction, saveBrandStepAction, saveConnectStepAction, saveProfileStepAction, saveTeamStepAction, saveWarehouseStepAction, skipStepAction,
} from '@/server/actions/onboarding';

type Plan = 'starter' | 'growth' | 'scale';
export type WizardInitial = {
  profile: { name: string; legalName: string; phone: string; email: string; website: string; taxId: string; address: { country: string } };
  timezone: string;
  currency: string;
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY';
  weekStartsOn: 'sunday' | 'monday';
  branding: { brandColor: string; themeMode: 'light' | 'dark' | 'system'; radius: Corners };
  brand: BrandSettings;
  warehouse: {
    location: { name: string; code: string; phone: string; email: string; address: Record<string, unknown>; settings: Record<string, unknown> };
    travel: { freeTravelDistance: number; travelRateStaffed: number; travelRateDropoff: number };
    taxPercent: number;
  };
  connect: {
    mail: { mode: 'platform' | 'smtp'; provider: 'google' | 'microsoft' | 'zoho' | 'other'; host: string; port: number; security: 'starttls' | 'ssl' | 'none'; username: string; password: string; fromName: string; fromEmail: string; hasSecret: boolean };
    sms: { provider: 'none' | 'twilio' | 'quo'; sendingNumber: string; accountId: string; apiKey: string; hasSecret: boolean };
    payments: { provider: 'manual' | 'stripe' | 'ipos'; publishableKey: string; secretKey: string; merchantId: string; hasSecret: boolean };
  };
  invites: { email: string; role: Role }[];
  plan: Plan;
  progress: OnboardingProgress;
  launched: boolean;
};

type Draft = WizardInitial & { zipsText: string; team: { email: string; role: Role }[] };

const CUR_SYMBOL: Record<string, string> = { USD: '$', GBP: '£', AED: 'AED ', CAD: 'CA$' };
const STEP_SAVE_LABEL = ['Continue', 'Continue', 'Continue', 'Continue', 'Send invites', 'Launch workspace'];

function prefixErrors(prefix: string, errs: Record<string, string>) {
  return Object.fromEntries(Object.entries(errs).map(([k, v]) => [k ? `${prefix}.${k}` : prefix, v]));
}

export function OnboardingWizard({ slug, initial, startStep, logoUrl, ownerEmail }: { slug: string; initial: WizardInitial; startStep: number; logoUrl: string | null; ownerEmail: string }) {
  const router = useRouter();
  const toast = useToast();
  const form = useForm<Draft>({
    ...initial,
    zipsText: ((initial.warehouse.location.settings.servedZips as string[] | undefined) ?? []).join(', '),
    team: initial.invites.length ? [] : [{ email: '', role: 'sales' }, { email: '', role: 'crew' }],
  });
  const v = form.values;
  const [step, setStep] = useState(Math.min(startStep, 5));
  const [maxSeen, setMaxSeen] = useState(Math.max(startStep, ...initial.progress.done.map((d) => ONBOARDING_STEPS.findIndex((s) => s.key === d) + 1)));
  const [done, setDone] = useState<Set<string>>(new Set(initial.progress.done));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [codeTouched, setCodeTouched] = useState(!!initial.warehouse.location.code);
  const [nameTouched, setNameTouched] = useState(!!initial.warehouse.location.name);
  const [inviteLinks, setInviteLinks] = useState<{ email: string; url: string; delivered: boolean }[]>([]);
  const [finished, setFinished] = useState(false);
  const [pending, start] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const objectUrl = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : null), [logoFile]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  const logoSrc = objectUrl ?? (logoRemoved ? null : logoUrl);

  // The warehouse code follows the city until edited by hand (AUS, DAL).
  useEffect(() => {
    const city = String(v.warehouse.location.address.city ?? '');
    if (!codeTouched) form.set('warehouse.location.code', city.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase());
    if (!nameTouched) form.set('warehouse.location.name', city);
  }, [v.warehouse.location.address.city]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (n: number) => {
    setStep(n);
    setMaxSeen((m) => Math.max(m, n));
    form.setStatus(null);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fail = (errs: Record<string, string>, msg = 'A few fields need attention.') => {
    form.setErrors(errs);
    form.setStatus({ kind: 'error', text: msg });
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  };

  const payloads = {
    profile: () => ({ profile: v.profile, timezone: v.timezone, currency: v.currency, dateFormat: v.dateFormat, weekStartsOn: v.weekStartsOn }),
    brand: () => ({ branding: v.branding, brand: v.brand }),
    warehouse: () => ({
      location: { ...v.warehouse.location, isPrimary: true, isActive: true, settings: { ...v.warehouse.location.settings, servedZips: parseZipList(v.zipsText) } },
      travel: v.warehouse.travel,
      taxPercent: v.warehouse.taxPercent,
    }),
    connect: () => connectPayload(v.connect),
  };

  const markDone = (key: string) => setDone((d) => new Set([...d, key]));

  const next = () =>
    start(async () => {
      form.setStatus(null);
      if (step === 0) {
        const p = profileStepSchema.safeParse(payloads.profile());
        if (!p.success) return fail(zodFieldErrors(p.error));
        const r = await saveProfileStepAction(slug, payloads.profile());
        if (!r.ok) return fail(r.fieldErrors ?? {}, r.error);
      } else if (step === 1) {
        const p = brandStepSchema.safeParse(payloads.brand());
        if (!p.success) return fail(zodFieldErrors(p.error));
        const fd = new FormData();
        fd.set('payload', JSON.stringify(payloads.brand()));
        if (logoFile) fd.set('logo', logoFile);
        if (logoRemoved && !logoFile) fd.set('removeLogo', '1');
        const r = await saveBrandStepAction(slug, fd);
        if (!r.ok) return fail(r.fieldErrors ?? {}, r.error);
      } else if (step === 2) {
        const body = payloads.warehouse();
        const p = warehouseStepSchema.safeParse(body);
        if (!p.success) return fail(prefixErrors('warehouse', zodFieldErrors(p.error)));
        const r = await saveWarehouseStepAction(slug, body);
        if (!r.ok) return fail(prefixErrors('warehouse', r.fieldErrors ?? {}), r.error);
      } else if (step === 3) {
        const p = connectStepSchema.safeParse(payloads.connect());
        if (!p.success) return fail(prefixErrors('connect', zodFieldErrors(p.error)));
        const r = await saveConnectStepAction(slug, payloads.connect());
        if (!r.ok) return fail(prefixErrors('connect', r.fieldErrors ?? {}), r.error);
      } else if (step === 4) {
        const rows = v.team.filter((t) => t.email.trim());
        if (rows.length) {
          const r = await saveTeamStepAction(slug, rows);
          if (!r.ok) return fail(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, m]) => [`team.${k}`, m])), r.error);
          setInviteLinks(r.data?.links ?? []);
          form.set('invites', [...v.invites, ...rows]);
          form.set('team', []);
          if (r.data?.links.some((l) => !l.delivered)) {
            toast(`${rows.length} invite${rows.length === 1 ? '' : 's'} created. Copy the links below to send them.`, 'info');
            markDone('team');
            return;
          }
          toast(`${rows.length} invite${rows.length === 1 ? '' : 's'} sent.`);
        } else if (!inviteLinks.length && !v.invites.length) {
          await skipStepAction(slug, 'team');
        }
      } else {
        const r = await launchAction(slug, v.plan);
        if (!r.ok) return fail({}, r.error);
        markDone('launch');
        setFinished(true);
        return;
      }
      markDone(ONBOARDING_STEPS[step]!.key);
      go(step + 1);
    });

  const skip = () =>
    start(async () => {
      const key = ONBOARDING_STEPS[step]!.key;
      const r = await skipStepAction(slug, key);
      if (!r.ok) return fail({}, r.error);
      go(step + 1);
    });

  const name = v.profile.name || 'Your business';
  const progressPct = Math.round((step / 6) * 100);

  if (finished) return <DoneScreen name={name} slug={slug} logoSrc={logoSrc} brand={v.brand} accent={v.branding.brandColor} />;

  return (
    <div ref={top} className="min-h-dvh bg-canvas" style={themeStyle(v.branding.brandColor, v.branding.radius) as CSSProperties}>
      <header className="sticky top-0 z-30 border-b border-subtle bg-surface/90 backdrop-blur-md">
        <div className="flex h-16 items-center gap-3 px-[var(--gutter)] pt-[env(safe-area-inset-top)]">
          <PreviewMark src={logoSrc} adjust={v.brand.logo.icon} name={name} accent={v.branding.brandColor} size={36} />
          <p className="min-w-0 flex-1 truncate text-[15px]">
            <span className="text-fg-2 max-sm:hidden">Setting up </span>
            <span className="font-semibold text-fg">{name}</span>
          </p>
          <span className="mono text-[13px] text-fg-2 max-sm:hidden">Step {step + 1} of 6</span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken max-md:hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${progressPct}%` }} />
          </div>
          <Link href={`/${slug}`} className="rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold text-fg hover:bg-sunken">Save &amp; finish later</Link>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_400px] lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Setup steps" className="border-subtle lg:sticky lg:top-16 lg:h-[calc(100dvh-64px)] lg:border-r lg:p-5">
          <ol className="no-scrollbar flex gap-1.5 overflow-x-auto px-[var(--gutter)] py-3 lg:flex-col lg:px-0 lg:py-0">
            {ONBOARDING_STEPS.map((s, i) => {
              const on = i === step;
              const isDone = done.has(s.key) && !on;
              const reachable = i <= maxSeen || isDone;
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    disabled={!reachable || pending}
                    onClick={() => go(i)}
                    aria-current={on ? 'step' : undefined}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors',
                      on ? 'bg-surface shadow-[0_1px_3px_rgb(16_19_26/0.08)]' : reachable ? 'hover:bg-surface/60' : 'opacity-60',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-8 shrink-0 place-items-center rounded-full border text-[13px] font-bold transition-colors',
                        isDone ? 'border-success bg-success text-white' : on ? 'border-accent bg-accent text-on-accent' : 'border-control bg-surface text-fg-2',
                      )}
                    >
                      {isDone ? <Check className="anim-pop size-4" strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 max-lg:hidden">
                      <span className="block text-[15px] font-semibold text-fg">{s.title}</span>
                      <span className="block text-[13px] text-fg-2">{s.sub}</span>
                    </span>
                    <span className="text-sm font-semibold text-fg lg:hidden">{on ? s.title : ''}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main id="main" className="min-w-0 px-[var(--gutter)] pb-28 pt-6 lg:pt-12">
          <div key={step} className="anim-rise mx-auto max-w-[760px]">
            {form.status?.kind === 'error' && <Notice kind="danger" className="mb-5">{form.status.text}</Notice>}
            {step === 0 && <StepProfile form={form} />}
            {step === 1 && (
              <StepBrand
                form={form}
                logoSrc={logoSrc}
                fileName={logoFile ? `${logoFile.name} · ${Math.max(1, Math.round(logoFile.size / 1024))} KB` : null}
                onFile={(f) => { setLogoFile(f); setLogoRemoved(false); }}
                onRemove={() => { setLogoFile(null); setLogoRemoved(true); }}
              />
            )}
            {step === 2 && <StepWarehouse form={form} onCodeEdited={() => setCodeTouched(true)} onNameEdited={() => setNameTouched(true)} />}
            {step === 3 && <StepConnect form={form} />}
            {step === 4 && <StepTeam form={form} links={inviteLinks} ownerEmail={ownerEmail} />}
            {step === 5 && <StepLaunch form={form} logo={!!logoSrc} go={go} connected={done.has('connect')} />}
          </div>
        </main>

        <aside className="hidden border-l border-subtle p-6 xl:block" aria-label="Live preview">
          <div className="sticky top-24">
            <LivePreview v={v} logoSrc={logoSrc} />
          </div>
        </aside>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-surface/95 backdrop-blur-md lg:left-[240px] xl:left-[260px] xl:right-[400px]">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 px-[var(--gutter)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || pending} className={cx(step === 0 && 'invisible')}>
            <ArrowLeft className="size-4" /> Back
          </Button>
          <div className="flex-1" />
          {(step === 3 || (step === 4 && !inviteLinks.length && !v.team.some((t) => t.email.trim()))) && (
            <Button variant="ghost" onClick={step === 4 ? next : skip} disabled={pending}>
              Skip for now
            </Button>
          )}
          <Button size="lg" onClick={next} pending={pending} className="min-w-[150px]">
            {step === 5 ? <Rocket className="size-4" /> : null}
            {step === 4 && !v.team.some((t) => t.email.trim()) ? 'Continue' : STEP_SAVE_LABEL[step]}
            {step < 5 && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </footer>
    </div>
  );
}

type Form = ReturnType<typeof useForm<Draft>>;

function StepHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-[32px] font-extrabold leading-[1.05] tracking-[-0.02em] text-fg sm:text-[44px]">{title}</h1>
      <p className="mt-2 text-base text-fg-2 sm:text-[17px]">{sub}</p>
    </div>
  );
}

function Text({ s, name, label, hint, optional, type = 'text', auto, placeholder, mono }: { s: Scope; name: string; label: string; hint?: string; optional?: boolean; type?: string; auto?: string; placeholder?: string; mono?: boolean }) {
  const id = `${s.id}-${name}`;
  return (
    <Field label={label} htmlFor={id} hint={hint} error={s.err(name)} optional={optional}>
      <Input id={id} type={type} value={s.v[name] ?? ''} onChange={(e) => s.set(name, e.target.value)} invalid={!!s.err(name)} autoComplete={auto} placeholder={placeholder} mono={mono} />
    </Field>
  );
}

function StepProfile({ form }: { form: Form }) {
  const v = form.values;
  const s = scope(form, 'profile');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return (
    <>
      <StepHead title="Business profile" sub="How customers see you on quotes, invoices and emails." />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Text s={s} name="name" label="Display name" auto="organization" />
        <Text s={s} name="legalName" label="Legal name" hint="Printed on invoices and the rental agreement." optional />
        <Text s={s} name="phone" label="Business phone" type="tel" auto="tel" placeholder="+1 (512) 555-0100" />
        <Text s={s} name="email" label="Customer-facing email" type="email" placeholder="bookings@yourbusiness.com" optional />
        <Text s={s} name="website" label="Website" type="url" placeholder="https://" optional />
        <Text s={s} name="taxId" label="Tax ID / EIN" placeholder="Optional" optional />
      </div>
      <h2 className="eyebrow mb-4 mt-10">Region</h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Time zone" htmlFor="ob-tz" error={form.error('timezone')} hint={<>Local time now: <span className="mono font-semibold text-fg">{localTime(v.timezone, now)}</span>. Reminders fire on this clock.</>}>
          <TimezoneSelect id="ob-tz" value={v.timezone} onChange={(tz) => form.set('timezone', tz)} invalid={!!form.error('timezone')} />
        </Field>
        <Field label="Currency" htmlFor="ob-cur">
          <Select id="ob-cur" value={v.currency} onChange={(e) => form.set('currency', e.target.value)}>
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
    </>
  );
}

function StepBrand({ form, logoSrc, fileName, onFile, onRemove }: { form: Form; logoSrc: string | null; fileName: string | null; onFile: (f: File) => void; onRemove: () => void }) {
  const v = form.values;
  return (
    <>
      <StepHead title="Brand & theme" sub="Your logo and colours apply to the app, customer pages, emails and PDFs. Watch the preview." />
      <section className="rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Logo</h2>
        <p className="mb-5 mt-1 text-[13px] text-fg-2">Upload once, then adjust size, position, padding, background and shape for each place it appears.</p>
        <LogoEditor
          src={logoSrc}
          fileName={fileName}
          value={v.brand.logo as LogoValue}
          onChange={(l) => form.set('brand.logo', l)}
          onFile={onFile}
          onRemove={onRemove}
          brandColor={v.branding.brandColor}
          name={v.profile.name || 'Your business'}
        />
      </section>
      <section className="mt-5 flex flex-col gap-6 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <Field label="Theme colour" error={form.error('branding.brandColor')}>
          <ThemePicker value={v.branding.brandColor} onChange={(hex) => form.set('branding.brandColor', hex)} />
        </Field>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Sidebar">
            <Segmented label="Sidebar" fill value={v.brand.sidebar} onChange={(x) => form.set('brand.sidebar', x)} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'brand', label: 'Brand' }]} />
          </Field>
          <Field label="Corners">
            <Segmented label="Corners" fill value={v.branding.radius} onChange={(x) => form.set('branding.radius', x)} options={[{ value: 'round', label: 'Rounded' }, { value: 'soft', label: 'Soft' }, { value: 'sharp', label: 'Sharp' }]} />
          </Field>
          <Field label="Default appearance" hint="Each person can still switch in their profile.">
            <Segmented label="Default appearance" fill value={v.branding.themeMode} onChange={(x) => form.set('branding.themeMode', x)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
          </Field>
        </div>
        <Field label="Custom domain" htmlFor="ob-domain" optional hint="Optional. Customer quote and pay links use it once DNS is verified." error={form.error('brand.customDomain')}>
          <Input id="ob-domain" mono placeholder="book.yourbusiness.com" value={v.brand.customDomain ?? ''} onChange={(e) => form.set('brand.customDomain', e.target.value)} invalid={!!form.error('brand.customDomain')} />
        </Field>
      </section>
    </>
  );
}

function NumberField({ id, label, value, onChange, prefix, suffix, hint, step = 1, min = 0, error }: { id: string; label: ReactNode; value: number; onChange: (n: number) => void; prefix?: string; suffix?: string; hint?: ReactNode; step?: number; min?: number; error?: string }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { setTxt((t) => (Number(t) === value ? t : String(value))); }, [value]);
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <AffixInput
        id={id}
        mono
        inputMode="decimal"
        prefix={prefix}
        suffix={suffix}
        value={txt}
        step={step}
        min={min}
        invalid={!!error}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
          setTxt(t);
          if (t !== '' && !Number.isNaN(Number(t))) onChange(Number(t));
        }}
      />
    </Field>
  );
}

function StepWarehouse({ form, onCodeEdited, onNameEdited }: { form: Form; onCodeEdited: () => void; onNameEdited: () => void }) {
  const v = form.values;
  const loc = scope(form, 'warehouse.location');
  const addr = scope(form, 'warehouse.location.address');
  const cur = CUR_SYMBOL[v.currency] ?? '$';
  const t = v.warehouse.travel;
  return (
    <>
      <StepHead title="Warehouse & service area" sub="Where your equipment ships from. Travel fees are measured by driving distance from here." />
      <section className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Warehouse name" htmlFor="warehouse-location-name" error={loc.err('name')} hint="Follows the city until you change it.">
            <Input id="warehouse-location-name" placeholder="Austin" value={v.warehouse.location.name} invalid={!!loc.err('name')} onChange={(e) => { onNameEdited(); loc.set('name', e.target.value); }} />
          </Field>
          <Field label="Code" htmlFor="wh-code" hint="Used in document numbers, like Q-AUS-01042." error={loc.err('code')}>
            <Input id="wh-code" mono maxLength={8} value={v.warehouse.location.code} onChange={(e) => { onCodeEdited(); loc.set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); }} invalid={!!loc.err('code')} />
          </Field>
        </div>
        <AddressBlock s={addr} requireStreet compact />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Text s={loc} name="phone" label="Warehouse phone" type="tel" hint="Shown to crew and on pick-up instructions." optional />
          <NumberField id="wh-tax" label="Sales tax" suffix="%" step={0.01} value={v.warehouse.taxPercent} onChange={(n) => form.set('warehouse.taxPercent', n)} hint="Default rate for orders from here. Change per order with permission." />
        </div>
        <p className="text-[13px] text-fg-2">More warehouses? Add them any time in Settings → Locations. Each one has its own clock, tax and numbering.</p>
      </section>

      <section className="mt-5 flex flex-col gap-5 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-fg">Delivery &amp; travel fee</h2>
          <p className="mt-1 text-[13px] text-fg-2">
            Free within <span className="mono font-semibold text-fg">{t.freeTravelDistance} mi</span> of {v.warehouse.location.name || 'the warehouse'}. Beyond that, each extra mile is charged (pick-up orders pay no travel, as in Odoo).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <NumberField id="wh-free" label="Free travel miles" suffix="mi" value={t.freeTravelDistance} onChange={(n) => form.set('warehouse.travel.freeTravelDistance', n)} />
          <NumberField id="wh-rate" label="Rate per extra mile" prefix={cur.trim()} step={0.25} value={t.travelRateStaffed} onChange={(n) => form.set('warehouse.travel.travelRateStaffed', n)} hint="Staffed orders." />
          <NumberField id="wh-rate-drop" label="Rate per mile, drop-off" prefix={cur.trim()} step={0.25} value={t.travelRateDropoff} onChange={(n) => form.set('warehouse.travel.travelRateDropoff', n)} hint="Any drop-off line uses this rate." />
        </div>
        <Field label="ZIP codes you serve" htmlFor="wh-zips" optional hint="Orders outside are flagged, not blocked. Separate with commas or spaces.">
          <Textarea id="wh-zips" rows={2} className="mono" value={v.zipsText} onChange={(e) => form.set('zipsText', e.target.value)} placeholder="78701, 78702, 78703" />
        </Field>
      </section>
    </>
  );
}

function StepConnect({ form }: { form: Form }) {
  return (
    <>
      <StepHead title="Email, SMS & payments" sub="How messages reach customers and how they pay. You can finish this later." />
      <section className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Email sending</h2>
        <MailFields s={scope(form, 'connect.mail')} orgName={form.values.profile.name} />
      </section>
      <section className="mt-5 flex flex-col gap-5 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Text messages</h2>
        <SmsFields s={scope(form, 'connect.sms')} />
      </section>
      <section className="mt-5 flex flex-col gap-5 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <h2 className="text-base font-bold text-fg">Card payments</h2>
        <PaymentFields s={scope(form, 'connect.payments')} />
      </section>
    </>
  );
}

function StepTeam({ form, links, ownerEmail }: { form: Form; links: { email: string; url: string; delivered: boolean }[]; ownerEmail: string }) {
  const team = form.values.team;
  const invites = form.values.invites;
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <>
      <StepHead title="Invite your team" sub="Add the people who quote, deliver and keep the books. You're the owner." />
      {links.some((l) => !l.delivered) && (
        <Notice kind="info" className="mb-5">Platform email is not set up yet, so copy each link and send it yourself. Links work once and expire in 7 days.</Notice>
      )}
      {links.length > 0 && (
        <ul className="mb-5 flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.email} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-subtle bg-surface p-2.5 text-sm">
              <Check className="size-4 text-success" />
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{l.email}</span>
              {!l.delivered && (
                <Button size="sm" variant="secondary" icon={copied === l.email ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} onClick={async () => { await navigator.clipboard.writeText(l.url); setCopied(l.email); }}>
                  {copied === l.email ? 'Copied' : 'Copy link'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {invites.length > 0 && links.length === 0 && (
        <p className="mb-4 text-[13px] text-fg-2">Already invited: {invites.map((i) => `${i.email} (${ROLE_LABELS[i.role].label})`).join(', ')}.</p>
      )}
      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-subtle bg-surface p-5 sm:p-6">
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-sunken px-3 py-2.5 text-sm">
          <span className="min-w-0 flex-1 truncate text-fg">{ownerEmail}</span>
          <span className="rounded-md bg-night px-2 py-0.5 text-xs font-bold text-volt">Owner</span>
        </div>
        {team.map((row, i) => (
          <div key={i} className="anim-rise flex flex-wrap items-start gap-2 sm:flex-nowrap">
            <div className="min-w-0 flex-1 basis-full sm:basis-auto">
              <Input
                type="email"
                aria-label={`Invite email ${i + 1}`}
                placeholder="name@yourbusiness.com"
                value={row.email}
                invalid={!!form.error(`team.${i}.email`)}
                onChange={(e) => form.set(`team.${i}.email`, e.target.value)}
              />
              {form.error(`team.${i}.email`) && <p className="mt-1 text-xs font-medium text-danger">{form.error(`team.${i}.email`)}</p>}
            </div>
            <Select aria-label={`Role for invite ${i + 1}`} value={row.role} onChange={(e) => form.set(`team.${i}.role`, e.target.value)} className="flex-1 sm:w-40 sm:flex-none">
              {ONBOARDING_INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r].label}</option>)}
            </Select>
            <Button variant="ghost" aria-label={`Remove invite ${i + 1}`} onClick={() => form.set('team', team.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button variant="secondary" className="self-start" icon={<Plus className="size-4" />} onClick={() => form.set('team', [...team, { email: '', role: 'crew' }])}>Add another</Button>
        <p className="text-[13px] text-fg-2">Coaches are invited later from Team &amp; roles.</p>
      </section>
    </>
  );
}

function StepLaunch({ form, logo, go, connected }: { form: Form; logo: boolean; go: (n: number) => void; connected: boolean }) {
  const v = form.values;
  const swatch = (['Cobalt', 'Emerald', 'Ember', 'Berry', 'Violet', 'Teal', 'Ink'] as const)[['#2C4FE0', '#0B7A55', '#C2410C', '#B0306A', '#6D3FD6', '#0E7490', '#10131A'].indexOf(v.branding.brandColor.toUpperCase())] ?? 'Custom';
  const summary: { title: string; body: string; step: number }[] = [
    { title: 'Business', body: `${v.profile.name} · ${zoneLabel(v.timezone)} · ${v.currency}`, step: 0 },
    { title: 'Brand', body: `${logo ? 'Logo uploaded' : 'Initials as logo'} · ${swatch} theme · ${v.brand.sidebar} sidebar · ${v.branding.radius === 'round' ? 'rounded' : v.branding.radius} corners`, step: 1 },
    { title: 'Warehouse', body: `Ships from ${v.warehouse.location.address.city || v.warehouse.location.name || '—'} · free within ${v.warehouse.travel.freeTravelDistance} miles`, step: 2 },
    { title: 'Messaging & payments', body: connected ? `${v.connect.mail.mode === 'smtp' ? 'Own SMTP' : 'Platform sender'} · ${PAYMENT_PROVIDERS.find((p) => p.key === v.connect.payments.provider)?.label}` : 'Not set up yet · finish later in Settings', step: 3 },
    { title: 'Team', body: `${v.invites.length} invite${v.invites.length === 1 ? '' : 's'} sent`, step: 4 },
    { title: 'Rental rules', body: 'Set later in Settings → Rental rules, before you take bookings', step: -1 },
  ];
  return (
    <>
      <StepHead title="Review & launch" sub="Everything here can be changed later in Settings." />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {summary.map((m, i) => (
          <li key={m.title} className="anim-rise flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-subtle bg-surface p-4" style={{ ['--d' as string]: `${i * 50}ms` }}>
            <div className="min-w-0">
              <p className="text-sm font-bold text-fg">{m.title}</p>
              <p className="mt-1 text-[13px] text-fg-2">{m.body}</p>
            </div>
            {m.step >= 0 && <button type="button" onClick={() => go(m.step)} className="shrink-0 text-[13px] font-semibold text-accent-text hover:underline">Edit</button>}
          </li>
        ))}
      </ul>
      <h2 className="eyebrow mb-3 mt-8">Plan</h2>
      <RadioCards
        label="Plan"
        columns={3}
        value={v.plan}
        onChange={(p) => form.set('plan', p)}
        options={[
          { value: 'starter', label: 'Starter', sub: '1 location · 5 users' },
          { value: 'growth', label: 'Growth', sub: '3 locations · 25 users' },
          { value: 'scale', label: 'Scale', sub: 'Unlimited locations and users' },
        ]}
      />
      <p className="mt-3 text-[13px] text-fg-2">Free during the trial. Prices and billing arrive with self-serve plans (Phase 6).</p>
    </>
  );
}

function PreviewMark({ src, adjust, name, accent, size }: { src: string | null; adjust: BrandSettings['logo']['icon']; name: string; accent: string; size: number }) {
  if (!src) {
    return (
      <span className="grid shrink-0 place-items-center rounded-[10px] font-bold" style={{ width: size, height: size, background: accent, color: /^#[0-9a-f]{6}$/i.test(accent) ? checkAccent(accent).onAccent : '#FFFFFF', fontSize: size * 0.36 }}>
        {initials(name)}
      </span>
    );
  }
  const bg = { none: '#FFFFFF', white: '#FFFFFF', brand: /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#0B0D12', dark: '#0B0D12' }[adjust.background];
  const radius = adjust.shape === 'circle' ? '50%' : adjust.shape === 'rounded' ? size * 0.25 : 4;
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden" style={{ width: size, height: size, background: bg, borderRadius: radius, padding: Math.round((adjust.padding * size) / 110) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-contain" style={logoImgStyle(adjust)} />
    </span>
  );
}

function LivePreview({ v, logoSrc }: { v: Draft; logoSrc: string | null }) {
  const dark = v.branding.themeMode === 'dark';
  const style = themeStyle(v.branding.brandColor, v.branding.radius, dark ? 'dark' : 'light') as CSSProperties;
  const accent = v.branding.brandColor;
  const on = checkAccent(accent).onAccent;
  const side = v.brand.sidebar;
  const sideBg = side === 'dark' ? '#0B0D12' : side === 'brand' ? accent : dark ? '#141821' : '#FFFFFF';
  const sideFg = side === 'light' ? (dark ? '#EEF0F4' : '#10131A') : side === 'brand' ? on : '#EEF0F4';
  const cur = CUR_SYMBOL[v.currency] ?? '$';
  const code = (v.warehouse.location.code || v.profile.name.replace(/[^a-z]/gi, '').slice(0, 3) || 'ABC').toUpperCase();
  const deposit = 30;
  const radius = v.branding.radius === 'sharp' ? 4 : v.branding.radius === 'soft' ? 10 : 18;
  return (
    <div className="flex flex-col gap-5" style={style}>
      <div className="flex items-center justify-between">
        <p className="eyebrow">Live preview</p>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-success"><span className="anim-blink size-1.5 rounded-full bg-success" />Updates as you type</p>
      </div>
      <div className="flex h-56 overflow-hidden border border-subtle shadow-[var(--shadow-lift)] transition-[border-radius] duration-300" style={{ borderRadius: radius, background: dark ? '#0B0D12' : '#F3F4F6' }}>
        <div className="flex w-[30%] flex-col gap-2.5 p-3 transition-colors duration-300" style={{ background: sideBg, borderRight: side === 'light' ? '1px solid var(--border-subtle)' : 'none' }}>
          <PreviewMark src={logoSrc} adjust={v.brand.logo.icon} name={v.profile.name} accent={accent} size={30} />
          <span className="h-2 rounded-full transition-colors" style={{ background: side === 'dark' ? 'rgb(255 255 255/0.12)' : side === 'brand' ? 'rgb(0 0 0/0.15)' : 'var(--accent-soft)' }}>
            <span className="block h-full w-2/3 rounded-full" style={{ background: side === 'dark' ? accent : sideFg, opacity: side === 'dark' ? 1 : 0.8 }} />
          </span>
          {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-4/5 rounded-full" style={{ background: sideFg, opacity: 0.18 }} />)}
        </div>
        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-bold" style={{ color: dark ? '#EEF0F4' : '#10131A' }}>{v.profile.name || 'Your business'}</span>
            <span className="shrink-0 px-2 py-1 text-[11px] font-semibold transition-[border-radius] duration-300" style={{ background: accent, color: on, borderRadius: Math.max(4, radius * 0.5) }}>New order</span>
          </div>
          <div className="p-2.5 transition-[border-radius] duration-300" style={{ background: dark ? '#141821' : '#FFFFFF', borderRadius: Math.max(4, radius * 0.6), border: `1px solid ${dark ? '#232835' : '#E2E5EA'}` }}>
            <div className="flex items-start justify-between gap-1">
              <span className="text-[11px] font-semibold" style={{ color: dark ? '#EEF0F4' : '#10131A' }}>Bounce house · Sat</span>
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}>Booked</span>
            </div>
            <span className="mt-2 block h-1.5 w-4/5 rounded-full" style={{ background: accent }} />
            <span className="mono mt-1.5 block text-[10px]" style={{ color: dark ? '#A3ABB9' : '#535C6B' }}>{localTime(v.timezone)} · {v.timezone}</span>
          </div>
        </div>
      </div>
      <div className="overflow-hidden bg-surface shadow-[var(--shadow-lift)] transition-[border-radius] duration-300" style={{ borderRadius: radius }}>
        <div className="flex items-center gap-3 p-4 transition-colors duration-300" style={{ background: v.brand.emailHeader === 'white' ? '#FFFFFF' : accent, color: v.brand.emailHeader === 'white' ? '#10131A' : on }}>
          <PreviewMark src={logoSrc} adjust={v.brand.logo.onDark} name={v.profile.name} accent={v.brand.emailHeader === 'white' ? accent : 'rgba(255,255,255,0.2)'} size={34} />
          <div className="min-w-0">
            <p className="font-display text-[17px] font-bold">Your quote is ready</p>
            <p className="mono text-xs opacity-80">Q-{code}-01001</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 p-4 text-[13px]">
          <div className="flex justify-between"><span className="text-fg-2">Total</span><span className="mono font-semibold text-fg">{cur}1,000.00</span></div>
          <div className="flex justify-between"><span className="text-fg-2">Deposit due today · {deposit}%</span><span className="mono font-semibold text-fg">{cur}{(1000 * deposit / 100).toFixed(2)}</span></div>
          <span className="mt-2 grid h-10 place-items-center text-sm font-semibold transition-[border-radius] duration-300" style={{ background: accent, color: on, borderRadius: Math.max(4, radius * 0.55) }}>Sign &amp; pay deposit</span>
          <p className="mt-1 text-xs text-fg-2">{v.profile.name || 'Your business'} · {v.profile.phone || '[PHONE]'} · Ships from {String(v.warehouse.location.address.city || '[CITY]')}</p>
        </div>
      </div>
    </div>
  );
}

const CONFETTI = ['#D4FF3A', '#FFFFFF', '#9FD8FF', '#FF6B6B', '#F5B04C'];

function DoneScreen({ name, slug, logoSrc, brand, accent }: { name: string; slug: string; logoSrc: string | null; brand: BrandSettings; accent: string }) {
  const roadmap = [
    { tag: 'P0', name: 'Workspace set up', sub: 'Brand, warehouse, team', state: 'Done', on: 'done' },
    { tag: 'P1', name: 'Catalog & booking', sub: 'Products, prices, inventory, calendar', state: 'Next', on: 'next' },
    { tag: 'P2', name: 'Quotes, deposits & payments', sub: 'Quote links, signatures, invoices, receipts', state: 'Locked', on: '' },
    { tag: 'P3', name: 'Operations', sub: 'Reminders, auto-charge, reports', state: 'Locked', on: '' },
  ];
  return (
    <main id="main" className="ink-grid relative grid min-h-dvh place-items-center overflow-hidden px-[var(--gutter)] py-12 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {Array.from({ length: 28 }, (_, i) => (
          <span
            key={i}
            className="absolute top-[-20px] size-2.5 rounded-[2px] motion-safe:animate-[confetti_2.4s_ease-in_both]"
            style={{ left: `${(i * 37) % 100}%`, background: i % 6 === 1 ? accent : CONFETTI[i % CONFETTI.length], animationDelay: `${(i * 83) % 900}ms` }}
          />
        ))}
      </div>
      <div className="relative w-full max-w-xl text-center">
        <div className="anim-pop mx-auto w-fit"><PreviewMark src={logoSrc} adjust={brand.logo.icon} name={name} accent={accent} size={72} /></div>
        <h1 className="anim-rise mt-6 font-display text-[40px] font-extrabold leading-tight tracking-[-0.02em] sm:text-5xl">{name} is set up.</h1>
        <p className="anim-rise mt-3 text-lg text-[#A3ABB9]" style={{ ['--d' as string]: '100ms' }}>Next, add what you rent. Each stage unlocks the next one.</p>
        <ol className="mt-8 flex flex-col gap-2.5 text-left">
          {roadmap.map((r, i) => (
            <li
              key={r.tag}
              className="anim-rise flex items-center gap-3 rounded-[14px] border px-4 py-3"
              style={{ ['--d' as string]: `${200 + i * 90}ms`, background: r.on === 'next' ? 'rgb(212 255 58 / 0.08)' : 'rgb(255 255 255 / 0.03)', borderColor: r.on === 'next' ? 'rgb(212 255 58 / 0.4)' : '#232835' }}
            >
              <span className={cx('mono rounded-md px-2 py-1 text-xs font-bold', r.on === 'done' ? 'bg-success text-white' : r.on === 'next' ? 'bg-volt text-night' : 'bg-[#232835] text-[#A3ABB9]')}>{r.tag}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.name}</span>
                <span className="block text-[13px] text-[#A3ABB9]">{r.sub}</span>
              </span>
              <span className={cx('text-[13px] font-semibold', r.on === 'done' ? 'text-[#3DD39A]' : r.on === 'next' ? 'text-volt' : 'text-[#7D8594]')}>{r.state}</span>
            </li>
          ))}
        </ol>
        <Link href={`/${slug}`} className="press mt-9 inline-flex h-12 items-center gap-2 rounded-xl bg-volt px-6 text-[15px] font-bold text-night hover:brightness-95">
          Go to my workspace <ArrowRight className="size-4" />
        </Link>
      </div>
    </main>
  );
}
