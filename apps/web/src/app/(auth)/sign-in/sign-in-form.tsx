'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Mail } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { Button, cx, Field, Input, Notice } from '@/components/kit';
import { authClient } from '@/lib/auth-client';
import { landingAction } from '@/server/actions/auth';

type Step = 'email' | 'password' | 'link-sent' | 'reset-sent';

export function SignInForm({ next, email: initialEmail, linkError }: { next: string | null; email: string; linkError: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(linkError ? 'That sign-in link has expired or was already used. Ask for a new one.' : null);
  const [pending, start] = useTransition();
  const segment = step === 'email' ? 0 : step === 'password' ? 1 : 2;

  const toPassword = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Enter the email your workspace invited.');
      return;
    }
    setError(null);
    setStep('password');
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(null);
      const r = await authClient.signIn.email({ email: email.trim(), password });
      if (r.error) {
        setError(r.error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'That email and password do not match.');
        return;
      }
      router.push(await landingAction(next));
      router.refresh();
    });
  };

  const sendLink = () =>
    start(async () => {
      setError(null);
      const callbackURL = next && next.startsWith('/') ? next : '/';
      const r = await authClient.signIn.magicLink({ email: email.trim(), callbackURL, errorCallbackURL: '/sign-in?error=link' });
      // Never reveal whether an account exists.
      if (r.error && r.error.status === 429) { setError('Too many requests. Wait a minute and try again.'); return; }
      setStep('link-sent');
    });

  const sendReset = () =>
    start(async () => {
      setError(null);
      await authClient.requestPasswordReset({ email: email.trim(), redirectTo: '/reset-password' });
      setStep('reset-sent');
    });

  return (
    <div className="anim-rise">
      <div className="mb-10 grid grid-cols-3 gap-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx('h-1 rounded-full transition-colors duration-500', i <= segment ? 'bg-accent' : 'bg-subtle')} />
        ))}
      </div>

      {step === 'email' && (
        <form onSubmit={toPassword} noValidate>
          <h1 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-fg sm:text-[40px]">Sign in</h1>
          <p className="mt-2 text-base text-fg-2">Use the email your workspace invited.</p>
          {error && <Notice kind="danger" className="mt-5">{error}</Notice>}
          <Field label="Work email" htmlFor="si-email" className="mt-7">
            <Input id="si-email" type="email" autoComplete="username" autoFocus inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 text-base" />
          </Field>
          <Button type="submit" size="lg" className="mt-5 w-full">
            Continue <ArrowRight className="size-4" />
          </Button>
          <p className="mt-8 text-[15px] text-fg">
            New rental business? <Link href="/register" className="font-semibold text-accent-text underline underline-offset-2">Register your workspace</Link>
          </p>
          <p className="mt-4 text-sm text-fg-2">Invited by a teammate? Open the link in your invite email to set up your account.</p>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={signIn}>
          <button type="button" onClick={() => setStep('email')} className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-fg-2 hover:text-fg">
            <ArrowLeft className="size-4" /> {email}
          </button>
          <h1 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-fg sm:text-[40px]">Welcome back</h1>
          <p className="mt-2 text-base text-fg-2">Enter your password, or get a one-time sign-in link.</p>
          {error && <Notice kind="danger" className="mt-5">{error}</Notice>}
          <input type="email" autoComplete="username" value={email} readOnly hidden />
          <Field
            label="Password"
            htmlFor="si-pass"
            className="mt-7"
            labelAction={<button type="button" onClick={sendReset} className="text-[13px] font-semibold text-accent-text hover:underline">Forgot password?</button>}
          >
            <Input id="si-pass" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 text-base" />
          </Field>
          <Button type="submit" size="lg" className="mt-5 w-full" pending={pending} disabled={!password}>
            Sign in <ArrowRight className="size-4" />
          </Button>
          <div className="my-6 flex items-center gap-3 text-sm text-fg-2"><span className="h-px flex-1 bg-subtle" />or<span className="h-px flex-1 bg-subtle" /></div>
          <Button variant="secondary" size="lg" className="w-full" icon={<Mail className="size-4" />} onClick={sendLink} disabled={pending}>
            Email me a sign-in link
          </Button>
        </form>
      )}

      {(step === 'link-sent' || step === 'reset-sent') && (
        <div>
          <div className="anim-pop mb-6 grid size-14 place-items-center rounded-2xl bg-success-bg text-success"><Mail className="size-6" /></div>
          <h1 className="font-display text-[32px] font-extrabold leading-tight tracking-[-0.02em] text-fg">Check your email</h1>
          <p className="mt-3 text-base text-fg-2">
            If <strong className="text-fg">{email}</strong> has an account, {step === 'link-sent' ? 'a sign-in link is on its way. It works once and expires in 15 minutes.' : 'a link to choose a new password is on its way.'}
          </p>
          <Button variant="secondary" className="mt-8" onClick={() => setStep('password')}>Back to sign in</Button>
        </div>
      )}

      <p className="mt-10 text-[13px] text-fg-2">Protected by encrypted sessions and one-time links.</p>
    </div>
  );
}
