/**
 * Tenant theme (design system section 2). The org's brand colour replaces
 * --accent; status colours never change. Text on the accent is white or ink,
 * whichever contrasts more. Below 3:1 the colour cannot be saved.
 */

export const THEME_PRESETS = [
  { name: 'Cobalt', hex: '#2C4FE0' },
  { name: 'Emerald', hex: '#0B7A55' },
  { name: 'Ember', hex: '#C2410C' },
  { name: 'Berry', hex: '#B0306A' },
  { name: 'Violet', hex: '#6D3FD6' },
  { name: 'Teal', hex: '#0E7490' },
  { name: 'Ink', hex: '#10131A' },
] as const;

export const DEFAULT_ACCENT = '#2C4FE0';
export const INK = '#0B0D12';

/** "Corners" setting. Keys are stored in tenants.radius. */
export const CORNERS = {
  round: { label: 'Rounded', control: 10, card: 18, panel: 20, sheet: 22 },
  soft: { label: 'Soft', control: 6, card: 11, panel: 12, sheet: 13 },
  sharp: { label: 'Sharp', control: 4, card: 4, panel: 4, sheet: 4 },
} as const;
export type Corners = keyof typeof CORNERS;
/** @deprecated use CORNERS (kept while legacy screens are rebuilt). */
export const RADIUS_OPTIONS = {
  sharp: { label: 'Sharp', px: 4 },
  soft: { label: 'Soft', px: 6 },
  round: { label: 'Rounded', px: 10 },
} as const;
export type RadiusOption = Corners;

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Rgb = [number, number, number];

/** Surfaces the accent sits on (must match globals.css). */
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

export type AccentCheck = {
  /** Text colour on a filled accent button. */
  onAccent: '#FFFFFF' | typeof INK;
  ratio: number;
  /** 'all' ≥ 4.5:1 · 'large' ≥ 3:1 · 'fail' below 3:1 (cannot be saved). */
  level: 'all' | 'large' | 'fail';
  message: string;
};

/** The readout under the colour picker ("Button text contrast 6.4:1 · passes for all text sizes"). */
export function checkAccent(hex: string): AccentCheck {
  const white = contrastRatio('#FFFFFF', hex);
  const ink = contrastRatio(INK, hex);
  const onAccent = white >= ink ? '#FFFFFF' : INK;
  const ratio = Math.max(white, ink);
  const level = ratio >= 4.5 ? 'all' : ratio >= 3 ? 'large' : 'fail';
  const r = ratio.toFixed(1);
  const message =
    level === 'all'
      ? `Button text contrast ${r}:1 · passes for all text sizes`
      : level === 'large'
        ? `Button text contrast ${r}:1 · passes for large text only`
        : `Button text contrast ${r}:1 · too low, pick a stronger colour`;
  return { onAccent, ratio, level, message };
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
    if (Math.abs(rgbToOklch(rgb).l - l) < 0.01) return rgbToHex(rgb);
    c *= 0.85;
  }
  return rgbToHex(oklchToRgb({ l, c: 0, h: o.h }));
}

/** Move lightness toward black or white until `hex` reaches `ratio` against `bg`. */
export function ensureContrast(hex: string, bg: string, ratio: number): string {
  if (contrastRatio(hex, bg) >= ratio) return hex;
  const darken = luminance(bg) > 0.5;
  let l = rgbToOklch(hexToRgb(hex)).l;
  let out = hex;
  for (let i = 0; i < 70 && contrastRatio(out, bg) < ratio; i++) {
    l = darken ? l - 0.015 : l + 0.015;
    out = withLightness(hex, Math.min(0.99, Math.max(0.01, l)));
  }
  return out;
}

function shade(hex: string, delta: number): string {
  const l = rgbToOklch(hexToRgb(hex)).l;
  return withLightness(hex, Math.min(0.97, Math.max(0.05, l + delta)));
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
}

export type AccentTokens = { accent: string; hover: string; soft: string; text: string; on: string };

/** Light and dark accent tokens for one brand colour. */
export function accentTokens(hex: string): { light: AccentTokens; dark: AccentTokens } {
  const base = HEX_RE.test(hex) ? hex.toUpperCase() : DEFAULT_ACCENT;
  const { onAccent } = checkAccent(base);
  const light: AccentTokens = {
    accent: base,
    hover: shade(base, onAccent === '#FFFFFF' ? -0.06 : 0.06),
    soft: alpha(base, 0.14),
    text: ensureContrast(base, SURFACES.light, 4.5),
    on: onAccent,
  };
  // In dark mode a dark brand colour disappears into the page, so lift it.
  const darkAccent = ensureContrast(base, SURFACES.dark, 3);
  const darkOn = checkAccent(darkAccent).onAccent;
  const dark: AccentTokens = {
    accent: darkAccent,
    hover: shade(darkAccent, darkOn === '#FFFFFF' ? -0.06 : 0.06),
    soft: alpha(darkAccent, 0.2),
    text: ensureContrast(darkAccent, SURFACES.dark, 4.5),
    on: darkOn,
  };
  return { light, dark };
}

/** CSS custom properties for a tenant, ready to drop into a <style> tag. */
export function themeCss(brandHex: string, corners: Corners = 'round', scope = ':root'): string {
  const t = accentTokens(brandHex);
  const r = CORNERS[corners] ?? CORNERS.round;
  const vars = (x: AccentTokens) => `--accent:${x.accent};--accent-hover:${x.hover};--accent-soft:${x.soft};--accent-text:${x.text};--on-accent:${x.on};`;
  return [
    `${scope}{${vars(t.light)}--radius-control:${r.control}px;--radius-card:${r.card}px;--radius-panel:${r.panel}px;--radius-sheet:${r.sheet}px}`,
    `${scope}[data-theme=dark]{${vars(t.dark)}}`,
  ].join('\n');
}

/** Inline style object with the same variables (live previews). */
export function themeStyle(brandHex: string, corners: Corners = 'round', mode: 'light' | 'dark' = 'light'): Record<string, string> {
  const x = accentTokens(brandHex)[mode];
  const r = CORNERS[corners] ?? CORNERS.round;
  return {
    '--accent': x.accent,
    '--accent-hover': x.hover,
    '--accent-soft': x.soft,
    '--accent-text': x.text,
    '--on-accent': x.on,
    '--radius-control': `${r.control}px`,
    '--radius-card': `${r.card}px`,
    '--radius-panel': `${r.panel}px`,
  };
}

/** Two-letter avatar initials ("Freedom Fun USA" → "FF"). */
export function initials(name: string | null | undefined, fallback = '?'): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || fallback).toUpperCase();
}

// --- Legacy API (screens not yet rebuilt) ----------------------------------
export type ThemeTokens = { brand: string; brandFg: string; brandStrong: string; brandSoft: string; brandText: string };
export type ThemePalette = { light: ThemeTokens; dark: ThemeTokens; warnings: string[] };
/** @deprecated use accentTokens / checkAccent. */
export function buildPalette(brandHex: string): ThemePalette {
  const t = accentTokens(brandHex);
  const map = (x: AccentTokens): ThemeTokens => ({ brand: x.accent, brandFg: x.on, brandStrong: x.hover, brandSoft: x.soft, brandText: x.text });
  const c = checkAccent(HEX_RE.test(brandHex) ? brandHex : DEFAULT_ACCENT);
  return { light: map(t.light), dark: map(t.dark), warnings: c.level === 'fail' ? [c.message] : [] };
}
