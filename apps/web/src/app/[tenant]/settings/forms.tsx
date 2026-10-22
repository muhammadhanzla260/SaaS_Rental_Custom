'use client';

import { useRouter } from 'next/navigation';
import { Check, Copy, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { ROLE_LABELS, ROLES, type Role } from '@rental/core';
import {
  AddressFields, BookingFields, BrandingFields, DetectedRegion, LocationFields, LogoInput, ProfileFields, scope, scopeChild,
} from '@/components/fields';
import { Badge, Button, Card, Field, Input, Notice, SaveBar, Select, Textarea, Toggle } from '@/components/ui';
import { useForm } from '@/lib/form';
import {
  deleteLocationAction, inviteAction, revokeInviteAction, saveBookingAction, saveBrandingAction, saveDocumentsAction,
  saveLocationAction, saveProfileAction, updateMemberAction,
} from '@/server/actions/settings';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Warn before leaving with unsaved edits. */
function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
}

export function ProfileForm({ slug, initial, point }: { slug: string; initial: Obj; point: { lat: number; lng: number } | null }) {
  const form = useForm(initial);
  useUnsavedGuard(form.dirty);
  const country = form.values.profile.address?.country || form.values.regional.country;
  return (
    <div className="flex flex-col gap-6">
      <Card title="Business details" description="Shown on quotes, invoices and customer emails.">
        <ProfileFields s={scope(form, 'profile')} country={country} />
      </Card>
      <Card title="Business address" description="Search and pick it, or type it in.">
        <AddressFields s={scopeChild(scope(form, 'profile'), 'address')} near={point} />
      </Card>
      <Card title="Region" description="Worked out for you. Times, reminders, money and distances use these.">
        <DetectedRegion s={scope(form, 'regional')} country={country} point={point} />
      </Card>
      <SaveBar {...form} onSave={() => form.submit(() => saveProfileAction(slug, form.values))} />
    </div>
  );
}

export function BrandingForm({ slug, initial, name, logoUrl, logoDarkUrl }: {
  slug: string; initial: Obj; name: string; logoUrl: string | null; logoDarkUrl: string | null;
}) {
  const form = useForm(initial);
  const router = useRouter();
  const [logo, setLogo] = useState<{ file: File | null; removed: boolean }>({ file: null, removed: false });
  const [logoDark, setLogoDark] = useState<{ file: File | null; removed: boolean }>({ file: null, removed: false });
  const lightUrl = useMemo(() => (logo.file ? URL.createObjectURL(logo.file) : logo.removed ? null : logoUrl), [logo, logoUrl]);
  const darkUrl = useMemo(() => (logoDark.file ? URL.createObjectURL(logoDark.file) : logoDark.removed ? null : logoDarkUrl), [logoDark, logoDarkUrl]);
  useUnsavedGuard(form.dirty);

  const save = () => {
    const fd = new FormData();
    fd.set('payload', JSON.stringify(form.values));
    if (logo.file) fd.set('logo', logo.file);
    if (logo.removed) fd.set('logoRemove', '1');
    if (logoDark.file) fd.set('logoDark', logoDark.file);
    if (logoDark.removed) fd.set('logoDarkRemove', '1');
    form.submit(() => saveBrandingAction(slug, fd), () => {
      setLogo({ file: null, removed: false });
      setLogoDark({ file: null, removed: false });
      router.refresh();
    });
  };
  const touch = () => form.set('_logos', Date.now());

  return (
    <div className="flex flex-col gap-6">
      <Card title="Logo" description="PNG, JPG, WebP or SVG, up to 1 MB. A wide logo on a transparent background works best.">
        <div className="grid gap-6 sm:grid-cols-2">
          <LogoInput id="logo-light" label="Logo" previewUrl={lightUrl}
            onFile={(f) => { setLogo({ file: f, removed: false }); touch(); }}
            onRemove={() => { setLogo({ file: null, removed: true }); touch(); }} />
          <LogoInput id="logo-dark" label="Logo for dark backgrounds" hint="Optional. Used in dark mode." previewUrl={darkUrl} dark
            onFile={(f) => { setLogoDark({ file: f, removed: false }); touch(); }}
            onRemove={() => { setLogoDark({ file: null, removed: true }); touch(); }} />
        </div>
      </Card>
      <Card title="Theme" description="Your colour and style across the app, emails, quotes and invoices.">
        <BrandingFields s={scope(form, '')} name={name} logoUrl={lightUrl} />
      </Card>
      <SaveBar {...form} onSave={save} />
    </div>
  );
}

export function BookingForm({ slug, initial, currency, distanceUnit }: { slug: string; initial: Obj; currency: string; distanceUnit: 'mi' | 'km' }) {
  const form = useForm(initial);
  useUnsavedGuard(form.dirty);
  return (
    <div className="flex flex-col gap-6">
      <Card title="Booking rules" description="Defaults for new quotes. Staff with permission can change them on a single order.">
        <BookingFields s={scope(form, '')} currency={currency} distanceUnit={distanceUnit} />
      </Card>
      <SaveBar {...form} onSave={() => form.submit(() => saveBookingAction(slug, form.values))} />
    </div>
  );
}

export function DocumentsForm({ slug, initial }: { slug: string; initial: Obj }) {
  const form = useForm(initial);
  const [alerts, setAlerts] = useState((initial.communication.internalAlertEmails as string[]).join(', '));
  useUnsavedGuard(form.dirty);
  const n = form.values.numbering;
  return (
    <div className="flex flex-col gap-6">
      <Card title="Document numbers" description={`Next quote: ${n.quotePrefix}00001 · invoice: ${n.invoicePrefix}00001 · receipt: ${n.receiptPrefix}00001`}>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['quotePrefix', 'invoicePrefix', 'receiptPrefix'] as const).map((k) => (
            <Field key={k} label={{ quotePrefix: 'Quote prefix', invoicePrefix: 'Invoice prefix', receiptPrefix: 'Receipt prefix' }[k]} htmlFor={k} error={form.error(`numbering.${k}`)}>
              <Input id={k} value={n[k]} maxLength={12} className="font-mono uppercase" onChange={(e) => form.set(`numbering.${k}`, e.target.value.toUpperCase())} />
            </Field>
          ))}
        </div>
      </Card>
      <Card title="Customer emails" description="Sender details for quotes, invoices and reminders. Connecting your own email server arrives in Phase 2.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sender name" htmlFor="senderName" optional hint="For example: Freedom Fun USA Team">
            <Input id="senderName" value={form.values.communication.senderName ?? ''} onChange={(e) => form.set('communication.senderName', e.target.value)} />
          </Field>
          <Field label="Reply-to email" htmlFor="replyTo" optional error={form.error('communication.replyToEmail')}>
            <Input id="replyTo" type="email" inputMode="email" value={form.values.communication.replyToEmail ?? ''} onChange={(e) => form.set('communication.replyToEmail', e.target.value)} />
          </Field>
          <Field label="Staff alert emails" htmlFor="alerts" optional className="sm:col-span-2"
            hint="Declined cards, last-minute bookings and tomorrow's events. Separate addresses with commas."
            error={Object.entries(form.errors).find(([k]) => k.startsWith('communication.internalAlertEmails'))?.[1]}>
            <Input id="alerts" value={alerts} onChange={(e) => {
              setAlerts(e.target.value);
              form.set('communication.internalAlertEmails', e.target.value.split(',').map((x) => x.trim()).filter(Boolean));
            }} />
          </Field>
          <Field label="Email footer" htmlFor="footer" optional className="sm:col-span-2" hint="Added to the bottom of every customer email.">
            <Textarea id="footer" value={form.values.communication.emailFooter ?? ''} onChange={(e) => form.set('communication.emailFooter', e.target.value)} />
          </Field>
        </div>
      </Card>
      <SaveBar {...form} onSave={() => form.submit(() => saveDocumentsAction(slug, form.values))} />
    </div>
  );
}

export function LocationForm({ slug, id, initial, country, canDelete, near }: {
  slug: string; id: string | null; initial: Obj; country: string; canDelete?: boolean; near?: { lat: number; lng: number } | null;
}) {
  const form = useForm(initial);
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useUnsavedGuard(form.dirty);
  return (
    <div className="flex flex-col gap-6">
      <Card title="Location" description="A place your equipment ships from. Delivery distance is measured from its pin.">
        <LocationFields s={scope(form, 'location')} country={country} near={near} />
      </Card>
      <Card title="Tax and status">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sales tax for this location" htmlFor="taxPercent" error={form.error('taxPercent')}>
            <div className="flex">
              <Input id="taxPercent" type="number" inputMode="decimal" step="0.001" min={0} value={form.values.taxPercent} className="rounded-r-none tabular"
                onChange={(e) => form.set('taxPercent', e.target.value === '' ? '' : Number(e.target.value))} />
              <span className="grid place-items-center rounded-r-ui-sm border border-l-0 border-line-strong bg-surface-2 px-3 text-sm text-muted">%</span>
            </div>
          </Field>
          <div className="flex flex-col gap-3">
            <Toggle id="primary" checked={!!form.values.location.isPrimary} onChange={(x) => form.set('location.isPrimary', x)}
              label="Primary location" description="The default ship-from point. Only one location can be primary." />
            <Toggle id="active" checked={!!form.values.location.isActive} onChange={(x) => form.set('location.isActive', x)}
              label="Takes bookings" description="Turn off to hide it from new bookings." />
          </div>
        </div>
      </Card>
      {id && canDelete && (
        <Card title="Remove location" description="Removes it from future bookings. This cannot be undone.">
          {deleteError && <div className="mb-3"><Notice kind="error">{deleteError}</Notice></div>}
          {confirm ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">Remove {form.values.location.name} for good?</span>
              <Button type="button" variant="danger" size="sm" pending={deleting} onClick={() =>
                startDelete(async () => {
                  const r = await deleteLocationAction(slug, id);
                  if (r.ok) router.push(`/${slug}/settings/locations`);
                  else setDeleteError(r.error);
                })}>
                <Trash2 aria-hidden className="size-4" /> Yes, remove it
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm(false)}>Keep it</Button>
            </div>
          ) : (
            <Button type="button" variant="danger" size="sm" onClick={() => setConfirm(true)}>
              <Trash2 aria-hidden className="size-4" /> Remove location
            </Button>
          )}
        </Card>
      )}
      <SaveBar {...form} label={id ? 'Save location' : 'Add location'} onSave={() =>
        form.submit(() => saveLocationAction(slug, id, form.values), (r) => {
          if (!id && r.data) router.push(`/${slug}/settings/locations/${r.data.id}`);
          else router.refresh();
        })} />
    </div>
  );
}

type Member = { id: string; name: string; email: string; role: Role; status: string; userId: string };
type Invite = { id: string; email: string; role: Role; expiresAt: string };

export function TeamPanel({ slug, me, myRole, members, invites }: { slug: string; me: string; myRole: Role; members: Member[]; invites: Invite[] }) {
  const router = useRouter();
  const form = useForm({ email: '', role: 'sales' });
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rowMsg, setRowMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const assignable = ROLES.filter((r) => r !== 'owner' || myRole === 'owner');

  const change = (id: string, patch: Obj) =>
    start(async () => {
      const r = await updateMemberAction(slug, id, patch);
      setRowMsg(r.ok ? { kind: 'ok', text: r.message ?? 'Saved.' } : { kind: 'error', text: r.error });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <Card title="Invite someone" description="They get a link to join. Email delivery arrives with your email server in Phase 2, so copy the link for now.">
        <form
          className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setLink(null);
            form.submit(() => inviteAction(slug, form.values), (r) => {
              setLink(r.data?.link ?? null);
              form.setValues({ email: '', role: form.values.role });
              router.refresh();
            });
          }}
        >
          <Field label="Email" htmlFor="invite-email" error={form.error('email')}>
            <Input id="invite-email" type="email" inputMode="email" value={form.values.email} onChange={(e) => form.set('email', e.target.value)} />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select id="invite-role" value={form.values.role} onChange={(e) => form.set('role', e.target.value)}>
              {ROLES.filter((r) => r !== 'owner').map((r) => <option key={r} value={r}>{ROLE_LABELS[r].label}</option>)}
            </Select>
          </Field>
          <Button type="submit" pending={form.pending}><UserPlus aria-hidden className="size-4" /> Create invite</Button>
        </form>
        <p className="mt-2 text-sm text-muted">{ROLE_LABELS[form.values.role as Role].description}</p>
        {form.status?.kind === 'error' && <div className="mt-3"><Notice kind="error">{form.status.text}</Notice></div>}
        {link && (
          <div className="mt-4 flex flex-col gap-2 rounded-ui-sm bg-ok-soft p-3">
            <p className="text-sm font-medium text-ok">Invitation ready. Send this link to them; it works for 7 days.</p>
            <div className="flex gap-2">
              <Input readOnly value={link} className="font-mono text-sm" onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" />
              <Button type="button" variant="secondary" onClick={async () => {
                try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
              }}>
                {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />} {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Members" description={`${members.length} ${members.length === 1 ? 'person' : 'people'}`}>
        {rowMsg && <div className="mb-3"><Notice kind={rowMsg.kind}>{rowMsg.text}</Notice></div>}
        <ul className="-my-3 divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text">
                {m.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.name} {m.userId === me && <span className="font-normal text-muted">(you)</span>}</p>
                <p className="truncate text-sm text-muted">{m.email}</p>
              </div>
              {m.status === 'disabled' && <Badge tone="danger">Disabled</Badge>}
              <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.name}</label>
              <Select id={`role-${m.id}`} value={m.role} disabled={pending || (m.role === 'owner' && myRole !== 'owner')} className="w-36"
                onChange={(e) => change(m.id, { role: e.target.value })}>
                {(m.role === 'owner' && myRole !== 'owner' ? ROLES : assignable).map((r) => <option key={r} value={r}>{ROLE_LABELS[r].label}</option>)}
              </Select>
              {m.userId !== me && (
                <Button type="button" variant="ghost" size="sm" disabled={pending}
                  onClick={() => change(m.id, { status: m.status === 'disabled' ? 'active' : 'disabled' })}>
                  {m.status === 'disabled' ? 'Enable' : 'Disable'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {invites.length > 0 && (
        <Card title="Pending invitations">
          <ul className="-my-3 divide-y divide-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.email}</p>
                  <p className="text-sm text-muted">{ROLE_LABELS[i.role].label} · expires {new Date(i.expiresAt).toLocaleDateString()}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={pending}
                  onClick={() => start(async () => { await revokeInviteAction(slug, i.id); router.refresh(); })}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
