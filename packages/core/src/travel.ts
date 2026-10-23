/**
 * Delivery distance and travel fee, ported from the FreedomFun Odoo Rental POS
 * (pos_view.js: haversineDistanceMiles, findNearestWarehouse, _applyTravelFee):
 *   1. rank ship-from locations by straight-line distance,
 *   2. ask for real driving distance to the 3 closest (Mapbox Directions),
 *   3. the shortest drive wins (straight line if driving is unavailable),
 *   4. fee = max(0, miles - free miles) x rate (staffed or drop-off), rounded to the cent.
 * Pure functions; the driving lookup is passed in so this stays testable.
 */
import type { ServiceMode } from './pricing';

export const EARTH_RADIUS_MILES = 3958.8;
export const KM_PER_MILE = 1.609344;

export type Point = { lat: number; lng: number };

export function haversineMiles(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export type Origin<T> = T & { lat: number | null; lng: number | null };

/** The `limit` closest origins to `to` by straight line (origins without a pin are skipped). */
export function rankByStraightLine<T>(origins: Origin<T>[], to: Point, limit = 3) {
  return origins
    .filter((o): o is T & Point => typeof o.lat === 'number' && typeof o.lng === 'number')
    .map((origin) => ({ origin, straightMiles: haversineMiles(origin, to) }))
    .sort((a, b) => a.straightMiles - b.straightMiles)
    .slice(0, limit);
}

export type NearestResult<T> = { origin: T & Point; miles: number; isDriving: boolean; straightMiles: number };

/**
 * Nearest origin by driving distance among the 3 straight-line closest.
 * `drivingMiles` returns null when routing fails; the straight line is used then.
 */
export async function findNearestOrigin<T>(
  origins: Origin<T>[],
  to: Point,
  drivingMiles: (from: Point, to: Point) => Promise<number | null>,
): Promise<NearestResult<T> | null> {
  const ranked = rankByStraightLine(origins, to, 3);
  if (!ranked.length) return null;
  const results = await Promise.all(
    ranked.map(async ({ origin, straightMiles }) => {
      const driving = await drivingMiles(origin, to);
      return { origin, straightMiles, miles: driving ?? straightMiles, isDriving: driving != null };
    }),
  );
  results.sort((a, b) => a.miles - b.miles);
  return results[0]!;
}


export type TravelFeeRules = {
  freeDistance: number;
  rateStaffed: number;
  rateDropoff: number;
  unit: 'mi' | 'km';
};

/**
 * Fee for one trip. Pick-up orders pay nothing (the customer collects); a drop-off
 * anywhere in the order uses the drop-off rate (Odoo: any line with dropoff).
 */
export function travelFee(miles: number, modes: ServiceMode[], rules: TravelFeeRules) {
  if (modes.length > 0 && modes.every((m) => m === 'pickup')) {
    return { distance: 0, billable: 0, rate: 0, fee: 0, reason: 'pickup' as const };
  }
  const distance = rules.unit === 'km' ? miles * KM_PER_MILE : miles;
  const rate = modes.includes('dropoff') ? rules.rateDropoff : rules.rateStaffed;
  const billable = Math.max(0, distance - rules.freeDistance);
  const fee = Math.round(billable * rate * 100) / 100;
  return { distance, billable, rate, fee, reason: 'distance' as const };
}

/**
 * The area customer addresses are searched in: a box around every ship-from
 * location, `radius` out (Odoo hard-coded the Austin box; here it follows your locations).
 * Returns Mapbox "minLng,minLat,maxLng,maxLat" and a center for ranking.
 */
export function serviceArea(points: Point[], radius: number, unit: 'mi' | 'km' = 'mi') {
  if (!points.length) return null;
  const miles = unit === 'km' ? radius / KM_PER_MILE : radius;
  const dLat = miles / 69.0;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of points) {
    const dLng = miles / (69.172 * Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)));
    w = Math.min(w, p.lng - dLng);
    e = Math.max(e, p.lng + dLng);
    s = Math.min(s, p.lat - dLat);
    n = Math.max(n, p.lat + dLat);
  }
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const bbox: [number, number, number, number] = [clamp(w, -180, 180), clamp(s, -90, 90), clamp(e, -180, 180), clamp(n, -90, 90)];
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return {
    bbox: bbox.map(round).join(','),
    center: `${round(points[0]!.lng)},${round(points[0]!.lat)}`,
  };
}
