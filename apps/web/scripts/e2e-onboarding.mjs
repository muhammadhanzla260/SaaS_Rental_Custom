/**
 * End-to-end smoke test in a real browser against a running app:
 * sign up -> 5-step onboarding -> dashboard -> every settings tab -> invite -> theme.
 * Saves screenshots (desktop and phone, light and dark) to .screenshots/.
 *
 *   pnpm --filter @rental/web start   (another terminal)
 *   node apps/web/scripts/e2e-onboarding.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = resolve(import.meta.dirname, '../../../.screenshots');
mkdirSync(OUT, { recursive: true });

const run = Date.now().toString(36);
const email = `owner-${run}@example.test`;
const orgName = `Freedom Fun Demo ${run}`;
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const logoPath = join(tmpdir(), `logo-${run}.svg`);
writeFileSync(logoPath, `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64">
<rect x="2" y="8" width="48" height="48" rx="12" fill="#D32F2F"/><path d="M14 40 L26 20 L38 40Z" fill="#fff"/>
<text x="60" y="42" font-family="Arial" font-weight="700" font-size="26" fill="#1F2937">Freedom Fun</text></svg>`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror on ${new URL(page.url()).pathname}: ${e.message.slice(0, 160)}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) errors.push(`console: ${m.text()}`); });

const desktop = { width: 1440, height: 900 };
// Width only: changing isMobile/hasTouch makes Puppeteer reload the page (losing form state).
const phone = { width: 390, height: 844, deviceScaleFactor: 2 };
const shot = async (name, viewport = desktop) => {
  await page.setViewport(viewport);
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${name}: no horizontal scroll (${overflow}px)`);
};
const clickText = async (text) => {
  const el = await page.waitForSelector(`::-p-xpath(//button[normalize-space(.)=${JSON.stringify(text)}] | //a[normalize-space(.)=${JSON.stringify(text)}])`, { timeout: 10000 });
  await el.click();
};
/** With a Mapbox token the coordinate boxes sit behind "Enter coordinates by hand". */
const revealCoords = async (prefix) => {
  if (await page.$(`#${prefix}-lat`)) return;
  const btn = await page.$('::-p-text(Enter coordinates by hand)');
  if (btn) await btn.click();
  await page.waitForSelector(`#${prefix}-lat`, { timeout: 5000 });
};
const type = async (sel, value) => {
  await page.waitForSelector(sel);
  await page.$eval(sel, (el) => { el.focus(); el.select?.(); });
  await page.type(sel, value);
};

try {
  // --- sign up ------------------------------------------------------------------
  await page.setViewport(desktop);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await shot('00-landing');
  await shot('00-landing-phone', phone);
  await page.setViewport(desktop);
  await page.goto(`${BASE}/sign-up`, { waitUntil: 'networkidle0' });
  await type('#name', 'Hanzla Owner');
  await type('#email', email);
  await type('#password', 'correct-horse-battery');
  await clickText('Create account');
  await page.waitForFunction(() => location.pathname === '/onboarding', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    const el = document.querySelector('#profile-name');
    return !!el && Object.keys(el).some((k) => k.startsWith('__reactProps'));
  }, { timeout: 15000 });
  check(page.url().endsWith('/onboarding'), `new account lands on onboarding (${page.url()})`);

  // --- step 1: business ------------------------------------------------------------
  await clickText('Continue');
  await page.waitForSelector('[aria-invalid="true"]');
  await new Promise((r) => setTimeout(r, 300)); // let the app move focus to the first invalid field
  check(true, 'step 1 blocks Continue when the business name is empty');
  await type('#profile-name', orgName);
  await type('#profile-email', `hello-${run}@example.test`);
  await type('#profile-phone', '5129815557');
  await page.click('#profile-website');
  const phoneVal = await page.$eval('#profile-phone', (e) => e.value);
  check(phoneVal === '(512) 981-5557', `phone formatted on blur: ${phoneVal}`);
  await type('#profile-website', 'https://freedomfunusa.com');
  await type('#profile-address-line1', '700 Congress Ave');
  await type('#profile-address-city', 'Austin');
  await type('#profile-address-region', 'TX');
  await type('#profile-address-postalCode', '78701');
  await page.waitForFunction(() => document.body.innerText.includes('Available'), { timeout: 10000 });
  const slug = await page.$eval('#slug', (e) => e.value);
  check(slug.startsWith('freedom-fun-demo-'), `web address derived from name: ${slug}`);
  await shot('01-onboarding-business');
  await shot('01-onboarding-business-phone', phone);
  await page.setViewport(desktop);
  await clickText('Continue');

  // --- step 2: brand -----------------------------------------------------------------
  await page.waitForSelector('#logo', { timeout: 10000 });
  const fileInput = await page.$('#logo');
  await fileInput.uploadFile(logoPath);
  await page.click('button[aria-label="Cherry"]');
  await page.click('#branding-radius button:nth-child(3)');
  await new Promise((r) => setTimeout(r, 500));
  await shot('02-onboarding-brand');
  await shot('02-onboarding-brand-phone', phone);
  await page.setViewport(desktop);
  await clickText('Continue');

  // --- step 3: location (region is detected, not asked) ---------------------------------------
  await page.waitForSelector('#location-name');
  check((await page.$eval('#location-name', (e) => e.value)) === 'Austin', 'location name suggested from the business city');
  check((await page.$eval('#location-code', (e) => e.value)) === 'AUS', 'location code derived from the name');
  check((await page.$eval('#location-address-line1', (e) => e.value)) === '700 Congress Ave', 'location uses the business address by default');
  // No Mapbox token in this test run: coordinates are typed by hand.
  await revealCoords('location-address');
  await type('#location-address-lat', '30.2690');
  await type('#location-address-lng', '-97.7428');
  await page.waitForFunction(() => document.body.innerText.includes('America/Chicago'), { timeout: 5000 });
  check(true, 'time zone detected from the pin (America/Chicago)');
  await type('#location-loadingNotes', 'Gate code 4321. Load from dock B.');
  await shot('03-onboarding-location');
  await shot('03-onboarding-location-phone', phone);
  await page.setViewport(desktop);
  await clickText('Continue');

  // --- step 4: booking rules (sliders) + create --------------------------------------------------
  await page.waitForSelector('#booking-depositPercent');
  check((await page.$eval('#booking-depositPercent', (e) => e.value)) === '30', 'deposit defaults to 30%');
  await page.$eval('#booking-depositPercent', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '40');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.body.innerText.includes('$400.00 to book'), { timeout: 5000 });
  check(true, 'deposit slider updates the live example ($400 on $1,000)');
  await page.$eval('#booking-defaultTaxPercent', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '8.25');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await shot('04-onboarding-booking');
  await shot('04-onboarding-booking-phone', phone);
  await page.setViewport(desktop);
  await clickText('Create my organization');
  await page.waitForFunction(() => document.body.innerText.includes("You're all set"), { timeout: 15000 });
  check(true, 'celebration shows after creating the organization');
  await page.waitForFunction((s) => location.pathname === '/' + s, { timeout: 15000 }, slug);
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 15000 }).catch(() => {});
  check(page.url().includes(`/${slug}?welcome=1`), `dashboard opened (${page.url()})`);

  // --- dashboard ----------------------------------------------------------------------------------
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  check(brand.toUpperCase() === '#D32F2F', `tenant theme applied: --brand ${brand}`);
  const logoOk = await page.waitForFunction(() => { const img = document.querySelector('aside img'); return !!img && img.complete && img.naturalWidth > 0; }, { timeout: 10000 }).then(() => true, () => false);
  check(logoOk, 'uploaded logo shows in the sidebar');
  await shot('06-dashboard');
  await shot('06-dashboard-phone', phone);
  await page.click('button[aria-label="Open menu"]');
  await page.waitForSelector('[role="dialog"]');
  await shot('06-dashboard-phone-menu', phone);
  await page.click('[role="dialog"] button[aria-label="Close menu"]');
  await page.setViewport(desktop);

  // --- settings tabs ------------------------------------------------------------------------------
  for (const tab of ['general', 'branding', 'locations', 'booking', 'documents', 'team', 'activity']) {
    await page.goto(`${BASE}/${slug}/settings/${tab}`, { waitUntil: 'networkidle0' });
    const h = await page.$eval('h1', (e) => e.textContent);
    check(h === 'Settings', `settings/${tab} renders`);
    await shot(`10-settings-${tab}`);
  }

  // invalid email -> inline error, then fix and save
  await page.goto(`${BASE}/${slug}/settings/general`, { waitUntil: 'networkidle0' });
  check((await page.evaluate(() => document.body.innerText)).includes('America/Chicago'.replace('_', ' ')), 'profile shows the detected time zone');
  await type('#profile-email', 'not-an-email');
  await clickText('Save changes');
  await page.waitForFunction(() => document.body.innerText.includes('Enter a valid email address.'));
  check(true, 'invalid email shows an inline error');
  await type('#profile-email', `office-${run}@example.test`);
  await clickText('Save changes');
  await page.waitForFunction(() => document.body.innerText.includes('Business profile saved.'));
  check(true, 'business profile saves');

  // branding: change colour and verify it applies after save
  await page.goto(`${BASE}/${slug}/settings/branding`, { waitUntil: 'networkidle0' });
  await page.click('button[aria-label="Ocean"]');
  await clickText('Save changes');
  await page.waitForFunction(() => document.body.innerText.includes('Branding saved.'));
  await page.reload({ waitUntil: 'networkidle0' });
  const brand2 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim());
  check(brand2.toUpperCase() === '#0E7C86', `new brand colour applied: ${brand2}`);
  await shot('11-branding-phone', phone);
  await page.setViewport(desktop);

  // locations: primary shows its pin's time zone; add a second location in another zone
  await page.goto(`${BASE}/${slug}/settings/locations`, { waitUntil: 'networkidle0' });
  await shot('12-locations');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('a[href*="/settings/locations/"]:not([href$="/new"])')]);
  check((await page.evaluate(() => document.body.innerText)).includes('America/Chicago'), 'primary location time zone comes from its pin');
  await page.goto(`${BASE}/${slug}/settings/locations/new`, { waitUntil: 'networkidle0' });
  await type('#location-name', 'Los Angeles yard');
  await type('#location-code', 'LAX');
  await type('#location-address-line1', '1 Dock St');
  await type('#location-address-city', 'Los Angeles');
  await revealCoords('location-address');
  await type('#location-address-lat', '34.0522');
  await type('#location-address-lng', '-118.2437');
  await page.waitForFunction(() => document.body.innerText.includes('America/Los Angeles'), { timeout: 5000 });
  check(true, 'new location detects America/Los_Angeles from its pin');
  await clickText('Add location');
  await page.waitForFunction(() => /[0-9a-f-]{36}$/.test(location.pathname) && location.pathname.includes('/settings/locations/'), { timeout: 15000 });
  check(true, 'second location saved');

  // Booking rules: travel fee for a real address, nearest location by driving distance (Odoo POS logic).
  await page.goto(`${BASE}/${slug}/settings/booking`, { waitUntil: 'networkidle0' });
  const tokenOn = !!(await page.$('#travel-check-address'));
  if (tokenOn) {
    await page.type('#travel-check-address', '1100 Congress Ave Austin', { delay: 25 });
    await page.waitForSelector('[role=listbox] [role=option]', { timeout: 10000 });
    await page.click('[role=listbox] [role=option]');
    await page.waitForFunction(() => /ships from/i.test(document.body.innerText), { timeout: 15000 });
    const quote = await page.evaluate(() => document.body.innerText.match(/ships from[\s\S]{0,200}/i)?.[0].replace(/\n+/g, ' | '));
    check(/Austin/.test(quote ?? ''), `travel check picks the Austin location (${quote})`);
    await shot('14-travel-check');
  } else {
    console.log('note: no Mapbox token, travel check skipped');
  }
  await shot('12-location-detail');
  // Viewport capture: shows sticky sidebar and save bar where a person sees them.
  await page.setViewport(desktop);
  await page.screenshot({ path: join(OUT, '12-location-detail-viewport.png') });
  await shot('12-location-detail-phone', phone);
  await page.setViewport(desktop);

  // team: create an invite link
  await page.goto(`${BASE}/${slug}/settings/team`, { waitUntil: 'networkidle0' });
  await type('#invite-email', `crew-${run}@example.test`);
  await page.select('#invite-role', 'crew');
  await clickText('Create invite');
  await page.waitForSelector('input[aria-label="Invitation link"]');
  const link = await page.$eval('input[aria-label="Invitation link"]', (e) => e.value);
  check(link.includes('/invite/'), 'invite link created');
  await shot('13-team');
  await shot('13-team-phone', phone);
  await page.setViewport(desktop);

  // activity log lists the changes
  await page.goto(`${BASE}/${slug}/settings/activity`, { waitUntil: 'networkidle0' });
  const activity = await page.evaluate(() => document.body.innerText);
  check(/created the organization/.test(activity) && /changed the branding/.test(activity) && /invited someone/.test(activity),
    'activity log records creation, branding change and invite');

  // dark mode
  await page.evaluate(() => localStorage.setItem('theme-override', 'dark'));
  await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle0' });
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'personal dark mode applies');
  await shot('20-dashboard-dark');
  await shot('20-dashboard-dark-phone', phone);
  await page.setViewport(desktop);
  await page.goto(`${BASE}/${slug}/settings/branding`, { waitUntil: 'networkidle0' });
  await shot('21-branding-dark');
  await page.goto(`${BASE}/${slug}/settings/locations`, { waitUntil: 'networkidle0' });
  await shot('22-locations-dark');

  // invite acceptance by a second person in a fresh session
  const ctx2 = await browser.createBrowserContext();
  const p2 = await ctx2.newPage();
  await p2.setViewport(desktop);
  await p2.goto(link, { waitUntil: 'networkidle0' });
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle0' }), p2.click('a[href^="/sign-up"]')]);
  await p2.type('#name', 'Crew Member');
  await p2.type('#password', 'another-strong-password');
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle0' }), p2.click('button[type="submit"]')]);
  await p2.waitForSelector('::-p-text(Accept invitation)');
  await Promise.all([p2.waitForNavigation({ waitUntil: 'networkidle0' }), p2.click('::-p-text(Accept invitation)')]);
  check(p2.url().endsWith(`/${slug}`), `invitee joined the organization (${p2.url()})`);
  const settingsLink = await p2.$(`a[href="/${slug}/settings"]`);
  check(!settingsLink, 'crew member does not see Settings');
  await p2.goto(`${BASE}/${slug}/settings/general`, { waitUntil: 'networkidle0' });
  check(p2.url().endsWith(`/${slug}`), 'crew member is sent away from settings');
  await ctx2.close();

  // another tenant's URL is a 404 for this user
  const res = await page.goto(`${BASE}/some-other-org-${run}`, { waitUntil: 'networkidle0' });
  check(res.status() === 404, `unknown organization returns 404 (${res.status()})`);
} catch (e) {
  failures++;
  console.error('FAIL (exception)', e);
  await page.screenshot({ path: join(OUT, 'zz-failure.png'), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('\nBrowser errors:');
  for (const e of [...new Set(errors)]) console.log(' ', e);
}
console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
console.log(`Screenshots: ${OUT}`);
process.exit(failures ? 1 : 0);
