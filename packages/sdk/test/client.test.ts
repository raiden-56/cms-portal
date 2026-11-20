import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeridianError, buildQuery, createCMSClient, imageUrl, parseWebhook, verifyWebhookSignature } from '../src/index';

type Call = { url: string; init: RequestInit & { headers: Record<string, string> } };

function mockFetch(responses: (Partial<{ status: number; body: unknown; headers: Record<string, string> }> | Error)[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { status: 200, body: { data: [] } };
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    return new Response(status === 204 || status === 304 ? null : JSON.stringify(next.body ?? null), { status, headers: { 'content-type': 'application/json', ...(next.headers ?? {}) } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe('query building', () => {
  it('serialises pagination, sorting, filters, population and field selection', () => {
    const query = buildQuery({
      limit: 10,
      offset: 20,
      sort: ['-publishedOn', 'title'],
      search: 'design systems',
      filter: { category: 'news', price: { gte: 10, lt: 50 }, tags: ['a', 'b'], archivedAt: null, featured: true },
      populate: ['author', 'category.parent'],
      fields: ['title', 'slug'],
      locale: 'fr',
      richtext: 'html',
    });
    const params = new URLSearchParams(query.slice(1));
    expect(Object.fromEntries(params)).toEqual({
      limit: '10',
      offset: '20',
      sort: '-publishedOn,title',
      search: 'design systems',
      'filter[category]': 'news',
      'filter[price][gte]': '10',
      'filter[price][lt]': '50',
      'filter[tags][in]': 'a,b',
      'filter[archivedAt][null]': 'true',
      'filter[featured]': 'true',
      populate: 'author,category.parent',
      fields: 'title,slug',
      locale: 'fr',
      richtext: 'html',
    });
  });

  it('omits defaults and returns an empty string when there is nothing to send', () => {
    expect(buildQuery()).toBe('');
    expect(buildQuery({ status: 'published' })).toBe('');
    expect(buildQuery({ status: 'draft' })).toBe('?status=draft');
    expect(buildQuery({}, { locale: 'de' })).toBe('?locale=de');
  });

  it('builds image transformation URLs', () => {
    expect(imageUrl('https://cms.example.com/media/a/1/x.jpg', { w: 800, h: 600, fit: 'cover', format: 'webp', q: 70 })).toBe('https://cms.example.com/media/a/1/x.jpg?w=800&h=600&fit=cover&format=webp&q=70');
    expect(imageUrl({ url: 'https://x/y.png' })).toBe('https://x/y.png');
  });
});

describe('client', () => {
  it('sends the API key and returns typed results', async () => {
    const { fetchImpl, calls } = mockFetch([{ body: { data: [{ id: '1', title: 'Hello' }], meta: { total: 1, limit: 10, offset: 0, page: 1, pageCount: 1 } } }]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com/', apiKey: 'mrd_ro_test', fetch: fetchImpl });
    const result = await cms.content<{ title: string }>('articles').find({ limit: 10, filter: { status: 'x' } });
    expect(result.data[0].title).toBe('Hello');
    expect(calls[0].url).toBe('https://cms.example.com/api/v1/articles?limit=10&filter%5Bstatus%5D=x');
    expect(calls[0].init.headers.Authorization).toBe('Bearer mrd_ro_test');
  });

  it('returns null for missing content and resolves pages by path', async () => {
    const { fetchImpl, calls } = mockFetch([
      { status: 404, body: { error: { code: 'not_found', message: 'Article not found' } } },
      { body: { data: { id: 'p1', path: '/about/team', blocks: [] } } },
    ]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: fetchImpl });
    expect(await cms.content('articles').findOne('missing')).toBeNull();
    const page = await cms.pages.getByPath('about/team/');
    expect(page?.path).toBe('/about/team');
    expect(calls[1].url).toBe('https://cms.example.com/api/v1/pages?path=%2Fabout%2Fteam');
  });

  it('raises structured errors', async () => {
    const { fetchImpl } = mockFetch([{ status: 422, body: { error: { code: 'validation_failed', message: 'Some fields are invalid', details: [{ path: 'title', message: 'Title is required' }], requestId: 'req-1' } } }]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_rw_test', fetch: fetchImpl });
    const error = await cms.content('articles').create({}).catch((e) => e);
    expect(error).toBeInstanceOf(MeridianError);
    expect(error).toMatchObject({ status: 422, code: 'validation_failed', requestId: 'req-1', retryable: false });
    expect(error.details[0].path).toBe('title');
  });

  it('revalidates with ETag and serves the cached body on 304', async () => {
    const { fetchImpl, calls } = mockFetch([
      { body: { data: [{ id: '1' }], meta: { total: 1 } }, headers: { etag: '"v1"' } },
      { status: 304 },
      { body: { data: [{ id: '1' }, { id: '2' }], meta: { total: 2 } }, headers: { etag: '"v2"' } },
    ]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: fetchImpl });
    const first = await cms.content('articles').find();
    const second = await cms.content('articles').find();
    expect(calls[1].init.headers['If-None-Match']).toBe('"v1"');
    expect(second).toEqual(first);
    const third = await cms.content('articles').find();
    expect(third.data).toHaveLength(2);
  });

  it('serves from memory within the TTL and forgets a type on demand', async () => {
    const { fetchImpl, calls } = mockFetch([{ body: { data: [], meta: {} } }, { body: { data: [], meta: {} } }]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: fetchImpl, cache: { ttlMs: 60_000 } });
    await cms.content('articles').find();
    await cms.content('articles').find();
    expect(calls).toHaveLength(1);
    cms.cache.clear('articles');
    await cms.content('articles').find();
    expect(calls).toHaveLength(2);
  });

  it('retries rate-limited and failed reads, but never writes', async () => {
    const reads = mockFetch([{ status: 429, headers: { 'retry-after': '0' }, body: { error: { code: 'rate_limited', message: 'slow down' } } }, new TypeError('socket hang up'), { body: { data: [], meta: {} } }]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: reads.fetchImpl });
    await cms.content('articles').find();
    expect(reads.calls).toHaveLength(3);

    const writes = mockFetch([{ status: 503, body: { error: { code: 'internal_error', message: 'down' } } }]);
    const writer = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_rw_test', fetch: writes.fetchImpl });
    await expect(writer.content('articles').create({ title: 'x' })).rejects.toMatchObject({ status: 503, retryable: true });
    expect(writes.calls).toHaveLength(1);
  });

  it('iterates across pages with all()', async () => {
    const { fetchImpl, calls } = mockFetch([
      { body: { data: [{ id: '1' }, { id: '2' }], meta: { total: 3 } } },
      { body: { data: [{ id: '3' }], meta: { total: 3 } } },
    ]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: fetchImpl });
    const ids: string[] = [];
    for await (const entry of cms.content('articles').all({ limit: 2 })) ids.push(entry.id);
    expect(ids).toEqual(['1', '2', '3']);
    expect(calls[1].url).toContain('offset=2');
  });

  it('surfaces GraphQL errors and passes variables', async () => {
    const { fetchImpl, calls } = mockFetch([{ body: { data: { articles: { total: 2 } } } }, { body: { errors: [{ message: 'Cannot query field "nope"' }] } }]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: fetchImpl });
    expect(await cms.graphql<{ articles: { total: number } }>('query($l: Int){ articles(limit: $l){ total } }', { l: 5 })).toEqual({ articles: { total: 2 } });
    expect(JSON.parse(calls[0].init.body as string).variables).toEqual({ l: 5 });
    await expect(cms.graphql('{ nope }')).rejects.toThrow(/nope/);
  });

  it('refuses secret keys in a browser, and allows read-only keys there', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const { fetchImpl } = mockFetch([]);
    expect(() => createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_rw_secret', fetch: fetchImpl })).toThrow(/must not be used in browser code/);
    expect(() => createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_pv_secret', fetch: fetchImpl })).toThrow(/browser/);
    expect(() => createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_public', fetch: fetchImpl })).not.toThrow();
  });

  it('reads previews with the preview token instead of the API key', async () => {
    const { fetchImpl, calls } = mockFetch([{ body: { data: { id: '1', status: 'DRAFT' }, preview: true } }]);
    const cms = createCMSClient({ baseURL: 'https://cms.example.com', apiKey: 'mrd_ro_test', fetch: fetchImpl });
    const draft = await cms.preview('signed.preview.token');
    expect(draft.status).toBe('DRAFT');
    expect(calls[0].url).toBe('https://cms.example.com/api/v1/preview?token=signed.preview.token');
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });
});

describe('webhook verification', () => {
  const secret = 'whsec_test_secret';
  const body = JSON.stringify({ event: 'content.published', contentType: 'articles', documentId: '123' });
  const sign = (timestamp: string, payload = body, key = secret) => `sha256=${createHmac('sha256', key).update(`${timestamp}.${payload}`).digest('hex')}`;
  const now = () => String(Math.floor(Date.now() / 1000));

  it('accepts a correctly signed, recent delivery', async () => {
    const timestamp = now();
    expect(await verifyWebhookSignature({ payload: body, signature: sign(timestamp), timestamp, secret })).toBe(true);
  });

  it('rejects tampered bodies, wrong secrets, missing headers and replays', async () => {
    const timestamp = now();
    expect(await verifyWebhookSignature({ payload: body.replace('123', '999'), signature: sign(timestamp), timestamp, secret })).toBe(false);
    expect(await verifyWebhookSignature({ payload: body, signature: sign(timestamp, body, 'other'), timestamp, secret })).toBe(false);
    expect(await verifyWebhookSignature({ payload: body, signature: null, timestamp, secret })).toBe(false);
    expect(await verifyWebhookSignature({ payload: body, signature: sign(timestamp), timestamp: undefined, secret })).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(await verifyWebhookSignature({ payload: body, signature: sign(old), timestamp: old, secret })).toBe(false);
    expect(await verifyWebhookSignature({ payload: body, signature: sign(old), timestamp: old, secret, toleranceSeconds: 0 })).toBe(true);
  });

  it('parses a fetch Request and exposes the delivery id', async () => {
    const timestamp = now();
    const request = new Request('https://site.example/api/revalidate', {
      method: 'POST',
      body,
      headers: { 'x-meridian-signature': sign(timestamp), 'x-meridian-timestamp': timestamp, 'x-meridian-delivery': 'del-1', 'x-meridian-event': 'content.published' },
    });
    const parsed = await parseWebhook<{ contentType: string }>(request, secret);
    expect(parsed).toMatchObject({ deliveryId: 'del-1', eventName: 'content.published', event: { contentType: 'articles' } });
    const forged = new Request('https://site.example/api/revalidate', { method: 'POST', body, headers: { 'x-meridian-signature': 'sha256=00', 'x-meridian-timestamp': timestamp } });
    await expect(parseWebhook(forged, secret)).rejects.toThrow(/Invalid Meridian webhook signature/);
  });
});
