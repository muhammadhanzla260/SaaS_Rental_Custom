'use client';

import { KeyRound, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PASSWORD_MIN } from '@rental/core';
import { PasswordMeter } from '@/components/auth/password-meter';
import { Button, Card, Input, useToast } from '@/components/kit';
import { authClient } from '@/lib/auth-client';

export function AccountActions() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < PASSWORD_MIN) return toast(`Use at least ${PASSWORD_MIN} characters.`, 'error');
    setBusy(true);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return toast(error.message ?? 'That did not work. Check your current password.', 'error');
    setOpen(false);
    setCurrent('');
    setNext('');
    toast('Password changed. Other devices were signed out.');
  }

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        {open ? (
          <form onSubmit={change} className="flex flex-col gap-3">
            <label className="text-[13px] font-semibold text-fg">Current password
              <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="mt-1" required />
            </label>
            <label className="text-[13px] font-semibold text-fg">New password
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="mt-1" required />
            </label>
            <PasswordMeter value={next} />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" pending={busy}>Change password</Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" className="w-full" icon={<KeyRound className="size-4" />} onClick={() => setOpen(true)}>Change password</Button>
        )}
      </Card>
      <Button
        variant="danger-ghost"
        className="w-full"
        icon={<LogOut className="size-4" />}
        onClick={async () => { await authClient.signOut(); router.replace('/sign-in'); }}
      >
        Sign out
      </Button>
    </div>
  );
}
