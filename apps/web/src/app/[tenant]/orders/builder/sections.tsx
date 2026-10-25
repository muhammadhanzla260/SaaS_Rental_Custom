'use client';

import Link from 'next/link';
import { Lock, MapPin, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  describeTrace, EVENT_TYPES, formatMoney, formatPhone, HOW_HEARD, SERVICE_MODES, type QuotedLine, type ServiceMode,
} from '@rental/core';
import type { Availability } from '@rental/db';
import { CustomerSearch } from '@/components/customers/customer-form';
import { initialsOf } from '@/components/customers/customer-profile';
import { ProductArt } from '@/components/catalog/product-art';
import { AddressBlock } from '@/components/fields/address';
import { scope } from '@/components/fields/scope';
import { AffixInput, Button, Card, Checkbox, cx, Field, FilterChips, Input, Notice, Select, Textarea, Toggle } from '@/components/kit';
import { addMinutes, durationLabel, num, timeLabel } from './draft';
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
        <Field label="End" htmlFor="ob-end">
          <Input id="ob-end" type="time" mono step={900} value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="mt-5">
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

      <p className="eyebrow mb-3 mt-6">On-site contact</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="ob-cname"><Input id="ob-cname" value={d.contact.name} onChange={(e) => set((x) => ({ contact: { ...x.contact, name: e.target.value } }))} /></Field>
        <Field label="Mobile" htmlFor="ob-cmobile"><Input id="ob-cmobile" type="tel" inputMode="tel" value={d.contact.mobile} onChange={(e) => set((x) => ({ contact: { ...x.contact, mobile: e.target.value } }))} /></Field>
        <Field label="Email" htmlFor="ob-cemail" optional><Input id="ob-cemail" type="email" value={d.contact.email} onChange={(e) => set((x) => ({ contact: { ...x.contact, email: e.target.value } }))} /></Field>
      </div>
      <div className="mt-3">
        <Checkbox checked={d.contact.confirmed} onChange={(x) => set((p) => ({ contact: { ...p.contact, confirmed: x } }))}>Contact confirmed</Checkbox>
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

export function LinesSection({
  data, d, quoted, refused, short, setLine, removeLine, addCustom, canOverride, money,
}: {
  data: BuilderData; d: Draft; quoted: QuotedLine[]; refused: Set<string>; short: Map<string, string>;
  setLine: (key: string, patch: Partial<DraftLine>) => void; removeLine: (key: string) => void; addCustom: () => void; canOverride: boolean; money: (c: number) => string;
}) {
  const byId = new Map(data.products.map((p) => [p.id, p]));
  return (
    <Section
      title="Order lines"
      id="sec-lines"
      action={
        <span className="flex items-center gap-3">
          <span className="text-[13px] text-fg-2">{d.lines.length} line{d.lines.length === 1 ? '' : 's'}</span>
          <Button size="sm" variant="secondary" onClick={addCustom} icon={<Plus className="size-3.5" />}>Custom line</Button>
        </span>
      }
    >
      {d.lines.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-control px-4 py-8 text-center text-sm text-fg-2">Tap an item above, or add a custom line.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {d.lines.map((l, i) => {
            const q = quoted[i];
            const p = l.productId ? byId.get(l.productId) : undefined;
            const bad = refused.has(l.key) || short.has(l.key);
            const auto = q && !l.productId ? null : q?.autoUnitCents;
            const modesWithPrice = (m: ServiceMode) => !p || (m === 'staffed' ? true : m === 'pickup' ? p.pricing.pricePickupCents != null : p.pricing.priceDropoffCents != null);
            return (
              <li key={l.key} className={cx('anim-rise rounded-[var(--radius-card)] border p-3.5 transition-colors', bad ? 'border-danger bg-danger-bg/40' : 'border-subtle')}>
                <div className="flex items-center gap-3">
                  {p ? <ProductArt product={p} size={40} imageUrl={p.imageUrl} /> : <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-sunken text-xs font-bold text-fg-2">Custom</span>}
                  <Input aria-label="Description" value={l.name} onChange={(e) => setLine(l.key, { name: e.target.value })} placeholder={p ? p.name : 'Describe the item'} className="h-9 border-transparent bg-sunken/70 font-semibold" />
                  <button type="button" aria-label={`Remove ${l.name || 'line'}`} onClick={() => removeLine(l.key)} className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-danger-bg hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
                  {p && (
                    <div role="radiogroup" aria-label="Service mode" className="inline-flex gap-1 rounded-[calc(var(--radius-control)+2px)] bg-sunken p-1">
                      {SERVICE_MODES.map((m) => {
                        const on = l.serviceMode === m.value;
                        const ok = modesWithPrice(m.value);
                        return (
                          <button key={m.value} type="button" role="radio" aria-checked={on} disabled={!ok && !on} title={ok ? undefined : `No ${m.label.toLowerCase()} price`}
                            onClick={() => setLine(l.key, { serviceMode: m.value, price: canOverride ? l.price : '' })}
                            className={cx('h-7 whitespace-nowrap rounded-[var(--radius-control)] px-2.5 text-xs font-semibold transition-colors disabled:opacity-35', on ? 'bg-surface text-fg shadow-[0_1px_3px_rgb(16_19_26/0.15)]' : 'text-fg-2 hover:text-fg')}>
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="inline-flex h-9 items-stretch overflow-hidden rounded-[var(--radius-control)] border border-control bg-surface">
                    <button type="button" aria-label="One fewer" disabled={l.quantity <= 1} onClick={() => setLine(l.key, { quantity: l.quantity - 1 })} className="grid w-9 place-items-center text-fg-2 hover:bg-sunken disabled:opacity-35"><Minus className="size-3.5" /></button>
                    <span className="mono grid w-9 place-items-center text-sm font-semibold text-fg" aria-live="polite">{l.quantity}</span>
                    <button type="button" aria-label="One more" onClick={() => setLine(l.key, { quantity: l.quantity + 1 })} className="grid w-9 place-items-center text-fg-2 hover:bg-sunken"><Plus className="size-3.5" /></button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="whitespace-nowrap text-[13px] text-fg-2">Unit $</span>
                    {p && !canOverride ? (
                      <span className="mono inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] bg-sunken px-3 text-sm text-fg" title="Your role cannot change prices. Ask a manager.">
                        {((q?.unitCents ?? 0) / 100).toFixed(2)} <Lock className="size-3 text-fg-3" aria-label="Price locked" />
                      </span>
                    ) : (
                      <Input mono inputMode="decimal" aria-label="Unit price" value={l.price} placeholder={auto != null ? (auto / 100).toFixed(2) : '0.00'}
                        onChange={(e) => setLine(l.key, { price: e.target.value })} className={cx('h-9 w-28 text-right', p && l.price && 'border-accent')} />
                    )}
                    {p && l.price && canOverride && (
                      <button type="button" onClick={() => setLine(l.key, { price: '' })} className="rounded-md bg-accent-soft px-2 py-1 text-[11px] font-bold text-accent-text">Auto</button>
                    )}
                  </div>
                  <Checkbox checked={l.taxable} onChange={(x) => setLine(l.key, { taxable: x })}>Taxable</Checkbox>
                  <span className="mono ml-auto text-[15px] font-bold text-fg">{money(q?.lineTotalCents ?? 0)}</span>
                </div>
                <p className="mono mt-2 text-[12px] text-fg-2">
                  {q ? (p && l.price ? `Set by hand · auto ${money(q.autoUnitCents)} (${describeTrace(q.trace, money)})` : describeTrace(q.trace, money)) : ''}
                </p>
                {q?.warnings.map((w) => <p key={w} className="mt-1 text-[12px] font-medium text-warning-fg">{w}</p>)}
                {short.get(l.key) && <p className="mt-1 text-[12px] font-semibold text-danger" role="alert">{short.get(l.key)}</p>}
                {refused.has(l.key) && !short.get(l.key) && <p className="mt-1 text-[12px] font-semibold text-danger" role="alert">Not available for this time.</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

export function NotesSection({ d, set }: { d: Draft; set: SetDraft }) {
  return (
    <Section title="Notes" id="sec-notes">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Internal notes" htmlFor="ob-int" hint="Only your team and coaches see these.">
          <Textarea id="ob-int" rows={3} value={d.internalNotes} onChange={(e) => set({ internalNotes: e.target.value })} />
        </Field>
        <Field label="Note to customer" htmlFor="ob-cust" hint="Printed on the quote.">
          <Textarea id="ob-cust" rows={3} value={d.customerNotes} onChange={(e) => set({ customerNotes: e.target.value })} />
        </Field>
      </div>
    </Section>
  );
}
