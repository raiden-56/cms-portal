import request from 'supertest';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { type ProjectFixture, type Session, app, as, createProject, createToken, register } from './helpers';

const png = (width: number, height: number, color: string) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();

describe('media library', () => {
  let session: Session;
  let project: ProjectFixture;
  let assetId: string;
  let assetUrl: string;

  const mediaBase = () => `/admin/api/projects/${project.projectId}`;
  const upload = (name: string, body: Buffer) =>
    request(app).post(`${mediaBase()}/media`).set('Authorization', `Bearer ${session.token}`).attach('files', body, name);

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
  });

  it('uploads to real storage and extracts metadata', async () => {
    const res = await upload('Team Photo.png', await png(800, 400, '#1f6f5c')).expect(201);
    const asset = res.body.items[0];
    assetId = asset.id;
    assetUrl = asset.url;
    expect(asset).toMatchObject({ filename: 'Team-Photo.png', mimeType: 'image/png', kind: 'image', width: 800, height: 400, duplicate: false });
    expect(asset).not.toHaveProperty('storageKey');

    // The file is served back byte-for-byte from the public media URL, with immutable caching.
    const file = await request(app).get(new URL(assetUrl).pathname).expect(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['cache-control']).toContain('immutable');
    expect((await sharp(file.body).metadata()).width).toBe(800);
  });

  it('detects duplicate uploads by content', async () => {
    const again = await upload('renamed-copy.png', await png(800, 400, '#1f6f5c')).expect(201);
    expect(again.body.items[0]).toMatchObject({ id: assetId, duplicate: true });
    const list = await as(session).get(`${mediaBase()}/media`).expect(200);
    expect(list.body.meta.total).toBe(1);
  });

  it('validates files by their content, not their name', async () => {
    const disguised = await upload('innocent.png', Buffer.from('<html><script>alert(1)</script></html>')).expect(400);
    expect(disguised.body.errors[0].message).toMatch(/cannot be uploaded|Unsupported/);
    const mismatch = await upload('photo.jpg', await png(10, 10, '#000000')).expect(400);
    expect(mismatch.body.errors[0].message).toMatch(/content is PNG/);
    await upload('run.exe', Buffer.from('MZ\u0090\u0000binary')).expect(400);
    const svg = await upload('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).expect(400);
    expect(svg.body.errors[0].message).toMatch(/script/);
    const safeSvg = await upload('logo.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>')).expect(201);
    const served = await request(app).get(new URL(safeSvg.body.items[0].url).pathname).expect(200);
    expect(served.headers['content-security-policy']).toContain('sandbox');
  });

  it('transforms images on request: size, fit, format and quality', async () => {
    const path = new URL(assetUrl).pathname;
    const webp = await request(app).get(`${path}?w=200&h=200&fit=cover&format=webp&q=70`).expect(200);
    expect(webp.headers['content-type']).toBe('image/webp');
    const meta = await sharp(webp.body).metadata();
    expect(meta).toMatchObject({ width: 200, height: 200, format: 'webp' });

    const inside = await request(app).get(`${path}?w=200&fit=inside`).expect(200);
    expect(await sharp(inside.body).metadata()).toMatchObject({ width: 200, height: 100, format: 'png' });
    await request(app).get(`${path}?w=999999`).expect(422);
    await request(app).get('/media/00000000-0000-4000-8000-000000000000/1/x.png').expect(404);
  });

  it('edits metadata, tracks usage and protects files that are in use', async () => {
    const updated = await as(session).patch(`${mediaBase()}/media/${assetId}`, { alt: 'The team', tags: ['Team', 'about'], filename: 'team.exe' }).expect(200);
    // The extension cannot be changed by renaming.
    expect(updated.body).toMatchObject({ alt: 'The team', tags: ['team', 'about'], filename: 'team.png' });

    await as(session)
      .post(`${project.base}/content-types`, {
        apiId: 'people',
        displayName: 'People',
        singularName: 'Person',
        pluralName: 'People',
        fields: [
          { apiId: 'name', label: 'Name', type: 'text', required: true, config: {} },
          { apiId: 'photo', label: 'Photo', type: 'image', config: {} },
        ],
      })
      .expect(201);
    const person = await as(session).post(`${project.base}/entries/people`, { data: { name: 'Ada', photo: assetId } }).expect(201);
    await as(session).post(`${project.base}/entry/${person.body.id}/publish`, {}).expect(200);

    const detail = await as(session).get(`${mediaBase()}/media/${assetId}`).expect(200);
    expect(detail.body.usages).toEqual([expect.objectContaining({ entryId: person.body.id, title: 'Ada', contentType: 'people' })]);
    const unused = await as(session).get(`${mediaBase()}/media?unused=true`).expect(200);
    expect(unused.body.items.map((i: { id: string }) => i.id)).not.toContain(assetId);

    // The delivery API expands media references into full objects with URLs.
    const token = await createToken(session, project);
    const live = await request(app).get('/api/v1/people').set('Authorization', `Bearer ${token}`).expect(200);
    expect(live.body.data[0].photo).toMatchObject({ id: assetId, alt: 'The team', width: 800, mimeType: 'image/png' });
    expect(live.body.data[0].photo.url).toContain(`/media/${assetId}/1/team.png`);

    const blocked = await as(session).delete(`${mediaBase()}/media/${assetId}`).expect(409);
    expect(blocked.body.error.details.usages).toHaveLength(1);
  });

  it('replaces a file without breaking references', async () => {
    const replaced = await request(app)
      .post(`${mediaBase()}/media/${assetId}/replace`)
      .set('Authorization', `Bearer ${session.token}`)
      .attach('file', await png(400, 400, '#b45309'), 'new-team.png')
      .expect(200);
    expect(replaced.body).toMatchObject({ id: assetId, revision: 2, width: 400, height: 400 });
    expect(replaced.body.url).toContain(`/media/${assetId}/2/`);
    // The old URL keeps working by redirecting to the current revision.
    const old = await request(app).get(new URL(assetUrl).pathname).expect(302);
    expect(old.headers.location).toContain(`/media/${assetId}/2/`);
    const stats = await as(session).get(`${mediaBase()}/media-stats`).expect(200);
    expect(stats.body.totalAssets).toBe(2);
    expect(stats.body.totalBytes).toBeGreaterThan(0);
  });
});

describe('page builder', () => {
  let session: Session;
  let project: ProjectFixture;
  let token: string;

  const hero = (heading: string, id = 'hero-1') => ({ id, type: 'hero', props: { heading, primaryLabel: 'Talk to us', primaryUrl: '/contact' }, style: { align: 'center', padding: { top: 96, bottom: 96 } } });

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
    token = await createToken(session, project);
  });

  it('stores pages as structured, framework-neutral block data and delivers them by path', async () => {
    const page = await as(session)
      .post(`${project.base}/entries/pages`, {
        data: {
          title: 'About us',
          slug: 'about',
          template: 'landing',
          seo: { title: 'About Meridian', description: 'Who we are', noIndex: false, hacked: '<script>' },
          blocks: [
            hero('We build content infrastructure'),
            {
              id: 'section-1',
              type: 'section',
              props: { label: 'Details' },
              style: { maxWidth: 'lg', background: { color: '#f5f5f4' }, evil: 'expression(alert(1))' },
              children: [
                { id: 'stats-1', type: 'stats', props: { heading: 'In numbers', items: [{ value: '99.9%', label: 'Uptime' }] } },
                { id: 'faq-1', type: 'faq', props: { items: [{ question: 'Is it headless?', answer: 'Yes.' }] } },
              ],
            },
          ],
        },
      })
      .expect(201);
    expect(page.body.path).toBe('/about');
    await as(session).post(`${project.base}/entry/${page.body.id}/publish`, {}).expect(200);

    const res = await request(app).get('/api/v1/pages?path=/about').set('Authorization', `Bearer ${token}`).expect(200);
    const data = res.body.data;
    expect(data).toMatchObject({ type: 'pages', title: 'About us', slug: 'about', path: '/about', template: 'landing' });
    // Unknown SEO and style properties are dropped rather than stored.
    expect(data.seo).toEqual({ title: 'About Meridian', description: 'Who we are', ogImage: null });
    expect(data.blocks.map((b: { type: string }) => b.type)).toEqual(['hero', 'section']);
    expect(data.blocks[0]).toMatchObject({ id: 'hero-1', props: { heading: 'We build content infrastructure', primaryUrl: '/contact' }, style: { align: 'center' } });
    expect(data.blocks[1].style).toEqual({ maxWidth: 'lg', background: { color: '#f5f5f4', image: null } });
    expect(data.blocks[1].children.map((b: { type: string }) => b.type)).toEqual(['stats', 'faq']);
    expect(data.blocks[1].children[0].props.items[0]).toMatchObject({ value: '99.9%', label: 'Uptime' });

    const gql = await request(app).post('/api/v1/graphql').set('Authorization', `Bearer ${token}`).send({ query: '{ page(path: "/about") { title path blocks } }' }).expect(200);
    expect(gql.body.data.page.blocks).toHaveLength(2);
  });

  it('rejects unknown blocks and enforces block field rules on publish', async () => {
    const unknown = await as(session)
      .post(`${project.base}/entries/pages`, { data: { title: 'Bad', slug: 'bad', blocks: [{ id: 'x', type: 'crypto-miner', props: {} }] } })
      .expect(422);
    expect(unknown.body.error.details[0].code).toBe('unknown_block');

    const draft = await as(session).post(`${project.base}/entries/pages`, { data: { title: 'Incomplete', slug: 'incomplete', blocks: [{ id: 'h', type: 'hero', props: { heading: '' } }] } }).expect(201);
    const refused = await as(session).post(`${project.base}/entry/${draft.body.id}/publish`, {}).expect(422);
    expect(refused.body.error.details[0]).toMatchObject({ path: 'blocks.0.props.heading', code: 'required' });
  });

  it('builds nested URLs, keeps them unique and updates child paths when a parent moves', async () => {
    const parent = await as(session).post(`${project.base}/entries/pages`, { data: { title: 'Company', slug: 'company', blocks: [hero('Company')] } }).expect(201);
    const child = await as(session)
      .post(`${project.base}/entries/pages`, { parentId: parent.body.id, data: { title: 'Team', slug: 'team', blocks: [hero('Team')] } })
      .expect(201);
    expect(child.body.path).toBe('/company/team');

    const clash = await as(session).post(`${project.base}/entries/pages`, { parentId: parent.body.id, data: { title: 'Team 2', slug: 'team', blocks: [] } }).expect(422);
    expect(clash.body.error.details[0].message).toContain('/company/team');
    // A page cannot be moved underneath its own child.
    await as(session).put(`${project.base}/entry/${parent.body.id}`, { data: parent.body.data, parentId: child.body.id }).expect(400);
    // A page with children cannot be deleted out from under them.
    await as(session).delete(`${project.base}/entry/${parent.body.id}`).expect(409);

    await as(session).post(`${project.base}/entry/${parent.body.id}/publish`, {}).expect(200);
    await as(session).post(`${project.base}/entry/${child.body.id}/publish`, {}).expect(200);
    await request(app).get('/api/v1/pages?path=/company/team').set('Authorization', `Bearer ${token}`).expect(200);

    const renamed = await as(session).put(`${project.base}/entry/${parent.body.id}`, { data: { ...parent.body.data, slug: 'about-the-company' } }).expect(200);
    expect(renamed.body.path).toBe('/about-the-company');
    const tree = await as(session).get(`${project.base}/pages/tree`).expect(200);
    expect(tree.body.items.find((p: { id: string }) => p.id === child.body.id).path).toBe('/about-the-company/team');
    // Live URLs change only when the rename is published.
    await request(app).get('/api/v1/pages?path=/company/team').set('Authorization', `Bearer ${token}`).expect(200);
    await as(session).post(`${project.base}/entry/${parent.body.id}/publish`, {}).expect(200);
    const moved = await request(app).get('/api/v1/pages?path=/about-the-company/team').set('Authorization', `Bearer ${token}`).expect(200);
    expect(moved.body.data.parent.path).toBe('/about-the-company');
    await request(app).get('/api/v1/pages?path=/company/team').set('Authorization', `Bearer ${token}`).expect(404);
  });

  it('offers custom components as page blocks', async () => {
    await as(session)
      .post(`${project.base}/components`, {
        apiId: 'promo-banner',
        displayName: 'Promo banner',
        isBlock: true,
        fields: [
          { apiId: 'message', label: 'Message', type: 'text', required: true, config: {} },
          { apiId: 'tone', label: 'Tone', type: 'select', config: { options: [{ label: 'Info', value: 'info' }, { label: 'Sale', value: 'sale' }] } },
        ],
      })
      .expect(201);
    const page = await as(session)
      .post(`${project.base}/entries/pages`, { data: { title: 'Sale', slug: 'sale', blocks: [{ id: 'p1', type: 'promo-banner', props: { message: '20% off', tone: 'sale' } }] } })
      .expect(201);
    await as(session).post(`${project.base}/entry/${page.body.id}/publish`, {}).expect(200);
    const res = await request(app).get('/api/v1/pages/sale').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.data.blocks[0]).toMatchObject({ type: 'promo-banner', props: { message: '20% off', tone: 'sale' } });
  });
});
