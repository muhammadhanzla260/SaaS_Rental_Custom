'use client';

import Link from 'next/link';
import { FileText, Lock, MapPin, Minus, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  addDays, EVENT_TYPES, extraRateOf, formatMoney, formatPhone, HOW_HEARD, SERVICE_MODES, type QuotedLine, type ServiceMode,
} from '@rental/core';
import type { Availability } from '@rental/db';
import { CustomerSearch } from '@/components/customers/customer-form';
import { initialsOf } from '@/components/customers/customer-profile';
import { ProductArt } from '@/components/catalog/product-art';
import { AddressBlock } from '@/components/fields/address';
import { scope } from '@/components/fields/scope';
import { AffixInput, Button, Card, Checkbox, cx, Field, FilterChips, Input, Notice, Select, Textarea, Toggle, useToast } from '@/components/kit';
import { uploadSetupMapAction } from '@/server/actions/commerce';
import { addMinutes, durationLabel, locationOf, lockedFor, num, timeLabel } from './draft';
import type { BuilderData, BuilderProduct, Draft, DraftLine } from './types';

type SetDraft = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => void;

export function Section({ title, action, children, className, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <Card className={cx('p-5 sm:p-6', className)} as="section" aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id={id ? `${id}-h` : undefined} className="text-lg font-semibold text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

// --- Customer -------------------------------------------------------------------------------------

export function CustomerSection({
  data, d, set, onPick, onNew, loading, readOnly,
}: { data: BuilderData; d: Draft; set: SetDraft; onPick: (id: string) => void; onNew: () => void; loading: boolean; readOnly: boolean }) {
  const [billingOpen, setBillingOpen] = useState(false);
  const [changing, setChanging] = useState(!d.customer);
  const c = d.customer;
  const billingScope = scope({ values: d, set: (p, v) => set((x) => setPath(x, p, v)), error: () => undefined }, 'billing.address');
  return (
    <Section
      title="Customer"
      id="sec-customer"
      action={c && <Link href={`/${data.slug}/customers?id=${c.id}`} className="text-[13px] font-semibold text-accent-text hover:underline" target="_blank">Open profile</Link>}
    >
      {c && !changing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-sunken/70 p-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#E6ECFF] text-sm font-bold text-[#233FB8]" aria-hidden>{initialsOf(c.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-fg">{c.name}</span>
            <span className="block truncate text-[13px] text-fg-2">
              {[c.email, c.phone ? formatPhone(c.phone, c.country) : null, c.orderCount ? `${c.orderCount} past order${c.orderCount === 1 ? '' : 's'}` : 'New customer'].filter(Boolean).join(' · ')}
            </span>
          </span>
          {!readOnly && (
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setBillingOpen((o) => !o)}>{billingOpen ? 'Hide billing' : 'Edit billing'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>Change</Button>
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <CustomerSearch
              id="ob-customer"
              slug={data.slug}
              value={null}
              placeholder="Search by name, email or phone"
              onChange={(h) => {
                if (!h) return;
                setChanging(false);
                onPick(h.id);
              }}
            />
          </div>
          {data.perms.editCustomers && <Button variant="secondary" onClick={onNew} icon={<Plus className="size-4" />}>New customer</Button>}
          {c && <Button variant="ghost" onClick={() => setChanging(false)}>Keep {c.name.split(' ')[0]}</Button>}
        </div>
      )}
      {loading && <p className="mt-2 text-[13px] text-fg-2">Loading customer…</p>}
      {c?.taxExempt && !d.taxOverridden && <Notice className="mt-3">Tax exempt customer: no sales tax on this order.</Notice>}
      {c?.tags.includes('Do not rent') && <Notice kind="danger" className="mt-3">This customer is tagged “Do not rent”.</Notice>}

      {c && billingOpen && (
        <div className="anim-fade mt-4 flex flex-col gap-4 rounded-[var(--radius-card)] border border-subtle p-4">
          <p className="text-[13px] text-fg-2">Billing details on this order. Changing them here does not change the customer record.</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Bill to" htmlFor="ob-bill-name"><Input id="ob-bill-name" value={d.billing.name} onChange={(e) => set((x) => ({ billing: { ...x.billing, name: e.target.value } }))} /></Field>
            <Field label="Email" htmlFor="ob-bill-email"><Input id="ob-bill-email" type="email" value={d.billing.email} onChange={(e) => set((x) => ({ billing: { ...x.billing, email: e.target.value } }))} /></Field>
            <Field label="Phone" htmlFor="ob-bill-phone"><Input id="ob-bill-phone" type="tel" value={d.billing.phone} onChange={(e) => set((x) => ({ billing: { ...x.billing, phone: e.target.value } }))} /></Field>
            <Field label="Second phone" htmlFor="ob-bill-phone2" optional><Input id="ob-bill-phone2" type="tel" value={d.billing.phone2} onChange={(e) => set((x) => ({ billing: { ...x.billing, phone2: e.target.value } }))} /></Field>
          </div>
          <p className="text-[13px] font-semibold text-fg">Billing address</p>
          <AddressBlock s={billingScope} showMap={false} compact />
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Salesperson" htmlFor="ob-sales">
          <Select id="ob-sales" value={d.salespersonUserId} onChange={(e) => set({ salespersonUserId: e.target.value })}>
            <option value="">No one</option>
            {data.salespeople.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="How they heard" htmlFor="ob-source">
          <Select id="ob-source" value={d.source} onChange={(e) => set({ source: e.target.value })}>
            <option value="">Not asked</option>
            {HOW_HEARD.map((h) => <option key={h} value={h}>{h}</option>)}
          </Select>
        </Field>
        <Field label="Referred by" htmlFor="ob-ref" optional>
          <CustomerSearch id="ob-ref" slug={data.slug} value={d.referredBy} exceptId={c?.id} onChange={(h) => set({ referredBy: h ? { id: h.id, name: h.name } : null })} />
        </Field>
      </div>
    </Section>
  );
}

/** Immutable set of a dotted path on the draft (used by the shared address fields). */
function setPath(d: Draft, path: string, value: unknown): Partial<Draft> {
  const [head, ...rest] = path.split('.');
  const cur = (d as unknown as Record<string, unknown>)[head!];
  if (!rest.length) return { [head!]: value } as Partial<Draft>;
  const inner = setPath(cur as unknown as Draft, rest.join('.'), value);
  return { [head!]: { ...(cur as object), ...inner } } as Partial<Draft>;
}

// --- Event ----------------------------------------------------------------------------------------

export function EventSection({
  data, d, set, cleanupMinutes, travelTrace, milesBusy, onRecomputeMiles, unit,
}: {
  data: BuilderData; d: Draft; set: SetDraft; cleanupMinutes: number; travelTrace: string; milesBusy: boolean; onRecomputeMiles: () => void; unit: string;
}) {
  const end = addMinutes(d.start, d.durationMin);
  const [sh, sm] = d.start.split(':').map(Number) as [number, number];
  const overnight = sh * 60 + sm + d.durationMin >= 1440;
  const bufferEnd = addMinutes(d.start, d.durationMin + cleanupMinutes);
  const c = d.customer;
  const choices = [
    ...(c?.addresses ?? []).filter((a) => a.kind === 'event' || a.address.line1).map((a) => ({ key: `saved:${a.id}`, label: a.label, sub: [a.address.line1, a.address.city].filter(Boolean).join(', ') || 'Saved address', addr: a.address })),
    ...(c?.billingAddress.line1 ? [{ key: 'billing', label: 'Billing address', sub: [c.billingAddress.line1, c.billingAddress.city].filter(Boolean).join(', '), addr: c.billingAddress }] : []),
    { key: 'other', label: 'Another address', sub: 'Type it in', addr: null },
  ];
  const eventScope = scope({ values: d, set: (p, v) => set((x) => setPath(x, p, v)), error: () => undefined }, 'eventAddress');
  const pick = (key: string, addr: Draft['eventAddress'] | null) => {
    set({ addressChoice: key, ...(addr ? { eventAddress: { ...addr } } : {}), milesOverridden: false, travelOverride: d.travelOverride });
  };
  const setEnd = (t: string) => {
    const [eh, em] = t.split(':').map(Number) as [number, number];
    let mins = eh * 60 + em - (sh * 60 + sm);
    if (mins <= 0) mins += 1440;
    set({ durationMin: Math.max(30, mins) });
  };
  const dur = d.durationMin;
  // Multi-day: the end is a date and a time; duration follows from them (wall-clock arithmetic, no time zone).
  const endDate = addDays(d.date, Math.floor((sh * 60 + sm + dur) / 1440));
  const setEndAt = (date: string, time: string) => {
    const mins = Math.round((Date.parse(`${date}T${time}:00Z`) - Date.parse(`${d.date}T${d.start}:00Z`)) / 60_000);
    if (mins > 0) set({ durationMin: mins });
  };
  const loc = locationOf(data, d.locationId);
  const zip = d.eventAddress.postalCode?.trim();
  const outsideArea = !!zip && !!loc?.servedZips.length && !loc.servedZips.some((z) => z.replace(/\s/g, '') === zip.replace(/\s/g, ''));
  return (
    <Section title="Event" id="sec-event">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Field label="Event type" htmlFor="ob-type" className="col-span-2 lg:col-span-1">
          <Select id="ob-type" value={d.eventType} onChange={(e) => set({ eventType: e.target.value })}>
            <option value="">Choose…</option>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Date" htmlFor="ob-date" className="col-span-2 lg:col-span-1">
          <Input id="ob-date" type="date" mono value={d.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
        <Field label="Start" htmlFor="ob-start">
          <Input id="ob-start" type="time" mono step={900} value={d.start} onChange={(e) => e.target.value && set({ start: e.target.value })} />
        </Field>
        {!d.multiDay && (
          <Field label="End" htmlFor="ob-end">
            <Input id="ob-end" type="time" mono step={900} value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </Field>
        )}
      </div>
      <div className="mt-3">
        <Checkbox checked={d.multiDay} onChange={(on) => set({ multiDay: on, ...(on ? {} : { durationMin: Math.min(dur, 1440) }) })}>
          Rental spans multiple calendar days (start date &amp; time → end date &amp; time)
        </Checkbox>
        {d.multiDay && <p className="mt-1.5 pl-7 text-[12px] text-fg-2">Each item is charged its package price once for the whole rental, with no hourly extras. Type a price on a line to charge more.</p>}
      </div>
      {d.multiDay && (
        <div className="anim-fade mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="End date" htmlFor="ob-end-date" className="col-span-2 lg:col-span-1">
            <Input id="ob-end-date" type="date" mono min={d.date} value={endDate} onChange={(e) => e.target.value && setEndAt(e.target.value, end)} />
          </Field>
          <Field label="End time" htmlFor="ob-end-time">
            <Input id="ob-end-time" type="time" mono step={900} value={end} onChange={(e) => e.target.value && setEndAt(endDate, e.target.value)} />
          </Field>
          <p className="col-span-2 self-end pb-2 text-[13px] text-fg-2">
            {durationLabel(dur)}{dur >= 1440 ? ` · ${Math.floor(dur / 1440)} day${dur >= 2880 ? 's' : ''}` : ''} · package price per item
          </p>
        </div>
      )}
      <div className={cx('mt-5', d.multiDay && 'hidden')}>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="ob-dur" className="text-[13px] font-semibold text-fg">Duration · <span className="mono">{durationLabel(dur)}</span></label>
        </div>
        <input id="ob-dur" type="range" min={30} max={1440} step={15} value={dur} onChange={(e) => set({ durationMin: Number(e.target.value) })}
          className="range" style={{ ['--fill' as string]: `${((dur - 30) / 1410) * 100}%` }} />
        <p className="mt-2 text-[13px] text-fg-2">
          Ends <b className="mono text-fg">{timeLabel(end)}</b>{overnight && <span className="font-semibold text-warning-fg"> · +1 day</span>} · items blocked until <span className="mono">{timeLabel(bufferEnd)}</span> ({durationLabel(cleanupMinutes)} cleanup)
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-fg">Event address</p>
          <div role="radiogroup" aria-label="Event address" className="flex flex-col gap-2">
            {choices.map((ch) => {
              const on = d.addressChoice === ch.key;
              return (
                <button key={ch.key} type="button" role="radio" aria-checked={on} onClick={() => pick(ch.key, ch.addr)}
                  className={cx('press flex items-center gap-3 rounded-[var(--radius-card)] border px-3.5 py-3 text-left transition-colors', on ? 'border-accent bg-accent-soft/30 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle hover:border-control')}>
                  <MapPin className={cx('size-4 shrink-0', on ? 'text-accent-text' : 'text-fg-2')} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{ch.label}</span>
                    <span className="block truncate text-[13px] text-fg-2">{ch.sub}</span>
                  </span>
                  {on && d.miles && <span className="mono text-xs text-fg-2">{num(d.miles).toFixed(1)} {unit}</span>}
                </button>
              );
            })}
          </div>
          {d.addressChoice === 'other' && (
            <div className="anim-fade mt-2 flex flex-col gap-3 rounded-[var(--radius-card)] border border-subtle p-4">
              <AddressBlock s={eventScope} requireStreet compact near={data.locations.find((l) => l.id === d.locationId)?.lat != null ? { lat: data.locations.find((l) => l.id === d.locationId)!.lat!, lng: data.locations.find((l) => l.id === d.locationId)!.lng! } : null} />
              {c && <Checkbox checked={d.saveAddress} onChange={(x) => set({ saveAddress: x })}>Save to {c.name.split(' ')[0]}’s addresses</Checkbox>}
            </div>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-fg-2">
            <span className="min-w-0 flex-1">Driving distance from the nearest depot (Mapbox). Override if needed:</span>
            <AffixInput suffix={unit} mono inputMode="decimal" aria-label="Driving distance" value={d.miles} placeholder={milesBusy ? '…' : '—'} className="h-9 w-32"
              onChange={(e) => set({ miles: e.target.value, milesOverridden: true })} />
            {d.milesOverridden && d.eventAddress.lat != null && <button type="button" onClick={onRecomputeMiles} className="font-semibold text-accent-text hover:underline">Recalculate</button>}
          </div>
          {outsideArea && (
            <Notice kind="warning">ZIP {zip} is not in {loc!.name}’s service area. Check the territory map or ask the office before continuing; the order is not blocked.</Notice>
          )}
          {d.milesNote && <p className="text-[12px] text-fg-2">{d.milesNote}</p>}
          {travelTrace && <p className="mono text-[12px] text-fg-2">Travel: {travelTrace}</p>}
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Venue / location name" htmlFor="ob-venue" optional>
            <Input id="ob-venue" value={d.eventLocationName} onChange={(e) => set({ eventLocationName: e.target.value })} placeholder="e.g. Pavilion 3" />
          </Field>
          <Field label="Setup surface" htmlFor="ob-surface">
            <Select id="ob-surface" value={d.setupSurface} onChange={(e) => set({ setupSurface: e.target.value })}>
              {data.booking.surfaces.map((s) => (
                <option key={s.code} value={s.code}>{s.label} — {s.feeCents ? `${formatMoney(s.feeCents, data.currency)} per item` : 'no fee'}</option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-subtle p-3.5">
            <Toggle checked={d.eventLocationFee} onChange={(x) => set({ eventLocationFee: x })} label="Event location fee" sub="Parks and venues with permits" />
            {d.eventLocationFee && (
              <AffixInput prefix="$" mono inputMode="decimal" aria-label="Event location fee amount" value={d.eventLocationFeeAmount}
                onChange={(e) => set({ eventLocationFeeAmount: e.target.value })} className="anim-fade h-9 w-28" />
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Event day point of contact</p>
        <Checkbox
          checked={!!d.contact.name && d.contact.name === (d.billing.name || c?.name) && d.contact.mobile === (d.billing.phone2 || d.billing.phone) && d.contact.email === d.billing.email}
          onChange={(on) => on && set((x) => ({ contact: { ...x.contact, name: x.billing.name || c?.name || '', mobile: x.billing.phone2 || x.billing.phone, email: x.billing.email } }))}
        >
          Same as billing contact
        </Checkbox>
      </div>
      <p className="mb-3 text-[12px] text-fg-2">The person on site with a mobile phone during delivery, the event and pickup. Use a mobile number, not a desk phone.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="ob-cname"><Input id="ob-cname" value={d.contact.name} onChange={(e) => set((x) => ({ contact: { ...x.contact, name: e.target.value } }))} /></Field>
        <Field label="Mobile" htmlFor="ob-cmobile"><Input id="ob-cmobile" type="tel" inputMode="tel" value={d.contact.mobile} onChange={(e) => set((x) => ({ contact: { ...x.contact, mobile: e.target.value } }))} /></Field>
        <Field label="Email" htmlFor="ob-cemail" optional><Input id="ob-cemail" type="email" value={d.contact.email} onChange={(e) => set((x) => ({ contact: { ...x.contact, email: e.target.value } }))} /></Field>
      </div>
      <div className="mt-3">
        <Checkbox checked={d.contact.confirmed} onChange={(x) => set((p) => ({ contact: { ...p.contact, confirmed: x } }))}>I confirmed the event day point of contact</Checkbox>
      </div>
    </Section>
  );
}

// --- Items ----------------------------------------------------------------------------------------

export function ItemsSection({
  data, d, avail, availLoading, windowLabel, onAdd, shake, money,
}: {
  data: BuilderData; d: Draft; avail: Record<string, Availability>; availLoading: boolean; windowLabel: string;
  onAdd: (p: BuilderProduct) => void; shake: number; money: (c: number) => string;
}) {
  const [cat, setCat] = useState('all');
  const active = data.products.filter((p) => p.active);
  const cats = data.categories.filter((c) => active.some((p) => p.categoryId === c.id));
  const items = active.filter((p) => cat === 'all' || p.categoryId === cat);
  const inOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of d.lines) if (l.productId) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
    return m;
  }, [d.lines]);
  // Add-ons suggested by what is in the cart and not added yet.
  const suggested = useMemo(() => {
    const ids = new Set(d.lines.flatMap((l) => data.products.find((p) => p.id === l.productId)?.suggestedAddonIds ?? []));
    return active.filter((p) => ids.has(p.id) && !inOrder.has(p.id)).slice(0, 6);
  }, [d.lines, active, data.products, inOrder]);

  return (
    <Section title="Add items" id="sec-items" action={<span className="text-[13px] text-fg-2">Availability for {windowLabel}{availLoading && ' · checking…'}</span>}>
      {cats.length > 0 && (
        <div className="mb-4">
          <FilterChips label="Category" value={cat} onChange={setCat} chips={[{ value: 'all', label: 'All' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
        </div>
      )}
      {active.length === 0 ? (
        <Notice>No active products yet. <Link className="font-semibold underline" href={`/${data.slug}/products/new`}>Add one</Link> to start taking orders.</Notice>
      ) : (
        <div key={shake} className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4', shake > 0 && 'anim-shake')}>
          {items.map((p) => {
            const a = avail[p.id];
            const qty = inOrder.get(p.id) ?? 0;
            const tracked = p.tracking !== 'none';
            const left = a ? a.free - qty : null;
            const state = !tracked || a?.overbook ? 'open' : a == null ? 'unknown' : a.owned === 0 ? 'none' : a.free <= 0 && qty === 0 ? 'booked' : left! <= 0 ? 'all' : 'free';
            return (
              <button key={p.id} type="button" onClick={() => onAdd(p)} aria-label={`Add ${p.name}`}
                className={cx('press relative flex flex-col gap-2 rounded-[var(--radius-card)] border p-2.5 text-left transition-[border-color,box-shadow] hover:border-control hover:shadow-[var(--shadow-lift)]', qty ? 'border-accent' : 'border-subtle', (state === 'booked' || state === 'none') && 'opacity-60')}>
                {qty > 0 && <span key={qty} className="anim-pop absolute right-2 top-2 z-10 grid size-6 place-items-center rounded-full bg-accent text-xs font-bold text-on-accent">{qty}</span>}
                <ProductArt product={p} size="fill" imageUrl={p.imageUrl} className="h-20 w-full" iconSize={30} />
                <span className="line-clamp-2 min-h-[2.5em] text-[13px] font-semibold leading-tight text-fg">{p.name}</span>
                <span className="flex items-center justify-between gap-1">
                  <span className="mono text-[11px] leading-tight text-fg-2">from<br />{money(p.fromCents)}</span>
                  <span className={cx('rounded-full px-2 py-0.5 text-center text-[11px] font-bold leading-tight',
                    state === 'free' && 'bg-success-bg text-success-fg', state === 'all' && 'bg-warning-bg text-warning-fg',
                    (state === 'booked' || state === 'none') && 'bg-danger-bg text-danger-fg', (state === 'open' || state === 'unknown') && 'bg-sunken text-fg-2')}>
                    {state === 'free' ? `${left} of ${a!.owned} free` : state === 'all' ? 'All in order' : state === 'booked' ? 'Booked' : state === 'none' ? 'None here' : state === 'open' ? (tracked ? 'Overbook ok' : 'Service') : '…'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {suggested.length > 0 && (
        <div className="anim-fade mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-accent-soft/30 px-3 py-2.5">
          <Sparkles className="size-4 text-accent-text" aria-hidden />
          <span className="text-[13px] font-semibold text-fg">Often added:</span>
          {suggested.map((p) => (
            <button key={p.id} type="button" onClick={() => onAdd(p)} className="press inline-flex h-8 items-center gap-1.5 rounded-full border border-control bg-surface px-3 text-[13px] font-semibold text-fg hover:border-accent">
              <Plus className="size-3.5" /> {p.name}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

// --- Lines ----------------------------------------------------------------------------------------

/** Event durations offered on each line (Odoo: "9 hours"), plus whatever the order has now. */
const DURATIONS = Array.from({ length: 24 }, (_, i) => (i + 1) * 30);

export function LinesSection({
  data, d, set, quoted, refused, short, setLine, removeLine, addCustom, canOverride, money, windowLabel,
}: {
  data: BuilderData; d: Draft; set: SetDraft; quoted: QuotedLine[]; refused: Set<string>; short: Map<string, string>;
  setLine: (key: string, patch: Partial<DraftLine>) => void; removeLine: (key: string) => void; addCustom: () => void; canOverride: boolean; money: (c: number) => string;
  /** The event's date and time, shown on every item (Odoo: "October 28, 2026 | 5:30 AM to 2:30 PM"). */
  windowLabel: string;
}) {
  const byId = new Map(data.products.map((p) => [p.id, p]));
  const durations = [...new Set([...DURATIONS, d.durationMin])].sort((a, b) => a - b);
  return (
    <Section
      title="Shopping cart"
      id="sec-lines"
      action={
        <span className="flex items-center gap-3">
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[12px] font-semibold text-accent-text">{d.lines.length} item{d.lines.length === 1 ? '' : 's'}</span>
          <Button size="sm" variant="secondary" onClick={addCustom} icon={<Plus className="size-3.5" />}>Custom line</Button>
        </span>
      }
    >
      <p className="-mt-2 mb-4 text-[13px] text-fg-2">Confirm the service option, time and pricing for each item.</p>
      {d.lines.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-control px-4 py-8 text-center text-sm text-fg-2">Tap an item above, or add a custom line.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {d.lines.map((l, i) => {
            const q = quoted[i];
            const p = l.productId ? byId.get(l.productId) : undefined;
            const bad = refused.has(l.key) || short.has(l.key);
            const warnings = (
              <>
                {q?.warnings.map((w) => <p key={w} className="mt-1 text-[12px] font-medium text-warning-fg">{w}</p>)}
                {short.get(l.key) && <p className="mt-1 text-[12px] font-semibold text-danger" role="alert">{short.get(l.key)}</p>}
                {refused.has(l.key) && !short.get(l.key) && <p className="mt-1 text-[12px] font-semibold text-danger" role="alert">Not available for this time.</p>}
              </>
            );
            return (
              <li key={l.key} className={cx('anim-rise overflow-hidden rounded-[var(--radius-card)] border transition-colors', bad ? 'border-danger bg-danger-bg/40' : 'border-subtle')}>
                <div className="flex items-start gap-3 p-3.5">
                  {p ? <ProductArt product={p} size={56} imageUrl={p.imageUrl} /> : <span className="grid size-14 shrink-0 place-items-center rounded-[var(--radius-control)] bg-sunken text-xs font-bold text-fg-2">Custom</span>}
                  <div className="min-w-0 flex-1">
                    <Input aria-label="Description" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder={p ? p.name : 'Describe the item'} className="h-9 border-transparent bg-sunken/70 font-semibold" />
                    {p && <p className="mt-1 px-1 text-[13px] text-accent-text">{windowLabel}</p>}
                  </div>
                  <button type="button" aria-label={`Remove ${l.name || 'line'}`} onClick={() => removeLine(l.key)} className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-danger-bg hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {p ? (
                  <ProductLine l={l} p={p} q={q} d={d} set={set} setLine={setLine} canOverride={canOverride} money={money} surfaces={data.booking.surfaces} durations={durations} />
                ) : (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3.5 pb-3.5">
                    <Qty l={l} setLine={setLine} />
                    <div className="flex items-center gap-1.5">
                      <span className="whitespace-nowrap text-[13px] text-fg-2">Unit</span>
                      <AffixInput aria-label="Unit price" prefix="$" mono inputMode="decimal" value={l.price} placeholder="0.00" onChange={(e) => setLine(l.key, { price: e.target.value })} className="w-28 text-right" />
                    </div>
                    <Checkbox checked={l.taxable} onChange={(x) => setLine(l.key, { taxable: x })}>Taxable</Checkbox>
                    <span className="mono ml-auto text-[15px] font-bold text-fg">{money(q?.lineTotalCents ?? 0)}</span>
                  </div>
                )}
                {(q?.warnings.length || short.get(l.key) || refused.has(l.key)) ? <div className="px-3.5 pb-3">{warnings}</div> : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * One product in the cart, as on the Odoo POS: duration and setup surface, the service
 * options with their base packages, flat rate, then base package + additional time
 * (hours × rate) = item total. The base and the rate are locked on the order.
 */
function ProductLine({
  l, p, q, d, set, setLine, canOverride, money, surfaces, durations,
}: {
  l: DraftLine; p: BuilderProduct; q: QuotedLine | undefined; d: Draft; set: SetDraft; setLine: (key: string, patch: Partial<DraftLine>) => void;
  canOverride: boolean; money: (c: number) => string; surfaces: BuilderData['booking']['surfaces']; durations: number[];
}) {
  const modeLabel = SERVICE_MODES.find((m) => m.value === l.serviceMode)?.label ?? 'Concierge';
  const own = (m: ServiceMode) => p.branchPrices.find((b) => b.locationId === d.locationId && b.mode === m)?.priceCents;
  const modePrice = (m: ServiceMode) => own(m) ?? (m === 'staffed' ? p.pricing.priceStaffedCents : m === 'pickup' ? p.pricing.pricePickupCents : p.pricing.priceDropoffCents) ?? 0;
  const rate = extraRateOf(p.pricing);
  const t = q?.trace;
  const flat = l.flatRate || d.multiDay;
  const extraHours = t && t.method !== 'flat' ? Math.max(0, t.hours - t.includedHours) : 0;
  const locked = (value: string, fallback: string) => (
    <span className="mono inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-sunken px-3 text-sm text-fg" title="Your role cannot change prices. Ask a manager.">
      ${value || fallback} <Lock className="size-3 text-fg-3" aria-label="Price locked" />
    </span>
  );
  return (
    <div className="flex flex-col gap-4 px-3.5 pb-3.5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Event duration" htmlFor={`ln-dur-${l.key}`} hint={d.multiDay ? 'Multi-day: set the dates under Event.' : 'The same for every item on this order.'}>
          <Select id={`ln-dur-${l.key}`} value={String(d.durationMin)} disabled={d.multiDay} onChange={(e) => set({ durationMin: Number(e.target.value) })}>
            {durations.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
          </Select>
        </Field>
        <Field label="Setup surface" htmlFor={`ln-surf-${l.key}`}>
          <Select id={`ln-surf-${l.key}`} value={l.setupSurface ?? d.setupSurface ?? ''} onChange={(e) => setLine(l.key, { setupSurface: e.target.value })}>
            {surfaces.map((s) => <option key={s.code} value={s.code}>{s.label}{s.feeCents ? ` · +${money(s.feeCents)}` : ''}</option>)}
          </Select>
        </Field>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold text-fg">Choose service option</p>
        <div role="radiogroup" aria-label="Service option" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SERVICE_MODES.filter((m) => modePrice(m.value) > 0 || l.serviceMode === m.value).map((m) => {
            const on = l.serviceMode === m.value;
            return (
              <button key={m.value} type="button" role="radio" aria-checked={on}
                onClick={() => { if (!on) setLine(l.key, { serviceMode: m.value, ...lockedFor(p, m.value, d.locationId), price: canOverride ? l.price : '' }); }}
                className={cx('press flex flex-col rounded-[var(--radius-card)] border px-3.5 py-2.5 text-left transition-colors', on ? 'border-accent bg-accent-soft/25 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle bg-surface hover:border-control')}>
                <span className="text-[14px] font-semibold text-fg">{m.label}</span>
                <span className="mono text-[12px] text-fg-2">{money(on && l.basePrice ? Math.round(num(l.basePrice) * 100) : modePrice(m.value))} base package</span>
              </button>
            );
          })}
        </div>
      </div>

      {d.multiDay
        ? <p className="text-[12px] font-semibold text-fg-2">Multi-day rental: each item&rsquo;s package is charged once, with no additional time.</p>
        : <Checkbox checked={l.flatRate} onChange={(x) => setLine(l.key, { flatRate: x })}>Flat rate &mdash; charge {modeLabel} package only (no additional time)</Checkbox>}

      <div className="divide-y divide-subtle overflow-hidden rounded-[var(--radius-card)] border border-subtle">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
          <div>
            <p className="text-[14px] font-semibold text-fg">{modeLabel} base package</p>
            <p className="text-[12px] text-fg-2">{flat ? 'Package only' : `Includes ${durationLabel(Math.round((t?.includedHours ?? p.pricing.baseHours ?? 1) * 60))}`}</p>
          </div>
          {canOverride
            ? <AffixInput aria-label={`${modeLabel} base package price`} prefix="$" mono inputMode="decimal" value={l.basePrice} placeholder={(modePrice(l.serviceMode) / 100).toFixed(2)} onChange={(e) => setLine(l.key, { basePrice: e.target.value })} className="w-32 text-right" />
            : locked(l.basePrice, (modePrice(l.serviceMode) / 100).toFixed(2))}
        </div>
        {!flat && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-fg">Additional time</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
                <span className="mono">{rate.kind === 'hourly' ? `${extraHours.toFixed(2)} hours ×` : `${t?.units ?? 0} × ${rate.minutes} min ×`}</span>
                {canOverride
                  ? <AffixInput aria-label="Additional time rate" prefix="$" mono inputMode="decimal" value={l.extraRate} placeholder={(rate.cents / 100).toFixed(2)} onChange={(e) => setLine(l.key, { extraRate: e.target.value })} className="h-8 w-32 text-right" />
                  : <span className="mono">${l.extraRate || (rate.cents / 100).toFixed(2)}</span>}
                <span>{rate.kind === 'hourly' ? 'per hour' : `per ${rate.minutes} min`}</span>
              </div>
            </div>
            <span className="mono inline-flex h-9 min-w-28 items-center justify-end rounded-[var(--radius-control)] bg-sunken px-3 text-sm text-fg">{money(t?.extraCents ?? 0)}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-info-bg/50 px-3.5 py-3">
          <div className="flex items-center gap-3">
            <span className="text-[14px] font-semibold text-accent-text">Item total</span>
            <Qty l={l} setLine={setLine} />
          </div>
          <div className="flex items-center gap-1.5">
            {canOverride
              ? <AffixInput aria-label="Unit price" prefix="$" mono inputMode="decimal" value={l.price} placeholder={((q?.autoUnitCents ?? 0) / 100).toFixed(2)} onChange={(e) => setLine(l.key, { price: e.target.value })} className={cx('w-32 text-right', l.price && 'border-accent')} />
              : <span className="mono inline-flex h-9 items-center rounded-[var(--radius-control)] bg-sunken px-3 text-sm text-fg">{money(q?.unitCents ?? 0)}</span>}
            {l.price && canOverride && <button type="button" onClick={() => setLine(l.key, { price: '' })} className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-bold text-accent-text">Auto</button>}
            {l.quantity > 1 && <span className="mono ml-2 text-[15px] font-bold text-fg">= {money(q?.lineTotalCents ?? 0)}</span>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Checkbox checked={l.taxable} onChange={(x) => setLine(l.key, { taxable: x })}>Taxable</Checkbox>
        {l.price && q && <span className="mono text-[12px] text-fg-2">Set by hand · auto {money(q.autoUnitCents)}</span>}
      </div>
      <p className="text-[11.5px] text-fg-3">The {modeLabel.toLowerCase()} base and the additional-time rate are locked on this order (not the product&rsquo;s current price). Changing hours recalculates additional time like a new booking.</p>
    </div>
  );
}

function Qty({ l, setLine }: { l: DraftLine; setLine: (key: string, patch: Partial<DraftLine>) => void }) {
  return (
    <div className="inline-flex h-9 items-stretch overflow-hidden rounded-[var(--radius-control)] border border-control bg-surface">
      <button type="button" aria-label="One fewer" disabled={l.quantity <= 1} onClick={() => setLine(l.key, { quantity: l.quantity - 1 })} className="grid w-9 place-items-center text-fg-2 hover:bg-sunken disabled:opacity-35"><Minus className="size-3.5" /></button>
      <span className="mono grid w-9 place-items-center text-sm font-semibold text-fg" aria-live="polite">{l.quantity}</span>
      <button type="button" aria-label="One more" onClick={() => setLine(l.key, { quantity: l.quantity + 1 })} className="grid w-9 place-items-center text-fg-2 hover:bg-sunken"><Plus className="size-3.5" /></button>
    </div>
  );
}

export function NotesSection({ d, set, slug }: { d: Draft; set: SetDraft; slug: string }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  async function upload(f: File) {
    setUploading(true);
    const fd = new FormData();
    fd.set('file', f);
    const r = await uploadSetupMapAction(slug, fd);
    setUploading(false);
    if (!r.ok) return toast(r.error, 'error');
    set({ setupMap: r.data! });
  }
  return (
    <Section title="Notes" id="sec-notes">
      <div className="mb-4 flex flex-col gap-2">
        <p className="text-[13px] font-semibold text-fg">Setup map <span className="font-normal text-fg-3">· optional, shared with the crew</span></p>
        {d.setupMap ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-subtle p-3">
            <FileText className="size-5 text-fg-2" aria-hidden />
            <a href={d.setupMap.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold text-accent-text hover:underline">{d.setupMap.name}</a>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} pending={uploading}>Replace</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => set({ setupMap: null })}>Remove</Button>
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            className="press flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-control px-4 py-4 text-sm font-semibold text-accent-text hover:bg-hover disabled:opacity-60">
            <Upload className="size-4" /> {uploading ? 'Uploading…' : 'Upload image or PDF'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" aria-label="Setup map file"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Setup instructions & internal notes" htmlFor="ob-int" hint="Only your team and coaches see these.">
          <Textarea id="ob-int" rows={3} value={d.internalNotes} onChange={(e) => set({ internalNotes: e.target.value })} />
        </Field>
        <Field label="Note to customer" htmlFor="ob-cust" hint="Printed on the quote.">
          <Textarea id="ob-cust" rows={3} value={d.customerNotes} onChange={(e) => set({ customerNotes: e.target.value })} />
        </Field>
      </div>
    </Section>
  );
}
