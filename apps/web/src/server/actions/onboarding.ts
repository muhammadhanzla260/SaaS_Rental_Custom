'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  brandStepSchema, connectStepSchema, ONBOARDING_INVITE_ROLES, ONBOARDING_STEPS, profileStepSchema, warehouseStepSchema,
  type OnboardingStepKey, type Role,
} from '@rental/core';
import {
  createInvitations, launchWorkspace, markOnboarding, saveBrandStep, saveConnectStep, saveLogo, saveProfileStep, saveWarehouseStep,
} from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { requirePermission } from '../context';
import { db } from '../db';
import { sendInviteEmail } from '../invite-mail';
import { readUpload, run } from './run';

const done = (slug: string) => revalidatePath(`/onboarding/${slug}`);

export async function saveProfileStepAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'settings.manage');
    const parsed = profileStepSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveProfileStep(db, ctx.tenant.id, ctx.actor, parsed.data);
    done(slug);
    return { ok: true };
  });
}

/** Brand step: JSON payload + optional logo file (FormData). `removeLogo` clears it. */
export async function saveBrandStepAction(slug: string, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'settings.manage');
    let payload: unknown;
    try { payload = JSON.parse(String(formData.get('payload') ?? '{}')); } catch { return { ok: false, error: 'The form could not be read. Reload and try again.' }; }
    const parsed = brandStepSchema.safeParse(payload);
    if (!parsed.success) return invalid(parsed.error);
    const file = await readUpload(formData.get('logo'));
    const logos: { logoFileId?: string | null } = {};
    if (file) logos.logoFileId = await saveLogo(db, ctx.tenant.id, ctx.user.id, file);
    else if (formData.get('removeLogo') === '1') logos.logoFileId = null;
    await saveBrandStep(db, ctx.tenant.id, ctx.actor, parsed.data, logos);
    revalidatePath(`/${slug}`, 'layout');
    done(slug);
    return { ok: true };
  });
}

export async function saveWarehouseStepAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'settings.manage');
    const parsed = warehouseStepSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveWarehouseStep(db, ctx.tenant.id, ctx.actor, parsed.data);
    done(slug);
    return { ok: true };
  });
}

export async function saveConnectStepAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'settings.manage');
    const parsed = connectStepSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveConnectStep(db, ctx.tenant.id, ctx.actor, parsed.data);
    await markOnboarding(db, ctx.tenant.id, 'connect', 'done', 4);
    done(slug);
    return { ok: true };
  });
}

const inviteRows = z
  .array(z.object({ email: z.email('Enter a valid email.'), role: z.enum(ONBOARDING_INVITE_ROLES as [Role, ...Role[]]) }))
  .max(25);

export async function saveTeamStepAction(slug: string, input: unknown): Promise<ActionResult<{ links: { email: string; url: string; delivered: boolean }[] }>> {
  return run<{ links: { email: string; url: string; delivered: boolean }[] }>(async () => {
    const ctx = await requirePermission(slug, 'members.manage');
    const rows = (Array.isArray(input) ? input : [])
      .map((r) => ({ email: String((r as { email?: string })?.email ?? '').trim(), role: (r as { role?: string })?.role }))
      .filter((r) => r.email);
    const parsed = inviteRows.safeParse(rows);
    if (!parsed.success) return invalid(parsed.error);
    const seen = new Set<string>();
    const unique = parsed.data.filter((r) => {
      const k = r.email.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const created = await createInvitations(db, ctx.tenant.id, ctx.actor, unique as { email: string; role: Exclude<Role, 'owner'> }[]);
    const links = [];
    for (const c of created) {
      const r = await sendInviteEmail({ email: c.invitation.email, role: c.invitation.role as Role, token: c.token, orgName: ctx.tenant.name, inviter: ctx.user.name });
      links.push({ email: c.invitation.email, url: r.url, delivered: r.delivered });
    }
    await markOnboarding(db, ctx.tenant.id, 'team', 'done', 5);
    done(slug);
    return { ok: true, data: { links } };
  });
}

export async function skipStepAction(slug: string, step: OnboardingStepKey): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'settings.manage');
    if (step !== 'connect' && step !== 'team') return { ok: false, error: 'This step cannot be skipped.' };
    const idx = ONBOARDING_STEPS.findIndex((s) => s.key === step);
    await markOnboarding(db, ctx.tenant.id, step, 'skipped', idx + 1);
    done(slug);
    return { ok: true };
  });
}

export async function launchAction(slug: string, plan: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'settings.manage');
    const p = z.enum(['starter', 'growth', 'scale']).safeParse(plan);
    if (!p.success) return { ok: false, error: 'Pick a plan.' };
    await launchWorkspace(db, ctx.tenant.id, ctx.actor, p.data);
    revalidatePath(`/${slug}`, 'layout');
    done(slug);
    return { ok: true };
  });
}
