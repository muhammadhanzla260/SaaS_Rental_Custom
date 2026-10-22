'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  bookingDefaultsSchema, brandingSchema, businessProfileSchema, communicationSchema,
  documentNumberingSchema, locationSchema, regionalSchema, ROLES,
} from '@rental/core';
import {
  createInvitation, createLocation, deleteLocation, revokeInvitation, saveLogo,
  updateBranding, updateLocation, updateMember, updatePreferences, updateProfile, updateRegional,
} from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { requireSettingsAccess } from '../context';
import { db } from '../db';
import { quoteTravelFee } from '../travel';
import { readUpload, run } from './run';

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

const profileForm = z.object({ profile: businessProfileSchema, regional: regionalSchema });

/** Business details plus the detected (or overridden) country, time zone and currency. */
export async function saveProfileAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = profileForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateProfile(db, ctx.tenant.id, ctx.actor, parsed.data.profile);
    await updateRegional(db, ctx.tenant.id, ctx.actor, parsed.data.regional);
    refresh(slug);
    return { ok: true, message: 'Business profile saved.' };
  });
}

export async function saveBrandingAction(slug: string, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = brandingSchema.safeParse(JSON.parse(String(formData.get('payload') ?? '{}')));
    if (!parsed.success) return invalid(parsed.error);
    const logos: { logoFileId?: string | null; logoDarkFileId?: string | null } = {};
    for (const [field, key] of [['logo', 'logoFileId'], ['logoDark', 'logoDarkFileId']] as const) {
      if (formData.get(`${field}Remove`) === '1') logos[key] = null;
      const upload = await readUpload(formData.get(field));
      if (upload) logos[key] = await saveLogo(db, ctx.tenant.id, ctx.user.id, upload);
    }
    await updateBranding(db, ctx.tenant.id, ctx.actor, parsed.data, logos);
    refresh(slug);
    return { ok: true, message: 'Branding saved.' };
  });
}

export async function saveBookingAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = bookingDefaultsSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'booking', parsed.data);
    refresh(slug);
    return { ok: true, message: 'Booking defaults saved.' };
  });
}

const documentsForm = z.object({ numbering: documentNumberingSchema, communication: communicationSchema });

export async function saveDocumentsAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = documentsForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'numbering', parsed.data.numbering);
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'communication', parsed.data.communication);
    refresh(slug);
    return { ok: true, message: 'Emails and documents saved.' };
  });
}

// --- locations ------------------------------------------------------------------

const locationForm = z.object({ location: locationSchema, taxPercent: z.coerce.number().min(0).max(100) });

export async function saveLocationAction(slug: string, id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = locationForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { location, taxPercent } = parsed.data;
    const saved = id
      ? await updateLocation(db, ctx.tenant.id, ctx.actor, id, location, taxPercent)
      : await createLocation(db, ctx.tenant.id, ctx.actor, location, taxPercent);
    refresh(slug);
    return { ok: true, data: { id: saved.id }, message: id ? 'Location saved.' : 'Location added.' };
  });
}

export async function deleteLocationAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    await deleteLocation(db, ctx.tenant.id, ctx.actor, id);
    refresh(slug);
    return { ok: true, message: 'Location removed.' };
  });
}

// --- team -------------------------------------------------------------------------

const inviteForm = z.object({
  email: z.email('Enter a valid email address.'),
  role: z.enum(ROLES).exclude(['owner']),
});

export async function inviteAction(slug: string, input: unknown): Promise<ActionResult<{ link: string }>> {
  return run<{ link: string }>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = inviteForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { token } = await createInvitation(db, ctx.tenant.id, ctx.actor, parsed.data.email, parsed.data.role);
    const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
    refresh(slug);
    return { ok: true, data: { link: `${base}/invite/${token}` }, message: 'Invitation created.' };
  });
}

export async function revokeInviteAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    await revokeInvitation(db, ctx.tenant.id, ctx.actor, id);
    refresh(slug);
    return { ok: true, message: 'Invitation revoked.' };
  });
}

const memberChange = z.object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'disabled']).optional() });

export async function updateMemberAction(slug: string, membershipId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = memberChange.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (membershipId === ctx.membership.id && parsed.data.status === 'disabled') {
      return { ok: false, error: 'You cannot disable your own access.' };
    }
    await updateMember(db, ctx.tenant.id, ctx.actor, membershipId, parsed.data);
    refresh(slug);
    return { ok: true, message: 'Team member updated.' };
  });
}

// --- travel fee check -----------------------------------------------------------------

const travelCheck = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  mode: z.enum(['staffed', 'dropoff', 'pickup']),
});

/** Booking rules: "what would a delivery to this address cost?" using the live rules. */
type TravelQuote = NonNullable<Awaited<ReturnType<typeof quoteTravelFee>>>;

export async function checkTravelFeeAction(slug: string, input: unknown): Promise<ActionResult<TravelQuote>> {
  return run<TravelQuote>(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = travelCheck.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const result = await quoteTravelFee(ctx.tenant.id, ctx.prefs, parsed.data, [parsed.data.mode]);
    if (!result) return { ok: false, error: 'Pin at least one active location on the map first.' };
    return { ok: true, data: result };
  });
}
