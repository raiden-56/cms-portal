import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { loadEnvFile } from '../src/config/load-env';

/**
 * Prepares an isolated test environment: its own Postgres schema (migrated from the real
 * migration files), an emptied Redis database, and a clean local storage directory.
 * The development database is never touched.
 */
export default async function setup() {
  process.env.NODE_ENV = 'test';
  loadEnvFile('.env.test', { override: true });
  const url = process.env.DATABASE_URL ?? '';
  const redisUrl = process.env.REDIS_URL ?? '';
  if (!/[?&]schema=test\b/.test(url)) {
    throw new Error('Refusing to run tests: DATABASE_URL must point at the dedicated "test" schema (…?schema=test).');
  }
  if (!/\/[1-9]\d*$/.test(redisUrl)) {
    throw new Error('Refusing to run tests: REDIS_URL must select a non-default database (e.g. redis://localhost:6390/1).');
  }

  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });

  // Imported only now: Prisma reads its datasource from the environment prepared above.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'test' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"test"."${t.tablename}"`).join(', ')} CASCADE`);
  }
  await prisma.$disconnect();

  const { Redis } = await import('ioredis');
  const redis = new Redis(redisUrl);
  await redis.flushdb();
  await redis.quit();

  rmSync(process.env.STORAGE_LOCAL_DIR ?? './storage-test', { recursive: true, force: true });
}
