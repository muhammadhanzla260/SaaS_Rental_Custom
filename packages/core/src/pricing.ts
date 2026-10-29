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
 * Multi-day ranges count real elapsed time (getDurationHoursRange); their lines
 * are priced at the package, not by the hour (see linePrice).
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

/** How additional time is charged: an hourly rate, or the overtime block ladder. */
export function extraRateOf(p: ProductPricing): { kind: 'hourly' | 'blocks'; cents: number; minutes: number } {
  return p.hourlyRateCents && p.hourlyRateCents > 0
    ? { kind: 'hourly', cents: p.hourlyRateCents, minutes: 60 }
    : { kind: 'blocks', cents: p.overtimeBlockCents, minutes: p.overtimeBlockMinutes };
}

/** The product's pricing with the order line's locked base package and additional-time rate on top. */
export function lockedPricing(p: ProductPricing, mode: ServiceMode, baseCents: number | null, rateCents: number | null): ProductPricing {
  const out = { ...p };
  if (baseCents != null) {
    if (mode === 'pickup') out.pricePickupCents = baseCents;
    else if (mode === 'dropoff') out.priceDropoffCents = baseCents;
    else out.priceStaffedCents = baseCents;
  }
  if (rateCents != null) {
    if (extraRateOf(p).kind === 'hourly') out.hourlyRateCents = rateCents;
    else out.overtimeBlockCents = rateCents;
  }
  return out;
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
  method: 'flat' | 'included' | 'hourly' | 'blocks' | 'custom';
  /** Priced as a multi-day rental: the package once, whatever the span. */
  multiDay?: boolean;
  /** Started overtime blocks or hours charged, and their size and price (for the "4 × 15 min × $25.00" label). */
  units?: number;
  unitMinutes?: number;
  unitCents?: number;
};

/** Unit price for one rental for `hours` (Odoo _package_duration_price). */
export function packageDurationCents(p: ProductPricing, hours: number, baseCents: number): { cents: number; trace: LinePriceTrace } {
  const h = hours > 0 ? Math.max(1 / 60, hours) : 0;
  const rate = p.hourlyRateCents && p.hourlyRateCents > 0 ? p.hourlyRateCents : 0;
  const baseHrs = p.baseHours && p.baseHours > 0 ? p.baseHours : 0;
  const trace = (extraCents: number, method: LinePriceTrace['method'], includedHours: number, extra: Partial<LinePriceTrace> = {}) => ({
    cents: baseCents + extraCents,
    trace: { baseCents, hours: h, includedHours, extraCents, method, ...extra },
  });
  const blocks = (included: number) => {
    const cents = overtimeBlocksCents(h, included, p.overtimeBlockMinutes, p.overtimeBlockCents);
    if (!cents) return trace(0, 'included', included);
    const units = p.overtimeBlockCents > 0 ? Math.round(cents / p.overtimeBlockCents) : 0;
    return trace(cents, 'blocks', included, { units, unitMinutes: p.overtimeBlockMinutes, unitCents: p.overtimeBlockCents });
  };
  if (h <= 0) return trace(0, 'included', baseHrs || 1);
  if (baseHrs > 0) {
    const excess = Math.max(0, h - baseHrs);
    if (excess === 0) return trace(0, 'included', baseHrs);
    if (rate > 0) return trace(Math.floor(excess * rate + 0.5), 'hourly', baseHrs, { unitMinutes: Math.round(excess * 60), unitCents: rate });
    return blocks(baseHrs);
  }
  if (rate > 0) {
    const started = Math.max(0, Math.ceil(Number(h.toFixed(6))) - 1);
    return started ? trace(started * rate, 'hourly', 1, { units: started, unitMinutes: 60, unitCents: rate }) : trace(0, 'included', 1);
  }
  return blocks(1);
}

/** Human price trace: "$225.00 incl. 4 h + 4 × 15 min × $25.00". `money` formats cents. */
export function describeTrace(t: LinePriceTrace, money: (cents: number) => string): string {
  const hrs = (h: number) => {
    const m = Math.round(h * 60);
    return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  };
  if (t.method === 'custom') return 'Custom line';
  if (t.method === 'flat') return t.multiDay ? `${money(t.baseCents)} package · multi-day rental, no extra time` : `${money(t.baseCents)} flat rate`;
  const head = `${money(t.baseCents)} incl. ${hrs(t.includedHours)}`;
  if (t.method === 'included' || !t.extraCents) return `${head} · within included time`;
  if (t.method === 'blocks') return `${head} + ${t.units} × ${t.unitMinutes} min × ${money(t.unitCents ?? 0)}`;
  if (t.units) return `${head} + ${t.units} started h × ${money(t.unitCents ?? 0)}`;
  return `${head} + ${hrs((t.unitMinutes ?? 0) / 60)} × ${money(t.unitCents ?? 0)}/h`;
}

export function linePrice(p: ProductPricing, mode: ServiceMode, hours: number, opts: { flatRate?: boolean; multiDay?: boolean; overrideUnitCents?: number | null } = {}) {
  const baseCents = basePackageCents(p, mode);
  // Multi-day rentals charge the package once (how FreedomFun's Odoo orders were billed): the
  // hourly ladder is for same-day events, and over days it would add hundreds of overtime blocks.
  const auto = opts.flatRate || opts.multiDay
    ? { cents: baseCents, trace: { baseCents, hours, includedHours: 0, extraCents: 0, method: 'flat' as const, ...(opts.multiDay ? { multiDay: true } : {}) } }
    : packageDurationCents(p, hours, baseCents);
  const overridden = opts.overrideUnitCents != null && opts.overrideUnitCents >= 0;
  return { unitCents: overridden ? opts.overrideUnitCents! : auto.cents, autoUnitCents: auto.cents, overridden, trace: auto.trace };
}

// --- order summary ------------------------------------------------------------------------

export type SummaryLine = {
  unitCents: number;
  quantity: number;
  setupSurfaceFeeCents?: number;
  /** Default true. A non-taxable line stays out of the taxable base. */
  taxable?: boolean;
  /** A custom line (no product): counted on its own, outside merchandise, waiver and discounts. */
  custom?: boolean;
};

/** A coupon's rule; the amount is worked out from merchandise and capped there. */
export type CouponRule = { kind: 'percent' | 'amount'; value: number };

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
  /** Coupon by rule (overrides couponCents): % of merchandise, or $ capped at merchandise. */
  coupon?: CouponRule | null;
  taxPercent: number;
  /** Store credit (Odoo wallet), applied last and capped at the total. */
  creditCents?: number;
  /** 'none' = no deposit to book (everything is due on event day). */
  deposit?: { kind: 'percent' | 'amount' | 'none'; value: number } | null;
  defaultDepositPercent?: number;
};

export type OrderSummary = {
  merchandiseCents: number;
  customCents: number;
  nonTaxableCents: number;
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
  const sub = (l: SummaryLine) => roundCents(l.unitCents * l.quantity);
  const items = input.lines.filter((l) => !l.custom);
  const customs = input.lines.filter((l) => l.custom);
  const merch = items.reduce((sum, l) => sum + sub(l), 0);
  const custom = customs.reduce((sum, l) => sum + sub(l), 0);
  const nonTaxable = input.lines.filter((l) => l.taxable === false).reduce((sum, l) => sum + sub(l), 0);
  const nonTaxableMerch = items.filter((l) => l.taxable === false).reduce((sum, l) => sum + sub(l), 0);
  const customTaxable = customs.filter((l) => l.taxable !== false).reduce((sum, l) => sum + sub(l), 0);
  const setup = items.reduce((sum, l) => sum + (l.setupSurfaceFeeCents ?? 0), 0);
  // Damage waiver: % of merchandise BEFORE any discount or coupon.
  const waiver = input.damageWaiver.enabled ? roundCents((merch * input.damageWaiver.percent) / 100) : 0;
  const eventLocation = input.eventLocationFeeCents ?? 0;
  const extras = input.travelFeeCents + input.miscFeesCents + waiver + eventLocation + setup;
  const coupon = input.coupon
    ? Math.min(
        merch,
        input.coupon.kind === 'percent'
          ? roundCents((merch * Math.max(0, input.coupon.value)) / 100)
          : roundCents(Math.max(0, input.coupon.value) * 100),
      )
    : Math.max(0, input.couponCents ?? 0);
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
  // Non-taxable lines stay out of the base; custom taxable lines join it.
  const taxableBase = Math.max(0, merch - nonTaxableMerch + customTaxable + extras - preTax - coupon);
  const tax = taxOn(taxableBase);
  const beforeCredit = Math.max(0, merch + custom + tax + extras - preTax - coupon - postTax);
  const credit = Math.min(Math.max(0, input.creditCents ?? 0), Math.max(0, beforeCredit));
  const total = beforeCredit - credit;

  const { depositCents, depositPercent } = depositDue(total, input.deposit, input.defaultDepositPercent ?? 30);
  return {
    merchandiseCents: merch,
    customCents: custom,
    nonTaxableCents: nonTaxable,
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
  if (totalCents <= 1 || deposit?.kind === 'none') return { depositCents: 0, depositPercent: 0 };
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
  /** Null for a custom line. */
  productId: string | null;
  name: string;
  /** Null for a custom line: its price is `overrideUnitCents`. */
  pricing: ProductPricing | null;
  minHours: number | null;
  serviceMode: ServiceMode;
  quantity: number;
  flatRate: boolean;
  overrideUnitCents: number | null;
  setupSurfaceFeeCents: number;
  taxable?: boolean;
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
    if (!l.pricing) {
      const unit = Math.max(0, l.overrideUnitCents ?? 0);
      const trace: LinePriceTrace = { baseCents: unit, hours, includedHours: 0, extraCents: 0, method: 'custom' };
      return { ...l, setupSurfaceFeeCents: 0, unitCents: unit, autoUnitCents: unit, overridden: false, lineTotalCents: roundCents(unit * l.quantity), trace, warnings: [] };
    }
    const p = linePrice(l.pricing, l.serviceMode, hours, { flatRate: l.flatRate, multiDay: input.multiDay, overrideUnitCents: l.overrideUnitCents });
    const warnings: string[] = [];
    if (basePackageCents(l.pricing, l.serviceMode) <= 0 && !p.overridden) {
      warnings.push(`${l.name} has no ${l.serviceMode === 'pickup' ? 'pick-up' : l.serviceMode === 'dropoff' ? 'drop-off' : 'staffed'} price. Enter a price.`);
    }
    if (l.minHours && hours + 1e-6 < l.minHours) warnings.push(`${l.name} has a minimum booking of ${l.minHours} hours.`);
    return { ...l, unitCents: p.unitCents, autoUnitCents: p.autoUnitCents, overridden: p.overridden, lineTotalCents: roundCents(p.unitCents * l.quantity), trace: p.trace, warnings };
  });
  const summary = orderSummary({
    ...input,
    lines: lines.map((l) => ({
      unitCents: l.unitCents, quantity: l.quantity, setupSurfaceFeeCents: l.setupSurfaceFeeCents, taxable: l.taxable, custom: !l.pricing,
    })),
  });
  return { hours, lines, summary, warnings: lines.flatMap((l) => l.warnings) };
}
