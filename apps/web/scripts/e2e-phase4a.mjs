/**
 * Phase 4a browser QA: the coach portal on a phone (390 × 844) with simulated GPS, in a throwaway
 * workspace (e2e-fixture-4a.ts) that is deleted at the end, so the demo workspace gets no test orders.
 *   node apps/web/scripts/e2e-phase4a.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, '.screenshots/phase4a');
mkdirSync(OUT, { recursive: true });
const fixture = (args) => JSON.parse(execSync(`pnpm --filter @rental/db exec tsx ../../apps/web/scripts/e2e-fixture-4a.ts ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').at(-1));
const fx = fixture('setup');
const S = `/coach/${fx.slug}`;
// A tiny JPEG (the server checks the type, not the picture).
const PHOTO = join(OUT, 'proof.jpg');
writeFileSync(PHOTO, Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000 });
await browser.defaultBrowserContext().overridePermissions(BASE, ['geolocation']);
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const text = () => page.evaluate(() => document.body.innerText);
const has = async (t) => (await text()).includes(t);
const sheetText = () => page.$eval('dialog[open]', (e) => e.innerText).catch(() => '');
const waitText = (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });
const at = (lat, lng) => page.setGeolocation({ latitude: lat, longitude: lng, accuracy: 15 });
async function click(label, selector = 'button, a') {
  await page.waitForFunction((l, s) => [...document.querySelectorAll(s)].some((e) => e.innerText?.trim().startsWith(l) && e.offsetParent && !e.disabled), { timeout: 15000 }, label, selector);
  await page.evaluate((l, s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.innerText?.trim().startsWith(l) && e.offsetParent && !e.disabled);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, label, selector);
}
const isDisabled = (label) => page.evaluate((l) => [...document.querySelectorAll('button')].find((e) => e.innerText?.trim().startsWith(l))?.disabled ?? null, label);
async function signIn(email) {
  await go('/sign-in');
  await page.type('#si-email', email);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#si-pass', { visible: true });
  await page.type('#si-pass', fx.password);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });
}
/** Open a phase tile, tick these items (by label start), add a photo if asked, press Save. */
async function phase(tile, ticks, { photo = false, before } = {}) {
  await click(tile, 'button');
  await page.waitForSelector('dialog[open]', { visible: true });
  for (const t of ticks) await click(t, 'dialog[open] button[aria-pressed]');
  if (photo) {
    const input = await page.$('dialog[open] input[type=file]');
    await input.uploadFile(PHOTO);
    await page.waitForFunction(() => document.querySelector('dialog[open] img'), { timeout: 20000 });
  }
  if (before) await before();
  const label = await page.$eval('dialog[open] footer button', (b) => b.innerText.trim());
  await click(label, 'dialog[open] footer button');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 20000 });
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
}

try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await at(30.3900, -97.7300); // the warehouse side of town, ~13 km out

  // --- A coach lands in the portal, not the staff app -----------------------------------------------------
  await signIn(fx.coachEmail);
  await go(`/${fx.slug}`);
  check(page.url().includes(S), 'a coach opening the staff app is sent to the coach portal');
  await waitText('event');
  check(await has('1 event today'), 'dashboard: 1 event today');
  check(await has('Nothing is currently en route.'), 'dashboard: nothing en route yet');
  await shot('01-dashboard');

  // --- 10: a Quote order opens the lock popup ----------------------------------------------------------------
  await go(`${S}/orders`);
  await waitText(fx.quote.number);
  await click(fx.quote.number, 'button');
  await page.waitForSelector('dialog[open]', { visible: true });
  check((await sheetText()).includes(`Order ${fx.quote.number} is a Quote order. The detail page is only available for Booked orders.`), '10: a Quote order shows the lock popup');
  await shot('02-locked');
  await click('OK', 'dialog[open] button');

  // --- 1 + 5: the checklist gates ---------------------------------------------------------------------------
  await go(`${S}/orders/${fx.booked.id}`);
  await waitText('Coach checklist');
  check(await isDisabled('Start En Route') === true, '1: Start En Route is locked before Pre-Departure and Load');
  check(await has('Locked until phase 1 is saved'), 'Load says it is locked until phase 1 is saved');
  await phase('1. Pre-Departure', ['Vehicle fueled', 'Route planned', 'Event details reviewed', 'Uniform clean', 'Tools & supplies', 'Customer special requests', 'Marketing materials']);
  check(await has('Saved · locked'), 'Pre-Departure saved at 100% locks');
  await phase('2. Load', ['ALL job-specific', 'SPARES of critical']);
  check(/2\. Load\s*67%/.test(await text()), '5: Load with both ticks and no photo is 67%');
  await shot('03-load-67');
  await phase('2. Load', [], { photo: true });
  check(/2\. Load\s*100%/.test(await text()), '5: adding the photo and saving makes Load 100%');
  await click('2. Load', 'button');
  await page.waitForSelector('dialog[open]', { visible: true });
  check(!(await page.$('dialog[open] footer button')) && (await sheetText()).includes('locked at 100%'), '5: Load is locked (no Save button, ticks final)');
  await shot('04-load-locked');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));

  // --- 2: Start En Route → Text 1 once, live tracking --------------------------------------------------------
  check(await isDisabled('Start En Route') === false, 'Start En Route unlocks once Pre-Departure and Load are saved');
  check(await has('Opens after “I have arrived”'), '4: Arrival Checks wait for “I have arrived”');
  await click('Start En Route', 'button');
  await waitText('Text 1 (en route)', 30000);
  check(/Text 1 \(en route\)\s*Sent/.test(await text()), '2: Text 1 is logged as sent');
  check(await page.evaluate(() => [...document.querySelectorAll('header [role=status]')].some((e) => e.innerText.startsWith('LIVE'))), 'the app bar shows the live chip while tracking');
  await shot('05-en-route');
  const texts = fixture(`messages ${fx.booked.id}`);
  const t1 = texts.filter((m) => m.type === 'coach_en_route');
  check(t1.length === 1 && t1[0].meta.coachName === 'Alex Rivera', `2: exactly one Text 1, naming the lead coach (${t1.map((m) => m.status).join(', ')})`);

  // --- 4: I have arrived → time + distance, Phase 3 opens ---------------------------------------------------
  await at(fx.venue.lat + 0.0003, fx.venue.lng);
  await click('I have arrived', 'button');
  // The card line ("Arrived 1:04 PM · 33 m") replaces the button once the page refreshes.
  await page.waitForFunction(() => /Arrived \d{1,2}:\d{2}\s?[AP]M · \d+ m/.test(document.body.innerText), { timeout: 30000 });
  const dist = Number(/Arrived \d{1,2}:\d{2}\s?[AP]M · (\d+) m/.exec(await text())?.[1] ?? -1);
  check(dist > 10 && dist < 80, `4: arrival records the distance from the venue (${dist} m)`);
  check(!(await page.evaluate(() => [...document.querySelectorAll('header [role=status]')].some((e) => e.innerText.startsWith('LIVE')))), 'tracking stops on arrival');
  await phase('3. Arrival', ['Warm greeting', 'Review contract', 'Payment check', 'Hand customer the Review Card', 'Inflatable drop-offs', 'Confirm setup location']);
  check(/3\. Arrival\s*100%/.test(await text()), 'Arrival Checks saved at 100%');

  // --- 6: EVENT START once, with the variance ---------------------------------------------------------------
  await click('4. Setup', 'button');
  await page.waitForSelector('dialog[open]', { visible: true });
  check((await sheetText()).includes('Reached destination'), 'Setup shows when the coach reached the destination');
  await click('EVENT START', 'dialog[open] button');
  await page.waitForFunction(() => !document.querySelector('dialog[open]') || /EVENT START \d/.test(document.querySelector('dialog[open]').innerText), { timeout: 20000 });
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  check(/EVENT START \d{1,2}:\d{2} [AP]M · (\d+ min (late|early)|On time|on time)/.test(await text()), '6: EVENT START records the time and the variance');
  if (await page.$('dialog[open]')) { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog[open]')); }
  await phase('4. Setup', ['Equipment set up'], { photo: true });
  check(/4\. Setup\s*100%/.test(await text()), 'Setup saved at 100% with its photo');

  // --- 7 + 8: Close-Out with damage → maintenance flag; Completed ------------------------------------------
  await phase('5. Close-Out', ['Equipment breakdown', 'Site cleaned', 'Inspected', 'All equipment visually', 'Thank birthday child', 'Collect completed Review Card'], {
    photo: true,
    before: async () => { await page.type('dialog[open] textarea', 'Torn seam on the turret'); },
  });
  await waitText('Warehouse maintenance flag is ON');
  check(await has('Completed: you arrived and every phase is saved.'), '8: arrived + all five saved → Completed');
  check(await page.evaluate(() => [...document.querySelectorAll('span')].some((e) => e.innerText.trim() === 'Completed')), 'the status pill says Completed');
  await shot('06-completed');
  const alerts = fixture(`messages ${fx.booked.id}`).filter((m) => m.type === 'damage_report');
  check(alerts.length === 1, '7: one damage alert to the office');

  await go(S);
  await waitText('event');
  check(await has('Saved On-Site Close-Out'), 'dashboard: recent activity lists the close-out');
  await shot('07-dashboard-after');

  // --- Staff side: the order shows who ran it and how far they got ----------------------------------------
  await page.evaluate(() => fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  await page.setViewport({ width: 1440, height: 1000 });
  await signIn(fx.ownerEmail);
  await go(`/${fx.slug}/orders/${fx.booked.id}`);
  await waitText('Coaches & crew', 30000);
  const t = await text();
  check(t.includes('Alex Rivera') && t.includes('Lead coach') && t.includes('Sam Crew'), 'staff: the order lists the lead coach and the crew');
  check(t.includes('Checklist · Completed') && t.includes('Damage reported · maintenance flag on'), 'staff: the card shows Completed and the damage flag');
  await shot('08-staff-card');
} catch (e) {
  failures++;
  console.log(`FAIL ${e.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  fixture(`teardown ${fx.tenantId}`);
}

for (const e of errors) console.log(`PAGE ERROR ${e}`);
console.log(failures || errors.length ? `\n${failures} check(s) failed, ${errors.length} page error(s)` : '\nAll Phase 4a checks passed');
process.exit(failures || errors.length ? 1 : 0);
