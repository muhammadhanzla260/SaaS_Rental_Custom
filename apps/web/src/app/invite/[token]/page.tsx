import Link from 'next/link';
import { ROLE_LABELS } from '@rental/core';
import { findInvitation } from '@rental/db';
import { Notice } from '@/components/ui';
import { getSession } from '@/server/context';
import { db } from '@/server/db';
import { AcceptButton } from './accept-button';

export const metadata = { title: 'Join an organization' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [session, inv] = await Promise.all([getSession(), findInvitation(db, token)]);
  const back = `/invite/${token}`;
  const invalid = !inv || inv.revokedAt ? 'This invitation link is not valid. Ask for a new one.'
    : inv.acceptedAt ? 'This invitation has already been used.'
    : inv.expiresAt < new Date() ? 'This invitation has expired. Ask for a new one.' : null;

  return (
    <main className="flex min-h-dvh flex-col items-center px-[max(1rem,env(safe-area-inset-left))] py-10">
      <span className="font-display text-lg font-bold">Rental Custom</span>
      <div className="mt-8 w-full max-w-md rounded-ui border border-line bg-surface p-6 sm:p-8">
        {invalid || !inv ? (
          <Notice kind="error">{invalid}</Notice>
        ) : (
          <div className="flex flex-col gap-4">
            <h1 className="text-2xl font-semibold">Join {inv.tenantName}</h1>
            <p className="text-muted">
              You have been invited as <strong className="text-ink">{ROLE_LABELS[inv.role].label}</strong>. {ROLE_LABELS[inv.role].description}
            </p>
            {!session ? (
              <>
                <p className="text-[15px]">This invitation is for <strong>{inv.email}</strong>.</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/sign-up?next=${encodeURIComponent(back)}&email=${encodeURIComponent(inv.email)}`} className="inline-flex min-h-10 items-center rounded-ui-sm bg-brand px-4 font-medium text-brand-fg hover:bg-brand-strong">
                    Create account
                  </Link>
                  <Link href={`/sign-in?next=${encodeURIComponent(back)}&email=${encodeURIComponent(inv.email)}`} className="inline-flex min-h-10 items-center rounded-ui-sm border border-line-strong px-4 font-medium hover:bg-surface-2">
                    Sign in
                  </Link>
                </div>
              </>
            ) : session.user.email.toLowerCase() !== inv.email.toLowerCase() ? (
              <Notice kind="warn">
                You are signed in as {session.user.email}, but this invitation is for {inv.email}. Sign out and sign in with that email.
              </Notice>
            ) : (
              <AcceptButton token={token} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
