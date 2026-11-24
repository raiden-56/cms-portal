/**
 * Management API client.
 *
 * The access token lives in memory only. When it expires the client refreshes it once
 * (using the httpOnly session cookie), retries the request, and signs the user out if
 * the session itself is gone.
 */

import { isGuestMode, loadDemo } from './guest';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:4000';
const ADMIN_BASE = `${API_URL}/admin/api`;

export interface ApiErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetail[] | Record<string, any>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level problems as a path → message map, for showing errors next to inputs. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const d of this.details) if (d.path !== undefined && !(d.path in out)) out[d.path] = d.message;
    }
    return out;
  }
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection and try again.';
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;
let refreshing: Promise<AuthPayload | null> | null = null;

export interface AuthPayload {
  accessToken: string;
  expiresIn: number;
  user: import('./types').User;
  memberships: import('./types').Membership[];
}

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setSessionExpiredHandler = (handler: () => void) => {
  onSessionExpired = handler;
};
let onRefreshed: ((payload: AuthPayload) => void) | null = null;
export const setRefreshedHandler = (handler: (payload: AuthPayload) => void) => {
  onRefreshed = handler;
};

async function parse(res: Response): Promise<any> {
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return res.json();
  return res.text();
}

function toError(res: Response, body: any): ApiError {
  const e = body?.error;
  return new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId ?? res.headers.get('x-request-id') ?? undefined);
}

/** Exchanges the session cookie for a fresh access token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthPayload | null> {
  if (!refreshing) {
    const exchange: Promise<AuthPayload | null> = isGuestMode()
      ? // Guest mode has no cookie and no server: the session is the demo data in this browser.
        loadDemo().then((demo) => demo.startSession())
      : fetch(`${ADMIN_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'X-Meridian-Client': 'admin' } }).then(async (res) => (res.ok ? ((await res.json()) as AuthPayload) : null));
    refreshing = exchange
      .then((payload) => {
        if (!payload) return null;
        accessToken = payload.accessToken;
        onRefreshed?.(payload);
        return payload;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
  signal?: AbortSignal;
  /** Send the session cookie (auth endpoints only). */
  credentials?: boolean;
  raw?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${ADMIN_BASE}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.toString();
}

const demoError = (status: number, body: any, fallback: string) => new ApiError(status, body?.error?.code ?? 'error', body?.error?.message ?? `${fallback} (${status})`, body?.error?.details, body?.error?.requestId);

/** Guest mode: the request is answered by the in-browser demo backend. Nothing is sent over the network. */
async function sendToDemo(method: string, path: string, opts: RequestOptions): Promise<any> {
  const demo = await loadDemo();
  const res = await demo.request({ method, path, query: opts.query, body: opts.body });
  if (!res.ok) throw demoError(res.status, res.body, 'Request failed');
  if (!opts.raw) return res.body;
  // `download` expects a fetch Response; build one from the generated file.
  const content = typeof res.body === 'string' ? res.body : JSON.stringify(res.body, null, 2);
  return new Response(content, { status: res.status, headers: res.headers });
}

async function send(method: string, path: string, opts: RequestOptions, retried = false): Promise<any> {
  if (isGuestMode()) return sendToDemo(method, path, opts);
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { 'X-Meridian-Client': 'admin' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    signal: opts.signal,
    credentials: opts.credentials || path.startsWith('/auth/') ? 'include' : 'omit',
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/login') && !path.startsWith('/auth/register') && !path.startsWith('/auth/refresh')) {
    const refreshed = await refreshSession();
    if (refreshed) return send(method, path, opts, true);
    onSessionExpired?.();
  }
  if (opts.raw && res.ok) return res;
  const body = await parse(res);
  if (!res.ok) throw toError(res, body);
  return body;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal): Promise<T> => send('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, query?: RequestOptions['query']): Promise<T> => send('POST', path, { body: body ?? {}, query }),
  put: <T>(path: string, body?: unknown, query?: RequestOptions['query']): Promise<T> => send('PUT', path, { body: body ?? {}, query }),
  patch: <T>(path: string, body?: unknown): Promise<T> => send('PATCH', path, { body: body ?? {} }),
  delete: <T = null>(path: string, query?: RequestOptions['query']): Promise<T> => send('DELETE', path, { query }),

  /** Downloads a file response (CSV / JSON export) and hands it to the browser. */
  async download(path: string, query: RequestOptions['query'], fallbackName: string): Promise<void> {
    const res = (await send('GET', path, { query, raw: true })) as Response;
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Multipart upload with progress reporting. */
  upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void, query?: RequestOptions['query']): Promise<T> {
    if (isGuestMode()) {
      // The files are read and kept in this browser; progress reports the reading.
      return loadDemo()
        .then((demo) => demo.upload(path, form, query, onProgress))
        .then((res) => {
          if (res.ok || ((res.body as any)?.errors && (res.body as any)?.items)) return res.body as T;
          throw demoError(res.status, res.body, 'Upload failed');
        });
    }
    const attempt = (retried: boolean): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', buildUrl(path, query));
        xhr.setRequestHeader('X-Meridian-Client', 'admin');
        if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(e.loaded / e.total);
        };
        xhr.onerror = () => reject(new TypeError('Network error'));
        xhr.onload = async () => {
          let body: any = null;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch {
            body = null;
          }
          if (xhr.status === 401 && !retried) {
            const refreshed = await refreshSession();
            if (refreshed) return attempt(true).then(resolve, reject);
            onSessionExpired?.();
          }
          // The media endpoint answers 400 with per-file errors when every file was rejected; callers want that body.
          if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
          else if (body?.errors && body?.items) resolve(body as T);
          else reject(new ApiError(xhr.status, body?.error?.code ?? 'error', body?.error?.message ?? `Upload failed (${xhr.status})`, body?.error?.details));
        };
        xhr.send(form);
      });
    return attempt(false);
  },
};

/** Calls the public delivery API with an API token (used by the API explorer and the integration wizard). */
export async function deliveryFetch(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const started = performance.now();
  if (isGuestMode()) {
    // Demo keys are only known to the in-browser backend, which also answers the request.
    const demo = await loadDemo();
    const answer = await demo.delivery(path, token, init);
    const size = answer.body === null ? 0 : JSON.stringify(answer.body).length;
    return { status: answer.status, ok: answer.ok, durationMs: Math.round(performance.now() - started), headers: answer.headers, body: answer.body, size };
  }
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: res.status, ok: res.ok, durationMs: Math.round(performance.now() - started), headers, body: json, size: text.length };
}
