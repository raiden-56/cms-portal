import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ProjectFixture, type Session, app, as, createProject, createToken, register } from './helpers';

describe('promoting a content model between environments', () => {
  let session: Session;
  let project: ProjectFixture;
  const dev = () => `/admin/api/envs/${project.env.development}`;
  const staging = () => `/admin/api/envs/${project.env.staging}`;
  const promote = (body: Record<string, unknown>) => as(session).post(`${dev()}/schema/promote`, { targetEnvironmentId: project.env.staging, ...body });

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
    await as(session)
      .post(`${dev()}/components`, { apiId: 'seo-meta', displayName: 'SEO', fields: [{ apiId: 'title', label: 'Title', type: 'text', config: {} }] })
      .expect(201);
    await as(session)
      .post(`${dev()}/content-types`, { apiId: 'authors', displayName: 'Authors', singularName: 'Author', pluralName: 'Authors', fields: [{ apiId: 'name', label: 'Name', type: 'text', required: true, config: {} }] })
      .expect(201);
    await as(session)
      .post(`${dev()}/content-types`, {
        apiId: 'articles',
        displayName: 'Articles',
        singularName: 'Article',
        pluralName: 'Articles',
        options: { requireApproval: true },
        fields: [
          { apiId: 'title', label: 'Title', type: 'text', required: true, config: {} },
          { apiId: 'subtitle', label: 'Subtitle', type: 'text', config: {} },
          { apiId: 'author', label: 'Author', type: 'relation', config: { targetType: 'authors' } },
          { apiId: 'seo', label: 'SEO', type: 'component', config: { component: 'seo-meta' } },
        ],
      })
      .expect(201);
  });

  it('previews by default and changes nothing', async () => {
    const preview = await promote({}).expect(200);
    expect(preview.body.applied).toBe(false);
    expect(preview.body.plan.items.map((i: { kind: string; apiId: string; action: string }) => `${i.kind}:${i.apiId}:${i.action}`).sort()).toEqual(['component:seo-meta:create', 'type:articles:create', 'type:authors:create']);
    const schema = await as(session).get(`${staging()}/schema`).expect(200);
    expect(schema.body.types.map((t: { apiId: string }) => t.apiId)).toEqual(['pages']);
  });

  it('creates the model in the target, including relations and components, without copying content', async () => {
    await as(session).post(`${dev()}/entries/authors`, { data: { name: 'Dev-only author' } }).expect(201);
    const applied = await promote({ dryRun: false }).expect(200);
    expect(applied.body.applied).toBe(true);

    const schema = await as(session).get(`${staging()}/schema`).expect(200);
    const articles = schema.body.types.find((t: { apiId: string }) => t.apiId === 'articles');
    expect(articles.options.requireApproval).toBe(true);
    expect(articles.fields.map((f: { apiId: string }) => f.apiId)).toEqual(['title', 'subtitle', 'author', 'seo']);
    expect(schema.body.components.map((c: { apiId: string }) => c.apiId)).toEqual(['seo-meta']);
    const authors = await as(session).get(`${staging()}/entries/authors`).expect(200);
    expect(authors.body.meta.total).toBe(0);

    // The promoted model is immediately usable through the staging delivery API.
    const token = await createToken(session, project, 'READ_ONLY', 'staging');
    const types = await request(app).get('/api/v1/content-types').set('Authorization', `Bearer ${token}`).expect(200);
    expect(types.body.data.map((t: { apiId: string }) => t.apiId)).toEqual(expect.arrayContaining(['articles', 'authors']));

    const again = await promote({ dryRun: false }).expect(200);
    expect(again.body.applied).toBe(false);
    expect(again.body.plan.items.every((i: { action: string }) => i.action === 'unchanged')).toBe(true);
  });

  it('protects content in the target: destructive differences need confirmation', async () => {
    // Staging gets real content using a field that development is about to remove.
    const entry = await as(session).post(`${staging()}/entries/articles`, { data: { title: 'Staging article', subtitle: 'Keep me?' } }).expect(201);
    const devArticles = await as(session).get(`${dev()}/content-types/articles`).expect(200);
    const next = [...devArticles.body.fields.filter((f: { apiId: string }) => f.apiId !== 'subtitle'), { apiId: 'summary', label: 'Summary', type: 'textarea', config: {} }];
    await as(session).put(`${dev()}/content-types/articles/fields`, { fields: next }).expect(200);

    const preview = await promote({}).expect(200);
    const item = preview.body.plan.items.find((i: { apiId: string }) => i.apiId === 'articles');
    expect(item.action).toBe('update');
    expect(item.changes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'removed', apiId: 'subtitle', affectedEntries: 1, destructive: true }), expect.objectContaining({ kind: 'added', apiId: 'summary' })]));
    expect(preview.body.plan.requiresConfirmation).toBe(true);

    await promote({ dryRun: false }).expect(409);
    const untouched = await as(session).get(`${staging()}/entry/${entry.body.id}`).expect(200);
    expect(untouched.body.data.subtitle).toBe('Keep me?');

    await promote({ dryRun: false, confirmDestructive: true }).expect(200);
    const migrated = await as(session).get(`${staging()}/entry/${entry.body.id}`).expect(200);
    expect(migrated.body.data).not.toHaveProperty('subtitle');
    expect(migrated.body.data.title).toBe('Staging article');
  });

  it('reports what exists only in the target and refuses foreign environments', async () => {
    await as(session).post(`${staging()}/content-types`, { apiId: 'banners', displayName: 'Banners', singularName: 'Banner', pluralName: 'Banners' }).expect(201);
    const preview = await promote({}).expect(200);
    expect(preview.body.plan.onlyInTarget).toEqual([{ kind: 'type', apiId: 'banners', displayName: 'Banners' }]);

    const other = await register();
    const foreign = await createProject(other);
    await promote({ targetEnvironmentId: foreign.env.production }).expect(404);
    await promote({ targetEnvironmentId: project.env.development }).expect(400);
  });
});
