/** Uploaded files: kept in the database without object storage, in the bucket with it, read the same way. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import '../scripts/env';
import { createDb } from './client';
import { tenants, users } from './schema';
import { getFile, saveImage, setupOrganization } from './services/organizations';
import { objectKey, readFileBytes, setObjectStore, type ObjectStore } from './storage';

const app = createDb(process.env.DATABASE_URL!, { max: 2 });
const owner = createDb(process.env.DATABASE_URL_OWNER!, { max: 1 });
const run = randomUUID().slice(0, 8);
const userId = `st-${run}`;
let tenantId = '';
const photo = { filename: 'castle.png', mime: 'image/png', bytes: Buffer.from(`png-bytes-${run}`) };

// A stand-in bucket: what the app would PUT to and GET from R2.
const bucket = new Map<string, { bytes: Buffer; mime: string }>();
const fake: ObjectStore = {
  async put(key, bytes, mime) { bucket.set(key, { bytes, mime }); },
  async get(key) { return bucket.get(key)?.bytes ?? null; },
};

beforeAll(async () => {
  await owner.db.insert(users).values({ id: userId, name: 'Storage Test', email: `st-${run}@example.test` });
  tenantId = (await setupOrganization(app.db, { userId }, {
    slug: `st-${run}`, name: 'Storage Rentals',
    location: { name: 'Austin', code: 'AUS', address: { line1: '700 Congress Ave', city: 'Austin', country: 'US', lat: 30.2692, lng: -97.7428 } },
  })).id;
});

afterAll(async () => {
  setObjectStore(undefined);
  await owner.db.execute(sql`delete from audit_log where tenant_id = ${tenantId}::uuid`);
  await owner.db.delete(tenants).where(sql`${tenants.id} = ${tenantId}::uuid`);
  await owner.db.delete(users).where(sql`${users.id} = ${userId}`);
  await app.client.end();
  await owner.client.end();
});

describe('file storage', () => {
  it('without object storage, keeps the bytes in the database', async () => {
    setObjectStore(null);
    const id = await saveImage(app.db, tenantId, userId, photo, 'product');
    const f = (await getFile(app.db, tenantId, id))!;
    expect(f).toMatchObject({ storage: 'db', storageKey: null });
    expect((await readFileBytes(f))?.toString()).toBe(photo.bytes.toString());
  });

  it('with object storage, puts the bytes in the bucket and keeps only the record', async () => {
    setObjectStore(fake);
    const id = await saveImage(app.db, tenantId, userId, photo, 'product');
    const f = (await getFile(app.db, tenantId, id))!;
    expect(f).toMatchObject({ storage: 's3', storageKey: objectKey(tenantId, id), content: null, sizeBytes: photo.bytes.length });
    expect(bucket.get(objectKey(tenantId, id))).toMatchObject({ mime: 'image/png' });
    expect((await readFileBytes(f))?.toString()).toBe(photo.bytes.toString());
  });

  it('a file in the bucket cannot be read when object storage is not configured', async () => {
    setObjectStore(null);
    await expect(readFileBytes({ storage: 's3', storageKey: 'x/y', content: null })).rejects.toThrow('object storage is not configured');
  });
});
