import { describe, expect, it } from 'vitest';
import { DEMO_DEFAULT, demoRows, type DemoInput, type Surface } from './price-demo';
import type { ServiceMode } from '@rental/core/pricing';

/** Independent re-statement of handoff docs/pricing-engine.md for the two demo products. */
function byHand(i: DemoInput) {
  const base = { staffed: [22500, 7500], pickup: [17500, 6000], dropoff: [19500, 6000] }[i.mode];
  const extraMin = Math.max(0, Math.round(i.hours * 60) - 240);
  const ot = Math.ceil(extraMin / 15) * 2500;
  const merch = base[0]! + ot + base[1]! + ot;
  const waiver = Math.round(merch * 0.1);
  const surf = { grass: 0, asphalt: 3500, drivein: 10000 }[i.surface] * 2;
  const rate = i.mode === 'dropoff' ? 300 : 250;
  const travel = i.mode === 'pickup' ? 0 : Math.round(Math.max(0, i.miles - 10) * rate);
  const tax = Math.round((merch + waiver + surf + travel) * 0.0825);
  return merch + waiver + surf + travel + tax;
}

describe('E2 price calculator', () => {
  it('shows $618.11 at its default settings', () => {
    const r = demoRows(DEMO_DEFAULT);
    expect(r.totalCents).toBe(61811);
    expect(r.depositCents).toBe(18543);
  });
  it('matches the pricing engine rules for 10 random inputs', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 10; n++) {
      const input: DemoInput = {
        hours: 2 + Math.round(rnd() * 20) / 2,
        miles: Math.round(rnd() * 400) / 10,
        mode: (['staffed', 'dropoff', 'pickup'] as ServiceMode[])[Math.floor(rnd() * 3)]!,
        surface: (['grass', 'asphalt', 'drivein'] as Surface[])[Math.floor(rnd() * 3)]!,
      };
      expect(demoRows(input).totalCents, JSON.stringify(input)).toBe(byHand(input));
    }
  });
});
