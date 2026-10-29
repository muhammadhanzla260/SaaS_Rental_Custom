/**
 * What the video recorders share: finding things on the page by their text, a cursor that is only logged
 * here (it is drawn in post, smooth, at 60 fps), and chapters made of steps and shots.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startCapture } from './capture.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** How long to wait for something to appear (a recorder may shorten it). */
export const opts = { timeout: 20000 };

// --- the cursor: where it goes and when it clicks, per page ---
const events = [];
export const log = (page, ev) => events.push({ clip: page.__key ?? 'desk', t: Date.now() / 1000, ...ev });

export async function newPage(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  page.on('pageerror', (e) => console.log(`  page error: ${e.message.slice(0, 160)}`));
  page.setDefaultNavigationTimeout(90000);
  // A "leave this page?" prompt would stall the navigation: leaving is what the script wants.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
}

/**
 * Find an element by CSS, or by its visible text inside `within` (any case: labels styled in capitals
 * read that way). Of nested matches, the innermost one.
 */
export async function find(page, target, within = 'body', tags = 'button, a, [role="tab"], [role="radio"], label, li, tr', timeout = opts.timeout) {
  if (typeof target !== 'string' || /^[#.[]|^[a-z]+\[/.test(target)) {
    if (target == null) throw new Error('nothing to find');
    const h = typeof target === 'string' ? await page.waitForSelector(target, { visible: true, timeout }) : target;
    return h;
  }
  // (The same lookup twice: page functions can't share code.)
  await page.waitForFunction((t, w, g) => {
    const all = [...document.querySelectorAll(w)].flatMap((root) => [...root.querySelectorAll(g)]).filter((e) => e.offsetParent && e.innerText?.trim().toLowerCase().startsWith(t.toLowerCase()));
    return all.length > 0;
  }, { timeout }, target, within, tags).catch((e) => { throw new Error(`"${target}" not found in ${within}: ${e.message}`); });
  return page.evaluateHandle((t, w, g) => {
    const all = [...document.querySelectorAll(w)].flatMap((root) => [...root.querySelectorAll(g)]).filter((e) => e.offsetParent && e.innerText?.trim().toLowerCase().startsWith(t.toLowerCase()));
    return all.find((e) => !all.some((o) => o !== e && e.contains(o)));
  }, target, within, tags);
}
export async function point(page, target, within, tags) {
  const h = await find(page, target, within, tags);
  await h.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }));
  await sleep(1000);
  const box = await h.boundingBox();
  if (box) log(page, { type: 'move', x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 });
  await sleep(700);
  return h;
}
export async function tap(page, target, within, tags) {
  const h = await point(page, target, within, tags);
  log(page, { type: 'click' });
  await h.click();
  await sleep(500);
  return h;
}
export async function typeIn(page, target, text, delay = 45) {
  const h = await tap(page, target);
  await h.type(text, { delay });
  await sleep(250);
}
export async function setValue(page, sel, value) {
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
export async function stripeCard(page) {
  for (let i = 0; i < 90; i++) {
    for (const h of await page.$$('iframe[src*="js.stripe.com"]')) {
      const f = await h.contentFrame().catch(() => null);
      if (f && (await f.$('input[name="number"]').catch(() => null)) && (await h.boundingBox())?.height > 20) return { handle: h, frame: f };
    }
    await sleep(500);
  }
  throw new Error('Stripe card field did not appear');
}
export async function typeCard(page, frame) {
  await frame.type('input[name="number"]', '4242424242424242', { delay: 55 });
  await frame.type('input[name="expiry"]', '1230', { delay: 70 });
  await frame.type('input[name="cvc"]', '123', { delay: 70 });
  if (await frame.$('input[name="postalCode"]')) await frame.type('input[name="postalCode"]', '78701', { delay: 70 });
}

/** The main action button with this label in the open dialog (not the tab of the same name). */
export const action = (page, label) => page.evaluateHandle((l) => [...document.querySelectorAll('dialog[open] button:not([role="tab"])')].filter((b) => b.innerText.trim() === l && b.offsetParent).at(-1), label);
/** The order screen's "Payments" heading (in the order history). */
export const paymentsHeading = (page) => page.evaluateHandle(() => [...document.querySelectorAll('main h2')].find((h) => h.textContent.trim() === 'Payments'));
export const waitText = (page, t, timeout = 30000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t);

/** A 16:9 box around these elements (CSS px of the viewport), at least `min` wide. */
export async function cropFor(page, targets, { min = 960, pad = 28 } = {}) {
  const vp = page.viewport();
  if (targets === 'full') return [0, 0, vp.width, vp.height];
  const boxes = [];
  for (const t of [].concat(targets)) {
    const h = typeof t === 'string' && /^[#.[]|^[a-z]+\[|^dialog|^aside|^main|^section/.test(t) ? await page.$(t) : await find(page, t, 'body', 'button, a, [role="tab"], [role="radio"], label, li, tr, th, td, h1, h2, h3, p, span', 3000).catch(() => null);
    const b = h && (await h.boundingBox?.().catch(() => null));
    if (b) boxes.push(b);
  }
  if (!boxes.length) return [0, 0, vp.width, vp.height];
  const x1 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y1 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x2 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y2 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
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

/**
 * Records chapters into `clips` (frames into `frames`). With a `speech` manifest, each step stays on
 * screen at least as long as its sentence takes to say, so the picture never has to freeze.
 */
export function recorder({ clips, frames, speech = null }) {
  mkdirSync(clips, { recursive: true });
  return async function chapter(id, name, pages, fn) {
    const tag = `ch${String(id).padStart(2, '0')}`;
    console.log(`${tag} ${name}`);
    const caps = {};
    events.length = 0;
    for (const [k, page] of Object.entries(pages)) { page.__key = k; caps[k] = await startCapture(page, join(frames, `${tag}-${k}`)); }
    const steps = [];
    let shot = null;
    let last = null;
    // A shot cut short (replaced straight away) is dropped, so the edit has no flash frames.
    const close = () => {
      if (!shot) return;
      shot.t1 = caps[shot.clip].now();
      if (shot.t1 - shot.t0 < 0.15) ctx.current.shots.splice(ctx.current.shots.indexOf(shot), 1);
      shot = null;
    };
    const ctx = {
      async step(caption, fn2) {
        close();
        const step = { caption, shots: [] };
        steps.push(step);
        const need = speech?.[tag]?.[steps.length - 1]?.seconds;
        ctx.current = step;
        // A step starts where the last one left off, until it frames a shot of its own.
        if (last) { shot = { clip: last.clip, t0: caps[last.clip].now(), crop: last.crop }; step.shots.push(shot); }
        await fn2();
        // Hold until what is on camera (the shots, not the waiting between them) covers the sentence.
        if (need && shot) {
          const shown = step.shots.reduce((a, x) => a + ((x.t1 ?? caps[x.clip].now()) - x.t0), 0);
          if (shown < need + 0.3) await sleep((need + 0.3 - shown) * 1000);
        }
        close();
      },
      /** Start a new shot on this page with a crop around `targets` ('full' for the whole screen). */
      async shot(clip, targets, opts) {
        close();
        const crop = await cropFor(pages[clip], targets, opts);
        shot = { clip, t0: caps[clip].now(), crop };
        last = shot;
        ctx.current.shots.push(shot);
      },
    };
    await fn(ctx);
    close();
    const out = {};
    for (const [k, c] of Object.entries(caps)) {
      const file = join(clips, `${tag}-${k}.mp4`);
      const r = await c.stop(file);
      out[k] = { file, ...r, t0: c.t0, size: pages[k].viewport(), cursor: events.filter((e) => e.clip === k).map((e) => ({ ...e, t: e.t - c.t0 })) };
    }
    writeFileSync(join(clips, `${tag}.json`), JSON.stringify({ id, name, clips: out, steps }, null, 2));
    const want = speech?.[tag]?.length;
    console.log(`  ${steps.length}${want ? `/${want}` : ''} steps · ${Object.values(out).map((c) => `${c.frames} frames ${c.seconds.toFixed(1)} s`).join(' · ')}`);
    if (want && want !== steps.length) throw new Error(`${tag}: ${steps.length} steps recorded, the script has ${want}`);
  };
}
