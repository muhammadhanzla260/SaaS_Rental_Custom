'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { categorySchema, customerSchema, orderSchema, productSchema } from '@rental/core';
import {
  createCategory, createCustomer, createOrder, createProduct, deleteCategory, findDuplicateCustomers, getCustomer,
  listCustomers, productAvailability, renameCategory, saveImage, transitionOrder, updateCustomer, updateOrder, updateProduct,
  type OrderAction,
} from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { CAN_EDIT_CATALOG, CAN_SELL, requireRole } from '../context';
import { db } from '../db';
import { quoteTravelFee } from '../travel';
import { readUpload, run } from './run';

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

// --- catalog --------------------------------------------------------------------------------

export async function saveProductAction(slug: string, id: string | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const ctx = await requireRole(slug, CAN_EDIT_CATALOG);
    const parsed = productSchema.safeParse(JSON.parse(String(formData.get('payload') ?? '{}')));
    if (!parsed.success) return invalid(parsed.error);
    const upload = await readUpload(formData.get('image'));
    const fileId = upload ? await saveImage(db, ctx.tenant.id, ctx.user.id, upload, 'product_image') : undefined;
    const image = fileId ? { fileId } : formData.get('imageRemove') === '1' ? { fileId: null } : null;
    const product = id
      ? await updateProduct(db, ctx.tenant.id, ctx.actor, id, parsed.data, image)
      : await createProduct(db, ctx.tenant.id, ctx.actor, parsed.data, fileId ?? null);
    refresh(slug);
    return { ok: true, data: { id: product.id }, message: id ? 'Product saved.' : 'Product added.' };
  });
}

export async function saveCategoryAction(slug: string, id: string | null, input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return run<{ id: string; name: string }>(async () => {
    const ctx = await requireRole(slug, CAN_EDIT_CATALOG);
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const c = id
      ? await renameCategory(db, ctx.tenant.id, ctx.actor, id, parsed.data.name)
      : await createCategory(db, ctx.tenant.id, ctx.actor, parsed.data.name);
    refresh(slug);
    return { ok: true, data: { id: c.id, name: c.name } };
  });
}

export async function deleteCategoryAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireRole(slug, CAN_EDIT_CATALOG);
    await deleteCategory(db, ctx.tenant.id, ctx.actor, id);
    refresh(slug);
    return { ok: true, message: 'Category removed. Its products are now uncategorized.' };
  });
}

// --- customers -------------------------------------------------------------------------------

export type CustomerHit = { id: string; name: string; email: string | null; phone: string | null; city: string | null; lat: number | null; lng: number | null };

export async function searchCustomersAction(slug: string, q: string): Promise<ActionResult<CustomerHit[]>> {
  return run<CustomerHit[]>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    const rows = await listCustomers(db, ctx.tenant.id, q.slice(0, 80), 8);
    return {
      ok: true,
      data: rows.map((c) => ({ id: c.id, name: c.displayName ?? '', email: c.email, phone: c.phone, city: c.city, lat: c.lat, lng: c.lng })),
    };
  });
}

export async function getCustomerAction(slug: string, id: string): Promise<ActionResult<Awaited<ReturnType<typeof getCustomer>>>> {
  return run<Awaited<ReturnType<typeof getCustomer>>>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    return { ok: true, data: await getCustomer(db, ctx.tenant.id, id) };
  });
}

export async function saveCustomerAction(
  slug: string,
  id: string | null,
  input: unknown,
  opts: { allowDuplicate?: boolean } = {},
): Promise<ActionResult<{ id: string; name: string; duplicates?: { id: string; name: string }[] }>> {
  return run<{ id: string; name: string; duplicates?: { id: string; name: string }[] }>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (!opts.allowDuplicate) {
      const dupes = await findDuplicateCustomers(db, ctx.tenant.id, parsed.data.email, parsed.data.phone, id ?? undefined);
      if (dupes.length) {
        return {
          ok: false,
          error: `${dupes[0]!.displayName} already uses this ${dupes[0]!.email === parsed.data.email ? 'email' : 'phone number'}. Open that customer instead, or save anyway.`,
          fieldErrors: { _duplicate: dupes.map((d) => `${d.id}|${d.displayName}`).join(',') },
        };
      }
    }
    const c = id
      ? await updateCustomer(db, ctx.tenant.id, ctx.actor, id, parsed.data)
      : await createCustomer(db, ctx.tenant.id, ctx.actor, parsed.data);
    refresh(slug);
    return { ok: true, data: { id: c.id, name: c.displayName ?? '' }, message: id ? 'Customer saved.' : 'Customer added.' };
  });
}

// --- orders ----------------------------------------------------------------------------------

export async function saveOrderAction(
  slug: string,
  id: string | null,
  input: unknown,
  version?: number,
): Promise<ActionResult<{ id: string; number: string; version: number; status: string }>> {
  return run<{ id: string; number: string; version: number; status: string }>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    const parsed = orderSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const o = id
      ? await updateOrder(db, ctx.tenant.id, ctx.actor, id, parsed.data, ctx.prefs, version)
      : await createOrder(db, ctx.tenant.id, ctx.actor, parsed.data, ctx.prefs);
    refresh(slug);
    return { ok: true, data: { id: o.id, number: o.number, version: o.version, status: o.status }, message: `${o.number} saved.` };
  });
}

const actionSchema = z.enum(['send_quote', 'book', 'complete', 'cancel', 'reopen']);
const ACTION_DONE: Record<OrderAction, string> = {
  send_quote: 'Marked as quote sent. Emailing quotes arrives in Phase 2.',
  book: 'Booked. The equipment is now held for this event.',
  complete: 'Marked as completed.',
  cancel: 'Cancelled. The equipment is free again.',
  reopen: 'Reopened as a draft.',
};

export async function transitionOrderAction(slug: string, id: string, action: unknown, reason?: string): Promise<ActionResult<{ status: string; version: number }>> {
  return run<{ status: string; version: number }>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    const a = actionSchema.safeParse(action);
    if (!a.success) return { ok: false, error: 'Unknown step.' };
    const o = await transitionOrder(db, ctx.tenant.id, ctx.actor, id, a.data, ctx.prefs, reason?.slice(0, 500));
    refresh(slug);
    return { ok: true, data: { status: o.status, version: o.version }, message: ACTION_DONE[a.data] };
  });
}

const windowSchema = z.object({
  locationId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  excludeOrderId: z.string().uuid().nullable().optional(),
});

export async function availabilityAction(slug: string, input: unknown): Promise<ActionResult<Record<string, { owned: number; held: number; free: number }>>> {
  return run<Record<string, { owned: number; held: number; free: number }>>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    const w = windowSchema.safeParse(input);
    if (!w.success || w.data.endsAt <= w.data.startsAt) return { ok: true, data: {} };
    return { ok: true, data: await productAvailability(db, ctx.tenant.id, w.data.locationId, w.data.startsAt, w.data.endsAt, w.data.excludeOrderId) };
  });
}

const travelSchema = z.object({ lat: z.number(), lng: z.number(), modes: z.array(z.enum(['staffed', 'pickup', 'dropoff'])).max(60) });
type TravelQuote = NonNullable<Awaited<ReturnType<typeof quoteTravelFee>>>;

/** Nearest location by driving distance and the travel fee (Odoo POS _applyTravelFee). */
export async function travelForOrderAction(slug: string, input: unknown): Promise<ActionResult<TravelQuote>> {
  return run<TravelQuote>(async () => {
    const ctx = await requireRole(slug, CAN_SELL);
    const p = travelSchema.safeParse(input);
    if (!p.success) return { ok: false, error: 'Pin the event address first.' };
    const quote = await quoteTravelFee(ctx.tenant.id, ctx.prefs, p.data, p.data.modes.length ? p.data.modes : ['staffed']);
    if (!quote) return { ok: false, error: 'Pin at least one active location on the map in Settings.' };
    return { ok: true, data: quote };
  });
}
