'use client';

export type ClientFix = { lat: number; lng: number; accuracy: number | null };

/** One precise GPS fix from the phone, or null (no permission, no signal, too slow). */
export function getFix(timeoutMs = 15_000): Promise<ClientFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5_000 },
    );
  });
}

/** Keeps the latest fix from the phone while tracking (cheaper than asking each time). */
export function watchFix(onFix: (f: ClientFix) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }),
    () => {},
    { enableHighAccuracy: true, maximumAge: 10_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
