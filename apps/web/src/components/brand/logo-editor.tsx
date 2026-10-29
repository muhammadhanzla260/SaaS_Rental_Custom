'use client';

import { Check, ImageUp, RotateCcw, RotateCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { checkAccent, DEFAULT_LOGO_ADJUST, initials, LOGO_VARIANT_LABELS, LOGO_VARIANTS, type LogoAdjust, type LogoVariant } from '@rental/core';
import { Button, cx, Segmented, Slider } from '@/components/kit';
import { logoImgStyle } from './logo-mark';

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
export const LOGO_MAX = 2 * 1024 * 1024;

export type LogoValue = Record<LogoVariant, LogoAdjust>;

const BG = (a: LogoAdjust, brand: string, fallback = 'transparent') =>
  ({ none: fallback, white: '#FFFFFF', brand, dark: '#0B0D12' })[a.background];

const radiusOf = (a: LogoAdjust, sq: string, rd: string) => ({ square: sq, rounded: rd, circle: '50%' })[a.shape];
const normRot = (r: number) => ((((r + 180) % 360) + 360) % 360) - 180;

/** One logo variant drawn in a box (used for every "Where it appears" preview). */
function Variant({ src, a, w, h, brand, radius, padScale, fallbackBg, name, initialsColor }: {
  src: string | null; a: LogoAdjust; w: number; h: number; brand: string; radius: string; padScale: number; fallbackBg?: string; name: string; initialsColor?: string;
}) {
  const bg = BG(a, brand, fallbackBg);
  if (!src) {
    const fill = initialsColor ?? brand;
    return (
      <span className="grid shrink-0 place-items-center font-bold" style={{ width: w, height: h, borderRadius: radius, background: fill, color: checkAccent(fill).onAccent, fontSize: Math.round(Math.min(w, h) * 0.38) }}>
        {initials(name)}
      </span>
    );
  }
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden" style={{ width: w, height: h, borderRadius: radius, background: bg, padding: Math.round(a.padding * padScale) }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} className="size-full object-contain" style={logoImgStyle(a)} />
    </span>
  );
}

export function LogoEditor({
  src, fileName, value, onChange, onFile, onRemove, brandColor, name, error,
}: {
  /** Saved logo URL or an object URL for a new upload; null = initials. */
  src: string | null;
  fileName?: string | null;
  value: LogoValue;
  onChange: (v: LogoValue) => void;
  onFile: (f: File) => void;
  onRemove: () => void;
  brandColor: string;
  name: string;
  error?: string | null;
}) {
  const [variant, setVariant] = useState<LogoVariant>('main');
  const [drag, setDrag] = useState<{ mx: number; my: number; x: number; y: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [scan, setScan] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cur = value[variant];
  const patch = (p: Partial<LogoAdjust>) => onChange({ ...value, [variant]: { ...cur, ...p } });
  useEffect(() => { if (!scan) return; const t = setTimeout(() => setScan(false), 900); return () => clearTimeout(t); }, [scan]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!LOGO_ACCEPT.split(',').includes(f.type)) return setLocalError('Upload a PNG, JPG, WebP or SVG image.');
    if (f.size > LOGO_MAX) return setLocalError('The logo must be 2 MB or smaller.');
    setLocalError(null);
    setScan(true);
    onFile(f);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const clamp = (n: number) => Math.max(-50, Math.min(50, Math.round(n)));
    patch({ x: clamp(drag.x + (e.clientX - drag.mx) / 2.1), y: clamp(drag.y + (e.clientY - drag.my) / 2.1) });
  };
  const canvasBg = variant === 'onDark' && cur.background === 'none' ? '#0B0D12' : BG(cur, brandColor, 'transparent');
  const canvasRadius = variant === 'icon' ? radiusOf(cur, '8px', '22%') : '12px';
  const err = error ?? localError;
  const sizeLabel = useMemo(() => (fileName ? fileName : src ? 'Current logo' : null), [fileName, src]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Logo version" value={variant} onChange={setVariant} options={LOGO_VARIANTS.map((v) => ({ value: v, label: LOGO_VARIANT_LABELS[v] }))} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {sizeLabel && (
            <span className="mono hidden items-center gap-1.5 rounded-[var(--radius-control)] bg-sunken px-2.5 py-2 text-xs text-fg-2 sm:inline-flex">
              <Check className="size-3.5 text-success" /> <span className="max-w-[180px] truncate">{sizeLabel}</span>
            </span>
          )}
          <input ref={input} type="file" accept={LOGO_ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} aria-label="Upload logo" />
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>{src ? 'Replace' : 'Upload logo'}</Button>
          {src && <Button variant="danger-ghost" size="sm" onClick={onRemove}>Remove</Button>}
        </div>
      </div>
      {err && <p className="text-xs font-medium text-danger" role="alert">{err}</p>}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          {src ? (
            <div
              className={cx('relative mx-auto aspect-square w-full max-w-[260px] touch-none select-none overflow-hidden rounded-[14px] border border-subtle', drag ? 'cursor-grabbing' : 'cursor-grab')}
              style={{ backgroundImage: 'repeating-conic-gradient(#D9DDE3 0% 25%, #F3F4F6 0% 50%)', backgroundSize: '16px 16px' }}
              onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ mx: e.clientX, my: e.clientY, x: cur.x, y: cur.y }); }}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDrag(null)}
              onPointerCancel={() => setDrag(null)}
              role="application"
              aria-label="Drag to move the logo"
            >
              <div className="absolute inset-6 grid place-items-center overflow-hidden" style={{ background: canvasBg, borderRadius: canvasRadius, padding: cur.padding }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="Logo preview" draggable={false} className="size-full object-contain transition-transform duration-75" style={logoImgStyle(cur)} />
              </div>
              {drag && <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(var(--accent)_1px,transparent_1px),linear-gradient(90deg,var(--accent)_1px,transparent_1px)] bg-[size:33.33%_33.33%] opacity-25" />}
              {scan && <div aria-hidden="true" className="anim-slide pointer-events-none absolute inset-x-0 top-0 h-full bg-gradient-to-b from-transparent via-accent/20 to-transparent" />}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}
              className="press mx-auto grid aspect-square w-full max-w-[260px] place-items-center rounded-[14px] border-2 border-dashed border-control bg-surface p-6 text-center transition-colors hover:border-accent hover:bg-accent-soft/30"
            >
              <span className="flex flex-col items-center gap-2">
                <ImageUp className="size-7 text-fg-2" aria-hidden="true" />
                <span className="text-sm font-semibold text-fg">Drop your logo, or click to upload</span>
                <span className="text-xs text-fg-2">PNG, JPG, WebP or SVG · up to 2 MB</span>
              </span>
            </button>
          )}
          <p className="mt-2 text-center text-xs text-fg-2">{src ? 'Drag to move · sliders for fine control' : 'No logo yet? Your initials are used until you add one.'}</p>
        </div>

        <fieldset disabled={!src} className="flex flex-col gap-4 disabled:opacity-50">
          <legend className="sr-only">Adjust {LOGO_VARIANT_LABELS[variant]}</legend>
          <Slider id="lg-zoom" label="Size" min={50} max={200} value={cur.zoom} onChange={(n) => patch({ zoom: n })} display={`${cur.zoom}%`} />
          <Slider id="lg-x" label="Horizontal" min={-50} max={50} value={cur.x} onChange={(n) => patch({ x: n })} display={cur.x > 0 ? `+${cur.x}` : cur.x} />
          <Slider id="lg-y" label="Vertical" min={-50} max={50} value={cur.y} onChange={(n) => patch({ y: n })} display={cur.y > 0 ? `+${cur.y}` : cur.y} />
          <Slider id="lg-pad" label="Padding" min={0} max={40} value={cur.padding} onChange={(n) => patch({ padding: n })} display={`${cur.padding} px`} />
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-fg">Background</span>
            <Segmented label="Background" fill size="sm" value={cur.background} onChange={(v) => patch({ background: v })} options={[{ value: 'none', label: 'None' }, { value: 'white', label: 'White' }, { value: 'brand', label: 'Brand' }, { value: 'dark', label: 'Dark' }]} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-fg">Shape</span>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented label="Shape" size="sm" value={cur.shape} onChange={(v) => patch({ shape: v })} options={[{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'circle', label: 'Circle' }]} />
              <Button variant="secondary" size="sm" aria-label="Rotate left" onClick={() => patch({ rotate: normRot(cur.rotate - 90) })}><RotateCcw className="size-4" /></Button>
              <Button variant="secondary" size="sm" aria-label="Rotate right" onClick={() => patch({ rotate: normRot(cur.rotate + 90) })}><RotateCw className="size-4" /></Button>
              <Button variant="secondary" size="sm" onClick={() => patch({ x: 0, y: 0 })}>Center</Button>
              <Button variant="secondary" size="sm" onClick={() => patch({ ...DEFAULT_LOGO_ADJUST[variant] })}>Reset</Button>
            </div>
          </div>
        </fieldset>
      </div>

      <div>
        <p className="eyebrow mb-3">Where it appears</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <figure className="flex flex-col gap-1.5">
            <div className="flex h-[76px] items-center gap-2.5 rounded-xl bg-night px-3">
              <Variant src={src} a={value.icon} w={36} h={36} brand={brandColor} radius={radiusOf(value.icon, '6px', '10px')} padScale={0.35} fallbackBg="#FFFFFF" name={name} initialsColor="#D4FF3A" />
              <span className="flex flex-1 flex-col gap-1.5"><span className="h-1.5 w-full rounded-full bg-white/25" /><span className="h-1.5 w-2/3 rounded-full bg-white/15" /></span>
            </div>
            <figcaption className="text-xs text-fg-2">App sidebar</figcaption>
          </figure>
          <figure className="flex flex-col gap-1.5">
            <div className="grid h-[76px] place-items-center rounded-xl px-3" style={{ background: brandColor }}>
              <Variant src={src} a={value.onDark} w={120} h={44} brand={brandColor} radius="6px" padScale={0.3} name={name} initialsColor="#FFFFFF" />
            </div>
            <figcaption className="text-xs text-fg-2">Email header</figcaption>
          </figure>
          <figure className="flex flex-col gap-1.5">
            <div className="flex h-[76px] items-center justify-between rounded-xl border border-subtle bg-white px-3">
              <Variant src={src} a={value.main} w={84} h={36} brand={brandColor} radius="4px" padScale={0.25} name={name} />
              <span className="flex flex-col items-end gap-1"><span className="text-[9px] font-bold tracking-wide text-[#10131A]">INVOICE</span><span className="h-1 w-8 rounded-full bg-[#E2E5EA]" /><span className="h-1 w-6 rounded-full bg-[#E2E5EA]" /></span>
            </div>
            <figcaption className="text-xs text-fg-2">Quote & invoice PDF</figcaption>
          </figure>
          <figure className="flex flex-col gap-1.5">
            <div className="flex h-[76px] items-end rounded-xl bg-sunken px-2 pb-0">
              <div className="flex w-full items-center gap-2 rounded-t-lg bg-surface px-2.5 py-2 text-xs text-fg">
                <Variant src={src} a={value.icon} w={16} h={16} brand={brandColor} radius={radiusOf(value.icon, '2px', '4px')} padScale={0.1} fallbackBg="#FFFFFF" name={name} />
                <span className="truncate">Your quote · {name}</span>
              </div>
            </div>
            <figcaption className="text-xs text-fg-2">Browser tab</figcaption>
          </figure>
          <figure className="flex flex-col gap-1.5">
            <div className="grid h-[76px] place-items-center rounded-xl bg-gradient-to-br from-[#1B2233] to-night">
              <Variant src={src} a={value.icon} w={54} h={54} brand={brandColor} radius={radiusOf(value.icon, '10px', '16px')} padScale={0.5} fallbackBg="#FFFFFF" name={name} />
            </div>
            <figcaption className="text-xs text-fg-2">Coach app icon</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}
