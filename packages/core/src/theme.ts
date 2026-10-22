/**
 * Tenant theme: turns one brand colour into the CSS tokens the app uses,
 * for both light and dark mode, with readable text guaranteed (WCAG contrast).
 */

export const THEME_PRESETS = [
  { name: 'Cobalt', hex: '#2450C8' },
  { name: 'Ocean', hex: '#0E7C86' },
  { name: 'Emerald', hex: '#0F8A5F' },
  { name: 'Lime', hex: '#5B8C1A' },
  { name: 'Gold', hex: '#B7791F' },
  { name: 'Sunset', hex: '#E2581F' },
  { name: 'Cherry', hex: '#D32F2F' },
  { name: 'Berry', hex: '#C2185B' },
  { name: 'Violet', hex: '#6D3FD1' },
  { name: 'Slate', hex: '#334155' },
] as const;

export const RADIUS_OPTIONS = {
  sharp: { label: 'Sharp', px: 4 },
  soft: { label: 'Soft', px: 10 },
  round: { label: 'Round', px: 16 },
} as const;
export type RadiusOption = keyof typeof RADIUS_OPTIONS;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Rgb = [number, number, number];

/** Page backgrounds the app paints behind brand colours (must match globals.css). */
export const SURFACES = { light: '#FFFFFF', dark: '#141821' } as const;

export function hexToRgb(hex: string): Rgb {
  if (!HEX_RE.test(hex)) throw new Error(`Invalid colour ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// --- OKLCH (perceptual lightness changes keep the hue stable) ---------------
type Oklch = { l: number; c: number; h: number };

function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return [fromLinear(r), fromLinear(g), fromLinear(b)].map((v) => Math.min(255, Math.max(0, v))) as Rgb;
}

/** Same hue and chroma, new perceptual lightness. Chroma shrinks until in gamut. */
function withLightness(hex: string, l: number): string {
  const o = rgbToOklch(hexToRgb(hex));
  let c = o.c;
  for (let i = 0; i < 24; i++) {
    const rgb = oklchToRgb({ l, c, h: o.h });
    const back = rgbToOklch(rgb);
    if (Math.abs(back.l - l) < 0.01) return rgbToHex(rgb);
    c *= 0.85;
  }
  return rgbToHex(oklchToRgb({ l, c: 0, h: o.h }));
}

/** Move lightness toward black or white until `hex` reaches `ratio` against `bg`. */
function ensureContrast(hex: string, bg: string, ratio: number): string {
  if (contrastRatio(hex, bg) >= ratio) return hex;
  const darken = luminance(bg) > 0.5;
  let l = rgbToOklch(hexToRgb(hex)).l;
  let out = hex;
  for (let i = 0; i < 60 && contrastRatio(out, bg) < ratio; i++) {
    l = darken ? l - 0.015 : l + 0.015;
    out = withLightness(hex, Math.min(0.99, Math.max(0.01, l)));
  }
  return out;
}

function mix(a: string, b: string, weightOfA: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v * weightOfA + y[i]! * (1 - weightOfA)) as Rgb);
}

export type ThemeTokens = {
  /** Filled buttons, active nav, selected states. */
  brand: string;
  /** Text and icons on top of `brand`. */
  brandFg: string;
  /** Hover / pressed shade of `brand`. */
  brandStrong: string;
  /** Tinted backgrounds (selected rows, badges). */
  brandSoft: string;
  /** Brand-coloured text on the page background (links), always >= 4.5:1. */
  brandText: string;
};

export type ThemePalette = { light: ThemeTokens; dark: ThemeTokens; warnings: string[] };

function tokensFor(picked: string, surface: string): ThemeTokens {
  const onWhite = contrastRatio('#FFFFFF', picked);
  const onInk = contrastRatio('#111318', picked);
  const brandFg = onWhite >= onInk ? '#FFFFFF' : '#111318';
  // Nudge the fill (never the hue) until button text reaches 4.5:1.
  const brand = ensureContrast(picked, brandFg, 4.5);
  const l = rgbToOklch(hexToRgb(brand)).l;
  const brandStrong = withLightness(brand, brandFg === '#FFFFFF' ? Math.max(0.05, l - 0.07) : Math.min(0.97, l + 0.07));
  const isLight = surface === SURFACES.light;
  return {
    brand,
    brandFg,
    brandStrong,
    brandSoft: mix(brand, surface, isLight ? 0.1 : 0.2),
    brandText: ensureContrast(brand, surface, 4.5),
  };
}

export function buildPalette(brandHex: string): ThemePalette {
  const brand = brandHex.toUpperCase();
  const warnings: string[] = [];
  // In dark mode a very dark brand colour disappears into the page, so lift it.
  const darkBrand = ensureContrast(brand, SURFACES.dark, 3);
  if (contrastRatio(brand, SURFACES.light) < 3) {
    warnings.push('This colour is very light. Buttons stay readable, but it will look faint on white backgrounds.');
  }
  if (contrastRatio(brand, SURFACES.dark) < 1.5) {
    warnings.push('This colour is very dark, so a lighter shade is used in dark mode.');
  }
  return { light: tokensFor(brand, SURFACES.light), dark: tokensFor(darkBrand, SURFACES.dark), warnings };
}

/** CSS custom properties for a tenant, ready to drop into a <style> tag. */
export function themeCss(brandHex: string, radius: RadiusOption, scope = ':root'): string {
  const p = buildPalette(brandHex);
  const vars = (t: ThemeTokens) =>
    `--brand:${t.brand};--brand-fg:${t.brandFg};--brand-strong:${t.brandStrong};--brand-soft:${t.brandSoft};--brand-text:${t.brandText};`;
  return [
    `${scope}{${vars(p.light)}--radius:${RADIUS_OPTIONS[radius].px}px}`,
    `${scope}[data-theme=dark]{${vars(p.dark)}}`,
  ].join('\n');
}
