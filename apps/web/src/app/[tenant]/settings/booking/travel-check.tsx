'use client';

import { Car, MapPinned, Route } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, useTransition } from 'react';
import { serviceArea, type Point } from '@rental/core';
import { StreetAutocomplete } from '@/components/address-picker';
import { useMapboxToken } from '@/components/mapbox-token';
import { Card, Notice, Segmented } from '@/components/ui';
import { checkTravelFeeAction } from '@/server/actions/settings';

type Result = NonNullable<Awaited<ReturnType<typeof import('@/server/travel').quoteTravelFee>>>;

/**
 * Try the delivery rules on a real address: suggestions are limited to the
 * service area (like the Odoo POS), then the nearest location by driving
 * distance sets the fee.
 */
export function TravelCheck({
  slug, country, currency, origins, radius, unit,
}: {
  slug: string; country: string; currency: string; origins: Point[]; radius: number; unit: 'mi' | 'km';
}) {
  const token = useMapboxToken();
  const [address, setAddress] = useState('');
  const [mode, setMode] = useState<'staffed' | 'dropoff' | 'pickup'>('staffed');
  const [picked, setPicked] = useState<Point | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const area = useMemo(() => serviceArea(origins, radius, unit), [origins, radius, unit]);
  const money = useMemo(() => new Intl.NumberFormat('en-US', { style: 'currency', currency }), [currency]);

  const run = (point: Point, m = mode) =>
    start(async () => {
      setError(null);
      const r = await checkTravelFeeAction(slug, { ...point, mode: m });
      if (r.ok && r.data) setResult(r.data);
      else if (!r.ok) setError(r.error);
    });

  return (
    <Card title="Check a delivery address" description={`Type a customer's address to see which location serves it and the travel fee. Suggestions stay within ${radius} ${unit} of your locations.`}>
      {!token ? (
        <Notice kind="warn">Needs the Mapbox token to look up addresses and driving distance.</Notice>
      ) : !area ? (
        <Notice kind="warn">Pin at least one location on the map first.</Notice>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="travel-check-address" className="text-sm font-medium">Party address</label>
              <StreetAutocomplete
                id="travel-check-address"
                value={address}
                onType={setAddress}
                area={{ country, proximity: area.center, bbox: area.bbox }}
                placeholder="For example: 1100 Congress Ave"
                onPick={(f) => {
                  setAddress(f.label || f.line1 || '');
                  if (f.lat != null && f.lng != null) {
                    const p = { lat: f.lat, lng: f.lng };
                    setPicked(p);
                    run(p);
                  }
                }}
              />
            </div>
            <Segmented id="travel-check-mode" label="Service" value={mode}
              onChange={(m) => { setMode(m); if (picked) run(picked, m); }}
              options={[{ value: 'staffed', label: 'Staffed' }, { value: 'dropoff', label: 'Drop-off' }, { value: 'pickup', label: 'Pick-up' }]} />
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          <AnimatePresence mode="wait">
            {result && (
              <motion.div key={`${result.location.id}-${result.fee}-${mode}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: pending ? 0.5 : 1, y: 0 }} exit={{ opacity: 0 }}
                className="grid gap-3 rounded-ui border border-line bg-surface-2/60 p-4 sm:grid-cols-3">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text"><MapPinned aria-hidden className="size-5" /></span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase tracking-wide text-muted">Ships from</span>
                    <span className="block truncate font-semibold">{result.location.name} <span className="font-mono text-xs text-muted">{result.location.code}</span></span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text">{result.isDriving ? <Car aria-hidden className="size-5" /> : <Route aria-hidden className="size-5" />}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase tracking-wide text-muted">{result.isDriving ? 'Driving distance' : 'Straight-line distance'}</span>
                    <span className="block font-semibold tabular">{result.distance.toFixed(1)} {result.unit} · {result.billable.toFixed(1)} billable</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="brand-gradient grid size-10 shrink-0 place-items-center rounded-full font-bold text-brand-fg">$</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium uppercase tracking-wide text-muted">Travel fee</span>
                    <span className="block font-display text-xl font-bold text-brand-text tabular">{money.format(result.fee)}</span>
                    <span className="block text-xs text-muted">{result.reason === 'pickup' ? 'Customer picks up: no fee' : `${money.format(result.rate)} / ${result.unit} after the free distance`}</span>
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  );
}
