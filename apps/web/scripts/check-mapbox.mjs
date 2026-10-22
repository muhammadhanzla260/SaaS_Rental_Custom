/**
 * Live check of the Mapbox integration in a real browser (needs NEXT_PUBLIC_MAPBOX_TOKEN
 * and a running app): type-ahead search, filling the address, the pin, the
 * interactive map, and moving the pin by clicking the map.
 *
 *   node apps/web/scripts/check-mapbox.mjs
 */
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../../.screenshots');
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await p.setViewport({ width: 1440, height: 1000 });
const run = Date.now().toString(36);

try {
  await p.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0' });
  await p.type('#name', 'Map Check');
  await p.type('#email', `map-${run}@example.test`);
  await p.type('#password', 'correct-horse-battery');
  await p.click('button[type=submit]');
  await p.waitForFunction(() => { const el = document.querySelector('#profile-name'); return el && Object.keys(el).some((k) => k.startsWith('__reactProps')); }, { timeout: 20000 });

  // Odoo style: suggestions appear on the street field itself.
  const search = '#profile-address-line1';
  await p.waitForSelector(search);
  await p.type(search, '700 Congress Ave Austin', { delay: 30 });
  await p.waitForSelector('[role=listbox] [role=option]', { timeout: 10000 });
  const options = await p.$$eval('[role=listbox] [role=option]', (els) => els.map((e) => e.innerText.replace(/\n/g, ' · ')));
  check(options.length > 0, `suggestions appear while typing (${options[0]})`);

  await p.click('[role=listbox] [role=option]');
  await p.waitForFunction(() => document.querySelector('#profile-address-city')?.value, { timeout: 10000 });
  const filled = await p.evaluate(() => Object.fromEntries(['line1', 'city', 'region', 'postalCode', 'country'].map((k) => [k, document.querySelector(`#profile-address-${k}`)?.value])));
  check(filled.line1 === '700 Congress Avenue' && filled.city === 'Austin' && filled.region === 'TX' && filled.postalCode === '78701', `picking fills the address (${JSON.stringify(filled)})`);
  await new Promise((r) => setTimeout(r, 1500));
  check(!(await p.$('[role=listbox]')), 'suggestion list stays closed after a pick');

  await p.waitForFunction(() => document.body.innerText.includes('Pinned at'), { timeout: 10000 });
  check(true, `pin set: ${await p.evaluate(() => document.body.innerText.match(/Pinned at [^\n]+/)?.[0])}`);
  await p.waitForSelector('.mapboxgl-canvas', { timeout: 15000 });
  await p.waitForSelector('.mapboxgl-marker', { timeout: 15000 });
  check(true, 'interactive map with marker loaded');
  await new Promise((r) => setTimeout(r, 2500));
  const box = await p.$('.mapboxgl-canvas');
  await box.scrollIntoView();
  await p.screenshot({ path: join(OUT, '30-mapbox-search.png') });

  const bb = await box.boundingBox();
  await p.mouse.click(bb.x + bb.width * 0.3, bb.y + bb.height * 0.35);
  await p.waitForFunction((before) => document.querySelector('#profile-address-line1')?.value !== before, { timeout: 10000 }, filled.line1).catch(() => {});
  const moved = await p.evaluate(() => document.querySelector('#profile-address-line1')?.value);
  check(moved && moved !== filled.line1, `clicking the map moves the pin and updates the address (${moved})`);
  await new Promise((r) => setTimeout(r, 1500));
  await p.screenshot({ path: join(OUT, '31-mapbox-moved-pin.png') });

  // A hand-typed address is pinned automatically when you leave the field (Odoo geocoded warehouses).
  const pinText = () => p.evaluate(() => document.body.innerText.match(/Pinned at [^\n]+/)?.[0]);
  const before = await pinText();
  await p.$eval(search, (el) => { el.focus(); el.select(); });
  await p.keyboard.type('1100 Congress Ave');
  await p.keyboard.press('Escape');
  await p.$eval('#profile-address-city', (el) => { el.focus(); el.select(); });
  await p.keyboard.type('Austin');
  await p.click('#profile-legalName');
  await p.waitForFunction((b) => { const m = document.body.innerText.match(/Pinned at [^\n]+/)?.[0]; return m && m !== b; }, { timeout: 10000 }, before).catch(() => {});
  const after = await pinText();
  check(after && after !== before && (await p.evaluate(() => document.body.innerText.includes('Pinned automatically'))), `typed address pinned automatically (${after})`);
} catch (e) {
  failures++;
  console.error('FAIL (exception)', e);
  await p.screenshot({ path: join(OUT, 'zz-mapbox-failure.png') }).catch(() => {});
} finally {
  await b.close();
}
check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
