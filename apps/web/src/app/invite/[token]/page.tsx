import Link from 'next/link';
import { ROLE_LABELS } from '@rental/core';
import { findInvitation, loginExists } from '@rental/db';
import { AuthSplit, HeroSub, HeroTitle } from '@/components/auth/split';
import { LinkButton, Notice, Pill } from '@/components/kit';
import { getSession } from '@/server/context';
import { db } from '@/server/db';
import { AcceptInvite } from './accept-button';

export const metadata = { title: 'Join a workspace' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [session, inv] = await Promise.all([getSession(), findInvitation(db, token)]);
  const back = `/invite/${token}`;
  const problem = !inv || inv.revokedAt ? 'This invitation link is not valid. Ask for a new one.'
    : inv.acceptedAt ? 'This invitation has already been used. Sign in instead.'
    : inv.expiresAt < new Date() ? 'This invitation has expired. Ask whoever invited you for a new one.'
    : inv.tenantStatus === 'closed' ? 'This workspace has been closed.' : null;
  const hasLogin = inv && !problem && !session ? await loginExists(db, inv.email) : false;
  const isOwner = inv?.role === 'owner';

  return (
    <AuthSplit
      hero={
        <>
          <HeroTitle>{inv && !problem ? `Join ${inv.tenantName}.` : 'Join your team.'}</HeroTitle>
          <HeroSub>{isOwner ? 'Your workspace is ready. Set a password, then a short setup makes it yours.' : 'One login for every workspace you belong to. Your role decides what you can do in each.'}</HeroSub>
        </>
      }
    >
      {problem || !inv ? (
        <div className="anim-rise">
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] text-fg">Invitation unavailable</h1>
          <Notice kind="warning" className="mt-5">{problem}</Notice>
          <LinkButton href="/sign-in" variant="secondary" className="mt-6">Go to sign in</LinkButton>
        </div>
      ) : (
        <div className="anim-rise">
          <Pill tone={isOwner ? 'strong' : 'info'}>{ROLE_LABELS[inv.role].label}</Pill>
          <h1 className="mt-4 font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em] text-fg">
            {isOwner ? `Set up ${inv.tenantName}` : `Join ${inv.tenantName}`}
          </h1>
          <p className="mt-2 text-fg-2">{ROLE_LABELS[inv.role].description}</p>
          {session && session.user.email.toLowerCase() !== inv.email.toLowerCase() ? (
            <Notice kind="warning" className="mt-6">
              You are signed in as {session.user.email}, but this invitation is for {inv.email}. Sign out, then open this link again.
            </Notice>
          ) : session ? (
            <AcceptInvite token={token} mode="accept" email={inv.email} />
          ) : hasLogin ? (
            <div className="mt-6 flex flex-col gap-3">
              <p className="text-[15px] text-fg"><strong>{inv.email}</strong> already has a login.</p>
              <LinkButton href={`/sign-in?next=${encodeURIComponent(back)}&email=${encodeURIComponent(inv.email)}`} size="lg">Sign in to accept</LinkButton>
            </div>
          ) : (
            <AcceptInvite token={token} mode="create" email={inv.email} defaultName={inv.name ?? ''} />
          )}
          <p className="mt-8 text-[13px] text-fg-2">Not you? <Link href="/sign-in" className="font-medium text-accent-text underline">Sign in with another email</Link></p>
        </div>
      )}
    </AuthSplit>
  );
}
