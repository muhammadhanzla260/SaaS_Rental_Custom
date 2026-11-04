'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import type { Map as MapboxMap, Marker } from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';
import { useMapboxToken } from '@/components/mapbox-token';

export type MapPoint = { id: string; lat: number; lng: number; label: string; sub?: string };
export type Van = MapPoint & { stage: 'pre_departure' | 'en_route' | 'event' | 'completed'; frozen: boolean };

export const STAGE_COLOR: Record<Van['stage'], string> = { pre_departure: '#8A919E', en_route: '#2450C8', event: '#E8A317', completed: '#1F9D5C' };
export const STAGE_LABEL: Record<Van['stage'], string> = { pre_departure: 'Pre-Departure', en_route: 'En route', event: 'Event running', completed: 'Completed' };

function el(html: string, className: string) {
  const d = document.createElement('div');
  d.className = className;
  d.innerHTML = html;
  return d;
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Today on a map: warehouses, event pins and a van per coach coloured by stage, following live GPS. */
export function LiveMap({ warehouses, events, vans, onSelect }: { warehouses: MapPoint[]; events: (MapPoint & { stage: Van['stage'] })[]; vans: Van[]; onSelect: (id: string) => void }) {
  const token = useMapboxToken();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!token || !box.current) return;
    let cancelled = false;
    (async () => {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !box.current) return;
        mapboxgl.accessToken = token;
        const dark = document.documentElement.dataset.theme === 'dark';
        const m = new mapboxgl.Map({ container: box.current, style: dark ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11', center: [-97.74, 30.27], zoom: 9, cooperativeGestures: true });
        m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        m.on('load', () => !cancelled && setReady(true));
        m.on('error', (e) => { if (/401|403|token/i.test(String((e as { error?: Error }).error?.message ?? ''))) setFailed('The map could not load: the Mapbox token was rejected.'); });
        map.current = m;
      } catch {
        if (!cancelled) setFailed('The map could not load.');
      }
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [token]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    let alive = true;
    (async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      if (!alive) return;
      for (const mk of markers.current) mk.remove();
      markers.current = [];
      const add = (p: MapPoint, node: HTMLElement, click?: () => void) => {
        if (click) node.addEventListener('click', click);
        markers.current.push(new mapboxgl.Marker({ element: node, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(m));
      };
      for (const w of warehouses) {
        add(w, el(`<div class="grid size-7 place-items-center rounded-lg bg-night text-[13px] text-volt shadow" title="${esc(w.label)}">⌂</div>`, ''));
      }
      for (const e of events) {
        add(e, el(`<div class="flex flex-col items-center"><span class="mb-1 whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-fg shadow">${esc(e.label)} · ${STAGE_LABEL[e.stage]}</span><span class="size-3 rounded-full ring-2 ring-white" style="background:${STAGE_COLOR[e.stage]}"></span></div>`, 'cursor-pointer'), () => select.current(e.id));
      }
      for (const v of vans) {
        add(v, el(`<div class="flex flex-col items-center"><span class="mb-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white shadow" style="background:${STAGE_COLOR[v.stage]}">${esc(v.label)}${v.frozen ? ' · Last GPS · tracking off after 5-min text' : ''}</span><span class="grid size-7 place-items-center rounded-full text-[14px] text-white shadow-lg ring-2 ring-white" style="background:${STAGE_COLOR[v.stage]}">🚐</span></div>`, 'cursor-pointer'), () => select.current(v.id));
      }
      const pts = [...warehouses, ...events, ...vans];
      if (pts.length && !fitted.current) {
        fitted.current = true;
        const b = new mapboxgl.LngLatBounds();
        for (const p of pts) b.extend([p.lng, p.lat]);
        m.fitBounds(b, { padding: 60, maxZoom: 13, duration: 0 });
      }
    })();
    return () => { alive = false; };
  }, [ready, warehouses, events, vans]);

  if (!token) return <div className="grid h-full place-items-center bg-sunken p-6 text-center text-sm text-fg-2">Add a Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN) to see the live map.</div>;
  return (
    <div className="relative h-full w-full">
      <div ref={box} className="h-full w-full" />
      {failed && <div className="absolute inset-0 grid place-items-center bg-sunken p-6 text-center text-sm text-fg-2">{failed}</div>}
    </div>
  );
}
