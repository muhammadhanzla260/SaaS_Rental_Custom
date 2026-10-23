'use client';

import confetti from 'canvas-confetti';
import { ArrowLeft, ArrowRight, Building2, Check, CircleCheck, CircleX, MapPinned, Palette, PartyPopper, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  bookingDefaultsSchema, countryName, detectRegion, onboardingSchema, slugify, timezoneAt, type RadiusOption,
} from '@rental/core';
import { AddressFields, BrandingFields, LocationFields, LogoInput, ProfileFields, scope, scopeChild } from '@/components/fields';
import { EASE, ProgressBar } from '@/components/motion';
import { Button, cx, Field, Input, Notice, Toggle } from '@/components/ui';
import { useForm } from '@/lib/form';
import { zodFieldErrors } from '@/lib/result';
import { checkSlugAction, createOrganizationAction } from '@/server/actions/onboarding';
import { LivePreview } from './live-preview';

const STEPS = [
  { key: 'business', icon: Building2, title: 'Your business', lead: "Let's set up your rental business.", text: 'Who you are and where customers can reach you.' },
  { key: 'brand', icon: Palette, title: 'Brand', lead: 'Make it yours.', text: 'Your logo and colour appear across the app, emails, quotes and invoices.' },
  { key: 'location', icon: MapPinned, title: 'Location', lead: 'Where does your equipment ship from?', text: 'Your first location. Its map pin sets your time zone and drives delivery fees.' },
] as const;

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Draft = { slug: string; profile: Obj; branding: Obj; location: Obj; booking: Obj; deviceTimezone?: string };

const initialDraft = (): Draft => ({
  slug: '',
  profile: { name: '', legalName: '', email: '', phone: '', website: '', taxId: '', address: { country: 'US' } },
  branding: { brandColor: '#2450C8', themeMode: 'system', radius: 'soft' },
  location: { name: '', code: '', timezone: '', phone: '', email: '', address: { country: 'US' }, loadingNotes: '', isPrimary: true, isActive: true },
  booking: bookingDefaultsSchema.parse({}),
});

/** Validates only what a step owns, so errors appear where the person is. */
function stepErrors(step: number, d: Draft): Record<string, string> {
  const sh = onboardingSchema.shape;
  const checks: [string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, unknown][][] = [
    [['slug', sh.slug, d.slug], ['profile', sh.profile, d.profile]],
    [['branding', sh.branding, d.branding]],
    [['location', sh.location, d.location]],
  ];
  const out: Record<string, string> = {};
  for (const [prefix, schema, value] of checks[step]!) {
    const r = schema.safeParse(value);
    if (!r.success) for (const [k, msg] of Object.entries(zodFieldErrors(r.error as never))) out[k ? `${prefix}.${k}` : prefix] = msg;
  }
  return out;
}

export function OnboardingWizard({ ownerName, ownerEmail, appUrl }: { ownerName: string; ownerEmail: string; appUrl: string }) {
  const router = useRouter();
  const form = useForm<Draft>(initialDraft());
  const { values: v, set } = form;
  const [[step, dir], setStepDir] = useState<[number, number]>([0, 1]);
  const [slugTouched, setSlugTouched] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [sameAddress, setSameAddress] = useState(true);
  const [locNameTouched, setLocNameTouched] = useState(false);
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle');
  const [logo, setLogo] = useState<File | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light');
  const logoUrl = useMemo(() => (logo ? URL.createObjectURL(logo) : null), [logo]);
  useEffect(() => () => { if (logoUrl) URL.revokeObjectURL(logoUrl); }, [logoUrl]);

  useEffect(() => {
    set('deviceTimezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
    setPreviewMode(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, [set]);

  // The business name drives the web address and location code until edited by hand.
  useEffect(() => { if (!slugTouched) set('slug', slugify(v.profile.name ?? '')); }, [v.profile.name, slugTouched, set]);
  useEffect(() => {
    if (!codeTouched) set('location.code', (v.location.name || v.profile.address?.city || v.profile.name || '').replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase());
  }, [v.location.name, v.profile.address?.city, v.profile.name, codeTouched, set]);
  // "Same as the business address": the location follows the business address and pin.
  useEffect(() => { if (sameAddress) set('location.address', { ...v.profile.address }); }, [sameAddress, v.profile.address, set]);
  // The first location is named after the business city until renamed by hand.
  useEffect(() => { if (!locNameTouched) set('location.name', v.profile.address?.city ?? ''); }, [v.profile.address?.city, locNameTouched, set]);

  useEffect(() => {
    if (!v.slug) return setSlugState('idle');
    setSlugState('checking');
    const t = setTimeout(async () => {
      const res = await checkSlugAction(v.slug);
      setSlugState(!res.ok ? 'invalid' : res.data?.available ? 'free' : 'taken');
    }, 350);
    return () => clearTimeout(t);
  }, [v.slug]);

  const country = v.profile.address?.country || 'US';
  const pin = v.location.address;
  const region = useMemo(() => detectRegion(country, pin, v.deviceTimezone), [country, pin, v.deviceTimezone]);

  const go = (to: number) => {
    setStepDir([to, to > step ? 1 : -1]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const next = () => {
    const errs = stepErrors(step, v);
    if (step === 0 && slugState === 'taken') errs.slug = 'That web address is already taken.';
    form.setErrors(errs);
    if (Object.keys(errs).length) {
      form.setStatus({ kind: 'error', text: 'A few fields need attention.' });
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    form.setStatus(null);
    if (step < STEPS.length - 1) go(step + 1);
    else submit();
  };

  const submit = () =>
    startSubmit(async () => {
      const fd = new FormData();
      fd.set('payload', JSON.stringify(v));
      if (logo) fd.set('logo', logo);
      const res = await createOrganizationAction(fd);
      if (res.ok && res.data) {
        setDone(true);
        const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
        const colors = [v.branding.brandColor, brand, '#FFD166', '#06D6A0', '#EF476F'];
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors });
          setTimeout(() => confetti({ particleCount: 80, angle: 60, spread: 60, origin: { x: 0 }, colors }), 250);
          setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 1 }, colors }), 400);
        }
        setTimeout(() => router.push(`/${res.data!.slug}?welcome=1`), 1600);
        return;
      }
      if (!res.ok) {
        form.setErrors(res.fieldErrors ?? {});
        form.setStatus({ kind: 'error', text: res.error });
        const first = Object.keys(res.fieldErrors ?? {})[0] ?? '';
        const idx = ['slug|profile', 'branding', 'location|booking'].findIndex((p) => new RegExp(`^(${p})`).test(first));
        if (idx >= 0) go(idx);
      }
    });

  const current = STEPS[step]!;

  return (
    <div className="mx-auto max-w-7xl px-[max(1rem,env(safe-area-inset-left))] pb-24 pt-6 sm:px-6 lg:pt-10">
      {/* step pills */}
      <nav aria-label="Setup steps" className="mb-8">
        <ol className="flex items-center gap-2 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={i > step || submitting}
                onClick={() => go(i)}
                aria-current={i === step ? 'step' : undefined}
                className={cx(
                  'flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all',
                  i === step && 'brand-gradient text-brand-fg shadow-[0_8px_20px_-10px_var(--brand)]',
                  i < step && 'bg-brand-soft text-brand-text hover:brightness-95',
                  i > step && 'bg-surface text-muted ring-1 ring-line',
                )}
              >
                {i < step ? <Check aria-hidden className="size-4" /> : <s.icon aria-hidden className="size-4" />}
                <span className={cx(i !== step && 'hidden sm:inline')}>{s.title}</span>
              </button>
              {i < STEPS.length - 1 && <span aria-hidden className={cx('h-px w-6 sm:w-10', i < step ? 'bg-brand' : 'bg-line-strong')} />}
            </li>
          ))}
        </ol>
        <ProgressBar value={(step + 1) / STEPS.length} className="mt-4 h-1.5" />
      </nav>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
        <div className="min-w-0">
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={current.key}
              custom={dir}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex flex-col gap-6"
            >
              <header>
                <p className="text-sm font-medium text-brand-text">Step {step + 1} of {STEPS.length}{step === 0 ? ` · Welcome, ${ownerName.split(' ')[0]}` : ''}</p>
                <h1 className="mt-1 text-3xl font-bold leading-tight sm:text-4xl">{current.lead}</h1>
                <p className="mt-2 max-w-xl text-[17px] text-muted">{current.text}</p>
              </header>

              {form.status && <Notice kind={form.status.kind}>{form.status.text}</Notice>}

              {step === 0 && (
                <>
                  <Panel>
                    <Field label="Business name" htmlFor="profile-name" error={form.error('profile.name')}>
                      <Input id="profile-name" value={v.profile.name} onChange={(e) => set('profile.name', e.target.value)} autoComplete="organization"
                        placeholder="Freedom Fun USA" className="min-h-12 text-lg font-medium" aria-invalid={!!form.error('profile.name')} />
                    </Field>
                    <Field label="Your web address" htmlFor="slug" error={form.error('slug')}>
                      <div className="flex items-stretch">
                        <span className="hidden place-items-center rounded-l-ui-sm border border-r-0 border-line-strong bg-surface-2 px-3 text-sm text-muted sm:grid">
                          {appUrl.replace(/^https?:\/\//, '')}/
                        </span>
                        <Input id="slug" value={v.slug} className="font-mono sm:rounded-l-none" autoCapitalize="none" spellCheck={false}
                          onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }}
                          aria-invalid={!!form.error('slug') || slugState === 'taken'} />
                      </div>
                    </Field>
                    <p className="-mt-3 flex min-h-5 items-center gap-1.5 text-sm" aria-live="polite">
                      {slugState === 'checking' && <span className="text-muted">Checking…</span>}
                      {slugState === 'free' && <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1.5 text-ok"><CircleCheck aria-hidden className="size-4" /> Available</motion.span>}
                      {slugState === 'taken' && <span className="flex items-center gap-1.5 text-danger"><CircleX aria-hidden className="size-4" /> Already taken. Try another.</span>}
                    </p>
                    <ProfileFieldsWithoutName s={scope(form, 'profile')} country={country} />
                  </Panel>
                  <Panel title="Business address" text="Search and pick it. Printed on quotes and invoices.">
                    <AddressFields s={scopeChild(scope(form, 'profile'), 'address')} />
                  </Panel>
                </>
              )}

              {step === 1 && (
                <Panel>
                  <LogoInput id="logo" label="Logo" hint="PNG, JPG, WebP or SVG, up to 1 MB. Wide logos on a transparent background look best."
                    previewUrl={logoUrl} onFile={setLogo} onRemove={() => setLogo(null)} />
                  <BrandingFields s={scope(form, 'branding')} name={v.profile.name} logoUrl={logoUrl} />
                </Panel>
              )}

              {step === 2 && (
                <>
                  <Panel>
                    <Toggle id="same-address" checked={sameAddress} onChange={setSameAddress}
                      label="Equipment ships from the business address" description="Turn off if you keep it at a separate warehouse or yard." />
                  </Panel>
                  <Panel>
                    <LocationFields
                      s={{ ...scope(form, 'location'), set: (p, val) => {
                        if (p.startsWith('address')) setSameAddress(false);
                        if (p === 'name') setLocNameTouched(true);
                        set(`location.${p}`, val);
                      } }}
                      country={country}
                      near={v.profile.address?.lat != null ? { lat: v.profile.address.lat, lng: v.profile.address.lng } : null}
                      onCodeEdited={() => setCodeTouched(true)}
                    />
                  </Panel>
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex flex-wrap items-center gap-2 rounded-ui border border-brand/25 bg-brand-soft/60 px-4 py-3 text-sm">
                    <Sparkles aria-hidden className="size-4 text-brand-text" />
                    <span>Detected for you:</span>
                    {[countryName(region.country), region.timezone.replace(/_/g, ' '), region.currency, region.formats.distanceUnit === 'mi' ? 'Miles' : 'Kilometres'].map((x) => (
                      <span key={x} className="rounded-full bg-surface px-2.5 py-0.5 font-medium shadow-card">{x}</span>
                    ))}
                    {!timezoneAt(pin?.lat, pin?.lng) && <span className="text-muted">Pin the location for an exact time zone.</span>}
                  </motion.div>
                </>
              )}

            </motion.div>
          </AnimatePresence>

          <div className="sticky bottom-0 z-20 -mx-4 mt-8 flex items-center justify-between gap-3 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
            <Button type="button" variant="ghost" onClick={() => go(step - 1)} disabled={step === 0 || submitting}>
              <ArrowLeft aria-hidden className="size-4" /> Back
            </Button>
            <Button type="button" onClick={next} pending={submitting} className="min-h-12 px-6 text-base">
              {step === STEPS.length - 1 ? (<><PartyPopper aria-hidden className="size-5" /> Create my organization</>) : (<>Continue <ArrowRight aria-hidden className="size-4" /></>)}
            </Button>
          </div>
        </div>

        <aside className="hidden lg:block" aria-label="Live preview">
          <div className="sticky top-8 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-medium">
                <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-ok" /></span>
                Live preview of your app
              </p>
              <button type="button" onClick={() => setPreviewMode(previewMode === 'light' ? 'dark' : 'light')} className="rounded-full px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-line hover:text-ink">
                {previewMode === 'light' ? 'See dark mode' : 'See light mode'}
              </button>
            </div>
            <LivePreview
              name={v.profile.name}
              logoUrl={logoUrl}
              brandColor={v.branding.brandColor}
              radius={v.branding.radius as RadiusOption}
              location={{ name: v.location.name, city: v.location.address?.city, lat: pin?.lat, lng: pin?.lng }}
              depositPercent={Number(v.booking.depositPercent) || 0}
              currency={region.currency}
              mode={previewMode}
            />
          </div>
        </aside>
      </div>

      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-bg/80 backdrop-blur-sm" role="status">
            <motion.div initial={{ scale: 0.85, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              className="brand-gradient mx-4 flex max-w-md flex-col items-center gap-3 rounded-[24px] px-10 py-10 text-center text-brand-fg shadow-pop">
              <PartyPopper aria-hidden className="size-12" />
              <p className="font-display text-3xl font-bold">You&apos;re all set!</p>
              <p className="opacity-90">{v.profile.name} is ready. Opening your dashboard…</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Panel({ title, text, children }: { title?: string; text?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-[calc(var(--radius)*1.4)] border border-line bg-surface p-5 shadow-card sm:p-6">
      {title && (
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {text && <p className="mt-0.5 text-sm text-muted">{text}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Contact details (the name has its own big field above). */
function ProfileFieldsWithoutName({ s, country }: { s: ReturnType<typeof scope>; country: string }) {
  return <ProfileFields s={s} country={country} hideName />;
}
