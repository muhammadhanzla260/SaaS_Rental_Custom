import 'server-only';
import { findNearestOrigin, parseLocationSettings, travelFee, type Point, type ServiceMode, type TenantPreferences } from '@rental/core';
import { listLocations } from '@rental/db';
import { db } from './db';

const MILES_PER_METRE = 1 / 1609.344;

/** Mapbox Directions driving distance in miles (Odoo: mapboxDrivingDistanceMiles), or null. */
async function drivingMiles(from: Point, to: Point): Promise<number | null> {
  const token = process.env.MAPBOX_SECRET_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  try {
    const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=false&access_token=${token}`, {
      // URL-restricted public tokens check the Referer.
      headers: { Referer: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const route = (await res.json()).routes?.[0];
    return route ? route.distance * MILES_PER_METRE : null;
  } catch {
    return null;
  }
}

/**
 * Travel fee for a delivery to `to`, exactly as the Odoo Rental POS worked it out:
 * nearest active location by driving distance, minus free distance, times the rate.
 */
export async function quoteTravelFee(tenantId: string, prefs: TenantPreferences, to: Point, modes: ServiceMode[]) {
  const locations = (await listLocations(db, tenantId)).filter((l) => l.isActive);
  const nearest = await findNearestOrigin(locations, to, drivingMiles);
  if (!nearest) return null;
  const unit = prefs.formats.distanceUnit;
  // A location may override the org's free miles and rates (null = org default).
  const own = parseLocationSettings(nearest.origin.settings);
  const fee = travelFee(nearest.miles, modes, {
    unit,
    freeDistance: own.freeTravelMiles ?? prefs.booking.freeTravelDistance,
    rateStaffed: own.travelRateStaffed ?? prefs.booking.travelRateStaffed,
    rateDropoff: own.travelRateDropoff ?? prefs.booking.travelRateDropoff,
  });
  return {
    location: { id: nearest.origin.id, name: nearest.origin.name, code: nearest.origin.code },
    isDriving: nearest.isDriving,
    unit,
    ...fee,
  };
}
