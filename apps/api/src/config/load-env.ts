import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Loads a dotenv file into process.env.
 *
 * In normal operation real environment variables win over the file. Under test the file
 * wins instead: Prisma loads `.env` on its own as soon as it is imported, and tests must
 * never inherit the development database from it.
 */
export function loadEnvFile(file: string, opts: { override: boolean }): boolean {
  if (!existsSync(file)) return false;
  const parsed = parseEnv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  for (const [key, value] of Object.entries(parsed)) {
    if (opts.override || process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}
