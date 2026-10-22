'use client';

import { CalendarClock, Clock4, Coins, Globe2, ImageUp, Lightbulb, MapPin, Monitor, Moon, Sparkles, Sun, Trash2, Truck, Wallet } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildPalette, countryName, countryOptions, currencyOptions, detectRegion, formatPhone, listTimezones, normalizePhone,
  RADIUS_OPTIONS, THEME_PRESETS, timezoneAt, timezoneOptions, type BookingDefaults,
} from '@rental/core';
import { AddressSearch, PinMap } from './address-picker';
import { useMapboxToken } from './mapbox-token';
import { Button, cx, Field, Input, Notice, Segmented, Select, Textarea, Toggle } from './ui';

/** A slice of a form: relative paths, so the same fields work in onboarding and settings. */
export type Scope = {
  id: string;
  v: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  set: (path: string, value: unknown) => void;
  err: (path: string) => string | undefined;
};

export function scope(
  form: { values: unknown; set: (p: string, v: unknown) => void; error: (p: string) => string | undefined },
  prefix: string,
): Scope {
  const v = prefix
    ? prefix.split('.').reduce<any>((acc, k) => acc?.[k], form.values) ?? {} // eslint-disable-line @typescript-eslint/no-explicit-any
    : (form.values as Record<string, unknown>);
  const p = (path: string) => (prefix ? `${prefix}.${path}` : path);
  return { id: prefix.replace(/\./g, '-') || 'f', v, set: (path, value) => form.set(p(path), value), err: (path) => form.error(p(path)) };
}

const fid = (s: Scope, name: string) => `${s.id}-${name.replace(/\./g, '-')}`;

function TextField({
  s, name, label, type = 'text', hint, optional, autoComplete, placeholder, inputMode, className,
}: {
  s: Scope; name: string; label: string; type?: string; hint?: string; optional?: boolean; autoComplete?: string;
  placeholder?: string; inputMode?: 'text' | 'email' | 'tel' | 'url' | 'decimal' | 'numeric'; className?: string;
}) {
  const id = fid(s, name);
  const value = name.split('.').reduce<any>((a, k) => a?.[k], s.v); // eslint-disable-line @typescript-eslint/no-explicit-any
  return (
    <Field label={label} htmlFor={id} hint={hint} error={s.err(name)} optional={optional} className={className}>
      <Input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={(e) => s.set(name, e.target.value)}
        aria-invalid={!!s.err(name)}
        aria-describedby={s.err(name) ? `${id}-error` : undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        inputMode={inputMode}
      />
    </Field>
  );
}

export function PhoneField({ s, name, label, country, optional = true }: { s: Scope; name: string; label: string; country: string; optional?: boolean }) {
  const id = fid(s, name);
  return (
    <Field label={label} htmlFor={id} error={s.err(name)} optional={optional} hint="Include the country code for numbers outside your country.">
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={s.v[name] ?? ''}
        onChange={(e) => s.set(name, e.target.value)}
        onBlur={(e) => {
          const e164 = normalizePhone(e.target.value, country);
          if (e164) s.set(name, formatPhone(e164, 'US'));
        }}
        aria-invalid={!!s.err(name)}
      />
    </Field>
  );
}

// --- business profile ---------------------------------------------------------------

export function ProfileFields({ s, country, hideName }: { s: Scope; country: string; hideName?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {!hideName && <TextField s={s} name="name" label="Business name" autoComplete="organization" />}
      <TextField s={s} name="legalName" label="Legal name" optional hint="Shown on invoices if different." />
      <TextField s={s} name="email" label="Business email" type="email" inputMode="email" optional hint="Customers reply to this address." />
      <PhoneField s={s} name="phone" label="Main phone" country={country} />
      <TextField s={s} name="website" label="Website" type="url" inputMode="url" optional placeholder="https://" />
      <TextField s={s} name="taxId" label="Tax ID / EIN" optional hint="Printed on invoices." />
    </div>
  );
}

// --- address with coordinates ----------------------------------------------------------

export function AddressFields({
  s, requireStreet, showCoordinates = false, showMap = true, near,
}: {
  s: Scope;
  requireStreet?: boolean;
  /** The pin matters (warehouses: travel fees are measured from it). */
  showCoordinates?: boolean;
  showMap?: boolean;
  /** Bias search results toward this point (for example the business address). */
  near?: { lat: number; lng: number } | null;
}) {
  const countries = useMemo(() => countryOptions(), []);
  const token = useMapboxToken();
  const a = s.v;
  const hasCoords = typeof a.lat === 'number' && typeof a.lng === 'number';
  const [manualCoords, setManualCoords] = useState(false);

  /** A search pick replaces the whole address; a pin move keeps line 2 (suite, unit). */
  const apply = (filled: Partial<Record<string, unknown>>, replace: boolean) => {
    for (const key of ['line1', 'line2', 'city', 'region', 'postalCode', 'country', 'lat', 'lng'] as const) {
      if (filled[key] !== undefined) s.set(key, filled[key]);
      else if (replace && key === 'line2') s.set(key, '');
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="flex flex-col gap-3 sm:col-span-6">
        <AddressSearch country={a.country} near={hasCoords ? { lat: a.lat, lng: a.lng } : near} onPick={(f) => apply(f, true)} />
        {showMap && token && (
          <PinMap lat={a.lat} lng={a.lng} label={a.line1 || 'this address'} onMove={(f) => apply(f, false)} />
        )}
      </div>
      <TextField s={s} name="line1" label="Street address" autoComplete="address-line1" optional={!requireStreet} className="sm:col-span-4" />
      <TextField s={s} name="line2" label="Suite, unit" autoComplete="address-line2" optional className="sm:col-span-2" />
      <TextField s={s} name="city" label="City" autoComplete="address-level2" optional={!requireStreet} className="sm:col-span-2" />
      <TextField s={s} name="region" label="State / region" autoComplete="address-level1" optional className="sm:col-span-2" />
      <TextField s={s} name="postalCode" label="ZIP / postal code" autoComplete="postal-code" optional className="sm:col-span-2" />
      <Field label="Country" htmlFor={fid(s, 'country')} className="sm:col-span-3">
        <Select id={fid(s, 'country')} value={a.country ?? 'US'} onChange={(e) => s.set('country', e.target.value)}>
          {countries.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>
      </Field>
      {(showCoordinates || hasCoords) && (
        <div className="flex flex-col gap-3 sm:col-span-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <MapPin aria-hidden className={cx('size-4 shrink-0', hasCoords ? 'text-ok' : 'text-warn')} />
              {hasCoords ? (
                <span className="tabular">Pinned at {a.lat.toFixed(5)}, {a.lng.toFixed(5)}</span>
              ) : (
                <span className="text-warn">{showCoordinates ? 'Not pinned yet. Travel fees are measured from this point.' : 'Not pinned yet.'}</span>
              )}
            </span>
            {token && (
              <button type="button" className="text-brand-text underline" onClick={() => setManualCoords(!manualCoords)} aria-expanded={manualCoords}>
                {manualCoords ? 'Hide coordinates' : 'Enter coordinates by hand'}
              </button>
            )}
          </div>
          {(manualCoords || !token) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Latitude" htmlFor={fid(s, 'lat')} error={s.err('lat')} optional hint="For example 30.267153">
                <CoordinateInput id={fid(s, 'lat')} value={a.lat} onChange={(n) => s.set('lat', n)} invalid={!!s.err('lat')} />
              </Field>
              <Field label="Longitude" htmlFor={fid(s, 'lng')} error={s.err('lng')} optional hint="For example -97.743057">
                <CoordinateInput id={fid(s, 'lng')} value={a.lng} onChange={(n) => s.set('lng', n)} invalid={!!s.err('lng')} />
              </Field>
            </div>
          )}
        </div>
      )}
      {s.err('') && <p className="text-sm text-danger sm:col-span-6">{s.err('')}</p>}
    </div>
  );
}

/**
 * Decimal input that keeps the typed text ("-97.", "30.0") and only reports a
 * number once the text is a complete one. Converting on every keystroke would
 * drop a trailing dot or a leading minus while the person is still typing.
 */
function CoordinateInput({ id, value, onChange, invalid }: { id: string; value: number | undefined; onChange: (n: number | undefined) => void; invalid: boolean }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  // Follow outside changes (map search), but not our own partial typing.
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== '' ? current : value == null ? '' : String(value)));
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      aria-invalid={invalid}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        setText(raw);
        if (raw.trim() === '') onChange(undefined);
        else if (/^-?\d+(\.\d+)?$/.test(raw.trim())) onChange(Number(raw));
      }}
    />
  );
}

// --- branding ---------------------------------------------------------------------------

export function ColorPicker({ id, value, onChange }: { id: string; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const warnings = useMemo(() => (/^#[0-9a-f]{6}$/i.test(value) ? buildPalette(value).warnings : []), [value]);
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Preset colours" className="flex flex-wrap gap-2">
        {THEME_PRESETS.map((p) => {
          const active = p.hex.toUpperCase() === value.toUpperCase();
          return (
            <button
              key={p.hex}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={p.name}
              title={p.name}
              onClick={() => onChange(p.hex)}
              className={cx('size-9 rounded-full border-2 transition-transform hover:scale-105', active ? 'border-ink' : 'border-transparent')}
              style={{ background: p.hex, boxShadow: active ? 'inset 0 0 0 2px var(--surface)' : undefined }}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-native`} className="sr-only">Custom colour</label>
        <input
          id={`${id}-native`}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 cursor-pointer rounded-ui-sm border border-line-strong bg-surface p-1"
        />
        <label htmlFor={id} className="sr-only">Hex colour</label>
        <Input
          id={id}
          value={text}
          maxLength={7}
          className="w-32 font-mono uppercase"
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toUpperCase());
          }}
        />
      </div>
      {warnings.map((w) => (
        <Notice key={w} kind="warn">{w}</Notice>
      ))}
    </div>
  );
}

/** Mini app chrome rendered with the chosen colour, in light and dark. */
export function BrandPreview({ name, brandColor, radius, logoUrl }: { name: string; brandColor: string; radius: keyof typeof RADIUS_OPTIONS; logoUrl?: string | null }) {
  const palette = useMemo(() => buildPalette(/^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : '#2450C8'), [brandColor]);
  const r = RADIUS_OPTIONS[radius]?.px ?? 10;
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Preview">
      {(['light', 'dark'] as const).map((mode) => {
        const t = palette[mode];
        const style = {
          '--brand': t.brand, '--brand-fg': t.brandFg, '--brand-strong': t.brandStrong,
          '--brand-soft': t.brandSoft, '--brand-text': t.brandText, '--radius': `${r}px`,
        } as React.CSSProperties;
        return (
          <div key={mode} data-theme={mode} style={style} className="overflow-hidden rounded-ui border border-line bg-bg text-ink">
            <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className={cx('h-6 max-w-24 object-contain', mode === 'dark' && 'rounded-ui-sm bg-white px-1.5 py-0.5')} />
              ) : (
                <span className="grid size-6 place-items-center rounded-ui-sm bg-brand text-xs font-bold text-brand-fg">{(name || 'R').slice(0, 1).toUpperCase()}</span>
              )}
              <span className="truncate text-sm font-semibold">{name || 'Your business'}</span>
              <span className="ml-auto text-[11px] uppercase tracking-wider text-muted">{mode}</span>
            </div>
            <div className="flex gap-3 p-3">
              <div className="hidden w-20 shrink-0 flex-col gap-1 text-xs min-[420px]:flex">
                <span className="rounded-ui-sm bg-brand-soft px-2 py-1 font-medium text-brand-text">Orders</span>
                <span className="px-2 py-1 text-muted">Calendar</span>
                <span className="px-2 py-1 text-muted">Customers</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-ui-sm border border-line bg-surface p-3">
                <span className="text-sm font-semibold">Q-01042 · Bounce House</span>
                <span className="text-xs text-muted">Sat, 2:00 PM · Deposit 30% paid</span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-ui-sm bg-brand px-3 py-1.5 text-xs font-medium text-brand-fg">Send quote</span>
                  <span className="text-xs font-medium text-brand-text underline">View invoice</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LogoInput({
  id, label, hint, previewUrl, onFile, onRemove, dark,
}: {
  id: string; label: string; hint?: string; previewUrl?: string | null; onFile: (f: File | null) => void; onRemove?: () => void; dark?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const accept = (f: File | null) => {
    if (f && !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(f.type)) {
      setError('Use a PNG, JPG, WebP or SVG image.');
      return;
    }
    if (f && f.size > 1024 * 1024) {
      setError('The logo must be 1 MB or smaller.');
      return;
    }
    setError(null);
    onFile(f);
  };
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error ?? undefined} optional>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files?.[0] ?? null); }}
          aria-label={previewUrl ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          className={cx(
            'grid h-20 w-40 place-items-center overflow-hidden rounded-ui border-2 border-dashed p-2 transition-all',
            over ? 'scale-[1.03] border-brand bg-brand-soft' : 'border-line-strong hover:border-brand',
            dark ? 'bg-[#141821]' : 'bg-white',
          )}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs text-muted">
              <ImageUp aria-hidden className="size-6" />
              Drop or click
            </span>
          )}
        </button>
        <input
          ref={ref}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={(e) => {
            accept(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => ref.current?.click()}>
            {previewUrl ? 'Replace' : 'Upload'}
          </Button>
          {previewUrl && onRemove && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { if (ref.current) ref.current.value = ''; onRemove(); }}>
              <Trash2 aria-hidden className="size-4" /> Remove
            </Button>
          )}
        </div>
      </div>
    </Field>
  );
}

export function BrandingFields({ s, name, logoUrl }: { s: Scope; name: string; logoUrl?: string | null }) {
  return (
    <div className="grid gap-6">
      <Field label="Brand colour" htmlFor={fid(s, 'brandColor')} hint="Used for buttons, links and highlights across the app, emails and invoices.">
        <ColorPicker id={fid(s, 'brandColor')} value={s.v.brandColor} onChange={(hex) => s.set('brandColor', hex)} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Default appearance</span>
          <Segmented id={fid(s, 'themeMode')} label="Default appearance" value={s.v.themeMode} onChange={(v) => s.set('themeMode', v)}
            options={[{ value: 'system', label: 'Auto', icon: Monitor }, { value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }]} />
          <span className="text-sm text-muted">Each person can still switch for themselves.</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Corner style</span>
          <Segmented id={fid(s, 'radius')} label="Corner style" value={s.v.radius} onChange={(v) => s.set('radius', v)}
            options={Object.entries(RADIUS_OPTIONS).map(([k, o]) => ({ value: k, label: o.label }))} />
        </div>
      </div>
      <BrandPreview name={name} brandColor={s.v.brandColor} radius={s.v.radius} logoUrl={logoUrl} />
    </div>
  );
}

// --- region (detected automatically) -------------------------------------------------------

export function TimezoneSelect({ id, value, onChange, error }: { id: string; value: string; onChange: (tz: string) => void; error?: string }) {
  // UTC offsets depend on each runtime's own time zone database, which can differ
  // between server and browser. Render plain names first, add offsets after mount.
  const [withOffsets, setWithOffsets] = useState(false);
  useEffect(() => setWithOffsets(true), []);
  const options = useMemo(
    () => (withOffsets ? timezoneOptions() : listTimezones().map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') }))),
    [withOffsets],
  );
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className="min-w-0 flex-1">
      {!options.some((o) => o.value === value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
}

/**
 * Time zone and currency, worked out from the address and map pin. Shown as a
 * summary; "Change" reveals overrides for the rare case detection is wrong.
 */
export function DetectedRegion({ s, country, point }: { s: Scope; country: string; point?: { lat?: number; lng?: number } | null }) {
  const [editing, setEditing] = useState(false);
  const currencies = useMemo(() => currencyOptions(), []);
  const detected = useMemo(() => detectRegion(country, point), [country, point]);
  const differs = detected.timezone !== s.v.timezone || detected.currency !== s.v.currency || detected.country !== s.v.country;
  const useDetected = () => {
    s.set('country', detected.country);
    s.set('timezone', detected.timezone);
    s.set('currency', detected.currency);
    s.set('locale', detected.locale);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { icon: Globe2, label: 'Country', value: countryName(s.v.country) },
          { icon: Clock4, label: 'Time zone', value: String(s.v.timezone).replace(/_/g, ' ') },
          { icon: Coins, label: 'Currency', value: s.v.currency },
        ].map((x) => (
          <div key={x.label} className="flex min-w-0 items-center gap-3 rounded-ui-sm border border-line bg-surface-2/60 px-3.5 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text"><x.icon aria-hidden className="size-4" /></span>
            <span className="min-w-0">
              <span className="block text-xs font-medium uppercase tracking-wide text-muted">{x.label}</span>
              <span className="block truncate font-medium">{x.value}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted">
          <Sparkles aria-hidden className="size-4 text-brand-text" />
          {detected.timezoneSource === 'map' ? 'Detected from your primary location on the map.' : 'Detected from your country. Pin a location on the map for an exact time zone.'}
        </span>
        {differs && (
          <button type="button" className="font-medium text-brand-text underline" onClick={useDetected}>
            Use detected: {detected.timezone.replace(/_/g, ' ')}, {detected.currency}
          </button>
        )}
        <button type="button" className="font-medium text-brand-text underline" onClick={() => setEditing(!editing)} aria-expanded={editing}>
          {editing ? 'Done' : 'Change'}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="grid gap-4 pt-1 sm:grid-cols-2">
              <Field label="Time zone" htmlFor={fid(s, 'timezone')} error={s.err('timezone')} hint="Event times, reminders and reports use this zone.">
                <TimezoneSelect id={fid(s, 'timezone')} value={s.v.timezone} onChange={(tz) => s.set('timezone', tz)} />
              </Field>
              <Field label="Currency" htmlFor={fid(s, 'currency')}>
                <Select id={fid(s, 'currency')} value={s.v.currency} onChange={(e) => s.set('currency', e.target.value)}>
                  {currencies.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- locations -------------------------------------------------------------------------------

/** A location = a place equipment ships from. Its pin sets the time zone. */
export function LocationFields({ s, country, onCodeEdited }: { s: Scope; country: string; onCodeEdited?: () => void }) {
  const [tzOpen, setTzOpen] = useState(false);
  const a = s.v.address ?? {};
  const pinTz = timezoneAt(a.lat, a.lng);
  const tz = s.v.timezone || pinTz;
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-6">
        <TextField s={s} name="name" label="Location name" className="sm:col-span-4" hint="For example: North Austin yard." />
        <Field label="Short code" htmlFor={fid(s, 'code')} error={s.err('code')} hint="Shown on documents." className="sm:col-span-2">
          <Input id={fid(s, 'code')} value={s.v.code ?? ''} maxLength={8} className="font-mono uppercase"
            onChange={(e) => { onCodeEdited?.(); s.set('code', e.target.value.toUpperCase()); }} aria-invalid={!!s.err('code')} />
        </Field>
      </div>
      <AddressFields s={scopeChild(s, 'address')} requireStreet showCoordinates />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-ui-sm bg-surface-2/70 px-3.5 py-3 text-sm">
        <Clock4 aria-hidden className="size-4 shrink-0 text-brand-text" />
        <span className="min-w-0 flex-1">
          Time zone: <strong className="font-medium">{tz ? tz.replace(/_/g, ' ') : 'set when you pin the location'}</strong>
          {!s.v.timezone && pinTz && <span className="text-muted"> · from the map pin</span>}
        </span>
        <button type="button" className="font-medium text-brand-text underline" onClick={() => setTzOpen(!tzOpen)} aria-expanded={tzOpen}>
          {tzOpen ? 'Done' : 'Change'}
        </button>
        {tzOpen && (
          <div className="flex w-full items-center gap-2">
            <label htmlFor={fid(s, 'timezone')} className="sr-only">Time zone</label>
            <TimezoneSelect id={fid(s, 'timezone')} value={tz || 'UTC'} onChange={(v) => s.set('timezone', v)} />
            {s.v.timezone && (
              <Button type="button" variant="ghost" size="sm" onClick={() => s.set('timezone', '')}>Use the pin</Button>
            )}
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PhoneField s={s} name="phone" label="Location phone" country={country} />
        <TextField s={s} name="email" label="Location email" type="email" inputMode="email" optional />
      </div>
      <Field label="Loading notes for crew" htmlFor={fid(s, 'loadingNotes')} optional hint="Gate code, loading dock, parking. Crew will see this.">
        <Textarea id={fid(s, 'loadingNotes')} value={s.v.loadingNotes ?? ''} onChange={(e) => s.set('loadingNotes', e.target.value)} />
      </Field>
    </div>
  );
}

export function scopeChild(s: Scope, key: string): Scope {
  return {
    id: `${s.id}-${key}`,
    v: s.v[key] ?? {},
    set: (path, value) => s.set(`${key}.${path}`, value),
    err: (path) => s.err(path ? `${key}.${path}` : key),
  };
}

// --- booking rules: sliders with live examples ------------------------------------------------

function useMoney(currency: string) {
  return useMemo(() => {
    const f = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 });
    return (n: number) => f.format(n);
  }, [currency]);
}

function SliderField({
  s, name, label, min, max, step, format, hint,
}: {
  s: Scope; name: keyof BookingDefaults; label: string; min: number; max: number; step: number; format: (v: number) => string; hint?: string;
}) {
  const id = fid(s, name);
  const value = Number(s.v[name] ?? 0);
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <motion.span key={value} initial={{ scale: 1.15, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }}
          className="rounded-full bg-brand-soft px-2.5 py-0.5 text-sm font-semibold text-brand-text tabular">
          {format(value)}
        </motion.span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => s.set(name, Number(e.target.value))}
        className="range-brand"
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
      />
      {s.err(name) ? <p className="text-sm text-danger">{s.err(name)}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

function Example({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-ui-sm border border-dashed border-brand/30 bg-brand-soft/50 px-3.5 py-3 text-sm">
      <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-text" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function fmtTime(minutesFromMidnight: number) {
  const m = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

export function BookingFields({ s, currency, distanceUnit }: { s: Scope; currency: string; distanceUnit: 'mi' | 'km' }) {
  const money = useMoney(currency);
  const v = s.v as BookingDefaults;
  const deposit = (1000 * Number(v.depositPercent || 0)) / 100;
  const buffer = Number(v.cleanupBufferMinutes || 0);
  // Example event: 2:00 PM - 6:00 PM
  const start = 14 * 60;
  const end = 18 * 60;
  const span = end - start + Math.max(buffer, 60);
  const sample = 25;
  const billable = Math.max(0, sample - Number(v.freeTravelDistance || 0));

  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Wallet aria-hidden className="size-4 text-brand-text" /> Payments</h3>
        <SliderField s={s} name="depositPercent" label="Deposit to book" min={0} max={100} step={5} format={(n) => `${n}%`} />
        <Example>
          On a <strong>{money(1000)}</strong> booking, the customer pays <strong className="text-brand-text">{money(deposit)}</strong> to book
          and <strong>{money(1000 - deposit)}</strong>{' '}
          {v.balanceDue === 'days_before' ? `${v.balanceDueDaysBefore} days before the event` : 'on the event day'}.
        </Example>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Balance due" htmlFor={fid(s, 'balanceDue')}>
            <Select id={fid(s, 'balanceDue')} value={v.balanceDue} onChange={(e) => s.set('balanceDue', e.target.value)}>
              <option value="event_day">On the event day</option>
              <option value="days_before">Days before the event</option>
            </Select>
          </Field>
          {v.balanceDue === 'days_before' ? (
            <SliderField s={s} name="balanceDueDaysBefore" label="Days before the event" min={0} max={30} step={1} format={(n) => `${n} days`} />
          ) : (
            <SliderField s={s} name="quoteValidDays" label="Quotes valid for" min={1} max={60} step={1} format={(n) => `${n} days`} />
          )}
        </div>
        <SliderField s={s} name="defaultTaxPercent" label="Sales tax" min={0} max={20} step={0.25} format={(n) => `${n}%`}
          hint="Default for new locations; each location can have its own rate." />
        <Toggle id={fid(s, 'autoChargeBalance')} checked={!!v.autoChargeBalance} onChange={(x) => s.set('autoChargeBalance', x)}
          label="Charge the balance automatically" description="Uses the card saved at booking when the balance falls due." />
      </section>

      <section className="grid gap-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><CalendarClock aria-hidden className="size-4 text-brand-text" /> Scheduling</h3>
        <SliderField s={s} name="cleanupBufferMinutes" label="Turnaround after each rental" min={0} max={480} step={15}
          format={(n) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`)}
          hint="Equipment stays blocked this long after it comes back, for cleaning and travel." />
        <div className="rounded-ui-sm border border-line p-3.5" aria-hidden>
          <div className="flex h-9 overflow-hidden rounded-ui-sm text-xs font-medium">
            <motion.div layout className="brand-gradient grid place-items-center text-brand-fg" style={{ width: `${((end - start) / span) * 100}%` }}>
              Event 2-6 PM
            </motion.div>
            <motion.div layout className="grid place-items-center bg-warn-soft text-warn" style={{ width: `${(buffer / span) * 100}%` }}>
              {buffer >= 60 ? 'Cleanup' : ''}
            </motion.div>
            <div className="flex-1 bg-ok-soft" />
          </div>
          <p className="mt-2 text-sm text-muted">Next booking of the same item can start at <strong className="text-ink">{fmtTime(end + buffer)}</strong>.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SliderField s={s} name="lastMinuteHours" label="Flag last-minute bookings" min={0} max={168} step={6} format={(n) => `< ${n} h`} />
          <SliderField s={s} name="maxAdvanceMonths" label="Book up to" min={1} max={36} step={1} format={(n) => `${n} months ahead`} />
        </div>
        <Toggle id={fid(s, 'quotesHoldInventory')} checked={!!v.quotesHoldInventory} onChange={(x) => s.set('quotesHoldInventory', x)}
          label="Quotes hold inventory" description="Off: equipment is only blocked once the deposit is paid." />
      </section>

      <section className="grid gap-4">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold"><Truck aria-hidden className="size-4 text-brand-text" /> Fees</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <SliderField s={s} name="damageWaiverPercent" label="Damage waiver" min={0} max={25} step={0.5} format={(n) => `${n}% of rental`} />
          <SliderField s={s} name="freeTravelDistance" label="Free delivery distance" min={0} max={50} step={1} format={(n) => `${n} ${distanceUnit}`} />
          <SliderField s={s} name="travelRateStaffed" label="Travel fee, staffed" min={0} max={10} step={0.25} format={(n) => `${money(n)} / ${distanceUnit}`} />
          <SliderField s={s} name="travelRateDropoff" label="Travel fee, drop-off" min={0} max={10} step={0.25} format={(n) => `${money(n)} / ${distanceUnit}`} />
        </div>
        <Example>
          A staffed party <strong>{sample} {distanceUnit}</strong> from your location: {billable} {distanceUnit} billable ×{' '}
          {money(Number(v.travelRateStaffed || 0))} = <strong className="text-brand-text">{money(billable * Number(v.travelRateStaffed || 0))}</strong> travel fee.
          A {money(400)} rental adds a <strong>{money((400 * Number(v.damageWaiverPercent || 0)) / 100)}</strong> damage waiver.
        </Example>
        <Toggle id={fid(s, 'damageWaiverDefaultOn')} checked={!!v.damageWaiverDefaultOn} onChange={(x) => s.set('damageWaiverDefaultOn', x)}
          label="Add the damage waiver by default" description="Customers can still decline it on the quote." />
      </section>
    </div>
  );
}
