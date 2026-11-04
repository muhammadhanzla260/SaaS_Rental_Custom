/**
 * The E2 price calculator, wired to the product's real pricing engine (@rental/core), so the
 * website can never drift from what the app charges. Reference values: handoff
 * docs/pricing-engine.md §4 (Castle Bounce House + Popcorn Machine, Q-AUS-01043).
 */
import { formatMoney, quoteOrder, type ProductPricing, type QuoteLineInput, type ServiceMode } from '@rental/core/pricing';
import { travelFee } from '@rental/core/travel';

export type Surface = 'grass' | 'asphalt' | 'drivein';
export type DemoInput = { hours: number; miles: number; mode: ServiceMode; surface: Surface };
export const DEMO_DEFAULT: DemoInput = { hours: 5, miles: 18.4, mode: 'staffed', surface: 'grass' };

const castle: ProductPricing = { priceStaffedCents: 22500, pricePickupCents: 17500, priceDropoffCents: 19500, baseHours: 4, hourlyRateCents: null, overtimeBlockMinutes: 15, overtimeBlockCents: 2500 };
const popcorn: ProductPricing = { ...castle, priceStaffedCents: 7500, pricePickupCents: 6000, priceDropoffCents: 6000 };
const SURFACE_CENTS: Record<Surface, number> = { grass: 0, asphalt: 3500, drivein: 10000 };
const RULES = { freeDistance: 10, rateStaffed: 2.5, rateDropoff: 3, unit: 'mi' as const };
const TAX = 8.25;
export const usd = (c: number) => formatMoney(c, 'USD');

export function demoQuote(i: DemoInput) {
  const start = new Date(Date.UTC(2026, 10, 7, 13));
  const end = new Date(start.getTime() + Math.round(i.hours * 60) * 60_000);
  const line = (name: string, pricing: ProductPricing): QuoteLineInput => ({
    productId: name, name, pricing, minHours: null, serviceMode: i.mode, quantity: 1, flatRate: false, overrideUnitCents: null, setupSurfaceFeeCents: SURFACE_CENTS[i.surface],
  });
  const lines = [line('Castle Bounce House', castle), line('Popcorn Machine', popcorn)];
  const travel = travelFee(i.miles, lines.map((l) => l.serviceMode), RULES);
  const q = quoteOrder({
    startsAt: start, endsAt: end, multiDay: false, lines,
    damageWaiver: { enabled: true, percent: 10 }, travelFeeCents: Math.round(travel.fee * 100), miscFeesCents: 0,
    taxPercent: TAX, deposit: { kind: 'percent', value: 30 },
  });
  return { q, travel };
}

/** Rows as the calculator shows them. */
export function demoRows(i: DemoInput) {
  const { q, travel } = demoQuote(i);
  const s = q.summary;
  const ot = (l: (typeof q.lines)[number]) => (l.trace.method === 'blocks' && l.trace.units ? `4 h included + ${l.trace.units} × 15 min overtime` : '4 h included');
  const rows: [string, string, number][] = [
    ['Castle Bounce House', ot(q.lines[0]!), q.lines[0]!.lineTotalCents],
    ['Popcorn Machine', ot(q.lines[1]!), q.lines[1]!.lineTotalCents],
    ['Damage waiver', '10% of rentals', s.damageWaiverCents],
    ['Setup surface', i.surface === 'grass' ? 'Grass · no fee' : `${usd(SURFACE_CENTS[i.surface])} × 2 items`, s.setupSurfaceCents],
    ['Travel fee', i.mode === 'pickup' ? 'Customer picks up' : travel.billable > 0 ? `${travel.billable.toFixed(1)} mi past ${RULES.freeDistance} free × ${usd(travel.rate * 100)}` : `Inside the free ${RULES.freeDistance} miles`, s.travelFeeCents],
    ['Sales tax', `${TAX}%`, s.taxCents],
  ];
  return { rows, totalCents: s.totalCents, depositCents: s.depositCents };
}
