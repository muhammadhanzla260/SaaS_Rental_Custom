'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { PASSWORD_MIN } from '@rental/core';
import { acceptInvitation, findInvitation, loginExists } from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { auth } from '../auth';
import { getSession } from '../context';
import { db } from '../db';
import { run } from './run';

/** Owners and admins of a workspace that is not set up yet go to onboarding; everyone else to Home. */
const landingAfterAccept = (inv: { tenantSlug: string; role: string }, onboarded: boolean) =>
  !onboarded && (inv.role === 'owner' || inv.role === 'admin') ? `/onboarding/${inv.tenantSlug}` : `/${inv.tenantSlug}`;

async function onboarded(slug: string) {
  const { getTenantBySlug } = await import('@rental/db');
  const t = await getTenantBySlug(db, slug);
  return !!t?.onboardedAt;
}

export async function acceptInviteAction(token: string): Promise<ActionResult<{ href: string }>> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Sign in first.' };
  return run<{ href: string }>(async () => {
    const inv = await acceptInvitation(db, token, { id: session.user.id, email: session.user.email });
    return { ok: true, data: { href: landingAfterAccept(inv, await onboarded(inv.tenantSlug)) } };
  });
}

const newAccount = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`).max(128),
});

/** A new teammate sets a name and password; the login uses the invited email, then the invitation is accepted. */
export async function createAccountAndAcceptAction(token: string, input: unknown): Promise<ActionResult<{ href: string }>> {
  return run<{ href: string }>(async () => {
    const parsed = newAccount.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const inv = await findInvitation(db, token);
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < new Date()) return { ok: false, error: 'This invitation link is no longer valid. Ask for a new one.' };
    if (await loginExists(db, inv.email)) return { ok: false, error: `${inv.email} already has a login. Sign in to accept.` };
    const res = await auth.api.signUpEmail({ body: { name: parsed.data.name, email: inv.email, password: parsed.data.password }, headers: await headers() });
    const accepted = await acceptInvitation(db, token, { id: res.user.id, email: inv.email });
    return { ok: true, data: { href: landingAfterAccept(accepted, await onboarded(accepted.tenantSlug)) } };
  });
}
