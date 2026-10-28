/**
 * Speaks the narration with Microsoft's neural voices (edge-tts, free, no account), one clip per step,
 * so every step's picture can be timed to exactly its own sentence.
 *   node apps/web/scripts/video/tts.mjs            all three voices
 *   node apps/web/scripts/video/tts.mjs ava        one voice
 * Output: .data/video/tts/<voice>/chNN-sM.mp3 and manifest.json (the clip lengths).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { parseScript, VIDEO, VOICES } from './script.mjs';

const seconds = (file) => {
  const m = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};

const want = process.argv.slice(2).filter((a) => VOICES[a]);
const script = parseScript();
for (const name of want.length ? want : Object.keys(VOICES)) {
  const dir = join(VIDEO, 'tts', name);
  mkdirSync(dir, { recursive: true });
  const manifest = {};
  for (const [tag, ch] of Object.entries(script)) {
    manifest[tag] = [];
    for (const [i, text] of ch.sentences.entries()) {
      const file = join(dir, `${tag}-s${i}.mp3`);
      if (!existsSync(file)) {
        const r = spawnSync('python', ['-m', 'edge_tts', '--voice', VOICES[name].id, '--text', text, '--write-media', file], { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`tts failed for ${name} ${tag}-s${i}: ${r.stderr.slice(-300)}`);
      }
      manifest[tag].push({ file, seconds: seconds(file), text });
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest).flat().reduce((a, c) => a + c.seconds, 0);
  console.log(`${name}: ${Object.values(manifest).flat().length} clips, ${total.toFixed(1)} s of speech`);
}
