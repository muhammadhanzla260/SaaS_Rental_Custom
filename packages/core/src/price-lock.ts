/**
 * Price locks: once an order exists, what it was priced with stays with it. Changing a product,
 * a fee, a rate or the price formula in Settings applies to new quotes and to items added later,
 * never to what an order already has. The server (authoritative) and the order builder (live total)
 * use these same rules, so the two always agree.
 *
 * A lock holds while the thing it depends on is unchanged: a line keeps its product's pricing while it
 * is the same line, product and service mode; the travel fee while the miles, depot and drop-off stay
 * the same; the tax rate while the location and customer stay the same. Change one of those on
 * purpose and that one part is priced again (with the order's own rules where it has them).
 */
import { DEFAULT_PRICING_FORMULA, type PricingFormula, type ProductPricing, type ServiceMode } from './pricing';
import type { TravelFeeRules } from './travel';

/** A line's product pricing when it was first priced (branch price for the location included). */
export type LinePricingSnapshot = ProductPricing & { minHours: number | null };

/** Copied from Settings when the order is created. */
export type OrderPricingRules = {
  formula: PricingFormula;
  depositPercent: number;
  /** The depot's travel rules when the order was created. */
  travel: (TravelFeeRules & { depotId: string }) | null;
};

export type PricingLocks = {
  rules: OrderPricingRules;
  tax: { locationId: string; customerId: string; percent: number } | null;
  travel: { miles: number | null; dropoff: boolean; depotId: string | null; cents: number; info: Record<string, unknown> | null } | null;
  lines: Record<string, { productId: string | null; serviceMode: ServiceMode; setupSurface: string | null; setupSurfaceFeeCents: number; pricing: LinePricingSnapshot | null }>;
};

/** Orders made before rules were kept on the order were priced with the default formula. */
export const legacyPricingRules = (depositPercent: number): OrderPricingRules => ({ formula: DEFAULT_PRICING_FORMULA, depositPercent, travel: null });

/** The order keeps its tax rate while its location and customer stay the same. */
export function lockedTaxPercent(locks: PricingLocks | null, locationId: string, customerId: string): number | null {
  const t = locks?.tax;
  return t && t.locationId === locationId && t.customerId === customerId ? t.percent : null;
}

/** The order keeps its travel fee while the miles, the depot and drop-off stay the same. */
export function lockedTravel(locks: PricingLocks | null, miles: number | null, modes: ServiceMode[], depotId: string | null) {
  const t = locks?.travel;
  if (!t) return null;
  const same = (t.miles ?? null) === (miles ?? null) && t.dropoff === modes.includes('dropoff') && (t.depotId ?? null) === (depotId ?? null);
  return same ? t : null;
}

/** Travel rules for a depot: the order's own while it is the same depot, else today's. */
export function travelRulesFor(locks: PricingLocks | null, depotId: string, today: TravelFeeRules): TravelFeeRules {
  const own = locks?.rules.travel;
  return own && own.depotId === depotId ? own : today;
}

/** A line keeps its product pricing and surface fee while it is the same line, product and mode. */
export function lockedLine(locks: PricingLocks | null, lineId: string | null | undefined, productId: string | null, mode: ServiceMode, surface: string | null) {
  const l = lineId ? locks?.lines[lineId] : undefined;
  if (!l || l.productId !== productId || l.serviceMode !== mode) return { pricing: null, surfaceFeeCents: null };
  return { pricing: l.pricing, surfaceFeeCents: (l.setupSurface ?? null) === (surface ?? null) ? l.setupSurfaceFeeCents : null };
}
