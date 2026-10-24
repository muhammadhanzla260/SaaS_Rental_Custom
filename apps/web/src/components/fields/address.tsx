'use client';

import { MapPin, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addressQuery, countryOptions } from '@rental/core';
import { geocodeAddress, PinMap, StreetAutocomplete, type SearchArea } from '@/components/address-picker';
import { useMapboxToken } from '@/components/mapbox-token';
import { cx, Field, Input, Notice, Select } from '@/components/kit';
import { fid, type Scope } from './scope';

/**
 * Address with Mapbox search, auto-pin and a draggable pin (follows the
 * FreedomFun Odoo integration). The pin matters for locations: travel fees
 * are measured from it, and its time zone becomes the location's clock.
 */
export function AddressBlock({
  s, requireStreet, showMap = true, near, bbox, compact,
}: {
  s: Scope;
  requireStreet?: boolean;
  showMap?: boolean;
  near?: { lat: number; lng: number } | null;
  bbox?: string | null;
  /** Hide line 2 / region / country (design's onboarding warehouse: street, city, ZIP). */
  compact?: boolean;
}) {
  const countries = useMemo(() => countryOptions(), []);
  const token = useMapboxToken();
  const a = s.v;
  const hasCoords = typeof a.lat === 'number' && typeof a.lng === 'number';
  const [manual, setManual] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const pinnedFor = useRef<string | null>(hasCoords ? addressQuery(a as never) : null);
  const area: SearchArea = {
    country: a.country,
    proximity: hasCoords ? `${a.lng},${a.lat}` : near ? `${near.lng},${near.lat}` : null,
    bbox,
  };

  const apply = (filled: Partial<Record<string, unknown>>, replace: boolean) => {
    for (const key of ['line1', 'line2', 'city', 'region', 'postalCode', 'country', 'lat', 'lng'] as const) {
      if (filled[key] !== undefined) s.set(key, filled[key]);
      else if (replace && key === 'line2') s.set(key, '');
    }
    pinnedFor.current = addressQuery({ ...a, ...filled } as never);
  };

  const autoPin = async () => {
    if (!token) return;
    const q = addressQuery(a as never);
    if (!a.line1 || !a.city || q === pinnedFor.current) return;
    const hit = await geocodeAddress(token, q, area);
    if (hit?.lat != null && hit.lng != null) {
      s.set('lat', hit.lat);
      s.set('lng', hit.lng);
      pinnedFor.current = q;
      setNote('Pinned automatically from the address. Drag the pin if it is not exact.');
    }
  };

  const text = (name: string, label: string, auto: string, optional: boolean, className: string) => (
    <Field label={label} htmlFor={fid(s, name)} error={s.err(name)} optional={optional} className={className}>
      <Input id={fid(s, name)} value={a[name] ?? ''} autoComplete={auto} invalid={!!s.err(name)} onChange={(e) => s.set(name, e.target.value)} onBlur={() => void autoPin()} />
    </Field>
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
      <Field
        label="Street address"
        htmlFor={fid(s, 'line1')}
        error={s.err('line1')}
        optional={!requireStreet}
        className={compact ? 'sm:col-span-6' : 'sm:col-span-4'}
        hint={token ? 'Start typing — suggestions from Mapbox. Pick one and the rest fills in.' : undefined}
      >
        <div onBlur={() => setTimeout(() => void autoPin(), 250)}>
          <StreetAutocomplete
            id={fid(s, 'line1')}
            value={a.line1 ?? ''}
            area={area}
            invalid={!!s.err('line1')}
            placeholder="Start typing — suggestions from Mapbox"
            onType={(v) => s.set('line1', v)}
            onPick={(f) => { setNote(null); apply(f, true); }}
          />
        </div>
      </Field>
      {!compact && text('line2', 'Suite, unit', 'address-line2', true, 'sm:col-span-2')}
      {text('city', 'City', 'address-level2', !requireStreet, compact ? 'sm:col-span-3' : 'sm:col-span-2')}
      {!compact && text('region', 'State / region', 'address-level1', true, 'sm:col-span-2')}
      {text('postalCode', 'ZIP / postcode', 'postal-code', true, compact ? 'sm:col-span-3' : 'sm:col-span-2')}
      {!compact && (
        <Field label="Country" htmlFor={fid(s, 'country')} className="sm:col-span-3">
          <Select id={fid(s, 'country')} value={a.country ?? 'US'} onChange={(e) => s.set('country', e.target.value)}>
            {countries.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
      )}
      {showMap && token && (
        <div className="overflow-hidden rounded-[var(--radius-card)] sm:col-span-6">
          <PinMap lat={a.lat} lng={a.lng} label={a.line1 || 'this address'} onMove={(f) => { setNote(null); apply(f, false); }} />
        </div>
      )}
      {!token && (
        <Notice kind="warning" className="sm:col-span-6">
          Address suggestions and the map need a Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN). Until then, type the address and coordinates by hand.
        </Notice>
      )}
      <div className="flex flex-col gap-2 sm:col-span-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
          <span className="flex min-w-0 items-center gap-2">
            <MapPin aria-hidden className={cx('size-4 shrink-0', hasCoords ? 'text-success' : 'text-warning')} />
            {hasCoords ? <span className="mono text-fg-2">Pinned at {Number(a.lat).toFixed(5)}, {Number(a.lng).toFixed(5)}</span> : <span className="text-warning">Not pinned yet. Travel fees are measured from this point.</span>}
          </span>
          {token && (
            <button type="button" className="font-semibold text-accent-text hover:underline" onClick={() => setManual(!manual)} aria-expanded={manual}>
              {manual ? 'Hide coordinates' : 'Enter coordinates by hand'}
            </button>
          )}
        </div>
        {note && hasCoords && <p className="flex items-center gap-1.5 text-[13px] text-fg-2"><Sparkles aria-hidden className="size-4 text-accent-text" />{note}</p>}
        {(manual || !token) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Latitude" htmlFor={fid(s, 'lat')} error={s.err('lat')} optional hint="For example 30.267153">
              <CoordinateInput id={fid(s, 'lat')} value={a.lat} onChange={(n) => { s.set('lat', n); pinnedFor.current = addressQuery(a as never); }} invalid={!!s.err('lat')} />
            </Field>
            <Field label="Longitude" htmlFor={fid(s, 'lng')} error={s.err('lng')} optional hint="For example -97.743057">
              <CoordinateInput id={fid(s, 'lng')} value={a.lng} onChange={(n) => { s.set('lng', n); pinnedFor.current = addressQuery(a as never); }} invalid={!!s.err('lng')} />
            </Field>
          </div>
        )}
      </div>
      {s.err('') && <p className="text-xs font-medium text-danger sm:col-span-6" role="alert">{s.err('')}</p>}
    </div>
  );
}

/** Keeps partial typing ("-97.") and reports a number only once complete. */
function CoordinateInput({ id, value, onChange, invalid }: { id: string; value: number | undefined; onChange: (n: number | undefined) => void; invalid: boolean }) {
  const [txt, setTxt] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setTxt((cur) => (Number(cur) === value && cur.trim() !== '' ? cur : value == null ? '' : String(value)));
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      mono
      value={txt}
      invalid={invalid}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.');
        setTxt(raw);
        if (raw.trim() === '') onChange(undefined);
        else if (/^-?\d+(\.\d+)?$/.test(raw.trim())) onChange(Number(raw));
      }}
    />
  );
}
