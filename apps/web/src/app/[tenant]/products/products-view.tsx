'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutGrid, List, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatMoney, PRODUCT_KINDS } from '@rental/core';
import { CATEGORY_COLORS, ProductArt, artOf, tintStyle, PRODUCT_ICON_PATHS } from '@/components/catalog/product-art';
import { Button, Card, cx, Drawer, EmptyState, FilterChips, Input, LinkButton, Pill, Segmented, useToast } from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { deleteCategoryAction, saveCategoryAction } from '@/server/actions/commerce';

export type ProductCard = {
  id: string;
  name: string;
  sku: string | null;
  kind: string;
  status: 'active' | 'draft' | 'archived';
  tracking: 'pooled' | 'serialized' | 'none';
  icon: string | null;
  tint: string | null;
  categoryId: string | null;
  fromCents: number;
  staffedCents: number;
  owned: number;
  outOfService: number;
  units: number;
  imageUrl: string | null;
};
type Category = { id: string; name: string; count: number };

const KIND_LABEL = Object.fromEntries(PRODUCT_KINDS.map((k) => [k.value, k.label])) as Record<string, string>;

export function trackingLabel(p: Pick<ProductCard, 'tracking' | 'owned' | 'units'>) {
  if (p.tracking === 'none') return 'Not tracked';
  if (p.tracking === 'serialized') return `Serialized · ${p.units} unit${p.units === 1 ? '' : 's'}`;
  return `Pooled · ${p.owned}`;
}

const LAYOUT_KEY = 'products.layout';

export function ProductsView({ slug, products, categories, currency, canEdit }: { slug: string; products: ProductCard[]; categories: Category[]; currency: string; canEdit: boolean }) {
  const [cat, setCat] = useState<string>('all');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [q, setQ] = useState('');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [catsOpen, setCatsOpen] = useState(false);
  const money = (c: number) => formatMoney(c, currency);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LAYOUT_KEY);
      if (v === 'grid' || v === 'list') setLayout(v);
    } catch {}
  }, []);
  const pickLayout = (v: 'grid' | 'list') => {
    setLayout(v);
    try { localStorage.setItem(LAYOUT_KEY, v); } catch {}
  };

  const colorOf = useMemo(() => new Map(categories.map((c, i) => [c.id, CATEGORY_COLORS[i % CATEGORY_COLORS.length]!])), [categories]);
  const live = products.filter((p) => p.status !== 'archived');
  const counts = {
    all: live.length,
    none: live.filter((p) => !p.categoryId).length,
    active: live.length,
    archived: products.length - live.length,
  };
  const needle = q.trim().toLowerCase();
  const items = products.filter(
    (p) =>
      (status === 'archived' ? p.status === 'archived' : p.status !== 'archived') &&
      (cat === 'all' || (cat === 'none' ? !p.categoryId : p.categoryId === cat)) &&
      (!needle || `${p.name} ${p.sku ?? ''}`.toLowerCase().includes(needle)),
  );
  const catChips = [
    { value: 'all', label: 'All products', count: counts.all },
    ...categories.map((c) => ({ value: c.id, label: c.name, count: c.count })),
    ...(counts.none ? [{ value: 'none', label: 'Uncategorized', count: counts.none }] : []),
  ];

  const sideItem = (value: string, label: string, count: number, dot?: string) => {
    const on = cat === value;
    return (
      <button
        key={value}
        type="button"
        aria-pressed={on}
        onClick={() => setCat(value)}
        className={cx(
          'press flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm transition-colors',
          on ? 'bg-surface font-semibold text-fg shadow-[0_1px_3px_rgb(16_19_26/0.08)]' : 'text-fg-2 hover:bg-hover hover:text-fg',
        )}
      >
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: dot ?? 'var(--text-primary)' }} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="mono text-xs text-fg-2">{count}</span>
      </button>
    );
  };

  return (
    <>
      <Topbar
        crumbs={[{ label: 'Products' }]}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setCatsOpen(true)} className="max-sm:hidden">Categories</Button>
              <LinkButton href={`/${slug}/products/new`} size="sm" icon={<Plus className="size-4" />}>
                <span className="max-sm:hidden">Add product</span>
                <span className="sm:hidden">Add</span>
              </LinkButton>
            </>
          )
        }
      />
      <PageBody wide>
        <div className="mb-6 flex items-baseline gap-3">
          <h1 className="font-display text-[32px] font-extrabold tracking-tight text-fg sm:text-4xl">Products</h1>
          <span className="mono text-sm text-fg-2">{counts.all} items</span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
          {/* Sidebar (desktop) */}
          <aside className="hidden lg:block">
            <p className="eyebrow mb-2 px-3">Categories</p>
            <div className="flex flex-col gap-0.5">
              {sideItem('all', 'All products', counts.all)}
              {categories.map((c) => sideItem(c.id, c.name, c.count, colorOf.get(c.id)))}
              {counts.none > 0 && sideItem('none', 'Uncategorized', counts.none, 'var(--text-disabled)')}
            </div>
            <p className="eyebrow mb-2 mt-6 px-3">Status</p>
            <div className="flex flex-col gap-0.5">
              {(['active', 'archived'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  className={cx(
                    'press flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors',
                    status === s ? 'bg-surface font-semibold text-fg shadow-[0_1px_3px_rgb(16_19_26/0.08)]' : 'text-fg-2 hover:bg-hover hover:text-fg',
                  )}
                >
                  {s === 'active' ? 'Active & draft' : 'Archived'}
                  <span className="mono text-xs text-fg-2">{counts[s]}</span>
                </button>
              ))}
            </div>
            {canEdit && (
              <button type="button" onClick={() => setCatsOpen(true)} className="mt-6 px-3 text-[13px] font-semibold text-accent-text hover:underline">
                Manage categories
              </button>
            )}
          </aside>

          <div className="min-w-0">
            {/* Mobile filters */}
            <div className="mb-3 flex flex-col gap-2 lg:hidden">
              <FilterChips label="Category" chips={catChips} value={cat} onChange={setCat} />
              <div className="flex items-center gap-2">
                <Segmented
                  label="Status"
                  size="sm"
                  value={status}
                  onChange={setStatus}
                  options={[{ value: 'active', label: `Active & draft · ${counts.active}` }, { value: 'archived', label: `Archived · ${counts.archived}` }]}
                />
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setCatsOpen(true)} className="ml-auto">Categories</Button>
                )}
              </div>
            </div>

            <div className="mb-4 flex items-center gap-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or SKU" aria-label="Search products" className="pl-9" type="search" />
              </div>
              <Segmented
                label="Layout"
                value={layout}
                onChange={pickLayout}
                options={[
                  { value: 'grid', label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-4" aria-hidden /><span className="max-sm:sr-only">Grid</span></span> },
                  { value: 'list', label: <span className="flex items-center gap-1.5"><List className="size-4" aria-hidden /><span className="max-sm:sr-only">List</span></span> },
                ]}
              />
            </div>

            {items.length === 0 ? (
              <Card className="p-2">
                <EmptyState
                  title={products.length === 0 ? 'No products yet' : 'Nothing matches'}
                  sub={products.length === 0 ? 'Add the bounce houses, slides and add-ons you rent out. Prices and stock drive the order screen.' : 'Try another category or search.'}
                  action={products.length === 0 && canEdit ? <LinkButton href={`/${slug}/products/new`} icon={<Plus className="size-4" />}>Add your first product</LinkButton> : undefined}
                />
              </Card>
            ) : layout === 'grid' ? (
              <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
                {items.map((p, i) => {
                  const art = artOf(p);
                  return (
                    <Link
                      key={p.id}
                      href={`/${slug}/products/${p.id}`}
                      className="lift anim-rise group overflow-hidden rounded-[var(--radius-card)] border border-subtle bg-surface focus-visible:outline-2"
                      style={{ ['--d' as string]: `${Math.min(i, 12) * 40}ms` }}
                    >
                      <div className="tint relative grid h-36 place-items-center overflow-hidden" style={tintStyle(art.tint)}>
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
                        ) : (
                          <>
                            <span className="absolute -right-10 -top-10 size-44 rounded-full border border-current opacity-10" aria-hidden />
                            <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-300 group-hover:scale-110">
                              <path d={PRODUCT_ICON_PATHS[art.icon]} />
                            </svg>
                          </>
                        )}
                        <span className="absolute left-3 top-3 rounded-md bg-surface/95 px-2 py-0.5 text-xs font-semibold text-fg">{KIND_LABEL[p.kind] ?? p.kind}</span>
                        {p.status === 'draft' && <span className="absolute right-3 top-3 rounded-md bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning-fg">Draft</span>}
                      </div>
                      <div className="p-4">
                        <p className="truncate text-[17px] font-semibold text-fg">{p.name}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="mono text-sm text-fg-2">from <span className="font-semibold text-fg">{money(p.fromCents)}</span></span>
                          <span className="rounded-md bg-sunken px-2 py-0.5 text-xs font-semibold text-fg-2">{trackingLabel(p)}</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Card className="overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1.2fr_1fr_0.9fr] gap-4 border-b border-subtle bg-sunken/60 px-5 py-3 text-xs font-bold uppercase tracking-[0.06em] text-fg-2 md:grid">
                  <span>Product</span><span>Kind</span><span>Inventory</span><span className="text-right">Staffed</span><span className="text-right">Status</span>
                </div>
                <ul className="divide-y divide-subtle">
                  {items.map((p) => (
                    <li key={p.id}>
                      <Link href={`/${slug}/products/${p.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-hover md:grid-cols-[minmax(0,2.2fr)_1fr_1.2fr_1fr_0.9fr]">
                        <span className="flex min-w-0 items-center gap-3">
                          <ProductArt product={p} size={40} imageUrl={p.imageUrl} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-fg">{p.name}</span>
                            <span className="mono block truncate text-xs text-fg-2">{p.sku ?? 'No SKU'}</span>
                          </span>
                        </span>
                        <span className="text-sm text-fg-2 max-md:hidden">{KIND_LABEL[p.kind] ?? p.kind}</span>
                        <span className="text-sm text-fg-2 max-md:hidden">
                          {trackingLabel(p)}
                          {p.outOfService > 0 && <span className="text-warning-fg"> · {p.outOfService} held</span>}
                        </span>
                        <span className="mono text-right text-sm font-semibold text-fg">{money(p.staffedCents)}</span>
                        <span className="text-right max-md:hidden">
                          <Pill tone={p.status === 'active' ? 'success' : p.status === 'draft' ? 'warning' : 'neutral'}>{p.status === 'active' ? 'Active' : p.status === 'draft' ? 'Draft' : 'Archived'}</Pill>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </div>
      </PageBody>
      {canEdit && <CategoriesDrawer open={catsOpen} onClose={() => setCatsOpen(false)} slug={slug} categories={categories} colorOf={colorOf} />}
    </>
  );
}

function CategoriesDrawer({ open, onClose, slug, categories, colorOf }: { open: boolean; onClose: () => void; slug: string; categories: Category[]; colorOf: Map<string, string> }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  async function save(id: string | null, value: string) {
    if (value.trim().length < 2) return toast('Give the category a name.', 'error');
    setBusy(true);
    const r = await saveCategoryAction(slug, id, { name: value });
    setBusy(false);
    if (!r.ok) return toast(r.error, 'error');
    toast(id ? 'Category renamed.' : `${r.data?.name} added.`);
    setName('');
    setEditing(null);
    router.refresh();
  }
  async function remove(id: string) {
    setBusy(true);
    const r = await deleteCategoryAction(slug, id);
    setBusy(false);
    setConfirm(null);
    toast(r.ok ? (r.message ?? 'Removed.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) router.refresh();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Categories" sub="Group products on the order screen and here. Removing a category keeps its products.">
      <form
        className="mb-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save(null, name);
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Water slides" aria-label="New category name" />
        <Button type="submit" pending={busy && !editing} icon={<Plus className="size-4" />}>Add</Button>
      </form>
      {categories.length === 0 ? (
        <p className="text-sm text-fg-2">No categories yet.</p>
      ) : (
        <ul className="divide-y divide-subtle rounded-[var(--radius-card)] border border-subtle">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf.get(c.id) }} aria-hidden />
              {editing?.id === c.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); save(c.id, editing.name); }}>
                  <Input autoFocus value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} aria-label="Category name" className="h-9" />
                  <Button type="submit" size="sm" pending={busy}>Save</Button>
                </form>
              ) : confirm === c.id ? (
                <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-fg">Remove <b>{c.name}</b>? {c.count} product{c.count === 1 ? '' : 's'} become uncategorized.</span>
                  <span className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>Keep</Button>
                    <Button size="sm" variant="danger" pending={busy} onClick={() => remove(c.id)}>Remove</Button>
                  </span>
                </div>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{c.name}</span>
                  <span className="mono text-xs text-fg-2">{c.count}</span>
                  <button type="button" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label={`Rename ${c.name}`} className="grid size-8 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" onClick={() => setConfirm(c.id)} aria-label={`Remove ${c.name}`} className="grid size-8 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-danger-bg hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
