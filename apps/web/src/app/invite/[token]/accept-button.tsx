'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useState, useTransition, type FormEvent } from 'react';
import { PASSWORD_LABELS, PASSWORD_MIN, passwordScore } from '@rental/core';
import { Button, Field, Input, Notice } from '@/components/kit';
import { PasswordMeter } from '@/components/auth/password-meter';
import { acceptInviteAction, createAccountAndAcceptAction } from '@/server/actions/invite';

export function AcceptInvite({ token, mode, email, defaultName = '' }: { token: string; mode: 'accept' | 'create'; email: string; defaultName?: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    start(async () => {
      setError(null);
      const r = mode === 'accept' ? await acceptInviteAction(token) : await createAccountAndAcceptAction(token, { name, password });
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); setError(r.error); return; }
      router.push(r.data!.href);
      router.refresh();
    });
  };

  if (mode === 'accept') {
    return (
      <div className="mt-6 flex flex-col gap-3">
        {error && <Notice kind="danger">{error}</Notice>}
        <Button size="lg" pending={pending} onClick={() => submit()}>Accept invitation <ArrowRight className="size-4" /></Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5" noValidate>
      {error && <Notice kind="danger">{error}</Notice>}
      <Field label="Email" htmlFor="inv-email" hint="Your login uses the invited email.">
        <Input id="inv-email" value={email} readOnly disabled autoComplete="username" />
      </Field>
      <Field label="Your name" htmlFor="inv-name" error={errors.name}>
        <Input id="inv-name" autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!errors.name} className="h-12" />
      </Field>
      <Field label="Choose a password" htmlFor="inv-pass" error={errors.password} hint={password ? PASSWORD_LABELS[passwordScore(password)] : `At least ${PASSWORD_MIN} characters.`}>
        <div>
          <Input id="inv-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!errors.password} className="h-12" />
          <PasswordMeter value={password} />
        </div>
      </Field>
      <Button type="submit" size="lg" pending={pending}>Join and continue <ArrowRight className="size-4" /></Button>
    </form>
  );
}
