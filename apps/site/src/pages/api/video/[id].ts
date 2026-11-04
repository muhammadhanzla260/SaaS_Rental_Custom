/**
 * GET /api/video/:id — plays a product video from the app's private R2 bucket by redirecting to a
 * signed link that expires after an hour, so the bucket never has to be public. Without the R2_*
 * settings (local preview) it streams the file from .data/video/site/ at the repo root (or VIDEO_LOCAL_DIR) instead.
 */
import type { APIRoute } from 'astro';
import { AwsClient } from 'aws4fetch';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { VIDEO_PREFIX, video } from '~/data/videos';

export const prerender = false;

const env = process.env;
const LINK_SECONDS = 3600;

export const GET: APIRoute = async ({ params, request }) => {
  const v = video(params.id ?? '');
  if (!v) return new Response('Not found', { status: 404 });
  const file = `${v.id}.mp4`;

  const { R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } = env;
  if (endpoint && accessKeyId && secretAccessKey && bucket) {
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
    const url = new URL(`${endpoint.replace(/\/+$/, '')}/${bucket}/${VIDEO_PREFIX}${file}`);
    url.searchParams.set('X-Amz-Expires', String(LINK_SECONDS));
    const signed = await client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
    // Reuse the link for a while, but never past its expiry.
    return new Response(null, { status: 302, headers: { Location: signed.url, 'Cache-Control': 'private, max-age=600' } });
  }
  return local(file, request.headers.get('range'));
};

/** Local preview: stream from .data/video/site/, with byte ranges so seeking works. */
function local(file: string, range: string | null) {
  let dir = process.cwd();
  for (let i = 0; i < 6 && !existsSync(resolve(dir, 'pnpm-workspace.yaml')); i++) dir = dirname(dir);
  const path = resolve(env.VIDEO_LOCAL_DIR || resolve(dir, '.data/video/site'), file);
  if (!existsSync(path)) return new Response('Video storage is not configured (R2_* settings).', { status: 503 });
  const size = statSync(path).size;
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  const start = m?.[1] ? +m[1] : 0;
  const end = m?.[2] ? Math.min(+m[2], size - 1) : size - 1;
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  const headers: Record<string, string> = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
  if (m) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: m ? 206 : 200, headers });
}
