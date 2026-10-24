/**
 * Screenshots of the seeded demo (pnpm seed:demo) at desktop and phone width.
 *   node apps/web/scripts/shots-demo.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../../.screenshots/demo');
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
// Full-page captures freeze off-screen entrance animations; reduced motion turns them off (and checks that path).
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email) {
  await page.deleteCookie(...(await page.cookies()));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
  await page.type('#si-email', email);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#si-pass', { visible: true });
  await page.type('#si-pass', 'Tentpole-2026!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });
}
async function shot(path, name) {
  for (const [tag, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2 }]]) {
    await page.setViewport(vp);
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
    await sleep(1300);
    await page.screenshot({ path: join(OUT, `${name}-${tag}.png`), fullPage: true });
  }
}

await signIn('jordan@demo.tentpole.test');
await shot('/freedom-fun-demo', 'home');
await shot('/freedom-fun-demo/settings/team', 'team');
await shot('/freedom-fun-demo/settings/locations', 'locations');
await shot('/freedom-fun-demo/settings/workspace', 'workspace');
await shot('/freedom-fun-demo/orders', 'orders');
await signIn('owner@demo.tentpole.test');
await shot('/console', 'console');
console.log(errors.length ? `browser errors:\n${errors.join('\n')}` : 'no browser errors');
await browser.close();
