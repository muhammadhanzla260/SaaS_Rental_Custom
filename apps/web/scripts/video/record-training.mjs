/**
 * Records the training video's screen (training-script.md): every feature, one step per sentence, each
 * step held for as long as its sentence takes to say (speak it first: tts.mjs training ava).
 * Signed in as Tim Masters in Freedom Fun USA; the customer is a training customer, Sarah Mitchell,
 * and everything made for her is removed again at the end (wipe), so no test data stays behind.
 *   node apps/web/scripts/video/record-training.mjs           all chapters, then wipe
 *   node apps/web/scripts/video/record-training.mjs 5 6       some chapters (no wipe)
 *   node apps/web/scripts/video/record-training.mjs wipe      only remove the training data
 * Output: .data/video/training/clips/chNN*.mp4 + chNN.json
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { action, find, log, newPage, opts, paymentsHeading, point, recorder, setValue, sleep, stripeCard, tap, typeCard, typeIn, waitText } from './kit.mjs';
import { PROJECTS, VIDEO } from './script.mjs';

const BASE = 'http://localhost:3000';
const S = `${BASE}/freedom-fun-demo`;
const ROOT = join(VIDEO, '../..');
const P = PROJECTS.training;
const STATE = join(VIDEO, P.state);
const W = 1440;
const H = 810;
const SCALE = 4 / 3;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CUSTOMER = { first: 'Sarah', last: 'Mitchell', email: 'muhammadhanzla260+training@gmail.com', phone: '(512) 555-0476', street: '1100 Congress Ave' };
const EVENT_DAY = '2026-11-14';
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const fixture = (args) => JSON.parse(execSync(`pnpm --filter @rental/db exec tsx ../../apps/web/scripts/video/fixtures.ts ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').at(-1));
const speech = JSON.parse(readFileSync(join(VIDEO, P.tts, 'ava', 'manifest.json'), 'utf8'));
const chapter = recorder({ clips: join(VIDEO, P.clips), frames: join(VIDEO, P.frames), speech });
// Pages are loaded before anything is looked for, so a miss shows quickly.
opts.timeout = 8000;

/** Point at something that is nice to show but not essential: a miss is logged, not fatal. */
const soft = async (p) => { try { return await p; } catch (e) { console.log(`  (skipped: ${e.message.split('\n')[0].slice(0, 120)})`); return null; } };
// Pages stream in (the browser may never call them loaded): wait for the content instead.
const go = async (page, path) => {
  await page.goto(`${S}${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForSelector('main h1, main h2', { visible: true, timeout: 60000 });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
  await sleep(900);
};
const scrollTo = (page, y) => page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y).then(() => sleep(900));
/** An element handle, or null when the lookup found nothing. */
const orNull = async (h) => ((await h.evaluate((e) => e != null)) ? h : null);
const byText = (page, text, sel = '*') => page.evaluateHandle((t, s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent && e.textContent?.trim().toLowerCase() === t.toLowerCase()).at(-1), text, sel).then(orNull);
const heading = (page, text) => page.evaluateHandle((t) => [...document.querySelectorAll('main h1, main h2, main h3, main p')].find((h) => h.textContent.trim().toLowerCase().startsWith(t.toLowerCase()) && h.offsetParent), text).then(orNull);
const parentOf = (h, n = 1) => h.evaluateHandle((e, k) => { let x = e; for (let i = 0; i < k && x.parentElement; i++) x = x.parentElement; return x; }, n);
const hover = async (page, h) => { const b = await h.boundingBox(); if (!b) return; log(page, { type: 'move', x: b.x + b.width / 2, y: b.y + b.height / 2 }); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 }); await sleep(700); };
const select = async (page, sel, label) => {
  const v = await page.$eval(sel, (s, l) => [...s.options].find((o) => o.textContent.trim().startsWith(l))?.value, label);
  if (v != null) await setValue(page, sel, v);
};

const CHAPTERS = {
  async 1({ desk }) {
    // Signing in is filmed: this chapter starts signed out.
    await desk.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle2' });
    await chapter(1, 'Getting around', { desk }, async (c) => {
      await c.step('Sign in with your email and password', async () => {
        await c.shot('desk', 'full');
        await typeIn(desk, '#si-email', 'tim@demo.tentpole.test', 40);
        await desk.keyboard.press('Enter');
        await desk.waitForSelector('#si-pass', { visible: true });
        await sleep(500);
        await c.shot('desk', ['#si-email', '#si-pass'], { min: 1000 });
        await point(desk, 'Forgot password?', 'body', 'button');
        await sleep(800);
        await typeIn(desk, '#si-pass', 'Tentpole-2026!', 60);
        await desk.keyboard.press('Enter');
        await desk.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 30000 });
        await desk.waitForNetworkIdle({ idleTime: 600 }).catch(() => {});
      });
      await c.step('Home: your business at a glance', async () => {
        await c.shot('desk', 'full');
        await sleep(1500);
        const up = await soft(find(desk, 'Upcoming', 'main', 'p, span, div'));
        const month = await soft(find(desk, 'Booked this month', 'main', 'p, span, div'));
        await c.shot('desk', [up, month].filter(Boolean), { min: 1100 });
        for (const h of [up, await soft(find(desk, 'This week', 'main', 'p, span, div')), await soft(find(desk, 'Open quotes', 'main', 'p, span, div')), month]) await soft(point(desk, h));
      });
      await c.step('Your next bookings · local time per location', async () => {
        await scrollTo(desk, 260);
        await c.shot('desk', 'main', { min: 1300 });
        const row = await desk.$('main a[href*="/orders/"]');
        if (row) await point(desk, row);
        await sleep(1200);
        await soft(point(desk, 'Manage', 'main', 'a, button'));
      });
      await c.step('The menu: Workspace · Catalog · Money', async () => {
        await scrollTo(desk, 0);
        await c.shot('desk', 'nav', { min: 1000 });
        for (const t of ['Action needed', 'Customers', 'Products', 'Invoices & payments', 'Reports']) { await soft(point(desk, t, 'nav')); await sleep(250); }
      });
      await c.step('Search or Ctrl K: jump to any page', async () => {
        await c.shot('desk', 'full');
        await tap(desk, 'Search or jump to', 'body', 'button');
        await desk.waitForSelector('[aria-label="Search"]', { visible: true });
        await sleep(400);
        await c.shot('desk', '#cmdk-list', { min: 1000 });
        await desk.type('[aria-label="Search"]', 'invo', { delay: 120 });
        await sleep(1200);
        await desk.keyboard.press('Enter');
        await desk.waitForFunction(() => location.pathname.endsWith('/invoices'), { timeout: 20000 });
        await sleep(800);
        await c.shot('desk', 'full');
      });
    });
  },

  async 2({ desk }) {
    fixture(`wipe-video ${CUSTOMER.email}`);
    Object.keys(state).forEach((k) => delete state[k]);
    save();
    await go(desk, '/customers');
    await chapter(2, 'Customers', { desk }, async (c) => {
      await c.step('Everyone you work with', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(800);
        await c.shot('desk', ['CONTACT', 'LAST EVENT'], { min: 1200 });
        for (const t of ['ORDERS', 'LIFETIME', 'LAST EVENT']) { await soft(point(desk, await byText(desk, t, 'th, div, span'))); }
      });
      await c.step('Search · people, organizations, repeat', async () => {
        await c.shot('desk', ['input[aria-label="Search customers"]', 'Repeat'], { min: 1200 });
        await typeIn(desk, 'input[aria-label="Search customers"]', 'Lakeway', 90);
        await sleep(900);
        await desk.click('input[aria-label="Search customers"]', { clickCount: 3 });
        await desk.keyboard.press('Backspace');
        await soft(tap(desk, 'Organizations', 'main', 'button'));
        await sleep(700);
        await soft(tap(desk, 'Repeat', 'main', 'button'));
        await sleep(700);
        await soft(tap(desk, 'All', 'main', 'button'));
      });
      await c.step('Add customer: name, email, mobile', async () => {
        await c.shot('desk', 'full');
        await tap(desk, 'Add customer', 'body', 'button');
        await desk.waitForSelector('#c-first', { visible: true });
        await sleep(400);
        await c.shot('desk', ['#c-first', 'dialog[open] footer'], { min: 1000 });
        await typeIn(desk, '#c-first', CUSTOMER.first);
        await typeIn(desk, '#c-last', CUSTOMER.last);
        await typeIn(desk, '#c-email', CUSTOMER.email, 22);
        await typeIn(desk, '#c-phone', CUSTOMER.phone);
      });
      await c.step('The address fills in by itself · Add customer', async () => {
        const street = 'dialog[open] input[id$="-line1"]';
        await typeIn(desk, street, CUSTOMER.street, 60);
        await desk.waitForSelector('[role=listbox] [role=option]', { timeout: 15000 });
        await sleep(600);
        await tap(desk, '[role=listbox] [role=option]');
        await sleep(1400);
        await tap(desk, 'Add customer', 'dialog[open]', 'button');
        await desk.waitForFunction(() => !document.querySelector('dialog[open] #c-first'), { timeout: 20000 });
        await sleep(1500);
        state.customerId = await desk.evaluate(() => new URL(location.href).searchParams.get('id'));
        save();
      });
      await c.step('The customer profile: contact, billing, orders', async () => {
        // The profile of a customer with history (the walkthrough's customer).
        await go(desk, '/customers');
        const row = await desk.evaluateHandle(() => [...document.querySelectorAll('main tr, main [role=row], main li')].find((r) => /Repeat/.test(r.innerText)));
        await tap(desk, row);
        await desk.waitForSelector('[aria-label="Close profile"]', { visible: true });
        await sleep(900);
        const panel = await parentOf(await desk.$('[aria-label="Close profile"]'), 3);
        await c.shot('desk', [panel], { min: 1100 });
        await soft(point(desk, 'Orders', 'dialog[open], aside', 'h2, h3, p, span'));
      });
      await c.step('Saved addresses · marketing and text choices', async () => {
        await soft(point(desk, 'Saved addresses', 'body', 'h2, h3, p, span'));
        await sleep(600);
        await soft(point(desk, 'Marketing emails', 'body', 'label, span, p'));
        await soft(point(desk, 'Event reminders by text', 'body', 'label, span, p'));
      });
      await c.step('Credits and rain checks: issue a credit', async () => {
        await soft(point(desk, 'Credits & rain checks', 'body', 'h2, h3, p, span'));
        await tap(desk, 'Issue', 'body', 'button');
        await desk.waitForSelector('#cr-amt', { visible: true });
        await sleep(500);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        await typeIn(desk, '#cr-amt', '25', 120);
        await typeIn(desk, '#cr-reason', 'Late setup on Jun 14', 40);
        await soft(point(desk, '#cr-until'));
        await sleep(600);
        await tap(desk, 'Cancel', 'dialog[open]', 'button');
        await sleep(400);
        await desk.keyboard.press('Escape');
      });
      await c.step('Import CSV: bring everyone across at once', async () => {
        await go(desk, '/customers');
        await c.shot('desk', 'full');
        await tap(desk, 'Import CSV', 'body', 'button');
        await sleep(1000);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        await sleep(1500);
        await soft(tap(desk, 'Cancel', 'dialog[open]', 'button'));
      });
    });
  },

  async 3({ desk }) {
    await go(desk, '/products');
    await chapter(3, 'Products and categories', { desk }, async (c) => {
      await c.step('Products: photo, category, price, how many', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1200);
        await soft(tap(desk, 'List', 'main', 'button, [role="radio"], label'));
        await sleep(1400);
        await soft(tap(desk, 'Grid', 'main', 'button, [role="radio"], label'));
      });
      await c.step('Filter by category · search · status', async () => {
        await c.shot('desk', 'main aside', { min: 1100 });
        const cat = await desk.evaluateHandle(() => [...document.querySelectorAll('main aside button')][2]);
        await tap(desk, cat);
        await sleep(1000);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(tap(desk, 'All products', 'main aside', 'button'));
        await soft(typeIn(desk, 'input[aria-label="Search products"]', 'Bounce', 90));
        await sleep(900);
        await desk.click('input[aria-label="Search products"]', { clickCount: 3 }).catch(() => {});
        await desk.keyboard.press('Backspace');
      });
      await c.step('Categories: add, rename, remove', async () => {
        await c.shot('desk', 'full');
        await tap(desk, 'Categories', 'header', 'button');
        await sleep(1100);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        await soft(typeIn(desk, 'input[aria-label="New category name"]', 'Holiday rentals', 60));
        await sleep(900);
        await desk.keyboard.press('Escape');
        await sleep(500);
      });
      await c.step('Details: name, photo, category, tax, commission', async () => {
        const link = await desk.evaluateHandle(() => [...document.querySelectorAll('main a[href*="/products/"]')].find((a) => a.querySelector('img') && /Bounce/i.test(a.innerText)) ?? [...document.querySelectorAll('main a[href*="/products/"]')].find((a) => a.querySelector('img')));
        await tap(desk, link);
        await waitText(desk, 'Pricing');
        await sleep(900);
        state.productUrl = await desk.evaluate(() => location.pathname);
        save();
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Taxable', 'main', 'button, label, span, p, div'));
        await soft(point(desk, 'Earns commission', 'main', 'button, label, span, p, div'));
      });
      await c.step('Pricing: staffed, pick-up, drop-off', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Pricing', 'main', '[role="tab"], button');
        await sleep(900);
        await c.shot('desk', await heading(desk, 'Price rules').then((h) => parentOf(h, 2)), { min: 1200 });
        for (const t of ['Concierge', 'Pick-up', 'Drop-off']) await soft(point(desk, t, 'main', 'td, div, span, p'));
      });
      await c.step('Included hours · overtime · a price per location', async () => {
        await soft(point(desk, 'Included hours', 'main', 'label'));
        await c.shot('desk', ['Included hours', 'Overtime block'], { min: 1200 });
        await soft(point(desk, 'Hourly rate after that', 'main', 'label'));
        await soft(point(desk, 'Overtime block', 'main', 'label'));
        await soft(point(desk, 'Add a location price', 'main', 'button'));
      });
      await c.step('Inventory: owned, out of service, cleaning time', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Inventory', 'main', '[role="tab"], button');
        await sleep(1000);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Owned', 'main', 'th, span, p, div'));
        await soft(point(desk, 'Out of service', 'main', 'th, span, p, div'));
        await soft(point(desk, 'Turnaround', 'main', 'h2, h3'));
      });
      await c.step('Add-ons: suggested on the order screen', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Add-ons', 'main', '[role="tab"], button');
        await sleep(1000);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Suggested add-ons', 'main', 'h2, h3, p, span'));
        await sleep(1200);
      });
      await c.step('Add product · Duplicate', async () => {
        await scrollTo(desk, 0);
        await c.shot('desk', ['Duplicate', 'h1'], { min: 1200 });
        await soft(point(desk, 'Duplicate', 'main', 'button'));
        await sleep(600);
        await go(desk, '/products');
        await c.shot('desk', 'full');
        await tap(desk, 'Add product', 'body', 'a, button');
        await desk.waitForFunction(() => location.pathname.endsWith('/products/new'), { timeout: 20000 });
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1200);
      });
    });
  },

  async 4({ desk }) {
    await go(desk, '/inventory');
    await chapter(4, 'Inventory', { desk }, async (c) => {
      await c.step('Stock at a glance', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(600);
        for (const t of ['Units owned', 'In maintenance', 'Utilization']) await soft(point(desk, t, 'main', 'p, span, div'));
      });
      await c.step('Two weeks ahead: units free each day', async () => {
        const grid = await heading(desk, 'Availability');
        await soft(point(desk, grid));
        await c.shot('desk', 'main', { min: 1300 });
        await scrollTo(desk, 120);
        for (const t of ['All free', 'Some booked', 'Fully booked']) await soft(point(desk, t, 'main', 'span, p, div'));
        const cell = await desk.evaluateHandle(() => [...document.querySelectorAll('main td, main [role=gridcell], main div')].find((e) => e.childElementCount === 0 && e.textContent.trim() === '1' && e.offsetParent));
        if (cell) await soft(point(desk, cell));
      });
      await c.step('Pick a location', async () => {
        await scrollTo(desk, 0);
        await c.shot('desk', ['select[aria-label="Location"]', 'h1'], { min: 1200 });
        await soft(select(desk, 'select[aria-label="Location"]', 'Dallas'));
        await sleep(1800);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(select(desk, 'select[aria-label="Location"]', 'Austin'));
        await sleep(1200);
      });
      await c.step('Units and maintenance', async () => {
        const h = await heading(desk, 'Units & maintenance');
        await point(desk, h);
        await c.shot('desk', [h, await parentOf(h, 2)], { min: 1200 });
        await soft(point(desk, 'Send to maintenance', 'main', 'button'));
        await soft(point(desk, 'Mark available', 'main', 'button'));
      });
    });
  },

  async 5({ desk }) {
    if (!state.customerId) throw new Error('Record chapter 2 first (it adds the training customer).');
    if (state.orderA) { fixture(`remove-order ${state.orderA}`); delete state.orderA; save(); }
    await go(desk, '');
    await chapter(5, 'Creating an order', { desk }, async (c) => {
      await c.step('New order → find the customer', async () => {
        await c.shot('desk', 'full');
        await tap(desk, 'New order', 'nav');
        await desk.waitForSelector('#ob-date', { visible: true });
        await c.shot('desk', ['h2', 'input[placeholder="Search by name, email or phone"]'], { min: 1000 });
        await typeIn(desk, 'input[placeholder="Search by name, email or phone"]', 'Sarah M', 90);
        await desk.waitForFunction((e) => [...document.querySelectorAll('[role=option], li button, [role=listbox] *')].some((x) => x.innerText?.includes(e)), { timeout: 15000 }, CUSTOMER.email);
        const opt = await desk.evaluateHandle((e) => [...document.querySelectorAll('[role=option], li button, button')].find((x) => x.innerText?.includes(e)), CUSTOMER.email);
        await tap(desk, opt);
        await waitText(desk, CUSTOMER.email);
      });
      await c.step('Event type, date, start time, length', async () => {
        await point(desk, '#ob-date');
        await c.shot('desk', ['#ob-type', '#ob-end'], { min: 1100 });
        await setValue(desk, '#ob-type', 'Birthday');
        await setValue(desk, '#ob-date', EVENT_DAY);
        await setValue(desk, '#ob-start', '13:00');
        await setValue(desk, '#ob-dur', 240);
        await soft(point(desk, 'Rental spans multiple calendar days', 'main', 'label, span, p, div'));
      });
      await c.step('Event address · drag the pin · travel fee', async () => {
        await point(desk, 'Billing address');
        await c.shot('desk', ['Billing address', 'Another address'], { min: 1200 });
        await tap(desk, 'Billing address');
        await sleep(1500);
        const map = await desk.$('main .mapboxgl-canvas, main canvas');
        if (map) { await point(desk, map); await c.shot('desk', [map], { min: 1100 }); await sleep(1500); }
      });
      await c.step('Event-day contact · confirm it', async () => {
        await point(desk, '#ob-cmobile');
        await c.shot('desk', ['#ob-cname', 'I confirmed the event day point of contact'], { min: 1100 });
        await soft(point(desk, '#ob-cname'));
        await sleep(700);
        await tap(desk, 'I confirmed the event day point of contact', 'main');
        await sleep(1200);
      });
      await c.step('Click a product to add it · units free shown', async () => {
        const names = await desk.$$eval('button[aria-label^="Add "]', (bs) => bs.filter((b) => /\d+ of \d+ free/.test(b.innerText) && b.offsetParent).map((b) => b.getAttribute('aria-label')).slice(0, 8));
        const pick = [names.find((n) => /Bounce/i.test(n)) ?? names[0], names.find((n) => /Popcorn|Cotton/i.test(n)) ?? names[1]];
        state.products = pick;
        save();
        await point(desk, `button[aria-label="${pick[0]}"]`);
        await c.shot('desk', [`button[aria-label="${pick[0]}"]`], { min: 1100 });
        await tap(desk, `button[aria-label="${pick[0]}"]`);
        await sleep(1200);
      });
      await c.step('Category tabs · often added together', async () => {
        await soft(point(desk, 'Often added:', 'main', 'p, span, div'));
        await sleep(900);
        await tap(desk, `button[aria-label="${state.products[1]}"]`);
        await sleep(900);
        const tab = await orNull(await desk.evaluateHandle(() => [...document.querySelectorAll('main [role="group"][aria-label="Category"] button')].filter((t) => t.offsetParent)[2]));
        if (tab) { await c.shot('desk', [tab], { min: 1200 }); await tap(desk, tab); await sleep(1300); await soft(tap(desk, 'All', 'main [role="group"][aria-label="Category"]', 'button')); }
      });
      await c.step('Shopping cart: how each item is rented · extra time', async () => {
        const cart = await heading(desk, 'Shopping cart');
        await point(desk, cart);
        await c.shot('desk', [cart], { min: 1300 });
        await soft(point(desk, 'Choose service option', 'main', 'p, span, label, div'));
        await sleep(600);
        await soft(point(desk, 'Additional time', 'main', 'p, span, label, div'));
      });
      await c.step('Notes: setup map, crew instructions, customer note', async () => {
        const notes = await heading(desk, 'Notes');
        await point(desk, notes);
        await c.shot('desk', [notes, '#ob-int'], { min: 1200 });
        await typeIn(desk, '#ob-int', 'Set up on the back lawn, gate code 4412.', 35);
        await sleep(500);
      });
      await c.step('The summary adds up as you go', async () => {
        await scrollTo(desk, 0);
        await c.shot('desk', 'main aside', { min: 1000 });
        const label = (t) => desk.evaluateHandle((x) => [...document.querySelectorAll('[aria-label="Order summary"] *')].find((e) => e.childElementCount === 0 && e.textContent?.trim() === x), t);
        for (const t of ['Rental items', 'Travel fee', 'Damage waiver', 'Sales tax', 'Total']) { await soft(point(desk, await label(t))); await sleep(200); }
      });
      await c.step('Discount · coupon · deposit · the damage waiver is your call', async () => {
        const label = (t) => desk.evaluateHandle((x) => [...document.querySelectorAll('[aria-label="Order summary"] *')].find((e) => e.childElementCount === 0 && e.textContent?.trim() === x), t);
        await soft(point(desk, await label('Discount')));
        await soft(point(desk, 'input[aria-label="Coupon code"]'));
        await soft(point(desk, await label('Deposit to book')));
        await soft(point(desk, await label('Damage waiver')));
        await sleep(800);
      });
      await c.step('Save: keep it as a draft', async () => {
        await tap(desk, 'Save', 'main', 'button');
        await desk.waitForFunction(() => /\/orders\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 30000 });
        await desk.waitForNetworkIdle({ idleTime: 600 }).catch(() => {});
        state.orderA = await desk.evaluate(() => location.pathname.split('/').pop());
        state.numA = await desk.evaluate(() => document.body.innerText.match(/Q-AUS-\d{5}/)?.[0]);
        save();
        await c.shot('desk', 'header', { min: 1200 });
        await sleep(1500);
      });
    });
  },

  async 6({ desk }) {
    if (!state.orderA) throw new Error('Record chapter 5 first (it makes the order).');
    if (!state.orderB || state.used6) {
      for (const k of ['orderB', 'orderC']) if (state[k]) fixture(`remove-order ${state[k]}`);
      const o = fixture(`orders ${CUSTOMER.email}`);
      Object.assign(state, { orderB: o.b.id, numB: o.b.number, orderC: o.c.id, numC: o.c.number, used6: false });
      save();
    }
    fixture(`forget-cards ${CUSTOMER.email}`);
    state.used6 = true;
    save();
    await go(desk, `/orders/${state.orderA}`);
    await chapter(6, 'Payment options', { desk }, async (c) => {
      await c.step('Payment options: three ways to finish', async () => {
        await c.shot('desk', 'main aside', { min: 1000 });
        await tap(desk, 'Payment options', 'main aside');
        await desk.waitForSelector('dialog[open] [role="tablist"]', { visible: true });
        await sleep(900);
        await c.shot('desk', 'dialog[open] > div', { min: 1300 });
        await soft(point(desk, '[aria-label="Order and pricing summary"]'));
      });
      await c.step('One: Send Quote Only', async () => {
        await tap(desk, 'Send Quote Only', 'dialog[open] [role="tablist"]');
        await sleep(600);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await sleep(900);
        await tap(desk, await action(desk, 'Send Quote Only'));
        await desk.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => /Quote (emailed|marked as sent)/.test(e.innerText)), { timeout: 30000 });
        await sleep(1500);
      });
      await c.step('Two: Submit Order Without Payment', async () => {
        await go(desk, `/orders/${state.orderB}`);
        await c.shot('desk', 'main aside', { min: 1000 });
        await tap(desk, 'Payment options', 'main aside');
        await desk.waitForSelector('dialog[open] [role="tablist"]', { visible: true });
        await tap(desk, 'Submit Order Without Payment', 'dialog[open] [role="tablist"]');
        await sleep(500);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await setValue(desk, '#bk-reason', await desk.$eval('#bk-reason option:nth-child(2)', (o) => o.value));
        await setValue(desk, '#bk-date', '2026-11-13');
      });
      await c.step('Booked now · waits on Action needed', async () => {
        const boxes = await desk.$$('dialog[open] section label');
        for (const b of boxes) {
          const txt = await b.evaluate((e) => e.innerText);
          if (txt.length > 20 && !/receipt/i.test(txt)) { await tap(desk, b); await sleep(150); }
        }
        await tap(desk, await action(desk, 'Submit Order Without Payment'));
        await desk.waitForFunction(() => /is booked/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 45000 });
        await sleep(1500);
        await tap(desk, 'Keep editing', 'dialog[open]');
        await sleep(800);
        await go(desk, '/actions');
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1500);
      });
      await c.step('Three: Record Payment Received · the method', async () => {
        await go(desk, `/orders/${state.orderC}`);
        await c.shot('desk', 'main aside', { min: 1000 });
        await tap(desk, 'Payment options', 'main aside');
        await desk.waitForSelector('#po-method', { visible: true });
        await sleep(700);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await point(desk, '#po-method');
        await sleep(1500);
      });
      await c.step('Card in the secure field · keep Save card ticked', async () => {
        const { handle: fh, frame } = await stripeCard(desk);
        await fh.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await sleep(1200);
        await c.shot('desk', [fh, 'Save card info'], { min: 1000 });
        const fb = await fh.boundingBox();
        log(desk, { type: 'move', x: fb.x + 80, y: fb.y + 40 });
        await sleep(500);
        await typeCard(desk, frame);
        await point(desk, 'Save card info', 'dialog[open]');
      });
      await c.step('Deposit, full or custom · a tip · Record', async () => {
        await point(desk, 'Collect Deposit', 'dialog[open]');
        await c.shot('desk', ['Collect Full Balance', 'Tip for Party Coach'], { min: 1100 });
        await tap(desk, 'Collect Deposit', 'dialog[open]');
        await tap(desk, '10%', 'dialog[open]');
        const boxes = await desk.$$('dialog[open] section label');
        for (const b of boxes) {
          const txt = await b.evaluate((e) => e.innerText);
          if (txt.length > 20 && !/receipt|Save card/i.test(txt)) { await b.evaluate((e) => e.scrollIntoView({ block: 'center' })); await b.click(); await sleep(120); }
        }
        await point(desk, 'Record Credit Card Payment', 'dialog[open]');
        await c.shot('desk', 'Record Credit Card Payment', { min: 1000 });
        await tap(desk, 'Record Credit Card Payment', 'dialog[open]');
        await desk.waitForFunction(() => /Booked and charged/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 60000 });
      });
      await c.step('Booked · one number for quote, invoice and receipt', async () => {
        await sleep(600);
        await c.shot('desk', 'dialog[open] section', { min: 1000 });
        await sleep(2500);
        await tap(desk, 'Keep editing', 'dialog[open]');
        await desk.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        await desk.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === 'Payments'), { timeout: 30000 });
        const pay = await paymentsHeading(desk);
        await point(desk, pay);
        await c.shot('desk', [pay, await pay.evaluateHandle((h) => h.parentElement)], { min: 1100 });
      });
      await c.step('Collect Tip: a tip on its own', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Collect tip', 'main', 'button');
        await desk.waitForSelector('dialog[open] [role="tablist"]', { visible: true });
        await sleep(800);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await sleep(2500);
        await desk.keyboard.press('Escape');
      });
    });
  },

  async 7({ desk }) {
    fixture(`unsign ${state.orderA}`);
    fixture(`forget-cards ${CUSTOMER.email}`);
    const { url } = fixture(`quote-url ${state.orderA}`);
    // The phone has its own browser at 2x, so its frames stay sharp when shown at full height.
    const phoneBrowser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--force-device-scale-factor=2'], protocolTimeout: 180000 });
    const phone = await newPage(phoneBrowser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await go(desk, `/orders/${state.orderA}`);
    await phone.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); await phone.waitForSelector('main, section', { visible: true, timeout: 60000 }); await sleep(1500);
    await chapter(7, 'What your customer sees', { phone, desk }, async (c) => {
      await c.step('The quote link, on a phone', async () => {
        await c.shot('phone', 'full');
        await sleep(1800);
        await phone.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
        await sleep(1500);
      });
      await c.step('Check the details · Request changes', async () => {
        await c.shot('phone', 'full');
        await phone.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
        await sleep(900);
        const req = await soft(tap(phone, 'Request changes'));
        if (req) {
          await sleep(1500);
          await soft(tap(phone, 'Cancel', 'body', 'button'));
          await phone.keyboard.press('Escape').catch(() => {});
        }
        await sleep(500);
      });
      await c.step('Accept the policies · sign by typing', async () => {
        await tap(phone, 'Looks good');
        await waitText(phone, 'A few things to agree on');
        const n = await phone.$$eval('section ul button', (x) => x.length);
        for (let i = 0; i < n; i++) await tap(phone, (await phone.$$('section ul button'))[i]);
        await tap(phone, 'Continue to sign');
        await typeIn(phone, '#q-name', 'Sarah Mitchell', 70);
        await tap(phone, 'I agree', 'section');
        await tap(phone, 'Sign and continue');
        await waitText(phone, 'Pay to book');
      });
      await c.step('Deposit or full amount · pay by card', async () => {
        await sleep(600);
        await point(phone, await phone.evaluateHandle(() => [...document.querySelectorAll('section [role="radio"]')].find((x) => x.innerText.includes('Pay deposit'))));
        await tap(phone, 'Continue to card');
        const { handle: fh, frame } = await stripeCard(phone);
        await fh.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        await sleep(1200);
        await typeCard(phone, frame);
        await tap(phone, 'Pay $', 'section');
        // Stripe may move the page on after paying, so keep looking across that navigation.
        for (let i = 0; ; i++) {
          const done = await phone.evaluate(() => /booked|Thank you|all set/i.test(document.body.innerText) && !/Pay to book/.test(document.body.innerText)).catch(() => false);
          if (done) break;
          if (i > 120) throw new Error('The payment did not finish on the phone');
          await sleep(500);
        }
        await sleep(2000);
      });
      await c.step('Booked · receipt · the office sees it', async () => {
        await desk.bringToFront();
        await desk.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}); await desk.waitForSelector('main h2', { visible: true, timeout: 60000 });
        await desk.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === 'Payments'), { timeout: 30000 });
        const pay = await paymentsHeading(desk);
        await point(desk, pay);
        await c.shot('desk', [pay, await pay.evaluateHandle((h) => h.parentElement)], { min: 1100 });
      });
    });
    await phoneBrowser.close();
  },

  async 8({ desk }) {
    await go(desk, `/orders/${state.orderC}`);
    await chapter(8, 'After the booking', { desk }, async (c) => {
      await c.step('Status badge · paid and still due', async () => {
        await c.shot('desk', 'full');
        await soft(point(desk, 'Booked', 'header', 'span, div'));
        await sleep(600);
        await c.shot('desk', 'main aside', { min: 1000 });
        const label = (t) => desk.evaluateHandle((x) => [...document.querySelectorAll('[aria-label="Order summary"] *')].find((e) => e.childElementCount === 0 && e.textContent?.trim() === x), t);
        await soft(point(desk, await label('Paid so far')));
        await soft(point(desk, await label('Balance due on event day')));
      });
      await c.step('Order history · invoice · payments', async () => {
        const h = await heading(desk, 'Order history');
        await point(desk, h);
        await c.shot('desk', [h, await parentOf(h, 2)], { min: 1300 });
        await sleep(1200);
        await soft(point(desk, await paymentsHeading(desk)));
      });
      await c.step('Copy customer link', async () => {
        await point(desk, 'Copy customer link', 'main', 'button');
        await c.shot('desk', 'Copy customer link', { min: 1100 });
        await soft(tap(desk, 'Copy customer link', 'main', 'button'));
        await sleep(1200);
      });
      await c.step('Change a booked order · the amount due follows', async () => {
        const cart = await heading(desk, 'Shopping cart');
        await point(desk, cart);
        await c.shot('desk', 'main', { min: 1300 });
        const more = await desk.$('[aria-label="One more"]');
        if (more) { await point(desk, more); await tap(desk, more); await sleep(1200); }
        await scrollTo(desk, 0);
        await c.shot('desk', 'main aside', { min: 1000 });
        await sleep(1500);
        await soft(tap(desk, 'Discard changes', 'main', 'button'));
      });
      await c.step('Cancel order: credit, refund or rain check', async () => {
        await tap(desk, 'Cancel order', 'main', 'button');
        await desk.waitForSelector('[aria-label="What happens to the money"]', { visible: true });
        await sleep(600);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        for (const t of ['Wallet credit', 'Refund', 'Rain check']) { await soft(tap(desk, t, '[aria-label="What happens to the money"]', 'button, label, [role="radio"]')); await sleep(500); }
        await tap(desk, 'Keep the order', 'dialog[open]', 'button');
        await sleep(500);
      });
      await c.step('Rain check: the weather stopped the event', async () => {
        await tap(desk, 'Rain check · weather', 'main', 'button');
        await sleep(1000);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        await soft(point(desk, '[aria-label="Rain check preview"]'));
        await sleep(1500);
        await desk.keyboard.press('Escape');
        await sleep(400);
      });
    });
  },

  async 9({ desk }) {
    await go(desk, '/orders');
    await chapter(9, 'Orders, Action needed and Calendar', { desk }, async (c) => {
      await c.step('Orders: upcoming, drafts, unpaid, past, cancelled', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Drafts & quotes', 'Booked unpaid', 'Past', 'Cancelled', 'Upcoming']) { await soft(tap(desk, t, 'main', 'button, a')); await sleep(700); }
      });
      await c.step('Search · pick a location', async () => {
        await c.shot('desk', ['input[aria-label="Search orders"]', 'select[aria-label="Location"]'], { min: 1200 });
        await soft(tap(desk, 'All', 'main', 'button, a'));
        await typeIn(desk, 'input[aria-label="Search orders"]', 'Mitchell', 90);
        await sleep(1200);
        await soft(point(desk, 'select[aria-label="Location"]'));
      });
      await c.step('Action needed: your to-do list', async () => {
        await go(desk, '/actions');
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Quotes sent this week', 'Quote → booking', 'Booked for next 7 days']) await soft(point(desk, t, 'main', 'p, span, div'));
      });
      await c.step('Cards that need a person · open or snooze', async () => {
        await soft(point(desk, 'Open order', 'main', 'a, button'));
        await c.shot('desk', 'main', { min: 1200 });
        await soft(point(desk, 'Snooze 1 day', 'main', 'button'));
        await sleep(1200);
      });
      await c.step('Calendar: month, week, day', async () => {
        await go(desk, '/calendar');
        await c.shot('desk', 'main', { min: 1300 });
        const next = await desk.$('main a[aria-label^="Next"]');
        if (next) { await tap(desk, next); await desk.waitForNetworkIdle({ idleTime: 500 }).catch(() => {}); await sleep(900); }
        await soft(point(desk, 'Delivery', 'main', 'span, p, div'));
        await soft(tap(desk, 'Week', 'main', 'button, a, [role="radio"]'));
        await sleep(1200);
        await soft(tap(desk, 'Month', 'main', 'button, a, [role="radio"]'));
        await sleep(900);
      });
      await c.step('Pick a location · open a booking', async () => {
        await soft(point(desk, 'select[aria-label="Location"]'));
        await c.shot('desk', 'main', { min: 1300 });
        const ev = await desk.$('main a[href*="/orders/"]');
        if (ev) { await point(desk, ev); await sleep(500); await tap(desk, ev); await desk.waitForNetworkIdle({ idleTime: 500 }).catch(() => {}); await sleep(1200); await c.shot('desk', 'full'); }
      });
    });
  },

  async 10({ desk }) {
    await go(desk, '/invoices');
    await chapter(10, 'Invoices and payments', { desk }, async (c) => {
      await c.step('Outstanding · overdue · auto-charges · collected', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Outstanding', 'Overdue', 'Auto-charges this week', 'Collected this month']) await soft(point(desk, t, 'main', 'p, span, div'));
      });
      await c.step('One invoice per order · filter · search', async () => {
        await c.shot('desk', ['input[aria-label="Search invoices"]', 'Paid'], { min: 1200 });
        for (const t of ['Open', 'Paid', 'All']) { await soft(tap(desk, t, 'main', 'button')); await sleep(600); }
        await typeIn(desk, 'input[aria-label="Search invoices"]', 'Sarah', 90);
        await sleep(900);
      });
      await c.step('The invoice: email, PDF, pay link', async () => {
        const row = await desk.evaluateHandle(() => [...document.querySelectorAll('main button, main a, main tr, main li')].find((r) => /Sarah Mitchell/.test(r.innerText) && /Part paid|Paid/.test(r.innerText)));
        await tap(desk, row);
        await sleep(1000);
        await c.shot('desk', ['Email invoice', 'Amount due'], { min: 1100 });
        for (const t of ['Email invoice', 'PDF', 'Pay link']) await soft(point(desk, t, 'main', 'button, a'));
      });
      await c.step('Payment schedule · receipts', async () => {
        const h = await heading(desk, 'Payment schedule');
        await point(desk, h);
        await c.shot('desk', [h, await parentOf(h, 1)], { min: 1100 });
        await soft(point(desk, 'Receipts', 'main', 'p, span, h3'));
        await sleep(1200);
      });
      await c.step('Payments: every payment · the receipt', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Payments', 'main', '[role="tab"], button, a');
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        const row = await orNull(await desk.evaluateHandle(() => [...document.querySelectorAll('main tr, main li, main button')].find((r) => /Sarah Mitchell/.test(r.innerText))));
        if (row) { await tap(desk, row); await sleep(1500); }
        await soft(point(desk, 'Send receipt', 'body', 'button, label'));
      });
    });
  },

  async 11({ desk }) {
    await go(desk, '/reports');
    await chapter(11, 'Reports', { desk }, async (c) => {
      await c.step('More than thirty reports · find one', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await scrollTo(desk, 500);
        await sleep(600);
        await scrollTo(desk, 0);
        await typeIn(desk, 'input[placeholder="Find a report"]', 'Sales by', 100);
        await sleep(900);
        await desk.click('input[placeholder="Find a report"]', { clickCount: 3 });
        await desk.keyboard.press('Backspace');
        await soft(tap(desk, 'Sales Overview', 'main', 'button, a, li'));
      });
      await c.step('Period · location', async () => {
        await c.shot('desk', ['This month', 'select[aria-label="Location"]'], { min: 1200 });
        await tap(desk, 'Quarter', 'main', 'button, [role="radio"], a');
        await sleep(1500);
        await soft(point(desk, 'Custom', 'main', 'button, [role="radio"], a'));
        await soft(point(desk, 'select[aria-label="Location"]'));
      });
      await c.step('Totals · chart · hover for the amount', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        const bar = await orNull(await desk.evaluateHandle(() => [...document.querySelectorAll('main svg rect, main [role="img"] rect, main svg path')].filter((r) => r.getBoundingClientRect().height > 8 && r.getBoundingClientRect().width < 80).at(0)));
        if (bar && (await bar.boundingBox())) await hover(desk, bar);
        await sleep(1500);
      });
      await c.step('Export CSV · PDF · Email weekly', async () => {
        await c.shot('desk', ['Export CSV', 'Email weekly'], { min: 1100 });
        for (const t of ['Export CSV', 'PDF', 'Email weekly']) await soft(point(desk, t, 'main', 'button, a'));
      });
    });
  },

  async 12({ desk }) {
    await go(desk, '/settings/workspace');
    await chapter(12, 'Settings: workspace and brand', { desk }, async (c) => {
      await c.step('Workspace and brand: your logo', async () => {
        await c.shot('desk', 'full');
        await sleep(800);
        await c.shot('desk', ['Logo', 'Upload logo'], { min: 1200 });
        await soft(point(desk, 'Upload logo', 'main', 'button, label'));
        await soft(point(desk, 'Size', 'main', 'span, p, label'));
      });
      await c.step('Colour, sidebar, corners, fonts · live preview', async () => {
        const theme = await heading(desk, 'Theme');
        await point(desk, theme);
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Sidebar', 'Corners', 'Heading font on customer pages']) await soft(point(desk, t, 'main', 'p, span, label'));
        await soft(point(desk, 'CUSTOMER QUOTE PAGE', 'main', 'p, span'));
      });
      await c.step('Business profile', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Business profile', 'main', '[role="tab"], button, a');
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Time zone', 'main', 'label'));
        await soft(point(desk, 'Currency', 'main', 'label'));
      });
      await c.step('Rental rules', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Rental rules', 'main', '[role="tab"], button, a');
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Deposit to book', 'Damage waiver', 'Minimum booking', 'Quotes expire after', 'Rain checks valid for']) await soft(point(desk, t, 'main', 'label, p, span'));
      });
      await c.step('Agreement · policies to accept', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Agreement', 'main', '[role="tab"], button, a');
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Policies to accept', 'main', 'h2, h3, p, span'));
        await sleep(1000);
      });
    });
  },

  async 13({ desk }) {
    await go(desk, '/settings/locations');
    await chapter(13, 'Settings: locations', { desk }, async (c) => {
      await c.step('Each location: time zone, tax, travel, email, payments', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Dallas', 'Houston', 'Phoenix']) await soft(point(desk, t, 'main', 'button, a, li'));
        await soft(point(desk, 'Timezone', 'main', 'label'));
      });
      await c.step('Address · pin · loading notes for the crew', async () => {
        const map = await desk.$('main .mapboxgl-canvas, main canvas');
        if (map) { await point(desk, map); await c.shot('desk', [map], { min: 1100 }); }
        await sleep(800);
        await soft(point(desk, 'Loading notes for crew', 'main', 'label'));
      });
      await c.step('Tax and numbering · service area', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Tax & numbering', 'main', '[role="tab"], button, a');
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Default sales tax', 'main', 'label'));
        await tap(desk, 'Service area', 'main', '[role="tab"], button, a');
        await sleep(1200);
        await soft(point(desk, 'ZIP codes this location serves', 'main', 'label'));
      });
      await c.step('Pause new orders · primary location', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'General', 'main', '[role="tab"], button, a');
        await sleep(800);
        await soft(point(desk, 'Pause new orders', 'main', 'label, p, span'));
        await c.shot('desk', ['Pause new orders', 'Primary location'], { min: 1100 });
        await soft(point(desk, 'Primary location', 'main', 'label, p, span'));
      });
    });
  },

  async 14({ desk }) {
    await go(desk, '/settings/messaging');
    await chapter(14, 'Settings: email, SMS and automations', { desk }, async (c) => {
      await c.step('Four steps to go live', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['Connect mail server', 'Choose what to send', 'Review templates', 'Go live']) await soft(point(desk, t, 'main', 'p, span, div'));
      });
      await c.step('Your own mail server · test it · per location', async () => {
        await soft(point(desk, 'Mail server (SMTP)', 'main', 'h2, h3'));
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Send test email', 'main', 'button'));
        await soft(point(desk, 'Per location', 'main', 'h2, h3'));
      });
      await c.step('Text messages', async () => {
        const h = await heading(desk, 'Text messages');
        if (h) { await point(desk, h); await c.shot('desk', [h, await parentOf(h, 1)], { min: 1000 }); }
        await sleep(1500);
      });
      await c.step('Automations: instant and scheduled', async () => {
        await scrollTo(desk, 0);
        await tap(desk, 'Automations & schedules', 'main', 'a, [role="tab"], button');
        await desk.waitForFunction(() => location.search.includes('tab=auto'), { timeout: 15000 }).catch(() => {});
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Sent right away', 'main', 'h2, h3, p, span'));
        await soft(point(desk, 'Scheduled', 'main', 'h2, h3, p, span'));
      });
      await c.step('Quiet hours · office alerts', async () => {
        const q = await heading(desk, 'Quiet hours');
        if (q) { await point(desk, q); await c.shot('desk', [q, await parentOf(q, 1)], { min: 1100 }); }
        await sleep(800);
        const a = await heading(desk, 'Internal alerts');
        if (a) await point(desk, a);
        await sleep(800);
      });
      await c.step('Edit template · fields · live preview', async () => {
        await tap(desk, 'Edit template', 'main');
        await desk.waitForFunction(() => location.pathname.includes('/templates'), { timeout: 15000 }).catch(() => {});
        await desk.waitForNetworkIdle({ idleTime: 600 }).catch(() => {});
        await sleep(800);
        await c.shot('desk', 'main', { min: 1300 });
        await soft(point(desk, 'Insert a field', 'main', 'button, p, span'));
        await soft(tap(desk, 'Phone', 'main', 'button, [role="radio"]'));
        await sleep(1500);
      });
      await c.step('Message log · see what was sent · resend', async () => {
        await go(desk, '/settings/messaging?tab=log');
        await c.shot('desk', 'main', { min: 1300 });
        const btn = await desk.$('[aria-label="View message"]');
        if (btn) {
          await tap(desk, btn);
          await desk.waitForSelector('dialog[open] iframe', { visible: true, timeout: 15000 }).catch(() => {});
          await sleep(900);
          await c.shot('desk', 'dialog[open] iframe', { min: 1000 });
          await sleep(2500);
          await desk.keyboard.press('Escape');
          await sleep(500);
        }
        await soft(point(desk, '[aria-label="Resend"]'));
      });
    });
  },

  async 15({ desk }) {
    await go(desk, '/settings/team');
    await chapter(15, 'Settings: team, roles and activity', { desk }, async (c) => {
      await c.step('Everyone who can sign in', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        for (const t of ['ROLE', 'BRANCHES', 'STATUS', 'COMMISSION']) await soft(point(desk, await byText(desk, t, 'th, div, span')));
      });
      await c.step('Invite people · pick a role', async () => {
        await tap(desk, 'Invite people', 'body', 'button');
        await sleep(900);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        const email = await desk.$('dialog[open] input[type="email"]');
        if (email) await typeIn(desk, email, 'new.teammate@yourbusiness.com', 30);
        const role = await desk.$('dialog[open] select');
        if (role) await point(desk, role);
        await sleep(1200);
        await desk.keyboard.press('Escape');
        await sleep(400);
      });
      await c.step('What each role can do · extra permissions', async () => {
        const h = await heading(desk, 'What each role can do');
        await point(desk, h);
        await c.shot('desk', [h, await parentOf(h, 2)], { min: 1300 });
        await soft(point(desk, 'Extra permissions can be granted', 'main', 'p, span'));
        await sleep(1200);
      });
      await c.step('The activity log', async () => {
        await go(desk, '/settings/activity');
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1500);
        await scrollTo(desk, 300);
        await sleep(1200);
      });
    });
  },
};

// --- run -------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const want = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (args.includes('wipe')) {
  console.log('wipe', JSON.stringify(fixture(`wipe-video ${CUSTOMER.email}`)));
  process.exit(0);
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: [`--force-device-scale-factor=${SCALE}`], protocolTimeout: 180000 });
const desk = await newPage(browser, { width: W, height: H, deviceScaleFactor: SCALE });
try {
  if (want.length && !want.includes(1)) {
    await desk.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle2' });
    await desk.type('#si-email', 'tim@demo.tentpole.test');
    await desk.keyboard.press('Enter');
    await desk.waitForSelector('#si-pass', { visible: true });
    await desk.type('#si-pass', 'Tentpole-2026!');
    await desk.keyboard.press('Enter');
    await desk.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });
  }
  for (const id of Object.keys(CHAPTERS).map(Number)) {
    if (want.length && !want.includes(id)) continue;
    await desk.bringToFront();
    await CHAPTERS[id]({ desk, browser });
  }
  if (!want.length) console.log('wipe', JSON.stringify(fixture(`wipe-video ${CUSTOMER.email}`)));
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  let i = 0;
  for (const pg of await browser.pages()) await pg.screenshot({ path: join(VIDEO, P.clips, `zz-failure${i++ ? `-${i}` : ''}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
