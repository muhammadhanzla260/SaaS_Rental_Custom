'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, Ban, CalendarCheck2, CalendarClock, Check, CheckCircle2, ClipboardList, Plus, RotateCcw, Search, Send,
  Trash2, Truck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  EVENT_TYPES, eventWindow, formatEventTime, formatPhone, ORDER_STATUS, ORDER_TRANSITIONS, quoteOrder, serviceArea, toCents,
  type OrderStatus, type ProductPricing, type ServiceMode,
} from '@rental/core';
import { AddressFields, PhoneField, scope, scopeChild } from '@/components/fields';
import { MoneyInput, Stepper, useMoneyFormat } from '@/components/money';
import { Badge, Button, Card, cx, Field, Input, Notice, Segmented, Select, Textarea, Toggle } from '@/components/ui';
import { useForm } from '@/lib/form';
import {
  availabilityAction, getCustomerAction, saveOrderAction, transitionOrderAction, travelForOrderAction, type CustomerHit,
} from '@/server/actions/commerce';
import { CustomerPicker } from './customer-picker';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type BuilderProduct = {
  id: string; name: string; categoryId: string | null; imageUrl: string | null; kind: string; minHours: number | null; pricing: ProductPricing;
};
export type BuilderLocation = { id: string; name: string; code: string; timezone: string; taxPercent: number; lat: number | null; lng: number | null; isPrimary: boolean };
export type BuilderPrefs = {
  depositPercent: number; damageWaiverPercent: number; damageWaiverDefaultOn: boolean; serviceRadius: number;
  distanceUnit: 'mi' | 'km'; setupSurfaces: { code: string; label: string; feeCents: number }[];
};
type Availability = Record<string, { owned: number; held: number; free: number }>;

const MODE_LABEL: Record<ServiceMode, string> = { staffed: 'Staffed', pickup: 'Pick-up', dropoff: 'Drop-off' };
let lineKey = 0;
const nextKey = () => `l${++lineKey}`;

export function OrderBuilder({
  slug, orderId, number, status: initialStatus, version: initialVersion, initial, initialCustomer, products, categories, locations, prefs,
  currency, country, flash, flashError,
}: {
  slug: string; orderId: string | null; number: string | null; status: OrderStatus; version: number; initial: Obj;
  initialCustomer: CustomerHit | null; products: BuilderProduct[]; categories: { id: string; name: string }[];
  locations: BuilderLocation[]; prefs: BuilderPrefs; currency: string; country: string; flash?: string | null; flashError?: string | null;
}) {
  const router = useRouter();
  const money = useMoneyFormat(currency);
  const form = useForm<Obj>(initial);
  const v = form.values;
  useEffect(() => { if (flashError) form.setStatus({ kind: 'error', text: flashError }); else if (flash) form.setStatus({ kind: 'ok', text: flash }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [customer, setCustomer] = useState<CustomerHit | null>(initialCustomer);
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  const [version, setVersion] = useState(initialVersion);
  const [availability, setAvailability] = useState<Availability>({});
  const [travelNote, setTravelNote] = useState<string | null>(v.travelInfo?.note ?? null);
  const [travelBusy, setTravelBusy] = useState(false);
  const [busy, startBusy] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const editable = status !== 'cancelled' && status !== 'completed';

  const location = locations.find((l) => l.id === v.locationId) ?? locations[0]!;
  const tz = location.timezone;
  const window_ = useMemo(() => {
    try {
      if (!v.date || !v.startTime || !v.endTime) return null;
      const w = eventWindow({ date: v.date, startTime: v.startTime, endTime: v.endTime, multiDay: v.multiDay, endDate: v.endDate }, tz);
      return w.endsAt > w.startsAt ? w : null;
    } catch {
      return null;
    }
  }, [v.date, v.startTime, v.endTime, v.multiDay, v.endDate, tz]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const surfaceFee = useCallback((code?: string | null) => prefs.setupSurfaces.find((s) => s.code === code)?.feeCents ?? 0, [prefs.setupSurfaces]);
  const taxPercent = v.taxOverridden ? Number(v.taxPercent) || 0 : location.taxPercent;

  // Live totals from the same engine the server uses.
  const quote = useMemo(() => {
    if (!window_) return null;
    return quoteOrder({
      startsAt: window_.startsAt,
      endsAt: window_.endsAt,
      multiDay: !!v.multiDay,
      lines: (v.lines as Obj[]).filter((l) => productById.has(l.productId)).map((l) => {
        const p = productById.get(l.productId)!;
        return {
          productId: p.id, name: p.name, pricing: p.pricing, minHours: p.minHours, serviceMode: l.serviceMode, quantity: Number(l.quantity) || 1,
          flatRate: !!l.flatRate, overrideUnitCents: l.overridePrice == null ? null : toCents(l.overridePrice), setupSurfaceFeeCents: surfaceFee(l.setupSurface),
        };
      }),
      damageWaiver: { enabled: !!v.damageWaiver, percent: prefs.damageWaiverPercent },
      travelFeeCents: toCents(Number(v.travelFee) || 0),
      miscFeesCents: toCents(Number(v.miscFees) || 0),
      discount: v.discountKind !== 'none' && Number(v.discountValue) > 0 ? { kind: v.discountKind, value: Number(v.discountValue), afterTax: !!v.discountAfterTax } : null,
      couponCents: toCents(Number(v.coupon) || 0),
      taxPercent,
      deposit: { kind: v.depositKind, value: Number(v.depositValue) || 0 },
      defaultDepositPercent: prefs.depositPercent,
    });
  }, [window_, v, productById, surfaceFee, prefs, taxPercent]);

  // Availability for the chosen time and location (this order's own hold excluded).
  const availKey = window_ ? `${v.locationId}|${window_.startsAt.toISOString()}|${window_.endsAt.toISOString()}` : '';
  useEffect(() => {
    if (!window_) return;
    const t = setTimeout(async () => {
      const r = await availabilityAction(slug, { locationId: v.locationId, startsAt: window_.startsAt, endsAt: window_.endsAt, excludeOrderId: orderId });
      if (r.ok && r.data) setAvailability(r.data);
    }, 250);
    return () => clearTimeout(t);
  }, [availKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Travel fee and nearest location from the event pin (Odoo POS _applyTravelFee).
  const modesKey = (v.lines as Obj[]).map((l) => l.serviceMode).join(',');
  const pinKey = v.eventAddress?.lat != null ? `${v.eventAddress.lat},${v.eventAddress.lng}` : '';
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; if (orderId) return; }
    if (!pinKey || v.travelFeeOverridden || !editable) return;
    setTravelBusy(true);
    const t = setTimeout(async () => {
      const r = await travelForOrderAction(slug, { lat: v.eventAddress.lat, lng: v.eventAddress.lng, modes: (v.lines as Obj[]).map((l) => l.serviceMode) });
      setTravelBusy(false);
      if (!r.ok || !r.data) { setTravelNote(r.ok ? null : r.error); return; }
      const d = r.data;
      const note = d.reason === 'pickup'
        ? 'Pick-up only: no travel fee.'
        : `${d.distance.toFixed(1)} ${d.unit} ${d.isDriving ? 'driving' : 'straight-line'} from ${d.location.name}, ${d.billable.toFixed(1)} billable at ${money(toCents(d.rate))}/${d.unit}`;
      setTravelNote(note);
      form.set('travelFee', d.fee);
      form.set('travelInfo', { note, locationId: d.location.id, distance: d.distance, isDriving: d.isDriving });
      if (v.locationAuto) form.set('locationId', d.location.id);
    }, 400);
    return () => clearTimeout(t);
  }, [pinKey, modesKey, v.travelFeeOverridden]); // eslint-disable-line react-hooks/exhaustive-deps

  // Event address follows the customer's billing address when "same as billing" is on.
  const pickCustomer = async (c: CustomerHit | null) => {
    setCustomer(c);
    form.set('customerId', c?.id ?? '');
    if (!c) return;
    const r = await getCustomerAction(slug, c.id);
    const full = r.ok ? r.data : null;
    if (full) {
      form.set('billing', {
        line1: full.line1 ?? '', line2: full.line2 ?? '', city: full.city ?? '', region: full.region ?? '', postalCode: full.postalCode ?? '',
        country: full.country, lat: full.lat ?? undefined, lng: full.lng ?? undefined,
      });
      if (!v.eventContactName) form.set('eventContactName', full.displayName ?? '');
      if (!v.eventContactMobile && full.phone) form.set('eventContactMobile', formatPhone(full.phone, country));
    }
  };
  useEffect(() => {
    if (v.eventSameAsBilling && v.billing?.line1) form.set('eventAddress', { ...v.billing });
  }, [v.eventSameAsBilling, v.billing]); // eslint-disable-line react-hooks/exhaustive-deps

  const addProduct = (id: string) => {
    const lines = v.lines as Obj[];
    const existing = lines.findIndex((l) => l.productId === id && l.overridePrice == null);
    if (existing >= 0) form.set(`lines.${existing}.quantity`, Number(lines[existing]!.quantity) + 1);
    else form.set('lines', [...lines, { key: nextKey(), productId: id, serviceMode: 'staffed', quantity: 1, flatRate: false, overridePrice: null, setupSurface: v.defaultSurface || null }]);
  };
  const removeLine = (i: number) => form.set('lines', (v.lines as Obj[]).filter((_, j) => j !== i));

  const payload = () => ({
    customerId: v.customerId,
    locationId: v.locationId,
    eventType: v.eventType,
    startsAt: window_?.startsAt,
    endsAt: window_?.endsAt,
    multiDay: !!v.multiDay,
    eventSameAsBilling: !!v.eventSameAsBilling,
    eventLocationName: v.eventLocationName,
    eventAddress: v.eventAddress,
    eventContactName: v.eventContactName,
    eventContactMobile: v.eventContactMobile,
    eventContactEmail: v.eventContactEmail,
    lines: (v.lines as Obj[]).map((l) => ({ productId: l.productId, serviceMode: l.serviceMode, quantity: l.quantity, flatRate: l.flatRate, overridePrice: l.overridePrice, setupSurface: l.setupSurface })),
    damageWaiver: !!v.damageWaiver,
    travelFee: Number(v.travelFee) || 0,
    travelFeeOverridden: !!v.travelFeeOverridden,
    travelInfo: v.travelInfo ?? null,
    miscFees: Number(v.miscFees) || 0,
    discount: v.discountKind !== 'none' && Number(v.discountValue) > 0 ? { kind: v.discountKind, value: Number(v.discountValue), afterTax: !!v.discountAfterTax } : null,
    couponCode: v.couponCode,
    coupon: Number(v.coupon) || 0,
    taxPercent,
    taxOverridden: !!v.taxOverridden,
    deposit: { kind: v.depositKind, value: Number(v.depositValue) || 0 },
    source: v.source,
    internalNotes: v.internalNotes,
    customerNotes: v.customerNotes,
  });

  /** Save, then optionally move the order on (book, quote sent ...). */
  const save = (then?: 'send_quote' | 'book') =>
    startBusy(async () => {
      if (!window_) { form.setStatus({ kind: 'error', text: 'Set the event date and times first.' }); return; }
      let id = orderId;
      if (form.dirty || !id) {
        const r = await saveOrderAction(slug, id, payload(), version);
        if (!r.ok) {
          form.setErrors(r.fieldErrors ?? {});
          form.setStatus({ kind: 'error', text: r.error });
          return;
        }
        id = r.data!.id;
        setVersion(r.data!.version);
        form.setErrors({});
        form.setStatus({ kind: 'ok', text: r.message ?? 'Saved.' });
        if (!orderId && !then) { router.replace(`/${slug}/orders/${id}?done=saved`); return; }
      }
      if (then) await move(id!, then);
      else router.refresh();
    });

  const move = async (id: string, action: string, reason?: string) => {
    const r = await transitionOrderAction(slug, id, action, reason);
    if (r.ok && r.data) {
      setStatus(r.data.status as OrderStatus);
      setVersion(r.data.version);
      form.setStatus({ kind: 'ok', text: r.message ?? 'Done.' });
      if (!orderId) router.replace(`/${slug}/orders/${id}?done=${action}`);
      else router.refresh();
    } else if (!r.ok) {
      form.setStatus({ kind: 'error', text: r.error });
      if (!orderId) router.replace(`/${slug}/orders/${id}?failed=${encodeURIComponent(r.error)}`);
    }
  };

  const s = scope(form, '');
  const transitions = ORDER_TRANSITIONS[status];
  const area = useMemo(
    () => serviceArea(locations.filter((l) => l.lat != null).map((l) => ({ lat: l.lat!, lng: l.lng! })), prefs.serviceRadius, prefs.distanceUnit),
    [locations, prefs],
  );
  const conflicts = (v.lines as Obj[]).filter((l) => {
    const a = availability[l.productId];
    const sameProductQty = (v.lines as Obj[]).filter((x) => x.productId === l.productId).reduce((n, x) => n + (Number(x.quantity) || 0), 0);
    return a && sameProductQty > a.free;
  });

  return (
    <div className="flex flex-col gap-5 pb-24 lg:pb-0">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/${slug}/orders`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft aria-hidden className="size-4" /> Orders</Link>
        <div className="flex w-full flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-[28px]">{number ?? 'New order'}</h1>
          <motion.span key={status} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <Badge tone={ORDER_STATUS[status].tone}>{ORDER_STATUS[status].label}</Badge>
          </motion.span>
          {window_ && <span className="text-sm text-muted">{formatEventTime(window_.startsAt, window_.endsAt, tz)}</span>}
        </div>
      </div>

      <AnimatePresence>
        {form.status && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Notice kind={form.status.kind}>{form.status.text}</Notice>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
          {/* 1. customer */}
          <Card title="Customer">
            <CustomerPicker slug={slug} value={customer} onChange={pickCustomer} country={country} invalid={!!form.error('customerId')} />
            {form.error('customerId') && <p className="mt-2 text-sm text-danger">{form.error('customerId')}</p>}
          </Card>

          {/* 2. event */}
          <Card title="Event" description="When and where. Times are in the location's time zone.">
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label={v.multiDay ? 'Start date' : 'Date'} htmlFor="o-date" error={form.error('startsAt')} className="sm:col-span-2">
                  <Input id="o-date" type="date" value={v.date} onChange={(e) => form.set('date', e.target.value)} />
                </Field>
                <Field label="Starts" htmlFor="o-start"><Input id="o-start" type="time" step={900} value={v.startTime} onChange={(e) => form.set('startTime', e.target.value)} /></Field>
                <Field label="Ends" htmlFor="o-end" error={form.error('endsAt')}><Input id="o-end" type="time" step={900} value={v.endTime} onChange={(e) => form.set('endTime', e.target.value)} /></Field>
                {v.multiDay && (
                  <Field label="End date" htmlFor="o-enddate" className="sm:col-span-2"><Input id="o-enddate" type="date" value={v.endDate ?? ''} onChange={(e) => form.set('endDate', e.target.value)} /></Field>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Toggle id="o-multi" checked={!!v.multiDay} onChange={(x) => form.set('multiDay', x)} label="Multi-day rental" />
                {quote && <span className="text-sm text-muted"><CalendarClock aria-hidden className="mr-1 inline size-4" />Billed for {Math.round(quote.hours * 100) / 100} h{!v.multiDay && v.endTime <= v.startTime ? ' (ends after midnight)' : ''}</span>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type of event" htmlFor="o-type" optional>
                  <Select id="o-type" value={v.eventType ?? ''} onChange={(e) => form.set('eventType', e.target.value)}>
                    <option value="">Not set</option>
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </Field>
                <Field label="Venue name" htmlFor="o-venue" optional hint="Park, school, church…">
                  <Input id="o-venue" value={v.eventLocationName ?? ''} onChange={(e) => form.set('eventLocationName', e.target.value)} />
                </Field>
              </div>
              <Toggle id="o-same" checked={!!v.eventSameAsBilling} onChange={(x) => form.set('eventSameAsBilling', x)}
                label="Party is at the customer's billing address" description={v.billing?.line1 ? `${v.billing.line1}, ${v.billing.city ?? ''}` : 'Pick a customer with an address, or turn off to enter the party address.'} />
              {!v.eventSameAsBilling && (
                <AddressFields s={scopeChild(s, 'eventAddress')} near={v.billing?.lat != null ? { lat: v.billing.lat, lng: v.billing.lng } : location.lat != null ? { lat: location.lat, lng: location.lng! } : null} bbox={area?.bbox} showCoordinates />
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="On-site contact" htmlFor="o-contact" optional hint="Who runs the party.">
                  <Input id="o-contact" value={v.eventContactName ?? ''} onChange={(e) => form.set('eventContactName', e.target.value)} />
                </Field>
                <PhoneField s={s} name="eventContactMobile" label="Their mobile" country={country} />
                <Field label="Their email" htmlFor="o-cemail" optional><Input id="o-cemail" type="email" value={v.eventContactEmail ?? ''} onChange={(e) => form.set('eventContactEmail', e.target.value)} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Ships from" htmlFor="o-loc" hint={v.locationAuto ? 'Chosen automatically: nearest location by driving distance.' : 'Chosen by hand.'}>
                  <Select id="o-loc" value={v.locationId} onChange={(e) => { form.set('locationId', e.target.value); form.set('locationAuto', false); }}>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.code})</option>)}
                  </Select>
                </Field>
                <Field label="Setup surface" htmlFor="o-surface" optional hint="Applied to new items. Change per item below.">
                  <Select id="o-surface" value={v.defaultSurface ?? ''} onChange={(e) => {
                    form.set('defaultSurface', e.target.value);
                    form.set('lines', (v.lines as Obj[]).map((l) => ({ ...l, setupSurface: e.target.value || null })));
                  }}>
                    <option value="">Not set</option>
                    {prefs.setupSurfaces.map((x) => <option key={x.code} value={x.code}>{x.label}{x.feeCents ? ` (+${money(x.feeCents)} per item)` : ''}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </Card>

          {/* 3. items */}
          <Card title="Items" description={window_ ? `Availability at ${location.name} for this time.` : 'Set the date and time to see availability.'}>
            <ProductPicker products={products} categories={categories} availability={availability} money={money} onAdd={addProduct} hasWindow={!!window_} />
            <div className="mt-5 flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {(v.lines as Obj[]).map((l, i) => {
                  const p = productById.get(l.productId);
                  const q = quote?.lines[i];
                  const a = availability[l.productId];
                  if (!p) return null;
                  return (
                    <motion.div key={l.key} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12, height: 0 }}
                      className={cx('flex flex-col gap-3 rounded-ui border p-3.5', conflicts.includes(l) ? 'border-danger/50 bg-danger-soft/40' : 'border-line bg-surface')}>
                      <div className="flex items-start gap-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="size-14 shrink-0 rounded-ui-sm object-cover" />
                        ) : (
                          <span className="brand-gradient grid size-14 shrink-0 place-items-center rounded-ui-sm font-display text-xl font-bold text-brand-fg">{p.name[0]}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-snug">{p.name}</p>
                          <p className="text-sm text-muted">
                            {q ? `${money(q.unitCents)} each` : '—'}
                            {q && q.trace.extraCents > 0 && !q.overridden ? ` · incl. ${money(q.trace.extraCents)} extra time` : ''}
                            {q?.overridden ? ' · manual price' : ''}
                          </p>
                          {a && <p className={cx('text-xs font-medium', conflicts.includes(l) ? 'text-danger' : 'text-ok')}>{a.free} of {a.owned} free then</p>}
                        </div>
                        <span className="font-display text-lg font-bold tabular">{q ? money(q.lineTotalCents) : ''}</span>
                        <button type="button" aria-label={`Remove ${p.name}`} onClick={() => removeLine(i)} className="grid size-9 shrink-0 place-items-center rounded-ui-sm text-muted hover:bg-danger-soft hover:text-danger"><Trash2 aria-hidden className="size-4" /></button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <Segmented id={`line-mode-${l.key}`} label="Service" value={l.serviceMode} onChange={(m) => form.set(`lines.${i}.serviceMode`, m)}
                          options={(['staffed', 'pickup', 'dropoff'] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
                        <Stepper id={`line-qty-${l.key}`} label={`quantity of ${p.name}`} min={1} value={Number(l.quantity)} onChange={(n) => form.set(`lines.${i}.quantity`, n)} />
                        <Select aria-label={`Setup surface for ${p.name}`} value={l.setupSurface ?? ''} onChange={(e) => form.set(`lines.${i}.setupSurface`, e.target.value || null)} className="w-auto min-w-40">
                          <option value="">Surface: not set</option>
                          {prefs.setupSurfaces.map((x) => <option key={x.code} value={x.code}>{x.label}{x.feeCents ? ` +${money(x.feeCents)}` : ''}</option>)}
                        </Select>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <div className="flex items-center gap-2">
                          <label htmlFor={`line-price-${l.key}`} className="text-muted">Price each</label>
                          <MoneyInput id={`line-price-${l.key}`} currency={currency} className="w-32" value={l.overridePrice ?? (q ? q.autoUnitCents / 100 : null)}
                            onChange={(n) => form.set(`lines.${i}.overridePrice`, n == null || (q && toCents(n) === q.autoUnitCents) ? null : n)} />
                          {l.overridePrice != null && (
                            <button type="button" onClick={() => form.set(`lines.${i}.overridePrice`, null)} className="inline-flex items-center gap-1 font-medium text-brand-text underline">
                              <RotateCcw aria-hidden className="size-3.5" /> Auto {q ? money(q.autoUnitCents) : ''}
                            </button>
                          )}
                        </div>
                        <label className="inline-flex items-center gap-2">
                          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={!!l.flatRate} onChange={(e) => form.set(`lines.${i}.flatRate`, e.target.checked)} />
                          Flat rate (no extra-time charge)
                        </label>
                      </div>
                      {q?.warnings.map((w) => <p key={w} className="flex items-center gap-1.5 text-sm text-warn"><AlertTriangle aria-hidden className="size-4" />{w}</p>)}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {(v.lines as Obj[]).length === 0 && (
                <p className="rounded-ui border border-dashed border-line-strong p-6 text-center text-muted"><ClipboardList aria-hidden className="mx-auto mb-2 size-6" />Tap a product above to add it.</p>
              )}
              {form.error('lines') && <p className="text-sm text-danger">{form.error('lines')}</p>}
            </div>
          </Card>

          {/* 4. notes */}
          <Card title="Notes">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="For the customer" htmlFor="o-cnotes" optional hint="Shown on the quote.">
                <Textarea id="o-cnotes" value={v.customerNotes ?? ''} onChange={(e) => form.set('customerNotes', e.target.value)} />
              </Field>
              <Field label="Internal" htmlFor="o-inotes" optional hint="Only your team sees these.">
                <Textarea id="o-inotes" value={v.internalNotes ?? ''} onChange={(e) => form.set('internalNotes', e.target.value)} />
              </Field>
            </div>
          </Card>
        </fieldset>

        {/* summary */}
        <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Order summary">
          <fieldset disabled={!editable} className="flex flex-col gap-4 rounded-[calc(var(--radius)*1.4)] border border-line bg-surface p-5 shadow-pop">
            <h2 className="text-lg font-semibold">Summary</h2>
            <dl className="flex flex-col gap-2 text-[15px]">
              <Row label="Items" cents={quote?.summary.merchandiseCents} money={money} />
              <div className="flex items-center justify-between gap-2">
                <Toggle id="o-waiver" checked={!!v.damageWaiver} onChange={(x) => form.set('damageWaiver', x)} label={`Damage waiver ${prefs.damageWaiverPercent}%`} />
                <Amount cents={quote?.summary.damageWaiverCents} money={money} />
              </div>
              {(quote?.summary.setupSurfaceCents ?? 0) > 0 && <Row label="Setup surface" cents={quote?.summary.setupSurfaceCents} money={money} />}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><Truck aria-hidden className="size-4 text-muted" />Travel fee {travelBusy && <span className="text-xs text-muted">working…</span>}</span>
                  <MoneyInput id="o-travel" currency={currency} className="w-32" value={Number(v.travelFee) || 0}
                    onChange={(n) => { form.set('travelFee', n ?? 0); form.set('travelFeeOverridden', true); }} ariaLabel="Travel fee" />
                </div>
                <p className="text-xs text-muted">
                  {v.travelFeeOverridden ? (
                    <>Set by hand. <button type="button" className="font-medium text-brand-text underline" onClick={() => form.set('travelFeeOverridden', false)}>Calculate again</button></>
                  ) : travelNote ?? (pinKey ? 'Calculating from the party address…' : 'Pin the party address to calculate.')}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="o-misc">Other fees</label>
                <MoneyInput id="o-misc" currency={currency} className="w-32" value={Number(v.miscFees) || 0} onChange={(n) => form.set('miscFees', n ?? 0)} />
              </div>
              <div className="flex flex-col gap-2 rounded-ui-sm bg-surface-2/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Discount</span>
                  <Segmented id="o-dkind" label="Discount type" value={v.discountKind} onChange={(k) => form.set('discountKind', k)}
                    options={[{ value: 'none', label: 'None' }, { value: 'percent', label: '%' }, { value: 'amount', label: '$' }]} />
                </div>
                {v.discountKind !== 'none' && (
                  <>
                    <MoneyInput id="o-dval" currency={v.discountKind === 'amount' ? currency : undefined} suffix={v.discountKind === 'percent' ? '% of items' : undefined}
                      value={Number(v.discountValue) || null} onChange={(n) => form.set('discountValue', n ?? 0)} invalid={!!form.error('discount')} ariaLabel="Discount" />
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={!!v.discountAfterTax} onChange={(e) => form.set('discountAfterTax', e.target.checked)} />
                      Raincheck credit (after tax)
                    </label>
                    {form.error('discount') && <p className="text-sm text-danger">{form.error('discount')}</p>}
                  </>
                )}
                <div className="flex items-center gap-2">
                  <Input aria-label="Coupon code" placeholder="Coupon code" value={v.couponCode ?? ''} onChange={(e) => form.set('couponCode', e.target.value)} className="min-w-0 flex-1 uppercase" />
                  <MoneyInput id="o-coupon" currency={currency} className="w-28" value={Number(v.coupon) || null} onChange={(n) => form.set('coupon', n ?? 0)} ariaLabel="Coupon amount" />
                </div>
              </div>
              {(quote?.summary.preTaxDiscountCents ?? 0) + (quote?.summary.couponCents ?? 0) > 0 && (
                <Row label="Discounts" cents={-((quote?.summary.preTaxDiscountCents ?? 0) + (quote?.summary.couponCents ?? 0))} money={money} />
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  Tax
                  <MoneyInput id="o-tax" className="w-24" suffix="%" value={taxPercent} onChange={(n) => { form.set('taxPercent', n ?? 0); form.set('taxOverridden', true); }} ariaLabel="Tax percent" />
                  {v.taxOverridden && <button type="button" className="text-xs font-medium text-brand-text underline" onClick={() => form.set('taxOverridden', false)}>Use {location.taxPercent}%</button>}
                </span>
                <Amount cents={quote?.summary.taxCents} money={money} />
              </div>
              {taxPercent === 0 && !v.taxOverridden && (
                <p className="-mt-1 text-xs text-warn">No sales tax is set for {location.name}. Set it in Settings, Locations.</p>
              )}
              {(quote?.summary.postTaxDiscountCents ?? 0) > 0 && <Row label="Raincheck" cents={-(quote?.summary.postTaxDiscountCents ?? 0)} money={money} />}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
                <dt className="text-lg font-semibold">Total</dt>
                <dd className="font-display text-3xl font-bold text-brand-text"><Amount cents={quote?.summary.totalCents} money={money} /></dd>
              </div>
              <div className="flex flex-col gap-2 rounded-ui-sm bg-brand-soft/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Deposit to book</span>
                  <Segmented id="o-depkind" label="Deposit type" value={v.depositKind} onChange={(k) => form.set('depositKind', k)} options={[{ value: 'percent', label: '%' }, { value: 'amount', label: '$' }]} />
                </div>
                <MoneyInput id="o-dep" currency={v.depositKind === 'amount' ? currency : undefined} suffix={v.depositKind === 'percent' ? '%' : undefined} value={Number(v.depositValue) || null} onChange={(n) => form.set('depositValue', n ?? 0)} ariaLabel="Deposit" />
                <div className="flex justify-between text-sm"><span>Due now</span><strong className="tabular"><Amount cents={quote?.summary.depositCents} money={money} /></strong></div>
                <div className="flex justify-between text-sm text-muted"><span>Balance on event day</span><span className="tabular"><Amount cents={quote ? quote.summary.totalCents - quote.summary.depositCents : undefined} money={money} /></span></div>
              </div>
            </dl>
            {conflicts.length > 0 && <Notice kind="warn">{conflicts.length === 1 ? 'An item is' : 'Some items are'} already booked for this time. Booking will be refused until you change the time, quantity or location.</Notice>}
          </fieldset>

          {/* actions */}
          <div className="mt-4 hidden flex-col gap-2 lg:flex">
            <Actions {...{ status, editable, busy, dirty: form.dirty || !orderId, transitions, save, cancelling, setCancelling, cancelReason, setCancelReason, orderId, move, startBusy }} />
          </div>
        </aside>
      </div>

      {/* phone: sticky total + main action */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Total</p>
          <p className="font-display text-xl font-bold text-brand-text"><Amount cents={quote?.summary.totalCents} money={money} /></p>
        </div>
        <Actions compact {...{ status, editable, busy, dirty: form.dirty || !orderId, transitions, save, cancelling, setCancelling, cancelReason, setCancelReason, orderId, move, startBusy }} />
      </div>
    </div>
  );
}

function Amount({ cents, money }: { cents?: number; money: (c: number) => string }) {
  if (cents == null) return <span className="text-muted">—</span>;
  return (
    <motion.span key={cents} initial={{ opacity: 0.4, y: -3 }} animate={{ opacity: 1, y: 0 }} className="tabular">
      {money(cents)}
    </motion.span>
  );
}

function Row({ label, cents, money }: { label: string; cents?: number; money: (c: number) => string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt>{label}</dt>
      <dd><Amount cents={cents} money={money} /></dd>
    </div>
  );
}

function Actions({
  compact, status, editable, busy, dirty, transitions, save, cancelling, setCancelling, cancelReason, setCancelReason, orderId, move, startBusy,
}: {
  compact?: boolean; status: OrderStatus; editable: boolean; busy: boolean; dirty: boolean;
  transitions: (typeof ORDER_TRANSITIONS)[OrderStatus]; save: (then?: 'send_quote' | 'book') => void;
  cancelling: boolean; setCancelling: (b: boolean) => void; cancelReason: string; setCancelReason: (s: string) => void;
  orderId: string | null; move: (id: string, action: string, reason?: string) => Promise<void>; startBusy: (fn: () => Promise<void>) => void;
}) {
  const can = (a: string) => transitions.some((t) => t.action === a);
  if (compact) {
    if (can('book')) return <Button type="button" pending={busy} onClick={() => save('book')}><CalendarCheck2 aria-hidden className="size-4" /> Book</Button>;
    if (editable && dirty) return <Button type="button" pending={busy} onClick={() => save()}>Save</Button>;
    if (can('complete')) return <Button type="button" pending={busy} onClick={() => orderId && startBusy(() => move(orderId, 'complete'))}><CheckCircle2 aria-hidden className="size-4" /> Complete</Button>;
    if (can('reopen')) return <Button type="button" variant="secondary" pending={busy} onClick={() => orderId && startBusy(() => move(orderId, 'reopen'))}>Reopen</Button>;
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {can('book') && (
        <Button type="button" pending={busy} onClick={() => save('book')} className="min-h-12 text-base">
          <CalendarCheck2 aria-hidden className="size-5" /> {dirty ? 'Save and book' : 'Book'}
        </Button>
      )}
      {editable && dirty && (
        <Button type="button" variant="secondary" pending={busy} onClick={() => save()}>
          <Check aria-hidden className="size-4" /> {orderId ? 'Save changes' : 'Save as draft'}
        </Button>
      )}
      {can('send_quote') && (
        <Button type="button" variant="secondary" pending={busy} onClick={() => save('send_quote')}>
          <Send aria-hidden className="size-4" /> Mark quote sent
        </Button>
      )}
      {can('complete') && (
        <Button type="button" pending={busy} onClick={() => orderId && startBusy(() => move(orderId, 'complete'))}><CheckCircle2 aria-hidden className="size-4" /> Mark completed</Button>
      )}
      {can('reopen') && (
        <Button type="button" variant="secondary" pending={busy} onClick={() => orderId && startBusy(() => move(orderId, 'reopen'))}><RotateCcw aria-hidden className="size-4" /> Reopen as draft</Button>
      )}
      {can('cancel') && orderId && (
        cancelling ? (
          <div className="flex flex-col gap-2 rounded-ui-sm border border-danger/40 p-3">
            <label htmlFor="cancel-reason" className="text-sm font-medium">Why is it cancelled?</label>
            <Input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Weather, customer changed plans…" />
            <div className="flex gap-2">
              <Button type="button" variant="danger" size="sm" pending={busy} onClick={() => startBusy(() => move(orderId, 'cancel', cancelReason))}><Ban aria-hidden className="size-4" /> Cancel order</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(false)}>Keep it</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setCancelling(true)}><Ban aria-hidden className="size-4" /> Cancel order…</Button>
        )
      )}
      {status === 'cancelled' && <p className="text-center text-sm text-muted">Cancelled orders cannot be edited. Reopen to change it.</p>}
    </div>
  );
}

function ProductPicker({
  products, categories, availability, money, onAdd, hasWindow,
}: {
  products: BuilderProduct[]; categories: { id: string; name: string }[]; availability: Availability; money: (c: number) => string; onAdd: (id: string) => void; hasWindow: boolean;
}) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [flash, setFlash] = useState<string | null>(null);
  const shown = products.filter((p) => (cat === 'all' || p.categoryId === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="Search products" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {[{ id: 'all', name: 'All' }, ...categories].map((c) => (
            <button key={c.id} type="button" onClick={() => setCat(c.id)}
              className={cx('shrink-0 rounded-full px-3 py-1.5 text-sm font-medium', cat === c.id ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-muted hover:text-ink')}>{c.name}</button>
          ))}
        </div>
      </div>
      {products.length === 0 ? (
        <Notice kind="info">Your catalog is empty. Add products in Catalog first.</Notice>
      ) : (
        <ul className="grid max-h-[340px] grid-cols-2 gap-2 overflow-y-auto p-0.5 sm:grid-cols-3">
          {shown.map((p) => {
            const a = availability[p.id];
            const full = hasWindow && a && a.free <= 0;
            return (
              <li key={p.id}>
                <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={() => { onAdd(p.id); setFlash(p.id); setTimeout(() => setFlash(null), 600); }}
                  className={cx('relative flex w-full items-center gap-2.5 rounded-ui-sm border p-2 text-left transition-colors', full ? 'border-line bg-surface-2 opacity-70' : 'border-line bg-surface hover:border-brand')}>
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt="" className="size-11 shrink-0 rounded object-cover" />
                  ) : (
                    <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded font-bold text-brand-fg">{p.name[0]}</span>
                  )}
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</span>
                    <span className="block text-xs text-muted tabular">{money(p.pricing.priceStaffedCents)}</span>
                    {hasWindow && a && (
                      <span className={cx('block text-[11px] font-semibold', full ? 'text-danger' : 'text-ok')}>{full ? 'Booked then' : `${a.free} free`}</span>
                    )}
                  </span>
                  <AnimatePresence>
                    {flash === p.id && (
                      <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-ok text-white"><Plus aria-hidden className="size-4" /></motion.span>
                    )}
                  </AnimatePresence>
                </motion.button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

