import { describe, expect, it } from 'vitest';
import { billableHours, depositDue, linePrice, orderSummary, overtimeBlocksCents, roundCents, type ProductPricing } from './pricing';

const product = (o: Partial<ProductPricing> = {}): ProductPricing => ({
  priceStaffedCents: 29900, pricePickupCents: 19900, priceDropoffCents: 24900,
  baseHours: null, hourlyRateCents: null, overtimeBlockMinutes: 15, overtimeBlockCents: 2500, ...o,
});
const at = (h: number, m = 0, day = 7) => new Date(Date.UTC(2026, 10, day, h, m));

describe('billable hours (POS getDurationHours)', () => {
  it('bills at least an hour and wraps past midnight', () => {
    expect(billableHours(at(14), at(18), false)).toBe(4);
    expect(billableHours(at(21), at(1), false)).toBe(4); // 9 PM to 1 AM
    expect(billableHours(at(14), at(14, 30), false)).toBe(1);
    expect(billableHours(at(10, 0, 7), at(10, 0, 9), true)).toBe(48);
  });
});

describe('line price (Odoo _package_duration_price)', () => {
  it('uses the price for the service mode', () => {
    expect(linePrice(product(), 'staffed', 1).unitCents).toBe(29900);
    expect(linePrice(product(), 'pickup', 1).unitCents).toBe(19900);
    expect(linePrice(product(), 'dropoff', 1).unitCents).toBe(24900);
  });
  it('included hours cost nothing extra', () => {
    expect(linePrice(product({ baseHours: 4 }), 'staffed', 4).unitCents).toBe(29900);
  });
  it('base hours + hourly rate: excess x rate, half-up to the cent', () => {
    expect(linePrice(product({ baseHours: 4, hourlyRateCents: 5000 }), 'staffed', 5.5).unitCents).toBe(29900 + 7500);
    expect(linePrice(product({ baseHours: 4, hourlyRateCents: 3333 }), 'staffed', 4.5).unitCents).toBe(29900 + 1667);
  });
  it('base hours without a rate: $25 per started 15 minutes', () => {
    // 3h05 with 2 included: 13 blocks - 8 free = 5 x $25
    expect(linePrice(product({ baseHours: 2 }), 'staffed', 3 + 5 / 60).unitCents).toBe(29900 + 12500);
  });
  it('no base hours + rate: first hour included, each further started hour', () => {
    expect(linePrice(product({ hourlyRateCents: 7500 }), 'staffed', 3.2).unitCents).toBe(29900 + 3 * 7500);
  });
  it('no base hours, no rate: first hour free then $25 / 15 min', () => {
    expect(linePrice(product(), 'staffed', 2).unitCents).toBe(29900 + 4 * 2500);
    expect(overtimeBlocksCents(1, 1, 15, 2500)).toBe(0);
  });
  it('flat rate and manual override', () => {
    expect(linePrice(product(), 'staffed', 6, { flatRate: true }).unitCents).toBe(29900);
    const o = linePrice(product(), 'staffed', 2, { overrideUnitCents: 25000 });
    expect(o).toMatchObject({ unitCents: 25000, autoUnitCents: 39900, overridden: true });
  });
});

describe('order summary (Odoo _compute_amounts)', () => {
  const base = {
    lines: [{ unitCents: 29900, quantity: 1, setupSurfaceFeeCents: 3500 }, { unitCents: 15000, quantity: 2 }],
    damageWaiver: { enabled: true, percent: 10 },
    travelFeeCents: 3750,
    miscFeesCents: 0,
    taxPercent: 8.25,
  };
  it('waiver on merchandise before discount, one-pass tax, 30% deposit', () => {
    const s = orderSummary({ ...base, discount: { kind: 'percent', value: 10 } });
    expect(s).toMatchObject({
      merchandiseCents: 59900, damageWaiverCents: 5990, setupSurfaceCents: 3500, extrasCents: 13240,
      preTaxDiscountCents: 5990, taxableBaseCents: 67150, taxCents: 5540, totalCents: 72690, depositCents: 21807, depositPercent: 30,
    });
  });
  it('raincheck (after-tax) discount does not reduce the taxable base', () => {
    const s = orderSummary({ ...base, discount: { kind: 'amount', value: 50, afterTax: true } });
    expect(s).toMatchObject({ preTaxDiscountCents: 0, postTaxDiscountCents: 5000, taxableBaseCents: 73140, taxCents: 6034, totalCents: 74174 });
  });
  it('caps a $ discount and the store credit', () => {
    const s = orderSummary({ ...base, damageWaiver: { enabled: false, percent: 10 }, discount: { kind: 'amount', value: 100000 }, creditCents: 999999 });
    expect(s.preTaxDiscountCents).toBe(59900 + 3750 + 3500);
    expect(s.totalCents).toBe(0);
    expect(s.depositCents).toBe(0);
  });
  it('coupon comes off before tax; manual 0% tax is allowed', () => {
    const s = orderSummary({ ...base, couponCents: 1000, taxPercent: 0 });
    expect(s.taxCents).toBe(0);
    expect(s.totalCents).toBe(59900 + 13240 - 1000);
  });
  it('deposit overrides: percent, or amount capped at the total', () => {
    expect(depositDue(72690, { kind: 'percent', value: 50 })).toEqual({ depositCents: 36345, depositPercent: 50 });
    expect(depositDue(72690, { kind: 'amount', value: 100 })).toEqual({ depositCents: 10000, depositPercent: 13.8 });
    expect(depositDue(72690, { kind: 'amount', value: 9999 }).depositCents).toBe(72690);
  });
  it('rounds half-up like Odoo', () => {
    expect(roundCents(5539.5)).toBe(5540);
    expect(roundCents(5539.4999)).toBe(5539);
    expect(roundCents(-12.5)).toBe(-13);
  });
});
