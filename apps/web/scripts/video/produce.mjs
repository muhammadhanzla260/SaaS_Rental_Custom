/**
 * Produces the finished walkthrough: the recorded screens (record.mjs) inside a floating app window on an
 * animated gradient, a smooth zoom camera, animated captions and chapter dots, animated intro and outro,
 * and an AI female voice (tts.mjs) with every step timed to its own sentence. Three looks, three voices.
 *   node apps/web/scripts/video/produce.mjs aurora            one variant (aurora | sunrise | lagoon)
 *   node apps/web/scripts/video/produce.mjs all                all three
 *   node apps/web/scripts/video/produce.mjs aurora 2 3         only some chapters (a quick look)
 * Output: .data/video/out/<variant>/chNN.mp4 and <variant>.mp4
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { VIDEO } from './script.mjs';

const ROOT = resolve(VIDEO, '../..');
const sharpDir = readdirSync(join(ROOT, 'node_modules/.pnpm')).find((d) => d.startsWith('sharp@'));
const sharp = createRequire(import.meta.url)(join(ROOT, 'node_modules/.pnpm', sharpDir, 'node_modules/sharp'));

sharp.concurrency(2);
const W = 1920;
const H = 1080;
const FPS = Number(process.env.FPS ?? 60);
const LEAD = 0.55; // the window scales in before the voice starts
const GAP = 0.3; // breath between steps
const TAIL = 1.8; // the last card lingers
const FONT = "'Segoe UI', Arial, sans-serif";
const NAMES = ['', 'Add a customer', 'Build an order', 'Option one · Send a quote', 'Option two · Book without payment', 'Option three · Record the payment', 'The emails your customer receives', 'How the customer pays online', 'Products, categories & inventory', 'Settings · Your email server', 'Settings · Email templates', 'Settings · Team & roles'];

const THEMES = {
  aurora: { voice: 'ava', bg: ['#eef1ff', '#f6efff'], blobs: ['#a855f7', '#ff6ec7', '#5b8cff'], accent: '#5b4be0', ink: '#1b1d3a', soft: '#5d6180' },
  sunrise: { voice: 'jenny', bg: ['#fff5ec', '#fff0f4'], blobs: ['#ff8a3d', '#ff5d8f', '#ffc371'], accent: '#d9480f', ink: '#2a1a14', soft: '#7a5a4d' },
  lagoon: { voice: 'sonia', bg: ['#eafaf6', '#eef5ff'], blobs: ['#2dd4bf', '#38bdf8', '#818cf8'], accent: '#0d9488', ink: '#10282b', soft: '#4a6a6e' },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (x) => x * x * x * (x * (6 * x - 15) + 10);
const back = (x) => { const c = 1.4; const t = x - 1; return 1 + (c + 1) * t * t * t + c * t * t; }; // overshoots a little, then settles
const slash = (p) => p.split('\\').join('/');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function ff(args) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-800)}`);
}
const seconds = (file) => {
  const m = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

// --- the animated background -------------------------------------------------------------------------
function bgSvg(T, th) {
  const b = th.blobs;
  const s = (a, f) => Math.sin(T * f + a);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${th.bg[0]}"/><stop offset="1" stop-color="${th.bg[1]}"/></linearGradient>
    ${b.map((c, i) => `<radialGradient id="b${i}"><stop offset="0" stop-color="${c}" stop-opacity="${i === 2 ? 0.5 : 0.8}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join('')}
  </defs>
  <rect width="1920" height="1080" fill="url(#g)"/>
  <circle cx="${1780 + 140 * s(0, 0.31)}" cy="${90 + 110 * s(1, 0.27)}" r="560" fill="url(#b0)"/>
  <circle cx="${140 + 130 * s(2, 0.23)}" cy="${980 + 90 * s(3, 0.33)}" r="600" fill="url(#b1)"/>
  <circle cx="${1050 + 320 * s(4, 0.17)}" cy="${1210 + 60 * s(5, 0.29)}" r="520" fill="url(#b2)"/>
  <circle cx="${300 + 120 * s(6, 0.2)}" cy="${-60 + 70 * s(7, 0.25)}" r="380" fill="url(#b2)"/>
</svg>`);
}

// --- the little glyph chips that float around the intro and outro --------------------------------------
const GLYPHS = {
  calendar: '<rect x="-20" y="-18" width="40" height="38" rx="7" fill="none" stroke="C" stroke-width="5"/><path d="M-20 -6H20M-9 -26V-14M9 -26V-14" stroke="C" stroke-width="5" stroke-linecap="round"/>',
  card: '<rect x="-24" y="-16" width="48" height="34" rx="7" fill="none" stroke="C" stroke-width="5"/><path d="M-24 -4H24" stroke="C" stroke-width="6"/>',
  mail: '<rect x="-24" y="-17" width="48" height="34" rx="7" fill="none" stroke="C" stroke-width="5"/><path d="M-22 -12L0 4L22 -12" fill="none" stroke="C" stroke-width="5" stroke-linejoin="round"/>',
  box: '<path d="M0 -24L22 -12V12L0 24L-22 12V-12Z M-22 -12L0 0L22 -12M0 0V24" fill="none" stroke="C" stroke-width="5" stroke-linejoin="round"/>',
  users: '<path d="M-20 20V4M0 20V-14M20 20V-4" stroke="C" stroke-width="9" stroke-linecap="round"/>',
  check: '<circle r="22" fill="none" stroke="C" stroke-width="5"/><path d="M-10 1L-3 9L11 -8" fill="none" stroke="C" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const chip = (kind, x, y, th, scale = 1, op = 1) => `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(3)})" opacity="${op.toFixed(3)}">
  <circle cx="0" cy="12" r="60" fill="#3b2a8f" opacity=".16" filter="url(#blur)"/>
  <circle r="58" fill="#ffffff"/><g>${GLYPHS[kind].replace(/C/g, th.accent)}</g></g>`;
const blurDef = '<defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter></defs>';

function introSvg(T, th) {
  const chips = ['calendar', 'card', 'mail', 'box', 'users', 'check'].map((k, i) => {
    const bx = [330, 1560, 220, 1700, 520, 1380][i];
    const by = [220, 210, 760, 740, 940, 930][i];
    const p = smooth(clamp((T - 0.1 * i) / 0.8, 0, 1));
    return chip(k, bx + 22 * Math.sin(T * 0.9 + i * 1.3), by + 26 * Math.cos(T * 0.7 + i), th, 0.4 + 0.6 * back(p), p);
  }).join('');
  const line = (text, y, size, fill, t0, weight = 800) => {
    const p = smooth(clamp((T - t0) / 0.7, 0, 1));
    return `<text x="960" y="${(y + (1 - p) * 40).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-weight="${weight}" font-size="${size}" fill="${fill}" opacity="${p.toFixed(3)}">${esc(text)}</text>`;
  };
  const logo = smooth(clamp(T / 0.6, 0, 1));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${blurDef}${chips}
  <g opacity="${logo.toFixed(3)}" transform="translate(0 ${((1 - logo) * -20).toFixed(1)})">
    <rect x="96" y="70" width="64" height="64" rx="18" fill="${th.accent}"/><text x="128" y="112" text-anchor="middle" font-family="${FONT}" font-weight="800" font-size="28" fill="#fff">FF</text>
    <text x="178" y="112" font-family="${FONT}" font-weight="700" font-size="32" fill="${th.ink}">Freedom Fun USA</text></g>
  ${line('Run your rental business', 520, 110, th.ink, 0.5)}
  ${line('step by step', 650, 110, th.accent, 0.85)}
  ${line('A walkthrough for Tim · from the first phone call to a paid booking', 760, 36, th.soft, 1.4, 500)}
</svg>`);
}

function outroSvg(T, th) {
  const items = ['Quotes', 'Deposits', 'Invoices', 'Receipts', 'Reminders'];
  const chips = items.map((t, i) => {
    const p = smooth(clamp((T - 0.9 - 0.18 * i) / 0.5, 0, 1));
    const x = 960 + (i - 2) * 300;
    return `<g transform="translate(${x} ${(610 + (1 - p) * 30).toFixed(1)}) scale(${(0.7 + 0.3 * back(p)).toFixed(3)})" opacity="${p.toFixed(3)}">
      <rect x="-130" y="-38" width="260" height="76" rx="38" fill="#fff"/><rect x="-130" y="-38" width="260" height="76" rx="38" fill="none" stroke="${th.accent}" stroke-opacity=".25" stroke-width="2"/>
      <circle cx="-86" cy="0" r="17" fill="${th.accent}"/><path d="M-94 1L-88 8L-77 -6" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="-52" y="10" font-family="${FONT}" font-weight="700" font-size="29" fill="${th.ink}">${t}</text></g>`;
  }).join('');
  const line = (text, y, size, fill, t0, weight = 800) => {
    const p = smooth(clamp((T - t0) / 0.7, 0, 1));
    return `<text x="960" y="${(y + (1 - p) * 40).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-weight="${weight}" font-size="${size}" fill="${fill}" opacity="${p.toFixed(3)}">${esc(text)}</text>`;
  };
  const bp = smooth(clamp((T - 2.2) / 0.6, 0, 1));
  const press = T > 3.4 && T < 3.7 ? 0.95 : 1;
  const bg = ['calendar', 'card', 'mail', 'box'].map((k, i) => {
    const p = smooth(clamp((T - 0.1 * i) / 0.8, 0, 1));
    return chip(k, [260, 1660, 180, 1740][i] + 18 * Math.sin(T + i * 1.7), [250, 280, 880, 860][i] + 22 * Math.cos(T * 0.8 + i), th, 0.35 + 0.5 * back(p), p * 0.9);
  }).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${blurDef}${bg}
  ${line('Thanks, Tim!', 430, 120, th.ink, 0.3)}
  ${line('Everything you relied on in Odoo is preserved and fully functional.', 520, 40, th.soft, 0.6, 500)}
  ${chips}
  <g transform="translate(960 ${(800 + (1 - bp) * 30).toFixed(1)}) scale(${(press * (0.85 + 0.15 * back(bp))).toFixed(3)})" opacity="${bp.toFixed(3)}">
    <rect x="-390" y="-46" width="780" height="92" rx="46" fill="${th.accent}"/>
    <text x="0" y="14" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="34" fill="#fff">No duplicates · No data issues · All preserved</text></g>
</svg>`);
}

// --- chapter furniture: dots, title bar, caption, window frame -------------------------------------------
const pillsSvg = (cur, th) => {
  const n = 13, w = 30, g = 10, curW = 74;
  const total = (n - 1) * (w + g) + curW - w + w;
  let x = (W - (n - 1) * (w + g) - curW) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const cw = i === cur ? curW : w;
    out.push(`<rect x="${x}" y="8" width="${cw}" height="10" rx="5" fill="${i === cur ? th.accent : th.ink}" opacity="${i === cur ? 1 : i < cur ? 0.35 : 0.14}"/>`);
    x += cw + g;
  }
  void total;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="26">${out.join('')}</svg>`);
};

const WIN = { x: 100, y: 34, w: 1720, bar: 36, ch: 968 }; // content 1720x968 (16:9) under a 36 px title bar
const titleBarSvg = (text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIN.w}" height="${WIN.bar}">
  <path d="M0 ${WIN.bar}V16Q0 0 16 0H${WIN.w - 16}Q${WIN.w} 0 ${WIN.w} 16V${WIN.bar}Z" fill="#f4f5fa"/>
  <circle cx="26" cy="18" r="6.5" fill="#ff5f57"/><circle cx="48" cy="18" r="6.5" fill="#febc2e"/><circle cx="70" cy="18" r="6.5" fill="#28c840"/>
  <text x="${WIN.w / 2}" y="23" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="15" fill="#6b7080">${esc(text)}</text>
  <path d="M0 ${WIN.bar - 0.5}H${WIN.w}" stroke="#e3e5ee"/></svg>`);
const roundMask = (w, h, top, bottom) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="M0 ${top}Q0 0 ${top} 0H${w - top}Q${w} 0 ${w} ${top}V${h - bottom}Q${w} ${h} ${w - bottom} ${h}H${bottom}Q0 ${h} 0 ${h - bottom}Z" fill="#fff"/></svg>`);

/** A soft drop shadow for a box at (x, y), already cut to fit inside the frame. */
async function shadowPng(w, h, r, dy, strength, x, y) {
  const pad = 80;
  const full = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}"><rect x="${pad}" y="${pad + dy}" width="${w}" height="${h}" rx="${r}" fill="#1e1a4a" opacity="${strength}"/></svg>`)).blur(30).png().toBuffer();
  let left = x - pad, top = y - pad, cw = w + pad * 2, ch = h + pad * 2, cl = 0, ct = 0;
  if (left < 0) { cl = -left; cw += left; left = 0; }
  if (top < 0) { ct = -top; ch += top; top = 0; }
  if (left + cw > W) cw = W - left;
  if (top + ch > H) ch = H - top;
  return { buf: await sharp(full).extract({ left: cl, top: ct, width: cw, height: ch }).png().toBuffer(), left, top };
}

async function captionPng(text, th) {
  const t = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="90"><text x="10" y="62" font-family="${FONT}" font-weight="700" font-size="40" fill="${th.ink}">${esc(text)}</text></svg>`)).png().trim().toBuffer({ resolveWithObject: true });
  const w = t.info.width + 120, h = 78;
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="39" fill="#ffffff" opacity=".94"/><circle cx="40" cy="39" r="10" fill="${th.accent}"/></svg>`);
  const buf = await sharp(pill).composite([{ input: t.data, left: 72, top: Math.round((h - t.info.height) / 2) }]).png().toBuffer();
  return { buf, w, h };
}

// --- camera, cursor ---------------------------------------------------------------------------------------
function framing(crop, vp) {
  const [x, y, w, h] = crop;
  if (w >= vp.width - 2) return { cx: vp.width / 2, cy: vp.height / 2, w: vp.width };
  const nw = clamp(Math.max(w * 1.2 + 120, 1160), 0, vp.width);
  const nh = nw * (vp.height / vp.width);
  return { cx: clamp(x + w / 2, nw / 2, vp.width - nw / 2), cy: clamp(y + h / 2, nh / 2, vp.height - nh / 2), w: nw };
}
function cursorAt(events, t, vp) {
  const moves = events.filter((e) => e.type === 'move');
  let k = -1;
  moves.forEach((m, i) => { if (m.t <= t) k = i; });
  let pos = { x: vp.width * 0.5, y: vp.height * 0.5 };
  if (k >= 0) {
    const from = k > 0 ? moves[k - 1] : pos;
    const q = smooth(clamp((t - moves[k].t) / 0.6, 0, 1));
    pos = { x: lerp(from.x, moves[k].x, q), y: lerp(from.y, moves[k].y, q) };
  } else if (moves[0]) pos = { x: moves[0].x, y: moves[0].y };
  const click = events.filter((e) => e.type === 'click' && e.t <= t && t - e.t < 0.7).at(-1);
  return { pos, ring: click ? (t - click.t) / 0.7 : null, visible: k >= 0 };
}
const CURSOR = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.4 6.9z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>');
const ringSvg = (p, th) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130"><circle cx="65" cy="65" r="${12 + 44 * smooth(p)}" fill="${th.accent}" fill-opacity="${(0.18 * (1 - p)).toFixed(3)}" stroke="${th.accent}" stroke-width="6" opacity="${(1 - p).toFixed(3)}"/></svg>`);

const frameAt = (c, t) => {
  let lo = 0, hi = c.list.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.list[mid].t <= t) lo = mid; else hi = mid - 1; }
  return lo;
};

// --- one chapter ---------------------------------------------------------------------------------------------
async function renderChapter({ variant, th, tag, ci, clips, bgOffset, outDir, tmp }) {
  const meta = ci !== 0 && ci !== 12 && existsSync(join(VIDEO, 'clips', `${tag}.json`)) ? JSON.parse(readFileSync(join(VIDEO, 'clips', `${tag}.json`), 'utf8')) : null;
  const lead = ci === 12 ? 0.5 : LEAD;
  const nSteps = clips.length;
  const slots = clips.map((c, i) => c.seconds + GAP + (i === 0 ? lead : 0) + (i === nSteps - 1 && (ci === 12 || ci === 0) ? TAIL : 0));
  const total = slots.reduce((a, b) => a + b, 0);

  // timeline of segments (recorded stretches), per step slot
  const segs = [];
  const captions = [];
  if (meta) {
    let outT = 0;
    meta.steps.forEach((step, si) => {
      const recorded = step.shots.reduce((a, x) => a + (x.t1 - x.t0), 0) || 1;
      const start = outT;
      step.shots.forEach((shot) => {
        const len = Math.max(0.05, shot.t1 - shot.t0);
        const out = Math.max(0.5, (len / recorded) * slots[si]);
        segs.push({ out0: outT, out1: outT + out, clip: shot.clip, t0: shot.t0, len, speed: Math.max(1, len / out), crop: shot.crop, vp: meta.clips[shot.clip].size });
        outT += out;
      });
      captions.push({ text: step.caption, a: start + (si === 0 ? lead : 0.1), b: outT - 0.12 });
    });
  }
  const scale = total / (segs.at(-1)?.out1 ?? total);
  segs.forEach((s) => { s.out0 *= scale; s.out1 *= scale; s.speed = Math.max(1, s.len / (s.out1 - s.out0)); });
  captions.forEach((c) => { c.a *= scale; c.b *= scale; });

  const cl = {};
  if (meta) for (const [k, c] of Object.entries(meta.clips)) {
    const m = await sharp(c.list[0].file).metadata();
    cl[k] = { ...c, w: m.width, h: m.height, k: m.width / c.size.width, phone: c.size.width < 600 };
  }

  // static furniture
  const capPngs = [];
  for (const c of captions) capPngs.push(await captionPng(c.text, th));
  const bar = await sharp(titleBarSvg(`Tentpole · Freedom Fun USA  —  ${NAMES[ci] ?? ''}`)).png().toBuffer();
  const maskWin = await sharp(roundMask(WIN.w, WIN.ch, 0, 16)).ensureAlpha().raw().toBuffer();
  const shWin = await shadowPng(WIN.w, WIN.bar + WIN.ch, 16, 26, 0.3, WIN.x, WIN.y);
  const PH = { h: 960, w: 444, bez: 14 };
  PH.x = Math.round((W - PH.w) / 2); PH.y = 60;
  const maskPh = await sharp(roundMask(PH.w, PH.h, 30, 30)).ensureAlpha().raw().toBuffer();
  const bezel = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PH.w + PH.bez * 2}" height="${PH.h + PH.bez * 2}"><rect width="${PH.w + PH.bez * 2}" height="${PH.h + PH.bez * 2}" rx="44" fill="#14151c"/><rect x="${PH.w / 2 + PH.bez - 54}" y="${PH.bez + 8}" width="108" height="8" rx="4" fill="#0a0a0f" opacity=".6"/></svg>`)).png().toBuffer();
  const shPh = await shadowPng(PH.w + PH.bez * 2, PH.h + PH.bez * 2, 44, 26, 0.34, PH.x - PH.bez, PH.y - PH.bez);
  const dots = await sharp(pillsSvg(ci, th)).png().toBuffer();

  const silent = join(tmp, `${tag}-silent.mp4`);
  const ffp = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = once(ffp, 'close');

  const raw = { frame: null, key: '' };
  let bg = { n: -1, buf: null };
  let content = { key: '', buf: null };
  let furn = { key: '', buf: null }; // gradient + shadow + title bar + dots, rebuilt only when the gradient moves
  const frames = Math.ceil(total * FPS);
  let prevKind = null, kindSince = 0;
  for (let i = 0; i < frames; i++) {
    const T = i / FPS;
    const bgN = Math.floor(i / 3);
    if (bg.n !== bgN) bg = { n: bgN, buf: await sharp(bgSvg(bgOffset + bgN * 3 / FPS, th)).resize(W, H).removeAlpha().raw().toBuffer() };
    const base = sharp(bg.buf, { raw: { width: W, height: H, channels: 3 } });

    let out;
    if (!meta) { // intro or outro card
      out = await base.composite([{ input: ci === 0 ? introSvg(T, th) : outroSvg(T, th), left: 0, top: 0 }]).removeAlpha().raw().toBuffer();
    } else {
      let si = segs.findIndex((x) => T >= x.out0 && T < x.out1);
      if (si < 0) si = segs.length - 1;
      const seg = segs[si];
      const c = cl[seg.clip];
      const srcT = seg.t0 + Math.min(seg.len, (T - seg.out0) * seg.speed);
      const fi = frameAt(c, srcT);
      if (raw.key !== `${seg.clip}:${fi}`) { raw.frame = await sharp(c.list[fi].file).removeAlpha().raw().toBuffer(); raw.key = `${seg.clip}:${fi}`; }
      const kind = c.phone ? 'phone' : 'win';
      if (kind !== prevKind) { prevKind = kind; kindSince = T; }
      const cur = cursorAt(c.cursor, srcT, seg.vp);
      const over = [];
      let cw, chh, toC;
      let cam = null;
      if (kind === 'win') {
        cw = WIN.w; chh = WIN.ch;
        const to = framing(seg.crop, seg.vp);
        const si0 = segs.findIndex((x) => x === seg);
        const prev = si0 > 0 && segs[si0 - 1].clip === seg.clip ? framing(segs[si0 - 1].crop, seg.vp) : to;
        const p = smooth(clamp((T - seg.out0) / Math.min(1.3, (seg.out1 - seg.out0) * 0.8), 0, 1));
        cam = { cx: lerp(prev.cx, to.cx, p), cy: lerp(prev.cy, to.cy, p), w: Math.exp(lerp(Math.log(prev.w), Math.log(to.w), p)) };
        cam.h = cam.w * (seg.vp.height / seg.vp.width);
        toC = (px, py) => [((px - cam.cx + cam.w / 2) / cam.w) * cw, ((py - cam.cy + cam.h / 2) / cam.h) * chh];
        const x = Math.round((cam.cx - cam.w / 2) * c.k), y = Math.round((cam.cy - cam.h / 2) * c.k);
        const w = Math.min(c.w - x, Math.round(cam.w * c.k)), h = Math.min(c.h - y, Math.round(cam.h * c.k));
        const key = `win:${seg.clip}:${fi}:${x}:${y}:${w}:${h}`;
        if (content.key !== key) {
          const img = sharp(raw.frame, { raw: { width: c.w, height: c.h, channels: 3 } });
          content = { key, buf: await (w === c.w && h === c.h ? img : img.extract({ left: x, top: y, width: w, height: h })).resize(cw, chh, { kernel: 'lanczos3' }).raw().toBuffer() };
        }
      } else {
        cw = PH.w; chh = PH.h;
        const sc = PH.h / seg.vp.height;
        toC = (px, py) => [px * sc, py * sc];
        const key = `phone:${fi}`;
        if (content.key !== key) content = { key, buf: await sharp(raw.frame, { raw: { width: c.w, height: c.h, channels: 3 } }).resize(cw, chh, { kernel: 'lanczos3' }).raw().toBuffer() };
      }
      if (cur.visible) {
        const [ox, oy] = toC(cur.pos.x, cur.pos.y);
        if (ox > 2 && oy > 2 && ox < cw - 30 && oy < chh - 30) {
          if (cur.ring != null) over.push({ input: ringSvg(cur.ring, th), left: Math.round(clamp(ox - 65, 0, cw - 130)), top: Math.round(clamp(oy - 65, 0, chh - 130)) });
          over.push({ input: CURSOR, left: Math.round(ox - 7), top: Math.round(oy - 4) });
        }
      }
      over.push({ input: kind === 'win' ? maskWin : maskPh, raw: { width: cw, height: chh, channels: 4 }, blend: 'dest-in' });
      const contentRgba = await sharp(content.buf, { raw: { width: cw, height: chh, channels: 3 } }).ensureAlpha().composite(over).raw().toBuffer();

      // furniture for this scene
      const below = kind === 'win'
        ? [{ input: shWin.buf, left: shWin.left, top: shWin.top }, { input: bar, left: WIN.x, top: WIN.y }]
        : [{ input: shPh.buf, left: shPh.left, top: shPh.top }, { input: bezel, left: PH.x - PH.bez, top: PH.y - PH.bez }];
      const cx0 = kind === 'win' ? WIN.x : PH.x, cy0 = kind === 'win' ? WIN.y + WIN.bar : PH.y;
      const layer = [...below, { input: contentRgba, raw: { width: cw, height: chh, channels: 4 }, left: cx0, top: cy0 }];

      // caption, animated in and out
      const cap = captions.findIndex((x) => T >= x.a && T <= x.b);
      const extras = [{ input: dots, left: 0, top: H - 38 }];
      const fkey = `${bgN}:${kind}`;
      if (furn.key !== fkey) furn = { key: fkey, buf: await base.clone().composite([...below, ...extras]).removeAlpha().raw().toBuffer() };
      let capLayer = null;
      if (cap >= 0) {
        const k = Math.min(smooth(clamp((T - captions[cap].a) / 0.4, 0, 1)), smooth(clamp((captions[cap].b - T) / 0.3, 0, 1)));
        const pc = capPngs[cap];
        const buf = k < 0.999 ? await sharp(pc.buf).ensureAlpha().linear([1, 1, 1, k], [0, 0, 0, 0]).png().toBuffer() : pc.buf;
        capLayer = { input: buf, left: Math.round((W - pc.w) / 2), top: Math.round(H - 150 + (1 - k) * 26) };
      }

      // entrance: the scene scales in over the gradient when the chapter (or the device) changes
      const age = T - kindSince;
      if (age < 0.7) {
        const e = clamp(age / 0.7, 0, 1);
        const sc = 0.9 + 0.1 * smooth(e);
        const full = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layer).raw().toBuffer();
        const sw = Math.round(W * sc), shh = Math.round(H * sc);
        const scaled = await sharp(full, { raw: { width: W, height: H, channels: 4 } }).resize(sw, shh).linear([1, 1, 1, smooth(e)], [0, 0, 0, 0]).png().toBuffer();
        out = await base.composite([{ input: scaled, left: Math.round((W - sw) / 2), top: Math.round((H - shh) / 2 + (1 - e) * 24) }, ...extras]).removeAlpha().raw().toBuffer();
      } else {
        out = await sharp(furn.buf, { raw: { width: W, height: H, channels: 3 } })
          .composite([{ input: contentRgba, raw: { width: cw, height: chh, channels: 4 }, left: cx0, top: cy0 }, ...(capLayer ? [capLayer] : [])]).removeAlpha().raw().toBuffer();
      }
    }
    if (out.length !== W * H * 3) throw new Error(`frame ${i}: ${out.length} bytes`);
    if (!ffp.stdin.write(out)) await once(ffp.stdin, 'drain');
    if (i % 300 === 0) process.stdout.write(`\r  ${variant} ${tag} ${Math.round((i / frames) * 100)}%  `);
  }
  ffp.stdin.end();
  await exited;
  process.stdout.write(`\r  ${variant} ${tag} done      \n`);

  // the voice: every step's clip starts at its own slot
  const audio = join(tmp, `${tag}.m4a`);
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  let at = lead;
  const parts = clips.map((c, i) => {
    const part = `[${i}:a]adelay=${Math.round(at * 1000)}|${Math.round(at * 1000)}[a${i}]`;
    at += slots[i] - (i === 0 ? lead : 0);
    return part;
  });
  ff([...inputs, '-filter_complex', `${parts.join(';')};${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:duration=longest,volume=1.15,apad=whole_dur=${total.toFixed(3)}[out]`, '-map', '[out]', '-t', total.toFixed(3), '-c:a', 'aac', '-b:a', '192k', audio]);
  const out = join(outDir, `${tag}.mp4`);
  ff(['-i', silent, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', out]);
  return { out, total };
}

// --- run ---------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const pick = args.filter((a) => THEMES[a] || a === 'all');
const only = args.filter((a) => /^\d+$/.test(a)).map(Number);
const childAt = args.indexOf('--chapter');
const JOBS = Number(process.env.JOBS ?? 6);
const variants = pick.includes('all') || !pick.length ? Object.keys(THEMES) : pick;
const tagOf = (ci) => `ch${String(ci).padStart(2, '0')}`;

function plan(variant) {
  const th = THEMES[variant];
  const manifest = JSON.parse(readFileSync(join(VIDEO, 'tts', th.voice, 'manifest.json'), 'utf8'));
  // where each chapter starts in the finished video, so the gradient keeps drifting across the cuts
  let offset = 0;
  const starts = {};
  for (let ci = 0; ci <= 12; ci++) {
    starts[tagOf(ci)] = offset;
    const cs = manifest[tagOf(ci)];
    offset += cs.reduce((a, c, i) => a + c.seconds + GAP + (i === 0 ? (ci === 12 ? 0.5 : LEAD) : 0) + (i === cs.length - 1 && (ci === 12 || ci === 0) ? TAIL : 0), 0);
  }
  return { th, manifest, starts, outDir: join(VIDEO, 'out', variant) };
}

if (childAt >= 0) { // one chapter of one variant, in its own process
  const ci = Number(args[childAt + 1]);
  const variant = variants[0];
  const { th, manifest, starts, outDir } = plan(variant);
  const tmp = join(outDir, `tmp-${tagOf(ci)}`);
  mkdirSync(tmp, { recursive: true });
  await renderChapter({ variant, th, tag: tagOf(ci), ci, clips: manifest[tagOf(ci)], bgOffset: starts[tagOf(ci)], outDir, tmp });
  rmSync(tmp, { recursive: true, force: true });
} else {
  // every chapter of every variant, JOBS at a time
  const jobs = [];
  for (const variant of variants) {
    rmSync(join(VIDEO, 'out', variant), { recursive: true, force: true });
    mkdirSync(join(VIDEO, 'out', variant), { recursive: true });
    for (let ci = 0; ci <= 12; ci++) if (!only.length || only.includes(ci)) jobs.push({ variant, ci });
  }
  let next = 0, done = 0, failed = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(JOBS, jobs.length) }, async () => {
    while (next < jobs.length) {
      const { variant, ci } = jobs[next++];
      const child = spawn(process.execPath, [import.meta.filename, variant, '--chapter', String(ci)], { stdio: ['ignore', 'ignore', 'inherit'] });
      const [code] = await once(child, 'close');
      if (code !== 0) failed++;
      done++;
      console.log(`${variant} ${tagOf(ci)} ${code === 0 ? 'done' : 'FAILED'} (${done}/${jobs.length}, ${Math.round((Date.now() - started) / 60000)} min)`);
    }
  }));
  if (failed) { console.log(`${failed} chapter(s) failed`); process.exit(1); }
  for (const variant of variants) {
    const { th, outDir } = plan(variant);
    const parts = Array.from({ length: 13 }, (_, ci) => ci).filter((ci) => !only.length || only.includes(ci)).map((ci) => join(outDir, `${tagOf(ci)}.mp4`));
    const list = join(outDir, 'all.txt');
    writeFileSync(list, parts.map((m) => `file '${slash(m)}'`).join('\n'));
    const final = join(VIDEO, 'out', only.length ? `${variant}-preview.mp4` : `${variant}.mp4`);
    ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', final]);
    rmSync(list);
    console.log(`${variant}: ${final} (${seconds(final).toFixed(1)} s, voice ${th.voice})`);
  }
}
