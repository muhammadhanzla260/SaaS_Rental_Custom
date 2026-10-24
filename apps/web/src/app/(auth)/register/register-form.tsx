'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, X } from 'lucide-react';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { PASSWORD_LABELS, PASSWORD_MIN, passwordScore, SIGNUP_COUNTRIES, slugify } from '@rental/core';
import { AffixInput, Button, Checkbox, cx, Field, Input, Notice, Select } from '@/components/kit';
import { PasswordMeter } from '@/components/auth/password-meter';
import { registerAction } from '@/server/actions/auth';
import { checkSlugAction } from '@/server/actions/platform';

type SlugState = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

export function RegisterForm({ domain, signedIn }: { domain: string; signedIn: { name: string; email: string } | null }) {
  const router = useRouter();
  const [v, setV] = useState({ businessName: '', slug: '', ownerName: '', country: 'US', email: '', password: '', acceptTerms: false });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState<{ state: SlugState; msg: string }>({ state: 'idle', msg: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));

  useEffect(() => { if (!slugTouched) set('slug', slugify(v.businessName)); }, [v.businessName, slugTouched]);
  useEffect(() => {
    if (!v.slug) return setSlug({ state: 'idle', msg: '' });
    setSlug({ state: 'checking', msg: '' });
    const t = setTimeout(async () => {
      const r = await checkSlugAction(v.slug);
      setSlug(!r.ok ? { state: 'invalid', msg: r.error } : { state: r.data?.available ? 'free' : 'taken', msg: '' });
    }, 300);
    return () => clearTimeout(t);
  }, [v.slug]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await registerAction({ ...v, deviceTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setError(r.error);
        requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      router.push(r.data!.href);
      router.refresh();
    });
  };

  const score = passwordScore(v.password);
  return (
    <form onSubmit={submit} noValidate className="anim-rise">
      <h1 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-fg sm:text-[40px]">Create your workspace</h1>
      <p className="mt-2 text-base text-fg-2">{signedIn ? `Signed in as ${signedIn.email}. Add another business.` : 'Free trial. No card needed to start.'}</p>
      {error && <Notice kind="danger" className="mt-5">{error}</Notice>}

      <div className="mt-7 flex flex-col gap-5">
        <Field label="Business name" htmlFor="r-biz" error={errors.businessName}>
          <Input id="r-biz" autoFocus autoComplete="organization" value={v.businessName} onChange={(e) => set('businessName', e.target.value)} invalid={!!errors.businessName} className="h-12" />
        </Field>
        <Field
          label="Workspace URL"
          htmlFor="r-slug"
          error={errors.slug ?? (slug.state === 'invalid' ? slug.msg : undefined)}
          hint={
            slug.state === 'free' ? <span className="inline-flex items-center gap-1 font-medium text-success"><Check className="size-3.5" /> Available</span>
              : slug.state === 'taken' ? <span className="inline-flex items-center gap-1 font-medium text-danger"><X className="size-3.5" /> Taken. Try another.</span>
              : slug.state === 'checking' ? 'Checking…' : 'Lowercase letters, numbers and dashes.'
          }
        >
          <AffixInput
            id="r-slug"
            mono
            value={v.slug}
            suffix={`.${domain}`}
            invalid={!!errors.slug || slug.state === 'taken' || slug.state === 'invalid'}
            onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40)); }}
            className="h-12"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className={cx('grid gap-4', !signedIn && 'sm:grid-cols-2')}>
          {!signedIn && (
            <Field label="Your name" htmlFor="r-name" error={errors.ownerName}>
              <Input id="r-name" autoComplete="name" value={v.ownerName} onChange={(e) => set('ownerName', e.target.value)} invalid={!!errors.ownerName} className="h-12" />
            </Field>
          )}
          <Field label="Country" htmlFor="r-country">
            <Select id="r-country" value={v.country} onChange={(e) => set('country', e.target.value)} className="h-12">
              {SIGNUP_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        {!signedIn && (
          <>
            <Field label="Work email" htmlFor="r-email" error={errors.email}>
              <Input id="r-email" type="email" inputMode="email" autoComplete="email" placeholder="you@company.com" value={v.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} className="h-12" />
            </Field>
            <Field label="Password" htmlFor="r-pass" error={errors.password} hint={v.password ? PASSWORD_LABELS[score] : `At least ${PASSWORD_MIN} characters. Passkeys can be added later.`}>
              <div>
                <Input id="r-pass" type="password" autoComplete="new-password" value={v.password} onChange={(e) => set('password', e.target.value)} invalid={!!errors.password} className="h-12" />
                <PasswordMeter value={v.password} />
              </div>
            </Field>
          </>
        )}
        <div>
          <Checkbox checked={v.acceptTerms} onChange={(c) => set('acceptTerms', c)} invalid={!!errors.acceptTerms}>
            I agree to the <a href="/terms" className="font-medium text-accent-text underline">Terms</a> and <a href="/privacy" className="font-medium text-accent-text underline">Privacy Policy</a>.
          </Checkbox>
          {errors.acceptTerms && <p className="mt-1.5 text-xs font-medium text-danger" role="alert">{errors.acceptTerms}</p>}
        </div>
      </div>

      <Button type="submit" size="lg" className="mt-7 w-full" pending={pending} disabled={slug.state === 'taken'}>
        Create my workspace <ArrowRight className="size-4" />
      </Button>
      {!signedIn && (
        <p className="mt-5 text-center text-[15px] text-fg-2">
          Already registered? <Link href="/sign-in" className="font-semibold text-accent-text underline underline-offset-2">Sign in</Link>
        </p>
      )}
    </form>
  );
}
