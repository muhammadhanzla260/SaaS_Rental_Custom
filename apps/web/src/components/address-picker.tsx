'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { LoaderCircle, MapPin, Search, X } from 'lucide-react';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MAPBOX_GEOCODE, MAPBOX_SEARCH, mapboxToAddress, type MapboxProperties, type MapboxSuggestion } from '@rental/core';
import { useMapboxToken } from './mapbox-token';
import { cx, Input, Notice } from './ui';

type Filled = ReturnType<typeof mapboxToAddress>;

/**
 * Address search (Mapbox Search Box API) plus an interactive map with a
 * draggable pin. Picking a suggestion fills the address fields and the pin;
 * moving the pin updates the coordinates and the address (reverse geocoding).
 */
export function AddressSearch({
  country, near, onPick,
}: {
  country?: string;
  near?: { lat: number; lng: number } | null;
  onPick: (address: Filled) => void;
}) {
  const token = useMapboxToken();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MapboxSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const session = useRef<string>('');
  const skipNext = useRef(false);

  useEffect(() => {
    session.current = crypto.randomUUID();
  }, []);

  useEffect(() => {
    if (!token) return;
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = query.trim();
    if (q.length < 3) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          q, access_token: token, session_token: session.current, limit: '6', language: 'en',
          types: 'address,poi,street,place,postcode',
        });
        if (country) params.set('country', country.toLowerCase());
        params.set('proximity', near ? `${near.lng},${near.lat}` : 'ip');
        const res = await fetch(`${MAPBOX_SEARCH}/suggest?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(res.status === 401 ? 'The Mapbox token was rejected.' : 'Address search is unavailable right now.');
        const json = (await res.json()) as { suggestions?: MapboxSuggestion[] };
        setItems(json.suggestions ?? []);
        setActive(-1);
        setOpen(true);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, token, country, near]);

  const pick = async (s: MapboxSuggestion) => {
    if (!token) return;
    setOpen(false);
    setLoading(true);
    try {
      const params = new URLSearchParams({ access_token: token, session_token: session.current });
      const res = await fetch(`${MAPBOX_SEARCH}/retrieve/${encodeURIComponent(s.mapbox_id)}?${params}`);
      if (!res.ok) throw new Error('Could not load that address. Try again.');
      const f = ((await res.json()) as { features?: { geometry: { coordinates: [number, number] }; properties: MapboxProperties }[] }).features?.[0];
      if (!f) throw new Error('Could not load that address. Try again.');
      const filled = mapboxToAddress(f.properties, f.geometry.coordinates);
      onPick(filled);
      skipNext.current = true;
      setQuery(filled.label);
      session.current = crypto.randomUUID(); // a pick ends the billing session
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Notice kind="warn">
        Address search and the map need a Mapbox token. Add <code className="font-mono">NEXT_PUBLIC_MAPBOX_TOKEN</code> (a public
        token starting with pk.) to <code className="font-mono">.env</code> and restart the app. Until then, type the address and
        coordinates by hand.
      </Notice>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">Search for an address</label>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${listId}-list`}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
        autoComplete="off"
        placeholder="Search for the address or place name"
        value={query}
        className="pl-9 pr-9"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); void pick(items[active]!); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2">
        {loading ? (
          <LoaderCircle aria-hidden className="size-4 animate-spin text-muted" />
        ) : query ? (
          <button type="button" aria-label="Clear search" className="grid size-7 place-items-center rounded-ui-sm text-muted hover:bg-surface-2"
            onClick={() => { setQuery(''); setItems([]); }}>
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </span>
      {open && items.length > 0 && (
        <ul id={`${listId}-list`} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-auto rounded-ui border border-line bg-surface p-1 shadow-lg">
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
                <span className="block truncate text-sm text-muted">{s.full_address ?? s.place_formatted}</span>
              </span>
            </li>
          ))}
          <li aria-hidden className="px-3 pb-1 pt-1.5 text-right text-[11px] text-muted">Search by Mapbox</li>
        </ul>
      )}
      {open && !loading && query.trim().length >= 3 && items.length === 0 && !error && (
        <p className="mt-1.5 text-sm text-muted">No matches. Try the street and city, or place the pin on the map.</p>
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

  // Create the map once.
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
          center: hasPin ? [lng!, lat!] : [-30, 25],
          zoom: hasPin ? 15 : 1.2,
          attributionControl: true,
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
        if (!cancelled) setFailed('The map could not load. You can still type the address and coordinates.');
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

  // Follow coordinates set elsewhere (search pick, typed numbers).
  useEffect(() => {
    const m = map.current;
    const mk = marker.current;
    if (!m || !mk || !hasPin) return;
    const cur = pinned.current ? mk.getLngLat() : null;
    // Pin already there (it was dragged): don't fly the map around.
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
        className="h-64 w-full overflow-hidden rounded-ui-sm border border-line bg-surface-2 sm:h-72"
      />
      {failed ? (
        <p className="text-sm text-danger">{failed}</p>
      ) : (
        <p className="text-sm text-muted">{hasPin ? 'Drag the pin, or click the map, to fine-tune the exact spot.' : 'Search above, or click the map to drop a pin.'}</p>
      )}
    </div>
  );
}
