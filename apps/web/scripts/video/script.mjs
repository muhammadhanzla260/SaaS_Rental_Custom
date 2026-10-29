/** The narration script as steps: { ch00: { file: 'ch00-intro', sentences: [...] }, ... } (one sentence per [pause]). */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const VIDEO = resolve(import.meta.dirname, '../../../../.data/video');

/** The videos: the short walkthrough for the salesperson, and the full training video for everyone. */
export const PROJECTS = {
  walkthrough: { script: 'narration-script.md', clips: 'clips', frames: 'frames', tts: 'tts', out: 'out', state: 'state.json' },
  training: { script: 'training-script.md', clips: 'training/clips', frames: 'training/frames', tts: 'training/tts', out: 'training/out', state: 'training/state.json' },
};
/** The project named on the command line (walkthrough when none is). */
export const projectArg = (args) => args.find((a) => PROJECTS[a]) ?? 'walkthrough';

export function parseScript(project = 'walkthrough') {
  const md = readFileSync(join(VIDEO, PROJECTS[project].script), 'utf8');
  const out = {};
  for (const part of md.split(/\n## /).slice(1)) {
    const file = part.match(/`(ch\d\d-[a-z-]+)\.m4a`/)?.[1];
    if (!file) continue;
    const body = part.split('\n').slice(1).filter((l) => l.trim() && !l.startsWith('`') && !l.startsWith('---')).join(' ');
    out[file.slice(0, 4)] = { file, title: part.split('\n')[0].replace(/^Chapter \d+ · /, '').trim(), sentences: body.split('[pause]').map((s) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean) };
  }
  return out;
}

export const VOICES = {
  ava: { id: 'en-US-AvaNeural', label: 'Ava · warm and expressive' },
  jenny: { id: 'en-US-JennyNeural', label: 'Jenny · friendly' },
  sonia: { id: 'en-GB-SoniaNeural', label: 'Sonia · British' },
};
