'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  agreementSchema, bookingDefaultsSchema, brandStepSchema, documentNumberingSchema, GRANTABLE, INVITABLE_ROLES, locationSchema,
  mailAccountSchema, paymentAccountSchema, profileStepSchema, renderPrefix, ROLES, type DocumentKind, type Role,
} from '@rental/core';
import {
  createInvitation, createLocation, deleteLocation, getNextNumbers, removeLocationMailAccount, removeLocationPaymentAccount, resendInvitation, revokeInvitation,
  saveLogo, saveMailAccount, savePaymentAccount, saveProfileStep, setNextNumber, setSetupItem, updateBrand, updateLocation,
  updateMember, updatePreferences,
} from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { getTenantContext, requirePermission, requireSettingsAccess } from '../context';
import { db } from '../db';
import { sendInviteEmail } from '../invite-mail';
import { checkStripeKeys } from '../stripe-check';
import { quoteTravelFee } from '../travel';
import { readUpload, run } from './run';

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

// --- workspace & brand ---------------------------------------------------------------

export async function saveBrandAction(slug: string, formData: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    let payload: unknown;
    try { payload = JSON.parse(String(formData.get('payload') ?? '{}')); } catch { return { ok: false, error: 'The form could not be read. Reload and try again.' }; }
    const parsed = brandStepSchema.safeParse(payload);
    if (!parsed.success) return invalid(parsed.error);
    const upload = await readUpload(formData.get('logo'));
    const logos: { logoFileId?: string | null } = {};
    if (upload) logos.logoFileId = await saveLogo(db, ctx.tenant.id, ctx.user.id, upload);
    else if (formData.get('removeLogo') === '1') logos.logoFileId = null;
    await updateBrand(db, ctx.tenant.id, ctx.actor, parsed.data, logos);
    refresh(slug);
    return { ok: true, message: 'Customers see the new look on their next email or page load.' };
  });
}

export async function saveBusinessProfileAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = profileStepSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await saveProfileStep(db, ctx.tenant.id, ctx.actor, parsed.data);
    refresh(slug);
    return { ok: true, message: 'Business profile saved.' };
  });
}

export async function saveRentalRulesAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = bookingDefaultsSchema.safeParse({ ...ctx.prefs.booking, ...(input as object) });
    if (!parsed.success) return invalid(parsed.error);
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'booking', parsed.data);
    refresh(slug);
    return { ok: true, message: 'Rental rules saved. New quotes use them right away.' };
  });
}

export async function saveAgreementAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = agreementSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const keys = parsed.data.policies.map((p) => p.key);
    if (new Set(keys).size !== keys.length) return { ok: false, error: 'Two policies share the same key. Remove one and try again.' };
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'agreement', parsed.data);
    refresh(slug);
    return { ok: true, message: 'Agreement saved. New signatures use this wording; signed copies keep theirs.' };
  });
}

/** Card payments for the whole workspace (mail and texts live in Email & SMS). */
export async function savePaymentsAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = z.object({ payments: paymentAccountSchema }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stripe = await checkStripeKeys(parsed.data.payments);
    if (!stripe.ok) return stripe.result;
    await savePaymentAccount(db, ctx.tenant.id, ctx.actor, null, parsed.data.payments);
    refresh(slug);
    return { ok: true, message: stripe.account ? `Saved. Stripe is connected to ${stripe.account}.` : 'Payment settings saved.' };
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

const numberingForm = z.object({
  numbering: documentNumberingSchema,
  /** Next numbers for this location's rendered prefixes. */
  next: z.object({ quote: z.coerce.number().int(), invoice: z.coerce.number().int(), receipt: z.coerce.number().int() }).partial().optional(),
  locationCode: z.string().min(2).max(8),
});

export async function saveNumberingAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = numberingForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const { numbering, next, locationCode } = parsed.data;
    await updatePreferences(db, ctx.tenant.id, ctx.actor, 'numbering', numbering);
    for (const kind of ['quote', 'invoice', 'receipt'] as DocumentKind[]) {
      const n = next?.[kind];
      if (n == null) continue;
      const prefix = renderPrefix(numbering[`${kind}Prefix`], { loc: locationCode });
      const current = (await getNextNumbers(db, ctx.tenant.id, numbering, locationCode))[kind].next;
      if (n !== current) await setNextNumber(db, ctx.tenant.id, ctx.actor, kind, prefix, numbering[`${kind}Padding`], n);
    }
    refresh(slug);
    return { ok: true, message: 'Document numbers saved.' };
  });
}

const locMail = z.object({ own: z.boolean(), mail: mailAccountSchema.optional() });

export async function saveLocationMailAction(slug: string, locationId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = locMail.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (parsed.data.own && parsed.data.mail) await saveMailAccount(db, ctx.tenant.id, ctx.actor, locationId, { ...parsed.data.mail, mode: 'smtp' });
    if (!parsed.data.own) await removeLocationMailAccount(db, ctx.tenant.id, ctx.actor, locationId);
    refresh(slug);
    return { ok: true, message: parsed.data.own ? 'This location now sends from its own mail server.' : 'This location uses the organization mail server.' };
  });
}

const locPay = z.object({ own: z.boolean(), payments: paymentAccountSchema.optional() });

export async function saveLocationPaymentsAction(slug: string, locationId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    const parsed = locPay.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const stripe = await checkStripeKeys(parsed.data.own ? parsed.data.payments : undefined);
    if (!stripe.ok) return stripe.result;
    if (parsed.data.own && parsed.data.payments) await savePaymentAccount(db, ctx.tenant.id, ctx.actor, locationId, parsed.data.payments);
    if (!parsed.data.own) await removeLocationPaymentAccount(db, ctx.tenant.id, ctx.actor, locationId);
    refresh(slug);
    return { ok: true, message: stripe.account ? `Saved. This location's Stripe is ${stripe.account}.` : 'Payment gateway saved for this location.' };
  });
}

// --- team -------------------------------------------------------------------------

const memberDetails = {
  locationIds: z.array(z.uuid()).max(200).optional(),
  commissionPct: z.coerce.number().min(0).max(100).nullable().optional(),
  vehicle: z.string().trim().max(80).nullable().optional(),
  permissions: z.array(z.enum(GRANTABLE as [string, ...string[]])).optional(),
};

const inviteForm = z.object({
  email: z.email('Enter a valid email address.'),
  name: z.string().trim().max(120).optional(),
  role: z.enum(INVITABLE_ROLES as [Role, ...Role[]]),
  ...memberDetails,
});

export async function inviteAction(slug: string, input: unknown): Promise<ActionResult<{ link: string; delivered: boolean }>> {
  return run<{ link: string; delivered: boolean }>(async () => {
    const ctx = await requirePermission(slug, 'members.manage');
    const parsed = inviteForm.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const d = parsed.data;
    const { token, invitation } = await createInvitation(db, ctx.tenant.id, ctx.actor, { ...d, role: d.role as Exclude<Role, 'owner'> });
    const mail = await sendInviteEmail({ email: invitation.email, name: invitation.name, role: d.role, token, orgName: ctx.tenant.name, inviter: ctx.user.name });
    refresh(slug);
    return { ok: true, data: { link: mail.url, delivered: mail.delivered }, message: mail.delivered ? `Invitation sent to ${invitation.email}.` : 'Invitation created. Copy the link to send it.' };
  });
}

export async function resendInviteAction(slug: string, id: string): Promise<ActionResult<{ link: string; delivered: boolean }>> {
  return run<{ link: string; delivered: boolean }>(async () => {
    const ctx = await requirePermission(slug, 'members.manage');
    const { token, invitation } = await resendInvitation(db, ctx.tenant.id, ctx.actor, id);
    const mail = await sendInviteEmail({ email: invitation.email, name: invitation.name, role: invitation.role as Role, token, orgName: ctx.tenant.name, inviter: ctx.user.name });
    refresh(slug);
    return { ok: true, data: { link: mail.url, delivered: mail.delivered }, message: mail.delivered ? 'Invitation sent again. The old link no longer works.' : 'New link created. The old one no longer works.' };
  });
}

export async function revokeInviteAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'members.manage');
    await revokeInvitation(db, ctx.tenant.id, ctx.actor, id);
    refresh(slug);
    return { ok: true, message: 'Invitation revoked.' };
  });
}

const memberChange = z.object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'disabled']).optional(), ...memberDetails });

export async function updateMemberAction(slug: string, membershipId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'members.manage');
    const parsed = memberChange.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await updateMember(db, ctx.tenant.id, ctx.actor, membershipId, parsed.data);
    refresh(slug);
    return { ok: true, message: 'Team member updated.' };
  });
}

// --- home checklist ---------------------------------------------------------------------

export async function setSetupItemAction(slug: string, item: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireSettingsAccess(slug);
    await setSetupItem(db, ctx.tenant.id, item.slice(0, 40), done);
    revalidatePath(`/${slug}`);
    return { ok: true };
  });
}

// --- travel fee check -----------------------------------------------------------------

const travelCheck = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  mode: z.enum(['staffed', 'dropoff', 'pickup']),
});

type TravelQuote = NonNullable<Awaited<ReturnType<typeof quoteTravelFee>>>;

export async function checkTravelFeeAction(slug: string, input: unknown): Promise<ActionResult<TravelQuote>> {
  return run<TravelQuote>(async () => {
    const ctx = await getTenantContext(slug);
    const parsed = travelCheck.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const result = await quoteTravelFee(ctx.tenant.id, ctx.prefs, parsed.data, [parsed.data.mode]);
    if (!result) return { ok: false, error: 'Pin at least one active location on the map first.' };
    return { ok: true, data: result };
  });
}
