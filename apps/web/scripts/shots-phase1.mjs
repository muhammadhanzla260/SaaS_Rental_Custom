/**
 * Screenshots of the Phase 1 screens on the seeded demo (pnpm seed:demo), desktop and phone.
 * Also reports browser errors and horizontal overflow on each page.
 *   node apps/web/scripts/shots-phase1.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../../.screenshots/phase1');
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 180000 });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: console: ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = '/freedom-fun-demo';

await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
await page.type('#si-email', 'jordan@demo.tentpole.test');
await page.keyboard.press('Enter');
await page.waitForSelector('#si-pass', { visible: true });
await page.type('#si-pass', 'Tentpole-2026!');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });

const hrefMatching = async (path, text) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  return page.evaluate((t) => [...document.querySelectorAll('a')].find((a) => a.innerText.includes(t))?.getAttribute('href') ?? null, text);
};
const mariaOrder = await hrefMatching(`${S}/orders`, 'Maria Gonzalez');
const castle = await hrefMatching(`${S}/products`, 'Castle Bounce House');
await page.goto(`${BASE}${S}/customers`, { waitUntil: 'networkidle0' });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Maria Gonzalez'))?.click());
await page.waitForFunction(() => location.search.includes('id='), { timeout: 10000 });
const mariaProfile = new URL(page.url()).pathname + new URL(page.url()).search;
const sat = (() => { const d = new Date(); d.setDate(d.getDate() + (((6 - d.getDay() + 7) % 7) || 7)); return d.toISOString().slice(0, 10); })();

const pages = [
  ['products', `${S}/products`],
  ['product-pricing', `${castle}?tab=pricing`],
  ['product-inventory', `${castle}?tab=inventory`],
  ['inventory', `${S}/inventory`],
  ['customers', mariaProfile],
  ['orders', `${S}/orders`],
  ['order-maria', mariaOrder],
  ['order-new', `${S}/orders/new`],
  ['calendar-week', `${S}/calendar?date=${sat}`],
  ['calendar-day', `${S}/calendar?date=${sat}&view=day`],
];
for (const [name, path] of pages) {
  for (const [tag, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, deviceScaleFactor: 1.5 }]]) {
    console.log(`-> ${name} ${tag}`);
    await page.setViewport(vp);
    let requests = 0;
    const count = () => requests++;
    page.on('request', count);
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) {
      errors.push(`${name} ${tag}: ${e.message}`);
    }
    console.log('   loaded'); await sleep(2500);
    const before = requests;
    await sleep(3000);
    page.off('request', count);
    if (requests - before > 3) errors.push(`${name} ${tag}: still making requests while idle (${requests - before} in 3 s)`);
    console.log('   idle-check done');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) errors.push(`${name} ${tag}: horizontal overflow ${overflow}px`);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log('   measured', h);
    // Grow the viewport to the page instead of captureBeyondViewport (which hangs headless Chrome on tall pages).
    await page.setViewport({ ...vp, height: Math.min(h, tag === 'phone' ? 3200 : 4000) });
    await sleep(300);
    await page.screenshot({ path: join(OUT, `${name}-${tag}.png`) });
  }
}
console.log(errors.length ? `ISSUES:\n${errors.join('\n')}` : 'no browser errors, no overflow');
await browser.close();
