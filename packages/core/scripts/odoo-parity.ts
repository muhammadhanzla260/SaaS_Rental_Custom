/**
 * Parity check against the FreedomFun Odoo build (read-only).
 *
 * Reads recent rental orders over JSON-RPC (search_read only), feeds Odoo's own
 * stored inputs into our pricing engine, and compares:
 *   1. order totals   vs sale.order.amount_total     (sale_order.py _compute_amounts)
 *   2. line prices    vs sale.order.line.price_unit  (pos_view.js getItemPrice)
 * Prints order numbers and amounts only; no customer data.
 *
 * Orders whose discount line was written between 2026-09-12 and 2026-09-18 are
 * also checked against the rule Odoo shipped in that window (custom_rental
 * commits 30c89c6 → 2871b93): % discount on merchandise + extras, and $
 * discounts always after tax. Odoo keeps those stored totals as they were.
 *
 *   ODOO_ENV_FILE=C:/path/to/.env pnpm exec tsx packages/core/scripts/odoo-parity.ts [limit]
 * The env file needs STAG_URL, STAG_DB, STAG_USER, STAG_KEY (an API key).
 */
import { config } from 'dotenv';
import { linePrice, orderSummary, roundCents, type ProductPricing } from '../src/pricing';

config({ path: process.env.ODOO_ENV_FILE ?? 'C:/Users/Muhammad Hanzla/freedomfun_ops/.env', quiet: true });
const { STAG_URL: url, STAG_DB: dbName, STAG_USER: user, STAG_KEY: key } = process.env;
if (!url || !dbName || !user || !key) throw new Error('Missing STAG_URL / STAG_DB / STAG_USER / STAG_KEY.');
const LIMIT = Number(process.argv[2] ?? 150);

let uid = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  const res = await fetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { data?: { message?: string }; message?: string } };
  if (json.error) throw new Error(json.error.data?.message ?? json.error.message ?? 'RPC error');
  return json.result;
}
// Only read methods are ever called.
const READ_ONLY = new Set(['search_read', 'read', 'fields_get']);
async function call<T>(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}): Promise<T> {
  if (!READ_ONLY.has(method)) throw new Error(`Refusing non-read method ${method}`);
  return (await rpc('object', 'execute_kw', [dbName, uid, key, model, method, args, kwargs])) as T;
}

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const cents = (x: unknown) => roundCents(Number(x || 0) * 100);
const m2oId = (v: unknown) => (Array.isArray(v) ? (v[0] as number) : null);
const hoursBetween = (a: string, b: string) => (Date.parse(`${b.replace(' ', 'T')}Z`) - Date.parse(`${a.replace(' ', 'T')}Z`)) / 3_600_000;

async function main() {
  uid = (await rpc('common', 'authenticate', [dbName, user, key, {}])) as number;
  if (!uid) throw new Error('Login failed (check the API key).');

  const orderFieldsWanted = [
    'name', 'state', 'company_id', 'amount_total', 'damage_waiver', 'override_travel_fee', 'miscellaneous_fees', 'event_location',
    'general_discount', 'general_discount_type', 'general_discount_after_tax', 'coupon_discount', 'override_tax_amount',
    'override_tax_manually_set', 'wallet_applied_amount', 'order_line',
  ];
  const available = Object.keys(await call<Obj>('sale.order', 'fields_get', [], { attributes: ['type'] }));
  const orderFields = orderFieldsWanted.filter((f) => available.includes(f));
  const orders = await call<Obj[]>('sale.order', 'search_read', [[['is_rental_order', '=', true], ['state', 'in', ['draft', 'sent', 'sale', 'done']], ['amount_total', '>', 0]]], {
    fields: orderFields, limit: LIMIT, order: 'id desc',
  });

  const lineFieldsWanted = [
    'order_id', 'product_id', 'display_type', 'price_unit', 'product_uom_qty', 'price_subtotal', 'price_tax', 'is_tip', 'rental_extra_type',
    'is_downpayment', 'setup_surface_fee', 'start_date', 'return_date', 'rental_pos_base_price', 'rental_pos_per_hour_rate',
    'rental_pos_hourly_override', 'rental_pos_flat_rate', 'rental_pos_price_type', 'is_rental', 'write_date',
  ];
  const lineAvail = Object.keys(await call<Obj>('sale.order.line', 'fields_get', [], { attributes: ['type'] }));
  const lines = await call<Obj[]>('sale.order.line', 'search_read', [[['order_id', 'in', orders.map((o) => o.id)]]], {
    fields: lineFieldsWanted.filter((f) => lineAvail.includes(f)),
  });

  // Product templates (prices, included hours, hourly rate).
  const productIds = [...new Set(lines.map((l) => m2oId(l.product_id)).filter(Boolean))] as number[];
  const variants = productIds.length ? await call<Obj[]>('product.product', 'read', [productIds], { fields: ['product_tmpl_id'] }) : [];
  const tmplIds = [...new Set(variants.map((v) => m2oId(v.product_tmpl_id)))] as number[];
  const tmpls = tmplIds.length ? await call<Obj[]>('product.template', 'read', [tmplIds], { fields: ['base_hrs', 'per_hour_rate'] }) : [];
  const tmplByProduct = new Map(variants.map((v) => [v.id as number, tmpls.find((t) => t.id === m2oId(v.product_tmpl_id))]));

  // Company default sales tax (Odoo _get_company_default_sales_tax).
  const companyIds = [...new Set(orders.map((o) => m2oId(o.company_id)).filter(Boolean))] as number[];
  const companies = companyIds.length ? await call<Obj[]>('res.company', 'read', [companyIds], { fields: ['account_sale_tax_id'] }) : [];
  const taxIds = companies.map((c) => m2oId(c.account_sale_tax_id)).filter(Boolean) as number[];
  const taxes = taxIds.length ? await call<Obj[]>('account.tax', 'read', [taxIds], { fields: ['amount'] }) : [];
  const companyTax = new Map(companies.map((c) => [c.id as number, Number(taxes.find((t) => t.id === m2oId(c.account_sale_tax_id))?.amount ?? 0)]));

  let totalsChecked = 0, totalsMatched = 0, legacyMatched = 0;
  const legacy: string[] = [];
  const totalMismatches: string[] = [];
  let linesChecked = 0, linesMatched = 0;
  const lineMismatches: string[] = [];

  for (const o of orders) {
    const ol = lines.filter((l) => m2oId(l.order_id) === o.id && !l.display_type);
    const merch = ol.filter((l) => l.product_id && !l.is_tip && !l.rental_extra_type && !l.is_downpayment);
    // Effective tax % (Odoo _get_effective_sales_tax_percent).
    const merchCents = merch.reduce((s, l) => s + cents(l.price_subtotal), 0);
    let taxPercent = 0;
    if (o.override_tax_manually_set) taxPercent = Number(o.override_tax_amount || 0);
    else if (companyTax.get(m2oId(o.company_id)!) ) taxPercent = companyTax.get(m2oId(o.company_id)!)!;
    else {
      const lineTax = merch.reduce((s, l) => s + Number(l.price_tax || 0), 0);
      taxPercent = merchCents ? (lineTax * 100 * 100) / merchCents : 0;
    }
    const input = {
      lines: [
        ...merch.map((l) => ({ unitCents: cents(l.price_subtotal), quantity: 1 })),
        { unitCents: 0, quantity: 1, setupSurfaceFeeCents: ol.reduce((sum, l) => sum + cents(l.setup_surface_fee), 0) },
      ],
      damageWaiver: { enabled: o.damage_waiver === 'yes', percent: 10 },
      travelFeeCents: cents(o.override_travel_fee),
      miscFeesCents: cents(o.miscellaneous_fees),
      eventLocationFeeCents: o.event_location === 'yes_20' ? 2000 : 0,
      discount: Number(o.general_discount) > 0
        ? { kind: o.general_discount_type === 'amount' ? 'amount' : 'percent', value: Number(o.general_discount), afterTax: !!o.general_discount_after_tax }
        : null,
      couponCents: cents(o.coupon_discount),
      taxPercent,
      creditCents: cents(o.wallet_applied_amount),
    } satisfies Parameters<typeof orderSummary>[0];
    const s = orderSummary(input);
    totalsChecked++;
    const odoo = cents(o.amount_total);
    // Discount line written while the 12–18 Sep 2026 rule was live?
    const discLine = ol.find((l) => l.rental_extra_type === 'discount' || l.rental_extra_type === 'post_tax_discount');
    const inLegacyWindow = !!discLine && discLine.write_date >= '2026-09-12' && discLine.write_date < '2026-09-18';
    if (s.totalCents === odoo) totalsMatched++;
    else if (inLegacyWindow && input.discount && legacyTotal(input) === odoo) {
      legacyMatched++;
      legacy.push(`${o.name}: Odoo ${(odoo / 100).toFixed(2)} (discount written ${String(discLine.write_date).slice(0, 10)}); today's rule gives ${(s.totalCents / 100).toFixed(2)}`);
    } else totalMismatches.push(`${o.name} (${o.state}): Odoo ${(odoo / 100).toFixed(2)} vs ours ${(s.totalCents / 100).toFixed(2)} (diff ${((s.totalCents - odoo) / 100).toFixed(2)}, tax ${taxPercent}%)`);

    // Line prices from the POS formula.
    for (const l of merch) {
      if (!l.start_date || !l.return_date || !l.rental_pos_price_type || !l.is_rental) continue;
      const tmpl = tmplByProduct.get(m2oId(l.product_id)!);
      if (!tmpl) continue;
      const diff = hoursBetween(l.start_date, l.return_date);
      const multiDay = diff > 24;
      const hours = multiDay ? Math.max(1 / 60, diff) : Math.max(1, diff);
      const rateDollars = l.rental_pos_hourly_override ? Number(l.rental_pos_per_hour_rate || 0) : Number(tmpl.per_hour_rate || 0);
      const base = cents(l.rental_pos_base_price);
      const pricing: ProductPricing = {
        priceStaffedCents: base, pricePickupCents: base, priceDropoffCents: base,
        baseHours: Number(tmpl.base_hrs || 0) || null, hourlyRateCents: rateDollars > 0 ? cents(rateDollars) : null,
        overtimeBlockMinutes: 15, overtimeBlockCents: 2500,
      };
      const ours = linePrice(pricing, 'staffed', hours, { flatRate: !!l.rental_pos_flat_rate }).unitCents;
      linesChecked++;
      if (ours === cents(l.price_unit)) linesMatched++;
      else lineMismatches.push(`${o.name}: ${hours.toFixed(2)} h, Odoo ${Number(l.price_unit).toFixed(2)} vs ours ${(ours / 100).toFixed(2)}`);
    }
  }

  console.log(`Orders read: ${orders.length} (most recent rental orders on staging)`);
  console.log(`Order totals: ${totalsMatched}/${totalsChecked} match to the cent under Odoo's current rules`);
  if (legacyMatched) console.log(`              ${legacyMatched} more match to the cent under the 12–18 Sep 2026 discount rule they were saved with`);
  console.log(`              ${totalMismatches.length} unexplained`);
  console.log(`Line prices:  ${linesMatched}/${linesChecked} match to the cent`);
  if (legacy.length) console.log(`\nSaved under the 12–18 Sep 2026 rule:\n  ${legacy.join('\n  ')}`);
  if (totalMismatches.length) console.log(`\nTotal differences (first 15):\n  ${totalMismatches.slice(0, 15).join('\n  ')}`);
  // Odoo has no "manual price" flag: on reload the POS treats a saved price that
  // does not fit the formula as a staff override (pos_view.js _restoreCartBaseFromLoadedUnit).
  // Migration imports these lines with priceOverridden = true.
  if (lineMismatches.length) console.log(`\nStaff-set line prices (Odoo keeps these as overrides; first 15):\n  ${lineMismatches.slice(0, 15).join('\n  ')}`);
}

/** Odoo 2026-09-12…18: % discount on merchandise + extras (pre-tax); $ discount after tax. */
function legacyTotal(input: Parameters<typeof orderSummary>[0]): number {
  const d = input.discount!;
  if (d.kind === 'amount') return orderSummary({ ...input, discount: { ...d, afterTax: true } }).totalCents;
  const plain = orderSummary({ ...input, discount: null });
  const base = plain.merchandiseCents + plain.extrasCents;
  return orderSummary({ ...input, discount: { kind: 'amount', value: roundCents((base * d.value) / 100) / 100, afterTax: false } }).totalCents;
}

main().catch((e) => {
  console.error('Parity check failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
