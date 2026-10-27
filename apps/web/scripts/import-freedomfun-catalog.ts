/**
 * Freedom Fun USA's real catalog on the demo workspace (local or staging only):
 * the products, prices, photos and add-ons from freedomfunusa.com, by category.
 *   pnpm --filter @rental/db exec tsx ../../apps/web/scripts/import-freedomfun-catalog.ts
 * Safe to run again: products are matched by name and updated. Demo products
 * that are not on the website are archived (orders that used them keep them).
 * Stock is not on the website: each item starts with 2 at every location.
 */
import { config } from 'dotenv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { productSchema } from '@rental/core';
import {
  createCategory, createDb, createProduct, deleteCategory, listCategories, listProducts, saveImage, setProductStatus, updateProduct,
} from '@rental/db';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
if (process.env.NODE_ENV === 'production' || (/neon\.tech/.test(process.env.DATABASE_URL_OWNER ?? '') && !process.env.ALLOW_DEMO_SEED)) {
  throw new Error('The demo catalog import is for local or staging databases only.');
}

type Scraped = {
  products: {
    name: string; category: string; categorySlug: string; params: string[]; prices: Partial<Record<'staffed' | 'dropoff' | 'pickup', number>>;
    units: Record<string, string>; baseHours: number | null; overtime: [number, number] | null; description: string; includes: string[];
    images: string[]; customPricing: boolean;
  }[];
  addons: { name: string; price: number | null; unit: string; image: string | null; seenIn: string[] }[];
};
const data: Scraped = JSON.parse(readFileSync(resolve(import.meta.dirname, 'data/freedomfun-catalog.json'), 'utf8'));

const { db, client: app } = createDb(process.env.DATABASE_URL!, { max: 2 });
const { client: owner } = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
const [t] = await owner<{ id: string }[]>`select id from tenants where slug = 'freedom-fun-demo'`;
const [jordan] = await owner<{ id: string }[]>`select id from users where email = 'jordan@demo.tentpole.test'`;
if (!t || !jordan) throw new Error('Run pnpm seed:demo first.');
const actor = { type: 'user' as const, userId: jordan.id };
const locations = await owner<{ id: string }[]>`select id from locations where tenant_id = ${t.id} and is_active`;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sku = (prefix: string, name: string) => `${prefix}-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`.slice(0, 40);
const stock = (owned: number) => Object.fromEntries(locations.map((l) => [l.id, { owned }]));
const ICON: Record<string, string> = {
  'bounce-house-and-combos': 'bounce', 'water-fun': 'slide', 'outdoor-movie-screen': 'screen', 'led-screen-rentals': 'screen', 'projector-screen-rentals': 'screen',
  concessions: 'food', 'yard-games': 'game', 'archery-games': 'game', 'mobile-laser-tag': 'game', 'nerf-wars': 'game', 'virtual-reality': 'game',
  'extreme-games': 'game', 'inflatable-interactives': 'bounce', 'obstacle-courses': 'bounce',
};
/** Add-ons that are the same thing as a product on its own page. */
const SAME_AS: Record<string, string> = {
  slipnslide: 'freedomslipnslide', cottoncandy: 'cottoncandymachine', bouncehouse: 'freedombouncehouse', projectoscreen: '16projectoscreen',
};

/** The first photo the app accepts (PNG, JPG or WebP, 4 MB or less). */
async function photo(urls: (string | null)[], name: string) {
  for (const url of urls) {
    if (!url || /\.avif($|\?)/i.test(url)) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim()
        || (/\.png/i.test(url) ? 'image/png' : /\.webp/i.test(url) ? 'image/webp' : 'image/jpeg');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 4 * 1024 * 1024) continue;
      return await saveImage(db, t!.id, jordan!.id, { bytes, mime, filename: `${key(name)}.${mime.split('/')[1]}` }, 'product_image');
    } catch {
      // try the next photo
    }
  }
  return null;
}

// --- categories (only ones with something in them; add-ons get their own) ---
const wanted = [...new Set(data.products.map((p) => p.category)), 'Add-ons & Extras'];
const cats = new Map((await listCategories(db, t.id)).map((c) => [c.name, c.id]));
for (const name of wanted) if (!cats.has(name)) cats.set(name, (await createCategory(db, t.id, actor, name)).id);

const existing = new Map((await listProducts(db, t.id, { includeArchived: true })).map((p) => [key(p.name), p]));
const kept = new Set<string>();
const report: string[] = [];

async function upsert(name: string, input: Record<string, unknown>, images: (string | null)[]) {
  const parsed = productSchema.parse({ name, ...input });
  const before = existing.get(key(name));
  const fileId = before?.imageFileId ? null : await photo(images, name);
  if (before) await updateProduct(db, t!.id, actor, before.id, parsed, fileId ? { fileId } : null);
  else await createProduct(db, t!.id, actor, parsed, fileId);
  kept.add(key(name));
}

for (const p of data.products) {
  const staffed = p.prices.staffed ?? 0;
  const ot = p.overtime;
  // Hours included: what the staffed price states, else the drop-off's, else a day for flat prices.
  const staffedHours = p.units.staffed ? p.baseHours : null;
  const baseHours = staffedHours ?? p.baseHours ?? (staffed > 0 ? 1 : 8);
  const description = [
    p.params.join(' · '),
    p.description,
    p.includes.length ? `Includes:\n${p.includes.map((i) => `- ${i}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 4000);
  await upsert(p.name, {
    kind: 'rental', categoryId: cats.get(p.category), sku: sku(p.categorySlug.slice(0, 3).toUpperCase(), p.name), description,
    status: p.customPricing ? 'draft' : 'active',
    priceStaffed: staffed, priceDropoff: p.prices.dropoff ?? null, pricePickup: p.prices.pickup ?? null, baseHours,
    ...(ot && ot[0] === 60 ? { hourlyRate: ot[1] } : ot ? { overtimeBlockMinutes: ot[0], overtimeBlockPrice: ot[1] } : {}),
    icon: ICON[p.categorySlug] ?? 'box', inventory: stock(2),
  }, p.images);
  report.push(`${p.customPricing ? 'draft ' : 'active'}  ${p.category} · ${p.name}`);
}

const productKeys = new Set(data.products.map((p) => key(p.name)));
for (const a of data.addons) {
  const k = key(a.name);
  if (productKeys.has(k) || productKeys.has(SAME_AS[k] ?? '') || [...productKeys].some((pk) => pk.endsWith(k) || k.endsWith(pk))) continue;
  const hourly = /hour/i.test(a.unit);
  const consumable = /serving|solution|extra|^\+/i.test(a.name);
  await upsert(a.name, {
    kind: hourly ? 'service' : 'addon', categoryId: cats.get('Add-ons & Extras'), sku: sku('ADD', a.name),
    description: `${a.unit}. Popular with: ${[...new Set(a.seenIn)].join(', ')}.`,
    status: a.price == null ? 'draft' : 'active',
    priceStaffed: a.price ?? 0, priceDropoff: a.price ?? null, baseHours: hourly ? 1 : 24, ...(hourly ? { hourlyRate: a.price } : {}),
    tracking: hourly || consumable ? 'none' : 'pooled', inventory: hourly || consumable ? {} : stock(2), icon: 'box',
  }, [a.image]);
  report.push(`${a.price == null ? 'draft ' : 'active'}  Add-ons & Extras · ${a.name}`);
}

// Demo products that Freedom Fun does not rent: archived, so the catalog matches the website.
let archived = 0;
for (const [k, p] of existing) {
  if (kept.has(k) || p.status === 'archived') continue;
  await setProductStatus(db, t.id, actor, p.id, 'archived');
  archived++;
}
// Demo categories left with nothing in them go (removing a category keeps its products).
const used = new Set((await listProducts(db, t.id)).filter((p) => p.status !== 'archived').map((p) => p.categoryId));
for (const [name, id] of cats) if (!used.has(id) && !wanted.includes(name)) await deleteCategory(db, t.id, actor, id);

console.log(report.join('\n'));
console.log(`\n${report.length} products and add-ons imported, ${archived} demo products archived.`);
await app.end();
await owner.end();
