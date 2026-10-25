'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Upload } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { formatMoney, formatPhone } from '@rental/core';
import type { CustomerProfile } from '@rental/db';
import { CustomerFormDrawer, customerDraft, type CustomerDraft } from '@/components/customers/customer-form';
import { CustomerProfilePanel, CustomerTags, initialsOf } from '@/components/customers/customer-profile';
import { Button, Card, cx, Drawer, EmptyState, FilterChips, Input, Spinner } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { ImportCustomersModal } from './import-modal';

type Row = {
  id: string; name: string; kind: string; email: string | null; phone: string | null; country: string; tags: string[]; taxExempt: boolean; repeat: boolean;
  orderCount: number; lifetimeCents: number; balanceCents: number; lastEventAt: string | null; lastStatus: string | null;
};
type Perms = { canEdit: boolean; canCredit: boolean; canOrder: boolean };

const AVATAR = [['#E6ECFF', '#233FB8'], ['#0B0D12', '#D4FF3A'], ['#F1EAFE', '#5B2DB0'], ['#E0F2F7', '#0A5566'], ['#FFF1DC', '#8A4A00'], ['#E3F5EC', '#0B6145']] as const;
const avatarOf = (id: string) => AVATAR[parseInt(id.slice(0, 2), 16) % AVATAR.length]!;

export function CustomersView({
  slug, rows, counts, filter, q, profile, currency, country, perms,
}: {
  slug: string; rows: Row[]; counts: { all: number; people: number; organizations: number; repeat: number }; filter: string; q: string;
  profile: CustomerProfile | null; currency: string; country: string; perms: Perms;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [search, setSearch] = useState(q);
  const [form, setForm] = useState<{ id: string; draft: CustomerDraft } | null | 'new'>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const money = (c: number) => formatMoney(c, currency);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const m = window.matchMedia('(max-width: 1279px)');
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, val] of Object.entries(patch)) {
      if (val) next.set(k, val);
      else next.delete(k);
    }
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  useEffect(() => {
    if (search === q) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: search.trim() || null }), 250);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = profile?.id ?? null;
  // With the profile beside the list (desktop), drop contact and last event so names stay readable.
  const side = !!profile && !narrow;
  const cols = side ? 'md:grid-cols-[minmax(0,1fr)_70px_120px]' : 'md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_70px_120px_130px]';
  const lastLabel = (r: Row) => {
    if (!r.lastEventAt) return '—';
    const d = new Date(r.lastEventAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return r.lastStatus === 'draft' || r.lastStatus === 'quote_sent' ? `Quote · ${d.replace(/, \d{4}$/, '')}` : d;
  };
  const profileNode = profile && (
    <CustomerProfilePanel
      slug={slug}
      c={profile}
      currency={currency}
      perms={perms}
      onEdit={() => setForm({ id: profile.id, draft: customerDraft(profile, profile.referredBy?.name ?? '') })}
      onClose={narrow ? undefined : () => go({ id: null })}
      compact={narrow}
    />
  );

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Customers' }]}
        actions={
          perms.canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)} icon={<Upload className="size-4" />} className="max-sm:hidden">Import CSV</Button>
              <Button size="sm" onClick={() => setForm('new')} icon={<Plus className="size-4" />}>
                <span className="max-sm:hidden">Add customer</span><span className="sm:hidden">Add</span>
              </Button>
            </>
          )
        }
      />
      <PageBody wide>
        <h1 className="mb-6 font-display text-[32px] font-extrabold tracking-tight text-fg sm:text-4xl">Customers</h1>
        <div className={cx('grid grid-cols-1 gap-6', profile && 'xl:grid-cols-[minmax(0,1fr)_440px]')}>
          <div className="min-w-0">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
                <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, phone or company" aria-label="Search customers" className="pl-9" />
                {pending && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-2" />}
              </div>
              <FilterChips
                label="Show"
                value={filter}
                onChange={(f) => go({ f: f === 'all' ? null : f })}
                chips={[
                  { value: 'all', label: 'All', count: counts.all },
                  { value: 'people', label: 'People', count: counts.people },
                  { value: 'organizations', label: 'Organizations', count: counts.organizations },
                  { value: 'repeat', label: 'Repeat', count: counts.repeat },
                ]}
              />
            </div>

            <Card className={cx('overflow-hidden transition-opacity', pending && 'opacity-70')}>
              {rows.length === 0 ? (
                <EmptyState
                  title={q || filter !== 'all' ? 'No customers match' : 'No customers yet'}
                  sub={q || filter !== 'all' ? 'Try a different search.' : 'Add them here, import a CSV, or create them while taking an order.'}
                  action={!q && filter === 'all' && perms.canEdit ? <Button onClick={() => setForm('new')} icon={<Plus className="size-4" />}>Add customer</Button> : undefined}
                />
              ) : (
                <>
                  <div className={cx('hidden gap-4 border-b border-subtle bg-sunken/60 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-fg-2 md:grid', cols)}>
                    <span>Customer</span>{!side && <span>Contact</span>}<span>Orders</span><span>Lifetime</span>{!side && <span>Last event</span>}
                  </div>
                  <ul className="divide-y divide-subtle">
                    {rows.map((r, i) => {
                      const [bg, fg] = avatarOf(r.id);
                      const on = r.id === selected;
                      return (
                        <li key={r.id} className="anim-rise" style={{ ['--d' as string]: `${Math.min(i, 12) * 25}ms` }}>
                          <button
                            type="button"
                            onClick={() => go({ id: on ? null : r.id })}
                            aria-current={on || undefined}
                            className={cx(
                              'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-l-[3px] px-5 py-3.5 text-left transition-colors',
                              cols,
                              on ? 'border-accent bg-accent-soft/30' : 'border-transparent hover:bg-hover',
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold" style={{ background: bg, color: fg }} aria-hidden>{initialsOf(r.name)}</span>
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span className="truncate font-semibold text-fg">{r.name}</span>
                                  <CustomerTags tags={r.tags} repeat={r.repeat} taxExempt={r.taxExempt} />
                                </span>
                                <span className="block text-[13px] text-fg-2">{r.kind === 'organization' ? 'Organization' : 'Individual'}</span>
                              </span>
                            </span>
                            <span className={cx('min-w-0 max-md:hidden', side && 'hidden')}>
                              <span className="block truncate text-sm text-fg">{r.email ?? '—'}</span>
                              <span className="mono block text-[13px] text-fg-2">{r.phone ? formatPhone(r.phone, r.country) : ''}</span>
                            </span>
                            <span className="mono text-sm text-fg max-md:hidden">{r.orderCount}</span>
                            <span className="mono text-right text-sm font-semibold text-fg md:text-left">{money(r.lifetimeCents)}</span>
                            <span className={cx('text-sm text-fg-2 max-md:col-span-2 max-md:text-[13px]', side && 'md:hidden')}>
                              <span className="md:hidden">{r.orderCount} order{r.orderCount === 1 ? '' : 's'} · </span>{lastLabel(r)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex justify-between border-t border-subtle px-5 py-3 text-[13px] text-fg-2">
                    <span>{rows.length} of {counts[filter as keyof typeof counts] ?? counts.all} customers</span>
                    {rows.length >= 200 && <span>Search to narrow down</span>}
                  </div>
                </>
              )}
            </Card>
          </div>

          {profile && !narrow && (
            <aside className="anim-slide hidden self-start overflow-hidden rounded-[var(--radius-panel)] border border-subtle bg-surface xl:sticky xl:top-24 xl:block">
              {profileNode}
            </aside>
          )}
        </div>
      </PageBody>

      {narrow && (
        <ProfileDrawer open={!!profile} onClose={() => go({ id: null })} title={profile?.displayName ?? ''}>
          {profileNode}
        </ProfileDrawer>
      )}
      <CustomerFormDrawer
        open={form !== null}
        onClose={() => setForm(null)}
        slug={slug}
        country={country}
        editing={form === 'new' ? null : form}
        onSaved={(c) => {
          setForm(null);
          go({ id: c.id });
          router.refresh();
        }}
      />
      <ImportCustomersModal open={importOpen} onClose={() => setImportOpen(false)} slug={slug} country={country} />
    </>
  );
}

/** Phone and tablet: the profile slides in as a full drawer without its own header (the panel has one). */
function ProfileDrawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <Drawer open={open} onClose={onClose} title={title} width={520}>
      <div className="-mx-5 -my-5 sm:-mx-6">{children}</div>
    </Drawer>
  );
}
