'use client';

import { useEffect, useRef, useState } from 'react';
import { CUSTOMER_TAGS, formatPhone, HOW_HEARD, type CustomerFormValues } from '@rental/core';
import { AddressBlock } from '@/components/fields/address';
import { scope } from '@/components/fields/scope';
import { Button, cx, Drawer, Field, Input, Notice, Segmented, Select, Textarea, Toggle, useToast } from '@/components/kit';
import { useForm } from '@/lib/form';
import { saveCustomerAction, searchCustomersAction, type CustomerHit } from '@/server/actions/commerce';

export type CustomerDraft = {
  kind: 'individual' | 'organization';
  firstName: string; lastName: string; companyName: string; email: string; phone: string; phoneSecondary: string;
  address: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string; lat?: number; lng?: number };
  source: string; referredByCustomerId: string | null; referredByName: string; notes: string; tags: string[];
  smsOptIn: boolean; marketingOptIn: boolean; taxExempt: boolean;
};

export function blankCustomer(country = 'US'): CustomerDraft {
  return {
    kind: 'individual', firstName: '', lastName: '', companyName: '', email: '', phone: '', phoneSecondary: '',
    address: { line1: '', line2: '', city: '', region: '', postalCode: '', country }, source: '', referredByCustomerId: null, referredByName: '',
    notes: '', tags: [], smsOptIn: true, marketingOptIn: false, taxExempt: false,
  };
}

/** Existing customer → form values (phones shown formatted). */
export function customerDraft(c: {
  kind: string; firstName: string | null; lastName: string | null; companyName: string | null; email: string | null; phone: string | null;
  phoneSecondary: string | null; line1: string | null; line2: string | null; city: string | null; region: string | null; postalCode: string | null;
  country: string; lat: number | null; lng: number | null; source: string | null; referredByCustomerId: string | null; notes: string | null;
  tags: string[]; smsOptIn: boolean; marketingOptIn: boolean; taxExempt: boolean;
}, referredByName = ''): CustomerDraft {
  return {
    kind: c.kind === 'organization' ? 'organization' : 'individual', firstName: c.firstName ?? '', lastName: c.lastName ?? '', companyName: c.companyName ?? '',
    email: c.email ?? '', phone: formatPhone(c.phone, c.country), phoneSecondary: formatPhone(c.phoneSecondary, c.country),
    address: { line1: c.line1 ?? '', line2: c.line2 ?? '', city: c.city ?? '', region: c.region ?? '', postalCode: c.postalCode ?? '', country: c.country, lat: c.lat ?? undefined, lng: c.lng ?? undefined },
    source: c.source ?? '', referredByCustomerId: c.referredByCustomerId, referredByName, notes: c.notes ?? '', tags: c.tags,
    smsOptIn: c.smsOptIn, marketingOptIn: c.marketingOptIn, taxExempt: c.taxExempt,
  };
}

export function toCustomerPayload(d: CustomerDraft): CustomerFormValues {
  const { referredByName: _name, ...rest } = d;
  return rest as unknown as CustomerFormValues;
}

/**
 * Add or edit a customer. Duplicate emails and phones are caught: the person can
 * open the existing customer or save anyway.
 */
export function CustomerFormDrawer({
  open, onClose, slug, editing, onSaved, country = 'US',
}: {
  open: boolean; onClose: () => void; slug: string; editing: { id: string; draft: CustomerDraft } | null;
  onSaved: (c: { id: string; name: string }) => void; country?: string;
}) {
  const toast = useToast();
  const form = useForm<CustomerDraft>(blankCustomer(country));
  const v = form.values;
  const [dupe, setDupe] = useState<{ id: string; name: string } | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  useEffect(() => {
    if (!open) return;
    setDupe(null);
    setTagDraft('');
    form.reset(editing?.draft ?? blankCustomer(country));
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(allowDuplicate = false) {
    form.submit(
      () => saveCustomerAction(slug, editing?.id ?? null, toCustomerPayload(v), { allowDuplicate }),
      (r) => {
        toast(r.message ?? 'Saved.');
        onSaved({ id: r.data!.id, name: r.data!.name });
      },
    );
  }
  useEffect(() => {
    const d = form.errors._duplicate;
    if (!d) return setDupe(null);
    const [id, name] = d.split('|');
    setDupe({ id: id!, name: name ?? 'Another customer' });
  }, [form.errors._duplicate]);

  const toggleTag = (t: string) => form.set('tags', v.tags.includes(t) ? v.tags.filter((x) => x !== t) : [...v.tags, t]);
  const org = v.kind === 'organization';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={editing ? 'Edit customer' : 'Add customer'}
      sub={editing ? undefined : 'Saved once, reused on every order. Billing details can still change per order.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save(false)} pending={form.pending}>{editing ? 'Save customer' : 'Add customer'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {form.status?.kind === 'error' && !dupe && <Notice kind="danger">{form.status.text}</Notice>}
        {dupe && (
          <Notice kind="warning">
            <span className="block">{form.status?.text}</span>
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => onSaved({ id: dupe.id, name: dupe.name })}>Use {dupe.name}</Button>
              <Button size="sm" variant="ghost" onClick={() => save(true)}>Save anyway</Button>
            </span>
          </Notice>
        )}
        <Segmented label="Customer type" value={v.kind} onChange={(k) => form.set('kind', k)}
          options={[{ value: 'individual', label: 'Person' }, { value: 'organization', label: 'Organization' }]} />
        {org && (
          <Field label="Organization name" htmlFor="c-company" error={form.error('companyName')}>
            <Input id="c-company" value={v.companyName} onChange={(e) => form.set('companyName', e.target.value)} placeholder="Oak Hill Elementary PTA" autoFocus />
          </Field>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={org ? 'Contact first name' : 'First name'} htmlFor="c-first" error={form.error('firstName')} optional={org}>
            <Input id="c-first" value={v.firstName} onChange={(e) => form.set('firstName', e.target.value)} autoComplete="given-name" autoFocus={!org} invalid={!!form.error('firstName')} />
          </Field>
          <Field label={org ? 'Contact last name' : 'Last name'} htmlFor="c-last" optional={org}>
            <Input id="c-last" value={v.lastName} onChange={(e) => form.set('lastName', e.target.value)} autoComplete="family-name" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="c-email" error={form.error('email')}>
            <Input id="c-email" type="email" inputMode="email" value={v.email} onChange={(e) => form.set('email', e.target.value)} autoComplete="email" invalid={!!form.error('email')} />
          </Field>
          <Field label="Mobile" htmlFor="c-phone" error={form.error('phone')}>
            <Input id="c-phone" type="tel" inputMode="tel" value={v.phone} onChange={(e) => form.set('phone', e.target.value)} autoComplete="tel" invalid={!!form.error('phone')} placeholder="(512) 555-0142" />
          </Field>
        </div>
        <Field label="Second phone" htmlFor="c-phone2" optional error={form.error('phoneSecondary')}>
          <Input id="c-phone2" type="tel" inputMode="tel" value={v.phoneSecondary} onChange={(e) => form.set('phoneSecondary', e.target.value)} />
        </Field>
        <div className="flex flex-col gap-3 border-t border-subtle pt-5">
          <p className="text-sm font-semibold text-fg">Billing address <span className="font-normal text-fg-2">(optional)</span></p>
          <AddressBlock s={scope(form, 'address')} showMap={false} />
        </div>
        <div className="grid grid-cols-1 gap-4 border-t border-subtle pt-5 sm:grid-cols-2">
          <Field label="How they heard about you" htmlFor="c-source" optional>
            <Select id="c-source" value={v.source} onChange={(e) => form.set('source', e.target.value)}>
              <option value="">Not asked</option>
              {HOW_HEARD.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </Field>
          <Field label="Referred by" htmlFor="c-ref" optional>
            <CustomerSearch
              id="c-ref"
              slug={slug}
              value={v.referredByCustomerId ? { id: v.referredByCustomerId, name: v.referredByName } : null}
              exceptId={editing?.id}
              onChange={(c) => { form.set('referredByCustomerId', c?.id ?? null); form.set('referredByName', c?.name ?? ''); }}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-semibold text-fg">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...CUSTOMER_TAGS, ...v.tags])].map((t) => {
              const on = v.tags.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => toggleTag(t)}
                  className={cx('press h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors', on ? 'border-night bg-night text-white dark:border-fg dark:bg-fg dark:text-night' : 'border-control bg-surface text-fg hover:border-fg-3')}>
                  {t}
                </button>
              );
            })}
            <form className="flex" onSubmit={(e) => { e.preventDefault(); const t = tagDraft.trim(); if (t && !v.tags.includes(t)) form.set('tags', [...v.tags, t.slice(0, 30)]); setTagDraft(''); }}>
              <Input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} placeholder="+ Tag" aria-label="New tag" className="h-8 w-28 rounded-full text-[13px]" />
            </form>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-subtle pt-5">
          <Toggle checked={v.taxExempt} onChange={(x) => form.set('taxExempt', x)} label="Tax exempt" sub="Orders for this customer charge no sales tax (keep their certificate on file)." />
          <Toggle checked={v.smsOptIn} onChange={(x) => form.set('smsOptIn', x)} label="Event reminders by text" />
          <Toggle checked={v.marketingOptIn} onChange={(x) => form.set('marketingOptIn', x)} label="Marketing emails" sub="Only with their consent." />
        </div>
        <Field label="Notes" htmlFor="c-notes" optional hint="Only your team sees these.">
          <Textarea id="c-notes" value={v.notes} onChange={(e) => form.set('notes', e.target.value)} rows={3} />
        </Field>
      </div>
    </Drawer>
  );
}

/** Search-as-you-type customer picker (debounced). */
export function CustomerSearch({
  id, slug, value, onChange, exceptId, placeholder = 'Search customers',
}: {
  id?: string; slug: string; value: { id: string; name: string } | null; onChange: (c: CustomerHit | { id: string; name: string } | null) => void;
  exceptId?: string; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) return setHits([]);
    timer.current = setTimeout(async () => {
      const r = await searchCustomersAction(slug, q);
      if (r.ok) setHits((r.data ?? []).filter((h) => h.id !== exceptId));
    }, 220);
  }, [q, slug, exceptId]);
  if (value) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-[var(--radius-control)] border border-control bg-sunken/50 px-3 text-sm max-sm:h-11">
        <span className="truncate font-semibold text-fg">{value.name}</span>
        <button type="button" onClick={() => onChange(null)} className="text-[13px] font-semibold text-accent-text hover:underline">Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input id={id} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open && hits.length > 0} aria-controls={id ? `${id}-list` : undefined} />
      {open && hits.length > 0 && (
        <ul id={id ? `${id}-list` : undefined} role="listbox" className="anim-fade absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-[var(--radius-card)] border border-subtle bg-surface p-1 shadow-[var(--shadow-float)]">
          {hits.map((h) => (
            <li key={h.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(h); setQ(''); setOpen(false); }}
                className="flex w-full flex-col rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-hover">
                <span className="text-sm font-semibold text-fg">{h.name}</span>
                <span className="truncate text-xs text-fg-2">{[h.email, h.phone ? formatPhone(h.phone) : null].filter(Boolean).join(' · ') || 'No contact details'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
