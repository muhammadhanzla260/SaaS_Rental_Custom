'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { HOW_HEARD } from '@rental/core';
import { AddressFields, PhoneField, scope, scopeChild } from '@/components/fields';
import { Button, Card, Field, Input, Notice, SaveBar, Segmented, Select, Textarea, Toggle } from '@/components/ui';
import { useForm } from '@/lib/form';
import { saveCustomerAction } from '@/server/actions/commerce';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function CustomerForm({ slug, id, initial, country, near }: {
  slug: string; id: string | null; initial: Obj; country: string; near: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const form = useForm<Obj>(initial);
  const v = form.values;
  const [dupes, setDupes] = useState<{ id: string; name: string }[]>([]);
  const s = scope(form, '');

  const save = (allowDuplicate = false) =>
    form.submit(() => saveCustomerAction(slug, id, v, { allowDuplicate }).then((r) => {
      if (!r.ok && r.fieldErrors?._duplicate) {
        setDupes(r.fieldErrors._duplicate.split(',').map((x) => { const [did, name] = x.split('|'); return { id: did!, name: name! }; }));
      } else setDupes([]);
      return r;
    }), (r) => {
      if (!id && r.data) router.push(`/${slug}/customers/${r.data.id}`);
      else router.refresh();
    });

  const text = (name: string, label: string, opts: { type?: string; optional?: boolean; auto?: string } = {}) => (
    <Field label={label} htmlFor={`c-${name}`} error={form.error(name)} optional={opts.optional}>
      <Input id={`c-${name}`} type={opts.type ?? 'text'} autoComplete={opts.auto} value={v[name] ?? ''} onChange={(e) => form.set(name, e.target.value)} aria-invalid={!!form.error(name)} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      {dupes.length > 0 && (
        <Notice kind="warn">
          <span className="block">{form.status?.text}</span>
          <span className="mt-2 flex flex-wrap gap-2">
            {dupes.map((d) => <Link key={d.id} href={`/${slug}/customers/${d.id}`} className="font-semibold underline">Open {d.name}</Link>)}
            <Button type="button" size="sm" variant="secondary" onClick={() => save(true)}>Save anyway</Button>
          </span>
        </Notice>
      )}
      <Card title="Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-sm font-medium">Customer type</span>
            <Segmented id="c-kind" label="Customer type" value={v.kind} onChange={(k) => form.set('kind', k)}
              options={[{ value: 'individual', label: 'Person' }, { value: 'organization', label: 'Company, school or HOA' }]} />
          </div>
          {text('firstName', 'First name', { auto: 'given-name' })}
          {text('lastName', 'Last name', { optional: true, auto: 'family-name' })}
          {v.kind === 'organization' && <div className="sm:col-span-2">{text('companyName', 'Company or organization')}</div>}
          {text('email', 'Email', { type: 'email', optional: true, auto: 'email' })}
          <PhoneField s={s} name="phone" label="Mobile" country={country} />
          <PhoneField s={s} name="phoneSecondary" label="Second phone" country={country} />
          <Field label="How did they hear about you" htmlFor="c-source" optional>
            <Select id="c-source" value={v.source ?? ''} onChange={(e) => form.set('source', e.target.value)}>
              <option value="">Not asked</option>
              {HOW_HEARD.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="Billing address" description="Start typing and pick the address. Parties often happen here too.">
        <AddressFields s={scopeChild(s, 'address')} near={near} />
      </Card>
      <Card title="Notes and preferences">
        <div className="grid gap-4">
          <Field label="Internal notes" htmlFor="c-notes" optional hint="Only your team sees these.">
            <Textarea id="c-notes" value={v.notes ?? ''} onChange={(e) => form.set('notes', e.target.value)} />
          </Field>
          <Toggle id="c-sms" checked={!!v.smsOptIn} onChange={(x) => form.set('smsOptIn', x)} label="Text message updates" description="Event reminders and crew arrival texts." />
          <Toggle id="c-tax" checked={!!v.taxExempt} onChange={(x) => form.set('taxExempt', x)} label="Tax exempt" description="Schools, churches and non-profits with a certificate." />
        </div>
      </Card>
      <SaveBar {...form} status={dupes.length ? null : form.status} label={id ? 'Save customer' : 'Add customer'} onSave={() => save(false)} />
    </div>
  );
}
