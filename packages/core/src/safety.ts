/**
 * Small guards for values that come from outside (links, files people download).
 */

/**
 * The path to go to after sign-in, only if it stays on this site; otherwise null. Browsers read `\` as
 * `/`, so `/\evil.example` would leave the site even though it starts with one slash.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || next.length > 2048 || !next.startsWith('/') || next.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const base = 'http://same.invalid';
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

/**
 * One CSV cell. Quotes cells with commas, quotes or line breaks, and defuses spreadsheet formulas: a
 * cell starting with = + - @ (or a tab or carriage return) gets a leading apostrophe, so a customer
 * named `=HYPERLINK(...)` stays text. Plain numbers (like -12.50) are left alone.
 */
export function csvCell(value: string): string {
  let s = value;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
