/**
 * Records the walkthrough video's screen, one silent clip per chapter, as Tim
 * Masters in Freedom Fun USA (customer: Muhammad Hanzla). Each chapter is a list
 * of steps that match the narration script's [pause] marks; each step has one or
 * more shots, and each shot a 16:9 crop of the 1600x900 screen (recorded at 2x),
 * so the assembly can zoom in and stay readable on a phone.
 *   node apps/web/scripts/video/record.mjs            all chapters
 *   node apps/web/scripts/video/record.mjs 1 2 3      some chapters
 * Output: .data/video/clips/chNN*.mp4 + chNN.json (steps, shots, captions).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { startCapture } from './capture.mjs';

const BASE = 'http://localhost:3000';
const S = `${BASE}/freedom-fun-demo`;
const ROOT = resolve(import.meta.dirname, '../../../..');
const OUT = join(ROOT, '.data/video/clips');
const FRAMES = join(ROOT, '.data/video/frames');
const STATE = join(ROOT, '.data/video/state.json');
mkdirSync(OUT, { recursive: true });
const W = 1600;
const H = 900;
const CUSTOMER = { first: 'Muhammad', last: 'Hanzla', email: 'muhammadhanzla260+video@gmail.com', phone: '(512) 555-0418', street: '1100 Congress Ave' };
const EVENT_DAY = '2026-11-21';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const fixture = (args) => JSON.parse(execSync(`pnpm --filter @rental/db exec tsx ../../apps/web/scripts/video/fixtures.ts ${args}`, { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').at(-1));

// --- the visible cursor and click ring (inside an open dialog when there is one, so it stays on top) ---
const OVERLAY = `(() => {
  if (window.__vc) return;
  const css = '#__vc{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transition:transform .6s cubic-bezier(.2,.8,.2,1)}'
    + '.__vr{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:4px solid #f97316;z-index:2147483647;pointer-events:none;animation:__vr .7s ease-out forwards}'
    + '@keyframes __vr{from{transform:scale(.3);opacity:1}to{transform:scale(1.5);opacity:0}}';
  const svg = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.4 6.9z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  let x = ${W / 2}, y = ${H / 2};
  const host = () => document.querySelector('dialog[open]') || document.body;
  const el = () => {
    let c = document.getElementById('__vc');
    if (!c) { c = document.createElement('div'); c.id = '__vc'; c.innerHTML = svg; }
    if (c.parentElement !== host()) host().appendChild(c);
    if (!document.getElementById('__vcs')) { const s = document.createElement('style'); s.id = '__vcs'; s.textContent = css; document.head.appendChild(s); }
    return c;
  };
  window.__vc = {
    move(nx, ny) { x = nx; y = ny; el().style.transform = 'translate(' + (x - 4) + 'px,' + (y - 2) + 'px)'; },
    ring() { const r = document.createElement('div'); r.className = '__vr'; r.style.left = x + 'px'; r.style.top = y + 'px'; host().appendChild(r); setTimeout(() => r.remove(), 800); },
    show() { this.move(x, y); },
  };
  const go = () => window.__vc.show();
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();`;

async function newPage(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluateOnNewDocument(OVERLAY);
  page.on('pageerror', (e) => console.log(`  page error: ${e.message.slice(0, 160)}`));
  return page;
}
const overlay = (page) => page.evaluate(OVERLAY).then(() => page.evaluate(() => window.__vc.show()));

/** Find an element by CSS, or by its visible text inside `within`. */
async function find(page, target, within = 'body', tags = 'button, a, [role="tab"], [role="radio"], label, li, tr') {
  if (typeof target !== 'string' || /^[#.[]|^[a-z]+\[/.test(target)) {
    const h = typeof target === 'string' ? await page.waitForSelector(target, { visible: true, timeout: 20000 }) : target;
    return h;
  }
  await page.waitForFunction((t, w, g) => [...(document.querySelector(w)?.querySelectorAll(g) ?? [])].some((e) => e.innerText?.trim().startsWith(t) && e.offsetParent), { timeout: 20000 }, target, within, tags);
  return page.evaluateHandle((t, w, g) => [...document.querySelector(w).querySelectorAll(g)].find((e) => e.innerText?.trim().startsWith(t) && e.offsetParent), target, within, tags);
}
async function point(page, target, within, tags) {
  const h = await find(page, target, within, tags);
  await h.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await sleep(250);
  const box = await h.boundingBox();
  await overlay(page);
  if (box) await page.evaluate((x, y) => window.__vc.move(x, y), box.x + Math.min(box.width / 2, 60), box.y + box.height / 2);
  await sleep(650);
  return h;
}
async function tap(page, target, within, tags) {
  const h = await point(page, target, within, tags);
  await page.evaluate(() => window.__vc.ring());
  await h.click();
  await sleep(500);
  return h;
}
async function typeIn(page, target, text, delay = 45) {
  const h = await tap(page, target);
  await h.type(text, { delay });
  await sleep(250);
}
async function setValue(page, sel, value) {
  await point(page, sel);
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel, value);
  await sleep(500);
}
/** Stripe's card field: whichever Stripe frame holds the card number input (frame names change). */
async function stripeCard(page) {
  for (let i = 0; i < 90; i++) {
    for (const h of await page.$$('iframe[src*="js.stripe.com"]')) {
      const f = await h.contentFrame().catch(() => null);
      if (f && (await f.$('input[name="number"]').catch(() => null)) && (await h.boundingBox())?.height > 20) return { handle: h, frame: f };
    }
    await sleep(500);
  }
  throw new Error('Stripe card field did not appear');
}
async function typeCard(page, frame) {
  await frame.type('input[name="number"]', '4242424242424242', { delay: 55 });
  await frame.type('input[name="expiry"]', '1230', { delay: 70 });
  await frame.type('input[name="cvc"]', '123', { delay: 70 });
  if (await frame.$('input[name="postalCode"]')) await frame.type('input[name="postalCode"]', '78701', { delay: 70 });
}

/** The main action button with this label in the open dialog (not the tab of the same name). */
const action = (page, label) => page.evaluateHandle((l) => [...document.querySelectorAll('dialog[open] button:not([role="tab"])')].filter((b) => b.innerText.trim() === l && b.offsetParent).at(-1), label);
/** The order screen's "Payments" heading (in the order history). */
const paymentsHeading = (page) => page.evaluateHandle(() => [...document.querySelectorAll('main h2')].find((h) => h.textContent.trim() === 'Payments'));
const waitText = (page, t, timeout = 30000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

/** A 16:9 box around these elements (CSS px of the viewport), at least `min` wide. */
async function cropFor(page, targets, { min = 960, pad = 28 } = {}) {
  const vp = page.viewport();
  if (targets === 'full') return [0, 0, vp.width, vp.height];
  const boxes = [];
  for (const t of [].concat(targets)) {
    const h = typeof t === 'string' && /^[#.[]|^[a-z]+\[|^dialog|^aside|^main|^section/.test(t) ? await page.$(t) : await find(page, t).catch(() => null);
    const b = h && (await h.boundingBox());
    if (b) boxes.push(b);
  }
  if (!boxes.length) return [0, 0, vp.width, vp.height];
  let x1 = Math.min(...boxes.map((b) => b.x)) - pad;
  let y1 = Math.min(...boxes.map((b) => b.y)) - pad;
  let x2 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  let y2 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  const ar = vp.width / vp.height;
  let w = Math.max(min, x2 - x1, (y2 - y1) * ar);
  w = Math.min(w, vp.width);
  const h = w / ar;
  let x = (x1 + x2) / 2 - w / 2;
  let y = (y1 + y2) / 2 - h / 2;
  x = Math.max(0, Math.min(vp.width - w, x));
  y = Math.max(0, Math.min(vp.height - h, y));
  return [x, y, w, h].map((n) => Math.round(n));
}

/** One chapter: steps (one per [pause]-separated sentence), each with shots (a crop over a stretch of time). */
async function chapter(id, name, pages, fn) {
  const tag = `ch${String(id).padStart(2, '0')}`;
  console.log(`${tag} ${name}`);
  const caps = {};
  for (const [k, page] of Object.entries(pages)) caps[k] = await startCapture(page, join(FRAMES, `${tag}-${k}`));
  const steps = [];
  let step = null;
  let shot = null;
  const close = () => { if (shot) { shot.t1 = caps[shot.clip].now(); shot = null; } };
  const ctx = {
    async step(caption, fn2) {
      close();
      step = { caption, shots: [] };
      steps.push(step);
      await fn2();
      close();
    },
    /** Start a new shot on this page with a crop around `targets` ('full' for the whole screen). */
    async shot(clip, targets, opts) {
      close();
      const crop = await cropFor(pages[clip], targets, opts);
      shot = { clip, t0: caps[clip].now(), crop };
      step.shots.push(shot);
    },
  };
  await fn(ctx);
  close();
  const clips = {};
  for (const [k, c] of Object.entries(caps)) {
    const file = join(OUT, `${tag}-${k}.mp4`);
    const r = await c.stop(file);
    clips[k] = { file, ...r, size: pages[k].viewport() };
  }
  writeFileSync(join(OUT, `${tag}.json`), JSON.stringify({ id, name, clips, steps }, null, 2));
  console.log(`  ${steps.length} steps · ${Object.values(clips).map((c) => `${c.frames} frames ${c.seconds.toFixed(1)} s`).join(' · ')}`);
}

// --- title cards ---------------------------------------------------------------------------------
const card = (title, sub) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 70% 20%,#3b1d0b,#0b0d12 60%);font-family:'Segoe UI',system-ui,sans-serif;color:#fff}
  .b{display:flex;align-items:center;gap:22px;margin-bottom:34px}.l{width:84px;height:84px;border-radius:22px;background:#c2410c;display:grid;place-items:center;font-weight:800;font-size:34px}
  h1{font-size:84px;line-height:1.02;margin:0 0 22px;letter-spacing:-.02em;max-width:1200px}p{font-size:30px;color:#d4d4d8;margin:0}
  .w{animation:in .9s cubic-bezier(.2,.8,.2,1) both}@keyframes in{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
</style></head><body><div class="w"><div class="b"><div class="l">FF</div><div style="font-size:32px;font-weight:700">Freedom Fun USA</div></div><h1>${title}</h1><p>${sub}</p></div></body></html>`;

// --- chapters ------------------------------------------------------------------------------------
const CHAPTERS = {
  async 0({ desk }) {
    await chapter(0, 'Welcome', { desk }, async (c) => {
      await desk.setContent(card('Run your rental business, step by step', 'From the first phone call to a paid booking · under 5 minutes'));
      await c.step('Welcome', async () => { await c.shot('desk', 'full'); await sleep(4000); });
    });
  },

  async 1({ desk }) {
    fixture(`reset-customer ${CUSTOMER.email}`);
    await desk.goto(S, { waitUntil: 'networkidle2' });
    await chapter(1, 'Add a customer', { desk }, async (c) => {
      await c.step('Customers → Add customer', async () => {
        await c.shot('desk', 'full');
        await tap(desk, 'Customers', 'nav');
        await waitText(desk, 'Add customer');
        await c.shot('desk', ['h1', 'Add customer'], { min: 1100 });
        await tap(desk, 'Add customer', 'body', 'button');
        await desk.waitForSelector('#c-first', { visible: true });
      });
      await c.step('Name, email, mobile and address', async () => {
        await sleep(400);
        await c.shot('desk', ['#c-first', 'dialog[open] footer'], { min: 1000 });
        await typeIn(desk, '#c-first', CUSTOMER.first);
        await typeIn(desk, '#c-last', CUSTOMER.last);
        await typeIn(desk, '#c-email', CUSTOMER.email, 25);
        await typeIn(desk, '#c-phone', CUSTOMER.phone);
        const street = 'dialog[open] input[id$="-line1"]';
        await typeIn(desk, street, CUSTOMER.street, 60);
        await desk.waitForSelector('[role=listbox] [role=option]', { timeout: 15000 });
        await sleep(600);
        await tap(desk, '[role=listbox] [role=option]');
        await sleep(1200);
        await tap(desk, 'Add customer', 'dialog[open]', 'button');
        await desk.waitForFunction(() => !document.querySelector('dialog[open] #c-first'), { timeout: 20000 }).catch(async (e) => {
          console.log('  still open:', await desk.evaluate(() => [...document.querySelectorAll('[role=alert], [role=status], dialog[open] .text-danger')].map((x) => x.innerText).join(' | ').slice(0, 400)));
          throw e;
        });
        await sleep(1500);
        state.customerId = await desk.evaluate(() => new URL(location.href).searchParams.get('id'));
        save();
      });
    });
  },

  async 2({ desk }) {
    if (state.orderA) {
      fixture(`remove-order ${state.orderA}`);
      delete state.orderA;
      delete state.numA;
      save();
    }
    await desk.bringToFront();
    await desk.goto(S, { waitUntil: 'networkidle2' });
    await chapter(2, 'Build an order', { desk }, async (c) => {
      await c.step('New order → pick the customer', async () => {
        await c.shot('desk', 'full');
        await tap(desk, 'New order', 'nav');
        await desk.waitForSelector('#ob-date', { visible: true });
        await c.shot('desk', ['h2', 'input[placeholder="Search by name, email or phone"]'], { min: 1000 });
        await typeIn(desk, 'input[placeholder="Search by name, email or phone"]', 'Muhammad H', 70);
        await desk.waitForFunction((e) => [...document.querySelectorAll('[role=option], li button, [role=listbox] *')].some((x) => x.innerText?.includes(e)), { timeout: 15000 }, CUSTOMER.email);
        const opt = await desk.evaluateHandle((e) => [...document.querySelectorAll('[role=option], li button, button')].find((x) => x.innerText?.includes(e)), CUSTOMER.email);
        await tap(desk, opt);
        await waitText(desk, CUSTOMER.email);
      });
      await c.step('Event date, time and address', async () => {
        await point(desk, '#ob-date');
        await c.shot('desk', ['#ob-type', '#ob-end'], { min: 1100 });
        await setValue(desk, '#ob-type', 'Birthday');
        await setValue(desk, '#ob-date', EVENT_DAY);
        await setValue(desk, '#ob-start', '13:00');
        await setValue(desk, '#ob-dur', 240);
        await point(desk, 'Billing address');
        await c.shot('desk', ['Billing address', '#ob-cmobile'], { min: 1100 });
        await tap(desk, 'Billing address');
        // The on-site contact fills in from the customer: just confirm it.
        await point(desk, '#ob-cmobile');
        await sleep(600);
        await tap(desk, 'I confirmed the event day point of contact', 'main');
        await sleep(1500);
      });
      await c.step('Click a product to add it', async () => {
        const names = await desk.$$eval('button[aria-label^="Add "]', (bs) => bs.filter((b) => /\d+ of \d+ free/.test(b.innerText) && b.offsetParent).map((b) => b.getAttribute('aria-label')).slice(0, 6));
        const pick = names.slice(0, 2);
        state.products = pick;
        save();
        await point(desk, `button[aria-label="${pick[0]}"]`);
        await c.shot('desk', [`button[aria-label="${pick[0]}"]`, `button[aria-label="${pick[1]}"]`], { min: 1100 });
        await tap(desk, `button[aria-label="${pick[0]}"]`);
        await sleep(700);
        await tap(desk, `button[aria-label="${pick[1]}"]`);
        await sleep(1500);
      });
      await c.step('The price adds up live · the damage waiver is your call', async () => {
        await desk.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await sleep(700);
        await c.shot('desk', 'main aside', { min: 1000 });
        const label = (t) => desk.evaluateHandle((x) => [...document.querySelectorAll('[aria-label="Order summary"] *')].find((e) => e.childElementCount === 0 && e.textContent?.trim() === x), t);
        await point(desk, await label('Damage waiver'));
        await sleep(1800);
        await point(desk, await label('Total'));
        await sleep(1800);
      });
    });
  },

  async 3({ desk }) {
    await chapter(3, 'Option one: send a quote', { desk }, async (c) => {
      await c.step('Payment options: three ways to finish', async () => {
        await c.shot('desk', 'main aside', { min: 1000 });
        await tap(desk, 'Payment options', 'main aside');
        await desk.waitForSelector('dialog[open] [role="tablist"]', { visible: true });
        await sleep(800);
        await c.shot('desk', 'dialog[open] [role="tablist"]', { min: 1200 });
        await sleep(1500);
      });
      await c.step('Send Quote Only', async () => {
        await tap(desk, 'Send Quote Only', 'dialog[open] [role="tablist"]');
        await sleep(600);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await sleep(1200);
        await tap(desk, await action(desk, 'Send Quote Only'));
        await desk.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => /Quote (emailed|marked as sent)/.test(e.innerText)), { timeout: 30000 });
        await sleep(2000);
        // A new order moves to its own address once the quote is sent.
        await desk.waitForFunction(() => /\/orders\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 20000 });
        state.orderA = await desk.evaluate(() => location.pathname.split('/').pop());
        state.numA = await desk.evaluate(() => document.body.innerText.match(/Q-AUS-\d{5}/)?.[0]);
        save();
      });
    });
  },

  async 4({ desk }) {
    if (!state.orderB || state.orderBUsed) {
      if (state.orderB) fixture(`remove-order ${state.orderB}`);
      const o = fixture(`orders ${CUSTOMER.email}`);
      if (state.orderC) fixture(`remove-order ${o.c.id}`);
      else Object.assign(state, { orderC: o.c.id, numC: o.c.number });
      Object.assign(state, { orderB: o.b.id, numB: o.b.number, orderBUsed: false });
      save();
    }
    state.orderBUsed = true;
    save();
    await desk.goto(`${S}/orders/${state.orderB}`, { waitUntil: 'networkidle2' });
    await chapter(4, 'Option two: book without payment', { desk }, async (c) => {
      await c.step('Submit Order Without Payment', async () => {
        await c.shot('desk', 'main aside', { min: 1000 });
        await tap(desk, 'Payment options', 'main aside');
        await desk.waitForSelector('dialog[open] [role="tablist"]', { visible: true });
        await tap(desk, 'Submit Order Without Payment', 'dialog[open] [role="tablist"]');
        await sleep(500);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await sleep(1000);
      });
      await c.step('Reason and expected date → booked · Action needed', async () => {
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await setValue(desk, '#bk-reason', await desk.$eval('#bk-reason option:nth-child(2)', (o) => o.value));
        await setValue(desk, '#bk-date', '2026-11-13');
        const boxes = await desk.$$('dialog[open] section label');
        for (const b of boxes) {
          const txt = await b.evaluate((e) => e.innerText);
          if (txt.length > 20 && !/receipt/i.test(txt)) { await tap(desk, b); await sleep(150); }
        }
        await tap(desk, await action(desk, 'Submit Order Without Payment'));
        await desk.waitForFunction(() => /is booked/.test(document.querySelector('dialog[open]')?.innerText ?? ''), { timeout: 45000 });
        await sleep(1800);
        await tap(desk, 'Keep editing', 'dialog[open]');
        await sleep(1200);
        await desk.goto(`${S}/actions`, { waitUntil: 'networkidle2' });
        await overlay(desk);
        await c.shot('desk', ['h1', 'Deposit needed'], { min: 1200 });
        await sleep(2500);
      });
    });
  },

  async 5({ desk }) {
    if (state.orderCUsed) {
      fixture(`remove-order ${state.orderC}`);
      const o = fixture(`orders ${CUSTOMER.email}`);
      fixture(`remove-order ${o.b.id}`);
      Object.assign(state, { orderC: o.c.id, numC: o.c.number, orderCUsed: false });
      save();
    }
    fixture(`forget-cards ${CUSTOMER.email}`);
    state.orderCUsed = true;
    save();
    await desk.goto(`${S}/orders/${state.orderC}`, { waitUntil: 'networkidle2' });
    await chapter(5, 'Option three: record the payment', { desk }, async (c) => {
      await c.step('Record Payment Received', async () => {
        await c.shot('desk', 'main aside', { min: 1000 });
        await tap(desk, 'Payment options', 'main aside');
        await desk.waitForSelector('#po-method', { visible: true });
        await sleep(700);
        await c.shot('desk', 'dialog[open] section', { min: 1100 });
        await sleep(1200);
      });
      await c.step('Card in the secure Stripe field · keep Save card ticked', async () => {
        const { handle: fh, frame } = await stripeCard(desk);
        await fh.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await sleep(500);
        await c.shot('desk', [fh, 'Save card info'], { min: 1000 });
        const fb = await fh.boundingBox();
        await desk.evaluate((x, y) => window.__vc.move(x, y), fb.x + 80, fb.y + 40);
        await sleep(600);
        await typeCard(desk, frame);
        await point(desk, 'Save card info', 'dialog[open]');
        await sleep(1200);
      });
      await c.step('Deposit or full balance · tip · Record', async () => {
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
        await sleep(800);
        await c.shot('desk', 'dialog[open] section', { min: 1000 });
        await sleep(2500);
        await tap(desk, 'Keep editing', 'dialog[open]');
        await desk.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        await overlay(desk);
        await desk.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === 'Payments'), { timeout: 30000 });
        const pay = await paymentsHeading(desk);
        await point(desk, pay);
        await c.shot('desk', [pay, await pay.evaluateHandle((h) => h.parentElement)], { min: 1100 });
        await sleep(2500);
      });
    });
  },

  async 6({ desk }) {
    fixture(`email-invoice ${state.orderC}`);
    await desk.goto(`${S}/settings/messaging?tab=log`, { waitUntil: 'networkidle2' });
    const view = async (c, num, label) => {
      const row = await desk.evaluateHandle((n, l) => [...document.querySelectorAll('li, tr, [role=row]')].find((r) => r.innerText.includes(n) && r.innerText.includes(l) && r.querySelector('[aria-label="View message"]')), num, label);
      const btn = await row.evaluateHandle((r) => r.querySelector('[aria-label="View message"]'));
      await tap(desk, btn);
      await desk.waitForSelector('dialog[open] iframe', { visible: true, timeout: 15000 });
      await sleep(900);
      await c.shot('desk', 'dialog[open] iframe', { min: 1000 });
      await sleep(2600);
      await desk.keyboard.press('Escape');
      await sleep(700);
    };
    await chapter(6, 'The emails your customer receives', { desk }, async (c) => {
      await c.step('Each step sends the right email', async () => {
        await c.shot('desk', 'main', { min: 1200 });
        await sleep(2500);
      });
      await c.step('Quote · invoice', async () => {
        await view(c, state.numA, 'Quote');
        await view(c, state.numC, 'Invoice');
      });
      await c.step('Payment confirmation · booking confirmation', async () => {
        await view(c, state.numC, 'Payment confirmation');
        await view(c, state.numB, 'Booking confirmation');
      });
      await c.step('The Message log', async () => {
        await c.shot('desk', 'main', { min: 1200 });
        await sleep(2500);
      });
    });
  },

  async 7({ desk, browser }) {
    fixture(`unsign ${state.orderA}`);
    fixture(`forget-cards ${CUSTOMER.email}`);
    const { url } = fixture(`quote-url ${state.orderA}`);
    const phone = await newPage(browser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await desk.goto(`${S}/orders/${state.orderA}`, { waitUntil: 'networkidle2' });
    await phone.bringToFront();
    await phone.goto(url, { waitUntil: 'networkidle2' });
    await chapter(7, 'How the customer pays online', { phone, desk }, async (c) => {
      await c.step('What your customer sees, on a phone', async () => {
        await c.shot('phone', 'full');
        await sleep(1500);
        await phone.evaluate(() => window.scrollBy({ top: 500, behavior: 'smooth' }));
        await sleep(1500);
      });
      await c.step('Check the details · accept the policies', async () => {
        await c.shot('phone', 'full');
        await tap(phone, 'Looks good');
        await waitText(phone, 'A few things to agree on');
        const n = await phone.$$eval('section ul button', (x) => x.length);
        for (let i = 0; i < n; i++) {
          const b = (await phone.$$('section ul button'))[i];
          await tap(phone, b);
        }
        await tap(phone, 'Continue to sign');
      });
      await c.step('Sign by typing your name · pay by card', async () => {
        await c.shot('phone', 'full');
        await typeIn(phone, '#q-name', 'Muhammad Hanzla', 70);
        await tap(phone, 'I agree', 'section');
        await tap(phone, 'Sign and continue');
        await waitText(phone, 'Pay to book');
        await sleep(800);
        await point(phone, await phone.evaluateHandle(() => [...document.querySelectorAll('section [role="radio"]')].find((x) => x.innerText.includes('Pay deposit'))));
        await tap(phone, 'Continue to card');
        const { handle: fh, frame } = await stripeCard(phone);
        await fh.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await sleep(500);
        await typeCard(phone, frame);
        await tap(phone, 'Pay $', 'section');
        await phone.waitForFunction(() => /booked|Thank you|all set/i.test(document.body.innerText) && !/Pay to book/.test(document.body.innerText), { timeout: 60000 });
        await sleep(2500);
      });
      await c.step('The order books itself', async () => {
        // Chrome only streams the tab in front: switch to the office screen for this shot.
        await desk.bringToFront();
        await desk.reload({ waitUntil: 'networkidle2' });
        await overlay(desk);
        await desk.waitForFunction(() => [...document.querySelectorAll('main h2')].some((h) => h.textContent.trim() === 'Payments'), { timeout: 30000 });
        const pay = await paymentsHeading(desk);
        await point(desk, pay);
        await c.shot('desk', [pay, await pay.evaluateHandle((h) => h.parentElement)], { min: 1100 });
        await sleep(2500);
      });
    });
    await phone.close();
  },

  async 8({ desk }) {
    await desk.goto(`${S}/products`, { waitUntil: 'networkidle2' });
    await chapter(8, 'Products, categories and inventory', { desk }, async (c) => {
      await c.step('Products: photo, category and prices', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1200);
        const link = await desk.evaluateHandle(() => [...document.querySelectorAll('main a[href*="/products/"]')].find((a) => a.querySelector('img')));
        await tap(desk, link);
        await waitText(desk, 'Pricing');
        await tap(desk, 'Pricing', 'main');
        await sleep(600);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2200);
      });
      await c.step('Inventory tab: owned and out for repair', async () => {
        await tap(desk, 'Inventory', 'main');
        await sleep(800);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2400);
      });
      await c.step('Categories', async () => {
        await tap(desk, 'Products', 'nav');
        await waitText(desk, 'CATEGORIES');
        await c.shot('desk', ['Categories', 'All products'], { min: 1200 });
        await tap(desk, 'Categories', 'header');
        await sleep(1200);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        await sleep(2200);
        await desk.keyboard.press('Escape');
      });
      await c.step('Inventory at a glance · the Calendar', async () => {
        await tap(desk, 'Inventory', 'nav');
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2200);
        await tap(desk, 'Calendar', 'nav');
        await sleep(1500);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2500);
      });
    });
  },

  async 9({ desk }) {
    await desk.goto(`${S}/settings/messaging`, { waitUntil: 'networkidle2' });
    await chapter(9, 'Settings: your email server', { desk }, async (c) => {
      await c.step('Your own mail server · send a test', async () => {
        // The workspace's real server and addresses stay private in the video.
        await desk.addStyleTag({ content: 'main input:not([placeholder="you@yourbusiness.com"]), main select { filter: blur(6px) !important }' });
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1500);
        const test = await desk.$('input[placeholder="you@yourbusiness.com"]');
        if (test) {
          await typeIn(desk, test, 'muhammadhanzla260@gmail.com', 35);
          await tap(desk, 'Send test email', 'main', 'button');
          await sleep(1500);
          await desk.waitForFunction(() => !/Sending a test email/.test(document.querySelector('main')?.innerText ?? ''), { timeout: 60000 }).catch(() => {});
        }
        await sleep(2500);
      });
    });
  },

  async 10({ desk }) {
    await desk.goto(`${S}/settings/messaging?tab=auto`, { waitUntil: 'networkidle2' });
    await chapter(10, 'Settings: email templates and automations', { desk }, async (c) => {
      await c.step('Automations: which emails, and when', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2500);
      });
      await c.step('Edit template · live preview', async () => {
        await tap(desk, 'Edit template', 'main');
        await desk.waitForFunction(() => location.pathname.includes('/templates'), { timeout: 15000 }).catch(() => {});
        await sleep(800);
        await overlay(desk);
        await sleep(1200);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2000);
        await tap(desk, 'Phone', 'main').catch(() => {});
        await sleep(2200);
      });
    });
  },

  async 11({ desk }) {
    await desk.goto(`${S}/settings/team`, { waitUntil: 'networkidle2' });
    await chapter(11, 'Settings: team and roles', { desk }, async (c) => {
      await c.step('Invite people · pick a role', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await tap(desk, 'Invite people', 'body', 'button');
        await sleep(900);
        await c.shot('desk', 'dialog[open] > div', { min: 1000 });
        const email = await desk.$('dialog[open] input[type="email"]');
        if (email) await typeIn(desk, email, 'new.teammate@freedomfunusa.com', 30);
        const role = await desk.$('dialog[open] select');
        if (role) await point(desk, role);
        await sleep(2000);
        await desk.keyboard.press('Escape');
      });
      await c.step('Each role sees what it needs · the activity log', async () => {
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(1500);
        await desk.goto(`${S}/settings/activity`, { waitUntil: 'networkidle2' });
        await overlay(desk);
        await c.shot('desk', 'main', { min: 1300 });
        await sleep(2500);
      });
    });
  },

  async 12({ desk }) {
    await chapter(12, 'Wrap-up', { desk }, async (c) => {
      await desk.setContent(card('A customer, an order, three ways to finish it', 'The emails and payments take care of themselves · Thanks for watching'));
      await c.step('Thanks for watching', async () => { await c.shot('desk', 'full'); await sleep(4000); });
    });
  },
};

// --- run -------------------------------------------------------------------------------------------
const want = process.argv.slice(2).map(Number);
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--force-device-scale-factor=2'], protocolTimeout: 180000 });
const desk = await newPage(browser, { width: W, height: H, deviceScaleFactor: 2 });
try {
  await desk.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle2' });
  await desk.type('#si-email', 'tim@demo.tentpole.test');
  await desk.keyboard.press('Enter');
  await desk.waitForSelector('#si-pass', { visible: true });
  await desk.type('#si-pass', 'Tentpole-2026!');
  await desk.keyboard.press('Enter');
  await desk.waitForFunction(() => !location.pathname.startsWith('/sign-in'), { timeout: 20000 });
  for (const id of Object.keys(CHAPTERS).map(Number)) {
    if (want.length && !want.includes(id)) continue;
    await desk.bringToFront();
    await CHAPTERS[id]({ desk, browser });
  }
} catch (e) {
  console.log(`FAILED: ${e.message}`);
  let i = 0;
  for (const pg of await browser.pages()) await pg.screenshot({ path: join(OUT, `zz-failure${i++ ? `-${i}` : ''}.png`) }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
