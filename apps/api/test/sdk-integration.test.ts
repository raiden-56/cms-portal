import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createCMSClient, verifyWebhookSignature } from '../../../packages/sdk/src/index';
import { attachEventGateway, closeEventGateway } from '../src/modules/events/gateway';
import { startWebhookWorker, stopWebhooks } from '../src/modules/webhooks/webhooks.service';
import { type ProjectFixture, type Session, app, as, createArticleType, createProject, createToken, register, richText, waitFor } from './helpers';

/**
 * A connected application, end to end: it reads content through the SDK, caches it, and
 * refreshes when Meridian tells it something was published — first by webhook (the
 * Next.js revalidation pattern), then over WebSocket.
 */
describe('connected application using @meridian/sdk', () => {
  let session: Session;
  let project: ProjectFixture;
  let api: Server;
  let baseURL: string;
  let readKey: string;

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
    await createArticleType(session, project);
    readKey = await createToken(session, project, 'READ_ONLY');
    startWebhookWorker();
    api = createServer(app);
    attachEventGateway(api);
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await closeEventGateway();
    await stopWebhooks();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it('retrieves published content, pages and GraphQL data', async () => {
    const entry = await as(session).post(`${project.base}/entries/articles`, { data: { title: 'SDK article', views: 7, category: 'guides', body: richText('Hello from the SDK') } }).expect(201);
    await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);
    const page = await as(session).post(`${project.base}/entries/pages`, { data: { title: 'About', slug: 'about-us', blocks: [{ id: 'h', type: 'hero', props: { heading: 'About us' } }] } }).expect(201);
    await as(session).post(`${project.base}/entry/${page.body.id}/publish`, {}).expect(200);

    const cms = createCMSClient({ baseURL, apiKey: readKey });
    const list = await cms.content<{ title: string; views: number }>('articles').find({ filter: { views: { gte: 5 } }, sort: '-views', limit: 10, richtext: 'html' });
    expect(list.meta.total).toBe(1);
    expect(list.data[0]).toMatchObject({ title: 'SDK article', views: 7, body: '<p>Hello from the SDK</p>' });

    expect((await cms.content('articles').findOne('sdk-article'))?.id).toBe(entry.body.documentId);
    expect(await cms.content('articles').findOne('does-not-exist')).toBeNull();
    expect((await cms.pages.getBySlug('about-us'))?.blocks[0]).toMatchObject({ type: 'hero', props: { heading: 'About us' } });
    expect((await cms.pages.getByPath('/about-us'))?.title).toBe('About');
    expect((await cms.pages.list()).data).toHaveLength(1);

    const gql = await cms.graphql<{ articles: { total: number } }>('{ articles { total } }');
    expect(gql.articles.total).toBe(1);
    const types = await cms.contentTypes();
    expect(types.map((t) => t.apiId)).toEqual(expect.arrayContaining(['articles', 'pages']));
  });

  it('revalidates a connected frontend when content is published (webhook → verify → refetch)', async () => {
    const entry = await as(session).post(`${project.base}/entries/articles`, { data: { title: 'Homepage headline', views: 1 } }).expect(201);
    await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);

    // The "frontend": caches what it rendered for a long time, like a statically generated page.
    const cms = createCMSClient({ baseURL, apiKey: readKey, cache: { ttlMs: 60 * 60 * 1000 } });
    const render = async () => (await cms.content<{ title: string }>('articles').findOne(entry.body.documentId))?.title;
    let secret = '';
    const revalidations: string[] = [];
    const rejected: number[] = [];
    const frontend = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const payload = Buffer.concat(chunks).toString('utf8');
        const valid = await verifyWebhookSignature({
          payload,
          signature: req.headers['x-meridian-signature'] as string,
          timestamp: req.headers['x-meridian-timestamp'] as string,
          secret,
        });
        if (!valid) {
          rejected.push(401);
          res.writeHead(401).end();
          return;
        }
        const event = JSON.parse(payload) as { contentType: string };
        cms.cache.clear(event.contentType); // the equivalent of revalidateTag / revalidatePath
        revalidations.push(event.contentType);
        res.writeHead(200).end('{"revalidated":true}');
      });
    });
    await new Promise<void>((resolve) => frontend.listen(0, '127.0.0.1', resolve));
    const hookUrl = `http://127.0.0.1:${(frontend.address() as AddressInfo).port}/api/revalidate`;
    const hook = await as(session).post(`${project.base}/webhooks`, { name: 'Frontend revalidation', url: hookUrl, events: ['content.published', 'content.unpublished'] }).expect(201);
    secret = hook.body.secret;

    expect(await render()).toBe('Homepage headline');

    // An editor changes the headline and publishes.
    const current = await as(session).get(`${project.base}/entry/${entry.body.id}`).expect(200);
    await as(session).put(`${project.base}/entry/${entry.body.id}`, { data: { ...current.body.data, title: 'Homepage headline — new' }, lockVersion: current.body.lockVersion }).expect(200);
    // Until it is published (and the frontend is told), the site keeps showing what it had.
    expect(await render()).toBe('Homepage headline');
    await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);

    await waitFor(() => revalidations.length > 0);
    expect(rejected).toHaveLength(0);
    expect(revalidations).toEqual(['articles']);
    // No redeploy: the next render shows the new content.
    expect(await render()).toBe('Homepage headline — new');
    await new Promise<void>((resolve) => frontend.close(() => resolve()));
  });

  it('pushes live updates through subscribe()', async () => {
    const cms = createCMSClient({ baseURL, apiKey: readKey, cache: { ttlMs: 60 * 60 * 1000 } });
    const events: string[] = [];
    let status = '';
    const unsubscribe = cms.subscribe((event) => events.push(`${event.event}:${event.contentType}`), { WebSocket, onStatus: (s) => (status = s) });
    await waitFor(() => status === 'open');

    expect((await cms.content('articles').find()).meta.total).toBeGreaterThan(0);
    const before = (await cms.content('articles').find()).meta.total;
    const entry = await as(session).post(`${project.base}/entries/articles`, { data: { title: 'Pushed live' } }).expect(201);
    await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);

    await waitFor(() => events.includes('content.published:articles'));
    // The event cleared the SDK cache for that type, so the list is already up to date.
    expect((await cms.content('articles').find()).meta.total).toBe(before + 1);
    unsubscribe();
  });
});
