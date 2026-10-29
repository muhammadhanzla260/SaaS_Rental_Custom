'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { PASSWORD_LABELS, PASSWORD_MIN, passwordScore } from '@rental/core';
import { Button, Field, Input, Notice } from '@/components/kit';
import { authClient } from '@/lib/auth-client';
import { PasswordMeter } from '@/components/auth/password-meter';

export function ResetForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (invalid) {
    return (
      <div className="anim-rise">
        <h1 className="font-display text-[34px] font-extrabold tracking-[-0.02em] text-fg">This link has expired</h1>
        <p className="mt-2 text-fg-2">Reset links work once and expire after an hour.</p>
        <Link href="/sign-in" className="mt-6 inline-block font-semibold text-accent-text underline">Ask for a new one</Link>
      </div>
    );
  }
  return (
    <form
      className="anim-rise"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await authClient.resetPassword({ newPassword: pw, token: token! });
          if (r.error) { setError(r.error.message ?? 'That link has expired. Ask for a new one.'); return; }
          setDone(true);
          setTimeout(() => router.push('/sign-in'), 1200);
        });
      }}
    >
      <h1 className="font-display text-[34px] font-extrabold tracking-[-0.02em] text-fg">Choose a new password</h1>
      {done ? <Notice kind="success" className="mt-6">Password changed. Taking you to sign in…</Notice> : (
        <>
          {error && <Notice kind="danger" className="mt-5">{error}</Notice>}
          <Field label="New password" htmlFor="rp-pass" className="mt-7" hint={pw ? PASSWORD_LABELS[passwordScore(pw)] : `At least ${PASSWORD_MIN} characters.`}>
            <Input id="rp-pass" type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} className="h-12" />
          </Field>
          <PasswordMeter value={pw} />
          <Button type="submit" size="lg" className="mt-6 w-full" pending={pending} disabled={pw.length < PASSWORD_MIN}>Save password</Button>
        </>
      )}
    </form>
  );
}
