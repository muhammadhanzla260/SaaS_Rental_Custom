'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import {
  bookingRequirements, bookingSchema, cancelSchema, categorySchema, creditSchema, customerAddressSchema, customerSchema, orderSchema, productSchema, rescheduleSchema, resolveAgreement,
  unitSchema, type OrderInput,
} from '@rental/core';
import {
  addUnit, cancelOrder, createCategory, createCredit, createCustomer, createOrder, createProduct, deleteCategory, duplicateProduct, findDuplicateCustomers,
  getCustomer, getOrder, importCustomers, latestSignature, listCustomers, productAvailability, recordPayment, recordTip, removeCustomerAddress, removeUnit, renameCategory,
  resolveOverpayment, saveCustomerAddress, saveDocument, saveImage, setCustomerMessaging, setProductStatus, setUnitStatus, transitionOrder, updateCustomer,
  rescheduleOrder, updateOrder, updateProduct, usableCredits, validateCoupon, voidCredit,
  type Availability, type CustomerCredit, type CustomerProfile, type OrderAction,
} from '@rental/db';
import { invalid, type ActionResult } from '@/lib/result';
import { ActionError, requirePermission, requireView } from '../context';
import { db } from '../db';
import { quoteTravelFee } from '../travel';
import { readUpload, run } from './run';
import { dispatchOrder } from '@rental/messaging';
import { chargeSavedCardForOrder, finishStaffCardPayment, refundToCards, startStaffCardPayment, type StaffCardResult } from '@rental/payments';
import { listMessages } from '@rental/db';

const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');
const uuid = z.string().uuid();

// --- catalog --------------------------------------------------------------------------------

export async function saveProductAction(slug: string, id: string | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
    const parsed = productSchema.safeParse(JSON.parse(String(formData.get('payload') ?? '{}')));
    if (!parsed.success) return invalid(parsed.error);
    const upload = await readUpload(formData.get('image'));
    if (upload && !/^image\/(png|jpe?g|webp|gif)$/.test(upload.mime)) return { ok: false, error: 'Use a PNG, JPG, WebP or GIF image.' };
    if (upload && upload.bytes.length > 5 * 1024 * 1024) return { ok: false, error: 'Photos must be under 5 MB.' };
    const fileId = upload ? await saveImage(db, ctx.tenant.id, ctx.user.id, upload, 'product_image') : undefined;
    const image = fileId ? { fileId } : formData.get('imageRemove') === '1' ? { fileId: null } : null;
    const product = id
      ? await updateProduct(db, ctx.tenant.id, ctx.actor, id, parsed.data, image)
      : await createProduct(db, ctx.tenant.id, ctx.actor, parsed.data, fileId ?? null);
    refresh(slug);
    return { ok: true, data: { id: product.id }, message: id ? 'Product saved.' : 'Product added.' };
  });
}

export async function duplicateProductAction(slug: string, id: string): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
    const copy = await duplicateProduct(db, ctx.tenant.id, ctx.actor, uuid.parse(id));
    refresh(slug);
    return { ok: true, data: { id: copy.id }, message: 'Copied as a draft.' };
  });
}

export async function setProductStatusAction(slug: string, id: string, status: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
    const s = z.enum(['active', 'draft', 'archived']).parse(status);
    await setProductStatus(db, ctx.tenant.id, ctx.actor, uuid.parse(id), s);
    refresh(slug);
    return { ok: true, message: s === 'archived' ? 'Archived. It no longer shows on the order screen.' : s === 'active' ? 'Active.' : 'Saved as a draft.' };
  });
}

export async function saveCategoryAction(slug: string, id: string | null, input: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  return run<{ id: string; name: string }>(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
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
    const ctx = await requirePermission(slug, 'catalog.manage');
    await deleteCategory(db, ctx.tenant.id, ctx.actor, id);
    refresh(slug);
    return { ok: true, message: 'Category removed. Its products are now uncategorized.' };
  });
}

export async function addUnitAction(slug: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
    const parsed = unitSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await addUnit(db, ctx.tenant.id, ctx.actor, parsed.data);
    refresh(slug);
    return { ok: true, message: `${parsed.data.label} added.` };
  });
}

export async function setUnitStatusAction(slug: string, id: string, status: unknown, notes?: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
    const s = z.enum(['ready', 'cleaning', 'maintenance', 'out_of_service']).parse(status);
    const u = await setUnitStatus(db, ctx.tenant.id, ctx.actor, uuid.parse(id), s, notes === undefined ? undefined : notes.slice(0, 500) || null);
    refresh(slug);
    const msg =
      s === 'maintenance' ? `${u.label} is in maintenance and held from bookings.` : s === 'ready' ? `${u.label} is available again.` : `${u.label} updated.`;
    return { ok: true, message: msg };
  });
}

export async function removeUnitAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'catalog.manage');
    await removeUnit(db, ctx.tenant.id, ctx.actor, uuid.parse(id));
    refresh(slug);
    return { ok: true, message: 'Unit removed.' };
  });
}

// --- customers -------------------------------------------------------------------------------

export type CustomerHit = {
  id: string; name: string; email: string | null; phone: string | null; city: string | null; kind: string; taxExempt: boolean; orderCount: number;
  tags: string[];
};

export async function searchCustomersAction(slug: string, q: string): Promise<ActionResult<CustomerHit[]>> {
  return run<CustomerHit[]>(async () => {
    const ctx = await requireView(slug);
    const { rows } = await listCustomers(db, ctx.tenant.id, { search: q.slice(0, 80), limit: 8 });
    return {
      ok: true,
      data: rows.map((c) => ({
        id: c.id, name: c.displayName ?? '', email: c.email, phone: c.phone, city: c.city, kind: c.kind, taxExempt: c.taxExempt,
        orderCount: c.orderCount, tags: c.tags,
      })),
    };
  });
}

export async function getCustomerAction(slug: string, id: string): Promise<ActionResult<CustomerProfile | null>> {
  return run<CustomerProfile | null>(async () => {
    const ctx = await requireView(slug);
    return { ok: true, data: await getCustomer(db, ctx.tenant.id, uuid.parse(id)) };
  });
}

export async function saveCustomerAction(
  slug: string,
  id: string | null,
  input: unknown,
  opts: { allowDuplicate?: boolean } = {},
): Promise<ActionResult<{ id: string; name: string }>> {
  return run<{ id: string; name: string }>(async () => {
    const ctx = await requirePermission(slug, 'customers.manage');
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    if (!opts.allowDuplicate) {
      const dupes = await findDuplicateCustomers(db, ctx.tenant.id, parsed.data.email, parsed.data.phone, id ?? undefined);
      if (dupes.length) {
        const d = dupes[0]!;
        return {
          ok: false,
          error: `${d.displayName} already uses this ${d.email && d.email === parsed.data.email ? 'email' : 'phone number'}. Open that customer, or save anyway.`,
          fieldErrors: { _duplicate: `${d.id}|${d.displayName}` },
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

export async function setCustomerMessagingAction(slug: string, id: string, prefs: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'customers.manage');
    const p = z.object({ smsOptIn: z.boolean().optional(), marketingOptIn: z.boolean().optional() }).parse(prefs);
    await setCustomerMessaging(db, ctx.tenant.id, ctx.actor, uuid.parse(id), p);
    refresh(slug);
    return { ok: true, message: 'Message preferences saved.' };
  });
}

export async function saveCustomerAddressAction(slug: string, customerId: string, id: string | null, input: unknown): Promise<ActionResult<{ id: string }>> {
  return run<{ id: string }>(async () => {
    const ctx = await requirePermission(slug, 'customers.manage');
    const parsed = customerAddressSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const a = await saveCustomerAddress(db, ctx.tenant.id, ctx.actor, uuid.parse(customerId), parsed.data, id);
    refresh(slug);
    return { ok: true, data: { id: a.id }, message: 'Address saved.' };
  });
}

export async function removeCustomerAddressAction(slug: string, customerId: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'customers.manage');
    await removeCustomerAddress(db, ctx.tenant.id, ctx.actor, uuid.parse(customerId), uuid.parse(id));
    refresh(slug);
    return { ok: true, message: 'Address removed.' };
  });
}

export async function createCreditAction(slug: string, customerId: string, input: unknown): Promise<ActionResult<{ code: string }>> {
  return run<{ code: string }>(async () => {
    const ctx = await requirePermission(slug, 'payments.refund');
    const parsed = creditSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const c = await createCredit(db, ctx.tenant.id, ctx.actor, uuid.parse(customerId), parsed.data);
    refresh(slug);
    return { ok: true, data: { code: c.code }, message: `${c.code} issued.` };
  });
}

export async function voidCreditAction(slug: string, id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requirePermission(slug, 'payments.refund');
    const c = await voidCredit(db, ctx.tenant.id, ctx.actor, uuid.parse(id));
    refresh(slug);
    return { ok: true, message: `${c.code} voided.` };
  });
}

const importRow = z.record(z.string(), z.unknown());
type ImportSummary = { created: number; skipped: { row: number; reason: string }[] };

export async function importCustomersAction(slug: string, rows: unknown): Promise<ActionResult<ImportSummary>> {
  return run<ImportSummary>(async () => {
    const ctx = await requirePermission(slug, 'customers.manage');
    const parsed = z.array(importRow).max(2000, 'Import up to 2,000 customers at a time.').safeParse(rows);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'That file could not be read.' };
    const res = await importCustomers(db, ctx.tenant.id, ctx.actor, parsed.data);
    refresh(slug);
    return { ok: true, data: res, message: `${res.created} customer${res.created === 1 ? '' : 's'} imported.` };
  });
}

// --- orders ----------------------------------------------------------------------------------

/**
 * Price and tax overrides need their own permissions. People without them may
 * keep what is already on the order but not change it.
 */
async function checkOverrides(ctx: Awaited<ReturnType<typeof requirePermission>>, id: string | null, input: OrderInput) {
  const before = id ? await getOrder(db, ctx.tenant.id, id) : null;
  if (!ctx.can('orders.override_price')) {
    const had = new Map((before?.lines ?? []).filter((l) => l.priceOverridden && l.productId).map((l) => [l.productId!, l.unitCents]));
    for (const l of input.lines) {
      if (!l.productId || l.overridePrice == null) continue;
      if (had.get(l.productId) !== Math.round(l.overridePrice * 100)) throw new ActionError('Your role cannot change unit prices. Ask a manager.');
    }
    // The locked base package and additional-time rate: kept from the order as it was, else the product's price today.
    const locked = new Map((before?.lines ?? []).filter((l) => l.productId).map((l) => [`${l.productId}:${l.serviceMode}`, l]));
    for (const l of input.lines) {
      if (!l.productId) continue;
      const was = locked.get(`${l.productId}:${l.serviceMode}`);
      l.basePrice = was?.baseCents != null ? was.baseCents / 100 : null;
      l.extraRate = was?.extraRateCents != null ? was.extraRateCents / 100 : null;
    }
  }
  if (!ctx.can('orders.override_tax') && input.taxOverridden) {
    if (!before?.taxOverridden || Number(before.taxPercent) !== input.taxPercent) throw new ActionError('Your role cannot change the tax rate. Ask a manager.');
  }
}

export type SavedOrder = { id: string; number: string; version: number; status: string; totalCents: number; overpaidCents: number };

/**
 * Save the order screen. `quiet` skips the page refresh: Payment Options saves first and keeps its
 * window open (a refresh would remount the order screen under the new version and close it mid-payment).
 */
export async function saveOrderAction(slug: string, id: string | null, input: unknown, version?: number, quiet = false): Promise<ActionResult<SavedOrder>> {
  return run<SavedOrder>(async () => {
    const ctx = await requirePermission(slug, 'orders.create');
    const parsed = orderSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    await checkOverrides(ctx, id, parsed.data);
    if (id) {
      const r = await updateOrder(db, ctx.tenant.id, ctx.actor, id, parsed.data, ctx.prefs, version);
      if (!quiet) refresh(slug);
      const o = r.order;
      return {
        ok: true,
        data: { id: o.id, number: o.number, version: o.version, status: o.status, totalCents: o.totalCents, overpaidCents: r.overpaidCents },
        message: r.changed ? `Saved as version ${o.version}${o.status === 'booked' ? ' · availability re-checked' : ''}.` : 'Saved.',
      };
    }
    const o = await createOrder(db, ctx.tenant.id, ctx.actor, parsed.data, ctx.prefs);
    if (!quiet) refresh(slug);
    return {
      ok: true,
      data: { id: o.id, number: o.number, version: o.version, status: o.status, totalCents: o.totalCents, overpaidCents: 0 },
      message: `${o.number} saved as a draft.`,
    };
  });
}

const actionSchema = z.enum(['send_quote', 'book', 'complete', 'cancel', 'reopen']);
const ACTION_DONE: Record<OrderAction, string> = {
  send_quote: 'Marked as quote sent. Quotes still hold nothing; emailing them arrives in Phase 2.',
  book: 'Booked. The equipment is held, including the cleanup time.',
  complete: 'Marked as completed.',
  cancel: 'Cancelled. The equipment is free again.',
  reopen: 'Reopened as a draft.',
};

/**
 * Staff booking checks (Odoo POS "Still required to continue"): the contact and
 * billing details, and — unless the customer signed online — the policies the
 * customer agreed to, confirmed by staff.
 */
async function bookingBlocked(tenantId: string, orderId: string, prefs: Parameters<typeof transitionOrder>[5], acks: Record<string, boolean>) {
  const o = await getOrder(db, tenantId, orderId);
  if (!o) return 'Order not found.';
  const c = await getCustomer(db, tenantId, o.customerId);
  const b = (o.billing ?? {}) as { name?: string; email?: string; phone?: string; address?: { line1?: string; city?: string; region?: string; postalCode?: string } };
  const missing = bookingRequirements({
    billing: {
      name: b.name || c?.displayName, email: b.email || c?.email, phone: b.phone || c?.phone,
      address: b.address?.line1 ? b.address : { line1: c?.line1, city: c?.city, region: c?.region, postalCode: c?.postalCode },
    },
    eventStreet: o.eventLine1, contactName: o.eventContactName, contactMobile: o.eventContactMobile, contactConfirmed: o.contactConfirmed,
  });
  if (missing.length) return `Still required to book: ${missing.join(', ')}.`;
  if (await latestSignature(db, tenantId, orderId)) return null;
  const need = resolveAgreement(prefs.agreement).policies.filter((p) => p.key !== 'waiver' && !acks[p.key]);
  return need.length ? `Confirm the customer agreed to: ${need.map((p) => p.title).join(', ')}.` : null;
}

export async function transitionOrderAction(
  slug: string,
  id: string,
  action: unknown,
  opts: { reason?: string; booking?: unknown } = {},
): Promise<ActionResult<{ status: string; version: number; payment: string | null }>> {
  return run<{ status: string; version: number; payment: string | null }>(async () => {
    const ctx = await requirePermission(slug, 'orders.create');
    const a = actionSchema.safeParse(action);
    if (!a.success) return { ok: false, error: 'Unknown step.' };
    let booking;
    if (a.data === 'book' && opts.booking) {
      const b = bookingSchema.safeParse(opts.booking);
      if (!b.success) return invalid(b.error);
      booking = b.data;
    }
    if (a.data === 'book') {
      const blocked = await bookingBlocked(ctx.tenant.id, uuid.parse(id), ctx.prefs, booking?.policies ?? {});
      if (blocked) return { ok: false, error: blocked };
    }
    const r = await transitionOrder(db, ctx.tenant.id, ctx.actor, uuid.parse(id), a.data, ctx.prefs, { reason: opts.reason?.slice(0, 500), booking });
    // Booking shows its own done step in Payment Options (the order reloads when it closes); a refresh would remount it away.
    if (a.data !== 'book') refresh(slug);
    let message = ACTION_DONE[a.data];
    if (a.data === 'send_quote') {
      // Staff are waiting on this one: send now and say where it went.
      await dispatchOrder(db, ctx.tenant.id, r.order.id);
      const q = (await listMessages(db, ctx.tenant.id, { orderId: r.order.id, type: 'quote', limit: 1 })).rows[0];
      message = q?.status === 'sent' ? `Quote emailed to ${q.toAddress}.` : q?.status === 'skipped' ? `Quote marked as sent, but not emailed: ${q.lastError}.` : `Quote marked as sent; email ${q?.status ?? 'queued'}${q?.lastError ? ` (${q.lastError})` : ''}.`;
    } else {
      after(() => dispatchOrder(db, ctx.tenant.id, r.order.id).catch((e) => console.error('[dispatch]', e)));
    }
    return { ok: true, data: { status: r.order.status, version: r.order.version, payment: r.payment?.number ?? null }, message };
  });
}

const paymentSchema = z.object({
  method: z.enum(['cash', 'check', 'zelle', 'venmo', 'ach', 'other']),
  amount: z.coerce.number().positive('Enter the amount received.').max(1_000_000),
  tip: z.coerce.number().min(0).max(100_000).default(0),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
  receipt: z.boolean().default(true),
});

export async function recordPaymentAction(slug: string, id: string, input: unknown): Promise<ActionResult<{ number: string }>> {
  return run<{ number: string }>(async () => {
    const ctx = await requirePermission(slug, 'payments.record');
    const p = paymentSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    // No page refresh here: the order screen shows its own done step, then reloads when it closes.
    const r = await recordPayment(db, ctx.tenant.id, ctx.actor, uuid.parse(id), ctx.prefs, p.data);
    after(() => dispatchOrder(db, ctx.tenant.id, r.order.id).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { number: r.payment.number }, message: `${r.payment.number} recorded.` };
  });
}

const tipSchema = z.object({
  method: z.enum(['cash', 'check', 'zelle', 'venmo', 'ach', 'other']),
  tip: z.coerce.number().positive('Enter the tip amount.').max(100_000),
  reference: z.string().trim().max(80).optional(),
});

/** Collect Tip, by cash, check or a transfer (cards go through the card actions below). */
export async function collectTipAction(slug: string, id: string, input: unknown): Promise<ActionResult<{ number: string }>> {
  return run<{ number: string }>(async () => {
    const ctx = await requirePermission(slug, 'payments.record');
    const p = tipSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    const r = await recordTip(db, ctx.tenant.id, ctx.actor, uuid.parse(id), ctx.prefs, p.data);
    return { ok: true, data: { number: r.payment.number }, message: `Tip recorded · ${r.payment.number}.` };
  });
}

// --- cards taken by staff (Payment Options) -------------------------------------------------------------
// These do not refresh the page: the Payment Options window shows its done step and the order reloads on close.

const staffCardSchema = z.object({
  purpose: z.enum(['book', 'payment', 'tip']),
  amount: z.coerce.number().min(0).max(1_000_000),
  tip: z.coerce.number().min(0).max(100_000).default(0),
  receipt: z.boolean().default(true),
  saveCard: z.boolean().default(false),
  policies: z.record(z.string().max(40), z.boolean()).default({}),
});
const cents = (n: number) => Math.round(n * 100);

/** Booking by card: the same "still required" checks as any booking, before any money moves. */
async function staffCardContext(slug: string, id: string, input: unknown) {
  const p = staffCardSchema.safeParse(input);
  if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? 'Check the amounts.');
  const ctx = await requirePermission(slug, 'payments.record');
  if (p.data.purpose === 'book') {
    await requirePermission(slug, 'orders.create');
    const blocked = await bookingBlocked(ctx.tenant.id, id, ctx.prefs, p.data.policies);
    if (blocked) throw new ActionError(blocked);
  }
  const d = p.data;
  return { ctx, card: { purpose: d.purpose, amountCents: d.purpose === 'tip' ? 0 : cents(d.amount), tipCents: cents(d.tip), receipt: d.receipt, saveCard: d.saveCard, policies: d.policies } };
}

const cardDone = (r: StaffCardResult, purpose: string) =>
  `${purpose === 'tip' ? 'Tip charged' : r.booked ? 'Booked and charged' : 'Charged'} ${r.brand ? r.brand.toUpperCase() : 'card'} •${r.last4 ?? '••••'} · ${r.number}.`;

export type StaffCardIntent = { clientSecret: string; intentId: string; publishableKey: string; amountCents: number; testMode: boolean };

/** New card: the PaymentIntent that Stripe's card field (in this browser) confirms. Card numbers never reach us. */
export async function staffCardStartAction(slug: string, id: string, input: unknown): Promise<ActionResult<StaffCardIntent>> {
  return run<StaffCardIntent>(async () => {
    const orderId = uuid.parse(id);
    const { ctx, card } = await staffCardContext(slug, orderId, input);
    const r = await startStaffCardPayment(db, ctx.tenant.id, orderId, card);
    return { ok: true, data: r };
  });
}

/** Stripe's card field said yes: book (when booking), record the payment, keep the card if it was saved. */
export async function staffCardFinishAction(slug: string, id: string, intentId: string, policies: Record<string, boolean> = {}): Promise<ActionResult<{ booked: boolean }>> {
  return run<{ booked: boolean }>(async () => {
    const orderId = uuid.parse(id);
    const ctx = await requirePermission(slug, 'payments.record');
    const acks = z.record(z.string().max(40), z.boolean()).parse(policies);
    const r = await finishStaffCardPayment(db, ctx.tenant.id, orderId, ctx.actor, z.string().regex(/^pi_[A-Za-z0-9]+$/).parse(intentId), acks);
    after(() => dispatchOrder(db, ctx.tenant.id, orderId).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { booked: r.booked }, message: cardDone(r, r.booked ? 'book' : 'payment') };
  });
}

/** The customer's saved card, charged now (booking the order when that is the step). */
export async function savedCardChargeAction(slug: string, id: string, input: unknown): Promise<ActionResult<{ booked: boolean }>> {
  return run<{ booked: boolean }>(async () => {
    const orderId = uuid.parse(id);
    const { ctx, card } = await staffCardContext(slug, orderId, input);
    const r = await chargeSavedCardForOrder(db, ctx.tenant.id, orderId, ctx.actor, card);
    after(() => dispatchOrder(db, ctx.tenant.id, orderId).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { booked: r.booked }, message: cardDone(r, card.purpose) };
  });
}

export async function resolveOverpaymentAction(slug: string, id: string, choice: unknown): Promise<ActionResult> {
  return run(async () => {
    const c = z.enum(['refund', 'wallet', 'keep']).parse(choice);
    const ctx = await requirePermission(slug, c === 'keep' ? 'orders.create' : 'payments.refund');
    await resolveOverpayment(db, ctx.tenant.id, ctx.actor, uuid.parse(id), c);
    refresh(slug);
    const msg =
      c === 'wallet' ? 'Moved to the customer’s wallet credit.' : c === 'refund' ? 'Noted as a refund owed to the customer.' : 'Kept as an overpayment.';
    return { ok: true, message: msg };
  });
}

const windowSchema = z.object({
  locationId: uuid,
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  excludeOrderId: uuid.nullable().optional(),
});

export async function availabilityAction(slug: string, input: unknown): Promise<ActionResult<Record<string, Availability>>> {
  return run<Record<string, Availability>>(async () => {
    const ctx = await requireView(slug);
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
    const ctx = await requireView(slug);
    const p = travelSchema.safeParse(input);
    if (!p.success) return { ok: false, error: 'Pin the event address first.' };
    const quote = await quoteTravelFee(ctx.tenant.id, ctx.prefs, p.data, p.data.modes.length ? p.data.modes : ['staffed']);
    if (!quote) return { ok: false, error: 'Pin at least one active location on the map in Settings.' };
    return { ok: true, data: quote };
  });
}

type CouponResult = { ok: boolean; label?: string; message?: string; kind?: 'percent' | 'amount'; value?: number };

export async function validateCouponAction(slug: string, code: string, orderId?: string | null): Promise<ActionResult<CouponResult>> {
  return run<CouponResult>(async () => {
    const ctx = await requireView(slug);
    const c = await validateCoupon(db, ctx.tenant.id, code.slice(0, 40), orderId ?? null);
    return { ok: true, data: c.ok ? { ok: true, label: c.label, kind: c.kind, value: c.value } : { ok: false, message: c.message } };
  });
}

export async function usableCreditsAction(slug: string, customerId: string, orderId?: string | null): Promise<ActionResult<CustomerCredit[]>> {
  return run<CustomerCredit[]>(async () => {
    const ctx = await requireView(slug);
    return { ok: true, data: await usableCredits(db, ctx.tenant.id, uuid.parse(customerId), orderId ?? null) };
  });
}

/** Create a customer from the order screen's "New customer" (same rules as the Customers page). */
export async function quickCustomerAction(slug: string, input: unknown): Promise<ActionResult<CustomerHit>> {
  return run<CustomerHit>(async () => {
    const ctx = await requirePermission(slug, 'customers.manage');
    const parsed = customerSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const dupes = await findDuplicateCustomers(db, ctx.tenant.id, parsed.data.email, parsed.data.phone);
    if (dupes.length) return { ok: false, error: `${dupes[0]!.displayName} already uses this email or phone. Search for them instead.` };
    const c = await createCustomer(db, ctx.tenant.id, ctx.actor, parsed.data);
    refresh(slug);
    return {
      ok: true,
      data: { id: c.id, name: c.displayName ?? '', email: c.email, phone: c.phone, city: c.city, kind: c.kind, taxExempt: c.taxExempt, orderCount: 0, tags: c.tags },
      message: `${c.displayName} added.`,
    };
  });
}

/** Setup map for the crew (image or PDF), attached to the order on its next save. */
export async function uploadSetupMapAction(slug: string, formData: FormData): Promise<ActionResult<{ id: string; name: string; url: string }>> {
  return run<{ id: string; name: string; url: string }>(async () => {
    const ctx = await requirePermission(slug, 'orders.create');
    const file = await readUpload(formData.get('file'));
    if (!file) return { ok: false, error: 'Choose an image or PDF.' };
    const id = await saveDocument(db, ctx.tenant.id, ctx.user.id, file, 'setup_map');
    return { ok: true, data: { id, name: file.filename, url: `/api/files/${ctx.tenant.id}/${id}` } };
  });
}

/**
 * Cancel an order and settle what was paid (wallet credit, refund or rain check).
 * Card refunds are made at the gateway first, so money only moves when the
 * gateway says yes; then the cancel is recorded in one transaction.
 */
export async function cancelOrderAction(slug: string, id: string, input: unknown): Promise<ActionResult<{ outcome: string; code: string | null }>> {
  return run<{ outcome: string; code: string | null }>(async () => {
    const parsed = cancelSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const c = parsed.data;
    const ctx = await requirePermission(slug, c.outcome === 'none' ? 'orders.create' : 'payments.refund');
    const orderId = uuid.parse(id);
    const o = await getOrder(db, ctx.tenant.id, orderId);
    if (!o) return { ok: false, error: 'Order not found.' };
    if (c.outcome !== 'none' && Math.round(c.amount * 100) > o.paidCents) return { ok: false, error: 'That is more than was paid.' };
    const done = c.outcome === 'refund' ? await refundToCards(db, ctx.tenant.id, orderId, Math.round(c.amount * 100), `Cancelled ${o.number}: ${c.reason}`) : [];
    const r = await cancelOrder(db, ctx.tenant.id, ctx.actor, orderId, ctx.prefs, c, done);
    // No revalidatePath: it would refresh this page mid-result (the new version remounts the editor).
    // Every page is rendered per request, so others are fresh anyway; Done reloads the order.
    after(() => dispatchOrder(db, ctx.tenant.id, orderId).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { outcome: r.outcome, code: r.credit?.code ?? r.goodwillCredit?.code ?? null }, message: r.outcome };
  });
}

/** Rain check → Reschedule now: move the booking to a new date (availability re-checked). */
export async function rescheduleOrderAction(slug: string, id: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  return run<{ version: number }>(async () => {
    const ctx = await requirePermission(slug, 'orders.create');
    const parsed = rescheduleSchema.safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const r = await rescheduleOrder(db, ctx.tenant.id, ctx.actor, uuid.parse(id), ctx.prefs, parsed.data);
    after(() => dispatchOrder(db, ctx.tenant.id, r.order.id).catch((e) => console.error('[dispatch]', e)));
    return { ok: true, data: { version: r.order.version }, message: 'Rescheduled. Reminders follow the new date.' };
  });
}
