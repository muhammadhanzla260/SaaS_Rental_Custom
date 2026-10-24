'use client';

import { useRouter } from 'next/navigation';
import { Check, Copy, Download, ExternalLink, Pause, Pencil, Play, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { CURRENCIES, SIGNUP_COUNTRIES, slugify } from '@rental/core';
import {
  AffixInput, Avatar, Button, Card, Checkbox, cx, Drawer, Field, FilterChips, IconButton, Input, Kpi, Modal, Notice,
  PageTitle, Pill, Progress, Segmented, Select, Textarea, useToast, type Tone,
} from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { TimezoneSelect } from '@/components/fields/timezone-select';
import {
  checkSlugAction, closeOrgAction, createOrgAction, restoreOrgAction, setOrgStatusAction, startSupportSessionAction, updateOrgAction,
} from '@/server/actions/platform';

type Status = 'trial' | 'active' | 'past_due' | 'suspended' | 'closed';
type Plan = 'starter' | 'growth' | 'scale';
export type ConsoleOrg = {
  id: string; slug: string; name: string; status: Status; plan: Plan; rolloutPhase: number; createdAt: string;
  onboardedAt: string | null; onboardingPercent: number; brandColor: string; logoUrl: string | null; timezone: string;
  currency: string; country: string; closedAt: string | null; purgeAfter: string | null; ownerName: string | null;
  ownerEmail: string | null; ownerPending: boolean; users: number; locations: number;
};

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'success' },
  trial: { label: 'Trial', tone: 'info' },
  past_due: { label: 'Past due', tone: 'warning' },
  suspended: { label: 'Suspended', tone: 'danger' },
  closed: { label: 'Closed', tone: 'neutral' },
};
const PLAN_LABEL: Record<Plan, string> = { starter: 'Starter', growth: 'Growth', scale: 'Scale' };

function PlanChip({ plan }: { plan: Plan }) {
  return (
    <span className={cx('inline-flex h-7 items-center rounded-lg px-2.5 text-[13px] font-semibold', plan === 'scale' ? 'bg-night text-volt' : plan === 'growth' ? 'bg-info-bg text-info-fg' : 'bg-neutral-bg text-neutral-fg')}>
      {PLAN_LABEL[plan]}
    </span>
  );
}

function Rollout({ o }: { o: ConsoleOrg }) {
  const live = !!o.onboardedAt;
  return (
    <div className="flex min-w-[140px] flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="font-semibold text-fg">{live ? `Live · Phase ${o.rolloutPhase}` : 'Onboarding'}</span>
        {!live && <span className="mono text-xs text-fg-2">{o.onboardingPercent}%</span>}
      </div>
      <Progress value={live ? 100 : o.onboardingPercent} tone={live ? 'success' : 'accent'} label={live ? 'Live' : `Onboarding ${o.onboardingPercent}%`} />
    </div>
  );
}

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

type Draft = {
  name: string; slug: string; timezone: string; currency: string; country: string; plan: Plan;
  status: 'trial' | 'active' | 'past_due' | 'suspended'; ownerName: string; ownerEmail: string; sendInvite: boolean;
};
const blankDraft = (): Draft => ({
  name: '', slug: '', timezone: 'America/Chicago', currency: 'USD', country: 'US', plan: 'growth', status: 'trial', ownerName: '', ownerEmail: '', sendInvite: true,
});

function useSlugCheck(slug: string, current?: string) {
  const [state, setState] = useState<'idle' | 'checking' | 'free' | 'taken' | 'invalid'>('idle');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!slug || slug === current) return setState('idle');
    setState('checking');
    const t = setTimeout(async () => {
      const r = await checkSlugAction(slug);
      if (!r.ok) { setState('invalid'); setMsg(r.error); return; }
      setState(r.data?.available ? 'free' : 'taken');
    }, 300);
    return () => clearTimeout(t);
  }, [slug, current]);
  return { state, msg };
}

function OrgDrawer({ open, onClose, editing, domain, onCreated }: { open: boolean; onClose: () => void; editing: ConsoleOrg | null; domain: string; onCreated: (r: { inviteUrl: string; emailed: boolean; name: string; email: string }) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState<Draft>(blankDraft);
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    if (editing) {
      setD({
        name: editing.name, slug: editing.slug, timezone: editing.timezone, currency: editing.currency, country: editing.country, plan: editing.plan,
        status: editing.status === 'closed' ? 'trial' : editing.status, ownerName: editing.ownerName ?? '', ownerEmail: editing.ownerEmail ?? '', sendInvite: false,
      });
      setSlugTouched(true);
    } else {
      setD(blankDraft());
      setSlugTouched(false);
    }
  }, [open, editing]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (!slugTouched) set('slug', slugify(d.name)); }, [d.name, slugTouched]);
  const slug = useSlugCheck(d.slug, editing?.slug);

  const save = () =>
    start(async () => {
      setFormError(null);
      if (slug.state === 'taken') { setErrors({ slug: 'That workspace URL is already taken.' }); return; }
      const r = editing
        ? await updateOrgAction(editing.id, { name: d.name, slug: d.slug, timezone: d.timezone, currency: d.currency, plan: d.plan, status: d.status })
        : await createOrgAction(d);
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        return;
      }
      toast(r.message ?? 'Saved.');
      onClose();
      router.refresh();
      if (!editing && r.data) {
        const data = r.data as { inviteUrl: string; emailed: boolean };
        onCreated({ inviteUrl: data.inviteUrl, emailed: data.emailed, name: d.name, email: d.ownerEmail });
      }
    });

  const slugHint =
    slug.state === 'checking' ? 'Checking…' : slug.state === 'free' ? '✓ Available' : slug.state === 'taken' ? 'Taken' : slug.state === 'invalid' ? slug.msg : 'Lowercase letters, numbers and dashes.';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : 'New organization'}
      sub={editing ? 'Business details and subscription.' : 'Creates the workspace and invites its owner.'}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} pending={pending}>{editing ? 'Save changes' : 'Create organization'}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        {formError && <Notice kind="danger">{formError}</Notice>}
        <section className="flex flex-col gap-4">
          <h3 className="eyebrow">Business</h3>
          <Field label="Business name" htmlFor="o-name" error={errors.name}>
            <Input id="o-name" value={d.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} placeholder="Lakeside Party Rentals" />
          </Field>
          <Field label="Workspace URL" htmlFor="o-slug" error={errors.slug} hint={<span className={cx(slug.state === 'free' && 'text-success', (slug.state === 'taken' || slug.state === 'invalid') && 'text-danger')}>{slugHint}</span>}>
            <AffixInput id="o-slug" mono value={d.slug} suffix={`.${domain}`} invalid={!!errors.slug || slug.state === 'taken'} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Time zone" htmlFor="o-tz" error={errors.timezone}>
              <TimezoneSelect id="o-tz" value={d.timezone} onChange={(v) => set('timezone', v)} />
            </Field>
            <Field label="Currency" htmlFor="o-cur">
              <Select id="o-cur" value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{`${c.code} — ${c.name}`}</option>)}
              </Select>
            </Field>
            {!editing && (
              <Field label="Country" htmlFor="o-country" className="sm:col-span-2">
                <Select id="o-country" value={d.country} onChange={(e) => set('country', e.target.value)}>
                  {SIGNUP_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="eyebrow">Owner</h3>
          {editing ? (
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-sunken p-3">
              <Avatar name={editing.ownerName ?? '?'} size={36} />
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-fg">{editing.ownerName ?? 'No owner yet'}</p>
                <p className="truncate text-fg-2">{editing.ownerEmail ?? '—'}{editing.ownerPending && ' · invite pending'}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" htmlFor="o-owner" error={errors.ownerName}>
                <Input id="o-owner" value={d.ownerName} onChange={(e) => set('ownerName', e.target.value)} invalid={!!errors.ownerName} autoComplete="off" />
              </Field>
              <Field label="Email" htmlFor="o-email" error={errors.ownerEmail}>
                <Input id="o-email" type="email" value={d.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} invalid={!!errors.ownerEmail} autoComplete="off" />
              </Field>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="eyebrow">Subscription</h3>
          <Field label="Plan">
            <Segmented label="Plan" fill value={d.plan} onChange={(v) => set('plan', v)} options={[{ value: 'starter', label: 'Starter' }, { value: 'growth', label: 'Growth' }, { value: 'scale', label: 'Scale' }]} />
          </Field>
          <Field label="Status" htmlFor="o-status">
            <Select id="o-status" value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
              <option value="trial">Trial</option>
              <option value="active">Active</option>
              <option value="past_due">Past due</option>
              {editing && <option value="suspended">Suspended</option>}
            </Select>
          </Field>
          {!editing && (
            <Checkbox checked={d.sendInvite} onChange={(v) => set('sendInvite', v)}>
              Email the owner an invite (they set a password and land in onboarding).
            </Checkbox>
          )}
        </section>
      </div>
    </Drawer>
  );
}

export function OrgsConsole({ orgs, domain }: { orgs: ConsoleOrg[]; domain: string }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [q, setQ] = useState('');
  const [drawer, setDrawer] = useState<{ open: boolean; editing: ConsoleOrg | null }>({ open: false, editing: null });
  const [del, setDel] = useState<ConsoleOrg | null>(null);
  const [typed, setTyped] = useState('');
  const [support, setSupport] = useState<ConsoleOrg | null>(null);
  const [reason, setReason] = useState('');
  const [created, setCreated] = useState<{ inviteUrl: string; emailed: boolean; name: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orgs.length };
    for (const o of orgs) c[o.status] = (c[o.status] ?? 0) + 1;
    return c;
  }, [orgs]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return orgs.filter(
      (o) => (filter === 'all' || o.status === filter) && (!t || [o.name, o.slug, o.ownerName, o.ownerEmail].some((x) => x?.toLowerCase().includes(t))),
    );
  }, [orgs, filter, q]);

  const act = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) { setError(r.error ?? 'Something went wrong.'); toast(r.error, 'error'); return; }
      if (r.message) toast(r.message);
      after?.();
      router.refresh();
    });

  const exportCsv = () => {
    const head = ['Organization', 'URL', 'Owner', 'Owner email', 'Plan', 'Status', 'Rollout', 'Users', 'Locations', 'Created'];
    const lines = orgs.map((o) => [
      o.name, `${o.slug}.${domain}`, o.ownerName ?? '', o.ownerEmail ?? '', PLAN_LABEL[o.plan], STATUS[o.status].label,
      o.onboardedAt ? `Live · Phase ${o.rolloutPhase}` : `Onboarding ${o.onboardingPercent}%`, o.users, o.locations, o.createdAt.slice(0, 10),
    ]);
    const csv = [head, ...lines].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `organizations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const kpi = {
    active: counts.active ?? 0,
    trial: counts.trial ?? 0,
    attention: (counts.past_due ?? 0) + (counts.suspended ?? 0),
  };

  const actions = (o: ConsoleOrg) => (
    <div className="flex items-center gap-1">
      {o.status !== 'closed' && (
        <IconButton label={`Open ${o.name} (support, read-only)`} className="border-transparent bg-transparent" onClick={() => { setReason(''); setSupport(o); }}>
          <ExternalLink className="size-4" />
        </IconButton>
      )}
      {o.status !== 'closed' && (
        <IconButton label={`Edit ${o.name}`} className="border-transparent bg-transparent" onClick={() => setDrawer({ open: true, editing: o })}>
          <Pencil className="size-4" />
        </IconButton>
      )}
      {o.status === 'suspended' ? (
        <IconButton label={`Reactivate ${o.name}`} className="border-transparent bg-transparent" disabled={pending} onClick={() => act(() => setOrgStatusAction(o.id, o.onboardedAt ? 'active' : 'trial'))}>
          <Play className="size-4" />
        </IconButton>
      ) : o.status !== 'closed' ? (
        <IconButton label={`Suspend ${o.name}`} className="border-transparent bg-transparent" disabled={pending} onClick={() => act(() => setOrgStatusAction(o.id, 'suspended'))}>
          <Pause className="size-4" />
        </IconButton>
      ) : null}
      {o.status === 'closed' ? (
        <IconButton label={`Restore ${o.name}`} className="border-transparent bg-transparent" disabled={pending} onClick={() => act(() => restoreOrgAction(o.id))}>
          <RotateCcw className="size-4" />
        </IconButton>
      ) : (
        <IconButton label={`Delete ${o.name}`} className="border-transparent bg-transparent hover:border-danger/30 hover:bg-danger-bg hover:text-danger" onClick={() => { setTyped(''); setDel(o); }}>
          <Trash2 className="size-4" />
        </IconButton>
      )}
    </div>
  );

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Platform', href: '/console' }, { label: 'Organizations' }]}
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} className="max-sm:hidden">Export CSV</Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setDrawer({ open: true, editing: null })}>
              <span className="max-sm:hidden">New organization</span>
              <span className="sm:hidden">New</span>
            </Button>
          </>
        }
      />
      <PageBody wide>
        <PageTitle title="Organizations" sub="Every rental business registered on the platform. Create, edit, suspend or remove them here." />

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Kpi label="Organizations" value={orgs.length} sub="Registered on the platform" />
          <Kpi label="Active" value={kpi.active} tone="success" sub="Paying and live" style={{ ['--d' as string]: '50ms' }} />
          <Kpi label="On trial" value={kpi.trial} tone="info" sub="Still onboarding or evaluating" style={{ ['--d' as string]: '100ms' }} />
          <Kpi label="Needs attention" value={kpi.attention} tone="warning" sub="Past due or suspended" style={{ ['--d' as string]: '150ms' }} />
        </div>

        {error && <Notice kind="danger" className="mb-4">{error}</Notice>}

        <Card className="anim-rise overflow-hidden" style={{ ['--d' as string]: '200ms' }}>
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
            <FilterChips
              label="Filter by status"
              variant="segmented"
              value={filter}
              onChange={setFilter}
              chips={(['all', 'active', 'trial', 'past_due', 'suspended', 'closed'] as const).map((s) => ({ value: s, label: s === 'all' ? 'All' : STATUS[s].label, count: counts[s] ?? 0 }))}
            />
            <label className="relative w-full sm:w-72">
              <span className="sr-only">Search organizations</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" aria-hidden="true" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, URL or owner" className="pl-9" />
            </label>
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1000px] text-left text-[13px]">
              <thead className="bg-sunken/70 text-[11px] font-bold uppercase tracking-[0.06em] text-fg-2">
                <tr>
                  <th scope="col" className="px-4 py-3">Organization</th>
                  <th scope="col" className="px-3 py-3">Owner</th>
                  <th scope="col" className="px-3 py-3">Plan</th>
                  <th scope="col" className="px-3 py-3">Status</th>
                  <th scope="col" className="px-3 py-3">Rollout</th>
                  <th scope="col" className="px-3 py-3">Users</th>
                  <th scope="col" className="px-3 py-3">Created</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o, i) => (
                  <tr key={o.id} className="anim-rise border-t border-subtle transition-colors hover:bg-hover" style={{ ['--d' as string]: `${Math.min(i, 12) * 35}ms` }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={o.name} src={o.logoUrl} size={38} round={false} color={o.brandColor} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-fg">{o.name}</p>
                          <p className="mono truncate text-xs text-fg-2">{o.slug}.{domain}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      <p className="truncate font-medium text-fg">{o.ownerName ?? '—'}</p>
                      <p className="truncate text-xs text-fg-2">{o.ownerEmail}{o.ownerPending && ' · invited'}</p>
                    </td>
                    <td className="px-3 py-3"><PlanChip plan={o.plan} /></td>
                    <td className="px-3 py-3">
                      <Pill tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Pill>
                      {o.status === 'closed' && o.purgeAfter && <p className="mt-1 text-[11px] text-fg-2">Deletes {shortDate(o.purgeAfter)}</p>}
                    </td>
                    <td className="px-3 py-3"><Rollout o={o} /></td>
                    <td className="mono px-3 py-3 text-fg">{o.users}</td>
                    <td className="px-3 py-3 text-fg-2">{monthYear(o.createdAt)}</td>
                    <td className="px-4 py-2"><div className="flex justify-end">{actions(o)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phone: stacked cards */}
          <ul className="divide-y divide-subtle border-t border-subtle md:hidden">
            {rows.map((o) => (
              <li key={o.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={o.name} src={o.logoUrl} size={40} round={false} color={o.brandColor} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{o.name}</p>
                    <p className="mono truncate text-xs text-fg-2">{o.slug}.{domain}</p>
                    <p className="mt-1 truncate text-xs text-fg-2">{o.ownerName ?? '—'} · {o.ownerEmail}</p>
                  </div>
                  <Pill tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Pill>
                </div>
                <div className="flex items-center gap-3">
                  <PlanChip plan={o.plan} />
                  <div className="flex-1"><Rollout o={o} /></div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-fg-2">{o.users} users · {monthYear(o.createdAt)}</span>
                  {actions(o)}
                </div>
              </li>
            ))}
          </ul>

          {rows.length === 0 && <p className="border-t border-subtle px-4 py-12 text-center text-sm text-fg-2">No organizations match. Try another status or search.</p>}
          <div className="flex items-center justify-between border-t border-subtle px-4 py-3 text-[13px] text-fg-2">
            <span>Showing {rows.length} of {orgs.length}</span>
          </div>
        </Card>
      </PageBody>

      <OrgDrawer open={drawer.open} editing={drawer.editing} domain={domain} onClose={() => setDrawer({ open: false, editing: null })} onCreated={(r) => { setCopied(false); setCreated(r); }} />

      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title={`Delete ${del?.name ?? ''}?`}
        sub="Members lose access now. Everything is permanently deleted after 30 days; until then you can restore it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>Keep it</Button>
            <Button variant="danger" disabled={typed !== del?.slug} pending={pending} onClick={() => del && act(() => closeOrgAction(del.id, typed), () => setDel(null))}>
              Delete organization
            </Button>
          </>
        }
      >
        <Field label={<>Type <span className="mono text-danger">{del?.slug}</span> to confirm</>} htmlFor="del-slug">
          <Input id="del-slug" mono autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={!!support}
        onClose={() => setSupport(null)}
        title={`Open ${support?.name ?? ''} for support`}
        sub="You will see the workspace as a read-only viewer with a red banner. The session and its reason are written to the audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSupport(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              pending={pending}
              onClick={() =>
                support &&
                start(async () => {
                  const r = await startSupportSessionAction(support.slug, reason);
                  if (!r.ok) { toast(r.error, 'error'); return; }
                  router.push(r.data!.href);
                })
              }
            >
              Open read-only
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="sup-reason" hint="For example: owner asked for help with tax rates.">
          <Textarea id="sup-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Modal>

      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title={`${created?.name ?? ''} is created`}
        sub={created?.emailed ? `An invite was emailed to ${created.email}.` : `Platform email is not set up yet, so copy this invite link and send it to ${created?.email}.`}
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}
      >
        <div className="flex items-center gap-2">
          <Input readOnly mono value={created?.inviteUrl ?? ''} aria-label="Owner invite link" onFocus={(e) => e.target.select()} />
          <Button
            variant="secondary"
            icon={copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            onClick={async () => { await navigator.clipboard.writeText(created?.inviteUrl ?? ''); setCopied(true); }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-3 text-xs text-fg-2">The link works once and expires in 7 days.</p>
      </Modal>
    </>
  );
}
