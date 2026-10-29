import type { CSSProperties } from 'react';
import { checkAccent, initials, type LogoAdjust } from '@rental/core';

/**
 * Renders one logo variant from the original upload plus its editor
 * parameters (zoom, offset, padding, background, shape, rotate). No
 * re-encoded images: the same file serves every variant.
 */
export function logoBoxStyle(adjust: LogoAdjust, size: number, brandColor: string): CSSProperties {
  const bg = { none: 'transparent', white: '#FFFFFF', brand: brandColor, dark: '#0B0D12' }[adjust.background];
  const radius = adjust.shape === 'circle' ? '50%' : adjust.shape === 'rounded' ? `${Math.round(size * 0.25)}px` : `${Math.max(2, Math.round(size * 0.08))}px`;
  // Padding is authored in px on the 240 px editor canvas; scale it to this size.
  return { width: size, height: size, background: bg, borderRadius: radius, padding: Math.round((adjust.padding * size) / 110) };
}

export function logoImgStyle(adjust: LogoAdjust): CSSProperties {
  return {
    transform: `translate(${adjust.x}%, ${adjust.y}%) scale(${adjust.zoom / 100}) rotate(${adjust.rotate}deg)`,
    transformOrigin: 'center',
  };
}

export function LogoMark({
  name, url, adjust, size, brandColor, fallbackColor, className,
}: { name: string; url: string | null; adjust: LogoAdjust; size: number; brandColor: string; fallbackColor?: string; className?: string }) {
  if (!url) {
    const bg = fallbackColor ?? brandColor;
    const fg = checkAccent(bg).onAccent;
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center font-bold ${className ?? ''}`}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.25), background: bg, color: fg, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${className ?? ''}`} style={logoBoxStyle(adjust, size, brandColor)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="size-full object-contain" style={logoImgStyle(adjust)} draggable={false} />
    </span>
  );
}
