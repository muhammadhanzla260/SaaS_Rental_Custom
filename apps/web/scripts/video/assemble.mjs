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
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const ROOT = resolve(import.meta.dirname, '../../../..');
const VIDEO = join(ROOT, '.data/video');
const CLIPS = join(VIDEO, 'clips');
const VOICE = join(VIDEO, 'voice');
const OUT = join(VIDEO, 'out');
const TMP = join(OUT, 'tmp');
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf';
const W = 1920;
const H = 1080;
const WORDS_PER_SECOND = 2.5;
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

function chapterVideo(tag, meta, sentences, voiceFile) {
  const steps = meta.steps;
  const durations = voiceFile
    ? voiceSegments(voiceFile, steps.length)
    : steps.map((_, i) => Math.max(2.2, (sentences[i] ?? '').split(/\s+/).length / WORDS_PER_SECOND + 0.6));
  const parts = [];
  steps.forEach((step, si) => {
    const recorded = step.shots.reduce((s, x) => s + (x.t1 - x.t0), 0);
    const target = durations[si] ?? 3;
    step.shots.forEach((shot, hi) => {
      const clip = meta.clips[shot.clip];
      const len = shot.t1 - shot.t0;
      const out = Math.max(0.5, (len / recorded) * target);
      const factor = len / out; // >1 speeds up, <1 holds longer
      const [x, y, w, h] = shot.crop.map((v) => v * 2);
      const phone = clip.size.width < 600;
      const capFile = join(TMP, `${tag}-${si}-${hi}.txt`);
      writeFileSync(capFile, step.caption);
      const zoom = phone
        ? `crop=${w}:${h}:${x}:${y},scale=-2:${H},pad=${W}:${H}:(ow-iw)/2:0:color=0x0b0d12`
        : `crop=${w}:${h}:${x}:${y},scale=${W}:${H}:flags=lanczos`;
      const speed = factor >= 1 ? `setpts=(PTS-STARTPTS)/${factor.toFixed(4)}` : `setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${(out - len).toFixed(3)}`;
      const caption = `drawtext=fontfile='${FONT}':textfile='${slash(capFile).replace(':', '\\:')}':fontsize=44:fontcolor=white:box=1:boxcolor=0x0b0d12@0.78:boxborderw=22:x=(w-text_w)/2:y=h-text_h-54`;
      const file = join(TMP, `${tag}-${si}-${hi}.mp4`);
      ff(['-ss', shot.t0.toFixed(3), '-t', len.toFixed(3), '-i', clip.file, '-vf', `${zoom},${speed},fps=30,${caption},format=yuv420p`, '-t', out.toFixed(3), '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', file]);
      parts.push(file);
    });
  });
  const list = join(TMP, `${tag}.txt`);
  writeFileSync(list, parts.map((p) => `file '${slash(p)}'`).join('\n'));
  const silent = join(TMP, `${tag}-silent.mp4`);
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
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
  const r = chapterVideo(tag, meta, s?.sentences ?? [], voice);
  done.push(r);
  console.log(`${tag} ${r.seconds.toFixed(1)} s ${r.voice ? '(your voice)' : '(preview timing, no voice yet)'}`);
}
const all = readdirSync(OUT).filter((x) => /^ch\d\d\.mp4$/.test(x)).sort().map((x) => join(OUT, x));
const list = join(TMP, 'all.txt');
writeFileSync(list, all.map((p) => `file '${slash(p)}'`).join('\n'));
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(OUT, 'walkthrough.mp4')]);
console.log(`walkthrough.mp4: ${probeSeconds(join(OUT, 'walkthrough.mp4')).toFixed(1)} s from ${all.length} chapters`);
rmSync(TMP, { recursive: true, force: true });
