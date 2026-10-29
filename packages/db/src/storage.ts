/**
 * Object storage for uploaded files (Cloudflare R2, or any S3-compatible store). With the R2_* settings
 * present, new files go to the bucket and the files table keeps only the record; without them (local
 * development, tests) the bytes stay in the files table as before. Either way files are read through
 * readFileBytes(), so the app does not care where a file lives.
 */
import { AwsClient } from 'aws4fetch';

export type ObjectStore = {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
};

let override: ObjectStore | null | undefined;
let cached: { env: string; store: ObjectStore | null } | null = null;

/** Tests swap in their own store (or null for "no object storage"). */
export function setObjectStore(store: ObjectStore | null | undefined) {
  override = store;
}

/** The configured bucket, or null when files are kept in the database. */
export function objectStore(): ObjectStore | null {
  if (override !== undefined) return override;
  const { R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } = process.env;
  const env = [endpoint, accessKeyId, secretAccessKey, bucket].join('|');
  if (cached?.env === env) return cached.store;
  const store = endpoint && accessKeyId && secretAccessKey && bucket ? s3Store(endpoint, bucket, accessKeyId, secretAccessKey) : null;
  cached = { env, store };
  return store;
}

function s3Store(endpoint: string, bucket: string, accessKeyId: string, secretAccessKey: string): ObjectStore {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const url = (key: string) => `${endpoint.replace(/\/+$/, '')}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    async put(key, bytes, mime) {
      const res = await client.fetch(url(key), { method: 'PUT', body: new Uint8Array(bytes), headers: { 'Content-Type': mime } });
      if (!res.ok) throw new Error(`File storage refused the upload (${res.status}): ${(await res.text()).slice(0, 200)}`);
    },
    async get(key) {
      const res = await client.fetch(url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`File storage could not read ${key} (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Where a file's bytes live in the bucket: one folder per workspace. */
export const objectKey = (tenantId: string, fileId: string) => `${tenantId}/${fileId}`;

/** A file's bytes, wherever they are kept. */
export async function readFileBytes(file: { storage: string; storageKey: string | null; content: Buffer | null }): Promise<Buffer | null> {
  if (file.storage === 'db') return file.content;
  const store = objectStore();
  if (!store || !file.storageKey) throw new Error('This file is in object storage, but object storage is not configured (R2_* settings).');
  return store.get(file.storageKey);
}
