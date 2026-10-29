import type { CSSProperties } from 'react';
import { cx } from '@/components/kit';

/** Product tile icons from the design (Products.dc.html), 24×24 stroke paths. */
export const PRODUCT_ICON_PATHS = {
  bounce: 'M4 20V10l3-4 2 3 3-5 3 5 2-3 3 4v10zM4 14h16M9 20v-4h6v4',
  slide: 'M3 20h18M5 20V8h4l10 12M5 12h4',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  food: 'M7 8h10l-1.5 12h-7zM6 8a6 6 0 0 1 12 0M10 4l1 4M14 4l-1 4',
  game: 'M8 4h8v4H8zM6 10h12v4H6zM8 16h8v4H8z',
  tent: 'M12 3 2 20h20zM12 3v17M8 20l4-7 4 7',
  table: 'M3 8h18M5 8v12M19 8v12M3 8l2-4h14l2 4',
  fee: 'M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
} as const;
export type ProductIcon = keyof typeof PRODUCT_ICON_PATHS;

/** Tile tints [background, ink] from the design. Dark mode mixes them toward the surface (globals.css .tint). */
export const TINTS = {
  cobalt: ['#E6ECFF', '#233FB8'],
  emerald: ['#E3F5EC', '#0B6145'],
  violet: ['#F1EAFE', '#5B2DB0'],
  sky: ['#E0F2F7', '#0A5566'],
  ink: ['#0B0D12', '#D4FF3A'],
  navy: ['#1B2A41', '#9FD8FF'],
  amber: ['#FFF1DC', '#8A4A00'],
  rose: ['#FDE7E8', '#A31F25'],
  slate: ['#F3F4F6', '#353C48'],
  mist: ['#EEF0F3', '#3F4754'],
} as const;
export type Tint = keyof typeof TINTS;

/** Category dots cycle through these. */
export const CATEGORY_COLORS = ['#2C4FE0', '#0E7490', '#0B0D12', '#A85A00', '#B0306A', '#535C6B', '#0B7A55', '#6D3FD6'];

/** A sensible icon from the product name when none was chosen. */
export function guessIcon(name: string, kind?: string): ProductIcon {
  const n = name.toLowerCase();
  if (/bounce|castle|combo|jump|inflatable(?!.*screen)/.test(n)) return 'bounce';
  if (/slide|water/.test(n)) return 'slide';
  if (/screen|movie|projector|led/.test(n)) return 'screen';
  if (/popcorn|cotton|candy|snow ?cone|food|concession|machine/.test(n)) return 'food';
  if (/jenga|game|connect|cornhole|dunk/.test(n)) return 'game';
  if (/tent|canopy/.test(n)) return 'tent';
  if (/table|chair/.test(n)) return 'table';
  if (kind === 'service' || kind === 'fee' || /fee|attendant|staff|delivery/.test(n)) return 'fee';
  return 'box';
}

export function guessTint(icon: ProductIcon): Tint {
  return ({ bounce: 'cobalt', slide: 'sky', screen: 'ink', food: 'amber', game: 'slate', tent: 'mist', table: 'slate', fee: 'emerald', box: 'mist' } as const)[icon];
}

export function artOf(p: { name: string; kind?: string; icon?: string | null; tint?: string | null }) {
  const icon = (p.icon && p.icon in PRODUCT_ICON_PATHS ? p.icon : guessIcon(p.name, p.kind)) as ProductIcon;
  const tint = (p.tint && p.tint in TINTS ? p.tint : guessTint(icon)) as Tint;
  return { icon, tint };
}

export function tintStyle(tint: Tint): CSSProperties {
  const [bg, fg] = TINTS[tint];
  return { '--tb': bg, '--tf': fg } as CSSProperties;
}

/** The coloured icon block used on product tiles, order lines and the calendar. */
export function ProductArt({
  product, size = 40, imageUrl, className, iconSize,
}: { product: { name: string; kind?: string; icon?: string | null; tint?: string | null }; size?: number | 'fill'; imageUrl?: string | null; className?: string; iconSize?: number }) {
  const { icon, tint } = artOf(product);
  const box = size === 'fill' ? undefined : { width: size, height: size };
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={cx('shrink-0 rounded-[var(--radius-control)] object-cover', className)} style={box} loading="lazy" />;
  }
  const px = iconSize ?? (size === 'fill' ? 56 : Math.round(size * 0.5));
  return (
    <span aria-hidden className={cx('tint grid shrink-0 place-items-center rounded-[var(--radius-control)]', className)} style={{ ...box, ...tintStyle(tint) }}>
      <svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={PRODUCT_ICON_PATHS[icon]} />
      </svg>
    </span>
  );
}
