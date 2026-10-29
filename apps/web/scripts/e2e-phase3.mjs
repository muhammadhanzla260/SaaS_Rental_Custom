/**
 * Phase 3a browser QA: cancel with a wallet credit (+ goodwill), rain check →
 * reschedule now (availability checked), rain check → use later ("Rained out").
 *   node apps/web/scripts/e2e-phase3.mjs
 * Fresh booked orders (deposit paid by check) come from e2e-fixture-2b.ts booked.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, '.screenshots/phase3');
mkdirSync(OUT, { recursive: true });
const S = '/freedom-fun-demo';
const fx = JSON.parse(execSync('pnpm --filter @rental/db exec tsx ../../apps/web/scripts/e2e-fixture-2b.ts booked', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').at(-1));
const money = (c) => `$${(c / 100).toFixed(2)}`;
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000 });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const text = () => page.evaluate(() => document.body.innerText);
const has = async (t) => (await text()).includes(t);
const dialogText = () => page.$eval('dialog[open]', (e) => e.innerText).catch(() => '');
const waitText = (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });
async function click(label, selector = 'button, a, [role="radio"], label') {
  await page.waitForFunction((l, s) => [...document.querySelectorAll(s)].some((e) => e.innerText?.trim().startsWith(l) && e.offsetParent && !e.disabled), { timeout: 15000 }, label, selector);
  await page.evaluate((l, s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.innerText?.trim().startsWith(l) && e.offsetParent && !e.disabled);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, label, selector);
}
async function setValue(selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await go('/sign-in');
  await page.type('#si-email', 'jordan@demo.tentpole.test');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#si-pass', { visible: true });
  await page.type('#si-pass', 'Tentpole-2026!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });

  // --- Cancel with a wallet credit + goodwill (acceptance 1) -------------------------------------
  await go(`${S}/orders/${fx.a.id}`);
  await waitText('Order history');
  await click('Cancel order');
  await page.waitForSelector('dialog[open] #cx-reason', { visible: true });
  check((await dialogText()).includes(`paid ${money(fx.a.paidCents)}. Choose what happens to it.`), 'cancel asks what happens to what was paid');
  check(await page.$eval('#cx-amount', (e) => e.value) === (fx.a.paidCents / 100).toFixed(2), 'the credit defaults to what was paid');
  await setValue('#cx-reason', 'Customer changed plans');
  await setValue('#cx-gw', '20');
  const wallet = (await dialogText()).match(/wallet: \$([\d,]+\.\d{2}) → \$([\d,]+\.\d{2})/);
  const delta = wallet ? Math.round((Number(wallet[2].replace(/,/g, '')) - Number(wallet[1].replace(/,/g, ''))) * 100) : -1;
  check(delta === fx.a.paidCents + 2000, `the wallet preview adds paid + goodwill (${wallet?.[0] ?? 'not shown'})`);
  await shot('01-cancel-wallet');
  await click('Cancel order', 'dialog[open] button');
  await page.waitForFunction(() => /Wallet credit WC-\d{4}/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 30000 });
  check((await dialogText()).includes(money(fx.a.paidCents + 2000)), `one wallet credit for ${money(fx.a.paidCents + 2000)} (paid + $20 goodwill)`);
  await shot('02-cancel-done');
  await click('Done', 'dialog[open] button');
  await page.waitForFunction(() => document.body.innerText.includes('this order stays closed'), { timeout: 20000 });
  check(await has('Cancelled') && !(await has('Reopen as a draft')), 'cancelled; an order whose money became credit cannot be reopened (no double counting)');

  // --- Rain check → reschedule now (acceptance 2) ------------------------------------------------
  await go(`${S}/orders/${fx.b.id}`);
  await waitText('Order history');
  await click('Rain check');
  await page.waitForSelector('dialog[open]', { visible: true });
  await click('Reschedule now', 'dialog[open] [role="radio"]');
  const newDay = plusDays(fx.day, 7);
  await setValue('#rc-date', newDay);
  await page.waitForFunction(() => /free that day/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 20000 });
  check(true, 'the new date is checked live ("free that day")');
  await shot('03-reschedule');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.innerText.trim() === 'Reschedule').click());
  await page.waitForFunction(() => /moved to/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 30000 });
  await click('Done', 'dialog[open] button');
  await page.waitForFunction(() => document.body.innerText.includes('Order history'), { timeout: 20000 });
  await page.waitForSelector('#ob-date');
  check(await page.$eval('#ob-date', (e) => e.value) === newDay, `the same order (${fx.b.number}) now sits on ${newDay}`);
  check(await has('Rescheduled'), 'the history records the reschedule');

  // --- Rain check → use later ("Rained out") -------------------------------------------------------
  await click('Rain check');
  await page.waitForSelector('dialog[open] #rc-amount', { visible: true });
  await setValue('#rc-gw', '5');
  check((await dialogText()).includes(`RAIN CHECK`) && (await dialogText()).includes(money(fx.b.paidCents + 500)), 'the rain check preview shows paid + goodwill');
  await shot('04-raincheck');
  await click('Issue rain check', 'dialog[open] button');
  await page.waitForFunction(() => /Rain check RC-\d{4}/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 30000 });
  check(true, 'a coded rain check is issued');
  await click('Done', 'dialog[open] button');
  await page.waitForFunction(() => document.body.innerText.includes('Rained out'), { timeout: 20000 });
  check(true, 'the order shows as "Rained out"');
  await shot('05-rained-out');

  // --- Ops board ("Action needed") ------------------------------------------------------------------
  await go(`${S}/actions`);
  await waitText('Quotes sent this week');
  check(await has('Deposit needed') && await has('Pre-event call due') && await has('Quotes going cold') && await has('Tomorrow ·'), 'the board shows its columns, KPI tiles and tomorrow’s events');
  const cardsBefore = await page.$$eval('article', (a) => a.length);
  if (cardsBefore > 0) {
    await click('Snooze 1 day', 'article button');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => e.innerText.includes('Snoozed')), { timeout: 15000 });
    await page.waitForFunction((n) => document.querySelectorAll('article').length === n - 1, { timeout: 15000 }, cardsBefore);
    check(true, 'snoozing a card removes it');
  } else check(await has('All clear'), 'no cards: the board says All clear');
  await shot('06-ops-board');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await go(`${S}/actions`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the board fits a 390 px phone (columns scroll inside)');
  await page.setViewport({ width: 1440, height: 1000 });

  // --- Reports ----------------------------------------------------------------------------------------
  await go(`${S}/reports`);
  await waitText('Revenue per day');
  const mtd = await page.evaluate(() => {
    const cents = (s) => Math.round(Number(s.replace(/[^0-9.-]/g, '')) * 100);
    const tile = [...document.querySelectorAll('main span')].find((e) => e.innerText === 'Revenue')?.nextElementSibling?.innerText ?? '';
    const bars = document.querySelector('[role="img"]').getAttribute('aria-label').split(': ').slice(1).join(': ').split(', ').map((t) => cents(t.split(' · ')[1] ?? '0'));
    return { tile: cents(tile), bars: bars.reduce((a, b) => a + b, 0), count: bars.length };
  });
  check(mtd.count >= 1 && mtd.bars === mtd.tile, `acceptance 5: Month to Date bars add up to the Revenue tile (${money(mtd.bars)} = ${money(mtd.tile)})`);
  await shot('07-reports-mtd');
  await page.type('input[placeholder="Find a report"]', 'rain');
  check((await page.$$eval('nav[aria-label="Reports"] a', (a) => a.map((x) => x.innerText.trim()))).join('|') === 'Credits and Rain Checks', 'the report search narrows the list');
  await click('Credits and Rain Checks', 'nav[aria-label="Reports"] a');
  await page.waitForFunction(() => /RC-\d{4}/.test(document.body.innerText) && document.body.innerText.includes('Remaining'), { timeout: 20000 });
  check(true, 'acceptance 3: the credits report lists the rain check with issued / used / remaining');
  const csv = await page.evaluate(async () => {
    const a = [...document.querySelectorAll('a')].find((x) => x.innerText.includes('Export CSV'));
    const r = await fetch(a.href);
    return { type: r.headers.get('content-type'), name: r.headers.get('content-disposition'), body: await r.text() };
  });
  check(csv.type.startsWith('text/csv') && /credits-and-rain-checks/.test(csv.name) && csv.body.includes('Code,Kind,Customer') && /\r\nTotal,/.test(csv.body), 'Export CSV downloads the same report with a totals line');
  await click('Email weekly');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => /every Monday at 8:00 AM|is scheduled/.test(e.innerText)), { timeout: 15000 });
  check(await has('Emailed Mondays'), 'Email weekly schedules the report for Monday mornings');
  await go(`${S}/reports?r=credits_rain_checks`);
  check(await has('Emailed Mondays'), 'the schedule is saved');
  await click('Emailed Mondays');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => e.innerText.includes('Schedule removed')), { timeout: 15000 });
  check(true, 'and can be removed');
  await click('Last month', '[role="radio"]');
  await page.waitForFunction(() => location.search.includes('p=last_month'), { timeout: 15000 });
  check(true, 'the period switch reloads the report');
  await go(`/print/${S.slice(1)}/reports?r=receivables`);
  check(await has('Receivables') && await has('Print or save as PDF'), 'PDF opens a printable page');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await go(`${S}/reports?r=order_list`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'reports fit a 390 px phone (the table scrolls inside)');
  await shot('08-reports-phone');
  await page.setViewport({ width: 1440, height: 1000 });

  // --- Emails and phones ----------------------------------------------------------------------------
  await go(`${S}/settings/messaging?tab=log&q=${fx.b.number}`);
  await waitText('Cancellation');
  check(true, 'the cancellation email is logged');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await go(`${S}/orders/${fx.a.id}`);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'cancelled order fits a 390 px phone');
} catch (e) {
  failures++;
  console.log(`FAIL ${e.message}`);
  console.log(`   at ${page.url()} · dialog: ${(await dialogText()).slice(0, 200).replace(/\n/g, ' | ')}`);
  await shot('zz-failure');
} finally {
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}
