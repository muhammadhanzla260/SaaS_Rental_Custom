'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ImagePlus, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { linePrice, toCents, type ProductPricing } from '@rental/core';
import { MoneyInput, Stepper, useMoneyFormat } from '@/components/money';
import { Button, Card, cx, Field, Input, Notice, SaveBar, Segmented, Select, Textarea, Toggle } from '@/components/ui';
import { useForm } from '@/lib/form';
import { saveProductAction } from '@/server/actions/commerce';

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function ProductForm({
  slug, id, initial, imageUrl, categories, locations, currency, defaultTurnaround,
}: {
  slug: string; id: string | null; initial: Obj; imageUrl: string | null;
  categories: { id: string; name: string }[]; locations: { id: string; name: string; code: string }[];
  currency: string; defaultTurnaround: number;
}) {
  const router = useRouter();
  const form = useForm<Obj>(initial);
  const v = form.values;
  const money = useMoneyFormat(currency);
  const [image, setImage] = useState<{ file: File | null; removed: boolean }>({ file: null, removed: false });
  const [over, setOver] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (image.file ? URL.createObjectURL(image.file) : image.removed ? null : imageUrl), [image, imageUrl]);
  const [hours, setHours] = useState(Math.max(4, Number(v.baseHours) || 4));
  const extraMode: 'hourly' | 'blocks' = v.hourlyRate != null ? 'hourly' : 'blocks';

  const pricing: ProductPricing = {
    priceStaffedCents: toCents(Number(v.priceStaffed) || 0),
    pricePickupCents: v.pricePickup == null ? null : toCents(Number(v.pricePickup)),
    priceDropoffCents: v.priceDropoff == null ? null : toCents(Number(v.priceDropoff)),
    baseHours: Number(v.baseHours) || null,
    hourlyRateCents: v.hourlyRate == null ? null : toCents(Number(v.hourlyRate)),
    overtimeBlockMinutes: Number(v.overtimeBlockMinutes) || 15,
    overtimeBlockCents: toCents(Number(v.overtimeBlockPrice) || 0),
  };

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return setImgError('Use a PNG, JPG or WebP photo.');
    if (f.size > 4 * 1024 * 1024) return setImgError('The photo must be 4 MB or smaller.');
    setImgError(null);
    setImage({ file: f, removed: false });
    form.set('_image', Date.now());
  };

  const save = () => {
    const fd = new FormData();
    fd.set('payload', JSON.stringify(v));
    if (image.file) fd.set('image', image.file);
    if (image.removed) fd.set('imageRemove', '1');
    form.submit(() => saveProductAction(slug, id, fd), (r) => {
      if (!id && r.data) router.push(`/${slug}/catalog/${r.data.id}`);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/${slug}/catalog`} className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> Catalog
      </Link>

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files?.[0] ?? null); }}
            className={cx('relative aspect-[4/3] overflow-hidden rounded-[calc(var(--radius)*1.4)] border-2 border-dashed transition-all',
              over ? 'scale-[1.02] border-brand bg-brand-soft' : 'border-line-strong bg-surface hover:border-brand')}
            aria-label={preview ? 'Replace photo' : 'Add a photo'}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <span className="flex size-full flex-col items-center justify-center gap-2 text-muted">
                <ImagePlus aria-hidden className="size-8" />
                <span className="text-sm font-medium">Drop a photo or click</span>
                <span className="text-xs">PNG, JPG or WebP, up to 4 MB</span>
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Product photo"
            onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          {preview && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setImage({ file: null, removed: true }); form.set('_image', Date.now()); }}>
              <Trash2 aria-hidden className="size-4" /> Remove photo
            </Button>
          )}
          {imgError && <Notice kind="error">{imgError}</Notice>}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="p-name" error={form.error('name')} className="sm:col-span-2">
                <Input id="p-name" value={v.name} onChange={(e) => form.set('name', e.target.value)} className="min-h-12 text-lg font-medium" aria-invalid={!!form.error('name')} placeholder="Castle Bounce House" />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Type</span>
                <Segmented id="p-kind" label="Type" value={v.kind} onChange={(k) => form.set('kind', k)}
                  options={[{ value: 'rental', label: 'Rental' }, { value: 'addon', label: 'Add-on' }, { value: 'service', label: 'Service' }]} />
              </div>
              <Field label="Category" htmlFor="p-cat" optional>
                <Select id="p-cat" value={v.categoryId ?? ''} onChange={(e) => form.set('categoryId', e.target.value || null)}>
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Description" htmlFor="p-desc" optional className="sm:col-span-2" hint="Shown on quotes. Size, power needs, age range.">
                <Textarea id="p-desc" value={v.description ?? ''} onChange={(e) => form.set('description', e.target.value)} />
              </Field>
              <Field label="SKU" htmlFor="p-sku" optional>
                <Input id="p-sku" value={v.sku ?? ''} onChange={(e) => form.set('sku', e.target.value)} />
              </Field>
              <Field label="Status" htmlFor="p-status">
                <Select id="p-status" value={v.status} onChange={(e) => form.set('status', e.target.value)}>
                  <option value="active">Active: can be booked</option>
                  <option value="draft">Draft: hidden from orders</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="Pricing" description="One price per service. Time beyond the included hours adds an hourly rate, or a charge per started block.">
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Staffed" htmlFor="p-staffed" error={form.error('priceStaffed')} hint="Delivered, set up and attended.">
                  <MoneyInput id="p-staffed" currency={currency} value={v.priceStaffed} onChange={(n) => form.set('priceStaffed', n ?? 0)} invalid={!!form.error('priceStaffed')} />
                </Field>
                <Field label="Pick-up" htmlFor="p-pickup" optional hint="Customer collects. Empty: not offered.">
                  <MoneyInput id="p-pickup" currency={currency} value={v.pricePickup} onChange={(n) => form.set('pricePickup', n)} />
                </Field>
                <Field label="Drop-off" htmlFor="p-dropoff" optional hint="Delivered, not attended.">
                  <MoneyInput id="p-dropoff" currency={currency} value={v.priceDropoff} onChange={(n) => form.set('priceDropoff', n)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Hours included" htmlFor="p-base" optional hint="Empty: the first hour.">
                  <MoneyInput id="p-base" value={v.baseHours} onChange={(n) => form.set('baseHours', n)} suffix="hours" />
                </Field>
                <Field label="Minimum booking" htmlFor="p-min" optional>
                  <MoneyInput id="p-min" value={v.minHours} onChange={(n) => form.set('minHours', n)} suffix="hours" />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Extra time</span>
                  <Segmented id="p-extra" label="Extra time" value={extraMode}
                    onChange={(m) => form.set('hourlyRate', m === 'hourly' ? Number(v.hourlyRate ?? 50) || 50 : null)}
                    options={[{ value: 'hourly', label: 'Per hour' }, { value: 'blocks', label: 'Per block' }]} />
                </div>
              </div>
              {extraMode === 'hourly' ? (
                <Field label="Each extra hour" htmlFor="p-rate" className="sm:max-w-xs" hint="Charged per started hour beyond the included time.">
                  <MoneyInput id="p-rate" currency={currency} value={v.hourlyRate} onChange={(n) => form.set('hourlyRate', n ?? 0)} />
                </Field>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 sm:max-w-lg">
                  <Field label="Block price" htmlFor="p-block" hint="Odoo default: $25.">
                    <MoneyInput id="p-block" currency={currency} value={v.overtimeBlockPrice} onChange={(n) => form.set('overtimeBlockPrice', n ?? 0)} />
                  </Field>
                  <Field label="Block length" htmlFor="p-blockmin" hint="Each started block is charged.">
                    <MoneyInput id="p-blockmin" value={v.overtimeBlockMinutes} onChange={(n) => form.set('overtimeBlockMinutes', n ?? 15)} suffix="minutes" />
                  </Field>
                </div>
              )}

              <div className="rounded-ui border border-dashed border-brand/30 bg-brand-soft/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label htmlFor="p-try" className="text-sm font-medium">Try it: a party of</label>
                  <motion.span key={hours} initial={{ scale: 1.2 }} animate={{ scale: 1 }} className="rounded-full bg-surface px-2.5 py-0.5 text-sm font-semibold tabular shadow-card">
                    {hours} {hours === 1 ? 'hour' : 'hours'}
                  </motion.span>
                </div>
                <input id="p-try" type="range" min={1} max={12} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))}
                  className="range-brand mt-3" style={{ '--fill': `${((hours - 1) / 11) * 100}%` } as React.CSSProperties} />
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {(['staffed', 'pickup', 'dropoff'] as const).map((m) => {
                    const offered = m === 'staffed' || (m === 'pickup' ? v.pricePickup != null : v.priceDropoff != null);
                    const p = linePrice(pricing, m, hours);
                    return (
                      <div key={m} className="rounded-ui-sm bg-surface p-2.5 shadow-card">
                        <div className="text-xs uppercase tracking-wide text-muted">{m === 'staffed' ? 'Staffed' : m === 'pickup' ? 'Pick-up' : 'Drop-off'}</div>
                        <div className="font-display text-lg font-bold text-brand-text tabular">{offered ? money(p.unitCents) : '—'}</div>
                        {offered && p.trace.extraCents > 0 && <div className="text-xs text-muted">incl. {money(p.trace.extraCents)} extra time</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <Toggle id="p-taxable" checked={!!v.taxable} onChange={(x) => form.set('taxable', x)} label="Charge sales tax" />
            </div>
          </Card>

          <Card title="Inventory" description="How many you own at each location. Bookings can never go over this.">
            <div className="flex flex-col gap-3">
              {locations.map((l) => (
                <div key={l.id} className="flex items-center justify-between gap-3">
                  <label htmlFor={`inv-${l.id}`} className="min-w-0">
                    <span className="font-medium">{l.name}</span> <span className="font-mono text-xs text-muted">{l.code}</span>
                  </label>
                  <Stepper id={`inv-${l.id}`} label={`owned at ${l.name}`} value={Number(v.inventory?.[l.id] ?? 0)} onChange={(n) => form.set(`inventory.${l.id}`, n)} />
                </div>
              ))}
              <Field label="Cleanup time after each rental" htmlFor="p-turn" optional hint={`Empty: your default of ${defaultTurnaround / 60} hours.`} className="mt-2 sm:max-w-xs">
                <MoneyInput id="p-turn" value={v.turnaroundMinutes} onChange={(n) => form.set('turnaroundMinutes', n == null ? null : Math.round(n))} suffix="minutes" />
              </Field>
            </div>
          </Card>
        </div>
      </div>
      <SaveBar {...form} label={id ? 'Save product' : 'Add product'} onSave={save} />
    </div>
  );
}
