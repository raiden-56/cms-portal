import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

/** Minimal object-storage contract. Media always lives behind one of these drivers. */
export interface StorageDriver {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Reports whether the store is reachable, for the health indicator. */
  ping(): Promise<boolean>;
}

class LocalStorage implements StorageDriver {
  readonly name = 'local';
  private readonly root = path.resolve(env.STORAGE_LOCAL_DIR);

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    // Keys are generated server-side, but never trust a path to stay inside the root.
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, body: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(key: string) {
    return stat(this.resolve(key)).then(
      () => true,
      () => false,
    );
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async ping() {
    await mkdir(this.root, { recursive: true });
    return true;
  }
}

/** Works with AWS S3, Cloudflare R2, and any S3-compatible store. */
class S3Storage implements StorageDriver {
  readonly name = 's3';
  private readonly bucket = env.S3_BUCKET as string;
  private readonly client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID as string, secretAccessKey: env.S3_SECRET_ACCESS_KEY as string },
  });

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async ping() {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: '__meridian_health__' }));
      return true;
    } catch (err) {
      // A 404 proves the bucket is reachable and the credentials work.
      return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
    }
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (!driver) driver = env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return driver;
}
