/**
 * Phase 1 browser QA on the seeded demo (pnpm seed:demo), as a real user would:
 * the design's acceptance tests through the UI, plus catalog, inventory and customers.
 *   node apps/web/scripts/e2e-phase1.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../../.screenshots/phase1-e2e');
mkdirSync(OUT, { recursive: true });
const S = '/freedom-fun-demo';
const PASSWORD = 'Tentpole-2026!';
const run = Date.now().toString(36).slice(-5);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000 });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
// Leaving a page with unsaved changes asks first; tests accept it.
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const text = () => page.evaluate(() => document.body.innerText);
// innerText follows text-transform (eyebrow labels are uppercase), so compare case-insensitively.
const hasText = async (t) => (await text()).toLowerCase().includes(t.toLowerCase());
const waitText = (t, timeout = 15000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x), { timeout }, t.toLowerCase());
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });

/** Click the first visible, enabled element whose text (or aria-label) contains `label`. */
async function click(label, selector = 'button, a, [role="radio"], [role="checkbox"]') {
  await page.waitForFunction(
    (l, s) => [...document.querySelectorAll(s)].some((e) => (e.innerText?.includes(l) || e.getAttribute('aria-label')?.includes(l)) && e.offsetParent && !e.disabled),
    { timeout: 15000 }, label, selector,
  );
  await page.evaluate((l, s) => {
    const el = [...document.querySelectorAll(s)].find((e) => (e.innerText?.includes(l) || e.getAttribute('aria-label')?.includes(l)) && e.offsetParent && !e.disabled);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, label, selector);
}
/** Set a React-controlled input (text, number, time, date or range). */
async function setValue(selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}
async function signIn(email) {
  await page.deleteCookie(...(await page.cookies()));
  await page.setViewport({ width: 1440, height: 1000 });
  await go('/sign-in');
  await page.type('#si-email', email);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#si-pass', { visible: true });
  await page.type('#si-pass', PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });
}
const summary = () => page.evaluate(() => document.querySelector('[aria-label="Order summary"]')?.innerText ?? '');

const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + (((6 - d.getDay() + 7) % 7) || 7)); return d; })();
const iso = (d) => d.toISOString().slice(0, 10);
const satBooked = iso(nextSat); // the seeded Saturday: both castles are taken
const satFree = iso(new Date(nextSat.getTime() + 7 * 86_400_000));

try {
  await signIn('jordan@demo.tentpole.test');

  // --- Customers: find Maria, check the profile -------------------------------------------
  await go(`${S}/customers`);
  await click('Maria Gonzalez');
  await page.waitForFunction(() => location.search.includes('id='), { timeout: 10000 });
  const mariaId = new URL(page.url()).searchParams.get('id');
  await waitText('Credits & rain checks');
  check(await hasText('$185.43') && await hasText('$20.00'), 'customer profile: rain check and wallet credit with balances');
  check(await hasText('Home · Cedar Park'), 'customer profile: saved addresses');

  // --- Acceptance 1 + 4: reference order to the cent, credits -------------------------------
  await go(`${S}/orders/new?customer=${mariaId}&date=${satFree}`);
  await waitText('Maria Gonzalez');
  await click('Add Castle Bounce House');
  await click('Add Popcorn Machine');
  await setValue('[aria-label="Driving distance"]', '18.4');
  await sleep(400);
  let sum = await summary();
  check(sum.includes('$500.00') && sum.includes('$47.11') && sum.includes('$618.11'), 'acceptance 1: $618.11 total (rental $500.00, tax $47.11)');
  check(sum.includes('$185.43') && sum.includes('$432.68'), 'acceptance 1: deposit $185.43, balance $432.68');
  check(await hasText('$225.00 incl. 4 h + 4 × 15 min × $25.00'), 'line shows the price trace');
  await click('Apply RC-');
  await click('Apply WC-');
  await sleep(300);
  sum = await summary();
  check(sum.includes('$412.68'), 'acceptance 4: rain check + wallet → due after credits $412.68');
  check(sum.includes('$123.80'), 'acceptance 4: deposit recalculated on the amount due ($123.80)');
  await click('Apply RC-');
  await click('Apply WC-');
  await shot('01-new-order-priced');

  // Coupon
  await setValue('[aria-label="Coupon code"]', 'FALL10');
  await page.keyboard.press('Tab');
  await page.focus('[aria-label="Coupon code"]');
  await page.keyboard.press('Enter');
  await waitText('10% off rentals');
  sum = await summary();
  check(sum.includes('−$50.00'), 'coupon FALL10 takes 10% off rentals');
  await setValue('[aria-label="Coupon code"]', '');

  // --- Acceptance 2: moving to a Saturday where both castles are taken flags the line ------
  await setValue('#ob-date', satBooked);
  await waitText('free for this time', 15000);
  check(await hasText('Only 0 of 2 free for this time'), 'acceptance 2: castle flagged when both are reserved');
  const bookDisabled = await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Book order'))?.disabled);
  check(bookDisabled === true, 'acceptance 2: booking is blocked until fixed');
  await click('Add Castle Bounce House');
  await waitText('Refused · Castle Bounce House');
  check(true, 'acceptance 2: adding another castle is refused with the reason');
  await shot('02-refused');
  await setValue('#ob-date', satFree);
  await page.waitForFunction(() => !document.body.innerText.includes('free for this time'), { timeout: 15000 });

  // --- Book with a manual payment ----------------------------------------------------------
  await click('Book order');
  await waitText('Book & take the deposit');
  await click('Cash, check, Zelle');
  await setValue('#bk-ref', `QA ${run}`);
  await click('Confirm booking');
  await page.waitForFunction(() => [...document.querySelectorAll('h2')].some((h) => h.innerText.trim() === 'Booked'), { timeout: 30000 });
  check(true, 'booked with a manual payment (steps ran, success state shown)');
  await shot('03-booked');
  await click('Keep editing');
  await page.waitForFunction(() => /\/orders\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 });
  const orderPath = new URL(page.url()).pathname;
  await waitText('Order history');
  check(await hasText('All changes saved'), 'booked order opens clean (no phantom unsaved changes)');
  check(await hasText('PAY-AUS-'), 'payment recorded with a receipt number');

  // --- Acceptance 3: edit after booking → re-priced, new version, diff in history -----------
  await setValue('#ob-dur', 360);
  await waitText('Save changes');
  await click('Save changes');
  await waitText('Saved as version');
  await page.waitForFunction(() => document.body.innerText.includes('Changed'), { timeout: 15000 });
  check(await hasText('Changed') && await hasText('Ends'), 'acceptance 3: new version with the changed end time in history');
  await shot('04-history');

  // --- Acceptance 5: a Sales user cannot override a unit price -----------------------------
  await signIn('sam@demo.tentpole.test');
  await go(orderPath);
  await waitText('Order lines');
  const locked = await page.$('[aria-label="Price locked"]');
  const taxDisabled = await page.$eval('[aria-label="Tax rate percent"]', (e) => e.disabled);
  check(!!locked && taxDisabled, 'acceptance 5: Sales sees prices and the tax rate locked');
  const productsNav = await page.evaluate(() => [...document.querySelectorAll('nav a')].some((a) => a.innerText.includes('Products')));
  check(productsNav, 'Sales can still see the catalog');

  // --- Catalog: add a product, try a price ----------------------------------------------------
  await signIn('jordan@demo.tentpole.test');
  await go(`${S}/products/new`);
  await setValue('#p-name', `QA Bubble House ${run}`);
  await setValue('#p-sku', `QA-${run}`.toUpperCase());
  await click('Pricing', '[role="tab"]');
  await setValue('[aria-label="Staffed base price"]', '199');
  await setValue('#p-inc', '3');
  await click('Add product');
  await page.waitForFunction(() => /\/products\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 20000 });
  await waitText('Try a price');
  check(await hasText('$199.00 incl. 3 h'), 'new product saved; Try a price uses the same engine');
  await shot('05-product');

  // --- Inventory: unit back from maintenance clears the clash --------------------------------
  await go(`${S}/inventory`);
  await waitText('Units & maintenance');
  // Start from "Wave Slide in repair" whatever state a tester left it in.
  const waveHeld = await page.evaluate(() => [...document.querySelectorAll('li')].some((li) => li.innerText.includes('Wave Slide') && li.innerText.includes('Mark available')));
  if (!waveHeld) {
    await page.evaluate(() => [...document.querySelectorAll('li')].find((li) => li.innerText.includes('Wave Slide'))?.querySelector('button')?.click());
    await waitText('held from bookings');
  }
  await waitText('needs reassigning');
  check(true, 'inventory flags a booking whose unit is in repair');
  await click('Mark available');
  await waitText('is available again');
  await page.waitForFunction(() => !document.body.innerText.includes('needs reassigning'), { timeout: 15000 });
  check(true, 'marking the unit available clears the clash');
  await click('Send to maintenance');
  await waitText('held from bookings');

  // --- Customers: add, and duplicate detection ---------------------------------------------
  await go(`${S}/customers`);
  await click('Add customer');
  await setValue('#c-first', 'Dup');
  await setValue('#c-email', 'maria@example.com');
  await click('Add customer', 'dialog button');
  await waitText('already uses this email');
  check(true, 'duplicate email caught with options to use the existing customer');
  await setValue('#c-first', `QA ${run}`);
  await setValue('#c-email', `qa-${run}@example.test`);
  await click('Add customer', 'dialog button');
  await waitText('Customer added.');
  check(true, 'new customer added and opened');

  // --- Calendar ------------------------------------------------------------------------------
  await go(`${S}/calendar?date=${satBooked}`);
  await waitText('Cleanup buffer');
  check(await hasText('Maria Gonzalez') && await hasText('Priya Shah'), 'calendar week shows bookings and quotes');
  await click('Maria Gonzalez', 'td button');
  await waitText('Open order');
  check(await hasText('Items blocked until'), 'calendar block opens the order card');
  await shot('06-calendar');
} catch (e) {
  failures++;
  console.log(`FAIL exception: ${e.message}`);
  await page.screenshot({ path: join(OUT, 'zz-failure.png'), fullPage: false }).catch(() => {});
  console.log(`   at ${page.url()}`);
}

for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'} · ${errors.length} browser errors · screenshots in ${OUT}`);
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
