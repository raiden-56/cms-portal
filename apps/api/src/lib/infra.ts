import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'meridian-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.token', '*.secret'],
    censor: '[redacted]',
  },
});

export const prisma = new PrismaClient({
  // The URL is passed explicitly so the validated configuration, not an ambient .env file, decides the database.
  datasources: { db: { url: env.DATABASE_URL } },
  log: env.LOG_LEVEL === 'trace' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

/** Shared command connection. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: false });
redis.on('error', (err) => logger.error({ err: err.message }, 'redis error'));

/** Dedicated connections for BullMQ and pub/sub, which block or change connection mode. */
export function createRedisConnection(): Redis {
  const conn = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  conn.on('error', (err) => logger.error({ err: err.message }, 'redis connection error'));
  return conn;
}

export async function closeInfra() {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
}
