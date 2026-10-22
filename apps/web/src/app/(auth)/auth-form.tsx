'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Field, Input, Notice } from '@/components/ui';
import { authClient } from '@/lib/auth-client';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: '', email: params.get('email') ?? '', password: '' });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res =
        mode === 'sign-up'
          ? await authClient.signUp.email({ name: form.name, email: form.email, password: form.password })
          : await authClient.signIn.email({ email: form.email, password: form.password });
      if (res.error) {
        setError(
          res.error.code === 'INVALID_EMAIL_OR_PASSWORD'
            ? 'That email and password do not match.'
            : res.error.code === 'USER_ALREADY_EXISTS' || res.error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
              ? 'An account with this email already exists. Sign in instead.'
              : (res.error.message ?? 'Something went wrong. Try again.'),
        );
        return;
      }
      router.replace(next);
      router.refresh();
    });
  };

  const other = mode === 'sign-in' ? '/sign-up' : '/sign-in';
  const otherHref = params.get('next') ? `${other}?next=${encodeURIComponent(next)}` : other;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-2xl font-semibold">{mode === 'sign-in' ? 'Sign in' : 'Create your account'}</h1>
        <p className="mt-1 text-muted">
          {mode === 'sign-in' ? 'Welcome back.' : 'Next you will set up your business. It takes about five minutes.'}
        </p>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {mode === 'sign-up' && (
        <Field label="Your name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" inputMode="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label="Password" htmlFor="password" hint={mode === 'sign-up' ? 'At least 10 characters.' : undefined}>
        <Input
          id="password"
          type="password"
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          required
          minLength={mode === 'sign-up' ? 10 : undefined}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
      </Field>
      <Button type="submit" pending={pending} className="mt-2 w-full">
        {mode === 'sign-in' ? 'Sign in' : 'Create account'}
      </Button>
      <p className="text-center text-sm text-muted">
        {mode === 'sign-in' ? 'New here? ' : 'Already have an account? '}
        <Link href={otherHref} className="font-medium text-brand-text underline">
          {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </form>
  );
}
