/**
 * Phase 0 end-to-end QA in a real browser against a running app:
 * register → 6-step onboarding → home → settings (workspace, locations, team)
 * → platform console (create org, suspend, support session, delete)
 * → isolation (org B cannot see org A). Screenshots at 1440 px and 390 px go to .screenshots/phase0/.
 *
 *   pnpm --filter @rental/web start      (another terminal)
 *   node apps/web/scripts/e2e-phase0.mjs
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = resolve(import.meta.dirname, '../../..');
const OUT = join(ROOT, '.screenshots/phase0');
mkdirSync(OUT, { recursive: true });

const run = Date.now().toString(36).slice(-5);
const PASSWORD = 'Tentpole-2026!';
const owner = { name: 'Jordan Reyes', email: `jordan-${run}@lakeside.test` };
const admin = { name: 'Muhammad Hanzla', email: `platform-${run}@tentpole.test` };
const orgName = `Lakeside Party Rentals ${run}`;
const slug = `lakeside-${run}`;

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const logoPath = join(tmpdir(), `logo-${run}.svg`);
writeFileSync(logoPath, `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><path d="M20 66 L44 14 L68 66Z" fill="#E4572E"/><rect x="14" y="66" width="60" height="4" rx="2" fill="#10131A"/><text x="84" y="46" font-family="Arial" font-weight="700" font-size="28" fill="#1B2A41">Lakeside</text><text x="86" y="64" font-family="Arial" font-size="11" letter-spacing="3" fill="#E4572E">PARTY RENTALS</text></svg>`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'], protocolTimeout: 60000 });
let page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
// Full-page captures freeze off-screen entrance animations; reduced motion turns them off (and checks that path).
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror ${new URL(p.url()).pathname}: ${e.message.slice(0, 200)}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 404|mapbox|events.mapbox/i.test(m.text())) errors.push(`console ${new URL(p.url()).pathname}: ${m.text().slice(0, 200)}`); });
};
watch(page);

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844, deviceScaleFactor: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name, both = true) {
  for (const [tag, vp] of both ? [['desktop', desktop], ['phone', phone]] : [['desktop', desktop]]) {
    await page.setViewport(vp);
    // Elements that switch display at a breakpoint replay their entrance animation; let it finish.
    await sleep(1300);
    // Cap very tall pages (long lists) so Chrome does not run out of memory capturing them.
    const h = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 4000);
    await page.screenshot({ path: join(OUT, `${name}-${tag}.png`), clip: { x: 0, y: 0, width: vp.width, height: h }, captureBeyondViewport: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${name} (${tag}): no horizontal scroll (${overflow}px)`);
  }
  await page.setViewport(desktop);
}
const go = async (path) => { await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' }); };
const byText = (text, tag = '*') => `::-p-xpath(//${tag}[normalize-space(.)=${JSON.stringify(text)}])`;
/** Click the visible button or link whose visible text is exactly `text`, once it is enabled (like a person). */
async function click(text, tag = 'button') {
  const handle = await page.waitForFunction(
    (t, tg) => [...document.querySelectorAll(tg === 'a' ? 'a' : tg === 'button' ? 'button' : 'button,a')]
      .find((e) => e.innerText.replace(/\s+/g, ' ').trim() === t && e.offsetParent !== null && !e.disabled) ?? null,
    { timeout: 15000 }, text, tag,
  );
  await handle.asElement().click();
}
async function type(sel, value, clear = true) {
  const el = await page.waitForSelector(sel, { visible: true, timeout: 15000 });
  if (clear) await el.evaluate((e) => { e.focus(); e.select?.(); });
  await el.type(value);
}
async function waitUrl(re, timeout = 20000) {
  await page.waitForFunction((src) => new RegExp(src).test(location.pathname + location.search), { timeout }, re.source);
}
async function hasText(text) {
  return page.evaluate((t) => document.body.innerText.includes(t), text);
}
async function signOutAll() {
  await page.deleteCookie(...(await page.cookies()));
}
async function signIn(email, password) {
  await signOutAll();
  await go('/sign-in');
  await type('#si-email', email);
  await click('Continue');
  await type('#si-pass', password);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });
}

try {
  // ---------------------------------------------------------------- 03 Sign in + 01 Register
  await go('/sign-in');
  check(await hasText('Run every rental from quote to cleanup.'), 'sign-in hero copy');
  await shot('03-sign-in');

  await go('/register');
  await shot('01-register-empty');
  await type('#r-biz', orgName);
  await page.waitForFunction(() => document.body.innerText.includes('Available'), { timeout: 10000 });
  check(await page.$eval('#r-slug', (e) => e.value).then((v) => v.startsWith('lakeside-party-rentals')), 'workspace URL follows the business name');
  await page.$eval('#r-slug', (e) => { e.focus(); e.select(); });
  await page.keyboard.type(slug);
  await page.waitForFunction(() => document.body.innerText.includes('Available'), { timeout: 10000 });
  await type('#r-name', owner.name);
  await type('#r-email', owner.email);
  await type('#r-pass', PASSWORD);
  await click('Create my workspace');
  await sleep(600);
  check(await hasText('Please agree to the Terms'), 'register requires accepting the terms');
  await page.click('input[type=checkbox]');
  await shot('01-register-filled', false);
  await click('Create my workspace');
  await waitUrl(new RegExp(`/onboarding/${slug}`));
  check(true, 'register → onboarding');

  // ---------------------------------------------------------------- 02 Onboarding
  await page.waitForSelector('#profile-name');
  await shot('02-step1-profile');
  await click('Continue');
  await sleep(500);
  check(await hasText('Enter the business phone.'), 'step 1: phone is required');
  await type('#profile-legalName', `${orgName} LLC`);
  await type('#profile-phone', '(512) 555-0100');
  await type('#profile-email', 'bookings@lakeside.test');
  await click('Continue');
  await page.waitForSelector(byText('Brand & theme', 'h1'), { timeout: 15000 });

  const file = await page.$('input[type=file][aria-label="Upload logo"]');
  await file.uploadFile(logoPath);
  await page.waitForSelector('img[alt="Logo preview"]', { timeout: 10000 });
  await page.click('[role=radio][aria-label="Berry"]');
  await sleep(300);
  check(await hasText('passes for all text sizes'), 'brand: contrast readout for Berry passes');
  await click('Square icon');
  await page.click('::-p-xpath(//div[@role="radiogroup" and @aria-label="Shape"]//button[normalize-space(.)="Circle"])');
  await shot('02-step2-brand');
  await click('Continue');
  await page.waitForSelector(byText('Warehouse & service area', 'h1'), { timeout: 15000 });

  await type('#warehouse-location-address-line1', '1100 Congress Ave');
  await page.keyboard.press('Escape');
  await type('#warehouse-location-address-city', 'Austin');
  await type('#warehouse-location-address-postalCode', '78701');
  const coords = await page.$('::-p-text(Enter coordinates by hand)');
  if (coords) await coords.click();
  await type('#warehouse-location-address-lat', '30.2747');
  await type('#warehouse-location-address-lng', '-97.7404');
  await type('#wh-tax', '8.25');
  await type('#wh-zips', '78701, 78702 78703');
  await sleep(300);
  check((await page.$eval('#wh-code', (e) => e.value)) === 'AUS', 'warehouse code follows the city (AUS)');
  await shot('02-step3-warehouse');
  await click('Continue');
  await page.waitForSelector(byText('Email, SMS & payments', 'h1'), { timeout: 15000 });
  await shot('02-step4-connect');
  await click('Skip for now');
  await page.waitForSelector(byText('Invite your team', 'h1'), { timeout: 15000 });
  await type('input[aria-label="Invite email 1"]', `sam-${run}@lakeside.test`);
  await shot('02-step5-team', false);
  await click('Send invites');
  await page.waitForSelector('::-p-text(Copy link)', { timeout: 15000 });
  check(true, 'team: invite created (dev outbox → copy link)');
  await click('Continue');
  await page.waitForSelector(byText('Review & launch', 'h1'), { timeout: 15000 });
  await page.click('::-p-xpath(//button[@role="radio"][.//span[normalize-space(.)="Scale"]])');
  await shot('02-step6-launch');
  await click('Launch workspace');
  await page.waitForSelector('::-p-text(is set up.)', { timeout: 20000 });
  await shot('02-done');
  await click('Go to my workspace', 'a');
  await waitUrl(new RegExp(`^/${slug}$`));

  // ---------------------------------------------------------------- 04 Home
  await page.waitForSelector('::-p-text(setup steps done)', { timeout: 15000 });
  check(await hasText('Lakeside Party Rentals') && await hasText('AUS'), 'home: org and location card');
  await shot('04-home');
  // Sidebar uses the tenant colour (Berry) for the primary button
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase());
  check(accent === '#B0306A', `tenant accent applied (${accent})`);
  // Mark "Review rental rules" done by hand
  await page.click('::-p-xpath(//button[contains(@aria-label, "Review rental rules")])');
  await sleep(1200);
  check(await page.$('::-p-xpath(//button[@aria-pressed="true"][contains(@aria-label, "Review rental rules")])') !== null, 'home: manual setup tick saved');

  // Phone menu
  await page.setViewport(phone);
  await sleep(300);
  await page.click('button[aria-label="Open menu"]');
  await page.waitForSelector('[role=dialog][aria-label="Menu"]', { visible: true });
  await page.screenshot({ path: join(OUT, '04-home-phone-menu.png') });
  await page.click('button[aria-label="Close menu"]');
  await page.setViewport(desktop);

  // ⌘K
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForSelector('dialog[open][aria-label="Search or jump to"]', { timeout: 5000 });
  await page.keyboard.type('team');
  await page.screenshot({ path: join(OUT, '04-command-palette-desktop.png') });
  await page.keyboard.press('Enter');
  await waitUrl(/\/settings\/team/);
  check(true, '⌘K jumps to Team & roles');

  // ---------------------------------------------------------------- 06 Team & roles
  await page.waitForSelector('::-p-text(What each role can do)');
  check(await hasText('Invited'), 'team: onboarding invite listed as Invited');
  await shot('06-team');
  await click('Invite people');
  await page.waitForSelector('#tm-email', { visible: true });
  await type('#tm-email', `priya-${run}@lakeside.test`);
  await type('#tm-name', 'Priya Nair');
  await page.select('#tm-role', 'manager');
  await sleep(200);
  await page.screenshot({ path: join(OUT, '06-team-invite-drawer-desktop.png') });
  await click('Send invite');
  await page.waitForSelector('::-p-text(copy this link)', { timeout: 15000 });
  check(true, 'team: manager invited with link');
  await click('Done');

  // ---------------------------------------------------------------- 07 Workspace & brand
  await go(`/${slug}/settings/workspace`);
  await page.waitForSelector('::-p-text(Where it appears)');
  await shot('07-workspace-brand');
  await go(`/${slug}/settings/workspace?tab=rules`);
  await page.waitForSelector('#rr-deposit');
  await page.focus('#rr-deposit');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('::-p-text(Unsaved changes)', { timeout: 5000 });
  await shot('07-workspace-rules', false);
  await click('Save changes');
  // Saved = the unsaved-changes bar goes away (the 3 s toast is too short to rely on).
  await page.waitForFunction(() => !document.body.innerText.includes('Unsaved changes'), { timeout: 15000 });
  await go(`/${slug}/settings/workspace?tab=rules`);
  check(await page.$eval('#rr-deposit', (e) => e.value) === '35', 'rental rules: deposit changed to 35% and saved');
  for (const tab of ['profile', 'warehouses', 'payments']) {
    await go(`/${slug}/settings/workspace?tab=${tab}`);
    await sleep(300);
    await shot(`07-workspace-${tab}`, tab === 'profile');
  }

  // ---------------------------------------------------------------- 05 Locations
  await go(`/${slug}/settings/locations`);
  await page.waitForSelector('#loc-name');
  await shot('05-locations');
  await go(`/${slug}/settings/locations?new=1`);
  await type('#loc-name', 'Dallas');
  await type('#address-line1', '2200 Ross Ave');
  await page.keyboard.press('Escape');
  await type('#address-city', 'Dallas');
  const c2 = await page.$('::-p-text(Enter coordinates by hand)');
  if (c2) await c2.click();
  await type('#address-lat', '32.7887');
  await type('#address-lng', '-96.7997');
  await click('Add location');
  await waitUrl(/locations\?id=/);
  await page.waitForSelector('::-p-text(Location added)', { timeout: 10000 });
  check(await hasText('DAL'), 'locations: Dallas added with code DAL');
  await go(`/${slug}/settings/locations?id=${new URL(page.url()).searchParams.get('id')}&tab=tax`);
  await page.waitForSelector('::-p-text(Document numbers)');
  check(await hasText('Q-DAL-00001'), 'numbering: next quote at Dallas is Q-DAL-00001');
  await shot('05-locations-tax', false);

  // ---------------------------------------------------------------- Second org (for isolation + console)
  await signOutAll();
  await go('/register');
  await type('#r-biz', `Summit Tent ${run}`);
  await page.waitForFunction(() => document.body.innerText.includes('Available'), { timeout: 10000 });
  await type('#r-name', admin.name);
  await type('#r-email', admin.email);
  await type('#r-pass', PASSWORD);
  await page.click('input[type=checkbox]');
  await click('Create my workspace');
  await waitUrl(/\/onboarding\//);
  // Isolation: another org's workspace answers 404, not 403
  const res = await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle0' });
  check(res.status() === 404, `isolation: org B member gets 404 on org A (${res.status()})`);
  const resConsole = await page.goto(`${BASE}/console`, { waitUntil: 'networkidle0' });
  check(resConsole.status() === 404, `console is hidden (404) from non-admins (${resConsole.status()})`);

  // ---------------------------------------------------------------- 00 Platform console
  execSync(`pnpm --silent platform:admin ${admin.email}`, { cwd: ROOT, stdio: 'pipe' });
  await signIn(admin.email, PASSWORD);
  await waitUrl(/^\/console/);
  check(true, 'platform owner lands in the console');
  await page.waitForSelector(`::-p-text(${orgName})`);
  await shot('00-console');
  await click('New organization');
  await page.waitForSelector('#o-name', { visible: true });
  await type('#o-name', `Bayou Bounce ${run}`);
  await type('#o-owner', 'Casey Martin');
  await type('#o-email', `casey-${run}@bayou.test`);
  await page.waitForFunction(() => document.body.innerText.includes('✓ Available'), { timeout: 10000 });
  await page.screenshot({ path: join(OUT, '00-console-new-org-desktop.png') });
  await click('Create organization');
  await page.waitForSelector('::-p-text(is created)', { timeout: 15000 });
  check(true, 'console: org created with owner invite link');
  await click('Done');

  // Suspend Lakeside → its owner sees the read-only banner
  await page.click(`button[aria-label="Suspend ${orgName}"]`);
  await page.waitForSelector(`button[aria-label="Reactivate ${orgName}"]`, { timeout: 10000 });
  check(true, 'console: suspend');
  // Support session (read-only)
  await page.click(`button[aria-label^="Open ${orgName}"]`);
  await type('#sup-reason', 'Owner asked for help with tax rates');
  await click('Open read-only');
  await waitUrl(new RegExp(`^/${slug}`));
  await page.waitForSelector('::-p-text(Support session · read-only)', { timeout: 15000 });
  await shot('00-support-session', false);
  await go(`/${slug}/settings/workspace?tab=rules`);
  await page.focus('#rr-deposit');
  await page.keyboard.press('ArrowLeft');
  await page.waitForSelector('::-p-text(Read-only: changes cannot be saved)', { timeout: 5000 });
  check(true, 'support session: save is disabled');
  await click('End session');
  await waitUrl(/^\/console/);

  // Owner sees suspended banner
  await signIn(owner.email, PASSWORD);
  await page.waitForSelector('::-p-text(This workspace is suspended)', { timeout: 15000 });
  await shot('04-home-suspended', false);
  check(true, 'suspended org shows the read-only banner to its members');

  // Reactivate and delete with typed slug (as platform owner)
  await signIn(admin.email, PASSWORD);
  await page.waitForSelector(`button[aria-label="Reactivate ${orgName}"]`);
  await page.click(`button[aria-label="Reactivate ${orgName}"]`);
  await page.waitForSelector(`button[aria-label="Suspend ${orgName}"]`, { timeout: 10000 });
  await page.click(`button[aria-label="Delete Bayou Bounce ${run}"]`);
  await page.waitForSelector('#del-slug', { visible: true });
  const delBtn = await page.waitForSelector(byText('Delete organization', 'button'));
  check(await delBtn.evaluate((b) => b.disabled), 'delete is disabled until the slug is typed');
  await page.screenshot({ path: join(OUT, '00-console-delete-desktop.png') });
  await type('#del-slug', `bayou-bounce-${run}`);
  await delBtn.click();
  await page.waitForSelector('::-p-text(deleted for good on)', { timeout: 10000 });
  check(true, 'delete with typed slug → closed with 30-day grace');
  await go('/console/audit');
  await shot('00-console-audit', false);
  check(await hasText('opened a read-only support session'), 'audit: support session recorded');
} catch (e) {
  failures++;
  console.log(`FAIL exception: ${e.message}`);
  await page.screenshot({ path: join(OUT, `zz-failure.png`), fullPage: true }).catch(() => {});
  console.log(`   at ${page.url()}`);
}

for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\nAccounts created (password ${PASSWORD}):\n  workspace owner: ${owner.email} → /${slug}\n  platform owner:  ${admin.email} → /console`);
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'} · ${errors.length} browser errors · screenshots in ${OUT}`);
await browser.close();
process.exit(failures || errors.length ? 1 : 0);
