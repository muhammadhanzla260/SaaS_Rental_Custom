'use server';

import { onboardingSchema, slugSchema } from '@rental/core';
import { createOrganization, isSlugAvailable, LOGO_MAX_BYTES, LOGO_MIME } from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { clientIp, requireUser } from '../context';
import { db } from '../db';
import { readUpload, run } from './run';

export async function checkSlugAction(slug: string): Promise<ActionResult<{ available: boolean }>> {
  await requireUser();
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  return { ok: true, data: { available: await isSlugAvailable(db, parsed.data) } };
}

/** Returns the new organization's slug; the wizard celebrates, then navigates. */
export async function createOrganizationAction(formData: FormData): Promise<ActionResult<{ slug: string }>> {
  const user = await requireUser('/onboarding');
  return run<{ slug: string }>(async () => {
    let payload: unknown;
    try {
      payload = JSON.parse(String(formData.get('payload') ?? ''));
    } catch {
      return { ok: false, error: 'The form could not be read. Reload the page and try again.' };
    }
    const parsed = onboardingSchema.safeParse(payload);
    if (!parsed.success) return invalid(parsed.error);

    const logo = await readUpload(formData.get('logo'));
    if (logo && !(LOGO_MIME as readonly string[]).includes(logo.mime)) return { ok: false, error: 'Upload the logo as PNG, JPG, WebP or SVG.' };
    if (logo && logo.bytes.length > LOGO_MAX_BYTES) return { ok: false, error: 'The logo must be 1 MB or smaller.' };

    const tenant = await createOrganization(db, { userId: user.id, ip: await clientIp() }, parsed.data, logo);
    return { ok: true, data: { slug: tenant.slug } };
  });
}
