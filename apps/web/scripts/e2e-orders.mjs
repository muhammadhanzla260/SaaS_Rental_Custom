/**
 * Phase 1 end-to-end in a real browser: catalog -> customer -> order -> book ->
 * double-booking refused -> calendar and dashboard. Needs a running app and the
 * Mapbox token (party address search and travel fee). Screenshots to .screenshots/.
 *
 *   node apps/web/scripts/e2e-orders.mjs
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../../.screenshots');
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror on ${new URL(page.url()).pathname}: ${e.message.slice(0, 160)}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 160)}`); });
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844, deviceScaleFactor: 2 };
const shot = async (name, viewport = desktop) => {
  await page.setViewport(viewport);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${name}: no horizontal scroll (${overflow}px)`);
  await page.setViewport(desktop);
};
const byText = (text, tag = '*') => page.waitForSelector(`::-p-xpath(//${tag}[normalize-space(.)=${JSON.stringify(text)}])`, { timeout: 10000 });
const clickText = async (text) => (await byText(text, 'button')).click();
const type = async (sel, value) => {
  await page.waitForSelector(sel);
  await page.$eval(sel, (el) => { el.focus(); el.select?.(); });
  await page.keyboard.type(String(value));
};
/** Set a value on a React-controlled input that has no keyboard-friendly format (date, time). */
const setNative = (sel, value) => page.$eval(sel, (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, value);
const hydrated = (sel) => page.waitForFunction((s) => { const el = document.querySelector(s); return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps')); }, { timeout: 20000 }, sel);

/** A product photo, drawn in the browser and saved as PNG. */
async function makePhoto(label, colors) {
  const p = await browser.newPage();
  await p.setViewport({ width: 800, height: 600 });
  await p.setContent(`<body style="margin:0;display:grid;place-items:center;height:600px;background:linear-gradient(135deg,${colors[0]},${colors[1]});font:700 64px Arial;color:white;text-align:center">${label}</body>`);
  const path = join(tmpdir(), `photo-${run}-${label.replace(/\W/g, '')}.png`);
  await p.screenshot({ path });
  await p.close();
  return path;
}

try {
  // --- account + quick onboarding -------------------------------------------------------
  await page.setViewport(desktop);
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0' });
  await type('#name', 'Order Tester');
  await type('#email', `orders-${run}@example.test`);
  await type('#password', 'correct-horse-battery');
  await clickText('Create account');
  await hydrated('#profile-name');
  await type('#profile-name', `Party Rentals ${run}`);
  await type('#profile-phone', '5125550199');
  await type('#profile-address-line1', '700 Congress Ave');
  await page.keyboard.press('Escape');
  await type('#profile-address-city', 'Austin');
  await type('#profile-address-region', 'TX');
  await page.click('#profile-legalName');
  await page.waitForFunction(() => document.body.innerText.includes('Available'), { timeout: 10000 });
  await clickText('Continue');
  await page.waitForSelector('#logo');
  await clickText('Continue');
  await page.waitForSelector('#location-name');
  if (!(await page.evaluate(() => document.body.innerText.includes('Pinned at')))) {
    if (!(await page.$('#location-address-lat'))) await (await byText('Enter coordinates by hand', 'button')).click();
    await type('#location-address-lat', '30.2692');
    await type('#location-address-lng', '-97.7428');
  }
  await clickText('Create my organization');
  await page.waitForFunction(() => /^\/party-rentals-/.test(location.pathname), { timeout: 20000 });
  const slug = new URL(page.url()).pathname.slice(1);
  check(true, `organization ready (/${slug})`);

  // --- catalog ------------------------------------------------------------------------------
  const photo1 = await makePhoto('Castle Bounce', ['#ff6b6b', '#ffd93d']);
  const photo2 = await makePhoto('Movie Screen', ['#2450c8', '#6d3fd1']);
  await page.goto(`${BASE}/${slug}/catalog`, { waitUntil: 'networkidle0' });
  await shot('40-catalog-empty');
  await page.goto(`${BASE}/${slug}/catalog/new`, { waitUntil: 'networkidle0' });
  await hydrated('#p-name');
  await (await page.$('input[aria-label="Product photo"]')).uploadFile(photo1);
  await type('#p-name', 'Castle Bounce House');
  await type('#p-staffed', '299');
  await type('#p-pickup', '199');
  await type('#p-dropoff', '249');
  await (await page.waitForSelector('#p-extra ::-p-text(Per hour)')).click();
  await page.$eval('#p-rate', (el) => { el.focus(); el.select(); });
  await page.keyboard.type('50');
  const plus = await page.waitForSelector('button[aria-label^="More owned at"]');
  await plus.click(); // own 2 at the primary location
  await page.waitForFunction(() => document.body.innerText.includes('$374.00') || document.body.innerText.includes('$299.00'), { timeout: 5000 });
  await page.$eval('#p-try', (el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '5.5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.body.innerText.includes('$374.00'), { timeout: 5000 });
  check(true, 'price preview: 5.5 h staffed = $299 + 1.5 h x $50 = $374.00');
  await shot('41-product-editor');
  await clickText('Add product');
  await page.waitForFunction(() => /\/catalog\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 });
  check(true, 'product saved');

  await page.goto(`${BASE}/${slug}/catalog/new`, { waitUntil: 'networkidle0' });
  await hydrated('#p-name');
  await (await page.$('input[aria-label="Product photo"]')).uploadFile(photo2);
  await type('#p-name', '40ft Movie Screen');
  await type('#p-staffed', '650');
  await clickText('Add product');
  await page.waitForFunction(() => /\/catalog\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 });
  await page.goto(`${BASE}/${slug}/catalog`, { waitUntil: 'networkidle0' });
  const cards = await page.$$eval('main ul > li', (els) => els.length);
  check(cards >= 2, `catalog shows the products (${cards})`);
  await shot('42-catalog');
  await shot('42-catalog-phone', phone);

  // --- order with a new customer ---------------------------------------------------------------
  await page.goto(`${BASE}/${slug}/orders/new`, { waitUntil: 'networkidle0' });
  await hydrated('#order-customer');
  await type('#order-customer', 'Jane Party');
  await (await page.waitForSelector('::-p-text(New customer: "Jane Party")')).click();
  await page.waitForSelector('#nc-phone');
  await type('#nc-phone', '5125550123');
  await type('#nc-email', `jane-${run}@example.test`);
  await clickText('Add customer');
  await page.waitForFunction(() => document.body.innerText.includes('Jane Party') && !document.querySelector('#nc-first'), { timeout: 10000 });
  check(true, 'new customer created from the order');

  await setNative('#o-start', '14:00');
  await setNative('#o-end', '19:30');
  await page.waitForFunction(() => document.body.innerText.includes('Billed for 5.5 h'), { timeout: 5000 });
  check(true, 'billed hours shown (5.5 h)');
  // Party somewhere else in Austin: Mapbox search limited to the service area.
  await page.click('label[for="o-same"]');
  await page.waitForSelector('#f-eventAddress-line1');
  await page.type('#f-eventAddress-line1', '2100 Barton Springs Rd', { delay: 25 });
  await page.waitForSelector('[role=listbox] [role=option]', { timeout: 10000 });
  await page.click('[role=listbox] [role=option]');
  await page.waitForFunction(() => /driving from/.test(document.body.innerText), { timeout: 20000 });
  const travel = await page.evaluate(() => document.body.innerText.match(/[\d.]+ mi driving from [^\n]+/)?.[0]);
  check(!!travel, `travel fee from the nearest location (${travel})`);

  await (await page.waitForSelector('::-p-xpath(//button[.//span[normalize-space(.)="Castle Bounce House"]])')).click();
  await page.waitForFunction(() => document.body.innerText.includes('$374.00'), { timeout: 5000 });
  check(true, 'item priced $374.00 for 5.5 h in the cart');
  await page.waitForFunction(() => /2 of 2 free then/.test(document.body.innerText), { timeout: 10000 });
  check(true, 'cart shows availability (2 of 2 free)');
  await shot('43-order-builder');
  await shot('43-order-builder-phone', phone);

  await clickText('Save and book');
  await page.waitForFunction(() => /\/orders\/[0-9a-f-]{36}/.test(location.pathname) && document.body.innerText.includes('Booked. The equipment is now held'), { timeout: 20000 });
  const total1 = await page.evaluate(() => document.querySelector('[aria-label="Order summary"] dd.font-display')?.textContent);
  check(true, `order booked, total ${total1}`);
  await shot('44-order-booked');

  // --- a second order wanting 3 castles at the same time is refused ---------------------------------
  await page.goto(`${BASE}/${slug}/orders/new`, { waitUntil: 'networkidle0' });
  await hydrated('#order-customer');
  await type('#order-customer', 'Jane');
  await (await page.waitForSelector('[role=listbox] [role=option]')).click();
  await page.waitForFunction(() => !document.querySelector('#order-customer'), { timeout: 10000 });
  await setNative('#o-start', '15:00');
  await setNative('#o-end', '18:00');
  await (await page.waitForSelector('::-p-xpath(//button[.//span[normalize-space(.)="Castle Bounce House"]])')).click();
  await page.waitForFunction(() => /1 of 2 free then/.test(document.body.innerText), { timeout: 10000 });
  check(true, 'second order sees one castle already booked');
  const more = await page.waitForSelector('button[aria-label="More quantity of Castle Bounce House"]');
  await more.click();
  await page.waitForFunction(() => document.body.innerText.includes('already booked for this time'), { timeout: 5000 });
  check(true, 'conflict warning appears before booking');
  await clickText('Save and book');
  await page.waitForFunction(() => /is not available then/.test(document.body.innerText), { timeout: 20000 });
  check(true, 'database refuses the double booking with a clear message');
  await shot('45-order-refused');

  // --- lists, calendar, dashboard --------------------------------------------------------------------
  await page.goto(`${BASE}/${slug}/orders?tab=upcoming`, { waitUntil: 'networkidle0' });
  check((await page.evaluate(() => document.body.innerText)).includes('Jane Party'), 'booking listed under Upcoming');
  await shot('46-orders');
  await shot('46-orders-phone', phone);
  await page.goto(`${BASE}/${slug}/calendar`, { waitUntil: 'networkidle0' });
  const next = await page.$('button[aria-label="Next month"]');
  if (!(await page.evaluate(() => document.body.innerText.includes('Jane Party')))) { await next.click(); await page.waitForNetworkIdle({ idleTime: 300 }).catch(() => {}); }
  check((await page.evaluate(() => document.body.innerText)).includes('Jane Party'), 'booking appears on the calendar');
  await shot('47-calendar');
  await shot('47-calendar-phone', phone);
  await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 1500));
  const dash = await page.evaluate(() => document.body.innerText);
  check(/Coming up[\s\S]*Jane Party/.test(dash), 'dashboard lists the upcoming booking');
  await shot('48-dashboard');
  await page.goto(`${BASE}/${slug}/customers`, { waitUntil: 'networkidle0' });
  check((await page.evaluate(() => document.body.innerText)).includes('Jane Party'), 'customer listed');
  await shot('49-customers');
} catch (e) {
  failures++;
  console.error('FAIL (exception)', e);
  await page.screenshot({ path: join(OUT, 'zz-orders-failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
if (errors.length) { console.log('\nBrowser errors:'); for (const e of [...new Set(errors)]) console.log(' ', e); }
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
