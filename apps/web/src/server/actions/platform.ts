'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CURRENCIES, isValidTimezone, SIGNUP_COUNTRIES, slugSchema } from '@rental/core';
import {
  endImpersonation, getTenantBySlug, isSlugAvailable, platformCloseOrg, platformCreateOrg, platformRestoreOrg,
  platformSetStatus, platformUpdateOrg, startImpersonation,
} from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { getSession, requirePlatformAdmin } from '../context';
import { db } from '../db';
import { appUrl, platformEmail, sendPlatformEmailOrLink } from '../mailer';
import { run } from './run';

const orgFields = {
  name: z.string().trim().min(2, 'Enter the business name.').max(120),
  slug: slugSchema,
  timezone: z.string().refine(isValidTimezone, 'Pick a time zone.'),
  currency: z.enum(CURRENCIES.map((c) => c.code) as [string, ...string[]]),
  plan: z.enum(['starter', 'growth', 'scale']),
};

const createSchema = z.object({
  ...orgFields,
  country: z.enum(SIGNUP_COUNTRIES.map((c) => c.code) as [string, ...string[]]),
  status: z.enum(['trial', 'active', 'past_due']),
  ownerName: z.string().trim().min(2, 'Enter the owner’s name.').max(120),
  ownerEmail: z.email('Enter the owner’s email.'),
  sendInvite: z.boolean().default(true),
});

const updateSchema = z.object({ ...orgFields, status: z.enum(['trial', 'active', 'past_due', 'suspended']) });

/** Live "Available" check for workspace URLs (register, console). Slugs are public, so no sign-in needed. */
export async function checkSlugAction(slug: string): Promise<ActionResult<{ available: boolean }>> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  return { ok: true, data: { available: await isSlugAvailable(db, parsed.data) } };
}

export async function createOrgAction(input: unknown): Promise<ActionResult<{ slug: string; inviteUrl: string; emailed: boolean }>> {
  const admin = await requirePlatformAdmin();
  return run<{ slug: string; inviteUrl: string; emailed: boolean }>(async () => {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const v = parsed.data;
    const { tenant, ownerToken } = await platformCreateOrg(db, admin.user.id, v, admin.ip);
    const inviteUrl = appUrl(`/invite/${ownerToken}`);
    let emailed = false;
    if (v.sendInvite) {
      const mail = platformEmail({
        title: `Your workspace for ${v.name} is ready`,
        lines: [`Hi ${v.ownerName.split(' ')[0]}, a Tentpole workspace has been created for ${v.name}.`, 'Set your password and you will land in a short setup.'],
        cta: { label: 'Set up my workspace', url: inviteUrl },
      });
      emailed = (await sendPlatformEmailOrLink({ to: v.ownerEmail, subject: `Your ${v.name} workspace on Tentpole`, ...mail })).delivered;
    }
    revalidatePath('/console');
    return { ok: true, data: { slug: tenant.slug, inviteUrl, emailed }, message: `${v.name} created.` };
  });
}

export async function updateOrgAction(tenantId: string, input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  return run(async () => {
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await platformUpdateOrg(db, admin.user.id, tenantId, parsed.data, admin.ip);
    revalidatePath('/console');
    return { ok: true, message: 'Organization saved.' };
  });
}

export async function setOrgStatusAction(tenantId: string, status: 'suspended' | 'active' | 'trial'): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  return run(async () => {
    const t = await platformSetStatus(db, admin.user.id, tenantId, status, admin.ip);
    revalidatePath('/console');
    return { ok: true, message: status === 'suspended' ? `${t.name} suspended. Its team now sees a read-only banner.` : `${t.name} reactivated.` };
  });
}

export async function closeOrgAction(tenantId: string, typedSlug: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  return run(async () => {
    const t = await platformCloseOrg(db, admin.user.id, tenantId, typedSlug, admin.ip);
    revalidatePath('/console');
    return { ok: true, message: `${t.name} closed. It is deleted for good on ${t.purgeAfter!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.` };
  });
}

export async function restoreOrgAction(tenantId: string): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  return run(async () => {
    const t = await platformRestoreOrg(db, admin.user.id, tenantId, admin.ip);
    revalidatePath('/console');
    return { ok: true, message: `${t.name} restored.` };
  });
}

/** Open an organization as a read-only viewer (support). Returns where to go. */
export async function startSupportSessionAction(tenantSlug: string, reason: string): Promise<ActionResult<{ href: string }>> {
  const admin = await requirePlatformAdmin();
  return run<{ href: string }>(async () => {
    const tenant = await getTenantBySlug(db, tenantSlug);
    if (!tenant || tenant.status === 'closed') return { ok: false, error: 'Organization not found.' };
    await startImpersonation(db, admin.user.id, tenant.id, admin.sessionToken, reason);
    return { ok: true, data: { href: `/${tenant.slug}` } };
  });
}

export async function endSupportSessionAction(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: true };
  return run(async () => {
    await endImpersonation(db, session.user.id, session.session.token);
    return { ok: true };
  });
}
