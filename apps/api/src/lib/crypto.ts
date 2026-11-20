import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env';

// scrypt parameters follow OWASP guidance (N=2^17, r=8, p=1).
const SCRYPT = { N: 131072, r: 8, p: 1, keylen: 64, maxmem: 256 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, params = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: params.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: expected.length,
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const sha256 = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex');

/** URL-safe random string with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const hmacSha256 = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const key = () => Buffer.from(env.ENCRYPTION_KEY, 'hex');

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
