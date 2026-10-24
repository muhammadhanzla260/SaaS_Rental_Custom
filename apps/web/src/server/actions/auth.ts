'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { registerSchema, slugSchema, SIGNUP_COUNTRIES } from '@rental/core';
import { createWorkspace, isSlugAvailable, OrgError } from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { auth } from '../auth';
import { clientIp, getSession } from '../context';
import { db } from '../db';
import { landingFor } from '../landing';
import { run } from './run';

/** 01 · Register: creates the login (if new), the workspace (trial, Growth) and its owner, then onboarding. */
export async function registerAction(input: unknown): Promise<ActionResult<{ href: string }>> {
  return run<{ href: string }>(async () => {
    const session = await getSession();
    const ip = await clientIp();

    // Signed in already ("Create another workspace"): only the business fields are needed.
    if (session) {
      const parsed = z
        .object({
          businessName: registerSchema.shape.businessName,
          slug: slugSchema,
          country: z.enum(SIGNUP_COUNTRIES.map((c) => c.code) as [string, ...string[]]),
          acceptTerms: registerSchema.shape.acceptTerms,
          deviceTimezone: z.string().optional(),
        })
        .safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      const v = parsed.data;
      if (!(await isSlugAvailable(db, v.slug))) return { ok: false, error: 'That workspace URL is taken.', fieldErrors: { slug: 'That workspace URL is taken.' } };
      const t = await createWorkspace(db, { userId: session.user.id, ip }, { name: v.businessName, slug: v.slug, country: v.country, deviceTimezone: v.deviceTimezone });
      return { ok: true, data: { href: `/onboarding/${t.slug}` } };
    }

    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const v = parsed.data;
    if (!(await isSlugAvailable(db, v.slug))) return { ok: false, error: 'That workspace URL is taken.', fieldErrors: { slug: 'That workspace URL is taken.' } };

    let userId: string;
    try {
      const res = await auth.api.signUpEmail({ body: { name: v.ownerName, email: v.email, password: v.password }, headers: await headers() });
      userId = res.user.id;
    } catch (e) {
      const msg = String((e as { body?: { message?: string } }).body?.message ?? (e as Error).message ?? '');
      if (/exist/i.test(msg)) {
        return { ok: false, error: 'This email already has an account. Sign in, then create the workspace from your organizations.', fieldErrors: { email: 'Already registered. Sign in instead.' } };
      }
      if (/password/i.test(msg)) return { ok: false, error: msg, fieldErrors: { password: msg } };
      throw e;
    }
    try {
      const t = await createWorkspace(db, { userId, ip }, { name: v.businessName, slug: v.slug, country: v.country, deviceTimezone: v.deviceTimezone });
      return { ok: true, data: { href: `/onboarding/${t.slug}` } };
    } catch (e) {
      // The login exists; the person can pick another URL from the signed-in form.
      if (e instanceof OrgError) return { ok: false, error: `${e.message} Your login is ready; pick another URL.`, fieldErrors: { slug: e.message } };
      throw e;
    }
  });
}

/** After a password or link sign-in on the client: where to go next. */
export async function landingAction(next?: string | null): Promise<string> {
  const session = await getSession();
  if (!session) return '/sign-in';
  return landingFor(session.user.id, next);
}
