'use client';

import { createContext, useContext } from 'react';

/** Public Mapbox token (pk.*), provided at runtime by the root layout. */
const MapboxTokenContext = createContext<string | null>(null);

export function MapboxTokenProvider({ token, children }: { token: string | null; children: React.ReactNode }) {
  return <MapboxTokenContext.Provider value={token}>{children}</MapboxTokenContext.Provider>;
}

export const useMapboxToken = () => useContext(MapboxTokenContext);
