'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { LoaderCircle, MapPin } from 'lucide-react';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MAPBOX_GEOCODE, MAPBOX_SEARCH, mapboxToAddress, type MapboxProperties, type MapboxSuggestion } from '@rental/core';
import { useMapboxToken } from './mapbox-token';
import { cx, Input } from './ui';

type Filled = ReturnType<typeof mapboxToAddress>;

/**
 * Search settings follow the FreedomFun Odoo integration (partner_address_mapbox.js,
 * pos_view.js mapboxSuggest): suggestions on the street field after 3 characters,
 * 300 ms debounce, 5 results, address/street/place types, country filter,
 * proximity bias, and an optional hard service-area box.
 */
const SUGGEST = { minChars: 3, debounceMs: 300, limit: '5', types: 'address,street,place' } as const;

export type SearchArea = {
  country?: string;
  /** "lng,lat" ranking bias. Odoo: the customer's coordinates, else the service-area center. */
  proximity?: string | null;
  /** "minLng,minLat,maxLng,maxLat" hard filter. Odoo: the served-zip box. */
  bbox?: string | null;
};

const newSession = () => crypto.randomUUID();

/** Odoo mapboxGeocode: forward-geocode a typed address to coordinates. */
export async function geocodeAddress(token: string, query: string, area: SearchArea): Promise<Filled | null> {
  if (query.trim().length < 5) return null;
  const params = new URLSearchParams({ q: query, access_token: token, limit: '1', types: 'address,place' });
  if (area.country) params.set('country', area.country.toLowerCase());
  if (area.proximity) params.set('proximity', area.proximity);
  try {
    const res = await fetch(`${MAPBOX_SEARCH}/forward?${params}`);
    if (!res.ok) return null;
    const f = ((await res.json()) as { features?: { geometry?: { coordinates: [number, number] }; properties: MapboxProperties }[] }).features?.[0];
    return f ? mapboxToAddress(f.properties, f.geometry?.coordinates) : null;
  } catch {
    return null;
  }
}

/**
 * The street input with Mapbox suggestions underneath (Odoo patched the street
 * CharField the same way). Typing works as a normal text field too.
 */
export function StreetAutocomplete({
  id, value, onType, onPick, area, invalid, describedBy, placeholder,
}: {
  id: string; value: string; onType: (v: string) => void; onPick: (a: Filled) => void; area: SearchArea;
  invalid?: boolean; describedBy?: string; placeholder?: string;
}) {
  const token = useMapboxToken();
  const listId = useId();
  const [items, setItems] = useState<MapboxSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = useRef('');
  const typed = useRef(false); // only search what the person types
  const areaKey = `${area.country ?? ''}|${area.proximity ?? ''}|${area.bbox ?? ''}`;

  useEffect(() => { session.current = newSession(); }, []);

  useEffect(() => {
    if (!token || !typed.current) return;
    const q = value.trim();
    if (q.length < SUGGEST.minChars) {
      setItems([]);
      setOpen(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q, access_token: token, session_token: session.current, limit: SUGGEST.limit, types: SUGGEST.types, language: 'en',
        });
        if (area.country) params.set('country', area.country.toLowerCase());
        params.set('proximity', area.proximity || 'ip');
        if (area.bbox) params.set('bbox', area.bbox);
        const res = await fetch(`${MAPBOX_SEARCH}/suggest?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(res.status === 401 ? 'The Mapbox token was rejected.' : 'Address search is unavailable right now.');
        const list = ((await res.json()) as { suggestions?: MapboxSuggestion[] }).suggestions ?? [];
        setItems(list);
        setActive(-1);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, SUGGEST.debounceMs);
    return () => { clearTimeout(t); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, token, areaKey]);

  const pick = async (s: MapboxSuggestion) => {
    if (!token) return;
    setOpen(false);
    setItems([]);
    typed.current = false;
    setLoading(true);
    try {
      const params = new URLSearchParams({ access_token: token, session_token: session.current });
      const res = await fetch(`${MAPBOX_SEARCH}/retrieve/${encodeURIComponent(s.mapbox_id)}?${params}`);
      if (!res.ok) throw new Error('Could not load that address. Try again.');
      const f = ((await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: MapboxProperties }[] }).features?.[0];
      if (!f) throw new Error('Could not load that address. Try again.');
      const filled = mapboxToAddress(f.properties, f.geometry.coordinates);
      // Odoo: street = feature street, else the suggestion's address or name.
      if (!filled.line1) filled.line1 = s.address || s.name;
      onPick(filled);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      session.current = newSession(); // a pick ends the Mapbox billing session
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role={token ? 'combobox' : undefined}
        aria-expanded={token ? open && items.length > 0 : undefined}
        aria-controls={token ? `${listId}-list` : undefined}
        aria-autocomplete={token ? 'list' : undefined}
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete={token ? 'off' : 'address-line1'}
        placeholder={placeholder ?? (token ? 'Start typing the address…' : undefined)}
        value={value}
        className={token ? 'pr-9' : undefined}
        onChange={(e) => { typed.current = true; onType(e.target.value); }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void pick(items[active]!); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {token && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
          {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <MapPin aria-hidden className="size-4" />}
        </span>
      )}
      {open && items.length > 0 && (
        <ul id={`${listId}-list`} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-ui border border-line bg-surface p-1 shadow-pop">
          {items.map((s, i) => (
            <li
              key={s.mapbox_id}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void pick(s)}
              className={cx('flex cursor-pointer items-start gap-2.5 rounded-ui-sm px-3 py-2.5', i === active ? 'bg-brand-soft' : 'hover:bg-surface-2')}
            >
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium">{s.name}</span>
                <span className="block truncate text-sm text-muted">{s.place_formatted || s.full_address}</span>
              </span>
            </li>
          ))}
          <li aria-hidden className="px-3 pb-1 pt-1.5 text-right text-[11px] text-muted">Search by Mapbox</li>
        </ul>
      )}
      {open && !loading && typed.current && value.trim().length >= SUGGEST.minChars && items.length === 0 && !error && (
        <p className="mt-1.5 text-sm text-muted">{area.bbox ? 'No matches inside your service area.' : 'No matches.'} Keep typing, or place the pin on the map.</p>
      )}
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Interactive Mapbox GL map with a draggable pin. Loads mapbox-gl only in the browser. */
export function PinMap({
  lat, lng, onMove, label,
}: {
  lat?: number; lng?: number; onMove: (address: Filled | { lat: number; lng: number; label: string }) => void; label: string;
}) {
  const token = useMapboxToken();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const pinned = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const hasPin = typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng);

  const reverse = useCallback(
    async (p: { lat: number; lng: number }) => {
      const base = { lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6)), label: '' };
      if (!token) return onMoveRef.current(base);
      try {
        const params = new URLSearchParams({ longitude: String(p.lng), latitude: String(p.lat), access_token: token, types: 'address', limit: '1' });
        const res = await fetch(`${MAPBOX_GEOCODE}/reverse?${params}`);
        const f = res.ok ? ((await res.json()) as { features?: { properties: MapboxProperties }[] }).features?.[0] : undefined;
        onMoveRef.current(f ? { ...mapboxToAddress(f.properties), ...base, label: f.properties.full_address ?? '' } : base);
      } catch {
        onMoveRef.current(base);
      }
    },
    [token],
  );

  useEffect(() => {
    if (!token || !box.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !box.current) return;
        mapboxgl.accessToken = token;
        const dark = document.documentElement.dataset.theme === 'dark';
        const brand = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#2450C8';
        const m = new mapboxgl.Map({
          container: box.current,
          style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/streets-v12',
          center: hasPin ? [lng!, lat!] : [-98.5, 39.5],
          zoom: hasPin ? 15 : 3,
          cooperativeGestures: true,
        });
        m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        const mk = new mapboxgl.Marker({ color: brand, draggable: true });
        if (hasPin) {
          mk.setLngLat([lng!, lat!]).addTo(m);
          pinned.current = true;
        }
        mk.on('dragend', () => {
          const p = mk.getLngLat();
          void reverse({ lat: p.lat, lng: p.lng });
        });
        m.on('click', (e) => {
          mk.setLngLat(e.lngLat).addTo(m);
          pinned.current = true;
          void reverse({ lat: e.lngLat.lat, lng: e.lngLat.lng });
        });
        m.on('error', (e) => {
          const msg = String((e as { error?: Error }).error?.message ?? '');
          if (/401|403|token/i.test(msg)) setFailed('The map could not load: the Mapbox token was rejected.');
        });
        map.current = m;
        marker.current = mk;
      } catch {
        if (!cancelled) setFailed('The map could not load. You can still type the address.');
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Follow coordinates set elsewhere (a pick, automatic pinning, typed numbers).
  useEffect(() => {
    const m = map.current;
    const mk = marker.current;
    if (!m || !mk || !hasPin) return;
    const cur = pinned.current ? mk.getLngLat() : null;
    if (cur && Math.abs(cur.lat - lat!) < 1e-5 && Math.abs(cur.lng - lng!) < 1e-5) return;
    mk.setLngLat([lng!, lat!]).addTo(m);
    pinned.current = true;
    m.flyTo({ center: [lng!, lat!], zoom: Math.max(m.getZoom(), 15), essential: true });
  }, [lat, lng, hasPin]);

  if (!token) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={box}
        role="region"
        aria-label={`Map for ${label}. Click the map or drag the pin to set the exact spot.`}
        className="h-60 w-full overflow-hidden rounded-ui-sm border border-line bg-surface-2 sm:h-72"
      />
      {failed ? (
        <p className="text-sm text-danger">{failed}</p>
      ) : (
        <p className="text-sm text-muted">{hasPin ? 'Drag the pin, or click the map, for the exact spot (a gate or loading dock).' : 'Type the street above, or click the map to drop a pin.'}</p>
      )}
    </div>
  );
}
