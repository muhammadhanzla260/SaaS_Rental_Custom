'use client';

import { MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useMapboxToken } from './mapbox-token';
import { cx } from './ui';

/**
 * Small map picture with a brand-coloured pin (Mapbox Static Images API).
 * Without a token or a pin it shows a friendly placeholder instead.
 */
export function StaticMap({
  lat, lng, width = 600, height = 260, zoom = 13, className, label,
}: {
  lat?: number | null; lng?: number | null; width?: number; height?: number; zoom?: number; className?: string; label: string;
}) {
  const token = useMapboxToken();
  const [pin, setPin] = useState('2450C8');
  const [dark, setDark] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    setPin(css.getPropertyValue('--brand').trim().replace('#', '') || '2450C8');
    setDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  const has = typeof lat === 'number' && typeof lng === 'number';
  if (!token || !has || failed) {
    return (
      <div className={cx('relative grid place-items-center overflow-hidden bg-surface-2', className)} role="img" aria-label={has ? label : `${label}: not on the map yet`}>
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(var(--grid-dot)_1.5px,transparent_1.5px)] [background-size:14px_14px]" />
        <span className="relative flex flex-col items-center gap-1 text-xs font-medium text-muted">
          <MapPin aria-hidden className={cx('size-6', has ? 'animate-float text-brand-text' : '')} />
          {has ? `${lat!.toFixed(3)}, ${lng!.toFixed(3)}` : 'Not on the map yet'}
        </span>
      </div>
    );
  }
  const style = dark ? 'dark-v11' : 'streets-v12';
  const src =
    `https://api.mapbox.com/styles/v1/mapbox/${style}/static/pin-l+${pin}(${lng},${lat})/${lng},${lat},${zoom},0/` +
    `${Math.min(width, 1280)}x${Math.min(height, 1280)}@2x?access_token=${token}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={label} width={width} height={height} loading="lazy" onError={() => setFailed(true)} className={cx('object-cover', className)} />
  );
}
