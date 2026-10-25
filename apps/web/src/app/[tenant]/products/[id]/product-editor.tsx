'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, ImagePlus, Plus, Trash2, Wrench, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  describeTrace, formatMoney, linePrice, PRODUCT_KINDS, PRODUCT_TINTS, SERVICE_MODES, TRACKING, UNIT_STATUS,
  type ProductFormValues, type ProductPricing, type ServiceMode, type UnitStatus,
} from '@rental/core';
import { artOf, PRODUCT_ICON_PATHS, ProductArt, tintStyle, type ProductIcon, type Tint } from '@/components/catalog/product-art';
import {
  AffixInput, Button, Card, cx, Field, Input, Notice, Pill, SaveBar, Segmented, Select, Tabs, Textarea, Toggle, useToast,
} from '@/components/kit';
import { PageBody, Topbar } from '@/components/shell/app-shell';
import { useForm } from '@/lib/form';
import {
  addUnitAction, duplicateProductAction, removeUnitAction, saveProductAction, setProductStatusAction, setUnitStatusAction,
} from '@/server/actions/commerce';

type Pool = { owned: number; outOfService: number; allowOverbooking: boolean };
export type EditorProduct = {
  id: string; name: string; sku: string | null; kind: string; status: string; tracking: string; icon: string | null; tint: string | null;
  categoryId: string | null; description: string | null; commissionable: boolean; taxable: boolean;
  priceStaffedCents: number; pricePickupCents: number | null; priceDropoffCents: number | null;
  baseHours: number | null; hourlyRateCents: number | null; minHours: number | null; overtimeBlockMinutes: number; overtimeBlockCents: number;
  turnaroundMinutes: number | null; suggestedAddonIds: string[];
  inventory: Record<string, Pool>; locationPrices: { locationId: string; mode: ServiceMode; priceCents: number }[];
  units: { id: string; label: string; serial: string | null; status: string; locationId: string; notes: string | null }[];
  imageUrl: string | null;
};
type Loc = { id: string; name: string; code: string };
type Other = { id: string; name: string; kind: string; icon: string | null; tint: string | null; fromCents: number };
type Tab = 'details' | 'pricing' | 'inventory' | 'addons';

type Values = {
  name: string; sku: string; kind: string; categoryId: string; description: string; status: 'active' | 'draft' | 'archived';
  tracking: 'pooled' | 'serialized' | 'none'; icon: string; tint: string; commissionable: boolean; taxable: boolean;
  priceStaffed: string; pricePickup: string; priceDropoff: string; baseHours: string; hourlyRate: string; minHours: string;
  overtimeBlockMinutes: number; overtimeBlockPrice: string; turnaroundMinutes: string; suggestedAddonIds: string[];
  inventory: Record<string, Pool>; locationPrices: { locationId: string; mode: ServiceMode; price: string }[];
};

const dollars = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
const num = (v: string) => {
  const n = parseFloat(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const KIND_LABEL = Object.fromEntries(PRODUCT_KINDS.map((k) => [k.value, k.label])) as Record<string, string>;
const MODE_LABEL = Object.fromEntries(SERVICE_MODES.map((m) => [m.value, m.label])) as Record<ServiceMode, string>;

function toValues(p: EditorProduct | null, locations: Loc[], d: { blockMinutes: number; blockCents: number }): Values {
  const inventory: Record<string, Pool> = {};
  for (const l of locations) inventory[l.id] = p?.inventory[l.id] ?? { owned: p ? 1 : 0, outOfService: 0, allowOverbooking: false };
  return {
    name: p?.name ?? '', sku: p?.sku ?? '', kind: p?.kind ?? 'rental', categoryId: p?.categoryId ?? '', description: p?.description ?? '',
    status: (p?.status as Values['status']) ?? 'active', tracking: (p?.tracking as Values['tracking']) ?? 'pooled',
    icon: p?.icon ?? '', tint: p?.tint ?? '', commissionable: p?.commissionable ?? true, taxable: p?.taxable ?? true,
    priceStaffed: dollars(p?.priceStaffedCents ?? null), pricePickup: dollars(p?.pricePickupCents), priceDropoff: dollars(p?.priceDropoffCents),
    baseHours: p?.baseHours ? String(p.baseHours) : '', hourlyRate: dollars(p?.hourlyRateCents), minHours: p?.minHours ? String(p.minHours) : '',
    overtimeBlockMinutes: p?.overtimeBlockMinutes ?? d.blockMinutes, overtimeBlockPrice: dollars(p?.overtimeBlockCents ?? d.blockCents),
    turnaroundMinutes: p?.turnaroundMinutes == null ? '' : String(p.turnaroundMinutes),
    suggestedAddonIds: p?.suggestedAddonIds ?? [], inventory,
    locationPrices: (p?.locationPrices ?? []).map((r) => ({ locationId: r.locationId, mode: r.mode, price: dollars(r.priceCents) })),
  };
}

function payload(v: Values): ProductFormValues {
  return {
    name: v.name, sku: v.sku, kind: v.kind as ProductFormValues['kind'], categoryId: v.categoryId || null, description: v.description, status: v.status,
    tracking: v.tracking, icon: (v.icon || null) as ProductFormValues['icon'], tint: (v.tint || null) as ProductFormValues['tint'],
    commissionable: v.commissionable, taxable: v.taxable, priceStaffed: v.priceStaffed || 0, pricePickup: v.pricePickup, priceDropoff: v.priceDropoff,
    baseHours: v.baseHours, hourlyRate: v.hourlyRate, minHours: v.minHours, overtimeBlockMinutes: v.overtimeBlockMinutes,
    overtimeBlockPrice: v.overtimeBlockPrice || 0, turnaroundMinutes: v.turnaroundMinutes, suggestedAddonIds: v.suggestedAddonIds,
    inventory: v.inventory, locationPrices: v.locationPrices.map((r) => ({ ...r, price: r.price || 0 })),
  } as ProductFormValues;
}

export function ProductEditor({
  slug, product, initialTab, categories, locations, others, currency, defaults, canEdit,
}: {
  slug: string; product: EditorProduct | null; initialTab: Tab; categories: { id: string; name: string }[]; locations: Loc[]; others: Other[];
  currency: string; defaults: { cleanupMinutes: number; blockMinutes: number; blockCents: number }; canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const initial = useMemo(() => toValues(product, locations, defaults), [product, locations, defaults]);
  const form = useForm<Values>(initial);
  const v = form.values;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [image, setImage] = useState<{ file: File | null; url: string | null; removed: boolean }>({ file: null, url: product?.imageUrl ?? null, removed: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const money = (c: number) => formatMoney(c, currency);
  const imageDirty = !!image.file || image.removed;
  const dirty = form.dirty || imageDirty;
  const err = (k: string) => form.errors[k];
  const cat = categories.find((c) => c.id === v.categoryId)?.name;
  const art = artOf({ name: v.name || 'Product', kind: v.kind, icon: v.icon || null, tint: v.tint || null });

  function save() {
    if (!canEdit) return;
    const fd = new FormData();
    fd.set('payload', JSON.stringify(payload(v)));
    if (image.file) fd.set('image', image.file);
    if (image.removed) fd.set('imageRemove', '1');
    form.submit(
      () => saveProductAction(slug, product?.id ?? null, fd),
      (r) => {
        toast(r.message ?? 'Saved.');
        setImage((s) => ({ ...s, file: null, removed: false }));
        if (!product && r.data) router.replace(`/${slug}/products/${r.data.id}?tab=pricing`);
        else router.refresh();
      },
    );
  }
  // Jump to the tab that holds the first error after a failed save.
  const firstError = Object.keys(form.errors)[0];
  const errorTab: Tab | null = !firstError
    ? null
    : /^(price|baseHours|hourlyRate|minHours|overtime|locationPrices)/.test(firstError)
      ? 'pricing'
      : /^(inventory|turnaround|tracking)/.test(firstError)
        ? 'inventory'
        : 'details';

  async function duplicate() {
    if (!product) return;
    const r = await duplicateProductAction(slug, product.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.message ?? 'Copied.');
    router.push(`/${slug}/products/${r.data!.id}?tab=details`);
  }
  async function setStatus(status: 'active' | 'draft' | 'archived') {
    if (!product) return form.set('status', status);
    const r = await setProductStatusAction(slug, product.id, status);
    toast(r.ok ? (r.message ?? 'Saved.') : r.error, r.ok ? 'ok' : 'error');
    if (r.ok) {
      form.reset({ ...v, status });
      router.refresh();
    }
  }

  const statusTone = v.status === 'active' ? 'success' : v.status === 'draft' ? 'warning' : 'neutral';
  const tabs = [
    { value: 'details' as const, label: 'Details', badge: errorTab === 'details' ? <span className="size-1.5 rounded-full bg-danger" /> : undefined },
    { value: 'pricing' as const, label: 'Pricing', badge: errorTab === 'pricing' ? <span className="size-1.5 rounded-full bg-danger" /> : undefined },
    { value: 'inventory' as const, label: 'Inventory', badge: errorTab === 'inventory' ? <span className="size-1.5 rounded-full bg-danger" /> : undefined },
    { value: 'addons' as const, label: 'Add-ons', badge: v.suggestedAddonIds.length ? <span className="mono text-[11px] text-fg-2">{v.suggestedAddonIds.length}</span> : undefined },
  ];

  return (
    <>
      <Topbar crumbs={[{ label: 'Products', href: `/${slug}/products` }, { label: product ? product.name : 'New product' }]} />
      <PageBody wide>
        <header className="mb-2 flex flex-wrap items-center gap-4">
          <Link href={`/${slug}/products`} aria-label="Back to products" className="press grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] border border-control bg-surface text-fg hover:bg-hover max-sm:hidden">
            <ArrowLeft className="size-5" />
          </Link>
          <ProductArt product={{ name: v.name || 'Product', kind: v.kind, icon: v.icon || null, tint: v.tint || null }} imageUrl={image.removed ? null : image.url} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[26px] font-extrabold leading-tight tracking-tight text-fg sm:text-[32px]">{v.name || 'New product'}</h1>
            <p className="mono mt-0.5 truncate text-[13px] text-fg-2">
              {[v.sku || 'No SKU', KIND_LABEL[v.kind] ?? v.kind, cat ?? 'Uncategorized'].join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2 max-sm:w-full">
            <Pill tone={statusTone}>{v.status === 'active' ? 'Active' : v.status === 'draft' ? 'Draft' : 'Archived'}</Pill>
            {product && canEdit && (
              <Button variant="secondary" onClick={duplicate} icon={<Copy className="size-4" />} className="max-sm:ml-auto">Duplicate</Button>
            )}
            {canEdit && <Button onClick={save} pending={form.pending} disabled={!dirty && !!product}>{product ? 'Save' : 'Add product'}</Button>}
          </div>
        </header>
        {!canEdit && <Notice className="mb-4">You can look at prices and stock. Ask a manager to change them.</Notice>}
        {form.status?.kind === 'error' && <Notice kind="danger" className="mb-4">{form.status.text}</Notice>}

        <Tabs label="Product sections" tabs={tabs} value={tab} onSelect={setTab} className="mb-6" />

        <fieldset disabled={!canEdit} className="min-w-0">
          {tab === 'details' && (
            <DetailsTab v={v} set={form.set} err={err} categories={categories} slug={slug} art={art} image={image} onPick={() => fileRef.current?.click()}
              onRemoveImage={() => setImage({ file: null, url: null, removed: !!product?.imageUrl })} product={product} onStatus={setStatus} />
          )}
          {tab === 'pricing' && <PricingTab v={v} set={form.set} err={err} locations={locations} money={money} />}
          {tab === 'inventory' && (
            <InventoryTab v={v} set={form.set} err={err} locations={locations} product={product} slug={slug} defaults={defaults} canEdit={canEdit} />
          )}
          {tab === 'addons' && <AddonsTab v={v} set={form.set} others={others} money={money} />}
        </fieldset>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 5 * 1024 * 1024) return toast('Photos must be under 5 MB.', 'error');
            setImage({ file: f, url: URL.createObjectURL(f), removed: false });
            e.target.value = '';
          }}
        />
        {canEdit && product && (
          <SaveBar
            dirty={dirty}
            pending={form.pending}
            onSave={save}
            onDiscard={() => {
              form.reset(initial);
              setImage({ file: null, url: product.imageUrl, removed: false });
            }}
          />
        )}
      </PageBody>
    </>
  );
}

type TabProps = { v: Values; set: (path: string, value: unknown) => void; err: (k: string) => string | undefined };

// --- Details ----------------------------------------------------------------------------------

function DetailsTab({
  v, set, err, categories, art, image, onPick, onRemoveImage, product, onStatus,
}: TabProps & {
  categories: { id: string; name: string }[]; slug: string; art: { icon: ProductIcon; tint: Tint }; image: { url: string | null; removed: boolean };
  onPick: () => void; onRemoveImage: () => void; product: EditorProduct | null; onStatus: (s: 'active' | 'draft' | 'archived') => void;
}) {
  const shown = image.removed ? null : image.url;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field label="Name" htmlFor="p-name" error={err('name')}>
            <Input id="p-name" value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Castle Bounce House" invalid={!!err('name')} />
          </Field>
          <Field label="SKU" htmlFor="p-sku" optional error={err('sku')}>
            <Input id="p-sku" mono value={v.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} placeholder="BH-CASTLE" />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Kind" htmlFor="p-kind">
            <Select id="p-kind" value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              {PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Category" htmlFor="p-cat" hint={categories.length ? undefined : 'Add categories from the Products page.'}>
            <Select id="p-cat" value={v.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Uncategorized</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Description" htmlFor="p-desc" optional hint="Shown on the quote page and to coaches.">
          <Textarea id="p-desc" value={v.description} onChange={(e) => set('description', e.target.value)} rows={4} placeholder="Size, power needs, age range, setup space…" />
        </Field>
        <div className="flex flex-col gap-4 border-t border-subtle pt-5">
          <Toggle checked={v.taxable} onChange={(x) => set('taxable', x)} label="Taxable" sub="Sales tax applies to this item. You can still switch it off on a single order line." />
          <Toggle checked={v.commissionable} onChange={(x) => set('commissionable', x)} label="Earns commission" sub="Counts toward the salesperson's commission." />
        </div>
      </Card>

      <div className="flex flex-col gap-6">
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">Photo</h2>
            {shown && <Button variant="ghost" size="sm" onClick={onRemoveImage} icon={<X className="size-4" />}>Remove</Button>}
          </div>
          <button type="button" onClick={onPick} className="group relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[var(--radius-card)] border border-dashed border-control">
            {shown ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={shown} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <span className="tint absolute inset-0 grid place-items-center" style={tintStyle(art.tint)}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={PRODUCT_ICON_PATHS[art.icon]} />
                </svg>
              </span>
            )}
            <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-night/85 px-3 py-1.5 text-xs font-semibold text-white opacity-90 transition-opacity group-hover:opacity-100">
              <ImagePlus className="size-3.5" /> {shown ? 'Replace photo' : 'Add a photo'}
            </span>
          </button>
          {!shown && (
            <>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-fg">Icon</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Icon">
                  {(Object.keys(PRODUCT_ICON_PATHS) as ProductIcon[]).map((ic) => (
                    <button key={ic} type="button" role="radio" aria-checked={art.icon === ic} aria-label={ic} onClick={() => set('icon', ic)}
                      className={cx('press grid size-9 place-items-center rounded-[var(--radius-control)] border transition-colors', art.icon === ic ? 'border-accent bg-accent-soft text-accent-text' : 'border-subtle text-fg-2 hover:border-control')}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={PRODUCT_ICON_PATHS[ic]} /></svg>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-fg">Colour</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tile colour">
                  {PRODUCT_TINTS.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={art.tint === t} aria-label={t} onClick={() => set('tint', t)}
                      className={cx('tint press size-8 rounded-full border-2 transition-transform', art.tint === t ? 'scale-110 border-accent' : 'border-transparent')} style={tintStyle(t)} />
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-5 sm:p-6">
          <h2 className="text-base font-semibold text-fg">Status</h2>
          <Segmented label="Status" fill value={v.status} onChange={(s) => onStatus(s)}
            options={[{ value: 'active', label: 'Active' }, { value: 'draft', label: 'Draft' }, { value: 'archived', label: 'Archived' }]} />
          <p className="text-[13px] text-fg-2">
            {v.status === 'active' ? 'Bookable on the order screen.' : v.status === 'draft' ? 'Hidden from the order screen until you make it active.' : 'Kept for old orders and reports, hidden everywhere else.'}
            {product && ' Changes here save straight away.'}
          </p>
        </Card>
      </div>
    </div>
  );
}

// --- Pricing ------------------------------------------------------------------------------------

function PricingTab({ v, set, err, locations, money }: TabProps & { locations: Loc[]; money: (c: number) => string }) {
  const [mode, setMode] = useState<ServiceMode>('staffed');
  const [minutes, setMinutes] = useState(330);
  const pricing: ProductPricing = {
    priceStaffedCents: Math.round(num(v.priceStaffed) * 100),
    pricePickupCents: v.pricePickup ? Math.round(num(v.pricePickup) * 100) : null,
    priceDropoffCents: v.priceDropoff ? Math.round(num(v.priceDropoff) * 100) : null,
    baseHours: v.baseHours ? num(v.baseHours) : null,
    hourlyRateCents: v.hourlyRate ? Math.round(num(v.hourlyRate) * 100) : null,
    overtimeBlockMinutes: v.overtimeBlockMinutes,
    overtimeBlockCents: Math.round(num(v.overtimeBlockPrice) * 100),
  };
  const hours = minutes / 60;
  const price = linePrice(pricing, mode, hours);
  const included = pricing.baseHours ?? 1;
  const incPct = Math.min(100, (included / hours) * 100);
  const blocks = price.trace.method === 'blocks' || (price.trace.method === 'hourly' && price.trace.units) ? (price.trace.units ?? 0) : price.trace.method === 'hourly' ? 1 : 0;
  const incLabel = v.baseHours ? `${num(v.baseHours)} h` : '1 h (default)';
  const after = pricing.hourlyRateCents ? `${money(pricing.hourlyRateCents)} / hour` : `${money(pricing.overtimeBlockCents)} / ${v.overtimeBlockMinutes} min`;
  const minLabel = v.minHours ? `${num(v.minHours)} h` : '—';
  const hrs = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`;

  const rows: { key: 'priceStaffed' | 'pricePickup' | 'priceDropoff'; mode: ServiceMode }[] = [
    { key: 'priceStaffed', mode: 'staffed' }, { key: 'pricePickup', mode: 'pickup' }, { key: 'priceDropoff', mode: 'dropoff' },
  ];
  const addOverride = () => {
    const used = new Set(v.locationPrices.map((r) => `${r.locationId}:${r.mode}`));
    const loc = locations.find((l) => !used.has(`${l.id}:staffed`)) ?? locations[0];
    if (!loc) return;
    set('locationPrices', [...v.locationPrices, { locationId: loc.id, mode: 'staffed', price: v.priceStaffed }]);
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">Price rules</h2>
          <p className="text-[13px] text-fg-2">One row per service mode.{locations.length > 1 && ' Add a location row to override prices for one branch.'}</p>
        </div>
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <div className="min-w-[680px] overflow-hidden rounded-[var(--radius-card)] border border-subtle">
            <div className="grid grid-cols-[1.3fr_1fr_0.8fr_1.2fr_0.7fr_40px] gap-3 bg-sunken/70 px-4 py-2.5 text-[13px] font-semibold text-fg-2">
              <span>Service mode · location</span><span>Base price</span><span>Included time</span><span>After included time</span><span>Minimum</span><span />
            </div>
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[1.3fr_1fr_0.8fr_1.2fr_0.7fr_40px] items-center gap-3 border-t border-subtle px-4 py-2.5">
                <span><span className="block font-semibold text-fg">{MODE_LABEL[r.mode]}</span><span className="text-[13px] text-fg-2">All locations</span></span>
                <AffixInput prefix="$" mono inputMode="decimal" aria-label={`${MODE_LABEL[r.mode]} base price`} value={v[r.key]} invalid={!!err(r.key)}
                  placeholder={r.mode === 'staffed' ? '0.00' : 'Not offered'} onChange={(e) => set(r.key, e.target.value)} className="h-9" />
                <span className="mono text-sm text-fg">{incLabel}</span>
                <span className="mono text-sm text-fg">{after}</span>
                <span className="mono text-sm text-fg-2">{minLabel}</span>
                <span />
              </div>
            ))}
            {v.locationPrices.map((r, i) => (
              <div key={i} className="grid grid-cols-[1.3fr_1fr_0.8fr_1.2fr_0.7fr_40px] items-center gap-3 border-t border-subtle bg-accent-soft/20 px-4 py-2.5">
                <span className="flex gap-1.5">
                  <Select aria-label="Service mode" value={r.mode} onChange={(e) => set(`locationPrices.${i}.mode`, e.target.value)} className="h-9 px-2 pr-7 text-[13px]">
                    {SERVICE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </Select>
                  <Select aria-label="Location" value={r.locationId} onChange={(e) => set(`locationPrices.${i}.locationId`, e.target.value)} className="h-9 px-2 pr-7 text-[13px]">
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                </span>
                <AffixInput prefix="$" mono inputMode="decimal" aria-label="Branch price" value={r.price} invalid={!!err(`locationPrices.${i}.price`) || !!err(`locationPrices.${i}.mode`)}
                  onChange={(e) => set(`locationPrices.${i}.price`, e.target.value)} className="h-9" />
                <span className="mono text-sm text-fg">{incLabel}</span>
                <span className="mono text-sm text-fg">{after}</span>
                <span className="mono text-sm text-fg-2">{minLabel}</span>
                <button type="button" aria-label="Remove branch price" onClick={() => set('locationPrices', v.locationPrices.filter((_, j) => j !== i))}
                  className="grid size-8 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-danger-bg hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
        {v.locationPrices.some((_, i) => err(`locationPrices.${i}.mode`)) && (
          <p className="mt-2 text-xs font-medium text-danger" role="alert">That branch already has a price for this mode.</p>
        )}
        {locations.length > 1 && (
          <Button variant="ghost" size="sm" className="mt-3" icon={<Plus className="size-4" />} onClick={addOverride}>Add a location price</Button>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr_1.2fr]">
          <Field label="Included hours" htmlFor="p-inc" hint="Blank = first hour included." error={err('baseHours')}>
            <Input id="p-inc" mono inputMode="decimal" value={v.baseHours} onChange={(e) => set('baseHours', e.target.value)} placeholder="1" />
          </Field>
          <Field label="Hourly rate after that" htmlFor="p-rate" hint="Pro-rata when included hours are set, whole started hours when not." error={err('hourlyRate')}>
            <AffixInput id="p-rate" prefix="$" mono inputMode="decimal" value={v.hourlyRate} onChange={(e) => set('hourlyRate', e.target.value)} placeholder="Blank = overtime blocks" />
          </Field>
          <Field label="Overtime block" htmlFor="p-block" hint="Used when there is no hourly rate." error={err('overtimeBlockPrice')}>
            <div className="flex gap-2">
              <AffixInput id="p-block" prefix="$" mono inputMode="decimal" value={v.overtimeBlockPrice} onChange={(e) => set('overtimeBlockPrice', e.target.value)} />
              <Select aria-label="Block length" value={v.overtimeBlockMinutes} onChange={(e) => set('overtimeBlockMinutes', Number(e.target.value))} className="w-28">
                {[15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
              </Select>
            </div>
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Minimum booking" htmlFor="p-min" optional hint="Warns on the order screen if the event is shorter." error={err('minHours')}>
            <AffixInput id="p-min" suffix="h" mono inputMode="decimal" value={v.minHours} onChange={(e) => set('minHours', e.target.value)} placeholder="None" />
          </Field>
        </div>
      </Card>

      <section className="ink-grid overflow-hidden rounded-[var(--radius-panel)] p-5 text-white sm:p-7" aria-label="Try a price">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">Try a price</h2>
          <div role="radiogroup" aria-label="Service mode" className="flex gap-1 rounded-[12px] bg-white/10 p-1">
            {SERVICE_MODES.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={mode === m.value} onClick={() => setMode(m.value)}
                className={cx('h-8 rounded-[9px] px-3 text-[13px] font-semibold transition-colors', mode === m.value ? 'bg-volt text-night' : 'text-white/70 hover:text-white')}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between text-sm">
          <label htmlFor="try-len" className="text-white/80">Event length</label>
          <span className="mono">{hrs(minutes)}</span>
        </div>
        <input id="try-len" type="range" min={60} max={720} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}
          className="range mt-3" style={{ ['--fill' as string]: `${((minutes - 60) / 660) * 100}%`, ['--accent' as string]: 'var(--volt)', ['--bg-sunken' as string]: 'rgb(255 255 255 / 0.15)', ['--bg-surface' as string]: 'var(--ink)' }} />
        <div className="mt-5 flex h-14 gap-1 overflow-hidden rounded-[12px]" aria-hidden>
          <div className="flex items-center rounded-[10px] bg-[#2C4FE0] px-4 text-[13px] font-semibold transition-[width] duration-300" style={{ width: `${blocks ? incPct : 100}%` }}>
            Base · {hrs(Math.round(Math.min(included, hours) * 60))}
          </div>
          {Array.from({ length: Math.min(blocks, 48) }, (_, i) => (
            <div key={`${blocks}-${i}`} className="anim-pop flex-1 rounded-[8px] bg-volt" style={{ animationDelay: `${i * 30}ms` }} />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <p className="mono text-sm text-white/75">{MODE_LABEL[mode]} · {describeTrace(price.trace, money)}</p>
          <p className="mono text-4xl font-bold tracking-tight">{money(price.unitCents)}</p>
        </div>
        {pricing[mode === 'staffed' ? 'priceStaffedCents' : mode === 'pickup' ? 'pricePickupCents' : 'priceDropoffCents'] == null && (
          <p className="mt-2 text-[13px] text-warning-mark">No {MODE_LABEL[mode].toLowerCase()} price set — the order screen will ask for one.</p>
        )}
        <p className="mt-4 text-[13px] text-white/60">Same engine as the order screen and the server. Parity tests compare it with real Odoo orders to the cent.</p>
      </section>
    </div>
  );
}

// --- Inventory ----------------------------------------------------------------------------------

function InventoryTab({
  v, set, err, locations, product, slug, defaults, canEdit,
}: TabProps & { locations: Loc[]; product: EditorProduct | null; slug: string; defaults: { cleanupMinutes: number }; canEdit: boolean }) {
  const buffer = v.turnaroundMinutes === '' ? defaults.cleanupMinutes : num(v.turnaroundMinutes);
  const fmt = (m: number) => {
    const h = Math.floor(m / 60) % 24;
    const mm = m % 60;
    return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };
  const end = 18 * 60;
  const tracked = v.kind !== 'service' && v.kind !== 'fee';
  const tracking = tracked ? v.tracking : 'none';
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-fg">How you track it</h2>
        {tracked ? (
          <>
            <Segmented label="Tracking" value={v.tracking} onChange={(t) => set('tracking', t)} options={TRACKING.map((t) => ({ value: t.value, label: t.label }))} />
            <p className="text-[13px] text-fg-2">{TRACKING.find((t) => t.value === v.tracking)?.hint}</p>
          </>
        ) : (
          <Notice>Services and fees are not tracked: they never run out and are not held on the calendar.</Notice>
        )}

        {tracking === 'pooled' && (
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <div className="min-w-[520px] overflow-hidden rounded-[var(--radius-card)] border border-subtle">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 bg-sunken/70 px-4 py-2.5 text-[13px] font-semibold text-fg-2">
                <span>Location</span><span>Owned</span><span>Out of service</span><span>Allow overbooking</span>
              </div>
              {locations.map((l) => {
                const p = v.inventory[l.id] ?? { owned: 0, outOfService: 0, allowOverbooking: false };
                return (
                  <div key={l.id} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-3 border-t border-subtle px-4 py-2.5">
                    <span className="font-semibold text-fg">{l.name} <span className="mono text-xs font-normal text-fg-2">{l.code}</span></span>
                    <Stepper label={`Owned at ${l.name}`} value={p.owned} min={0} onChange={(n) => set(`inventory.${l.id}`, { ...p, owned: n, outOfService: Math.min(p.outOfService, n) })} />
                    <Stepper label={`Out of service at ${l.name}`} value={p.outOfService} min={0} max={p.owned} invalid={!!err(`inventory.${l.id}.outOfService`)}
                      onChange={(n) => set(`inventory.${l.id}`, { ...p, outOfService: n })} />
                    <Toggle checked={p.allowOverbooking} onChange={(x) => set(`inventory.${l.id}`, { ...p, allowOverbooking: x })} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tracking === 'serialized' && (
          product ? (
            <Units product={product} locations={locations} slug={slug} canEdit={canEdit} />
          ) : (
            <Notice>Add the product first, then list each unit here with its label and serial.</Notice>
          )
        )}
      </Card>

      {tracked && (
        <Card className="flex flex-col gap-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-fg">Turnaround</h2>
            <p className="text-[13px] text-fg-2">Cleanup after each return, before it can go out again.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[260px_1fr] sm:items-end">
            <Field label="Cleanup after return" htmlFor="p-turn" hint={v.turnaroundMinutes === '' ? `Using your rental rules: ${defaults.cleanupMinutes / 60} h.` : 'Specific to this product.'} error={err('turnaroundMinutes')}>
              <Select id="p-turn" value={v.turnaroundMinutes} onChange={(e) => set('turnaroundMinutes', e.target.value)}>
                <option value="">Rental rules default ({defaults.cleanupMinutes / 60} h)</option>
                {[0, 30, 60, 90, 120, 180, 240, 360, 720, 1440].map((m) => (
                  <option key={m} value={String(m)}>{m === 0 ? 'None' : m < 60 ? `${m} min` : `${m / 60} h`}</option>
                ))}
              </Select>
            </Field>
            <div aria-hidden className="flex h-12 overflow-hidden rounded-[12px] text-[12px] font-semibold">
              <div className="flex items-center bg-accent px-3 text-on-accent" style={{ flex: 5 }}>Event 1:00 – 6:00 PM</div>
              {buffer > 0 && <div className="hatch flex items-center border-y border-r border-subtle px-3 text-fg-2" style={{ flex: Math.max(1.2, buffer / 60) }}>Cleaning</div>}
              <div className="flex items-center bg-success-bg px-3 text-success-fg" style={{ flex: 2.4 }}>Free from {fmt(end + buffer)}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 10000, label, invalid }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string; invalid?: boolean }) {
  return (
    <div className={cx('inline-flex h-9 w-[120px] items-stretch overflow-hidden rounded-[var(--radius-control)] border bg-surface', invalid ? 'border-danger' : 'border-control')}>
      <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="w-9 text-lg text-fg-2 hover:bg-sunken disabled:opacity-40">−</button>
      <input aria-label={label} inputMode="numeric" value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))))}
        className="mono w-0 flex-1 bg-transparent text-center text-sm text-fg focus:outline-none" />
      <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="w-9 text-lg text-fg-2 hover:bg-sunken disabled:opacity-40">+</button>
    </div>
  );
}

function Units({ product, locations, slug, canEdit }: { product: EditorProduct; locations: Loc[]; slug: string; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [serial, setSerial] = useState('');
  const [loc, setLoc] = useState(locations[0]?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    toast(r.ok ? (r.message ?? 'Saved.') : (r.error ?? 'Failed.'), r.ok ? 'ok' : 'error');
    if (r.ok) router.refresh();
    return r.ok;
  };
  const next = `${product.name.split(' ')[0]} #${product.units.length + 1}`;
  return (
    <div className="flex flex-col gap-3">
      {product.units.length === 0 ? (
        <p className="text-sm text-fg-2">No units yet. Each unit you add can be booked once at a time.</p>
      ) : (
        <ul className="divide-y divide-subtle overflow-hidden rounded-[var(--radius-card)] border border-subtle">
          {product.units.map((u) => {
            const s = UNIT_STATUS[u.status as UnitStatus];
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-fg">{u.label}</span>
                  <span className="mono text-xs text-fg-2">{u.serial ?? 'No serial'} · {locations.find((l) => l.id === u.locationId)?.name}</span>
                </span>
                <Pill tone={s?.tone ?? 'neutral'}>{s?.label ?? u.status}</Pill>
                {canEdit && (
                  <>
                    <Select aria-label={`Status of ${u.label}`} value={u.status} disabled={busy === u.id} className="h-9 w-40"
                      onChange={(e) => run(u.id, () => setUnitStatusAction(slug, u.id, e.target.value))}>
                      {Object.entries(UNIT_STATUS).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
                    </Select>
                    <button type="button" aria-label={`Remove ${u.label}`} onClick={() => run(u.id, () => removeUnitAction(slug, u.id))}
                      className="grid size-9 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-danger-bg hover:text-danger">
                      <Trash2 className="size-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <form
          className="grid grid-cols-1 gap-2 rounded-[var(--radius-card)] bg-sunken/60 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run('add', () => addUnitAction(slug, { productId: product.id, locationId: loc, label: label || next, serial }));
            if (ok) { setLabel(''); setSerial(''); }
          }}
        >
          <Input aria-label="Unit label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={next} />
          <Input aria-label="Serial" mono value={serial} onChange={(e) => setSerial(e.target.value.toUpperCase())} placeholder="Serial (optional)" />
          <Select aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Button type="submit" pending={busy === 'add'} icon={<Wrench className="size-4" />}>Add unit</Button>
        </form>
      )}
    </div>
  );
}

// --- Add-ons ------------------------------------------------------------------------------------

function AddonsTab({ v, set, others, money }: { v: Values; set: (path: string, value: unknown) => void; others: Other[]; money: (c: number) => string }) {
  const sorted = [...others].sort((a, b) => Number(b.kind === 'addon') - Number(a.kind === 'addon') || a.name.localeCompare(b.name));
  const toggle = (id: string, on: boolean) => set('suggestedAddonIds', on ? [...v.suggestedAddonIds, id] : v.suggestedAddonIds.filter((x) => x !== id));
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-fg">Suggested add-ons</h2>
        <p className="mt-1 text-[13px] text-fg-2">Shown on the order screen when this item is in the cart.</p>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-fg-2">Add more products first.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((o) => {
            const on = v.suggestedAddonIds.includes(o.id);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(o.id, !on)}
                  className={cx('press flex w-full items-center gap-3 rounded-[var(--radius-card)] border p-3 text-left transition-colors', on ? 'border-accent bg-accent-soft/30' : 'border-subtle hover:border-control')}
                >
                  <ProductArt product={o} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-fg">{o.name}</span>
                    <span className="mono text-xs text-fg-2">from {money(o.fromCents)}</span>
                  </span>
                  <span className={cx('grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors', on ? 'border-accent bg-accent text-on-accent' : 'border-control bg-surface')} aria-hidden>
                    {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}><path d="M5 12l5 5L20 7" /></svg>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
