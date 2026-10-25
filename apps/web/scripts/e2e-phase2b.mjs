/**
 * Phase 2b browser QA (quote page, signing, invoices & payments) on the demo workspace,
 * as the customer (phone, signed out) and the owner (desktop) would use it.
 *   node apps/web/scripts/e2e-phase2b.mjs
 * Fresh quotes come from e2e-fixture-2b.ts and are cancelled at the end.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, '.screenshots/phase2b');
mkdirSync(OUT, { recursive: true });
const S = '/freedom-fun-demo';
const fixture = (args) => execSync(`pnpm --filter @rental/db exec tsx ../../apps/web/scripts/e2e-fixture-2b.ts ${args}`, { cwd: ROOT, encoding: 'utf8' });
const fx = JSON.parse(fixture('create').trim().split('\n').at(-1));
const pathOf = (url) => new URL(url).pathname;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000 });
const errors = [];
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Page helpers bound to one tab (the customer and the owner each get their own). */
async function tab(context, viewport) {
  const page = await context.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // Headless Chrome has no clipboard: keep what the app copies.
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } } }); });
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  const h = {
    page,
    shot: (name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true }).catch(() => {}),
    text: () => page.evaluate(() => document.body.innerText),
    has: async (t) => (await h.text()).toLowerCase().includes(t.toLowerCase()),
    waitText: (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x), { timeout }, t.toLowerCase()),
    go: (path) => page.goto(path.startsWith('http') ? path : `${BASE}${path}`, { waitUntil: 'networkidle2' }),
    async click(label, selector = 'button, a, [role="radio"], [role="switch"], [role="tab"], label') {
      await page.waitForFunction((l, s) => [...document.querySelectorAll(s)].some((e) => (e.innerText?.includes(l) || e.getAttribute('aria-label')?.includes(l)) && e.offsetParent && !e.disabled), { timeout: 15000 }, label, selector);
      await page.evaluate((l, s) => {
        const el = [...document.querySelectorAll(s)].find((e) => (e.innerText?.includes(l) || e.getAttribute('aria-label')?.includes(l)) && e.offsetParent && !e.disabled);
        el.scrollIntoView({ block: 'center' });
        el.click();
      }, label, selector);
    },
    async setValue(selector, value) {
      await page.waitForSelector(selector, { visible: true });
      await page.evaluate((s, v) => {
        const el = document.querySelector(s);
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector, value);
    },
    /** The id of the input a visible <label> points at. */
    idFor: (labelText) => page.evaluate((t) => [...document.querySelectorAll('label[for]')].find((l) => l.innerText.trim().startsWith(t) && l.offsetParent)?.htmlFor ?? null, labelText),
    noSideScroll: () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    waitToast: (t, timeout = 30000) => page.waitForFunction((x) => [...document.querySelectorAll('[role="status"]')].some((e) => e.innerText.includes(x)), { timeout }, t),
    href: (label) => page.evaluate((l) => [...document.querySelectorAll('a')].find((a) => a.innerText.includes(l))?.href ?? null, label),
  };
  return h;
}
const POLICIES = ['Weather & payment', 'Setup & electricity', 'Adult supervision & safety', 'Drop-off & pickup charges', 'No silly string'];

try {
  // === Customer, on a phone, signed out ==========================================================
  const customer = await tab(await browser.createBrowserContext(), { width: 390, height: 844, isMobile: true, hasTouch: true });
  const c = customer;

  // --- No-deposit quote: Review → Policies → Sign → Book → Done ---------------------------------
  await c.go(fx.noDeposit.url);
  await c.waitText('Hi Quinn');
  check(await c.has('Freedom Fun USA') && await c.has('Giant Jenga'), 'quote page shows the brand and the items');
  check(await c.noSideScroll(), 'quote page fits a 390 px phone');
  await c.shot('01-quote-review-phone');
  await c.click('Looks good');
  await c.waitText('A few things to agree on');
  check(await c.has('No silly string') && await c.has('$75/hour'), 'Freedom Fun’s own policies are shown (agreement settings)');
  const blocked = await c.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Continue to sign'))?.disabled);
  check(blocked === true, 'cannot continue until every policy is accepted');
  for (const p of POLICIES) await c.click(p, 'button[aria-pressed]');
  await c.click('No thanks', 'button[aria-pressed]');
  await c.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Continue to sign') && !b.disabled), { timeout: 20000 });
  check(true, 'all policies ticked and the damage waiver declined');
  await c.shot('02-policies-phone');
  await c.click('Continue to sign');
  await c.waitText('Freedom Fun USA rental contract');
  check(await c.has('Hold harmless') && await c.has('Texas state law'), 'the signed text is the Freedom Fun lease');
  await c.setValue('#q-name', 'Quinn Tester');
  await c.page.evaluate(() => document.querySelector('main input[type="checkbox"]').click());
  await c.shot('03-sign-phone');
  await c.click('Sign and continue');
  await c.waitText('Nothing to pay today');
  await c.click('Book it');
  await c.waitText('booked, Quinn');
  const fresh = await c.has('Signed agreement');
  check(fresh && await c.has('Add to calendar') && /Balance · (due|charged)/.test(await c.text()), 'Done shows the balance date and the calendar and signed-agreement downloads');
  await c.shot('04-done-phone');

  const agreementUrl = await c.href('Signed agreement');
  const icsUrl = await c.href('Add to calendar');
  const ics = await c.page.evaluate(async (u) => { const r = await fetch(u); return { type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), body: await r.text() }; }, icsUrl);
  check(ics.type?.startsWith('text/calendar') && /attachment; filename=".+\.ics"/.test(ics.disp ?? ''), 'calendar file downloads as .ics');
  check(ics.body.includes('BEGIN:VCALENDAR') && /DTSTART:\d{8}T\d{6}Z/.test(ics.body) && ics.body.includes('LOCATION:1100 Congress Ave') && ics.body.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'calendar event has UTC times, the address and folded lines');
  await c.go(agreementUrl);
  await c.waitText('Signature');
  check(await c.has('Quinn Tester') && await c.has('Declined') && await c.has('2026-10'), 'signed agreement shows name, version and the waiver choice');
  check(await c.page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'printable documents are always light');
  check(await c.noSideScroll(), 'signed agreement fits a phone');
  await c.shot('05-agreement-print-phone');
  await c.go(fx.noDeposit.url);
  await c.waitText('booked, Quinn');
  check(true, 'opening the link again goes straight to Done');

  // --- Documents the quote email links to, before signing --------------------------------------
  await c.go(`${fx.deposit.url}/print?doc=quote`);
  await c.waitText('Print or save as PDF');
  check(await c.has(fx.deposit.number) && await c.has('Deposit to book'), '"Download Quote (PDF)" opens the quote document');
  await c.go(`${fx.deposit.url}/print?doc=agreement`);
  await c.waitText('Not signed yet');
  check(await c.has('Hold harmless') && await c.has('Policies to accept'), '"Download Contract (PDF)" opens the contract to sign');

  // --- Deposit quote: request changes, then sign and reach Pay ----------------------------------
  await c.go(fx.deposit.url);
  await c.waitText('Hi Quinn');
  await c.click('Request changes');
  await c.page.waitForSelector('dialog[open] textarea', { visible: true });
  await c.setValue('dialog[open] textarea', 'Could we add a second Jenga?');
  await c.click('Send to Freedom Fun USA');
  await c.waitToast('will get back to you');
  check(true, 'request changes sends a message to the office');
  await c.click('Looks good');
  for (const p of POLICIES) await c.click(p, 'button[aria-pressed]');
  await c.click('Add it', 'button[aria-pressed]');
  await c.page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('Continue to sign') && !b.disabled), { timeout: 20000 });
  await c.click('Continue to sign');
  await c.setValue('#q-name', 'Quinn Tester');
  await c.page.evaluate(() => document.querySelector('main input[type="checkbox"]').click());
  await c.click('Sign and continue');
  await c.waitText('Pay to book');
  const stripeOn = await c.has('Continue to card');
  check(stripeOn || await c.has('switched on card payments'), `Pay step ${stripeOn ? 'offers the card form (Stripe connected)' : 'explains card payments are not switched on yet'}`);
  if (stripeOn) {
    // Like the Odoo quote email: pay in full, or the deposit and the rest later.
    check(await c.page.$$eval('[role="radio"]', (r) => r.map((e) => e.innerText).join('|')).then((t) => t.includes('Pay in full') && t.includes('Pay deposit')), 'Pay step offers Pay in full or Pay deposit');
    await c.click('Pay in full', '[role="radio"]');
    check(!(await c.has('Save my card')) && await c.has('booking is all set'), 'choosing Pay in full drops the save-card box (nothing left for the event day)');
    await c.click('Pay deposit', '[role="radio"]');
    check(await c.has('Save my card'), 'the deposit choice offers to save the card for the balance');
  }
  await c.shot('06-pay-phone');

  // === Owner, desktop ==============================================================================
  const owner = await tab(await browser.createBrowserContext(), { width: 1440, height: 1000 });
  const o = owner;
  await o.go('/sign-in');
  await o.page.type('#si-email', 'jordan@demo.tentpole.test');
  await o.page.keyboard.press('Enter');
  await o.page.waitForSelector('#si-pass', { visible: true });
  await o.page.type('#si-pass', 'Tentpole-2026!');
  await o.page.keyboard.press('Enter');
  await o.page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });

  // --- Order screen: invoices + copy link ---------------------------------------------------------
  await o.go(`${S}/orders/${fx.noDeposit.id}`);
  await o.waitText('Invoices');
  check(await o.has('Full') || await o.has('Balance'), 'the booked order lists its invoice');
  await o.click('Copy customer link');
  await o.waitToast('Customer link copied');
  const copied = await o.page.evaluate(() => window.__copied);
  check(copied && pathOf(copied) === pathOf(fx.noDeposit.url), 'Copy customer link gives the same link the customer got');
  await o.shot('07-order-invoices');

  // --- Invoices screen: record a cash payment with a receipt ---------------------------------------
  const invoiceHref = await o.page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.href.includes('/invoices?id='))?.href);
  await o.go(invoiceHref);
  await o.waitText('Amount due');
  check(await o.has('Outstanding') && await o.has('Collected this month'), 'invoices screen shows the KPIs');
  check(await o.has(fx.noDeposit.number), 'the invoice preview is for the QA order');
  await o.shot('08-invoices');
  await o.click('Record payment');
  await o.page.waitForSelector('#rp-method', { visible: true });
  await o.setValue('#rp-method', 'cash');
  await o.setValue('#rp-tip', '5');
  await o.click('Record $', 'dialog[open] button');
  await o.waitText('Payment recorded');
  check(true, 'cash payment (with a tip) recorded against the invoice');
  if (await o.page.$('dialog[open]')) await o.click('Done', 'dialog[open] button');
  await o.page.waitForFunction(() => /Paid/.test(document.body.innerText), { timeout: 20000 });
  await o.shot('09-invoice-paid');
  // The receipt is queued for the customer (delivered to .data/outbox, or live when MESSAGING_DELIVERY=live).
  await o.go(`${S}/settings/messaging?tab=log&q=${fx.noDeposit.number}`);
  await o.waitText('Payment confirmation (paid)');
  check(await o.page.evaluate(() => [...document.querySelectorAll('li')].some((li) => li.innerText.includes('Payment confirmation (paid)') && li.innerText.includes('qa-quote@example.test'))),
    'paying the whole balance logs a "Payment confirmation (paid)" email to the customer');

  // --- Printable invoice (staff) and receipt (customer) -------------------------------------------
  const invoiceId = new URL(invoiceHref).searchParams.get('id');
  await o.go(`/print${S}/invoices/${invoiceId}`);
  await o.waitText('Print or save as PDF');
  check(await o.has(fx.noDeposit.number) && await o.has('Amount due'), 'printable invoice opens outside the app shell');
  check(!(await o.page.$('nav[aria-label]')) || !(await o.has('Calendar')), 'no sidebar on the printable invoice');
  await o.shot('10-invoice-print');
  await c.go(fx.noDeposit.url);
  await c.waitText('booked, Quinn');
  const receiptUrl = await c.href('Receipt');
  check(!!receiptUrl, 'customer Done page now offers the receipt');
  if (receiptUrl) {
    await c.go(receiptUrl);
    await c.waitText('Payment receipt');
    check(await c.has('Cash') && await c.has('Tip') && await c.has('Balance remaining'), 'receipt shows method, tip and the balance');
    await c.shot('11-receipt-phone');
  }

  // --- Settings: agreement editor and Stripe key checks --------------------------------------------
  await o.go(`${S}/settings/workspace?tab=agreement`);
  await o.waitText('Policies to accept');
  check(await o.page.$eval('#ag-title', (e) => e.value) === 'Freedom Fun USA rental contract', 'agreement tab loads the workspace’s own agreement');
  await o.setValue('#ag-title', 'Freedom Fun USA rental contract (edited)');
  await o.waitText('wording changed but the version did not');
  check(true, 'changing the wording asks for a new version');
  await o.shot('12-agreement-settings');
  await o.click('Discard');

  await o.go(`${S}/settings/workspace?tab=connect`);
  await o.waitText('Card payments');
  await o.click('Stripe', '[role="radio"], label, button');
  const pk = await o.idFor('Publishable key');
  const sk = await o.idFor('Secret key');
  await o.setValue(`#${pk}`, 'pk_live_mismatch123');
  await o.setValue(`#${sk}`, 'sk_test_mismatch123');
  await o.click('Save changes');
  await o.waitText('matching pair');
  check(true, 'a live publishable key with a test secret key is refused before saving');
  await o.shot('13-stripe-mismatch');
  await o.click('Discard');

  // --- Month calendar (Odoo counts) ----------------------------------------------------------------
  await o.go(`${S}/calendar?loc=all&date=${fx.day}`);
  await o.waitText('Calendar counts');
  const cell = await o.page.evaluate((d) => {
    const label = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const el = [...document.querySelectorAll('[role="gridcell"]')].find((c) => c.getAttribute('aria-label') === label);
    return el ? [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')) : null;
  }, fx.day);
  check(!!cell && cell.some((l) => l.startsWith('Delivery:')) && cell.some((l) => l.startsWith('Quote:')), `month view counts the booked QA order as a delivery and the open one as a quote (${cell?.join(', ')})`);
  await o.page.evaluate((d) => {
    const label = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    [...document.querySelectorAll('[role="gridcell"]')].find((c) => c.getAttribute('aria-label') === label).querySelector('button[aria-label^="Delivery"]').click();
  }, fx.day);
  await o.page.waitForSelector('dialog[open]', { visible: true });
  check(await o.page.$eval('dialog[open]', (e) => e.innerText.includes('Quinn Tester') && e.innerText.includes('Booked')), 'clicking a count lists that day’s orders');
  await o.shot('15-month-calendar');
  await o.page.keyboard.press('Escape');

  // --- Phones: staff screens fit --------------------------------------------------------------------
  await o.page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  for (const [path, name] of [[`${S}/calendar?loc=all`, 'month calendar'], [`${S}/invoices`, 'invoices'], [`${S}/orders/${fx.noDeposit.id}`, 'order'], [`${S}/settings/workspace?tab=agreement`, 'agreement settings']]) {
    await o.go(path);
    await sleep(400);
    check(await o.noSideScroll(), `${name} fits a 390 px phone`);
  }
  await o.go(`${S}/invoices`);
  await o.shot('14-invoices-phone');
} catch (e) {
  failures++;
  console.log(`FAIL ${e.message}`);
} finally {
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
  try { fixture(`cleanup ${fx.deposit.id} ${fx.noDeposit.id}`); } catch (e) { console.log(`cleanup: ${e.message}`); }
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
}
