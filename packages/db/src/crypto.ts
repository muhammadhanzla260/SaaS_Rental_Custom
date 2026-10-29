import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Secrets at rest (SMTP passwords, SMS keys, gateway keys): AES-256-GCM with
 * a key from APP_ENCRYPTION_KEY (32 bytes, base64 or base64url). Format:
 * "v1.<iv>.<tag>.<ciphertext>" (base64url parts). The plaintext never goes
 * back to a browser; screens only show that a secret is saved.
 */

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error('APP_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"');
  const buf = Buffer.from(raw, raw.includes('+') || raw.includes('/') ? 'base64' : 'base64url');
  if (buf.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
