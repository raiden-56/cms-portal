import { z } from 'zod';
import { loadEnvFile } from './load-env';

// Load apps/api/.env, or .env.test under Vitest (where the file overrides whatever is already set).
if (process.env.NODE_ENV === 'test') loadEnvFile('.env.test', { override: true });
else loadEnvFile('.env', { override: false });

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    /** Signs admin access tokens and preview tokens. */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    /** 32-byte key (hex) used to encrypt webhook signing secrets at rest. */
    ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),

    /** Comma-separated origins allowed to call the management API with credentials. */
    ADMIN_ORIGIN: z.string().default('http://localhost:5180'),
    /** Public base URL of this API, used when building media and preview URLs. */
    PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
    TRUST_PROXY: z.string().default('loopback'),

    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    ALLOW_REGISTRATION: bool(true),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool(false),
    /** Optional CDN base URL placed in front of media delivery. */
    MEDIA_CDN_URL: z.string().url().optional(),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(2048).default(50),

    DELIVERY_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(60),

    WEBHOOK_ALLOW_PRIVATE_URLS: bool(false),
    WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(10000),
    /** Base delay for exponential backoff between webhook attempts. */
    WEBHOOK_BACKOFF_MS: z.coerce.number().int().min(10).default(5000),

    SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(250).default(15000),
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!value[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required when STORAGE_DRIVER=s3` });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
  // Fail fast: a misconfigured server must not start.
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const adminOrigins = env.ADMIN_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
