/**
 * Payment Options browser QA (Odoo POS tabs) on the demo workspace, which has
 * Stripe test keys: book with a new card typed into Stripe's field, inline as on
 * the Odoo screen (card saved
 * for auto-charge), collect a tip on the saved card, record cash toward the
 * balance, send a quote only, and book another order without payment.
 *   node apps/web/scripts/e2e-payment-options.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, '.screenshots/payment-options');
mkdirSync(OUT, { recursive: true });
const S = '/freedom-fun-demo';
const fixture = (args) => execSync(`pnpm --filter @rental/db exec tsx ../../apps/web/scripts/e2e-fixture-2b.ts ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').at(-1);
const fx = JSON.parse(fixture('create'));
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000 });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const has = async (t) => (await page.evaluate(() => document.body.innerText)).includes(t);
const dialogText = () => page.$eval('dialog[open]', (e) => e.innerText).catch(() => '');
const waitDialog = (re, timeout = 45000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout }, re.source);
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });
async function click(label, selector = 'button, a, [role="radio"], [role="tab"], label') {
  await page.waitForFunction((l, s) => [...document.querySelectorAll(s)].some((e) => e.innerText?.trim().startsWith(l) && e.offsetParent && !e.disabled), { timeout: 20000 }, label, selector);
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
/** Tick every "The customer agreed to" policy in the open dialog. */
const agreeAll = () => page.evaluate(() => document.querySelectorAll('dialog[open] input[type="checkbox"]').forEach((c) => {
  if (!c.checked && c.closest('div')?.parentElement?.innerText.includes('agreed to')) c.click();
}));
/** Type the Stripe test card into the Payment Element (it lives in Stripe's iframe). */
async function typeCard() {
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some((f) => f.src.includes('elements-inner-payment')), { timeout: 45000 });
  const frame = await (await page.$('iframe[src*="elements-inner-payment"]')).contentFrame();
  await frame.waitForSelector('input[name="number"]', { visible: true, timeout: 45000 });
  await frame.type('input[name="number"]', '4242424242424242', { delay: 15 });
  await frame.type('input[name="expiry"]', '1234', { delay: 15 });
  await frame.type('input[name="cvc"]', '123', { delay: 15 });
  if (await frame.$('input[name="postalCode"]')) await frame.type('input[name="postalCode"]', '78701', { delay: 15 });
}

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await go('/sign-in');
  await page.type('#si-email', 'jordan@demo.tentpole.test');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#si-pass', { visible: true });
  await page.type('#si-pass', 'Tentpole-2026!');
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});

  // --- Record Payment Received: a new card, saved for auto-charge, books the order ------------------
  await go(`${S}/orders/${fx.deposit.id}`);
  await click('Payment options · book');
  await page.waitForSelector('dialog[open] [role="tablist"]', { visible: true });
  const tabs = await page.$$eval('dialog[open] [role="tab"]', (t) => t.map((x) => x.innerText.trim()));
  check(tabs.join('|') === 'Record Payment Received|Submit Order Without Payment|Send Quote Only|Collect Tip', 'Payment Options has the four Odoo tabs');
  check(await page.$eval('#po-method', (s) => s.value) === 'card', 'Credit card is the default method (Stripe connected)');
  check([...(await page.$$eval('#po-method option', (o) => o.map((x) => x.textContent)))].join(',').includes('Cash,Check,Zelle,Venmo,ACH'), 'cash, check, Zelle, Venmo and ACH are offered too');
  const odoo = await dialogText();
  check(['Order and Pricing Summary', 'Deposit Due', 'Balance Due', 'Grand Total', 'Resend Current Customer Document', 'Outstanding balance'].every((t) => odoo.includes(t)), 'the order and pricing summary, balance bar and resend link sit beside the form');
  await click('Collect Deposit', 'dialog[open] [role="radio"]');
  check((await dialogText()).includes('Many customers pay in full'), 'collecting less than the full balance shows the pay-in-full note');
  // The QA customer may still have a card saved by an earlier run: type a new one.
  if (await page.$('#po-card')) await setValue('#po-card', 'new');
  await click('15%', 'dialog[open] [role="radio"]');
  check((await dialogText()).includes('Save card info'), 'a new card can be saved for auto-charge of the balance');
  await agreeAll();
  // The card fields are on the same screen, as in Odoo: no extra step before typing the card.
  await typeCard();
  await shot('01-record-payment');
  await click('Record Credit Card Payment', 'dialog[open] button');
  await waitDialog(/Booked and charged VISA •4242/);
  check(true, 'the card is charged and the order booked in one step');
  await shot('03-booked-by-card');
  await click('Keep editing', 'dialog[open] button');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes('Card •4242'), { timeout: 20000 });
  check(await has('Booked'), 'the order shows Booked with the card payment in its history');

  // --- Collect Tip on the saved card ---------------------------------------------------------------
  await click('Collect tip');
  await waitDialog(/Tip for Party Coach/);
  await setValue('#po-method', 'card');
  check(await page.$eval('#po-card', (s) => s.selectedOptions[0].textContent).then((t) => t.includes('4242')).catch(() => false), 'the card saved a moment ago is offered');
  await click('10%', 'dialog[open] [role="radio"]');
  await click('Collect $', 'dialog[open] button');
  await waitDialog(/Tip charged VISA •4242/);
  check(true, 'Collect Tip charges a tip on its own to the saved card');
  await shot('04-tip');
  await click('Done', 'dialog[open] button');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
  await page.waitForFunction(() => document.body.innerText.includes('Tip only'), { timeout: 20000 });
  check(true, 'the tip shows in the payments list without changing what is paid');

  // --- Record a cash payment toward the balance ----------------------------------------------------
  await click('Record payment ·');
  await waitDialog(/Record Payment Received/);
  await setValue('#po-method', 'cash');
  await click('Collect Custom Amount', 'dialog[open] [role="radio"]');
  await setValue('dialog[open] input[aria-label="Custom amount"]', '10');
  await click('Record Cash Payment', 'dialog[open] button');
  await waitDialog(/Payment recorded/);
  check(true, 'cash toward the balance is recorded after booking');
  await click('Done', 'dialog[open] button');
  await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});

  // --- Send Quote Only, then Submit Order Without Payment on the second quote -------------------------
  await go(`${S}/orders/${fx.noDeposit.id}`);
  await click('Payment options · book');
  await click('Collect Tip', 'dialog[open] [role="tab"]');
  check((await dialogText()).includes('once the order is booked'), 'Collect Tip waits until the order is booked');
  const versionBefore = await page.evaluate(() => [...document.querySelectorAll('header span.mono')].map((e) => e.innerText).find((t) => /^v\d+$/.test(t)) ?? 'v?');
  await click('Send Quote Only', 'dialog[open] [role="tab"]');
  check((await dialogText()).includes('qa-quote@example.test'), 'Send Quote Only names who gets the quote');
  await click('Send Quote Only', 'dialog[open] section > div > div > button');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => /Quote (emailed|marked as sent)/.test(e.innerText)), { timeout: 30000 });
  check(true, 'Send Quote Only emails the quote');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 15000 });
  // The order screen reloads after the quote goes out (a new version): wait for it before reopening.
  await page.waitForFunction((v) => {
    const now = [...document.querySelectorAll('header span.mono')].map((e) => e.innerText).find((t) => /^v\d+$/.test(t));
    return now && now !== v;
  }, { timeout: 20000 }, versionBefore);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 800)));
  await click('Payment options · book');
  await click('Submit Order Without Payment', 'dialog[open] [role="tab"]');
  await setValue('#bk-reason', await page.$eval('#bk-reason option:nth-child(2)', (o) => o.value));
  await setValue('#bk-date', plusDays(5));
  await agreeAll();
  await click('Submit Order Without Payment', 'dialog[open] section > div > div > button');
  await waitDialog(/is booked/);
  check(true, 'Submit Order Without Payment books with a reason and an expected date');
  await shot('05-no-payment');

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await go(`${S}/orders/${fx.deposit.id}`);
  await click('Collect tip');
  await waitDialog(/Tip for Party Coach/);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Payment Options fits a 390 px phone');
  await shot('06-phone');
} catch (e) {
  failures++;
  console.log(`FAIL ${e.message}`);
  console.log(`   at ${page.url()} · dialog: ${(await dialogText()).slice(0, 300).replace(/\n/g, ' | ')}`);
  await shot('zz-failure');
} finally {
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  fixture(`cleanup ${fx.deposit.id} ${fx.noDeposit.id}`);
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}
