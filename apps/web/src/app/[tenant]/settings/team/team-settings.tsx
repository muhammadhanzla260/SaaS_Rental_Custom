'use client';

import { useRouter } from 'next/navigation';
import { Check, Copy, Minus, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GRANTABLE, INVITABLE_ROLES, LOCATION_SCOPED_ROLES, PERMISSION_MATRIX, PERMISSIONS, ROLE_LABELS, ROLE_TONE, ROLES, type Role,
} from '@rental/core';
import {
  AffixInput, Avatar, Button, Card, Checkbox, cx, Drawer, Field, FilterChips, Input, Notice, PageTitle, Pill, Select, Tag, useToast,
} from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { useForm } from '@/lib/form';
import { inviteAction, resendInviteAction, revokeInviteAction, updateMemberAction } from '@/server/actions/settings';

type Loc = { id: string; code: string; name: string };
type Member = { kind: 'member'; id: string; userId: string; name: string; email: string; image: string | null; role: Role; status: 'active' | 'disabled'; locationIds: string[]; commissionPct: number | null; vehicle: string | null; permissions: string[] };
type Invite = { kind: 'invite'; id: string; name: string | null; email: string; role: Role; locationIds: string[]; commissionPct: number | null; vehicle: string | null; permissions: string[]; expiresAt: string };
type Person = Member | Invite;

export function RoleChip({ role }: { role: Role }) {
  return <Pill tone={ROLE_TONE[role]} dot={false} className="rounded-lg">{ROLE_LABELS[role].label}</Pill>;
}

type Draft = { email: string; name: string; role: Role; locationIds: string[]; commissionPct: number | null; vehicle: string; permissions: string[]; status: 'active' | 'disabled' };

function PersonDrawer({ open, onClose, slug, editing, locations, me }: { open: boolean; onClose: () => void; slug: string; editing: Member | null; locations: Loc[]; me: { userId: string; role: Role } }) {
  const router = useRouter();
  const toast = useToast();
  const blank: Draft = { email: '', name: '', role: 'sales', locationIds: [], commissionPct: 5, vehicle: '', permissions: [], status: 'active' };
  const form = useForm<Draft>(blank);
  const [link, setLink] = useState<{ url: string; delivered: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLink(null);
    setCopied(false);
    form.reset(editing ? { email: editing.email, name: editing.name, role: editing.role, locationIds: editing.locationIds, commissionPct: editing.commissionPct, vehicle: editing.vehicle ?? '', permissions: editing.permissions, status: editing.status } : blank);
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = form.values;
  const scoped = LOCATION_SCOPED_ROLES.includes(v.role);
  const roleOptions = editing ? ROLES.filter((r) => r !== 'owner' || me.role === 'owner' || editing.role === 'owner') : INVITABLE_ROLES;
  const self = editing?.userId === me.userId;
  const toggleLoc = (id: string) => form.set('locationIds', v.locationIds.includes(id) ? v.locationIds.filter((x) => x !== id) : [...v.locationIds, id]);
  const togglePerm = (p: string) => form.set('permissions', v.permissions.includes(p) ? v.permissions.filter((x) => x !== p) : [...v.permissions, p]);

  const save = () => {
    const body = {
      role: v.role,
      locationIds: scoped ? v.locationIds : [],
      commissionPct: v.role === 'sales' ? v.commissionPct : null,
      vehicle: ['coach', 'crew'].includes(v.role) ? v.vehicle : null,
      permissions: v.permissions,
    };
    if (editing) {
      form.submit(() => updateMemberAction(slug, editing.id, { ...body, status: v.status }), (r) => { toast(r.message ?? 'Saved.'); onClose(); router.refresh(); });
    } else {
      form.submit(() => inviteAction(slug, { ...body, email: v.email, name: v.name || undefined }), (r) => {
        toast(r.message ?? 'Invitation created.');
        router.refresh();
        if (r.data && !r.data.delivered) setLink({ url: r.data.link, delivered: false });
        else onClose();
      });
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? editing.name : 'Invite people'}
      sub={editing ? editing.email : 'They get an email with a link to join this workspace.'}
      footer={
        link ? <Button onClick={onClose}>Done</Button> : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} pending={form.pending}>{editing ? 'Save changes' : 'Send invite'}</Button>
          </>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-4">
          <Notice kind="info">Platform email is not set up yet, so copy this link and send it to {v.email}. It works once and expires in 7 days.</Notice>
          <div className="flex gap-2">
            <Input readOnly mono value={link.url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <Button variant="secondary" icon={copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {form.status?.kind === 'error' && <Notice kind="danger">{form.status.text}</Notice>}
          {!editing && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="tm-email" error={form.error('email')}>
                <Input id="tm-email" type="email" autoFocus value={v.email} invalid={!!form.error('email')} onChange={(e) => form.set('email', e.target.value)} />
              </Field>
              <Field label="Name" htmlFor="tm-name" optional>
                <Input id="tm-name" value={v.name} onChange={(e) => form.set('name', e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Role" htmlFor="tm-role" hint={ROLE_LABELS[v.role].description}>
            <Select id="tm-role" value={v.role} disabled={self && editing?.role === 'owner'} onChange={(e) => form.set('role', e.target.value as Role)}>
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r].label}</option>)}
            </Select>
          </Field>
          {scoped && (
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-fg">Branches</legend>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={v.locationIds.length === 0} onClick={() => form.set('locationIds', [])}
                  className={cx('press h-8 rounded-full border px-3 text-[13px] font-semibold', v.locationIds.length === 0 ? 'border-night bg-night text-white dark:bg-fg dark:text-night' : 'border-control bg-surface text-fg')}>
                  All locations
                </button>
                {locations.map((l) => {
                  const on = v.locationIds.includes(l.id);
                  return (
                    <button key={l.id} type="button" aria-pressed={on} onClick={() => toggleLoc(l.id)}
                      className={cx('press h-8 rounded-full border px-3 text-[13px] font-semibold', on ? 'border-accent bg-accent-soft text-accent-text' : 'border-control bg-surface text-fg')}>
                      <span className="mono mr-1.5">{l.code}</span>{l.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {v.role === 'sales' && (
            <Field label="Commission" htmlFor="tm-comm" hint="Used by Reports → Sales Commission Report.">
              <AffixInput id="tm-comm" className="max-w-[180px]" mono inputMode="decimal" suffix="%" value={v.commissionPct == null ? '' : String(v.commissionPct)} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ''); form.set('commissionPct', t === '' ? null : Number(t)); }} />
            </Field>
          )}
          {(v.role === 'coach' || v.role === 'crew') && (
            <Field label="Vehicle" htmlFor="tm-vehicle" optional hint="For example: Van 2 · white Transit.">
              <Input id="tm-vehicle" value={v.vehicle} onChange={(e) => form.set('vehicle', e.target.value)} />
            </Field>
          )}
          {!['owner', 'admin'].includes(v.role) && (
            <fieldset>
              <legend className="mb-1 text-[13px] font-semibold text-fg">Extra permissions</legend>
              <p className="mb-3 text-xs text-fg-2">On top of the role, for this person only.</p>
              <div className="flex flex-col gap-2.5">
                {GRANTABLE.map((p) => (
                  <Checkbox key={p} checked={v.permissions.includes(p)} onChange={() => togglePerm(p)}>
                    <span className="text-fg">{PERMISSIONS[p]}</span> <span className="mono text-xs text-fg-2">{p}</span>
                  </Checkbox>
                ))}
              </div>
            </fieldset>
          )}
          {editing && !self && (
            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-sunken p-3">
              <div>
                <p className="text-sm font-semibold text-fg">{v.status === 'active' ? 'Can sign in to this workspace' : 'Access disabled'}</p>
                <p className="text-xs text-fg-2">Disabling keeps their history but blocks access here.</p>
              </div>
              <Button variant={v.status === 'active' ? 'danger-ghost' : 'secondary'} size="sm" onClick={() => form.set('status', v.status === 'active' ? 'disabled' : 'active')}>
                {v.status === 'active' ? 'Disable' : 'Enable'}
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function RowMenu({ person, slug, onEdit, me }: { person: Person; slug: string; onEdit: () => void; me: { userId: string } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const act = async (fn: () => Promise<{ ok: boolean; message?: string; error?: string; data?: { link: string; delivered: boolean } }>) => {
    setOpen(false);
    const r = await fn();
    if (!r.ok) { toast(r.error, 'error'); return; }
    if (r.data && !r.data.delivered) { await navigator.clipboard.writeText(r.data.link).catch(() => {}); toast('New invite link copied to the clipboard.', 'info'); }
    else if (r.message) toast(r.message);
    router.refresh();
  };
  const item = 'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-sunken';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Actions for ${person.email}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
        <MoreHorizontal className="size-5" />
      </button>
      {open && (
        <div role="menu" className="anim-modal absolute right-0 top-10 z-20 w-48 rounded-[14px] border border-subtle bg-surface p-1.5 shadow-[var(--shadow-float)]">
          {person.kind === 'member' ? (
            <>
              <button role="menuitem" className={item} onClick={() => { setOpen(false); onEdit(); }}>Edit role &amp; access</button>
              {person.userId !== me.userId && (
                <button role="menuitem" className={cx(item, person.status === 'active' && 'text-danger')} onClick={() => act(() => updateMemberAction(slug, person.id, { status: person.status === 'active' ? 'disabled' : 'active' }))}>
                  {person.status === 'active' ? 'Disable access' : 'Enable access'}
                </button>
              )}
            </>
          ) : (
            <>
              <button role="menuitem" className={item} onClick={() => act(() => resendInviteAction(slug, person.id))}>Resend invite</button>
              <button role="menuitem" className={cx(item, 'text-danger')} onClick={() => act(() => revokeInviteAction(slug, person.id))}>Revoke invite</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamSettings({ slug, me, members, invites, locations, readOnly }: { slug: string; me: { userId: string; role: Role }; members: Member[]; invites: Invite[]; locations: Loc[]; readOnly: boolean }) {
  const [filter, setFilter] = useState<'all' | Role>('all');
  const [drawer, setDrawer] = useState<{ open: boolean; editing: Member | null }>({ open: false, editing: null });
  const people: Person[] = useMemo(() => [...members, ...invites], [members, invites]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: people.length };
    for (const p of people) c[p.role] = (c[p.role] ?? 0) + 1;
    return c;
  }, [people]);
  const rows = people.filter((p) => filter === 'all' || p.role === filter);
  const code = (id: string) => locations.find((l) => l.id === id)?.code ?? '?';
  const branches = (p: Person) =>
    !LOCATION_SCOPED_ROLES.includes(p.role) || p.locationIds.length === 0 ? <Tag>All</Tag> : <span className="flex flex-wrap gap-1">{p.locationIds.map((id) => <Tag key={id}>{code(id)}</Tag>)}</span>;
  const status = (p: Person) =>
    p.kind === 'invite' ? <Pill tone="info">Invited</Pill> : p.status === 'active' ? <Pill tone="success">Active</Pill> : <Pill tone="neutral">Disabled</Pill>;

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Settings', href: `/${slug}/settings` }, { label: 'Team & roles' }]}
        actions={<Button icon={<Plus className="size-4" />} disabled={readOnly} onClick={() => setDrawer({ open: true, editing: null })}><span className="max-sm:hidden">Invite people</span><span className="sm:hidden">Invite</span></Button>}
      />
      <PageBody wide>
        <PageTitle title="Team & roles" sub="One login per person. Their role and branch access apply only inside this workspace." />
        <div className="mb-4">
          <FilterChips
            label="Filter by role"
            value={filter}
            onChange={setFilter}
            chips={[{ value: 'all' as const, label: 'All', count: counts.all }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r].label, count: counts[r] ?? 0 }))]}
          />
        </div>

        <Card className="anim-rise overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[820px] text-left text-[13px]">
              <thead className="bg-sunken/70 text-[11px] font-bold uppercase tracking-[0.06em] text-fg-2">
                <tr>
                  <th scope="col" className="px-5 py-3">Person</th>
                  <th scope="col" className="px-3 py-3">Role</th>
                  <th scope="col" className="px-3 py-3">Branches</th>
                  <th scope="col" className="px-3 py-3">Status</th>
                  <th scope="col" className="px-3 py-3">Commission</th>
                  <th scope="col" className="px-5 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={`${p.kind}-${p.id}`} className="anim-rise border-t border-subtle hover:bg-hover" style={{ ['--d' as string]: `${Math.min(i, 12) * 30}ms` }}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={p.name || p.email} src={p.kind === 'member' ? p.image : null} size={36} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-fg">{p.name || p.email.split('@')[0]}{p.kind === 'member' && p.userId === me.userId && <span className="ml-1.5 text-xs font-medium text-fg-2">(you)</span>}</p>
                          <p className="truncate text-xs text-fg-2">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3"><RoleChip role={p.role} /></td>
                    <td className="px-3 py-3">{branches(p)}</td>
                    <td className="px-3 py-3">{status(p)}</td>
                    <td className="mono px-3 py-3 text-fg">{p.role === 'sales' && p.commissionPct != null ? `${p.commissionPct.toFixed(2)}%` : <span className="text-fg-3">—</span>}</td>
                    <td className="px-5 py-2 text-right">{!readOnly && <RowMenu person={p} slug={slug} me={me} onEdit={() => p.kind === 'member' && setDrawer({ open: true, editing: p })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-subtle md:hidden">
            {rows.map((p) => (
              <li key={`${p.kind}-${p.id}`} className="flex items-start gap-3 p-4">
                <Avatar name={p.name || p.email} src={p.kind === 'member' ? p.image : null} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{p.name || p.email.split('@')[0]}</p>
                  <p className="truncate text-xs text-fg-2">{p.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5"><RoleChip role={p.role} />{status(p)}{branches(p)}</div>
                </div>
                {!readOnly && <RowMenu person={p} slug={slug} me={me} onEdit={() => p.kind === 'member' && setDrawer({ open: true, editing: p })} />}
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p className="px-5 py-12 text-center text-sm text-fg-2">Nobody with this role yet.</p>}
        </Card>

        <Card className="anim-rise mt-6 overflow-hidden" style={{ ['--d' as string]: '120ms' }}>
          <div className="flex flex-wrap items-end justify-between gap-2 px-5 pb-3 pt-5">
            <h2 className="text-lg font-bold text-fg">What each role can do</h2>
            <p className="text-[13px] text-fg-2">Extra permissions can be granted to one person</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-t border-subtle text-fg-2">
                  <th scope="col" className="px-5 py-3 text-left font-semibold">Permission</th>
                  {ROLES.map((r) => <th key={r} scope="col" className="px-2 py-3 text-center font-semibold">{ROLE_LABELS[r].label}</th>)}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MATRIX.map((row) => (
                  <tr key={row.key} className="border-t border-subtle">
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <span className="block font-medium text-fg">{row.label}</span>
                      <span className="mono text-xs text-fg-2">{row.key}</span>
                    </th>
                    {ROLES.map((r) => (
                      <td key={r} className="px-2 py-3 text-center">
                        {row.roles.includes(r)
                          ? <span className="inline-grid size-7 place-items-center rounded-lg bg-success-bg text-success" aria-label="Yes"><Check className="size-4" strokeWidth={2.5} /></span>
                          : <Minus className="mx-auto size-4 text-fg-3" aria-label="No" />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </PageBody>
      <PersonDrawer open={drawer.open} editing={drawer.editing} onClose={() => setDrawer({ open: false, editing: null })} slug={slug} locations={locations} me={me} />
    </>
  );
}
