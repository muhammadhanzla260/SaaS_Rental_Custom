'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bookingRequirements, formatEventTime, formatMoney, ORDER_STATUS, type OrderStatus } from '@rental/core';
import type { Availability } from '@rental/db';
import { CustomerFormDrawer } from '@/components/customers/customer-form';
import { Button, cx, Notice, Pill, SaveBar, Select, useToast } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import {
  availabilityAction, getCustomerAction, recordPaymentAction, resolveOverpaymentAction, saveCustomerAddressAction, saveOrderAction,
  transitionOrderAction, travelForOrderAction, usableCreditsAction, validateCouponAction,
} from '@/server/actions/commerce';
import { addMinutes, initialDraft, locationOf, newLine, priceDraft, timeLabel, toOrderInput } from './draft';
import { OrderHistory } from './history';
import { BookModal, CancelModal, OverpaidModal, PaymentModal, type BookChoice } from './modals';
import { CustomerSection, EventSection, ItemsSection, LinesSection, NotesSection } from './sections';
import { SummaryPanel } from './summary';
import type { BuilderCredit, BuilderCustomer, BuilderData, BuilderProduct, Draft, DraftLine } from './types';

// The coupon's rule and the distance note are derived, so they never count as unsaved changes.
// Line keys are UI ids, regenerated on every load, so they are left out too.
const snap = (d: Draft) => JSON.stringify({ ...d, coupon: null, milesNote: null, lines: d.lines.map(({ key: _key, ...l }) => l) });

export function OrderBuilder({ data }: { data: BuilderData }) {
  const router = useRouter();
  const toast = useToast();
  const money = useCallback((c: number) => formatMoney(c, data.currency), [data.currency]);
  const [first] = useState(() => initialDraft(data));
  const [d, setD] = useState<Draft>(first);
  const [saved, setSaved] = useState(() => snap(first));
  const [savedDraft, setSavedDraft] = useState<Draft>(first);
  const [meta, setMeta] = useState(() => ({
    id: data.order?.id ?? null, number: data.order?.number ?? 'New order', status: (data.order?.status ?? 'draft') as OrderStatus,
    version: data.order?.version ?? 0, paidCents: data.order?.paidCents ?? 0,
  }));
  const [credits, setCredits] = useState<BuilderCredit[]>(data.credits);
  const [avail, setAvail] = useState<Record<string, Availability>>({});
  const [availLoading, setAvailLoading] = useState(false);
  const [milesBusy, setMilesBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [refused, setRefused] = useState<Set<string>>(new Set());
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'quote' | 'cancel'>(null);
  const [custLoading, setCustLoading] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [overpaid, setOverpaid] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const navAfterBook = useRef<string | null>(null);

  const set = useCallback((patch: Partial<Draft> | ((x: Draft) => Partial<Draft>)) => {
    setD((x) => ({ ...x, ...(typeof patch === 'function' ? patch(x) : patch) }));
  }, []);
  const setLine = useCallback((key: string, patch: Partial<DraftLine>) => setD((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })), []);

  const status = meta.status;
  const booked = status === 'booked';
  const cancelled = status === 'cancelled';
  const readOnly = data.readOnly || !data.perms.create || cancelled || status === 'completed';
  const dirty = snap(d) !== saved;
  const loc = locationOf(data, d.locationId);
  const priced = useMemo(() => priceDraft(d, { ...data, credits }), [d, data, credits]);
  const s = priced.quote.summary;

  // --- availability for the event window (this order's own holds don't count against it) ---
  const windowKey = `${d.locationId}|${priced.startsAt.toISOString()}|${priced.endsAt.toISOString()}`;
  useEffect(() => {
    if (!d.locationId) return;
    let live = true;
    setAvailLoading(true);
    const t = setTimeout(async () => {
      const r = await availabilityAction(data.slug, { locationId: d.locationId, startsAt: priced.startsAt, endsAt: priced.endsAt, excludeOrderId: meta.id });
      if (!live) return;
      setAvailLoading(false);
      if (r.ok) setAvail(r.data ?? {});
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [windowKey, meta.id, meta.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lines asking for more than is free (after a date or quantity change): flagged red, booking blocked.
  const short = useMemo(() => {
    const out = new Map<string, string>();
    const used = new Map<string, number>();
    for (const l of d.lines) {
      if (!l.productId) continue;
      const a = avail[l.productId];
      const p = data.products.find((x) => x.id === l.productId);
      if (!a || a.overbook || p?.tracking === 'none') continue;
      const before = used.get(l.productId) ?? 0;
      used.set(l.productId, before + l.quantity);
      if (before + l.quantity > a.free) out.set(l.key, `Only ${Math.max(0, a.free - before)} of ${a.owned} free for this time (${a.held} reserved).`);
    }
    return out;
  }, [d.lines, avail, data.products]);

  // --- driving distance whenever the pinned event address changes ---
  const coordsKey = d.eventAddress.lat != null && d.eventAddress.lng != null ? `${d.eventAddress.lat.toFixed(5)},${d.eventAddress.lng.toFixed(5)}` : '';
  const lastCoords = useRef<string>(d.miles ? coordsKey : '');
  const computeMiles = useCallback(async (force = false) => {
    if (d.eventAddress.lat == null || d.eventAddress.lng == null) return;
    if (!force && (d.milesOverridden || lastCoords.current === coordsKey)) return;
    lastCoords.current = coordsKey;
    setMilesBusy(true);
    const modes = d.lines.filter((l) => l.productId).map((l) => l.serviceMode);
    const r = await travelForOrderAction(data.slug, { lat: d.eventAddress.lat, lng: d.eventAddress.lng, modes });
    setMilesBusy(false);
    if (!r.ok) return set({ milesNote: r.error });
    set({
      miles: r.data!.distance.toFixed(1), milesOverridden: false, depotId: r.data!.location.id,
      milesNote: `${r.data!.isDriving ? 'Driving' : 'Straight-line'} distance from ${r.data!.location.name}.`,
    });
  }, [coordsKey, d.eventAddress.lat, d.eventAddress.lng, d.lines, d.milesOverridden, data.slug, set]);
  useEffect(() => { computeMiles(); }, [coordsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- coupon: check the saved code once so its rule is known, and on Enter/blur ---
  const applyCoupon = useCallback(async () => {
    const code = d.couponCode.trim();
    if (!code) { setCouponMsg(null); return set({ coupon: null }); }
    if (d.coupon?.code === code) return;
    const r = await validateCouponAction(data.slug, code, meta.id);
    if (!r.ok) return setCouponMsg({ ok: false, text: r.error });
    const c = r.data!;
    if (c.ok) {
      set({ coupon: { code, kind: c.kind!, value: c.value!, label: c.label! } });
      setCouponMsg({ ok: true, text: c.label! });
    } else {
      set({ coupon: null });
      setCouponMsg({ ok: false, text: c.message ?? 'Not valid' });
    }
  }, [d.couponCode, d.coupon, data.slug, meta.id, set]);
  useEffect(() => {
    if (!d.couponCode || d.coupon) return;
    applyCoupon();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- customer ---
  const pickCustomer = useCallback(async (id: string) => {
    setCustLoading(true);
    const [r, cr] = await Promise.all([getCustomerAction(data.slug, id), usableCreditsAction(data.slug, id, meta.id)]);
    setCustLoading(false);
    if (!r.ok || !r.data) return toast(r.ok ? 'Customer not found.' : r.error, 'error');
    const c = r.data;
    const bc: BuilderCustomer = {
      id: c.id, name: c.displayName ?? 'Customer', firstName: c.firstName, email: c.email, phone: c.phone, phoneSecondary: c.phoneSecondary, country: c.country,
      taxExempt: c.taxExempt, orderCount: c.orderCount, tags: c.tags, source: c.source,
      billingAddress: { line1: c.line1 ?? '', line2: c.line2 ?? '', city: c.city ?? '', region: c.region ?? '', postalCode: c.postalCode ?? '', country: c.country, lat: c.lat ?? undefined, lng: c.lng ?? undefined },
      addresses: c.addresses.map((a) => ({ id: a.id, label: a.label, kind: a.kind, address: { line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '', region: a.region ?? '', postalCode: a.postalCode ?? '', country: a.country, lat: a.lat ?? undefined, lng: a.lng ?? undefined } })),
    };
    const list = cr.ok ? (cr.data ?? []).map((x) => ({ id: x.id, code: x.code, kind: x.kind, label: x.label, balanceCents: x.balanceCents, validUntil: x.validUntil, reason: x.reason })) : [];
    setCredits(list);
    const firstEvent = bc.addresses.find((a) => a.kind === 'event');
    set((x) => ({
      customer: bc,
      billing: { name: bc.name, email: bc.email ?? '', phone: bc.phone ?? '', phone2: bc.phoneSecondary ?? '', address: bc.billingAddress },
      contact: x.contact.name ? x.contact : { name: bc.name, mobile: bc.phone ?? '', email: bc.email ?? '', confirmed: false },
      source: x.source || (bc.orderCount > 0 ? 'Repeat customer' : bc.source ?? ''),
      credits: Object.fromEntries(list.map((k) => [k.id, { on: false, amount: (k.balanceCents / 100).toFixed(2) }])),
      ...(x.lines.length === 0 || !x.eventAddress.line1
        ? firstEvent
          ? { addressChoice: `saved:${firstEvent.id}`, eventAddress: firstEvent.address }
          : bc.billingAddress.line1 ? { addressChoice: 'billing', eventAddress: bc.billingAddress } : {}
        : {}),
    }));
  }, [data.slug, meta.id, set, toast]);

  // --- items ---
  const addProduct = useCallback((p: BuilderProduct) => {
    if (readOnly) return;
    const a = avail[p.id];
    const inOrder = d.lines.filter((l) => l.productId === p.id).reduce((n, l) => n + l.quantity, 0);
    if (a && !a.overbook && p.tracking !== 'none' && a.free - inOrder <= 0) {
      setShake((n) => n + 1);
      toast(`Refused · ${p.name}: ${a.held} of ${a.owned} already reserved for this time`, 'error');
      return;
    }
    const existing = d.lines.find((l) => l.productId === p.id && !l.price);
    if (existing) setLine(existing.key, { quantity: existing.quantity + 1 });
    else set((x) => ({ lines: [...x.lines, newLine(p, p.pricing.priceStaffedCents > 0 ? 'staffed' : p.pricing.priceDropoffCents ? 'dropoff' : 'pickup')] }));
  }, [avail, d.lines, readOnly, set, setLine, toast]);

  // --- save / quote / book ---
  const markRefused = (message: string) => {
    if (!message.startsWith('Refused')) return;
    const keys = d.lines.filter((l) => l.name && message.includes(`${l.name}:`)).map((l) => l.key);
    setRefused(new Set(keys));
  };

  /** Save quietly; returns the saved order, or null with the error shown. */
  const persist = async (): Promise<{ id: string; version: number; number: string; overpaidCents: number } | null> => {
    setError(null);
    if (!d.customer) {
      setError('Choose a customer first.');
      document.getElementById('sec-customer')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    if (booked && short.size) {
      setError('Some items are not free at the new time. Change the time or the quantities first.');
      return null;
    }
    const r = await saveOrderAction(data.slug, meta.id, toOrderInput(d, { ...data, credits }), meta.id ? meta.version : undefined);
    if (!r.ok) {
      const fe = r.fieldErrors ? Object.values(r.fieldErrors)[0] : null;
      setError(fe ? `${r.error} ${fe}` : r.error);
      markRefused(r.error);
      return null;
    }
    setRefused(new Set());
    const o = r.data!;
    setMeta((m) => ({ ...m, id: o.id, number: o.number, version: o.version, status: o.status as OrderStatus }));
    setSaved(snap(d));
    setSavedDraft(d);
    if (d.saveAddress && d.customer && d.addressChoice === 'other' && d.eventAddress.line1) {
      await saveCustomerAddressAction(data.slug, d.customer.id, null, { label: d.eventLocationName || d.eventAddress.line1, kind: 'event', address: d.eventAddress });
      set({ saveAddress: false });
    }
    return { id: o.id, version: o.version, number: o.number, overpaidCents: o.overpaidCents };
  };

  async function save() {
    setBusy('save');
    const wasNew = !meta.id;
    const r = await persist();
    setBusy(null);
    if (!r) return;
    toast(wasNew ? `${r.number} saved as a draft.` : `Saved as version ${r.version}${booked ? ' · availability re-checked' : ''}.`);
    if (wasNew) router.replace(`/${data.slug}/orders/${r.id}`);
    else if (r.overpaidCents > 0) setOverpaid(r.overpaidCents); // refresh once they choose (a refresh remounts the editor)
    else router.refresh();
  }

  async function sendQuote() {
    setBusy('quote');
    const wasNew = !meta.id;
    const r = dirty || !meta.id ? await persist() : { id: meta.id, version: meta.version, number: meta.number, overpaidCents: 0 };
    if (!r) return setBusy(null);
    const t = await transitionOrderAction(data.slug, r.id, 'send_quote');
    setBusy(null);
    if (!t.ok) return setError(t.error);
    setMeta((m) => ({ ...m, status: 'quote_sent', version: t.data!.version }));
    toast(t.message ?? 'Quote sent.');
    if (wasNew) router.replace(`/${data.slug}/orders/${r.id}`);
    else router.refresh();
  }

  async function confirmBooking(c: BookChoice): Promise<{ ok: true; number: string } | { ok: false; error: string }> {
    const wasNew = !meta.id;
    const r = dirty || !meta.id ? await persist() : { id: meta.id!, version: meta.version, number: meta.number, overpaidCents: 0 };
    if (!r) return { ok: false, error: error ?? 'Fix the order and try again.' };
    const booking = c.method === 'manual'
      ? { method: 'manual', payMethod: c.payMethod, amount: c.amount, tip: c.tip || 0, reference: c.reference || undefined, receipt: c.receipt, policies: c.policies }
      : { method: 'none', reason: c.reason, expectedOn: c.expectedOn, notes: c.notes || undefined, policies: c.policies };
    const t = await transitionOrderAction(data.slug, r.id, 'book', { booking });
    if (!t.ok) {
      markRefused(t.error);
      if (wasNew) navAfterBook.current = `/${data.slug}/orders/${r.id}`;
      return { ok: false, error: t.error };
    }
    setMeta((m) => ({ ...m, status: 'booked', version: t.data!.version, paidCents: m.paidCents + (c.method === 'manual' ? Math.round(parseFloat(c.amount) * 100) : 0) }));
    if (wasNew) navAfterBook.current = `/${data.slug}/orders/${r.id}`;
    return { ok: true, number: r.number };
  }
  function closeBook() {
    setBookOpen(false);
    if (navAfterBook.current) {
      router.replace(navAfterBook.current);
      navAfterBook.current = null;
    } else router.refresh();
  }

  async function cancelOrder(reason: string) {
    if (!meta.id) return;
    const t = await transitionOrderAction(data.slug, meta.id, 'cancel', { reason });
    setCancelOpen(false);
    if (!t.ok) return toast(t.error, 'error');
    setMeta((m) => ({ ...m, status: 'cancelled', version: t.data!.version }));
    toast(t.message ?? 'Cancelled.');
    router.refresh();
  }
  async function reopen() {
    if (!meta.id) return;
    const t = await transitionOrderAction(data.slug, meta.id, 'reopen');
    if (!t.ok) return toast(t.error, 'error');
    setMeta((m) => ({ ...m, status: 'draft', version: t.data!.version }));
    toast(t.message ?? 'Reopened.');
    router.refresh();
  }
  async function resolveOver(choice: 'refund' | 'wallet' | 'keep') {
    setOverpaid(0);
    if (meta.id && choice !== 'keep') {
      const r = await resolveOverpaymentAction(data.slug, meta.id, choice);
      toast(r.ok ? (r.message ?? 'Done.') : r.error, r.ok ? 'ok' : 'error');
    }
    router.refresh();
  }

  // --- labels ---
  const tz = priced.tz;
  const windowLabel = formatEventTime(priced.startsAt, priced.endsAt, tz);
  const bufferLabel = timeLabel(addMinutes(d.start, d.durationMin + data.booking.cleanupMinutes));
  const st = ORDER_STATUS[status];
  const canBook = !booked && !cancelled && !readOnly;
  // Odoo POS "Still required to continue": the server checks the same list when booking.
  const missing = bookingRequirements({
    billing: { name: d.billing.name || d.customer?.name, email: d.billing.email, phone: d.billing.phone, address: d.billing.address },
    eventStreet: d.eventAddress.line1, contactName: d.contact.name, contactMobile: d.contact.mobile, contactConfirmed: d.contact.confirmed,
  });
  const bookBlocked = d.lines.length === 0 || short.size > 0 || missing.length > 0;
  const balance = s.totalCents - meta.paidCents;

  const actions = (
    <div className="flex flex-col gap-2">
      {error && <Notice kind="danger">{error}</Notice>}
      {canBook && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={save} pending={busy === 'save'} disabled={!!meta.id && !dirty}>{meta.id && !dirty ? 'Saved' : 'Save draft'}</Button>
            <Button variant="secondary" size="lg" onClick={sendQuote} pending={busy === 'quote'} disabled={d.lines.length === 0}>{status === 'quote_sent' ? 'Resend quote' : 'Send quote'}</Button>
          </div>
          <Button size="lg" className="w-full text-[15px]" disabled={bookBlocked} onClick={() => { setError(null); setBookOpen(true); }}>Book order →</Button>
          {d.lines.length > 0 && missing.length > 0 ? (
            <div role="status" className="rounded-[var(--radius-card)] border border-warning-mark/40 bg-warning-bg p-3 text-[13px] text-warning-fg">
              <p className="font-semibold">Still required to book:</p>
              <ul className="mt-1 list-disc pl-5">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              <p className="mt-1.5 text-[12px] opacity-80">You can still save a draft or send the quote.</p>
            </div>
          ) : (
            <p className="text-center text-[12px] text-fg-2">
              {short.size ? 'Some lines are not free for this time.' : 'Booking re-checks availability inside the database, so two people can’t book the last unit at once.'}
            </p>
          )}
        </>
      )}
      {booked && !readOnly && (
        <>
          <Button size="lg" className="w-full" onClick={save} pending={busy === 'save'} disabled={!dirty || short.size > 0}>{dirty ? 'Save changes' : 'All changes saved'}</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={!dirty} onClick={() => { setD(savedDraft); setError(null); }}>Discard changes</Button>
            <Button variant="danger-ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>
          </div>
          {data.perms.recordPayment && balance > 0 && <Button variant="secondary" onClick={() => setPayOpen(true)}>Record a payment · {money(balance)} due</Button>}
          <p className="text-center text-[12px] text-fg-2">Booked orders stay fully editable. Each save re-checks availability, re-prices the order and is recorded in the history.</p>
        </>
      )}
      {!booked && meta.id && !cancelled && !readOnly && <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel order</Button>}
      {cancelled && data.perms.create && !data.readOnly && <Button variant="secondary" onClick={reopen}>Reopen as a draft</Button>}
    </div>
  );

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Orders', href: `/${data.slug}/orders` }, { label: meta.id ? meta.number : 'New order' }]}
        actions={
          <div className="flex items-center gap-2">
            {meta.id && <span className="mono hidden whitespace-nowrap rounded-md border border-subtle px-2 py-1 text-xs text-fg-2 xl:inline">{meta.number}</span>}
            <Pill tone={(st?.tone ?? 'neutral') as 'neutral'}>{st?.label ?? status}</Pill>
            {meta.version > 0 && <span className="mono hidden text-xs text-fg-2 sm:inline">v{meta.version}</span>}
            {dirty && meta.id && <span className="hidden items-center gap-1.5 text-xs font-semibold text-warning-fg lg:flex"><span className="anim-blink size-1.5 rounded-full bg-warning-mark" />Unsaved changes</span>}
            {data.locations.length > 1 && (
              <Select aria-label="Location" value={d.locationId} disabled={readOnly} onChange={(e) => set({ locationId: e.target.value, depotId: null })} className="h-9 w-36 max-sm:w-28">
                {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}{l.paused ? ' (paused)' : ''}</option>)}
              </Select>
            )}
          </div>
        }
      />
      <PageBody wide className="pb-32 lg:pb-16">
        {cancelled && <Notice kind="danger" className="mb-4">Cancelled{data.order?.cancelReason ? `: ${data.order.cancelReason}` : ''}. Reopen it to make changes.</Notice>}
        {booked && data.order?.unpaidReason && meta.paidCents === 0 && (
          <Notice kind="warning" className="mb-4">Booked without payment · {data.order.unpaidReason}{data.order.expectedPaymentOn ? ` · expected ${data.order.expectedPaymentOn}` : ''}{data.order.followUpNotes ? ` · ${data.order.followUpNotes}` : ''}</Notice>
        )}
        {loc?.paused && !booked && <Notice kind="warning" className="mb-4">{loc.name} is paused for new orders. You can still save drafts.</Notice>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
            <CustomerSection data={data} d={d} set={set} onPick={pickCustomer} onNew={() => setNewCustomer(true)} loading={custLoading} readOnly={readOnly} />
            <EventSection data={data} d={d} set={set} cleanupMinutes={data.booking.cleanupMinutes} travelTrace={priced.travel.trace} milesBusy={milesBusy}
              onRecomputeMiles={() => computeMiles(true)} unit={loc?.rules.unit ?? 'mi'} />
            <ItemsSection data={data} d={d} avail={avail} availLoading={availLoading} windowLabel={windowLabel} onAdd={addProduct} shake={shake} money={money} />
            <LinesSection data={data} d={d} quoted={priced.quote.lines} refused={refused} short={short} setLine={setLine}
              removeLine={(k) => set((x) => ({ lines: x.lines.filter((l) => l.key !== k) }))} addCustom={() => set((x) => ({ lines: [...x.lines, newLine(null)] }))}
              canOverride={data.perms.overridePrice} money={money} />
            <NotesSection d={d} set={set} slug={data.slug} />
          </fieldset>

          <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
            <SummaryPanel d={d} set={set} s={s} money={money} travel={priced.travel} taxPercent={priced.taxPercent} credits={credits}
              totalBeforeCredits={priced.totalBeforeCredits} couponMsg={couponMsg} onApplyCoupon={applyCoupon} canOverrideTax={data.perms.overrideTax}
              exempt={!!d.customer?.taxExempt} paidCents={meta.paidCents} readOnly={readOnly} />
            <div className="hidden lg:block">{actions}</div>
          </aside>
        </div>

        <div className="mt-6 lg:hidden">{actions}</div>

        {data.order && meta.id && (
          <div className="mt-8">
            <OrderHistory slug={data.slug} order={data.order} money={money} tz={tz} locationName={(id) => locationOf(data, id)?.name ?? id} customerName={d.customer?.name ?? ''} />
          </div>
        )}
      </PageBody>

      {/* Phones: the total and the main action stay in reach. */}
      {!readOnly && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-night px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 text-white lg:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-white/60">{booked ? (dirty ? 'Unsaved changes' : 'Total') : `Deposit ${money(s.depositCents)}`}</p>
              <p className="mono text-xl font-bold">{money(s.totalCents)}</p>
            </div>
            {booked ? (
              <Button variant="volt" onClick={save} pending={busy === 'save'} disabled={!dirty || short.size > 0}>{dirty ? 'Save changes' : 'Saved'}</Button>
            ) : (
              <>
                <Button variant="ghost" className="text-white hover:bg-white/10" onClick={save} pending={busy === 'save'} disabled={!!meta.id && !dirty}>Save</Button>
                <Button variant="volt" disabled={bookBlocked} onClick={() => { setError(null); setBookOpen(true); }}>Book</Button>
              </>
            )}
          </div>
        </div>
      )}

      {booked && !readOnly && (
        <div className="hidden lg:block">
          <SaveBar dirty={dirty} pending={busy === 'save'} onSave={save} onDiscard={() => setD(savedDraft)} label="Save changes" />
        </div>
      )}

      <BookModal
        open={bookOpen}
        onClose={closeBook}
        depositLabel={money(s.depositCents)}
        depositCents={s.depositCents}
        totalCents={s.totalCents}
        totalLabel={money(s.totalCents)}
        tipBaseCents={s.merchandiseCents}
        money={money}
        policies={data.policies}
        signedOnline={data.signedOnline}
        bufferLabel={bufferLabel}
        number={meta.number}
        onConfirm={confirmBooking}
        calendarHref={`/${data.slug}/calendar?date=${d.date}&loc=${d.locationId}`}
        canRecordPayment={data.perms.recordPayment}
        booked={false}
      />
      <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} onConfirm={cancelOrder} number={meta.number} booked={booked} />
      <OverpaidModal open={overpaid > 0} amountLabel={money(overpaid)} onChoose={resolveOver} canRefund={data.perms.refund} />
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        balanceCents={balance}
        onSave={async (p) => {
          if (!meta.id) return 'Save the order first.';
          const r = await recordPaymentAction(data.slug, meta.id, p);
          if (!r.ok) return r.error;
          toast(r.message ?? 'Recorded.');
          setPayOpen(false);
          setMeta((m) => ({ ...m, paidCents: m.paidCents + Math.round(parseFloat(p.amount) * 100) }));
          router.refresh();
          return null;
        }}
      />
      <CustomerFormDrawer
        open={newCustomer}
        onClose={() => setNewCustomer(false)}
        slug={data.slug}
        country={data.country}
        editing={null}
        onSaved={(c) => { setNewCustomer(false); pickCustomer(c.id); }}
      />
      <div className={cx('sr-only')} aria-live="polite">{availLoading ? 'Checking availability' : ''}</div>
    </>
  );
}
