'use server';

import { after } from 'next/server';
import { z } from 'zod';
import { can, COACH_PHASE_KEYS, validLatLng } from '@rental/core';
import {
  activeTracking, addCoachPhoto, eventStart, markArrived, removeCoachPhoto, saveCoachPhase, setCoachNotes, setOrderStaff, setTracking, startEnRoute,
  trackPing, type Fix, type PingResult,
} from '@rental/db';
import { dispatchOrder } from '@rental/messaging';
import type { ActionResult } from '@/lib/result';
import { ActionError, assertWritable, clientIp, getTenantContext, requirePermission } from '../context';
import { db } from '../db';
import { drivingEtaMinutes } from '../travel';
import { readUpload, run } from './run';

/** The phone portal: coaches and crew of this workspace (support sessions and suspended orgs are read-only). */
async function requireCoach(slug: string) {
  const ctx = await getTenantContext(slug);
  assertWritable(ctx);
  if (!can(ctx.role, 'coach.portal', ctx.membership?.permissions ?? [])) throw new ActionError('The coach portal is for coaches and crew.');
  return { ...ctx, actor: { type: 'user' as const, userId: ctx.user.id, ip: await clientIp() } };
}

const uuid = z.string().uuid();
const fixSchema = z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().nullish() }).nullish();

function toFix(raw: unknown): Fix | null {
  const p = fixSchema.safeParse(raw);
  if (!p.success || !p.data) return null;
  const at = validLatLng(p.data.lat, p.data.lng);
  return at ? { ...at, accuracyM: p.data.accuracy == null ? null : Math.round(p.data.accuracy) } : null;
}

/** Texts queued by the step go out straight after the response. */
function sendQueued(tenantId: string, orderId: string) {
  after(() => dispatchOrder(db, tenantId, orderId).catch((e) => console.error('[dispatch]', e)));
}

const phaseInput = z.object({
  phase: z.enum(COACH_PHASE_KEYS),
  ticked: z.array(z.string().max(60)).max(20),
  overrideReason: z.string().max(2000).nullish(),
  sopNotes: z.string().max(2000).nullish(),
  damage: z.boolean().optional(),
  damageNotes: z.string().max(2000).nullish(),
});

export async function savePhaseAction(slug: string, orderId: string, raw: unknown): Promise<ActionResult<{ percent: number; locked: boolean; completed: boolean }>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    const p = phaseInput.safeParse(raw);
    if (!uuid.safeParse(orderId).success || !p.success) return { ok: false, error: 'That save did not look right. Reload and try again.' };
    const r = await saveCoachPhase(db, ctx.tenant.id, ctx.actor, orderId, p.data);
    if (r.damageAlert) sendQueued(ctx.tenant.id, orderId);
    return { ok: true, data: { percent: r.percent, locked: r.locked, completed: r.completed }, message: r.locked ? 'Saved · locked at 100%' : `Saved · ${Math.round(r.percent)}% complete` };
  });
}

const PHOTO_KINDS = ['load', 'setup', 'closeout', 'damage'] as const;

export async function uploadPhotoAction(slug: string, orderId: string, form: FormData): Promise<ActionResult<{ id: string; fileId: string }>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    const kind = z.enum(PHOTO_KINDS).safeParse(form.get('kind'));
    const file = await readUpload(form.get('file'));
    if (!uuid.safeParse(orderId).success || !kind.success || !file) return { ok: false, error: 'Choose a photo first.' };
    const takenRaw = Number(form.get('takenAt'));
    const photo = await addCoachPhoto(db, ctx.tenant.id, ctx.actor, orderId, kind.data, file, Number.isFinite(takenRaw) && takenRaw > 0 ? new Date(takenRaw) : null);
    return { ok: true, data: { id: photo.id, fileId: photo.fileId } };
  });
}

export async function removePhotoAction(slug: string, orderId: string, photoId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    if (!uuid.safeParse(orderId).success || !uuid.safeParse(photoId).success) return { ok: false, error: 'Unknown photo.' };
    await removeCoachPhoto(db, ctx.tenant.id, ctx.actor, orderId, photoId);
    return { ok: true };
  });
}

export async function enRouteAction(slug: string, orderId: string, rawFix: unknown): Promise<ActionResult<{ etaMinutes: number | null; text1: boolean; text2: boolean; tracking: boolean }>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    if (!uuid.safeParse(orderId).success) return { ok: false, error: 'Unknown order.' };
    const r = await startEnRoute(db, ctx.tenant.id, ctx.actor, orderId, toFix(rawFix), drivingEtaMinutes);
    if (r.text1 || r.text2) sendQueued(ctx.tenant.id, orderId);
    return { ok: true, data: r };
  });
}

export async function pingAction(slug: string, orderId: string, rawFix: unknown): Promise<ActionResult<PingResult>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    const fix = toFix(rawFix);
    if (!uuid.safeParse(orderId).success || !fix) return { ok: false, error: 'No GPS fix.' };
    const r = await trackPing(db, ctx.tenant.id, ctx.actor, orderId, fix, drivingEtaMinutes);
    if (r.text2) sendQueued(ctx.tenant.id, orderId);
    return { ok: true, data: r };
  });
}

export async function trackingAction(slug: string, orderId: string, on: boolean): Promise<ActionResult<{ tracking: boolean }>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    if (!uuid.safeParse(orderId).success) return { ok: false, error: 'Unknown order.' };
    return { ok: true, data: await setTracking(db, ctx.tenant.id, ctx.actor, orderId, on === true) };
  });
}

export async function arrivedAction(slug: string, orderId: string, rawFix: unknown): Promise<ActionResult<{ distanceM: number | null }>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    if (!uuid.safeParse(orderId).success) return { ok: false, error: 'Unknown order.' };
    const r = await markArrived(db, ctx.tenant.id, ctx.actor, orderId, toFix(rawFix));
    return { ok: true, data: { distanceM: r.distanceM ?? null } };
  });
}

export async function eventStartAction(slug: string, orderId: string, rawFix: unknown): Promise<ActionResult<{ label: string }>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    if (!uuid.safeParse(orderId).success) return { ok: false, error: 'Unknown order.' };
    const r = await eventStart(db, ctx.tenant.id, ctx.actor, orderId, toFix(rawFix));
    return { ok: true, data: { label: r.variance.label } };
  });
}

/** After the app reopens: the order still being tracked, so GPS pings resume. */
export async function activeTrackingAction(slug: string): Promise<ActionResult<{ orderId: string; number: string; etaMinutes: number | null } | null>> {
  return run(async () => {
    const ctx = await requireCoach(slug);
    return { ok: true, data: await activeTracking(db, ctx.tenant.id, ctx.user.id) };
  });
}

// --- staff side: who is on an order -------------------------------------------------------------------

const staffInput = z.object({
  staff: z.array(z.object({ userId: z.string().min(1).max(100), role: z.enum(['coach', 'crew']), isLead: z.boolean().optional() })).max(12),
  coachNotes: z.string().max(4000).nullish(),
});

export async function saveOrderStaffAction(slug: string, orderId: string, raw: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'orders.create');
    const p = staffInput.safeParse(raw);
    if (!uuid.safeParse(orderId).success || !p.success) return { ok: false, error: 'That list did not look right. Reload and try again.' };
    await setOrderStaff(db, ctx.tenant.id, ctx.actor, orderId, p.data.staff);
    await setCoachNotes(db, ctx.tenant.id, ctx.actor, orderId, p.data.coachNotes ?? null);
    return { ok: true, message: 'Coaches and crew saved.' };
  });
}
