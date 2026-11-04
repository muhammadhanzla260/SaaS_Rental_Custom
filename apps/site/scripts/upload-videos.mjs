/**
 * Uploads the product videos to the app's R2 bucket under site/videos/, where /api/video/<id> plays them.
 *   R2_ENDPOINT=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… node apps/site/scripts/upload-videos.mjs
 * Reads <repo>/.data/video/site/<id>.mp4 (or VIDEO_LOCAL_DIR) (web copies with the index at the front, see apps/site/README.md).
 */
import { AwsClient } from 'aws4fetch';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const IDS = ['tour-aurora', 'tour-sunrise', 'tour-lagoon', 'training'];
const dir = process.env.VIDEO_LOCAL_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../../.data/video/site');
const { R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } = process.env;
if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
  console.error('Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (the same values the app uses).');
  process.exit(1);
}
const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });

for (const id of IDS) {
  const path = resolve(dir, `${id}.mp4`);
  if (!existsSync(path)) { console.error(`Missing ${path}`); process.exit(1); }
  const bytes = readFileSync(path);
  const url = `${endpoint.replace(/\/+$/, '')}/${bucket}/site/videos/${id}.mp4`;
  const res = await client.fetch(url, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  if (!res.ok) { console.error(`${id}: ${res.status} ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  console.log(`${id}.mp4 uploaded (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
