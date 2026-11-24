import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiToken, ContentType, EntryDetail, MediaAsset, Member, Project, Release, Role, SchemaPlan } from '@/lib/types';
import { setClockOffset } from './db';
import { MAX_UPLOAD_BYTES, type DemoResponse, delivery, persistence, request, resetDemo, startSession, upload } from './index';
import { pngImage } from './samples';

/** A management request that must succeed. */
async function ok<T>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
  const res = await request({ method, path, body, query });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

const errorOf = (res: DemoResponse) => (res.body as { error: { code: string; message: string; details?: any } }).error;

interface World {
  orgId: string;
  project: Project;
  env: string;
  proj: string;
}

async function world(): Promise<World> {
  const session = await startSession();
  const orgId = session.memberships[0].organization.id;
  const { items } = await ok<{ items: Project[] }>('GET', `/orgs/${orgId}/projects`);
  const project = items[0];
  const production = project.environments.find((e) => e.key === 'production');
  return { orgId, project, env: `/envs/${production?.id}`, proj: `/projects/${project.id}` };
}

const key = async (w: World, type: 'READ_ONLY' | 'READ_WRITE' = 'READ_ONLY') =>
  (await ok<ApiToken>('POST', `${w.proj}/tokens`, { name: `Test ${type}`, type, environmentId: w.project.environments.find((e) => e.key === 'production')?.id })).token as string;

const list = async (w: World, type: string, query?: Record<string, string>) => (await ok<{ items: EntryDetail[]; meta: { total: number } }>('GET', `${w.env}/entries/${type}`, undefined, query)).items;

const DAY = 86_400_000;

beforeEach(async () => {
  await resetDemo();
});

afterEach(() => setClockOffset(0));

describe('demo data', () => {
  it('starts a guest session as the organization administrator of a seeded workspace', async () => {
    const session = await startSession();
    expect(session.user.name).toBe('Guest');
    expect(session.memberships[0].role.key).toBe('org_admin');
    expect(session.memberships[0].permissions).toContain('org.manage');
    // jsdom has no IndexedDB: the backend must fall back to memory instead of failing.
    expect(persistence()).toBe('memory');

    const w = await world();
    expect(w.project.name).toBe('Acme Website');
    expect(w.project.environments.map((e) => e.key)).toEqual(['development', 'staging', 'production']);
    expect(w.project.locales.map((l) => l.code)).toEqual(['en', 'fr']);

    const schema = await ok<{ types: ContentType[]; components: unknown[] }>('GET', `${w.env}/schema`);
    expect(schema.types.map((t) => t.apiId)).toEqual(expect.arrayContaining(['pages', 'articles', 'authors', 'products', 'site-settings']));
    expect(schema.components).toHaveLength(4);

    const articles = await list(w, 'articles', { pageSize: '100', locale: 'en' });
    const states = new Set(articles.map((a) => (a.isPublished && a.hasChanges ? 'MODIFIED' : a.status)));
    expect([...states]).toEqual(expect.arrayContaining(['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'MODIFIED', 'ARCHIVED']));
    expect(await list(w, 'articles', { trash: 'true' })).toHaveLength(1);

    const dashboard = await ok<{ counts: { entries: number; pages: number; mediaAssets: number }; apiUsage: unknown[] }>('GET', `${w.env}/dashboard`);
    expect(dashboard.counts.entries).toBeGreaterThanOrEqual(20);
    expect(dashboard.counts.pages).toBe(6);
    expect(dashboard.counts.mediaAssets).toBeGreaterThanOrEqual(12);
    const analytics = await ok<{ usage: { requests: number }[] }>('GET', `${w.env}/analytics`, undefined, { days: '30' });
    expect(analytics.usage).toHaveLength(30);
    expect(analytics.usage.every((d) => d.requests > 0)).toBe(true);
  });

  it('records every mutating action in the audit log and restores the seed on reset', async () => {
    const w = await world();
    const before = (await ok<{ meta: { total: number } }>('GET', `/orgs/${w.orgId}/audit-logs`)).meta.total;
    await ok('POST', `/orgs/${w.orgId}/projects`, { name: 'Second site' });
    const after = await ok<{ items: { action: string; actorLabel: string }[]; meta: { total: number } }>('GET', `/orgs/${w.orgId}/audit-logs`);
    expect(after.meta.total).toBe(before + 1);
    expect(after.items[0]).toMatchObject({ action: 'project.created', actorLabel: 'Guest' });

    const csv = await request({ method: 'GET', path: `/orgs/${w.orgId}/audit-logs`, query: { format: 'csv' } });
    expect(csv.headers['content-disposition']).toMatch(/audit-log-.*\.csv/);
    expect(String(csv.body).split('\r\n')[0]).toBe('timestamp,actor,actorType,action,resourceType,resourceId,resource,projectId,environmentId,ip,before,after');

    await resetDemo();
    const fresh = await world();
    expect((await ok<{ items: Project[] }>('GET', `/orgs/${fresh.orgId}/projects`)).items).toHaveLength(1);
  });
});

describe('content', () => {
  it('models a type, creates and publishes an entry, and delivers only published, public content', async () => {
    const w = await world();
    const type = await ok<ContentType>('POST', `${w.env}/content-types`, { apiId: 'workshops', displayName: 'Workshops', singularName: 'Workshop', pluralName: 'Workshops', options: {}, fields: [] });
    const fields = [
      { apiId: 'name', label: 'Name', type: 'text', required: true, config: {} },
      { apiId: 'slug', label: 'Slug', type: 'slug', unique: true, config: { sourceField: 'name' } },
      { apiId: 'seats', label: 'Seats', type: 'integer', config: { min: 1 } },
      { apiId: 'internalNotes', label: 'Internal notes', type: 'textarea', config: { private: true } },
    ];
    const applied = await ok<{ applied: boolean; plan: SchemaPlan }>('PUT', `${w.env}/content-types/${type.id}/fields`, { fields, confirmDestructive: false });
    expect(applied.applied).toBe(true);
    expect(applied.plan.changes.map((c) => c.kind)).toEqual(['added', 'added', 'added', 'added']);

    // A draft may be incomplete; publishing it reports the missing field by path.
    const draft = await ok<EntryDetail>('POST', `${w.env}/entries/workshops`, { data: { seats: 40, internalNotes: 'Venue not confirmed' } });
    const refused = await request({ method: 'POST', path: `${w.env}/entry/${draft.id}/publish`, body: {} });
    expect(refused.status).toBe(422);
    expect(errorOf(refused).details).toEqual([expect.objectContaining({ path: 'name', code: 'required' })]);

    const saved = await ok<EntryDetail>('PUT', `${w.env}/entry/${draft.id}`, { data: { ...draft.data, name: 'Spring open studio' }, lockVersion: draft.lockVersion });
    expect(saved.slug).toBe('spring-open-studio');
    const token = await key(w);
    expect(((await delivery('/workshops', token)).body as { data: unknown[] }).data).toEqual([]);

    const published = await ok<EntryDetail>('POST', `${w.env}/entry/${draft.id}/publish`, {});
    expect(published).toMatchObject({ status: 'PUBLISHED', isPublished: true, hasChanges: false });

    const listed = await delivery('/workshops?sort=-seats&filter[seats][gte]=10', token);
    expect(listed.status).toBe(200);
    const [event] = (listed.body as { data: Record<string, unknown>[]; meta: { total: number } }).data;
    expect(event).toMatchObject({ id: draft.documentId, type: 'workshops', name: 'Spring open studio', seats: 40 });
    expect(event).not.toHaveProperty('internalNotes');
    expect(((await delivery('/workshops/spring-open-studio', token)).body as { data: { id: string } }).data.id).toBe(draft.documentId);

    // Editing a live entry does not change what is delivered until it is published again.
    await ok('PUT', `${w.env}/entry/${draft.id}`, { data: { ...saved.data, name: 'Renamed' }, lockVersion: published.lockVersion });
    expect(((await delivery(`/workshops/${draft.documentId}`, token)).body as { data: { name: string } }).data.name).toBe('Spring open studio');

    // A second entry with the same unique slug is refused on that field.
    const clash = await request({ method: 'POST', path: `${w.env}/entries/workshops`, body: { data: { name: 'Other', slug: 'spring-open-studio' } } });
    expect(clash.status).toBe(422);
    expect(errorOf(clash).details[0]).toMatchObject({ path: 'slug', code: 'not_unique' });
  });

  it('serves seeded content through the delivery API: pages by path, locales, populate, field selection', async () => {
    const w = await world();
    const token = await key(w);

    const home = (await delivery('/pages?path=/', token)).body as { data: { title: string; blocks: { type: string; children?: { type: string; children?: unknown[] }[] }[] } };
    expect(home.data.title).toBe('Home');
    const section = home.data.blocks.find((b) => b.type === 'section');
    expect(section?.children?.[0]).toMatchObject({ type: 'columns' });
    expect(section?.children?.[0].children).toHaveLength(2);
    // Scheduled and draft pages are not delivered.
    expect((await delivery('/pages?path=/about/careers', token)).status).toBe(404);
    expect((await delivery('/pages?path=/pricing', token)).status).toBe(404);

    const articles = (await delivery('/articles?populate=author&fields=title,author&sort=title', token)).body as { data: { title: string; author: { name: string } | null; excerpt?: string }[]; meta: { total: number } };
    expect(articles.meta.total).toBe(3);
    expect(articles.data[0].author).toMatchObject({ name: 'Maya Okafor' });
    expect(articles.data[0]).not.toHaveProperty('excerpt');
    // The "(updated)" headline is an unpublished edit, so the live title is still the old one.
    expect(articles.data.map((a) => a.title)).toContain('What we learned shipping a faster homepage');

    const french = (await delivery('/articles?locale=fr', token)).body as { data: { title: string; locale: string }[] };
    expect(french.data).toEqual([expect.objectContaining({ locale: 'fr', title: 'Des design systems qui résistent à la réalité' })]);

    expect((await delivery('/articles?status=draft', token)).status).toBe(403);
    expect((await delivery('/articles', 'mrd_ro_not-a-real-key')).status).toBe(401);
    const graphql = await delivery('/graphql', token, { method: 'POST', body: { query: '{ articles { items { title } } }' } });
    expect((graphql.body as { errors: { message: string }[]; data?: unknown }).errors[0].message).toMatch(/not available in guest mode/);
    expect(graphql.body).not.toHaveProperty('data');

    const tokens = await ok<{ items: ApiToken[] }>('GET', `${w.proj}/tokens`);
    expect(tokens.items.find((t) => t.name === 'Test READ_ONLY')?.requests7d).toBeGreaterThan(5);
  });

  it('requires approval before publishing a type that enforces it', async () => {
    const w = await world();
    const [draft] = (await list(w, 'articles', { status: 'DRAFT', search: 'Notes on the next release' })) as EntryDetail[];
    const base = `${w.env}/entry/${draft.id}`;

    const refused = await request({ method: 'POST', path: `${base}/publish`, body: {} });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).message).toMatch(/requires approval before publishing/);

    expect((await ok<EntryDetail>('POST', `${base}/transition`, { action: 'submit' })).status).toBe('IN_REVIEW');
    expect((await request({ method: 'POST', path: `${base}/transition`, body: { action: 'request_changes' } })).status).toBe(400);
    expect((await ok<EntryDetail>('POST', `${base}/transition`, { action: 'approve', comment: 'Good to go' })).status).toBe('APPROVED');
    const live = await ok<EntryDetail>('POST', `${base}/publish`, {});
    expect(live.status).toBe('PUBLISHED');

    // Editing approved or published content sends it back to draft: approval covers exact content.
    const edited = await ok<EntryDetail>('PUT', base, { data: { ...live.data, excerpt: 'Changed after approval' }, lockVersion: live.lockVersion });
    expect(edited).toMatchObject({ status: 'DRAFT', isPublished: true, hasChanges: true });
    expect((await request({ method: 'POST', path: `${base}/publish`, body: {} })).status).toBe(409);

    const comments = await ok<{ items: { kind: string; body: string }[] }>('GET', `${base}/comments`);
    expect(comments.items).toEqual([expect.objectContaining({ kind: 'approval', body: 'Good to go' })]);
  });

  it('refuses a save made from a stale copy and keeps versions that can be restored', async () => {
    const w = await world();
    const [faq] = (await list(w, 'faqs', { search: 'return' })) as EntryDetail[];
    const base = `${w.env}/entry/${faq.id}`;
    const opened = await ok<EntryDetail>('GET', base);

    const first = await ok<EntryDetail>('PUT', base, { data: { ...opened.data, answer: 'Returns are free within 60 days.' }, lockVersion: opened.lockVersion });
    expect(first.lockVersion).toBe(opened.lockVersion + 1);

    const stale = await request({ method: 'PUT', path: base, body: { data: { ...opened.data, answer: 'A conflicting edit' }, lockVersion: opened.lockVersion } });
    expect(stale.status).toBe(409);
    expect(errorOf(stale).details).toMatchObject({ currentLockVersion: first.lockVersion, updatedBy: 'Guest' });
    expect((await ok<EntryDetail>('GET', base)).data.answer).toBe('Returns are free within 60 days.');

    const versions = await ok<{ items: { id: string; number: number; kind: string }[] }>('GET', `${base}/versions`);
    expect(versions.items[0]).toMatchObject({ kind: 'SAVE', number: 3 });
    const original = versions.items.find((v) => v.number === 1);
    const restored = await ok<EntryDetail>('POST', `${base}/versions/${original?.id}/restore`, {});
    expect(restored.data.answer).toBe('Returns are free within 30 days of delivery.');
    expect(restored.versionCount).toBe(4);
  });

  it('asks for confirmation before a schema change that discards stored values', async () => {
    const w = await world();
    const schema = await ok<{ types: ContentType[] }>('GET', `${w.env}/schema`);
    const products = schema.types.find((t) => t.apiId === 'products') as ContentType;
    const endpoint = `${w.env}/content-types/${products.id}/fields`;
    const withoutPrice = products.fields.filter((f) => f.apiId !== 'price');

    const preview = await ok<{ plan: SchemaPlan; applied: boolean }>('PUT', endpoint, { fields: withoutPrice, confirmDestructive: false }, { dryRun: 'true' });
    expect(preview.applied).toBe(false);
    expect(preview.plan.requiresConfirmation).toBe(true);
    expect(preview.plan.changes).toEqual([expect.objectContaining({ kind: 'removed', apiId: 'price', destructive: true, affectedEntries: 4 })]);

    const refused = await request({ method: 'PUT', path: endpoint, body: { fields: withoutPrice, confirmDestructive: false } });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).details.plan.requiresConfirmation).toBe(true);
    expect((await list(w, 'products'))[0].data).toHaveProperty('price');

    await ok('PUT', endpoint, { fields: withoutPrice, confirmDestructive: true });
    expect((await list(w, 'products'))[0].data).not.toHaveProperty('price');

    // Renaming keeps the values; an invalid field set is rejected with the path of the problem.
    const current = (await ok<ContentType>('GET', `${w.env}/content-types/${products.id}`)).fields;
    const renamed = current.map((f) => (f.apiId === 'sku' ? { ...f, apiId: 'stockCode' } : f));
    const plan = await ok<{ plan: SchemaPlan }>('PUT', endpoint, { fields: renamed, confirmDestructive: false });
    expect(plan.plan.changes).toEqual([expect.objectContaining({ kind: 'renamed', from: 'sku', to: 'stockCode' })]);
    expect((await list(w, 'products')).map((p) => p.data.stockCode)).toContain('NB-0001');
    const invalid = await request({ method: 'PUT', path: endpoint, body: { fields: [...renamed, { apiId: 'id', label: 'Id', type: 'text', config: {} }] } });
    expect(invalid.status).toBe(422);
    expect(errorOf(invalid).details[0].path).toBe(`fields.${renamed.length}.apiId`);
  });

  it('publishes a release as a whole or not at all', async () => {
    const w = await world();
    const { items } = await ok<{ items: Release[] }>('GET', `${w.env}/releases`);
    const launch = items.find((r) => r.name === 'Spring launch') as Release;
    const base = `${w.env}/releases/${launch.id}`;
    const [draft] = (await list(w, 'articles', { status: 'DRAFT', search: 'Notes on the next release' })) as EntryDetail[];
    await ok('POST', `${base}/items`, { entryIds: [draft.id] });

    const validation = await ok<{ ready: boolean; checks: { ok: boolean; problems: string[] }[] }>('GET', `${base}/validate`);
    expect(validation.ready).toBe(false);
    expect(validation.checks.filter((c) => !c.ok)).toEqual([expect.objectContaining({ problems: ['Awaiting approval'] })]);

    const failed = await request({ method: 'POST', path: `${base}/publish`, body: {} });
    expect(failed.status).toBe(409);
    const afterFailure = await ok<Release>('GET', base);
    expect(afterFailure.status).toBe('OPEN');
    expect(afterFailure.error).toMatch(/requires approval/);
    expect(afterFailure.items?.every((i) => !i.isPublished)).toBe(true);

    const item = afterFailure.items?.find((i) => i.entryId === draft.id);
    await ok('DELETE', `${base}/items/${item?.id}`);
    const done = await ok<Release>('POST', `${base}/publish`, {});
    expect(done.status).toBe('PUBLISHED');
    expect(done.items?.every((i) => i.isPublished)).toBe(true);
  });
});

describe('pages, locales and schedules', () => {
  const page = (w: World, data: Record<string, unknown>, parentId?: string) => ok<EntryDetail>('POST', `${w.env}/entries/pages`, { data: { blocks: [], seo: {}, ...data }, parentId });
  const tree = async (w: World) => (await ok<{ items: { id: string; title: string; path: string; parentId: string | null }[] }>('GET', `${w.env}/pages/tree`)).items;

  it('derives page paths from the tree and keeps them right when pages move', async () => {
    const w = await world();
    const guides = await page(w, { title: 'Guides', slug: 'guides' });
    const care = await page(w, { title: 'Care', slug: 'care' }, guides.id);
    const leather = await page(w, { title: 'Leather', slug: 'leather' }, care.id);
    expect(leather.path).toBe('/guides/care/leather');

    // The same URL cannot be taken twice; the error names the slug field.
    const clash = await request({ method: 'POST', path: `${w.env}/entries/pages`, body: { data: { title: 'Care again', slug: 'care', blocks: [], seo: {} }, parentId: guides.id } });
    expect(clash.status).toBe(422);
    expect(errorOf(clash).details[0]).toMatchObject({ path: 'slug', code: 'not_unique' });

    // Renaming a parent re-paths every descendant; a page cannot move under its own child.
    await ok('PUT', `${w.env}/entry/${guides.id}`, { data: { ...guides.data, slug: 'how-to' }, lockVersion: guides.lockVersion });
    expect((await tree(w)).find((p) => p.id === leather.id)?.path).toBe('/how-to/care/leather');
    const current = await ok<EntryDetail>('GET', `${w.env}/entry/${guides.id}`);
    const loop = await request({ method: 'PUT', path: `${w.env}/entry/${guides.id}`, body: { data: current.data, lockVersion: current.lockVersion, parentId: leather.id } });
    expect(loop.status).toBe(400);

    const copy = await ok<EntryDetail>('POST', `${w.env}/entry/${care.id}/duplicate`);
    expect(copy).toMatchObject({ title: 'Care (copy)', parentId: guides.id, status: 'DRAFT' });
    expect(copy.path).toMatch(/^\/how-to\/care-copy-[0-9a-f]{6}$/);
    await ok('POST', `${w.env}/pages/reorder`, { parentId: guides.id, orderedIds: [copy.id, care.id] });
    expect((await tree(w)).filter((p) => p.parentId === guides.id).map((p) => p.title)).toEqual(['Care (copy)', 'Care']);

    const refused = await request({ method: 'DELETE', path: `${w.env}/entry/${care.id}` });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).message).toMatch(/has 1 child page/);
  });

  it('keeps one variant per locale and delivers the requested one with fallback', async () => {
    const w = await world();
    const [headless] = (await list(w, 'articles', { search: 'Going headless', locale: 'en' })) as EntryDetail[];
    const french = await ok<EntryDetail>('POST', `${w.env}/entries/articles`, { data: { ...headless.data, title: 'Passer au headless', slug: 'passer-au-headless' }, locale: 'fr', documentId: headless.documentId });
    expect(french.variants.map((v) => v.locale)).toEqual(['en', 'fr']);
    expect((await request({ method: 'POST', path: `${w.env}/entries/articles`, body: { data: headless.data, locale: 'fr', documentId: headless.documentId } })).status).toBe(409);
    // Products are not localized, so they cannot get a translation.
    const [product] = await list(w, 'products');
    expect((await request({ method: 'POST', path: `${w.env}/entries/products`, body: { data: product.data, locale: 'fr', documentId: product.documentId } })).status).toBe(400);

    // The French draft is not live, so a French reader still gets the English article by id.
    const token = await key(w);
    const byId = (await delivery(`/articles/${headless.documentId}?locale=fr`, token)).body as { data: { locale: string; title: string } };
    expect(byId.data).toMatchObject({ locale: 'en', title: 'Going headless without losing your editors' });

    const copy = await ok<EntryDetail>('POST', `${w.env}/entry/${headless.id}/duplicate`);
    expect(copy.title).toBe('Going headless without losing your editors (copy)');
    expect(copy.slug).toMatch(/^going-headless-without-losing-your-editors-copy-/);
    const members = (await ok<{ items: Member[] }>('GET', `/orgs/${w.orgId}/members`)).items;
    const reviewer = members.find((m) => m.role.key === 'reviewer') as Member;
    expect((await ok<EntryDetail>('PATCH', `${w.env}/entry/${copy.id}/assignee`, { assigneeId: reviewer.user.id })).assignee).toBe('Hannah Weiss');
  });

  it('publishes scheduled entries and releases once their time has come', async () => {
    const w = await world();
    const before = (await ok<{ items: { title: string }[] }>('GET', `${w.env}/scheduled`)).items;
    expect(before.map((e) => e.title).sort()).toEqual(['A first look at the spring collection', 'Careers']);
    const token = await key(w);
    expect((await delivery('/pages?path=/about/careers', token)).status).toBe(404);

    const launch = (await ok<{ items: Release[] }>('GET', `${w.env}/releases`)).items.find((r) => r.name === 'Spring launch') as Release;
    const scheduled = await ok<Release>('PATCH', `${w.env}/releases/${launch.id}`, { scheduledAt: new Date(Date.now() + 2 * DAY).toISOString() });
    expect(scheduled.status).toBe('SCHEDULED');

    // Six days later the next request finds all three due and publishes them as the scheduler.
    setClockOffset(6 * DAY);
    expect((await ok<{ items: unknown[] }>('GET', `${w.env}/scheduled`)).items).toEqual([]);
    expect((await delivery('/pages?path=/about/careers', token)).status).toBe(200);
    expect((await delivery('/pages?path=/pricing', token)).status).toBe(200);
    expect((await ok<Release>('GET', `${w.env}/releases/${launch.id}`)).status).toBe('PUBLISHED');
    const audit = await ok<{ items: { actorType: string; actorLabel: string }[] }>('GET', `/orgs/${w.orgId}/audit-logs`, undefined, { action: 'release.published' });
    expect(audit.items[0]).toMatchObject({ actorType: 'system', actorLabel: 'Scheduler' });
  });

  it('imports entries, reporting each invalid one, and reads a draft with a preview token', async () => {
    const w = await world();
    const result = await ok<{ imported: number; failed: number; results: { ok: boolean; error?: string }[] }>('POST', `${w.env}/entries/faqs/import`, {
      items: [{ data: { question: 'Do you gift wrap?', answer: 'Yes, on request.' } }, { data: { question: 42 } }],
    });
    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(result.results[1].error).toBe('Some fields are invalid');

    const [draft] = (await list(w, 'faqs', { search: 'gift wrap' })) as EntryDetail[];
    const preview = await ok<{ token: string; apiUrl: string }>('POST', `${w.env}/entry/${draft.id}/preview-token`, {});
    expect(preview.apiUrl).toContain(`/api/v1/preview?token=${preview.token}`);
    const seen = await delivery(`/preview?token=${preview.token}`, '');
    expect(seen.body).toMatchObject({ preview: true, data: { question: 'Do you gift wrap?', status: 'DRAFT' } });
    expect((await delivery('/preview?token=made-up', '')).status).toBe(401);
    setClockOffset(2 * 3_600_000);
    expect((await delivery(`/preview?token=${preview.token}`, '')).status).toBe(401);
  });

  it('lets a read/write key change content only from an allowed origin, and undoes a write that fails', async () => {
    const w = await world();
    const environmentId = w.project.environments.find((e) => e.key === 'production')?.id;
    const loose = await ok<ApiToken>('POST', `${w.proj}/tokens`, { name: 'Server key', type: 'READ_WRITE', environmentId });
    // A server-side secret used from a browser origin that was not allowed is refused, as the API refuses it.
    expect((await delivery('/faqs', loose.token as string)).status).toBe(403);

    const bound = await ok<ApiToken>('POST', `${w.proj}/tokens`, { name: 'Explorer key', type: 'READ_WRITE', environmentId, allowedOrigins: [window.location.origin] });
    const secret = bound.token as string;
    const made = await delivery('/faqs', secret, { method: 'POST', body: { data: { question: 'Is there a warranty?', answer: 'Two years.' }, publish: true } });
    expect(made.status).toBe(201);
    const id = (made.body as { data: { id: string } }).data.id;
    expect(((await delivery('/faqs?search=warranty', secret)).body as { meta: { total: number } }).meta.total).toBe(1);

    // Creating succeeds but publishing fails (no answer): the whole request is undone.
    const count = async () => (await list(w, 'faqs', { pageSize: '100' })).length;
    const total = await count();
    const failed = await delivery('/faqs', secret, { method: 'POST', body: { data: { question: 'Half an entry' }, publish: true } });
    expect(failed.status).toBe(422);
    expect(await count()).toBe(total);

    const rotated = await ok<ApiToken>('POST', `${w.proj}/tokens/${bound.id}/rotate`);
    expect((await delivery(`/faqs/${id}`, secret)).status).toBe(401);
    expect((await delivery(`/faqs/${id}`, rotated.token as string)).status).toBe(200);
  });
});

describe('media', () => {
  const formWith = (...files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return form;
  };
  const png = (name: string, shade: number) => new File([pngImage(name, 48, 32, [shade, 80, 60], [20, shade, 90]).bytes as BlobPart], name, { type: 'image/png' });

  it('stores an uploaded file in the browser, detects duplicates and rejects what the API would reject', async () => {
    const w = await world();
    const progress: number[] = [];
    const res = await upload(`${w.proj}/media`, formWith(png('team-photo.png', 200)), undefined, (f) => progress.push(f));
    expect(res.status).toBe(201);
    const [asset] = (res.body as { items: MediaAsset[] }).items;
    expect(asset).toMatchObject({ filename: 'team-photo.png', mimeType: 'image/png', kind: 'image', width: 48, height: 32, duplicate: false });
    expect(asset.url).toMatch(/^(blob:|data:image\/png;base64,)/);
    expect(progress.at(-1)).toBe(1);

    const again = await upload(`${w.proj}/media`, formWith(png('same-bytes.png', 200)), undefined);
    expect((again.body as { items: MediaAsset[] }).items[0]).toMatchObject({ id: asset.id, duplicate: true });

    // Content decides the type, not the file name.
    const disguised = await upload(`${w.proj}/media`, formWith(new File(['<html><script>alert(1)</script></html>'], 'page.txt', { type: 'text/plain' })), undefined);
    expect(disguised.status).toBe(400);
    expect((disguised.body as { errors: { message: string }[] }).errors[0].message).toMatch(/HTML and script files cannot be uploaded/);

    const huge = await upload(`${w.proj}/media`, formWith(new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'huge.png', { type: 'image/png' })), undefined);
    expect(huge.status).toBe(413);
    expect(errorOf(huge)).toMatchObject({ code: 'file_too_large', message: 'File exceeds the maximum upload size' });
  });

  it('stores a reference, not a local address, for a library image placed in rich text', async () => {
    const w = await world();
    const [asset] = (await ok<{ items: MediaAsset[] }>('GET', `${w.proj}/media`, undefined, { search: 'texture-paper' })).items;
    const [draft] = (await list(w, 'articles', { search: 'Notes on the next release' })) as EntryDetail[];
    const base = `${w.env}/entry/${draft.id}`;
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'With a picture.' }] }, { type: 'image', attrs: { src: `${asset.url}?w=960&format=webp`, alt: 'Paper', assetId: asset.id } }] };

    // The editor sends the address it displayed; the image must survive validation and come back addressable.
    const saved = await ok<EntryDetail>('PUT', base, { data: { ...draft.data, body }, lockVersion: draft.lockVersion });
    expect(saved.data.body.content[1].attrs).toMatchObject({ src: asset.url, assetId: asset.id });

    // Replacing the file changes its address; the stored reference follows it.
    const form = new FormData();
    form.append('file', png('texture-paper.png', 120));
    const replaced = (await upload(`${w.proj}/media/${asset.id}/replace`, form, undefined)).body as MediaAsset;
    expect(replaced.revision).toBe(2);
    expect(replaced.url).not.toBe(asset.url);
    expect((await ok<EntryDetail>('GET', base)).data.body.content[1].attrs.src).toBe(replaced.url);
  });

  it('tracks where a file is used and protects files that are in use', async () => {
    const w = await world();
    const { items } = await ok<{ items: MediaAsset[] }>('GET', `${w.proj}/media`, undefined, { search: 'hero-workspace' });
    const hero = await ok<MediaAsset>('GET', `${w.proj}/media/${items[0].id}`);
    expect(hero.usages?.map((u) => u.title)).toEqual(expect.arrayContaining(['Home', 'About']));

    const refused = await request({ method: 'DELETE', path: `${w.proj}/media/${hero.id}` });
    expect(refused.status).toBe(409);
    expect(errorOf(refused).details.usages.length).toBe(hero.usageCount);

    expect((await request({ method: 'DELETE', path: `${w.proj}/media/${hero.id}`, query: { force: 'true' } })).status).toBe(204);
    expect((await ok<{ items: MediaAsset[] }>('GET', `${w.proj}/media`, undefined, { trash: 'true' })).items.map((a) => a.filename)).toContain('hero-workspace.svg');
    await ok('POST', `${w.proj}/media/${hero.id}/restore`);
    const stats = await ok<{ maxUploadBytes: number; storageDriver: string }>('GET', `${w.proj}/media-stats`);
    expect(stats).toMatchObject({ maxUploadBytes: MAX_UPLOAD_BYTES, storageDriver: 'browser' });
  });
});

describe('administration', () => {
  it('keeps at least one administrator and says plainly what needs a server', async () => {
    const w = await world();
    const members = (await ok<{ items: Member[] }>('GET', `/orgs/${w.orgId}/members`)).items;
    const roles = (await ok<{ items: Role[] }>('GET', `/orgs/${w.orgId}/roles`)).items;
    const guest = members.find((m) => m.user.name === 'Guest') as Member;
    const viewer = roles.find((r) => r.key === 'viewer') as Role;

    const demote = await request({ method: 'PATCH', path: `/orgs/${w.orgId}/members/${guest.id}`, body: { roleId: viewer.id } });
    expect(demote.status).toBe(409);
    expect(errorOf(demote).message).toBe('An organization must keep at least one active administrator');
    expect((await request({ method: 'DELETE', path: `/orgs/${w.orgId}/members/${guest.id}` })).status).toBe(409);

    const author = members.find((m) => m.role.key === 'author') as Member;
    expect((await ok<{ role: { key: string } }>('PATCH', `/orgs/${w.orgId}/members/${author.id}`, { roleId: viewer.id })).role.key).toBe('viewer');

    // With a second administrator a server would let the guest step down; the demo keeps the guest in charge.
    const admin = roles.find((r) => r.key === 'org_admin') as Role;
    await ok('PATCH', `/orgs/${w.orgId}/members/${author.id}`, { roleId: admin.id });
    const suspend = await request({ method: 'PATCH', path: `/orgs/${w.orgId}/members/${guest.id}`, body: { status: 'SUSPENDED' } });
    expect(suspend.status).toBe(409);
    expect(errorOf(suspend).message).toMatch(/the guest stays an active administrator/);
    expect((await startSession()).memberships).toHaveLength(1);

    const renamed = await ok<{ user: { name: string } }>('PATCH', '/auth/me', { name: 'Curious Guest' });
    expect(renamed.user.name).toBe('Curious Guest');
    const password = await request({ method: 'POST', path: '/auth/me/password', body: { currentPassword: 'x', newPassword: 'y' } });
    expect(password.status).toBe(403);
    expect(errorOf(password)).toMatchObject({ code: 'guest_mode', message: expect.stringMatching(/not available in guest mode/) });
  });

  it('labels webhook deliveries as simulated', async () => {
    const w = await world();
    const hook = (await ok<{ items: { id: string; name: string }[] }>('GET', `${w.env}/webhooks`)).items.find((h) => h.name === 'Rebuild website');
    const base = `${w.env}/webhooks/${hook?.id}`;
    const test = await request({ method: 'POST', path: `${base}/test` });
    expect(test.status).toBe(202);
    const { items } = await ok<{ items: { id: string; event: string; responseStatus: number | null; responseBody: string; payload: Record<string, unknown> }[] }>('GET', `${base}/deliveries`);
    expect(items[0]).toMatchObject({ id: (test.body as { deliveryId: string }).deliveryId, event: 'ping', responseStatus: null, payload: { simulated: true } });
    expect(items[0].responseBody).toMatch(/Simulated in guest mode: no HTTP request left this browser/);
  });
});
