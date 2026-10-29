'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CREDIT_KINDS, formatMoney, formatPhone, ORDER_STATUS, type OrderStatus } from '@rental/core';
import type { CustomerProfile } from '@rental/db';
import { AddressBlock } from '@/components/fields/address';
import { scope } from '@/components/fields/scope';
import { Button, cx, Field, Input, LinkButton, Modal, Pill, Segmented, Select, Toggle, useToast } from '@/components/kit';
import { useForm } from '@/lib/form';
import {
  createCreditAction, removeCustomerAddressAction, saveCustomerAddressAction, setCustomerMessagingAction, voidCreditAction,
} from '@/server/actions/commerce';

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function CustomerTags({ tags, repeat, taxExempt, className }: { tags: string[]; repeat?: boolean; taxExempt?: boolean; className?: string }) {
  const list = [...(repeat ? ['Repeat'] : []), ...tags, ...(taxExempt ? ['Tax exempt'] : [])];
  if (!list.length) return null;
  return (
    <span className={cx('flex flex-wrap gap-1', className)}>
      {list.map((t) => (
        <span
          key={t}
          className={cx(
            'rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-tight',
            t === 'Repeat' ? 'bg-success-bg text-success-fg' : t === 'VIP' ? 'bg-night text-volt' : t === 'Tax exempt' ? 'bg-warning-bg text-warning-fg' : t === 'Do not rent' ? 'bg-danger-bg text-danger-fg' : 'bg-info-bg text-info-fg',
          )}
        >
          {t}
        </span>
      ))}
    </span>
  );
}

type Perms = { canEdit: boolean; canCredit: boolean; canOrder: boolean };

/** The dark-headed profile: KPIs, contact, saved addresses, orders, credits, messages. */
export function CustomerProfilePanel({
  slug, c, currency, perms, onEdit, onClose, compact,
}: { slug: string; c: CustomerProfile; currency: string; perms: Perms; onEdit: () => void; onClose?: () => void; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const money = (cents: number) => formatMoney(cents, currency);
  const name = c.displayName ?? 'Customer';
  const since = new Date(c.createdAt).getFullYear();
  const [addr, setAddr] = useState<{ id: string | null } | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [sms, setSms] = useState(c.smsOptIn);
  const [mkt, setMkt] = useState(c.marketingOptIn);
  useEffect(() => { setSms(c.smsOptIn); setMkt(c.marketingOptIn); }, [c.smsOptIn, c.marketingOptIn]);

  async function setMessaging(p: { smsOptIn?: boolean; marketingOptIn?: boolean }) {
    if (p.smsOptIn !== undefined) setSms(p.smsOptIn);
    if (p.marketingOptIn !== undefined) setMkt(p.marketingOptIn);
    const r = await setCustomerMessagingAction(slug, c.id, p);
    if (!r.ok) {
      toast(r.error, 'error');
      setSms(c.smsOptIn);
      setMkt(c.marketingOptIn);
    }
  }
  async function voidIt(id: string) {
    const r = await voidCreditAction(slug, id);
    toast(r.ok ? (r.message ?? 'Voided.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) router.refresh();
  }
  const credits = c.credits.filter((x) => x.balanceCents > 0);
  const eventDate = (d: Date | string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex min-h-full flex-col">
      <div className="ink-grid relative p-5 text-white sm:p-6">
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close profile" className="absolute right-3 top-3 grid size-9 place-items-center rounded-[10px] text-white/70 hover:bg-white/10 hover:text-white">
            <span aria-hidden className="text-xl leading-none">×</span>
          </button>
        )}
        <div className="flex items-center gap-4 pr-8">
          <span className="grid size-16 shrink-0 place-items-center rounded-full bg-[#E6ECFF] font-display text-xl font-bold text-[#233FB8]">{initialsOf(name)}</span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-2xl font-bold">{name}</h2>
            <p className="text-sm text-white/65">{c.kind === 'organization' ? 'Organization' : 'Individual'} · customer since {since}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          {[
            ['Orders', String(c.orderCount), ''],
            ['Lifetime', money(c.lifetimeCents), 'text-volt'],
            ['Balance', money(c.balanceCents), c.balanceCents > 0 ? 'text-white' : 'text-white/80'],
          ].map(([label, value, cls]) => (
            <div key={label} className="min-w-0 rounded-[12px] bg-white/[0.06] px-3 py-2.5">
              <p className="text-xs text-white/60">{label}</p>
              <p className={cx('mono truncate text-lg font-bold', cls)}>{value}</p>
            </div>
          ))}
        </div>
        {perms.canOrder && (
          <LinkButton href={`/${slug}/orders/new?customer=${c.id}`} variant="volt" size="lg" className="mt-4 w-full">
            New order for {c.firstName || name.split(' ')[0]}
          </LinkButton>
        )}
      </div>

      <div className={cx('flex flex-1 flex-col gap-6 p-5 sm:p-6', compact && 'pb-10')}>
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="eyebrow">Contact</h3>
            {perms.canEdit && <Button variant="ghost" size="sm" onClick={onEdit} icon={<Pencil className="size-3.5" />}>Edit</Button>}
          </div>
          <p className="break-all text-[15px] text-fg">{c.email ?? <span className="text-fg-2">No email</span>}</p>
          <p className="mono mt-1 text-[15px] text-fg">
            {c.phone ? <a href={`tel:${c.phone}`} className="hover:underline">{formatPhone(c.phone, c.country)}</a> : <span className="text-fg-2">No phone</span>}
            {c.phoneSecondary && <span className="text-fg-2"> · second {formatPhone(c.phoneSecondary, c.country)}</span>}
          </p>
          {c.source && <p className="mt-2 text-sm text-fg-2">Found us via <b className="text-fg">{c.source}</b></p>}
          {c.referredBy && <p className="mt-1 text-sm text-fg-2">Referred by <b className="text-fg">{c.referredBy.name}</b></p>}
          <CustomerTags tags={c.tags} repeat={c.repeat} taxExempt={c.taxExempt} className="mt-3" />
          {c.notes && <p className="mt-3 whitespace-pre-wrap rounded-[12px] bg-sunken px-3 py-2 text-sm text-fg">{c.notes}</p>}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="eyebrow">Saved addresses</h3>
            {perms.canEdit && <Button variant="ghost" size="sm" onClick={() => setAddr({ id: null })} icon={<Plus className="size-3.5" />}>Add</Button>}
          </div>
          {c.addresses.length === 0 && !c.line1 ? (
            <p className="text-sm text-fg-2">No saved places yet. Event addresses can be saved from the order screen.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.line1 && (
                <li className="flex items-start gap-3 rounded-[12px] bg-sunken/70 px-3.5 py-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-fg-2" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">Billing address</span>
                    <span className="block truncate text-[13px] text-fg-2">{[c.line1, c.city, c.region].filter(Boolean).join(', ')}</span>
                  </span>
                  <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-bold text-fg-2">Billing</span>
                </li>
              )}
              {c.addresses.map((a) => (
                <li key={a.id} className="group flex items-start gap-3 rounded-[12px] bg-sunken/70 px-3.5 py-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-fg-2" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">{a.label}</span>
                    <span className="block truncate text-[13px] text-fg-2">{[a.line1, a.city, a.region].filter(Boolean).join(', ') || 'No street yet'}</span>
                  </span>
                  <span className="rounded-md bg-surface px-2 py-0.5 text-[11px] font-bold text-fg-2">{a.kind === 'billing' ? 'Billing' : 'Event'}</span>
                  {perms.canEdit && (
                    <button type="button" onClick={() => setAddr({ id: a.id })} aria-label={`Edit ${a.label}`} className="grid size-7 place-items-center rounded-md text-fg-2 hover:bg-surface hover:text-fg">
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-2">Orders</h3>
          {c.orders.length === 0 ? (
            <p className="text-sm text-fg-2">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-subtle">
              {c.orders.slice(0, 12).map((o) => {
                const st = ORDER_STATUS[o.status as OrderStatus];
                return (
                  <li key={o.id}>
                    <Link href={`/${slug}/orders/${o.id}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 hover:bg-hover">
                      <span className="mono text-[13px] text-fg-2">{o.number}</span>
                      <span className="truncate text-sm text-fg">{eventDate(o.eventStartsAt)}</span>
                      <Pill tone={(st?.tone ?? 'neutral') as 'neutral'}>{st?.label ?? o.status}</Pill>
                      <span className="mono text-right text-sm font-semibold text-fg">{money(o.status === 'cancelled' ? 0 : o.totalCents)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="eyebrow">Credits & rain checks</h3>
            {perms.canCredit && <Button variant="ghost" size="sm" onClick={() => setCreditOpen(true)} icon={<Plus className="size-3.5" />}>Issue</Button>}
          </div>
          {credits.length === 0 ? (
            <p className="text-sm text-fg-2">No open credits.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {credits.map((x) => (
                <li key={x.id} className="flex items-center gap-3 rounded-[12px] border border-subtle px-3.5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">{x.label} <span className="mono font-normal text-fg-2">{x.code}</span></span>
                    <span className="block text-[13px] text-fg-2">
                      {x.reason ?? 'No note'}{x.validUntil ? ` · valid to ${eventDate(x.validUntil)}` : ''}{x.expired ? ' · expired' : ''}
                    </span>
                  </span>
                  <span className="mono text-sm font-bold text-success-fg">{money(x.balanceCents)}</span>
                  {perms.canCredit && (
                    <button type="button" onClick={() => voidIt(x.id)} aria-label={`Void ${x.code}`} className="grid size-7 place-items-center rounded-md text-fg-2 hover:bg-danger-bg hover:text-danger">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-3">Messages</h3>
          <div className="flex flex-col gap-3">
            <Toggle checked={sms} onChange={(x) => setMessaging({ smsOptIn: x })} label="Event reminders by text" disabled={!perms.canEdit} />
            <Toggle checked={mkt} onChange={(x) => setMessaging({ marketingOptIn: x })} label="Marketing emails" disabled={!perms.canEdit} />
          </div>
          <p className="mt-3 text-[13px] text-fg-2">Every email and text sent to this customer will be listed here once messaging is on (Phase 2).</p>
        </section>
      </div>

      <AddressModal slug={slug} customer={c} editing={addr} onClose={() => setAddr(null)} />
      <CreditModal slug={slug} customerId={c.id} open={creditOpen} onClose={() => setCreditOpen(false)} currency={currency} />
    </div>
  );
}

function AddressModal({ slug, customer, editing, onClose }: { slug: string; customer: CustomerProfile; editing: { id: string | null } | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const existing = editing?.id ? customer.addresses.find((a) => a.id === editing.id) : null;
  type A = { label: string; kind: 'event' | 'billing'; address: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string; lat?: number; lng?: number } };
  const blank: A = { label: '', kind: 'event', address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: customer.country } };
  const form = useForm<A>(blank);
  useEffect(() => {
    if (!editing) return;
    form.reset(existing ? {
      label: existing.label, kind: existing.kind as A['kind'],
      address: { line1: existing.line1 ?? '', line2: existing.line2 ?? '', city: existing.city ?? '', region: existing.region ?? '', postalCode: existing.postalCode ?? '', country: existing.country, lat: existing.lat ?? undefined, lng: existing.lng ?? undefined },
    } : blank);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  async function remove() {
    if (!existing) return;
    const r = await removeCustomerAddressAction(slug, customer.id, existing.id);
    toast(r.ok ? (r.message ?? 'Removed.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) { onClose(); router.refresh(); }
  }
  return (
    <Modal
      open={!!editing}
      onClose={onClose}
      width={600}
      title={existing ? 'Edit address' : 'Save an address'}
      sub="Saved places show up when you pick the event address on an order."
      footer={
        <>
          {existing && <Button variant="danger-ghost" className="mr-auto" onClick={remove}>Remove</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button pending={form.pending} onClick={() => form.submit(() => saveCustomerAddressAction(slug, customer.id, existing?.id ?? null, form.values), (r) => { toast(r.message ?? 'Saved.'); onClose(); router.refresh(); })}>
            Save address
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Name" htmlFor="a-label" error={form.error('label')}>
            <Input id="a-label" value={form.values.label} onChange={(e) => form.set('label', e.target.value)} placeholder="Home · Cedar Park, Zilker Park…" />
          </Field>
          <Field label="Used for" htmlFor="a-kind">
            <Segmented label="Used for" value={form.values.kind} onChange={(k) => form.set('kind', k)} options={[{ value: 'event', label: 'Events' }, { value: 'billing', label: 'Billing' }]} />
          </Field>
        </div>
        <AddressBlock s={scope(form, 'address')} requireStreet />
      </div>
    </Modal>
  );
}

function CreditModal({ slug, customerId, open, onClose, currency }: { slug: string; customerId: string; open: boolean; onClose: () => void; currency: string }) {
  const router = useRouter();
  const toast = useToast();
  type C = { kind: 'rain_check' | 'wallet' | 'goodwill'; amount: string; reason: string; validUntil: string };
  const form = useForm<C>({ kind: 'goodwill', amount: '', reason: '', validUntil: '' });
  useEffect(() => {
    if (open) form.reset({ kind: 'goodwill', amount: '', reason: '', validUntil: '' });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Issue a credit"
      sub="Credits come off a later order after tax, like a rain check."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button pending={form.pending} onClick={() => form.submit(() => createCreditAction(slug, customerId, form.values), (r) => { toast(r.message ?? 'Issued.'); onClose(); router.refresh(); })}>
            Issue credit
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Kind" htmlFor="cr-kind">
          <Select id="cr-kind" value={form.values.kind} onChange={(e) => form.set('kind', e.target.value)}>
            {Object.entries(CREDIT_KINDS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={`Amount (${currency})`} htmlFor="cr-amt" error={form.error('amount')}>
            <Input id="cr-amt" mono inputMode="decimal" value={form.values.amount} onChange={(e) => form.set('amount', e.target.value)} placeholder="20.00" />
          </Field>
          <Field label="Valid until" htmlFor="cr-until" optional error={form.error('validUntil')}>
            <Input id="cr-until" type="date" value={form.values.validUntil} onChange={(e) => form.set('validUntil', e.target.value)} />
          </Field>
        </div>
        <Field label="Reason" htmlFor="cr-reason" optional>
          <Input id="cr-reason" value={form.values.reason} onChange={(e) => form.set('reason', e.target.value)} placeholder="Late setup on Jun 14" />
        </Field>
        {form.status?.kind === 'error' && <p className="text-sm font-medium text-danger">{form.status.text}</p>}
      </div>
    </Modal>
  );
}
