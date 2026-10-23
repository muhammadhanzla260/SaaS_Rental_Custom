/**
 * Rental pricing, ported from the FreedomFun Odoo build so totals match to the cent:
 *   - line price:  pos_view.js getItemPrice (Python port: sales_bot_actions._package_duration_price)
 *   - order total: sale_order.py _compute_amounts / _get_rental_order_summary
 *   - deposit:     sale_order.py _get_rental_deposit_due
 * All money is integer cents. Odoo rounds to the cent half-up at the same points,
 * which `roundCents` reproduces.
 */

export type ServiceMode = 'staffed' | 'pickup' | 'dropoff';

/** Half-up rounding to a whole cent (Odoo float_round / currency.round). */
export function roundCents(x: number): number {
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + 1e-9);
}

// --- duration -------------------------------------------------------------------------

/**
 * Billable hours for an event. Same-day slots bill at least 1 hour, and an end
 * time before the start means the event runs past midnight (getDurationHours).
 * Multi-day ranges bill real elapsed time (getDurationHoursRange).
 */
export function billableHours(start: Date, end: Date, multiDay: boolean): number {
  let ms = end.getTime() - start.getTime();
  if (multiDay) return Math.max(1 / 60, ms / 3_600_000);
  if (ms <= 0) ms += 24 * 3_600_000;
  return Math.max(1, ms / 3_600_000);
}

// --- line price -------------------------------------------------------------------------

export type ProductPricing = {
  priceStaffedCents: number;
  pricePickupCents: number | null;
  priceDropoffCents: number | null;
  /** Hours included in the base price (Odoo base_hrs). Null: 1 hour. */
  baseHours: number | null;
  /** Extra-hour rate (Odoo per_hour_rate). Null or 0: the 15-minute block ladder. */
  hourlyRateCents: number | null;
  /** Overtime ladder when there is no hourly rate (Odoo: $25 per 15 minutes). */
  overtimeBlockMinutes: number;
  overtimeBlockCents: number;
};

export function basePackageCents(p: ProductPricing, mode: ServiceMode): number {
  if (mode === 'pickup') return p.pricePickupCents ?? 0;
  if (mode === 'dropoff') return p.priceDropoffCents ?? 0;
  return p.priceStaffedCents;
}

/** Charge for started overtime blocks beyond `freeHours` (Odoo _extra_time_charge). */
export function overtimeBlocksCents(hours: number, freeHours: number, blockMinutes: number, blockCents: number): number {
  if (!hours || hours <= 0) return 0;
  const perHour = 60 / blockMinutes;
  const freeBlocks = Math.floor(freeHours * perHour + 0.5); // JS Math.round
  const totalBlocks = Math.ceil(Number((hours * 60).toFixed(6)) / blockMinutes);
  return Math.max(0, totalBlocks - freeBlocks) * blockCents;
}

export type LinePriceTrace = {
  baseCents: number;
  hours: number;
  includedHours: number;
  extraCents: number;
  method: 'flat' | 'included' | 'hourly' | 'blocks';
};

/** Unit price for one rental for `hours` (Odoo _package_duration_price). */
export function packageDurationCents(p: ProductPricing, hours: number, baseCents: number): { cents: number; trace: LinePriceTrace } {
  const h = hours > 0 ? Math.max(1 / 60, hours) : 0;
  const rate = p.hourlyRateCents && p.hourlyRateCents > 0 ? p.hourlyRateCents : 0;
  const baseHrs = p.baseHours && p.baseHours > 0 ? p.baseHours : 0;
  const trace = (extraCents: number, method: LinePriceTrace['method'], includedHours: number) => ({
    cents: baseCents + extraCents,
    trace: { baseCents, hours: h, includedHours, extraCents, method },
  });
  if (h <= 0) return trace(0, 'included', baseHrs || 1);
  if (baseHrs > 0) {
    const excess = Math.max(0, h - baseHrs);
    if (excess === 0) return trace(0, 'included', baseHrs);
    if (rate > 0) return trace(Math.floor(excess * rate + 0.5), 'hourly', baseHrs);
    return trace(overtimeBlocksCents(h, baseHrs, p.overtimeBlockMinutes, p.overtimeBlockCents), 'blocks', baseHrs);
  }
  if (rate > 0) return trace(Math.max(0, Math.ceil(Number(h.toFixed(6))) - 1) * rate, 'hourly', 1);
  return trace(overtimeBlocksCents(h, 1, p.overtimeBlockMinutes, p.overtimeBlockCents), 'blocks', 1);
}

export function linePrice(p: ProductPricing, mode: ServiceMode, hours: number, opts: { flatRate?: boolean; overrideUnitCents?: number | null } = {}) {
  const baseCents = basePackageCents(p, mode);
  const auto = opts.flatRate
    ? { cents: baseCents, trace: { baseCents, hours, includedHours: 0, extraCents: 0, method: 'flat' as const } }
    : packageDurationCents(p, hours, baseCents);
  const overridden = opts.overrideUnitCents != null && opts.overrideUnitCents >= 0;
  return { unitCents: overridden ? opts.overrideUnitCents! : auto.cents, autoUnitCents: auto.cents, overridden, trace: auto.trace };
}

// --- order summary ------------------------------------------------------------------------

export type SummaryLine = { unitCents: number; quantity: number; setupSurfaceFeeCents?: number };

export type SummaryInput = {
  lines: SummaryLine[];
  damageWaiver: { enabled: boolean; percent: number };
  travelFeeCents: number;
  miscFeesCents: number;
  /** Fixed per-order fee (Odoo: event location $20). */
  eventLocationFeeCents?: number;
  /** General discount. Percent applies to merchandise only. After-tax = raincheck style. */
  discount?: { kind: 'percent' | 'amount'; value: number; afterTax?: boolean } | null;
  couponCents?: number;
  taxPercent: number;
  /** Store credit (Odoo wallet), applied last and capped at the total. */
  creditCents?: number;
  deposit?: { kind: 'percent' | 'amount'; value: number } | null;
  defaultDepositPercent?: number;
};

export type OrderSummary = {
  merchandiseCents: number;
  damageWaiverCents: number;
  setupSurfaceCents: number;
  eventLocationCents: number;
  travelFeeCents: number;
  miscFeesCents: number;
  extrasCents: number;
  preTaxDiscountCents: number;
  couponCents: number;
  taxableBaseCents: number;
  taxCents: number;
  postTaxDiscountCents: number;
  creditCents: number;
  totalCents: number;
  depositCents: number;
  depositPercent: number;
};

export function orderSummary(input: SummaryInput): OrderSummary {
  // Merchandise: each line's subtotal rounded to the cent (Odoo price_subtotal).
  const merch = input.lines.reduce((sum, l) => sum + roundCents(l.unitCents * l.quantity), 0);
  const setup = input.lines.reduce((sum, l) => sum + (l.setupSurfaceFeeCents ?? 0), 0);
  // Damage waiver: % of merchandise BEFORE any discount or coupon.
  const waiver = input.damageWaiver.enabled ? roundCents((merch * input.damageWaiver.percent) / 100) : 0;
  const eventLocation = input.eventLocationFeeCents ?? 0;
  const extras = input.travelFeeCents + input.miscFeesCents + waiver + eventLocation + setup;
  const coupon = Math.max(0, input.couponCents ?? 0);
  const pct = input.taxPercent || 0;
  const taxOn = (base: number) => (pct ? roundCents((Math.max(0, base) * pct) / 100) : 0);

  // General discount (Odoo _get_discount_amount): % of merchandise, or $ capped.
  let discount = 0;
  const d = input.discount;
  if (d && d.value > 0) {
    if (d.kind === 'percent') {
      discount = roundCents((merch * d.value) / 100);
    } else {
      const valueCents = roundCents(d.value * 100);
      const cap = d.afterTax
        ? Math.max(0, merch + extras + taxOn(merch + extras - coupon) - coupon) // _get_undiscounted_grand_total_for_cap
        : Math.max(0, merch + extras - coupon); // _get_pre_tax_discount_cap
      discount = Math.min(valueCents, cap);
    }
  }
  const preTax = d?.afterTax ? 0 : discount;
  const postTax = d?.afterTax ? discount : 0;

  // One-pass tax on (merchandise + extras - pre-tax reductions), like the POS.
  const taxableBase = Math.max(0, merch + extras - preTax - coupon);
  const tax = taxOn(taxableBase);
  const beforeCredit = merch + tax + extras - preTax - coupon - postTax;
  const credit = Math.min(Math.max(0, input.creditCents ?? 0), Math.max(0, beforeCredit));
  const total = beforeCredit - credit;

  const { depositCents, depositPercent } = depositDue(total, input.deposit, input.defaultDepositPercent ?? 30);
  return {
    merchandiseCents: merch,
    damageWaiverCents: waiver,
    setupSurfaceCents: setup,
    eventLocationCents: eventLocation,
    travelFeeCents: input.travelFeeCents,
    miscFeesCents: input.miscFeesCents,
    extrasCents: extras,
    preTaxDiscountCents: preTax,
    couponCents: coupon,
    taxableBaseCents: taxableBase,
    taxCents: tax,
    postTaxDiscountCents: postTax,
    creditCents: credit,
    totalCents: total,
    depositCents,
    depositPercent,
  };
}

/** Odoo _get_rental_deposit_due: override % or $ (capped at the total), else the default %. */
export function depositDue(totalCents: number, deposit: SummaryInput['deposit'], defaultPercent = 30) {
  if (totalCents <= 1) return { depositCents: 0, depositPercent: 0 };
  if (deposit && deposit.value > 0.01) {
    if (deposit.kind === 'amount') {
      const cents = Math.min(roundCents(deposit.value * 100), totalCents);
      return { depositCents: cents, depositPercent: Math.round((cents / totalCents) * 1000) / 10 };
    }
    return { depositCents: roundCents((totalCents * deposit.value) / 100), depositPercent: deposit.value };
  }
  return { depositCents: roundCents((totalCents * defaultPercent) / 100), depositPercent: defaultPercent };
}

/** Odoo's fixed setup surfaces; tenants can change the list. */
export const DEFAULT_SETUP_SURFACES = [
  { code: 'grass', label: 'Grass', feeCents: 0 },
  { code: 'dirt', label: 'Dirt', feeCents: 0 },
  { code: 'indoor', label: 'Indoor', feeCents: 0 },
  { code: 'concrete_no_charge', label: 'Concrete (no charge)', feeCents: 0 },
  { code: 'asphalt', label: 'Asphalt', feeCents: 3500 },
  { code: 'concrete', label: 'Concrete', feeCents: 3500 },
  { code: 'turf', label: 'Turf', feeCents: 3500 },
  { code: 'drive_in_asphalt', label: 'Drive-in movie asphalt', feeCents: 10000 },
] as const;

export function formatMoney(cents: number, currency: string, locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

// --- whole order ----------------------------------------------------------------------------

export type QuoteLineInput = {
  productId: string;
  name: string;
  pricing: ProductPricing;
  minHours: number | null;
  serviceMode: ServiceMode;
  quantity: number;
  flatRate: boolean;
  overrideUnitCents: number | null;
  setupSurfaceFeeCents: number;
};

export type QuoteInput = Omit<SummaryInput, 'lines'> & {
  startsAt: Date;
  endsAt: Date;
  multiDay: boolean;
  lines: QuoteLineInput[];
};

export type QuotedLine = QuoteLineInput & {
  unitCents: number;
  autoUnitCents: number;
  overridden: boolean;
  lineTotalCents: number;
  trace: LinePriceTrace;
  warnings: string[];
};

/**
 * Price every line for the event's duration and total the order. Used by the
 * order builder (live) and by the server (authoritative), so both always agree.
 */
export function quoteOrder(input: QuoteInput) {
  const hours = billableHours(input.startsAt, input.endsAt, input.multiDay);
  const lines: QuotedLine[] = input.lines.map((l) => {
    const p = linePrice(l.pricing, l.serviceMode, hours, { flatRate: l.flatRate, overrideUnitCents: l.overrideUnitCents });
    const warnings: string[] = [];
    if (basePackageCents(l.pricing, l.serviceMode) <= 0 && !p.overridden) {
      warnings.push(`${l.name} has no ${l.serviceMode === 'pickup' ? 'pick-up' : l.serviceMode === 'dropoff' ? 'drop-off' : 'staffed'} price. Enter a price.`);
    }
    if (l.minHours && hours + 1e-6 < l.minHours) warnings.push(`${l.name} has a minimum booking of ${l.minHours} hours.`);
    return { ...l, unitCents: p.unitCents, autoUnitCents: p.autoUnitCents, overridden: p.overridden, lineTotalCents: roundCents(p.unitCents * l.quantity), trace: p.trace, warnings };
  });
  const summary = orderSummary({ ...input, lines: lines.map((l) => ({ unitCents: l.unitCents, quantity: l.quantity, setupSurfaceFeeCents: l.setupSurfaceFeeCents })) });
  return { hours, lines, summary, warnings: lines.flatMap((l) => l.warnings) };
}
