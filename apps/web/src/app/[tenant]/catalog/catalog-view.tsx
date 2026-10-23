'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, PackageOpen, Pencil, Plus, Search, Tags, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, useTransition } from 'react';
import { useMoneyFormat } from '@/components/money';
import { Badge, Button, cx, Input, Notice } from '@/components/ui';
import { deleteCategoryAction, saveCategoryAction } from '@/server/actions/commerce';

type Product = {
  id: string; name: string; kind: string; status: string; categoryId: string | null; imageUrl: string | null;
  priceStaffedCents: number; pricePickupCents: number | null; baseHours: number | null; owned: number;
};

export function CatalogView({
  slug, currency, canEdit, categories, products, locationCount,
}: {
  slug: string; currency: string; canEdit: boolean; categories: { id: string; name: string }[]; products: Product[]; locationCount: number;
}) {
  const money = useMoneyFormat(currency);
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [manage, setManage] = useState(false);
  const shown = useMemo(
    () =>
      products.filter(
        (p) =>
          (cat === 'all' ? p.status !== 'archived' : cat === 'archived' ? p.status === 'archived' : p.categoryId === cat && p.status !== 'archived') &&
          (!q || p.name.toLowerCase().includes(q.toLowerCase())),
      ),
    [products, cat, q],
  );
  const chips = [{ id: 'all', name: 'All' }, ...categories, ...(products.some((p) => p.status === 'archived') ? [{ id: 'archived', name: 'Archived' }] : [])];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="Search products" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <div className="ml-auto flex gap-2">
          {canEdit && (
            <Button type="button" variant="secondary" onClick={() => setManage(!manage)} aria-expanded={manage}>
              <Tags aria-hidden className="size-4" /> Categories
            </Button>
          )}
          {canEdit && (
            <Link href={`/${slug}/catalog/new`} className="btn-shine inline-flex min-h-10 items-center gap-2 rounded-ui-sm bg-brand px-4 font-medium text-brand-fg shadow-[0_6px_16px_-8px_var(--brand)] hover:bg-brand-strong active:scale-[0.97]">
              <Plus aria-hidden className="size-4" /> Add product
            </Link>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {manage && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <CategoryManager slug={slug} categories={categories} onClose={() => setManage(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div role="tablist" aria-label="Categories" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {chips.map((c) => {
          const active = cat === c.id;
          return (
            <button key={c.id} role="tab" aria-selected={active} type="button" onClick={() => setCat(c.id)}
              className={cx('relative shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors', active ? 'text-brand-fg' : 'bg-surface text-muted ring-1 ring-line hover:text-ink')}>
              {active && <motion.span layoutId="catalog-chip" className="brand-gradient absolute inset-0 rounded-full" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="relative">{c.name}</span>
            </button>
          );
        })}
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[calc(var(--radius)*1.4)] border border-dashed border-line-strong bg-surface p-10 text-center">
          <PackageOpen aria-hidden className="size-10 text-brand-text" />
          <h2 className="text-lg font-semibold">Add your first rental</h2>
          <p className="max-w-md text-muted">Bounce houses, movie screens, tents, games. Each gets a photo, prices for staffed, pick-up and drop-off, and how many you own{locationCount > 1 ? ' at each location' : ''}.</p>
          {canEdit && (
            <Link href={`/${slug}/catalog/new`} className="mt-1 inline-flex min-h-10 items-center gap-2 rounded-ui-sm bg-brand px-4 font-medium text-brand-fg">
              <Plus aria-hidden className="size-4" /> Add product
            </Link>
          )}
        </div>
      ) : (
        <motion.ul layout className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence mode="popLayout">
            {shown.map((p, i) => (
              <motion.li key={p.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1, transition: { delay: Math.min(i * 0.03, 0.3) } }} exit={{ opacity: 0, scale: 0.96 }}>
                <Link href={`/${slug}/catalog/${p.id}`} className="group flex h-full flex-col overflow-hidden rounded-[calc(var(--radius)*1.3)] border border-line bg-surface shadow-card transition-all hover:-translate-y-1 hover:shadow-pop">
                  <div className="relative aspect-[4/3] overflow-hidden bg-surface-2">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="brand-gradient grid size-full place-items-center font-display text-4xl font-bold text-brand-fg/90">{p.name.slice(0, 1)}</div>
                    )}
                    <div className="absolute left-2 top-2 flex gap-1">
                      {p.kind !== 'rental' && <Badge tone="brand">{p.kind === 'addon' ? 'Add-on' : 'Service'}</Badge>}
                      {p.status !== 'active' && <Badge tone="warn">{p.status === 'draft' ? 'Draft' : 'Archived'}</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
                    <span className="line-clamp-2 font-semibold leading-snug">{p.name}</span>
                    <span className="mt-auto flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-display text-lg font-bold text-brand-text tabular">{money(p.priceStaffedCents)}</span>
                      {p.baseHours ? <span className="text-muted">{p.baseHours} h</span> : null}
                    </span>
                    <span className="text-xs text-muted">
                      {p.pricePickupCents != null ? `Pick-up ${money(p.pricePickupCents)} · ` : ''}Own {p.owned}
                    </span>
                  </div>
                </Link>
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
      {products.length > 0 && shown.length === 0 && <p className="text-center text-muted">Nothing matches. Try another category or search.</p>}
    </div>
  );
}

function CategoryManager({ slug, categories, onClose }: { slug: string; categories: { id: string; name: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (id: string | null, value: string) =>
    start(async () => {
      const r = await saveCategoryAction(slug, id, { name: value });
      if (r.ok) { setName(''); setEditing(null); setError(null); router.refresh(); } else setError(r.fieldErrors?.name ?? r.error);
    });
  return (
    <div className="flex flex-col gap-3 rounded-ui border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Categories</h2>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close categories"><X aria-hidden className="size-4" /></Button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save(null, name); }}>
        <Input aria-label="New category name" placeholder="New category, e.g. Inflatables" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" pending={pending}>Add</Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-1 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
            {editing?.id === c.id ? (
              <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); save(c.id, editing.name); }}>
                <input aria-label="Category name" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-32 rounded bg-surface px-1.5 py-0.5 outline-none ring-1 ring-brand" />
                <button type="submit" aria-label="Save name" className="grid size-7 place-items-center rounded-full hover:bg-surface"><Check aria-hidden className="size-4" /></button>
              </form>
            ) : (
              <>
                <span>{c.name}</span>
                <button type="button" aria-label={`Rename ${c.name}`} onClick={() => setEditing(c)} className="grid size-7 place-items-center rounded-full text-muted hover:bg-surface hover:text-ink"><Pencil aria-hidden className="size-3.5" /></button>
                <button type="button" aria-label={`Delete ${c.name}`} onClick={() => start(async () => { const r = await deleteCategoryAction(slug, c.id); if (r.ok) router.refresh(); else setError(r.error); })}
                  className="grid size-7 place-items-center rounded-full text-muted hover:bg-danger-soft hover:text-danger"><Trash2 aria-hidden className="size-3.5" /></button>
              </>
            )}
          </li>
        ))}
        {!categories.length && <li className="text-sm text-muted">No categories yet.</li>}
      </ul>
    </div>
  );
}
