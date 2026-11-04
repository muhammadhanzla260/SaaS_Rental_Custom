import { describe, expect, it } from 'vitest';
import { csvCell, safeNextPath } from './safety';

describe('safeNextPath (where to go after sign-in)', () => {
  it('keeps paths on this site, with their query and anchor', () => {
    expect(safeNextPath('/freedom-fun/orders')).toBe('/freedom-fun/orders');
    expect(safeNextPath('/q/abc?step=pay#card')).toBe('/q/abc?step=pay#card');
  });

  it('refuses anything that leaves the site (QA B-12)', () => {
    for (const bad of ['/\\evil.example/phish', '//evil.example', 'https://evil.example', 'evil.example', '/\t/evil.example', '', null, undefined]) {
      expect(safeNextPath(bad)).toBeNull();
    }
    // Encoded characters stay encoded, so they cannot break out of the path.
    expect(safeNextPath('/%0d%0a')).toBe('/%0d%0a');
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBeNull();
  });
});

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks, including a bare carriage return', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\rbreak')).toBe('"line\rbreak"');
  });

  it('keeps formulas from running in a spreadsheet (QA B-23), but leaves numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","x")')).toBe('"\'=HYPERLINK(""http://evil.example"",""x"")"');
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50');
    expect(csvCell('Maria Gonzalez')).toBe('Maria Gonzalez');
  });
});
