/**
 * Builds the walkthrough video from the recorded clips (record.mjs) and your
 * narration (.data/video/voice/chNN-*.m4a). Each step of a chapter is fitted to
 * its sentence: with a recording, the sentences are found from your pauses; without
 * one, each sentence gets an estimated time from its word count (a preview).
 * Every shot is cropped and zoomed to 1920x1080, with the step's caption burned in.
 *   node apps/web/scripts/video/assemble.mjs            preview or final, every chapter
 *   node apps/web/scripts/video/assemble.mjs 1 2        some chapters only
 * Output: .data/video/out/chNN.mp4 and walkthrough.mp4
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const ROOT = resolve(import.meta.dirname, '../../../..');
// sharp lives in pnpm's store (it is not linked into this app).
const sharpDir = readdirSync(join(ROOT, 'node_modules/.pnpm')).find((d) => d.startsWith('sharp@'));
const sharp = createRequire(import.meta.url)(join(ROOT, 'node_modules/.pnpm', sharpDir, 'node_modules/sharp'));
const VIDEO = join(ROOT, '.data/video');
const CLIPS = join(VIDEO, 'clips');
const VOICE = join(VIDEO, 'voice');
const OUT = join(VIDEO, 'out');
const TMP = join(OUT, 'tmp');
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf';
const W = 1920;
const H = 1080;
const WORDS_PER_SECOND = 2.5;
const FPS = 60;
mkdirSync(TMP, { recursive: true });
const slash = (p) => p.split('\\').join('/');

function ff(args) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.slice(-800)}`);
  return r;
}
const probeSeconds = (file) => {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
};

/** The script's sentences per chapter, split at [pause]. */
function scriptSentences() {
  const md = readFileSync(join(VIDEO, 'narration-script.md'), 'utf8');
  const out = {};
  for (const part of md.split(/\n## /).slice(1)) {
    const file = part.match(/`(ch\d\d-[a-z-]+)\.m4a`/)?.[1];
    if (!file) continue;
    const text = part.split('\n').filter((l) => l && !l.startsWith('`') && !l.startsWith('---') && !/^Chapter/.test(l) && !l.startsWith('Chapter')).slice(0).join(' ');
    const body = text.replace(/^[^·]*·[^\n]*?(?=[A-Z])/, '');
    out[file.slice(0, 4)] = { file, sentences: body.split('[pause]').map((s) => s.replace(/\*\*/g, '').trim()).filter(Boolean) };
  }
  return out;
}

/** Where your recording pauses: the N-1 longest silences split it into N sentences. */
function voiceSegments(file, n) {
  const total = probeSeconds(file);
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.45', '-f', 'null', '-'], { encoding: 'utf8' });
  const sil = [];
  let start = null;
  for (const line of r.stderr.split('\n')) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start != null) { sil.push({ a: start, b: Number(e[1]) }); start = null; }
  }
  const inner = sil.filter((x) => x.a > 0.3 && x.b < total - 0.3).sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, n - 1).sort((x, y) => x.a - y.a);
  const cuts = [0, ...inner.map((x) => (x.a + x.b) / 2), total];
  return cuts.slice(1).map((c, i) => c - cuts[i]);
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * x * (x * (6 * x - 15) + 10); // smootherstep: gentle start and stop
const lerp = (a, b, k) => a + (b - a) * k;

/** A zoom target: the area of interest with room around it (nothing cut), never tighter than ~1.4x. */
function framing(crop, vp) {
  const [x, y, w, h] = crop;
  if (w >= vp.width - 2) return { cx: vp.width / 2, cy: vp.height / 2, w: vp.width };
  const nw = clamp(Math.max(w * 1.2 + 120, 1160), 0, vp.width);
  const nh = nw * (vp.height / vp.width);
  const cx = clamp(x + w / 2, nw / 2, vp.width - nw / 2);
  const cy = clamp(y + h / 2, nh / 2, vp.height - nh / 2);
  return { cx, cy, w: nw };
}

/** Cursor position at source time t (it glides 0.6 s to each new spot) and the click ring, if one is fresh. */
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

const CURSOR = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.4 6.9z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>');
const ringSvg = (p) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><circle cx="60" cy="60" r="${12 + 40 * smooth(p)}" fill="none" stroke="#f97316" stroke-width="6" opacity="${(1 - p).toFixed(3)}"/></svg>`);

async function chapterVideo(tag, meta, sentences, voiceFile) {
  const steps = meta.steps;
  const durations = voiceFile
    ? voiceSegments(voiceFile, steps.length)
    : steps.map((_, i) => Math.max(2.2, (sentences[i] ?? '').split(/\s+/).length / WORDS_PER_SECOND + 0.6));

  // One timeline of segments: which clip, which stretch of it, at what speed, framed how.
  const segs = [];
  let outT = 0;
  const captions = [];
  steps.forEach((step, si) => {
    const recorded = step.shots.reduce((a, x) => a + (x.t1 - x.t0), 0) || 1;
    const target = durations[si] ?? 3;
    const stepStart = outT;
    step.shots.forEach((shot) => {
      const len = Math.max(0.05, shot.t1 - shot.t0);
      const out = Math.max(0.6, (len / recorded) * target);
      segs.push({ out0: outT, out1: outT + out, clip: shot.clip, t0: shot.t0, len, speed: Math.max(1, len / out), crop: shot.crop, vp: meta.clips[shot.clip].size });
      outT += out;
    });
    const file = join(TMP, `${tag}-cap${si}.txt`);
    writeFileSync(file, step.caption);
    captions.push({ file, a: stepStart, b: outT });
  });
  const total = outT;

  // Source frames and their sizes, per clip.
  const clips = {};
  for (const [k, c] of Object.entries(meta.clips)) {
    const m = await sharp(c.list[0].file).metadata();
    clips[k] = { ...c, w: m.width, h: m.height, k: m.width / c.size.width, phone: c.size.width < 600 };
  }
  const frameAt = (c, t) => { // latest captured frame at or before t
    let lo = 0, hi = c.list.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.list[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  };

  const silent = join(TMP, `${tag}-silent.mp4`);
  const draw = captions.map((c) => `drawtext=fontfile='${FONT}':textfile='${slash(c.file).replace(':', '\\:')}':fontsize=46:fontcolor=white:box=1:boxcolor=0x0b0d12@0.8:boxborderw=24:x=(w-text_w)/2:y=h-text_h-56:enable='between(t,${c.a.toFixed(3)},${(c.b - 0.05).toFixed(3)})'`).join(',');
  const ffp = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-vf', `${draw},format=yuv420p`, '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const exited = once(ffp, 'close');

  const raw = { frame: null, key: '' };
  let base = { key: '', buf: null };
  const frames = Math.ceil(total * FPS);
  for (let i = 0; i < frames; i++) {
    const T = i / FPS;
    let si = segs.findIndex((x) => T >= x.out0 && T < x.out1);
    if (si < 0) si = segs.length - 1;
    const seg = segs[si];
    const c = clips[seg.clip];
    const srcT = seg.t0 + Math.min(seg.len, (T - seg.out0) * seg.speed);
    const fi = frameAt(c, srcT);
    if (raw.key !== `${seg.clip}:${fi}`) {
      raw.frame = await sharp(c.list[fi].file).removeAlpha().raw().toBuffer();
      raw.key = `${seg.clip}:${fi}`;
    }
    // Camera: glide from the previous framing to this one.
    const to = framing(seg.crop, seg.vp);
    const prev = si > 0 && segs[si - 1].clip === seg.clip ? framing(segs[si - 1].crop, seg.vp) : to;
    const p = smooth(clamp((T - seg.out0) / Math.min(1.3, (seg.out1 - seg.out0) * 0.8), 0, 1));
    const cam = { cx: lerp(prev.cx, to.cx, p), cy: lerp(prev.cy, to.cy, p), w: Math.exp(lerp(Math.log(prev.w), Math.log(to.w), p)) };
    cam.h = cam.w * (seg.vp.height / seg.vp.width);
    let toOut; // CSS px -> output px
    let frameBuf;
    if (c.phone) {
      const nw = Math.round((c.w * H) / c.h);
      const left = Math.round((W - nw) / 2);
      const key = `${seg.clip}:${fi}:phone`;
      if (base.key !== key) {
        base = { key, buf: await sharp(raw.frame, { raw: { width: c.w, height: c.h, channels: 3 } }).resize(nw, H, { kernel: 'lanczos3' }).extend({ left, right: W - nw - left, background: '#0b0d12' }).raw().toBuffer() };
      }
      frameBuf = base.buf;
      const sc = H / seg.vp.height;
      toOut = (x, y) => [left + x * sc, y * sc];
    } else {
      const x = Math.round((cam.cx - cam.w / 2) * c.k);
      const y = Math.round((cam.cy - cam.h / 2) * c.k);
      const w = Math.min(c.w - x, Math.round(cam.w * c.k));
      const h = Math.min(c.h - y, Math.round(cam.h * c.k));
      const key = `${seg.clip}:${fi}:${x}:${y}:${w}:${h}`;
      if (base.key !== key) {
        const img = sharp(raw.frame, { raw: { width: c.w, height: c.h, channels: 3 } });
        const view = w === c.w && h === c.h ? img : img.extract({ left: x, top: y, width: w, height: h });
        base = { key, buf: await view.resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer() };
      }
      frameBuf = base.buf;
      toOut = (px, py) => [((px - cam.cx + cam.w / 2) / cam.w) * W, ((py - cam.cy + cam.h / 2) / cam.h) * H];
    }
    // Cursor and click ring, drawn here so they glide at 60 fps whatever the capture rate.
    const cur = cursorAt(c.cursor, srcT, seg.vp);
    const over = [];
    if (cur.visible) {
      const [ox, oy] = toOut(cur.pos.x, cur.pos.y);
      if (ox > 4 && oy > 4 && ox < W - 50 && oy < H - 50) {
        if (cur.ring != null) over.push({ input: ringSvg(cur.ring), left: Math.round(clamp(ox - 60, 0, W - 120)), top: Math.round(clamp(oy - 60, 0, H - 120)) });
        over.push({ input: CURSOR, left: Math.round(ox - 7), top: Math.round(oy - 4) });
      }
    }
    const out = over.length ? await sharp(frameBuf, { raw: { width: W, height: H, channels: 3 } }).composite(over).removeAlpha().raw().toBuffer() : frameBuf;
    if (out.length !== W * H * 3) {
      console.log(`
  frame ${i} (${seg.clip}, src ${fi}): ${out.length} bytes, expected ${W * H * 3}; base ${frameBuf.length}; overlays ${over.length}`);
      process.exit(1);
    }
    if (!ffp.stdin.write(out)) await once(ffp.stdin, 'drain');
    if (i % 600 === 0) process.stdout.write(`\r  ${tag} ${Math.round((i / frames) * 100)}%`);
  }
  ffp.stdin.end();
  await exited;
  process.stdout.write(`\r  ${tag} 100%   \n`);

  const out = join(OUT, `${tag}.mp4`);
  if (voiceFile) ff(['-i', silent, '-i', voiceFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]);
  else ff(['-i', silent, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out]);
  return { out, seconds: probeSeconds(out), voice: !!voiceFile };
}

const want = process.argv.slice(2).map(Number);
const script = scriptSentences();
const done = [];
for (const f of readdirSync(CLIPS).filter((x) => /^ch\d\d\.json$/.test(x)).sort()) {
  const tag = f.slice(0, 4);
  if (want.length && !want.includes(Number(tag.slice(2)))) continue;
  const meta = JSON.parse(readFileSync(join(CLIPS, f), 'utf8'));
  const s = script[tag];
  if (s && s.sentences.length !== meta.steps.length) console.log(`  ${tag}: script has ${s.sentences.length} sentences, recording has ${meta.steps.length} steps`);
  const voice = s && existsSync(join(VOICE, `${s.file}.m4a`)) ? join(VOICE, `${s.file}.m4a`) : null;
  const r = await chapterVideo(tag, meta, s?.sentences ?? [], voice);
  done.push(r);
  console.log(`${tag} ${r.seconds.toFixed(1)} s ${r.voice ? '(your voice)' : '(preview timing, no voice yet)'}`);
}
const all = readdirSync(OUT).filter((x) => /^ch\d\d\.mp4$/.test(x)).sort().map((x) => join(OUT, x));
const list = join(TMP, 'all.txt');
writeFileSync(list, all.map((p) => `file '${slash(p)}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(OUT, 'walkthrough.mp4')]);
console.log(`walkthrough.mp4: ${probeSeconds(join(OUT, 'walkthrough.mp4')).toFixed(1)} s from ${all.length} chapters`);
rmSync(TMP, { recursive: true, force: true });
