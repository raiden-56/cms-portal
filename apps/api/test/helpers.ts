import { createHmac } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createApp } from '../src/app';

// Last line of defence: integration tests write and truncate data, so they only ever run against the test schema.
if (!/[?&]schema=test\b/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Integration tests must run against the dedicated "test" schema. Check apps/api/.env.test.');
}

export const app = createApp();

let counter = 0;
export const unique = (prefix = 'x') => `${prefix}-${Date.now().toString(36)}-${(counter += 1)}`;

export const PASSWORD = 'correct-horse-battery-9';

export interface Session {
  token: string;
  userId: string;
  email: string;
  orgId: string;
  cookie: string;
}

/** Registers a brand-new user with their own organization. */
export async function register(name = 'Test User'): Promise<Session> {
  const email = `${unique('user')}@example.test`;
  const res = await request(app)
    .post('/admin/api/auth/register')
    .send({ name, email, password: PASSWORD, organizationName: unique('Org') })
    .expect(201);
  return {
    token: res.body.accessToken,
    userId: res.body.user.id,
    email,
    orgId: res.body.memberships[0].organization.id,
    cookie: (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0],
  };
}

export const as = (session: Session | string) => {
  const token = typeof session === 'string' ? session : session.token;
  const auth = <T extends request.Test>(t: T) => t.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string, body?: unknown) => auth(request(app).post(url)).send(body as object),
    put: (url: string, body?: unknown) => auth(request(app).put(url)).send(body as object),
    patch: (url: string, body?: unknown) => auth(request(app).patch(url)).send(body as object),
    delete: (url: string) => auth(request(app).delete(url)),
  };
};

export interface ProjectFixture {
  projectId: string;
  slug: string;
  env: Record<'development' | 'staging' | 'production', string>;
  /** Base path of the production environment's management routes. */
  base: string;
}

export async function createProject(session: Session, name = 'Website'): Promise<ProjectFixture> {
  const res = await as(session).post(`/admin/api/orgs/${session.orgId}/projects`, { name }).expect(201);
  const env = Object.fromEntries(res.body.environments.map((e: { key: string; id: string }) => [e.key, e.id])) as ProjectFixture['env'];
  return { projectId: res.body.id, slug: res.body.slug, env, base: `/admin/api/envs/${env.production}` };
}

export async function createToken(session: Session, project: ProjectFixture, type: 'READ_ONLY' | 'READ_WRITE' | 'PREVIEW' = 'READ_ONLY', environment: keyof ProjectFixture['env'] = 'production') {
  const res = await as(session)
    .post(`/admin/api/projects/${project.projectId}/tokens`, { name: `${type} token`, type, environmentId: project.env[environment] })
    .expect(201);
  return res.body.token as string;
}

export const ARTICLE_FIELDS = [
  { apiId: 'title', label: 'Title', type: 'text', required: true, config: { maxLength: 120 } },
  { apiId: 'slug', label: 'Slug', type: 'slug', unique: true, config: { sourceField: 'title' } },
  { apiId: 'body', label: 'Body', type: 'richtext', config: {} },
  { apiId: 'views', label: 'Views', type: 'integer', config: { min: 0 } },
  { apiId: 'category', label: 'Category', type: 'select', config: { options: [{ label: 'News', value: 'news' }, { label: 'Guides', value: 'guides' }] } },
  { apiId: 'internalNote', label: 'Internal note', type: 'text', config: { private: true } },
];

export async function createArticleType(session: Session, project: ProjectFixture, extra: Record<string, unknown> = {}) {
  const res = await as(session)
    .post(`${project.base}/content-types`, {
      apiId: 'articles',
      displayName: 'Articles',
      singularName: 'Article',
      pluralName: 'Articles',
      options: { titleField: 'title' },
      fields: ARTICLE_FIELDS,
      ...extra,
    })
    .expect(201);
  return res.body as { id: string; apiId: string; fields: { id: string; apiId: string; label: string; type: string; required: boolean; unique: boolean; localized: boolean; config: Record<string, unknown> }[] };
}

export interface ReceivedHook {
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: Record<string, unknown>;
}

/** A local HTTP endpoint that records webhook calls and can be told to fail. */
export async function webhookReceiver(opts: { failFirst?: number; status?: number } = {}) {
  const received: ReceivedHook[] = [];
  let failures = opts.failFirst ?? 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ headers: req.headers, body, json: JSON.parse(body || '{}') });
      if (failures > 0) {
        failures -= 1;
        res.writeHead(503).end('try later');
      } else {
        res.writeHead(opts.status ?? 200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function expectedSignature(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 8000, intervalMs = 40): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const richText = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
