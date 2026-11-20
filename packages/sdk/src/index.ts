/**
 * @meridian/sdk — client for the Meridian content delivery API.
 *
 *   const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: process.env.MERIDIAN_API_KEY });
 *   const { data } = await cms.content('articles').find({ limit: 10, sort: '-publishedOn' });
 *   const page = await cms.pages.getByPath('/about');
 *
 * Zero dependencies. Runs anywhere `fetch` exists: Node 18+, browsers, edge runtimes, React Native.
 */

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'in' | 'nin' | 'null';
export type FilterValue = string | number | boolean | null | (string | number)[] | Partial<Record<FilterOperator, string | number | boolean | (string | number)[]>>;

export interface QueryParams {
  /** Locale code. Falls back to the locale's fallback, then the project default. */
  locale?: string;
  /** Relations to expand: `['author', 'category.parent']`, or `'*'` for every first-level relation. */
  populate?: string | string[];
  /** Return only these fields (system attributes are always included). */
  fields?: string[];
  /** `html` renders rich-text fields to sanitized HTML; `json` (default) returns the structured document. */
  richtext?: 'json' | 'html';
  /** `draft` needs a preview or read/write key and must never be used in a browser. */
  status?: 'published' | 'draft';
}

export interface ListParams extends QueryParams {
  limit?: number;
  offset?: number;
  page?: number;
  /** `'-publishedOn'`, `['-featured', 'title']` — a leading `-` sorts descending. */
  sort?: string | string[];
  search?: string;
  /** `{ category: 'news', price: { gte: 10 }, tags: { in: ['a', 'b'] } }` */
  filter?: Record<string, FilterValue>;
}

export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
  page: number;
  pageCount: number;
}

export interface ListResult<T> {
  data: T[];
  meta: ListMeta;
}

export interface SystemFields {
  id: string;
  type: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  /** Present only when reading drafts. */
  status?: string;
}

export type Entry<T = Record<string, unknown>> = SystemFields & T;

export interface MediaAsset {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  kind: 'image' | 'video' | 'document' | 'archive' | 'other';
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string;
}

/** A page builder block. Map `type` to a component in your own frontend. */
export interface Block<P = Record<string, unknown>> {
  id: string;
  type: string;
  props: P;
  style?: Record<string, unknown>;
  children?: Block[];
}

export interface Page extends SystemFields {
  title: string;
  slug: string;
  /** Full URL path including parent pages, e.g. `/company/team`. */
  path: string;
  parent: { id: string; path: string | null } | null;
  description: string | null;
  template: string;
  category: string | null;
  seo: {
    title?: string;
    description?: string;
    canonicalUrl?: string;
    noIndex?: boolean;
    noFollow?: boolean;
    ogTitle?: string;
    ogDescription?: string;
    ogImage: MediaAsset | null;
    twitterCard?: 'summary' | 'summary_large_image';
    jsonLd?: unknown;
  };
  blocks: Block[];
}

export interface ContentEvent {
  id: string;
  event: string;
  organization: string;
  project: string;
  environment: string;
  contentType?: string;
  documentId?: string;
  locale?: string;
  slug?: string | null;
  path?: string | null;
  title?: string | null;
  releaseId?: string;
  documents?: { contentType: string; documentId: string; slug?: string | null; path?: string | null }[];
  timestamp: string;
}

export interface ImageTransform {
  w?: number;
  h?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: 'center' | 'top' | 'right' | 'bottom' | 'left' | 'entropy' | 'attention';
  format?: 'webp' | 'avif' | 'jpeg' | 'png';
  q?: number;
}

export class MeridianError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'MeridianError';
  }
  /** True for failures worth retrying later (rate limits, server and network errors). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface CMSClientOptions {
  /** Origin of your Meridian API, e.g. `https://cms.example.com`. */
  baseURL: string;
  /** API key. Read-only keys are safe in browsers; read/write and preview keys are server-side secrets. */
  apiKey?: string;
  /** Default locale for every request. */
  locale?: string;
  /** Custom fetch (e.g. Next.js fetch with caching options, or a mock in tests). */
  fetch?: typeof fetch;
  /** Extra options merged into every fetch call (e.g. `{ next: { tags: ['cms'] } }` in Next.js). */
  fetchOptions?: Record<string, unknown>;
  /** Abort a request after this many milliseconds. Default 15000. */
  timeoutMs?: number;
  /** Retries for rate-limited and failed requests (GET only), with backoff. Default 2. */
  retries?: number;
  /**
   * In-memory response cache with ETag revalidation. `ttlMs` is how long a response is served
   * without contacting the server; after that it is revalidated cheaply with If-None-Match.
   * Default `{ ttlMs: 0, max: 200 }` — always revalidate, so published changes show up at once.
   */
  cache?: { ttlMs?: number; max?: number } | false;
  /** Secret keys throw when used in a browser. Set this only if you fully understand the exposure. */
  dangerouslyAllowBrowser?: boolean;
}

interface CacheEntry {
  etag: string | null;
  body: unknown;
  storedAt: number;
}

// Read through globalThis so the SDK type-checks without the DOM library (Node, edge, React Native).
const isBrowser = () => {
  const g = globalThis as { window?: unknown; document?: unknown };
  return typeof g.window !== 'undefined' && typeof g.document !== 'undefined';
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function appendFilter(search: URLSearchParams, filter: Record<string, FilterValue>) {
  for (const [field, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (value === null) search.append(`filter[${field}][null]`, 'true');
    else if (Array.isArray(value)) search.append(`filter[${field}][in]`, value.join(','));
    else if (typeof value === 'object') {
      for (const [op, operand] of Object.entries(value)) {
        if (operand === undefined) continue;
        search.append(`filter[${field}][${op}]`, Array.isArray(operand) ? operand.join(',') : String(operand));
      }
    } else search.append(`filter[${field}]`, String(value));
  }
}

/** Serialises query parameters the way the delivery API expects them. */
export function buildQuery(params: ListParams = {}, defaults: { locale?: string } = {}): string {
  const search = new URLSearchParams();
  const locale = params.locale ?? defaults.locale;
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.page !== undefined) search.set('page', String(params.page));
  else if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.sort) search.set('sort', Array.isArray(params.sort) ? params.sort.join(',') : params.sort);
  if (params.search) search.set('search', params.search);
  if (params.filter) appendFilter(search, params.filter);
  if (locale) search.set('locale', locale);
  if (params.populate) search.set('populate', Array.isArray(params.populate) ? params.populate.join(',') : params.populate);
  if (params.fields?.length) search.set('fields', params.fields.join(','));
  if (params.richtext) search.set('richtext', params.richtext);
  if (params.status && params.status !== 'published') search.set('status', params.status);
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Adds image transformation parameters to a media URL. */
export function imageUrl(source: string | Pick<MediaAsset, 'url'>, transform: ImageTransform = {}): string {
  const url = typeof source === 'string' ? source : source.url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(transform)) if (value !== undefined && value !== null) search.set(key, String(value));
  const text = search.toString();
  return text ? `${url}${url.includes('?') ? '&' : '?'}${text}` : url;
}

export interface CollectionClient<T> {
  /** One page of entries. */
  find(params?: ListParams): Promise<ListResult<Entry<T>>>;
  /** One entry by id or slug. Resolves to `null` when it does not exist or is not published. */
  findOne(idOrSlug: string, params?: QueryParams): Promise<Entry<T> | null>;
  /** The entry of a single type (e.g. site settings). Resolves to `null` until it is published. */
  single(params?: QueryParams): Promise<Entry<T> | null>;
  /** Iterates over every matching entry, fetching page after page as needed. */
  all(params?: Omit<ListParams, 'offset' | 'page'>): AsyncGenerator<Entry<T>, void, undefined>;
  /** Write operations need a read/write key and must run on a server. */
  create(data: Partial<T>, options?: { publish?: boolean; locale?: string }): Promise<Entry<T>>;
  /** Changes only the fields you pass. */
  update(id: string, data: Partial<T>, options?: { publish?: boolean; locale?: string }): Promise<Entry<T>>;
  /** Replaces the whole document. */
  replace(id: string, data: T, options?: { publish?: boolean; locale?: string }): Promise<Entry<T>>;
  delete(id: string, options?: { locale?: string }): Promise<void>;
  publish(id: string, options?: { locale?: string }): Promise<Entry<T>>;
  unpublish(id: string, options?: { locale?: string }): Promise<Entry<T>>;
}

export interface CMSClient {
  content<T = Record<string, unknown>>(type: string): CollectionClient<T>;
  pages: {
    list(params?: ListParams): Promise<ListResult<Page>>;
    /** Resolve a route: `getByPath('/company/team')`. `null` when no published page lives there. */
    getByPath(path: string, params?: QueryParams): Promise<Page | null>;
    getBySlug(slug: string, params?: QueryParams): Promise<Page | null>;
    get(id: string, params?: QueryParams): Promise<Page | null>;
  };
  media: {
    get(id: string): Promise<(MediaAsset & { tags: string[] }) | null>;
    url: typeof imageUrl;
  };
  /** The project's content model: types and their fields. */
  contentTypes(): Promise<{ apiId: string; displayName: string; kind: string; localized: boolean; fields: { apiId: string; label: string; type: string; required: boolean }[] }[]>;
  graphql<T = unknown>(query: string, variables?: Record<string, unknown>, options?: { status?: 'published' | 'draft'; locale?: string }): Promise<T>;
  /** Reads one draft using a signed preview token from the admin (no API key involved). */
  preview<T = Record<string, unknown>>(previewToken: string, params?: QueryParams): Promise<Entry<T> | Page>;
  /**
   * Live content events over WebSocket (publish, unpublish, …). Reconnects automatically.
   * Returns a function that closes the connection.
   */
  subscribe(handler: (event: ContentEvent) => void, options?: { WebSocket?: unknown; onStatus?: (status: 'connecting' | 'open' | 'closed') => void }): () => void;
  cache: {
    /** Forget everything, or only responses for one content type. Call this from a webhook or `subscribe`. */
    clear(type?: string): void;
  };
}

export function createCMSClient(options: CMSClientOptions): CMSClient {
  if (!options?.baseURL) throw new Error('createCMSClient: baseURL is required');
  const base = options.baseURL.replace(/\/+$/, '');
  const apiBase = `${base}/api/v1`;
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('createCMSClient: no fetch implementation found. Pass one with the `fetch` option.');
  const key = options.apiKey;
  if (key && /^mrd_(rw|pv)_/.test(key) && isBrowser() && !options.dangerouslyAllowBrowser) {
    throw new Error(
      'This is a secret Meridian key (read/write or preview) and must not be used in browser code, where anyone can read it. ' +
        'Use a read-only key in the browser, or call Meridian from your server.',
    );
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 2;
  const cacheOptions = options.cache === false ? null : { ttlMs: options.cache?.ttlMs ?? 0, max: options.cache?.max ?? 200 };
  const cache = new Map<string, CacheEntry>();

  async function request<T>(method: string, path: string, init: { body?: unknown; auth?: boolean; useCache?: boolean } = {}): Promise<{ status: number; body: T }> {
    const url = `${apiBase}${path}`;
    const cacheable = method === 'GET' && !!cacheOptions && init.useCache !== false;
    const cached = cacheable ? cache.get(url) : undefined;
    if (cached && cacheOptions && Date.now() - cached.storedAt < cacheOptions.ttlMs) return { status: 200, body: cached.body as T };

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.auth !== false && key) headers.Authorization = `Bearer ${key}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(url, { ...(options.fetchOptions ?? {}), method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: controller.signal } as RequestInit);
      } catch (err) {
        clearTimeout(timer);
        if (method === 'GET' && attempt < retries) {
          attempt += 1;
          await sleep(250 * 2 ** (attempt - 1));
          continue;
        }
        const aborted = (err as Error)?.name === 'AbortError';
        throw new MeridianError(aborted ? `Request timed out after ${timeoutMs} ms` : `Network error: ${(err as Error)?.message ?? 'request failed'}`, 0, aborted ? 'timeout' : 'network_error');
      }
      clearTimeout(timer);

      if (response.status === 304 && cached) {
        cached.storedAt = Date.now();
        return { status: 200, body: cached.body as T };
      }
      if ((response.status === 429 || response.status >= 500) && method === 'GET' && attempt < retries) {
        attempt += 1;
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 300 * 2 ** (attempt - 1));
        continue;
      }
      const text = response.status === 204 ? '' : await response.text();
      let body: any = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (!response.ok) {
        const error = body?.error ?? {};
        throw new MeridianError(error.message ?? `Request failed with status ${response.status}`, response.status, error.code ?? 'error', error.details, error.requestId ?? response.headers.get('x-request-id') ?? undefined);
      }
      if (cacheable && cacheOptions) {
        if (cache.size >= cacheOptions.max) cache.delete(cache.keys().next().value as string);
        cache.set(url, { etag: response.headers.get('etag'), body, storedAt: Date.now() });
      }
      return { status: response.status, body: body as T };
    }
  }

  /** GET that maps "not found" to null, which is how optional content is usually consumed. */
  async function getOrNull<T>(path: string): Promise<T | null> {
    try {
      return (await request<{ data: T }>('GET', path)).body.data;
    } catch (err) {
      if (err instanceof MeridianError && err.status === 404) return null;
      throw err;
    }
  }

  const q = (params?: ListParams) => buildQuery(params, { locale: options.locale });
  const localeQuery = (locale?: string) => (locale ? `?locale=${encodeURIComponent(locale)}` : '');
  const clearType = (type: string) => {
    for (const url of [...cache.keys()]) if (url.startsWith(`${apiBase}/${type}`)) cache.delete(url);
  };

  function content<T>(type: string): CollectionClient<T> {
    const root = `/${encodeURIComponent(type)}`;
    const write = async (method: string, path: string, body?: unknown) => {
      const result = await request<{ data: Entry<T> }>(method, path, { body });
      clearType(type);
      return result.body?.data;
    };
    return {
      find: async (params) => (await request<ListResult<Entry<T>>>('GET', `${root}${q(params)}`)).body,
      findOne: (idOrSlug, params) => getOrNull<Entry<T>>(`${root}/${encodeURIComponent(idOrSlug)}${q(params)}`),
      single: (params) => getOrNull<Entry<T>>(`${root}${q(params)}`),
      async *all(params = {}) {
        const limit = params.limit ?? 100;
        for (let offset = 0; ; offset += limit) {
          const result = (await request<ListResult<Entry<T>>>('GET', `${root}${q({ ...params, limit, offset })}`)).body;
          yield* result.data;
          if (offset + result.data.length >= result.meta.total || result.data.length === 0) return;
        }
      },
      create: (data, opts = {}) => write('POST', root, { data, publish: opts.publish ?? false, locale: opts.locale }),
      update: (id, data, opts = {}) => write('PATCH', `${root}/${encodeURIComponent(id)}${localeQuery(opts.locale)}`, { data, publish: opts.publish ?? false }),
      replace: (id, data, opts = {}) => write('PUT', `${root}/${encodeURIComponent(id)}${localeQuery(opts.locale)}`, { data, publish: opts.publish ?? false }),
      delete: async (id, opts = {}) => {
        await request('DELETE', `${root}/${encodeURIComponent(id)}${localeQuery(opts.locale)}`);
        clearType(type);
      },
      publish: (id, opts = {}) => write('POST', `${root}/${encodeURIComponent(id)}/publish${localeQuery(opts.locale)}`),
      unpublish: (id, opts = {}) => write('POST', `${root}/${encodeURIComponent(id)}/unpublish${localeQuery(opts.locale)}`),
    };
  }

  return {
    content,
    pages: {
      list: async (params) => (await request<ListResult<Page>>('GET', `/pages${q(params)}`)).body,
      getByPath: (path, params) => {
        const query = q(params);
        const normalised = `/${path.replace(/^\/+|\/+$/g, '')}`;
        return getOrNull<Page>(`/pages${query ? `${query}&` : '?'}path=${encodeURIComponent(normalised)}`);
      },
      getBySlug: (slug, params) => getOrNull<Page>(`/pages/${encodeURIComponent(slug)}${q(params)}`),
      get: (id, params) => getOrNull<Page>(`/pages/${encodeURIComponent(id)}${q(params)}`),
    },
    media: {
      get: (id) => getOrNull(`/media/${encodeURIComponent(id)}`),
      url: imageUrl,
    },
    contentTypes: async () => (await request<{ data: any[] }>('GET', '/content-types')).body.data,
    async graphql<T>(query: string, variables?: Record<string, unknown>, opts: { status?: 'published' | 'draft'; locale?: string } = {}) {
      const search = new URLSearchParams();
      if (opts.status === 'draft') search.set('status', 'draft');
      if (opts.locale ?? options.locale) search.set('locale', (opts.locale ?? options.locale) as string);
      const suffix = search.toString() ? `?${search}` : '';
      const { body } = await request<{ data?: T; errors?: { message: string; extensions?: { code?: string; details?: unknown } }[] }>('POST', `/graphql${suffix}`, { body: { query, variables } });
      if (body.errors?.length) {
        const first = body.errors[0];
        throw new MeridianError(first.message, 200, first.extensions?.code ?? 'graphql_error', body.errors);
      }
      return body.data as T;
    },
    async preview(previewToken, params) {
      const query = q(params);
      const { body } = await request<{ data: any }>('GET', `/preview${query ? `${query}&` : '?'}token=${encodeURIComponent(previewToken)}`, { auth: false, useCache: false });
      return body.data;
    },
    subscribe(handler, opts = {}) {
      const Socket = (opts.WebSocket ?? (globalThis as { WebSocket?: unknown }).WebSocket) as (new (url: string) => any) | undefined;
      if (!Socket) throw new Error('subscribe: no WebSocket implementation found. Pass one with the `WebSocket` option (e.g. from the "ws" package).');
      if (!key) throw new Error('subscribe: an apiKey is required');
      const url = `${base.replace(/^http/, 'ws')}/api/v1/events`;
      let socket: any;
      let closed = false;
      let attempts = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const connect = () => {
        if (closed) return;
        opts.onStatus?.('connecting');
        socket = new Socket(url);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: key }));
        socket.onmessage = (message: { data: unknown }) => {
          let parsed: { type?: string; data?: ContentEvent };
          try {
            parsed = JSON.parse(String(message.data));
          } catch {
            return;
          }
          if (parsed.type === 'ready') {
            attempts = 0;
            opts.onStatus?.('open');
          } else if (parsed.type === 'event' && parsed.data) {
            // Whatever changed is no longer what we have cached.
            if (parsed.data.contentType) clearType(parsed.data.contentType);
            else cache.clear();
            handler(parsed.data);
          }
        };
        socket.onclose = () => {
          opts.onStatus?.('closed');
          if (closed) return;
          attempts += 1;
          timer = setTimeout(connect, Math.min(30_000, 500 * 2 ** Math.min(attempts, 6)));
        };
        socket.onerror = () => socket.close?.();
      };
      connect();
      return () => {
        closed = true;
        if (timer) clearTimeout(timer);
        socket?.close?.();
      };
    },
    cache: {
      clear(type) {
        if (type) clearType(type);
        else cache.clear();
      },
    },
  };
}

export { verifyWebhookSignature, parseWebhook, type WebhookHeaders } from './webhooks';
