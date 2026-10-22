/**
 * Mapbox Search Box / Geocoding v6 responses -> our Address shape.
 * Pure functions (no fetch) so they are unit-tested and shared by browser and server.
 */
import type { Address } from './settings';

type Named = { name?: string };
export type MapboxContext = {
  country?: Named & { country_code?: string };
  region?: Named & { region_code?: string };
  postcode?: Named;
  district?: Named;
  place?: Named;
  locality?: Named;
  neighborhood?: Named;
  street?: Named;
  address?: Named & { address_number?: string; street_name?: string };
};

export type MapboxProperties = {
  name?: string;
  name_preferred?: string;
  feature_type?: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
  context?: MapboxContext;
  coordinates?: { latitude?: number; longitude?: number };
};

export type MapboxSuggestion = {
  mapbox_id: string;
  name: string;
  feature_type?: string;
  address?: string;
  full_address?: string;
  place_formatted?: string;
};

/** Address fields from a Mapbox feature. Only fields Mapbox knows are returned. */
export function mapboxToAddress(props: MapboxProperties, lngLat?: [number, number]): Partial<Address> & { label: string } {
  const c = props.context ?? {};
  const type = props.feature_type;
  const street =
    c.address?.name ??
    (type === 'address' ? props.name : undefined) ??
    props.address ??
    (c.street?.name && type !== 'place' && type !== 'postcode' ? c.street.name : undefined);
  const out: Partial<Address> & { label: string } = {
    label: props.full_address ?? [props.name, props.place_formatted].filter(Boolean).join(', '),
  };
  // A business or landmark: keep its name in line 2 so the street stays in line 1.
  if (type === 'poi' && props.name && street && props.name !== street) out.line2 = props.name;
  if (street) out.line1 = street;
  const city = c.place?.name ?? c.locality?.name ?? c.district?.name;
  if (city) out.city = city;
  const region = c.region?.region_code ?? c.region?.name;
  if (region) out.region = region;
  if (c.postcode?.name) out.postalCode = c.postcode.name;
  if (c.country?.country_code) out.country = c.country.country_code.toUpperCase();
  const lat = lngLat?.[1] ?? props.coordinates?.latitude;
  const lng = lngLat?.[0] ?? props.coordinates?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number') {
    out.lat = Number(lat.toFixed(6));
    out.lng = Number(lng.toFixed(6));
  }
  return out;
}

/** One-line query for forward geocoding from typed address fields. */
export function addressQuery(a: Partial<Address>): string {
  return [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(', ');
}

export const MAPBOX_SEARCH = 'https://api.mapbox.com/search/searchbox/v1';
export const MAPBOX_GEOCODE = 'https://api.mapbox.com/search/geocode/v6';
