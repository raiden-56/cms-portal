import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ProjectFixture, type Session, app, as, createArticleType, createProject, createToken, register } from './helpers';

type Field = { id?: string; apiId: string; label: string; type: string; required?: boolean; unique?: boolean; localized?: boolean; config: Record<string, unknown> };

describe('content modeling', () => {
  let session: Session;
  let project: ProjectFixture;
  let typeId: string;
  let fields: Field[];
  let readToken: string;

  const saveFields = (next: Field[], opts: { dryRun?: boolean; confirm?: boolean } = {}) =>
    as(session).put(`${project.base}/content-types/${typeId}/fields${opts.dryRun ? '?dryRun=true' : ''}`, { fields: next, confirmDestructive: !!opts.confirm });

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
    const type = await createArticleType(session, project);
    typeId = type.id;
    fields = type.fields;
    readToken = await createToken(session, project);
    for (const [title, views] of [['Alpha', 1], ['Beta', 2]] as const) {
      const entry = await as(session).post(`${project.base}/entries/articles`, { data: { title, views, category: 'news' } }).expect(201);
      await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);
    }
  });

  it('gives every environment a built-in page type and exposes the block library', async () => {
    const schema = await as(session).get(`${project.base}/schema`).expect(200);
    const pages = schema.body.types.find((t: { apiId: string }) => t.apiId === 'pages');
    expect(pages.isSystem).toBe(true);
    expect(schema.body.blocks.map((b: { type: string }) => b.type)).toEqual(expect.arrayContaining(['hero', 'text', 'faq', 'pricing', 'section', 'columns', 'html', 'json']));
    await as(session).put(`${project.base}/content-types/pages/fields`, { fields: [] }).expect(403);
    await as(session).delete(`${project.base}/content-types/pages`).expect(403);
  });

  it('validates content type and field definitions', async () => {
    const post = (body: Record<string, unknown>) =>
      as(session).post(`${project.base}/content-types`, { displayName: 'T', singularName: 'T', pluralName: 'Ts', ...body });
    await post({ apiId: 'articles' }).expect(409);
    await post({ apiId: 'graphql' }).expect(422);
    await post({ apiId: 'Bad Id' }).expect(422);
    const bad = await post({
      apiId: 'things',
      fields: [
        { apiId: 'id', label: 'Id', type: 'text', config: {} },
        { apiId: 'name', label: 'Name', type: 'text', config: { pattern: '([' } },
        { apiId: 'name', label: 'Name again', type: 'text', config: {} },
        { apiId: 'kind', label: 'Kind', type: 'select', config: {} },
        { apiId: 'owner', label: 'Owner', type: 'relation', config: { targetType: 'nowhere' } },
        { apiId: 'flag', label: 'Flag', type: 'boolean', unique: true, config: {} },
      ],
    }).expect(422);
    const messages = bad.body.error.details.map((d: { message: string }) => d.message).join(' | ');
    expect(messages).toMatch(/reserved/);
    expect(messages).toMatch(/regular expression/);
    expect(messages).toMatch(/more than one field/);
    expect(messages).toMatch(/at least one option/);
    expect(messages).toMatch(/does not exist/);
    expect(messages).toMatch(/cannot be unique/);
  });

  it('previews a schema change without applying it', async () => {
    const renamed = fields.map((f) => (f.apiId === 'views' ? { ...f, apiId: 'viewCount', label: 'View count' } : f));
    const plan = await saveFields(renamed, { dryRun: true }).expect(200);
    expect(plan.body.applied).toBe(false);
    expect(plan.body.plan.changes).toEqual([expect.objectContaining({ kind: 'renamed', from: 'views', to: 'viewCount', affectedEntries: 2 })]);
    const still = await as(session).get(`${project.base}/content-types/${typeId}`).expect(200);
    expect(still.body.fields.some((f: Field) => f.apiId === 'views')).toBe(true);
  });

  it('renames a field and migrates draft and published data, so nothing is lost', async () => {
    const renamed = fields.map((f) => (f.apiId === 'views' ? { ...f, apiId: 'viewCount', label: 'View count' } : f));
    const saved = await saveFields(renamed).expect(200);
    expect(saved.body.applied).toBe(true);
    fields = saved.body.type.fields;

    const list = await as(session).get(`${project.base}/entries/articles?sort=viewCount`).expect(200);
    expect(list.body.items.map((i: { data: Record<string, unknown> }) => i.data.viewCount)).toEqual([1, 2]);
    expect(list.body.items[0].data).not.toHaveProperty('views');

    // The delivery API reflects the new name immediately — including filters and sorting on it.
    const live = await request(app).get('/api/v1/articles?filter[viewCount][gte]=2').set('Authorization', `Bearer ${readToken}`).expect(200);
    expect(live.body.data).toHaveLength(1);
    expect(live.body.data[0]).toMatchObject({ title: 'Beta', viewCount: 2 });
    expect(live.body.data[0]).not.toHaveProperty('views');
    await request(app).get('/api/v1/articles?filter[views]=2').set('Authorization', `Bearer ${readToken}`).expect(400);
  });

  it('refuses destructive changes until they are confirmed, and reports their impact', async () => {
    const without = fields.filter((f) => f.apiId !== 'category');
    const refused = await saveFields(without).expect(409);
    expect(refused.body.error.details.plan.requiresConfirmation).toBe(true);
    expect(refused.body.error.details.plan.changes[0]).toMatchObject({ kind: 'removed', apiId: 'category', affectedEntries: 2, destructive: true });

    const incompatible = fields.map((f) => (f.apiId === 'title' ? { ...f, type: 'integer', config: {} } : f));
    const plan = await saveFields(incompatible, { dryRun: true }).expect(200);
    expect(plan.body.plan.changes[0]).toMatchObject({ kind: 'type_changed', from: 'text', to: 'integer', destructive: true });

    const confirmed = await saveFields(without, { confirm: true }).expect(200);
    fields = confirmed.body.type.fields;
    const entry = (await as(session).get(`${project.base}/entries/articles`).expect(200)).body.items[0];
    expect(entry.data).not.toHaveProperty('category');
    // History still holds the removed value.
    const versions = (await as(session).get(`${project.base}/entry/${entry.id}/versions`).expect(200)).body.items;
    const oldest = await as(session).get(`${project.base}/entry/${entry.id}/versions/${versions[versions.length - 1].id}`).expect(200);
    expect(oldest.body.data.category).toBe('news');
  });

  it('blocks a unique constraint that existing content would violate, and back-fills required defaults', async () => {
    await as(session).post(`${project.base}/entries/articles`, { data: { title: 'Gamma', viewCount: 2 } }).expect(201);
    const unique = fields.map((f) => (f.apiId === 'viewCount' ? { ...f, unique: true } : f));
    const blocked = await saveFields(unique).expect(422);
    expect(blocked.body.error.details[0].message).toMatch(/cannot be made unique/);

    const withRequired = [...fields, { apiId: 'audience', label: 'Audience', type: 'text', required: true, config: { defaultValue: 'everyone' } }];
    const saved = await saveFields(withRequired).expect(200);
    fields = saved.body.type.fields;
    const list = await as(session).get(`${project.base}/entries/articles`).expect(200);
    expect(list.body.items.every((i: { data: Record<string, unknown> }) => i.data.audience === 'everyone')).toBe(true);
  });

  it('records every schema change', async () => {
    const changes = await as(session).get(`${project.base}/schema/changes`).expect(200);
    expect(changes.body.meta.total).toBeGreaterThanOrEqual(4);
    expect(changes.body.items[0]).toHaveProperty('userName');
  });

  it('supports components, repeatable groups and dynamic zones, and guards against recursion', async () => {
    const cta = await as(session)
      .post(`${project.base}/components`, {
        apiId: 'cta-button',
        displayName: 'CTA button',
        isBlock: true,
        fields: [
          { apiId: 'label', label: 'Label', type: 'text', required: true, config: {} },
          { apiId: 'url', label: 'URL', type: 'url', required: true, config: {} },
        ],
      })
      .expect(201);
    const quote = await as(session)
      .post(`${project.base}/components`, { apiId: 'quote', displayName: 'Quote', fields: [{ apiId: 'text', label: 'Text', type: 'textarea', required: true, config: {} }] })
      .expect(201);

    // A component may not contain itself, directly or through another component.
    await as(session)
      .put(`${project.base}/components/${quote.body.id}/fields`, { fields: [...quote.body.fields, { apiId: 'nested', label: 'Nested', type: 'component', config: { component: 'quote' } }] })
      .expect(422);
    // Identifiers of component fields are immutable.
    await as(session)
      .put(`${project.base}/components/${cta.body.id}/fields`, { fields: cta.body.fields.map((f: Field) => (f.apiId === 'label' ? { ...f, apiId: 'text' } : f)) })
      .expect(422);

    const landing = await as(session)
      .post(`${project.base}/content-types`, {
        apiId: 'landing',
        displayName: 'Landing',
        singularName: 'Landing',
        pluralName: 'Landings',
        kind: 'SINGLE',
        fields: [
          { apiId: 'headline', label: 'Headline', type: 'text', required: true, config: {} },
          { apiId: 'primary', label: 'Primary button', type: 'component', config: { component: 'cta-button' } },
          { apiId: 'buttons', label: 'Buttons', type: 'repeatable', config: { component: 'cta-button', maxItems: 2 } },
          { apiId: 'sections', label: 'Sections', type: 'dynamiczone', config: { allowedComponents: ['quote'] } },
        ],
      })
      .expect(201);
    expect(landing.body.kind).toBe('SINGLE');

    const data = {
      headline: 'Welcome',
      primary: { label: 'Start', url: '/start' },
      buttons: [{ label: 'One', url: '/1' }, { label: 'Two', url: 'https://example.com/2' }],
      sections: [{ id: 's1', type: 'quote', props: { text: 'Great product' } }],
    };
    const entry = await as(session).post(`${project.base}/entries/landing`, { data }).expect(201);
    // Single types hold exactly one entry.
    await as(session).post(`${project.base}/entries/landing`, { data }).expect(409);

    const notAllowed = { ...data, sections: [{ id: 's2', type: 'cta-button', props: { label: 'x', url: '/x' } }] };
    const refused = await as(session).put(`${project.base}/entry/${entry.body.id}`, { data: notAllowed }).expect(422);
    expect(refused.body.error.details[0].code).toBe('component_not_allowed');

    // Publishing validates nested component fields.
    const broken = { ...data, buttons: [{ label: '', url: '/1' }] };
    await as(session).put(`${project.base}/entry/${entry.body.id}`, { data: broken }).expect(200);
    const invalid = await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(422);
    expect(invalid.body.error.details[0].path).toBe('buttons.0.label');

    await as(session).put(`${project.base}/entry/${entry.body.id}`, { data }).expect(200);
    await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);
    const live = await request(app).get('/api/v1/landing').set('Authorization', `Bearer ${readToken}`).expect(200);
    expect(live.body.data).toMatchObject({ headline: 'Welcome', primary: { label: 'Start', url: '/start' }, sections: [{ type: 'quote', props: { text: 'Great product' } }] });

    // A component in use cannot be deleted.
    await as(session).delete(`${project.base}/components/${cta.body.id}`).expect(409);
  });

  it('deletes a content type only with explicit confirmation when it has entries', async () => {
    const refused = await as(session).delete(`${project.base}/content-types/${typeId}`).expect(409);
    expect(refused.body.error.details.confirmWith).toBe('articles');
    await as(session).delete(`${project.base}/content-types/${typeId}?confirm=articles`).expect(204);
    await request(app).get('/api/v1/articles').set('Authorization', `Bearer ${readToken}`).expect(404);
  });
});
