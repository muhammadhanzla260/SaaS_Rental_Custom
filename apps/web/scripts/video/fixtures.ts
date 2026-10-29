/**
 * Off-camera helpers for the walkthrough video (Freedom Fun USA, Tim Masters):
 *   orders <customerEmail>     two ready-to-book orders for chapters 4 and 5
 *   email-invoice <orderId>    emails that order's invoice now (chapter 6)
 *   quote-url <orderId>        a fresh customer link for the quote (chapter 7)
 * Run from packages/db: pnpm exec tsx ../../apps/web/scripts/video/fixtures.ts …
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { orderSchema, parsePreferences, wallTimeToUtc } from '@rental/core';
import { createDb, createOrder, emailInvoice, ensureOrderToken, orderInvoices, quoteUrl, withTenant } from '@rental/db';
import { dispatchOrder } from '@rental/messaging';

config({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true });
const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
try {
  const [t] = await owner<{ id: string; settings: unknown }[]>`select id, settings from tenants where slug = 'freedom-fun-demo'`;
  const [tim] = await owner<{ id: string }[]>`select id from users where email = 'tim@demo.tentpole.test'`;
  if (!t || !tim) throw new Error('Freedom Fun USA and Tim Masters are needed (seed-video-user.ts).');
  const actor = { type: 'user' as const, userId: tim.id };
  const prefs = parsePreferences(t.settings);
  const [cmd, arg] = process.argv.slice(2);
  let out: unknown;

  if (cmd === 'orders') {
    const [c] = await owner<{ id: string; line1: string; city: string; region: string; postal_code: string; lat: number | null; lng: number | null; display_name: string; phone: string }[]>`
      select id, line1, city, region, postal_code, lat, lng, display_name, phone from customers where tenant_id = ${t.id} and email = ${arg!}`;
    if (!c) throw new Error(`No customer ${arg}`);
    const [aus] = await owner<{ id: string }[]>`select id from locations where tenant_id = ${t.id} and code = 'AUS'`;
    const picks = await owner<{ id: string; name: string }[]>`
      select p.id, p.name from products p where p.tenant_id = ${t.id} and p.status = 'active' and p.kind = 'rental' and p.price_staffed_cents between 15000 and 40000
        and exists (select 1 from inventory_pools ip where ip.tenant_id = p.tenant_id and ip.product_id = p.id and ip.location_id = ${aus!.id} and ip.quantity_owned - ip.out_of_service >= 2)
      order by p.name limit 4`;
    const make = async (date: string, productIds: string[]) => {
      const o = await createOrder(db, t.id, actor, orderSchema.parse({
        customerId: c.id, locationId: aus!.id, eventType: 'Birthday', salespersonUserId: tim.id,
        startsAt: wallTimeToUtc(date, '13:00', 'America/Chicago'), endsAt: wallTimeToUtc(date, '17:00', 'America/Chicago'),
        eventAddress: { line1: c.line1, city: c.city, region: c.region, postalCode: c.postal_code, country: 'US', lat: c.lat ?? undefined, lng: c.lng ?? undefined },
        eventContactName: c.display_name, eventContactMobile: c.phone, contactConfirmed: true,
        lines: productIds.map((productId) => ({ productId, quantity: 1, serviceMode: 'staffed' })),
      }), prefs);
      return { id: o.id, number: o.number };
    };
    out = { b: await make('2026-11-22', [picks[2]!.id]), c: await make('2026-11-28', [picks[3]!.id, picks[0]!.id]) };
  } else if (cmd === 'email-invoice') {
    const [inv] = await orderInvoices(db, t.id, arg!);
    if (!inv) throw new Error('That order has no invoice yet.');
    await emailInvoice(db, t.id, actor, inv.id);
    await dispatchOrder(db, t.id, arg!);
    out = { emailed: inv.number };
  } else if (cmd === 'quote-url') {
    out = { url: quoteUrl(await withTenant(db, t.id, (tx) => ensureOrderToken(tx, t.id, arg!))) };
  } else if (cmd === 'remove-order') {
    // A failed take: the order and everything hanging off it go, so re-takes leave no clutter.
    await owner.begin(async (tx) => {
      for (const tb of ['messages', 'refunds', 'payments', 'signatures', 'invoices', 'credit_applications', 'ops_snoozes', 'order_versions', 'order_lines', 'reservations']) {
        await tx`delete from ${tx(tb)} where tenant_id = ${t.id} and order_id = ${arg!}`;
      }
      await tx`delete from audit_log where tenant_id = ${t.id} and entity_id = ${arg!}`;
      await tx`delete from orders where tenant_id = ${t.id} and id = ${arg!}`;
    });
    out = { removed: arg };
  } else if (cmd === 'wipe-video') {
    // All takes start clean: the video customer and every order it has.
    const orders = await owner<{ id: string }[]>`select o.id from orders o join customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id where o.tenant_id = ${t.id} and c.email = ${arg!}`;
    await owner.begin(async (tx) => {
      for (const o of orders) {
        for (const tb of ['messages', 'refunds', 'payments', 'signatures', 'invoices', 'credit_applications', 'ops_snoozes', 'order_versions', 'order_lines', 'reservations']) {
          await tx`delete from ${tx(tb)} where tenant_id = ${t.id} and order_id = ${o.id}`;
        }
        await tx`delete from audit_log where tenant_id = ${t.id} and entity_id = ${o.id}`;
        await tx`delete from orders where tenant_id = ${t.id} and id = ${o.id}`;
      }
      const gone = await tx<{ id: string }[]>`delete from customers where tenant_id = ${t.id} and email = ${arg!} returning id`;
      for (const g of gone) {
        await tx`delete from payment_methods where tenant_id = ${t.id} and customer_id = ${g.id}`;
        await tx`delete from audit_log where tenant_id = ${t.id} and entity_id = ${g.id}`;
      }
    });
    out = { orders: orders.length };
  } else if (cmd === 'unsign') {
    // A re-take of the customer's quote page: sign it again from the start.
    const r = await owner`delete from signatures where tenant_id = ${t.id} and order_id = ${arg!} returning id`;
    out = { unsigned: r.length };
  } else if (cmd === 'forget-cards') {
    // Cards saved by an earlier take, so the video shows typing a new card.
    const r = await owner`delete from payment_methods pm using customers c where c.tenant_id = ${t.id} and c.email = ${arg!}
      and pm.tenant_id = c.tenant_id and pm.customer_id = c.id returning pm.id`;
    out = { forgotten: r.length };
  } else if (cmd === 'reset-customer') {
    // Re-recording chapter 1: the video customer goes, but only while it has no orders.
    const gone = await owner<{ id: string }[]>`delete from customers c where c.tenant_id = ${t.id} and c.email = ${arg!}
      and not exists (select 1 from orders o where o.tenant_id = c.tenant_id and o.customer_id = c.id) returning c.id`;
    for (const g of gone) await owner`delete from audit_log where tenant_id = ${t.id} and entity_id = ${g.id}`;
    out = { removed: gone.length };
  } else throw new Error('Use: orders <email> | email-invoice <orderId> | quote-url <orderId> | reset-customer <email>');
  console.log(JSON.stringify(out));
} finally {
  await app.end();
  await owner.end();
}
