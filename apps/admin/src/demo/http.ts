/** Request, response and error shapes of the in-browser backend. They mirror the real API's. */
import type { ZodTypeAny, z } from 'zod';
import { newId } from '@meridian/shared';

export interface ErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export class HttpError extends Error {
  /** Set when the handler already left the state as it should stay (no rollback). */
  keepChanges = false;

  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: ErrorDetail[]) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: Record<string, unknown>) => new HttpError(409, 'conflict', message, details);
export const unprocessable = (message: string, details?: ErrorDetail[]) => new HttpError(422, 'validation_failed', message, details);

/** For the few things that genuinely need a server. The message is shown to the guest as is. */
export const needsServer = (what: string) =>
  new HttpError(403, 'guest_mode', `${what} is not available in guest mode. It needs a Meridian server, and this demo runs entirely in your browser.`);

export interface DemoRequest {
  method: string;
  /** Path below /admin/api or /api/v1, without the query string. */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface DemoResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** Parsed JSON, or a string for file responses (CSV). `null` for 204. */
  body: unknown;
}

/** A handler returns plain data for `200 OK`, or a Reply for anything else. */
export class Reply {
  constructor(
    public readonly status: number,
    public readonly body: unknown = null,
    public readonly headers: Record<string, string> = {},
  ) {}
}

export const created = (body: unknown) => new Reply(201, body);
export const noContent = () => new Reply(204);

/** Parses input with a Zod schema, turning failures into a 422 with per-field details — as the API does. */
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

export interface Paged<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

export function toPage<T>(items: T[], total: number, page: number, pageSize: number): Paged<T> {
  return { items, meta: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) } };
}

export const paginate = <T>(rows: T[], page: number, pageSize: number): Paged<T> =>
  toPage(rows.slice((page - 1) * pageSize, page * pageSize), rows.length, page, pageSize);

/**
 * Query string → nested object, the way the API's parser reads it:
 * `filter[price][gte]=10` becomes `{ filter: { price: { gte: '10' } } }`.
 */
export function parseQuery(input: string | URLSearchParams | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const pairs: [string, string][] =
    typeof input === 'string' || input instanceof URLSearchParams
      ? [...new URLSearchParams(input).entries()]
      : Object.entries(input).flatMap(([k, v]): [string, string][] =>
          v === undefined || v === null || v === '' ? [] : [[k, Array.isArray(v) ? v.join(',') : String(v)]],
        );
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of pairs) {
    const head = rawKey.split('[')[0];
    const rest = [...rawKey.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
    if (!head || rest.some((k) => k === '__proto__') || head === '__proto__') continue;
    let node = out;
    const keys = [head, ...rest];
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        node[key] = value;
        return;
      }
      if (!node[key] || typeof node[key] !== 'object') node[key] = {};
      node = node[key] as Record<string, unknown>;
    });
  }
  return out;
}

/** The API's error envelope. Anything that is not an HttpError is a bug in the demo backend and is reported as one. */
export function errorReply(err: unknown): Reply {
  if (err instanceof HttpError) return new Reply(err.status, { error: { code: err.code, message: err.message, details: err.details, requestId: newId() } });
  console.error('[guest mode] request failed unexpectedly', err);
  return new Reply(500, { error: { code: 'internal_error', message: 'The in-browser demo backend hit an unexpected error.', requestId: newId() } });
}
