/**
 * Records the website's onboarding video: a new business (Sunny Day Rentals, owner Jamie Parker) signs up and
 * walks through the setup guide: profile, brand, warehouse, email and payments, team, launch. One silent clip
 * per chapter, timed to the narration (web-onboarding-script.md; run tts.mjs web-onboarding ava first).
 * The sample workspace and its owner are removed before each run and again at the end.
 *   node apps/web/scripts/video/record-onboarding.mjs        all chapters
 *   node apps/web/scripts/video/record-onboarding.mjs wipe   only remove the sample workspace
 * Output: .data/video/web/onboarding/clips/chNN*.mp4 + chNN.json
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { newPage, opts, point, recorder, setValue, sleep, tap, typeIn } from './kit.mjs';
import { PROJECTS, VIDEO } from './script.mjs';

const BASE = process.env.VIDEO_BASE ?? 'http://localhost:3001';
const ROOT = join(VIDEO, '../..');
const P = PROJECTS['web-onboarding'];
const W = 1440;
const H = 810;
const SCALE = 4 / 3;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BIZ = { name: 'Sunny Day Rentals', slug: 'sunny-day-rentals', owner: 'Jamie Parker', email: 'jamie@sunnydayrentals.test', password: 'Sunny-Day-2026!', phone: '(512) 555-0160', street: '2300 S Lamar Blvd' };
const LOGO = join(VIDEO, 'web/onboarding/sunny-day-logo.png');
const fixture = (args) => JSON.parse(execSync(`pnpm --filter @rental/db exec tsx ../../apps/web/scripts/video/fixtures.ts ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').at(-1));
const speech = JSON.parse(readFileSync(join(VIDEO, P.tts, 'ava', 'manifest.json'), 'utf8'));
const chapter = recorder({ clips: join(VIDEO, P.clips), frames: join(VIDEO, P.frames), speech });
opts.timeout = 10000;

/** Point at something that is nice to show but not essential: a miss is logged, not fatal. */
const soft = async (p) => { try { return await p; } catch (e) { console.log(`  (skipped: ${e.message.split('\n')[0].slice(0, 120)})`); return null; } };
const scrollTo = (page, y) => page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y).then(() => sleep(900));
/** The setup guide's main button (Continue, Send invites, Launch workspace), then the next step's heading. */
const next = async (page, label) => {
  const before = await page.$eval('h1', (h) => h.textContent);
  await tap(page, label, 'footer', 'button');
  await page.waitForFunction((b) => document.querySelector('h1')?.textContent !== b, { timeout: 30000 }, before);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
  await sleep(900);
};

const CHAPTERS = {
  async 1({ desk }) {
    await desk.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
    await desk.waitForSelector('#r-biz', { visible: true, timeout: 60000 });
    await sleep(1200);
    await chapter(1, 'Create your workspace', { desk }, async (c) => {
      await c.step('Business name · workspace address', async () => {
        await c.shot('desk', 'full');
        await sleep(600);
        await c.shot('desk', ['#r-biz', '#r-slug'], { min: 1000 });
        await typeIn(desk, '#r-biz', BIZ.name, 70);
        await sleep(1500);
        await soft(point(desk, '#r-slug'));
        await sleep(800);
      });
      await c.step('Your name, email and password · Create workspace', async () => {
        await c.shot('desk', ['#r-name', 'button[type="submit"]'], { min: 1000 });
        await typeIn(desk, '#r-name', BIZ.owner, 60);
        await typeIn(desk, '#r-email', BIZ.email, 35);
        await typeIn(desk, '#r-pass', BIZ.password, 60);
        // The label holds the Terms and Privacy links: point at it, tick the box itself.
        await point(desk, 'I agree', 'form', 'label');
        await desk.$eval('form input[type="checkbox"]', (e) => e.click());
        await sleep(500);
        await tap(desk, 'button[type="submit"]');
        await desk.waitForFunction(() => location.pathname.startsWith('/onboarding'), { timeout: 45000 });
        await desk.waitForSelector('h1', { visible: true, timeout: 60000 });
        await sleep(1500);
      });
    });
  },

  async 2({ desk }) {
    await chapter(2, 'Business profile', { desk }, async (c) => {
      await c.step('Name, phone and email on quotes, invoices and emails', async () => {
        await c.shot('desk', 'full');
        await sleep(800);
        await c.shot('desk', ['#profile-name', '#profile-email'], { min: 1100 });
        await soft(point(desk, '#profile-name'));
        await typeIn(desk, '#profile-phone', BIZ.phone, 60);
        await typeIn(desk, '#profile-email', 'bookings@sunnydayrentals.test', 30);
        await sleep(600);
      });
      await c.step('Time zone and currency', async () => {
        await soft(point(desk, '#ob-tz'));
        await c.shot('desk', ['#ob-tz', '#ob-cur'], { min: 1100 });
        await sleep(900);
        await soft(point(desk, '#ob-cur'));
        await sleep(900);
        await next(desk, 'Continue');
      });
    });
  },

  async 3({ desk }) {
    await chapter(3, 'Brand and theme', { desk }, async (c) => {
      await c.step('Upload your logo · size and position', async () => {
        await c.shot('desk', 'full');
        await sleep(600);
        await c.shot('desk', 'main section', { min: 1200 });
        await point(desk, 'Upload logo', 'main', 'button');
        const input = await desk.$('input[type="file"][aria-label="Upload logo"]');
        await input.uploadFile(LOGO);
        await sleep(2500);
        await soft(point(desk, '[aria-label="Drag to move the logo"]'));
        await sleep(1000);
      });
      await c.step('Theme colour, sidebar and corners · live preview', async () => {
        const picker = await desk.$('[role="radiogroup"][aria-label="Brand colour"]');
        await picker.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await sleep(900);
        await c.shot('desk', 'main', { min: 1300 });
        await tap(desk, '[aria-label="Ember"]');
        await sleep(1200);
        await soft(tap(desk, 'Light', 'main', '[role="radio"], button'));
        await sleep(1000);
        await soft(tap(desk, 'Dark', 'main', '[role="radio"], button'));
        await sleep(800);
        await soft(tap(desk, 'Soft', 'main', '[role="radio"], button'));
        await sleep(1200);
      });
      await c.step('On the app, quote pages, emails and PDFs', async () => {
        await scrollTo(desk, 0);
        await c.shot('desk', 'full');
        await sleep(1500);
        await next(desk, 'Continue');
      });
    });
  },

  async 4({ desk }) {
    await chapter(4, 'Warehouse and travel fees', { desk }, async (c) => {
      await c.step('Where your equipment ships from', async () => {
        await c.shot('desk', 'full');
        await sleep(600);
        const street = 'input[id$="-line1"]';
        await c.shot('desk', ['#warehouse-location-name', street], { min: 1100 });
        await typeIn(desk, street, BIZ.street, 60);
        await desk.waitForSelector('[role=listbox] [role=option]', { timeout: 15000 });
        await sleep(600);
        await tap(desk, '[role=listbox] [role=option]');
        await sleep(1500);
      });
      await c.step('Sales tax, free miles and the rate per extra mile', async () => {
        await soft(point(desk, '#wh-tax'));
        await c.shot('desk', ['#wh-tax', '#wh-rate'], { min: 1100 });
        await setValue(desk, '#wh-tax', '8.25');
        await sleep(600);
        await soft(point(desk, '#wh-free'));
        await setValue(desk, '#wh-free', '15');
        await sleep(600);
        await soft(point(desk, '#wh-rate'));
        await setValue(desk, '#wh-rate', '2.5');
        await sleep(900);
        await next(desk, 'Continue');
      });
    });
  },

  async 5({ desk }) {
    await chapter(5, 'Email, text messages and payments', { desk }, async (c) => {
      await c.step('Shared mail service or your own · Stripe when ready', async () => {
        await c.shot('desk', 'full');
        await sleep(900);
        await soft(point(desk, 'Email sending', 'main', 'h2'));
        await sleep(900);
        await soft(point(desk, 'Card payments', 'main', 'h2'));
        await sleep(1200);
        await next(desk, 'Skip for now');
      });
    });
  },

  async 6({ desk }) {
    await chapter(6, 'Invite your team', { desk }, async (c) => {
      await c.step('Email · role · send the invite', async () => {
        await c.shot('desk', 'full');
        await sleep(600);
        const email = '[aria-label="Invite email 1"]';
        await c.shot('desk', [email, '[aria-label="Role for invite 1"]'], { min: 1100 });
        await typeIn(desk, email, 'alex@sunnydayrentals.test', 40);
        await point(desk, '[aria-label="Role for invite 1"]');
        const sales = await desk.$eval('[aria-label="Role for invite 1"]', (s) => [...s.options].find((o) => /sales/i.test(o.textContent))?.value);
        if (sales) await setValue(desk, '[aria-label="Role for invite 1"]', sales);
        await sleep(900);
        // Sending shows each invite's link on the same step; Continue moves on.
        await tap(desk, 'Send invites', 'footer', 'button');
        await desk.waitForFunction(() => /Copy link/.test(document.body.innerText), { timeout: 30000 });
        await sleep(1200);
        await next(desk, 'Continue');
      });
    });
  },

  async 7({ desk }) {
    await chapter(7, 'Review and launch', { desk }, async (c) => {
      await c.step('Everything on one page', async () => {
        await c.shot('desk', 'full');
        await sleep(1200);
        await soft(point(desk, 'Brand', 'main', 'p, span, h3, strong, div'));
        await sleep(1200);
      });
      await c.step('Launch workspace', async () => {
        await tap(desk, 'Launch workspace', 'footer', 'button');
        await desk.waitForFunction(() => /is set up/.test(document.body.innerText), { timeout: 45000 });
        await sleep(2500);
      });
    });
  },

  async 8({ desk }) {
    await chapter(8, 'Your workspace', { desk }, async (c) => {
      await c.step('Your colours, your logo', async () => {
        await tap(desk, 'Go to my workspace', 'body', 'a');
        await desk.waitForFunction((s) => location.pathname === `/${s}`, { timeout: 45000 }, BIZ.slug);
        await desk.waitForSelector('main h1, main h2', { visible: true, timeout: 60000 });
        await sleep(1200);
        await c.shot('desk', 'full');
        await sleep(2500);
      });
    });
  },
};

const wipe = () => console.log('wipe', JSON.stringify(fixture(`wipe-onboarding ${BIZ.slug} ${BIZ.email}`)));
wipe();
if (process.argv.includes('wipe')) process.exit(0);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [`--force-device-scale-factor=${SCALE}`], protocolTimeout: 180000 });
const desk = await newPage(browser, { width: W, height: H, deviceScaleFactor: SCALE });
try {
  for (const id of Object.keys(CHAPTERS).map(Number)) await CHAPTERS[id]({ desk, browser });
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  await desk.screenshot({ path: join(VIDEO, P.clips, 'zz-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  wipe();
}
