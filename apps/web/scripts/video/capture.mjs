/**
 * Screen capture for the walkthrough video: Chrome's own screencast frames (sent
 * whenever the screen changes, with timestamps), saved as JPEGs, then joined into
 * an MP4 with each frame held until the next one, so timing is exact.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const slash = (p) => p.split('\\').join('/');

export async function startCapture(page, folder) {
  const dir = resolve(folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.createCDPSession();
  const frames = [];
  const t0 = Date.now() / 1000;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = join(dir, `f${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  const vp = page.viewport();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: vp.width * vp.deviceScaleFactor, maxHeight: vp.height * vp.deviceScaleFactor, everyNthFrame: 1 });
  return {
    t0,
    /** Seconds since the capture started (the clock the frames use). */
    now: () => Date.now() / 1000 - t0,
    async stop(out) {
      const end = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await new Promise((r) => setTimeout(r, 300));
      if (!frames.length) throw new Error(`No frames were captured for ${out} (was the tab in front?)`);
      // Each frame lasts until the next one; the first starts at t0.
      const lines = [];
      frames.forEach((f, i) => {
        const next = frames[i + 1]?.t ?? end;
        const start = i === 0 ? Math.min(f.t, t0) : f.t;
        lines.push(`file '${slash(f.file)}'`, `duration ${Math.max(0.001, next - start).toFixed(3)}`);
      });
      if (frames.length) lines.push(`file '${slash(frames.at(-1).file)}'`);
      const list = join(dir, 'frames.txt');
      writeFileSync(list, lines.join('\n'));
      const r = spawnSync(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', out], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.slice(-600)}`);
      return { frames: frames.length, seconds: end - t0, list: frames.map((f) => ({ file: f.file, t: Math.max(0, f.t - t0) })) };
    },
  };
}
