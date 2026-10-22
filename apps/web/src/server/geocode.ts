import 'server-only';
import { addressQuery, MAPBOX_GEOCODE, mapboxToAddress, type Address } from '@rental/core';

export type GeocodeHit = ReturnType<typeof mapboxToAddress>;

/**
 * Server-side forward geocoding through Mapbox (for imports and background
 * jobs; people use the in-browser search). Prefers a secret token if set.
 */
export async function geocode(address: Partial<Address>): Promise<GeocodeHit | null> {
  const token = process.env.MAPBOX_SECRET_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const q = addressQuery(address);
  if (!token || q.length < 5) return null;
  const url = new URL(`${MAPBOX_GEOCODE}/forward`);
  url.search = new URLSearchParams({ q, limit: '1', access_token: token, ...(address.country ? { country: address.country.toLowerCase() } : {}) }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const f = (await res.json()).features?.[0];
    return f ? mapboxToAddress(f.properties, f.geometry.coordinates) : null;
  } catch {
    return null;
  }
}
