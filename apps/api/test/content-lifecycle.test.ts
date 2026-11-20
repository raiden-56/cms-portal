import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { runScheduledWork } from '../src/modules/scheduler/scheduler';
import { type ProjectFixture, type Session, app, as, createArticleType, createProject, createToken, register, richText } from './helpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('content lifecycle: draft → review → publish → deliver → update → restore', () => {
  let session: Session;
  let project: ProjectFixture;
  let readToken: string;
  let previewToken: string;
  let entryId: string;
  let documentId: string;

  beforeAll(async () => {
    session = await register('Editor in Chief');
    project = await createProject(session);
    await createArticleType(session, project, { options: { titleField: 'title', requireApproval: true } });
    readToken = await createToken(session, project, 'READ_ONLY');
    previewToken = await createToken(session, project, 'PREVIEW');
  });

  it('saves a draft that the public API cannot see', async () => {
    const created = await as(session)
      .post(`${project.base}/entries/articles`, { data: { title: 'Launch day', body: richText('We are live.'), views: 3, category: 'news', internalNote: 'embargo until 9am' } })
      .expect(201);
    entryId = created.body.id;
    documentId = created.body.documentId;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.slug).toBe('launch-day');
    expect(created.body.isPublished).toBe(false);

    const list = await request(app).get('/api/v1/articles').set(bearer(readToken)).expect(200);
    expect(list.body.data).toHaveLength(0);
    await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(404);
    await request(app).get('/api/v1/articles/launch-day').set(bearer(readToken)).expect(404);
    // A read-only token cannot ask for drafts, even explicitly.
    await request(app).get('/api/v1/articles?status=draft').set(bearer(readToken)).expect(403);
    const gql = await request(app).post('/api/v1/graphql').set(bearer(readToken)).send({ query: '{ articles { total } }' }).expect(200);
    expect(gql.body.data.articles.total).toBe(0);
  });

  it('accepts incomplete drafts but rejects wrongly typed values', async () => {
    const incomplete = await as(session).post(`${project.base}/entries/articles`, { data: { views: 1 } }).expect(201);
    expect(incomplete.body.data.title).toBeNull();
    const wrong = await as(session).post(`${project.base}/entries/articles`, { data: { title: 'x', views: 'many', category: 'sports' } }).expect(422);
    const paths = wrong.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['views', 'category']));
    // An incomplete draft cannot be submitted or published.
    const blocked = await as(session).post(`${project.base}/entry/${incomplete.body.id}/transition`, { action: 'submit' }).expect(422);
    expect(blocked.body.error.details[0].path).toBe('title');
    await as(session).delete(`${project.base}/entry/${incomplete.body.id}`).expect(204);
  });

  it('previews the draft with a preview API token and with a signed single-entry preview link', async () => {
    const drafts = await request(app).get('/api/v1/articles?status=draft').set(bearer(previewToken)).expect(200);
    expect(drafts.body.data.map((d: { title: string }) => d.title)).toContain('Launch day');
    expect(drafts.body.data[0].status).toBe('DRAFT');
    expect(drafts.headers['cache-control']).toContain('no-store');

    const link = await as(session).post(`${project.base}/entry/${entryId}/preview-token`, {}).expect(200);
    const preview = await request(app).get(`/api/v1/preview?token=${link.body.token}`).expect(200);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.data.title).toBe('Launch day');
    await request(app).get('/api/v1/preview?token=forged.token.value').expect(401);
  });

  it('requires approval before publishing when the content type demands it', async () => {
    const refused = await as(session).post(`${project.base}/entry/${entryId}/publish`, {}).expect(409);
    expect(refused.body.error.message).toMatch(/requires approval/i);

    const submitted = await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'submit' }).expect(200);
    expect(submitted.body.status).toBe('IN_REVIEW');
    await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'request_changes' }).expect(400);
    const changes = await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'request_changes', comment: 'Add a date' }).expect(200);
    expect(changes.body.status).toBe('CHANGES_REQUESTED');
    await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'submit' }).expect(200);
    const approved = await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'approve' }).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    // An invalid transition is refused.
    await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'approve' }).expect(409);

    const comments = await as(session).get(`${project.base}/entry/${entryId}/comments`).expect(200);
    expect(comments.body.items.map((c: { body: string; kind: string }) => `${c.kind}:${c.body}`)).toContain('changes_requested:Add a date');
  });

  it('publishes, and the content is immediately available through REST', async () => {
    const published = await as(session).post(`${project.base}/entry/${entryId}/publish`, { note: 'Go live' }).expect(200);
    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.isPublished).toBe(true);
    expect(published.body.hasChanges).toBe(false);

    const list = await request(app).get('/api/v1/articles?filter[category]=news&sort=-views&richtext=html').set(bearer(readToken)).expect(200);
    expect(list.body.meta.total).toBe(1);
    const item = list.body.data[0];
    expect(item).toMatchObject({ id: documentId, type: 'articles', title: 'Launch day', slug: 'launch-day', views: 3, body: '<p>We are live.</p>' });
    // Private fields and editorial status never appear in published responses.
    expect(item).not.toHaveProperty('internalNote');
    expect(item).not.toHaveProperty('status');

    const byId = await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(200);
    const bySlug = await request(app).get('/api/v1/articles/launch-day?fields=title').set(bearer(readToken)).expect(200);
    expect(byId.body.data.title).toBe('Launch day');
    expect(bySlug.body.data).toHaveProperty('title');
    expect(bySlug.body.data).not.toHaveProperty('views');
  });

  it('serves the same content through GraphQL', async () => {
    const res = await request(app)
      .post('/api/v1/graphql')
      .set(bearer(readToken))
      .send({
        query: 'query($slug: String) { article(slug: $slug) { id title views category } articles(filter: { views: { gte: 1 } }, sort: "-views") { total items { slug } } }',
        variables: { slug: 'launch-day' },
      })
      .expect(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.article).toEqual({ id: documentId, title: 'Launch day', views: 3, category: 'news' });
    expect(res.body.data.articles).toEqual({ total: 1, items: [{ slug: 'launch-day' }] });

    // Private fields are not part of the schema at all, and read-only tokens cannot mutate.
    const hidden = await request(app).post('/api/v1/graphql').set(bearer(readToken)).send({ query: '{ articles { items { internalNote } } }' }).expect(400);
    expect(hidden.body.errors[0].message).toMatch(/internalNote/);
    const mutation = await request(app).post('/api/v1/graphql').set(bearer(readToken)).send({ query: 'mutation { deleteArticle(id: "x") }' });
    expect([400, 403]).toContain(mutation.status);
    expect(mutation.body.data).toBeUndefined();
  });

  it('keeps serving the published version while a newer draft exists, then switches on republish', async () => {
    const current = await as(session).get(`${project.base}/entry/${entryId}`).expect(200);
    const edited = await as(session)
      .put(`${project.base}/entry/${entryId}`, { data: { ...current.body.data, title: 'Launch day — updated', views: 99 }, lockVersion: current.body.lockVersion })
      .expect(200);
    expect(edited.body.status).toBe('DRAFT');
    expect(edited.body.isPublished).toBe(true);
    expect(edited.body.hasChanges).toBe(true);

    const cachedBefore = await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(200);
    expect(cachedBefore.body.data.title).toBe('Launch day');

    // Approval covered the previous content, so the edit needs approving again.
    await as(session).post(`${project.base}/entry/${entryId}/publish`, {}).expect(409);
    await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'submit' }).expect(200);
    await as(session).post(`${project.base}/entry/${entryId}/transition`, { action: 'approve' }).expect(200);
    await as(session).post(`${project.base}/entry/${entryId}/publish`, {}).expect(200);

    // No redeploy, no waiting: the very next request returns the new version.
    const after = await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(200);
    expect(after.body.data).toMatchObject({ title: 'Launch day — updated', views: 99 });
    expect(after.headers['x-cache']).toBe('MISS');
    const again = await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(200);
    expect(again.headers['x-cache']).toBe('HIT');
    await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).set('If-None-Match', again.headers.etag).expect(304);
  });

  it('rejects a save based on a stale copy', async () => {
    const current = await as(session).get(`${project.base}/entry/${entryId}`).expect(200);
    const conflict = await as(session)
      .put(`${project.base}/entry/${entryId}`, { data: { ...current.body.data, title: 'Overwrite attempt' }, lockVersion: current.body.lockVersion - 1 })
      .expect(409);
    expect(conflict.body.error.details.currentLockVersion).toBe(current.body.lockVersion);
    const unchanged = await as(session).get(`${project.base}/entry/${entryId}`).expect(200);
    expect(unchanged.body.data.title).toBe('Launch day — updated');
  });

  it('keeps a full version history and restores a previous version', async () => {
    const versions = (await as(session).get(`${project.base}/entry/${entryId}/versions`).expect(200)).body.items as { id: string; number: number; kind: string; isPublished: boolean }[];
    expect(versions.filter((v) => v.kind === 'PUBLISH')).toHaveLength(2);
    expect(versions.filter((v) => v.isPublished)).toHaveLength(1);
    const first = versions.find((v) => v.number === 1) as { id: string };
    const firstData = await as(session).get(`${project.base}/entry/${entryId}/versions/${first.id}`).expect(200);
    expect(firstData.body.data.title).toBe('Launch day');

    const restored = await as(session).post(`${project.base}/entry/${entryId}/versions/${first.id}/restore`, {}).expect(200);
    expect(restored.body.data.title).toBe('Launch day');
    expect(restored.body.status).toBe('DRAFT');
    // Restoring changes the working copy only; the live site is unaffected until someone publishes.
    const live = await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(200);
    expect(live.body.data.title).toBe('Launch day — updated');
    const after = (await as(session).get(`${project.base}/entry/${entryId}/versions`).expect(200)).body.items as { kind: string }[];
    expect(after[0].kind).toBe('RESTORE');
  });

  it('coalesces autosaves instead of creating a version per keystroke', async () => {
    const before = (await as(session).get(`${project.base}/entry/${entryId}/versions`).expect(200)).body.items.length;
    let current = (await as(session).get(`${project.base}/entry/${entryId}`).expect(200)).body;
    for (const title of ['Auto 1', 'Auto 2', 'Auto 3']) {
      current = (await as(session).put(`${project.base}/entry/${entryId}`, { data: { ...current.data, title }, lockVersion: current.lockVersion, autosave: true }).expect(200)).body;
    }
    const after = (await as(session).get(`${project.base}/entry/${entryId}/versions`).expect(200)).body.items;
    expect(after.length).toBe(before + 1);
    expect(after[0].kind).toBe('AUTOSAVE');
    expect(current.data.title).toBe('Auto 3');
  });

  it('unpublishes, and the content disappears from the public API at once', async () => {
    await as(session).post(`${project.base}/entry/${entryId}/unpublish`, {}).expect(200);
    await request(app).get(`/api/v1/articles/${documentId}`).set(bearer(readToken)).expect(404);
    const list = await request(app).get('/api/v1/articles').set(bearer(readToken)).expect(200);
    expect(list.body.meta.total).toBe(0);
  });
});

describe('uniqueness, scheduling, releases and the write API', () => {
  let session: Session;
  let project: ProjectFixture;
  let readToken: string;

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
    await createArticleType(session, project);
    readToken = await createToken(session, project, 'READ_ONLY');
  });

  const make = async (title: string, extra: Record<string, unknown> = {}) =>
    (await as(session).post(`${project.base}/entries/articles`, { data: { title, ...extra } }).expect(201)).body as { id: string; documentId: string; lockVersion: number; data: Record<string, unknown> };

  it('treats a save with identical content as a no-op: no new version, still published', async () => {
    const created = await as(session)
      .post(`${project.base}/entries/articles`, { data: { title: 'Stable entry', views: 4, category: 'news', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body', marks: [{ type: 'bold' }] }] }] } } })
      .expect(201);
    const id = created.body.id as string;
    const published = await as(session).post(`${project.base}/entry/${id}/publish`, {}).expect(200);
    const versionsBefore = (await as(session).get(`${project.base}/entry/${id}/versions`).expect(200)).body.items.length;

    // The same content, sent back with every object's keys in a different order — as an editor would after a round trip.
    const reorder = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reorder)
        : value && typeof value === 'object'
          ? Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([k, v]) => [k, reorder(v)]))
          : value;
    for (const autosave of [true, false]) {
      const res = await as(session).put(`${project.base}/entry/${id}`, { data: reorder(published.body.data), lockVersion: published.body.lockVersion, autosave }).expect(200);
      expect(res.body.status).toBe('PUBLISHED');
      expect(res.body.hasChanges).toBe(false);
      expect(res.body.lockVersion).toBe(published.body.lockVersion);
    }
    const versionsAfter = (await as(session).get(`${project.base}/entry/${id}/versions`).expect(200)).body.items.length;
    expect(versionsAfter).toBe(versionsBefore);

    // A real change is still detected.
    const changed = await as(session).put(`${project.base}/entry/${id}`, { data: { ...published.body.data, views: 5 }, lockVersion: published.body.lockVersion }).expect(200);
    expect(changed.body).toMatchObject({ status: 'DRAFT', hasChanges: true, isPublished: true });
  });

  it('enforces unique fields', async () => {
    await make('Same title');
    const clash = await as(session).post(`${project.base}/entries/articles`, { data: { title: 'Same title' } }).expect(422);
    expect(clash.body.error.details[0]).toMatchObject({ path: 'slug', code: 'not_unique' });
  });

  it('publishes scheduled content when its time arrives, and unpublishes on schedule', async () => {
    const entry = await make('Scheduled piece');
    const publishAt = new Date(Date.now() + 60_000);
    const unpublishAt = new Date(Date.now() + 120_000);
    await as(session).post(`${project.base}/entry/${entry.id}/schedule`, { publishAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
    const scheduled = await as(session).post(`${project.base}/entry/${entry.id}/schedule`, { publishAt: publishAt.toISOString(), unpublishAt: unpublishAt.toISOString() }).expect(200);
    expect(scheduled.body.status).toBe('SCHEDULED');

    // Not due yet: nothing happens and nothing is public.
    expect((await runScheduledWork(new Date())).published).toBe(0);
    await request(app).get(`/api/v1/articles/${entry.documentId}`).set(bearer(readToken)).expect(404);

    expect((await runScheduledWork(new Date(publishAt.getTime() + 1000))).published).toBe(1);
    const live = await request(app).get(`/api/v1/articles/${entry.documentId}`).set(bearer(readToken)).expect(200);
    expect(live.body.data.title).toBe('Scheduled piece');

    expect((await runScheduledWork(new Date(unpublishAt.getTime() + 1000))).unpublished).toBe(1);
    await request(app).get(`/api/v1/articles/${entry.documentId}`).set(bearer(readToken)).expect(404);
  });

  it('publishes a release atomically: all items go live together, or none do', async () => {
    const good = await make('Release item A');
    const alsoGood = await make('Release item B');
    const broken = (await as(session).post(`${project.base}/entries/articles`, { data: { views: 1 } }).expect(201)).body as { id: string };

    const release = (await as(session).post(`${project.base}/releases`, { name: 'Website redesign' }).expect(201)).body as { id: string };
    await as(session).post(`${project.base}/releases/${release.id}/items`, { entryIds: [good.id, alsoGood.id, broken.id] }).expect(201);

    const check = await as(session).get(`${project.base}/releases/${release.id}/validate`).expect(200);
    expect(check.body.ready).toBe(false);
    expect(check.body.checks.filter((c: { ok: boolean }) => !c.ok)).toHaveLength(1);

    // One invalid item fails the whole release and nothing is published.
    await as(session).post(`${project.base}/releases/${release.id}/publish`, {}).expect(422);
    await request(app).get(`/api/v1/articles/${good.documentId}`).set(bearer(readToken)).expect(404);
    const failed = await as(session).get(`${project.base}/releases/${release.id}`).expect(200);
    expect(failed.body.status).toBe('OPEN');
    expect(failed.body.error).toBeTruthy();

    const item = failed.body.items.find((i: { entryId: string }) => i.entryId === broken.id);
    await as(session).delete(`${project.base}/releases/${release.id}/items/${item.id}`).expect(200);
    const done = await as(session).post(`${project.base}/releases/${release.id}/publish`, {}).expect(200);
    expect(done.body.status).toBe('PUBLISHED');
    const list = await request(app).get('/api/v1/articles?sort=title').set(bearer(readToken)).expect(200);
    expect(list.body.data.map((d: { title: string }) => d.title)).toEqual(expect.arrayContaining(['Release item A', 'Release item B']));
    await as(session).post(`${project.base}/releases/${release.id}/publish`, {}).expect(409);
  });

  it('lets read/write tokens create, update, publish and delete, and refuses read-only tokens', async () => {
    const writeToken = await createToken(session, project, 'READ_WRITE');
    await request(app).post('/api/v1/articles').set(bearer(readToken)).send({ data: { title: 'Nope' } }).expect(403);

    const created = await request(app).post('/api/v1/articles').set(bearer(writeToken)).send({ data: { title: 'Via API', views: 1 }, publish: true }).expect(201);
    const id = created.body.data.id as string;
    expect(created.body.data.status).toBe('PUBLISHED');
    await request(app).get(`/api/v1/articles/${id}`).set(bearer(readToken)).expect(200);

    const patched = await request(app).patch(`/api/v1/articles/${id}`).set(bearer(writeToken)).send({ data: { views: 42 }, publish: true }).expect(200);
    expect(patched.body.data).toMatchObject({ title: 'Via API', views: 42 });

    const bad = await request(app).post('/api/v1/articles').set(bearer(writeToken)).send({ data: { title: 'Bad', views: -5 }, publish: true }).expect(422);
    expect(bad.body.error.details[0].path).toBe('views');

    const gql = await request(app)
      .post('/api/v1/graphql')
      .set(bearer(writeToken))
      .send({ query: 'mutation($d: JSON!) { createArticle(data: $d, publish: true) { id title status } }', variables: { d: { title: 'Via GraphQL' } } })
      .expect(200);
    expect(gql.body.data.createArticle).toMatchObject({ title: 'Via GraphQL', status: 'PUBLISHED' });

    await request(app).delete(`/api/v1/articles/${id}`).set(bearer(writeToken)).expect(204);
    await request(app).get(`/api/v1/articles/${id}`).set(bearer(readToken)).expect(404);
    // Read/write tokens are secrets and are refused from a browser origin.
    await request(app).get('/api/v1/articles').set(bearer(writeToken)).set('Origin', 'https://evil.example').expect(403);
  });

  it('handles tokens: unknown, revoked, rotated and rate limited', async () => {
    await request(app).get('/api/v1/articles').expect(401);
    await request(app).get('/api/v1/articles').set(bearer('mrd_ro_not-a-real-token')).expect(401);

    const created = await as(session)
      .post(`/admin/api/projects/${project.projectId}/tokens`, { name: 'Tiny limit', type: 'READ_ONLY', environmentId: project.env.production, rateLimitPerMinute: 2 })
      .expect(201);
    const listed = await as(session).get(`/admin/api/projects/${project.projectId}/tokens`).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(created.body.token);

    await request(app).get('/api/v1/articles').set(bearer(created.body.token)).expect(200);
    await request(app).get('/api/v1/articles').set(bearer(created.body.token)).expect(200);
    const limited = await request(app).get('/api/v1/articles').set(bearer(created.body.token)).expect(429);
    expect(limited.headers['retry-after']).toBeTruthy();

    const rotated = await as(session).post(`/admin/api/projects/${project.projectId}/tokens/${created.body.id}/rotate`, {}).expect(200);
    await request(app).get('/api/v1/content-types').set(bearer(created.body.token)).expect(401);
    expect(rotated.body.token).not.toBe(created.body.token);

    await as(session).delete(`/admin/api/projects/${project.projectId}/tokens/${created.body.id}`).expect(204);
    const revoked = await request(app).get('/api/v1/articles').set(bearer(rotated.body.token)).expect(401);
    expect(revoked.body.error.message).toMatch(/revoked/);
  });

  it('keeps environments separate: content published in production is not in staging', async () => {
    const stagingToken = await createToken(session, project, 'READ_ONLY', 'staging');
    // Staging has its own schema; the production content type does not exist there.
    await request(app).get('/api/v1/articles').set(bearer(stagingToken)).expect(404);
    const types = await request(app).get('/api/v1/content-types').set(bearer(stagingToken)).expect(200);
    expect(types.body.data.map((t: { apiId: string }) => t.apiId)).toEqual(['pages']);
  });
});
