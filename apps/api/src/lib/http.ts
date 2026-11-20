import type { Request } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { unprocessable } from './errors';

/** Parses input with a Zod schema, turning failures into a 422 with per-field details. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw unprocessable(
      'Validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
    );
  }
  return result.data;
}

export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

export interface Page<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, meta: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } };
}

export function param(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
