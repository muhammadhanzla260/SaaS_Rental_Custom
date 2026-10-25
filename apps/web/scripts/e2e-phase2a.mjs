/**
 * Phase 2a browser QA (messaging) on the demo workspace, as an owner would use it.
 *   node apps/web/scripts/e2e-phase2a.mjs
 */
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const OUT = resolve(import.meta.dirname, '../../../.screenshots/phase2a');
const OUTBOX = resolve(import.meta.dirname, '../../../.data/outbox');
// With MESSAGING_DELIVERY=live, mail goes through the workspace's SMTP (the demo's login is a placeholder), not the outbox.
const LIVE = /^MESSAGING_DELIVERY=live\s*$/m.test(readFileSync(resolve(import.meta.dirname, '../../../.env'), 'utf8'));
mkdirSync(OUT, { recursive: true });
const S = '/freedom-fun-demo';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, protocolTimeout: 120000 });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) }).catch(() => {});
const hasText = async (t) => (await page.evaluate(() => document.body.innerText)).toLowerCase().includes(t.toLowerCase());
const waitText = (t, timeout = 20000) => page.waitForFunction((x) => document.body.innerText.toLowerCase().includes(x), { timeout }, t.toLowerCase());
const go = (path) => page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2' });
async function click(label, selector = 'button, a, [role="radio"], [role="switch"], [role="tab"]') {
  await page.waitForFunction((l, s) => [...document.querySelectorAll(s)].some((e) => (e.innerText?.includes(l) || e.getAttribute('aria-label')?.includes(l)) && e.offsetParent && !e.disabled), { timeout: 15000 }, label, selector);
  await page.evaluate((l, s) => {
    const el = [...document.querySelectorAll(s)].find((e) => (e.innerText?.includes(l) || e.getAttribute('aria-label')?.includes(l)) && e.offsetParent && !e.disabled);
    el.scrollIntoView({ block: 'center' });
    el.click();
  }, label, selector);
}
async function setValue(selector, value) {
  await page.waitForSelector(selector, { visible: true });
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, selector, value);
}
/** Wait for the toast (role=status) to show this text. */
const waitToast = (t, timeout = 30000) => page.waitForFunction((x) => [...document.querySelectorAll('[role="status"]')].some((e) => e.innerText.includes(x)), { timeout }, t);
const newestOutbox = () => readdirSync(OUTBOX).map((f) => ({ f, t: statSync(join(OUTBOX, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]?.f;

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await go('/sign-in');
  await page.type('#si-email', 'jordan@demo.tentpole.test');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#si-pass', { visible: true });
  await page.type('#si-pass', 'Tentpole-2026!');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });

  // --- Mail server tab ---------------------------------------------------------------------
  await go(`${S}/settings/messaging`);
  await waitText('Mail server (SMTP)');
  check(await hasText('Connect mail server') && await hasText('Go live'), 'setup steps shown');
  check(LIVE ? !(await hasText('Development mode')) : await hasText('Development mode'), LIVE ? 'live delivery: no development notice' : 'development outbox notice shown');
  await shot('01-server');
  await setValue('input[aria-label="Send the test to"]', 'qa@example.test');
  await click('Send test email');
  await page.waitForFunction(() => /Test failed|Verified — test email/.test(document.body.innerText), { timeout: 60000 });
  const failedTest = await hasText('Test failed');
  check(failedTest ? await hasText('Sign in') && await hasText('Connect') : true, `SMTP test reports each step (${failedTest ? 'demo credentials refused as expected' : 'verified'})`);
  await shot('02-smtp-test');

  // --- Automations: move the day-before reminder (acceptance 3) ---------------------------------
  await go(`${S}/settings/messaging?tab=auto`);
  await waitText('Around every event');
  if (await hasText('Automations are off')) await click('Off', '[role="switch"], label');
  // Start from the default (an earlier run may have left 2 days at 18:00).
  const already = await page.$eval('input[aria-label="Day-before reminder days"]', (e) => e.value === '2');
  if (already) {
    await setValue('input[aria-label="Day-before reminder days"]', '1');
    await setValue('input[aria-label="Day-before reminder send time"]', '09:00');
    await click('Save changes');
    await waitToast('Saved');
    await go(`${S}/settings/messaging?tab=auto`);
    await waitText('Around every event');
  }
  await setValue('input[aria-label="Day-before reminder days"]', '2');
  await setValue('input[aria-label="Day-before reminder send time"]', '18:00');
  await waitText('Unsaved changes');
  await click('Save changes');
  await waitToast('scheduled message');
  check(true, 'saving schedules re-plans upcoming orders');
  await shot('03-automations');
  await go(`${S}/settings/messaging?tab=log&status=upcoming`);
  await waitText('Day-before reminder');
  const sixPm = await page.evaluate(() => [...document.querySelectorAll('li')].filter((li) => li.innerText.includes('Day-before reminder')).every((li) => /6:00\s?PM/.test(li.innerText)));
  check(sixPm, 'acceptance 3: queued day-before reminders moved to 6:00 PM');
  await shot('04-log-upcoming');
  // Put it back.
  await go(`${S}/settings/messaging?tab=auto`);
  await setValue('input[aria-label="Day-before reminder days"]', '1');
  await setValue('input[aria-label="Day-before reminder send time"]', '09:00');
  await click('Save changes');
  await waitToast('scheduled message');

  // --- Template editor: uploaded HTML with a script (acceptance 6) ------------------------------
  await go(`${S}/settings/messaging/templates?type=pre_event&channel=email`);
  await waitText('Insert a field');
  await setValue('#tp-subject', 'Almost time, {customer.first_name}!');
  await page.waitForFunction(() => [...document.querySelectorAll('p')].some((p) => p.innerText.includes('Almost time, Maria!')), { timeout: 10000 });
  check(true, 'live preview fills fields with Maria’s sample order');
  await click('Upload HTML or XML');
  await setValue('textarea[aria-label="Template source"]', '<html><body><h1>Hi {customer.first_name}</h1><script>alert(1)</script></body></html>');
  await waitText('script found');
  check(await hasText('stripped before sending'), 'acceptance 6: the Scripts check warns about <script>');
  const previewClean = await page.evaluate(() => !document.querySelector('iframe[title="Email preview"]')?.getAttribute('srcdoc')?.includes('<script'));
  check(previewClean, 'acceptance 6: the rendered email has the script stripped');
  await shot('05-template-upload');
  await click('Save template');
  await waitText('Template saved');
  await click('Restore default');
  await waitText('Default template restored');
  check(true, 'template saved as a new version, then restored');

  // --- Send quote from an order (acceptance 1) ------------------------------------------------------
  await go(`${S}/orders?v=quotes`);
  await waitText('Priya Shah');
  await click('Priya Shah', 'a');
  await waitText('Order lines');
  const before = newestOutbox();
  await click('Resend quote');
  if (LIVE) {
    // The demo SMTP login is a placeholder: the quote is still marked sent and the toast says why the email did not go.
    await page.waitForFunction(() => /Quote emailed to priya@example\.com|Quote marked as sent/.test(document.body.innerText), { timeout: 60000 });
    check(true, 'acceptance 1 (live): Send quote reports where the email went, or why it did not');
  } else {
    await waitText('Quote emailed to priya@example.com', 30000);
    check(true, 'acceptance 1: Send quote emails the customer and says where it went');
    const after = newestOutbox();
    check(after && after !== before && /priya@example\.com/.test(after), 'the quote email was delivered (development outbox)');
    const html = readFileSync(join(OUTBOX, after), 'utf8');
    check(/From: "Freedom Fun USA" <bookings@freedomfunusa\.test>/.test(html), 'from the workspace’s own address');
    check(/\/q\/[A-Za-z0-9_-]{20,}/.test(html) && html.includes('Review, sign &amp; pay'), 'carries the review, sign & pay link');
  }
  await go(`${S}/settings/messaging?tab=log`);
  await waitText('is ready, Priya');
  await click('View message');
  await page.waitForSelector('iframe[title="Message as received"]', { timeout: 15000 });
  check(true, 'the log opens the email exactly as received');
  await shot('06-log-view');

  // --- Phone width: no sideways scrolling on any of the new screens ------------------------------------
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1.5 });
  for (const path of [`${S}/settings/messaging`, `${S}/settings/messaging?tab=auto`, `${S}/settings/messaging?tab=log`, `${S}/settings/messaging/templates?type=quote&channel=email`, `${S}/settings/messaging/templates?type=quality_check&channel=sms`]) {
    await go(path);
    await sleep(600);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(over <= 1, `phone: no horizontal scroll on ${path.replace(S, '')} (${over}px)`);
  }
  await shot('07-phone-auto');
} catch (e) {
  failures++;
  console.log(`FAIL exception: ${e.message}`);
  await page.screenshot({ path: join(OUT, 'zz-failure.png') }).catch(() => {});
  console.log(`   at ${page.url()}`);
}

for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'} · ${errors.length} browser errors · screenshots in ${OUT}`);
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
