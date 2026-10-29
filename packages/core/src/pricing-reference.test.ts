import { describe, expect, it } from 'vitest';
import { describeTrace, formatMoney, quoteOrder, type ProductPricing, type QuoteLineInput } from './pricing';
import { travelFee } from './travel';

/** The design's worked reference (handoff docs/pricing-engine.md §4 and §6). */
const castle: ProductPricing = {
  priceStaffedCents: 22500, pricePickupCents: 17500, priceDropoffCents: 19500,
  baseHours: 4, hourlyRateCents: null, overtimeBlockMinutes: 15, overtimeBlockCents: 2500,
};
const popcorn: ProductPricing = { ...castle, priceStaffedCents: 7500, pricePickupCents: 6000, priceDropoffCents: 6000 };
const line = (pricing: ProductPricing | null, o: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  productId: pricing ? 'p' : null, name: 'Item', pricing, minHours: null, serviceMode: 'staffed', quantity: 1,
  flatRate: false, overrideUnitCents: null, setupSurfaceFeeCents: 0, ...o,
});
const rules = { freeDistance: 10, rateStaffed: 2.5, rateDropoff: 3, unit: 'mi' as const };
const sat = (h: number) => new Date(Date.UTC(2026, 10, 7, h));
const usd = (c: number) => formatMoney(c, 'USD');

function reference(extra: Partial<Parameters<typeof quoteOrder>[0]> = {}) {
  const lines = [line(castle, { name: 'Castle Bounce House' }), line(popcorn, { name: 'Popcorn Machine' })];
  const travel = travelFee(18.4, lines.map((l) => l.serviceMode), rules);
  return quoteOrder({
    startsAt: sat(13), endsAt: sat(18), multiDay: false, lines,
    damageWaiver: { enabled: true, percent: 10 }, travelFeeCents: Math.round(travel.fee * 100), miscFeesCents: 0,
    taxPercent: 8.25, deposit: { kind: 'percent', value: 30 }, ...extra,
  });
}

describe('reference order Q-AUS-01043', () => {
  it('prices to the cent: $618.11, deposit $185.43, balance $432.68', () => {
    const q = reference();
    expect(q.lines.map((l) => l.unitCents)).toEqual([32500, 17500]);
    expect(describeTrace(q.lines[0]!.trace, usd)).toBe('$225.00 incl. 4 h + 4 × 15 min × $25.00');
    expect(q.summary).toMatchObject({
      merchandiseCents: 50000, damageWaiverCents: 5000, travelFeeCents: 2100, taxableBaseCents: 57100, taxCents: 4711,
      totalCents: 61811, depositCents: 18543,
    });
    expect(q.summary.totalCents - q.summary.depositCents).toBe(43268);
  });
  it('rain check RC-0012 + $20 wallet: due after credits $412.68, deposit on that amount', () => {
    const q = reference({ creditCents: 18543 + 2000 });
    expect(q.summary.creditCents).toBe(20543);
    expect(q.summary.totalCents).toBe(41268);
    expect(q.summary.depositCents).toBe(12380);
  });
});

describe('engine rules', () => {
  it('pick-up only → no travel fee; any drop-off → drop-off rate', () => {
    expect(travelFee(18.4, ['pickup', 'pickup'], rules).fee).toBe(0);
    expect(travelFee(18.4, ['staffed', 'dropoff'], rules).fee).toBe(25.2);
  });
  it('asphalt on 3 rental lines → $105 surface fee', () => {
    const q = quoteOrder({
      startsAt: sat(13), endsAt: sat(17), multiDay: false,
      lines: [castle, popcorn, castle].map((p) => line(p, { setupSurfaceFeeCents: 3500 })),
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 0,
    });
    expect(q.summary.setupSurfaceCents).toBe(10500);
  });
  it('custom non-taxable lines stay out of the tax base, the waiver and the coupon', () => {
    const q = quoteOrder({
      startsAt: sat(13), endsAt: sat(17), multiDay: false,
      lines: [line(castle), line(null, { name: 'Generator', overrideUnitCents: 5000, taxable: false }), line(null, { name: 'Ice', overrideUnitCents: 1000 })],
      damageWaiver: { enabled: true, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 10,
      coupon: { kind: 'percent', value: 10 },
    });
    expect(q.summary).toMatchObject({ merchandiseCents: 22500, customCents: 6000, nonTaxableCents: 5000, damageWaiverCents: 2250, couponCents: 2250 });
    // base = 225 + 22.50 waiver + 10 custom taxable - 22.50 coupon = 235
    expect(q.summary.taxableBaseCents).toBe(23500);
    expect(q.summary.totalCents).toBe(22500 + 6000 + 2250 - 2250 + 2350);
  });
  it('a non-taxable product line is excluded from the base', () => {
    const q = quoteOrder({
      startsAt: sat(13), endsAt: sat(17), multiDay: false, lines: [line(castle, { taxable: false })],
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 10,
    });
    expect(q.summary.taxCents).toBe(0);
  });
  it('discount and coupon cannot take merchandise below $0', () => {
    const q = quoteOrder({
      startsAt: sat(13), endsAt: sat(17), multiDay: false, lines: [line(popcorn)],
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 8.25,
      coupon: { kind: 'amount', value: 500 }, discount: { kind: 'amount', value: 500 },
    });
    expect(q.summary.couponCents).toBe(7500);
    expect(q.summary.totalCents).toBe(0);
  });
  it('a credit larger than the total → due $0, deposit $0', () => {
    const q = reference({ creditCents: 1_000_000 });
    expect(q.summary).toMatchObject({ totalCents: 0, depositCents: 0, creditCents: 61811 });
  });
  it('describes hourly and custom traces', () => {
    const hourly = quoteOrder({
      startsAt: sat(13), endsAt: sat(16), multiDay: false, lines: [line({ ...castle, baseHours: null, hourlyRateCents: 5000 })],
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 0,
    });
    expect(describeTrace(hourly.lines[0]!.trace, usd)).toBe('$225.00 incl. 1 h + 2 started h × $50.00');
    const short = quoteOrder({
      startsAt: sat(13), endsAt: sat(16), multiDay: false, lines: [line(castle), line(null, { overrideUnitCents: 100 })],
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 0,
    });
    expect(describeTrace(short.lines[0]!.trace, usd)).toBe('$225.00 incl. 4 h · within included time');
    expect(describeTrace(short.lines[1]!.trace, usd)).toBe('Custom line');
  });
});

describe('multi-day rentals (as FreedomFun billed them in Odoo)', () => {
  it('charge each item its package once, whatever the span (Odoo #17773: 75 h, every item at its package)', () => {
    const q = quoteOrder({
      startsAt: new Date(Date.UTC(2027, 5, 14, 15)), endsAt: new Date(Date.UTC(2027, 5, 17, 18)), multiDay: true,
      lines: [line(castle, { name: 'Castle', serviceMode: 'dropoff' }), line(popcorn, { name: 'Popcorn', quantity: 2 })],
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 0, deposit: { kind: 'percent', value: 30 },
    });
    expect(q.hours).toBe(75);
    expect(q.lines.map((l) => l.unitCents)).toEqual([19500, 7500]);
    expect(q.summary.merchandiseCents).toBe(19500 + 2 * 7500);
    expect(describeTrace(q.lines[0]!.trace, usd)).toBe('$195.00 package · multi-day rental, no extra time');
  });
  it('a typed price still wins (Odoo: Snow Cone $150 for 42 h)', () => {
    const q = quoteOrder({
      startsAt: new Date(Date.UTC(2026, 6, 18, 0, 30)), endsAt: new Date(Date.UTC(2026, 6, 19, 18)), multiDay: true,
      lines: [line(popcorn, { overrideUnitCents: 15000 })],
      damageWaiver: { enabled: false, percent: 10 }, travelFeeCents: 0, miscFeesCents: 0, taxPercent: 0, deposit: { kind: 'none', value: 0 },
    });
    expect(q.lines[0]).toMatchObject({ unitCents: 15000, autoUnitCents: 7500, overridden: true });
  });
  it('same-day events keep the hourly ladder', () => {
    expect(reference().lines[0]!.unitCents).toBe(22500 + 4 * 2500);
  });
});
