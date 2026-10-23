/**
 * Read-only: show the money inputs of specific Odoo orders (amounts only, no
 * customer data) to explain parity differences.
 *   pnpm exec tsx scripts/odoo-parity-inspect.ts "#17815" "#17814"
 */
import { config } from 'dotenv';

config({ path: process.env.ODOO_ENV_FILE ?? 'C:/Users/Muhammad Hanzla/freedomfun_ops/.env', quiet: true });
const { STAG_URL: url, STAG_DB: db, STAG_USER: user, STAG_KEY: key } = process.env;

async function rpc(service: string, method: string, args: unknown[]) {
  const res = await fetch(`${url}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
  });
  const j = (await res.json()) as { result?: unknown; error?: { data?: { message?: string } } };
  if (j.error) throw new Error(j.error.data?.message ?? 'RPC error');
  return j.result;
}

const uid = (await rpc('common', 'authenticate', [db, user, key, {}])) as number;
const read = (model: string, domain: unknown[], fields: string[]) =>
  rpc('object', 'execute_kw', [db, uid, key, model, 'search_read', [domain], { fields }]) as Promise<Record<string, unknown>[]>;

for (const name of process.argv.slice(2)) {
  const [o] = await read('sale.order', [['name', '=', name]], [
    'name', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'damage_waiver', 'override_travel_fee', 'miscellaneous_fees', 'event_location',
    'general_discount', 'general_discount_type', 'general_discount_after_tax', 'coupon_discount', 'override_tax_amount', 'override_tax_manually_set',
    'wallet_applied_amount', 'write_date', 'create_date',
  ]);
  if (!o) { console.log(name, 'not found'); continue; }
  const lines = await read('sale.order.line', [['order_id.name', '=', name]], [
    'display_type', 'price_unit', 'product_uom_qty', 'price_subtotal', 'price_tax', 'discount', 'is_tip', 'rental_extra_type', 'is_downpayment', 'setup_surface', 'setup_surface_fee', 'is_rental', 'write_date',
  ]);
  console.log('\n===', JSON.stringify(o));
  for (const l of lines) console.log('   ', JSON.stringify(l));
}
