/**
 * Demo data: the "Acme Studio" organization and its "Acme Website" project, mirroring the
 * API's own seed. Everything is created through the same handlers a guest uses, at shifted
 * times and by different members, so the audit log, version history and analytics look lived-in.
 */
import { SYSTEM_ROLES, newId } from '@meridian/shared';
import type { Actor } from './context';
import { type DbDelivery, type DbUser, db, nowIso, withClock } from './db';
import type { UploadedFile } from './routes/media';
import { pdfDocument, pngImage, svgImage, textFile } from './samples';
import { dispatch } from './server';

const DAY = 86_400_000;

type Row = { id: string; documentId: string; lockVersion: number; data: Record<string, unknown> };

const doc = (...paragraphs: string[]) => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const f = (apiId: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({ apiId, label, type, config: {}, ...extra });

/** Deterministic pseudo-random numbers, so the analytics look the same after every reset. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed(): void {
  const t0 = Date.now();
  let cursor = t0 - 34 * DAY;
  /** Moves the story to a point in the past; each request then advances it by a few minutes. */
  const at = (daysAgo: number, hour = 10) => {
    const day = new Date(t0 - daysAgo * DAY);
    day.setHours(hour, 7, 0, 0);
    cursor = Math.min(day.getTime(), t0 - 60_000);
  };
  const call = <T = Row>(method: string, path: string, body?: unknown, actor?: Actor): T => {
    cursor = Math.min(cursor + 4 * 60_000, t0 - 1000);
    const res = withClock(cursor, () => dispatch({ method, path, body }, { actor, unguarded: true }));
    if (!res.ok) throw new Error(`Demo seed failed: ${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as T;
  };

  // ── Organization, roles, people ─────────────────────────────────────────────
  const created = new Date(t0 - 40 * DAY).toISOString();
  db.organization = { id: newId(), name: 'Acme Studio', slug: 'acme-studio', settings: { timeFormat: '24h' }, createdAt: created, updatedAt: created };
  db.roles = SYSTEM_ROLES.map((role) => ({ id: newId(), organizationId: db.organization.id, key: role.key, name: role.name, description: role.description, permissions: [...role.permissions], isSystem: true, createdAt: created }));
  const roleId = (key: string) => db.roles.find((r) => r.key === key)?.id as string;

  const person = (name: string, email: string, role: string, daysAgo: number, lastSeenDaysAgo: number | null, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE'): DbUser & { actor: Actor } => {
    const joined = new Date(t0 - daysAgo * DAY).toISOString();
    const user: DbUser = { id: newId(), email, name, isActive: true, isSuperAdmin: false, createdAt: joined, lastLoginAt: lastSeenDaysAgo === null ? null : new Date(t0 - lastSeenDaysAgo * DAY).toISOString() };
    db.users.push(user);
    db.memberships.push({ id: newId(), userId: user.id, roleId: roleId(role), status, createdAt: joined });
    return { ...user, actor: { type: 'user', id: user.id, label: name } };
  };
  // The guest is the only administrator, so the last-administrator rule protects their access.
  const guest = person('Guest', 'guest@acme.example', 'org_admin', 40, 0);
  db.userId = guest.id;
  const maya = person('Maya Okafor', 'maya@acme.example', 'content_manager', 38, 0.2);
  const jonas = person('Jonas Berg', 'jonas@acme.example', 'developer', 37, 1);
  const priya = person('Priya Raman', 'priya@acme.example', 'editor', 30, 0.5);
  const tomas = person('Tomás Silva', 'tomas@acme.example', 'author', 24, 2);
  const hannah = person('Hannah Weiss', 'hannah@acme.example', 'reviewer', 24, 1.5);
  person('Daniel Cho', 'daniel@acme.example', 'viewer', 20, 16, 'SUSPENDED');
  db.invitations.push({ id: newId(), email: 'lena.fischer@acme.example', roleId: roleId('publisher'), token: `demo-invite-${newId()}`, createdAt: new Date(t0 - 2 * DAY).toISOString(), expiresAt: new Date(t0 + 5 * DAY).toISOString() });

  // ── Project, locales ────────────────────────────────────────────────────────
  at(34);
  const project = call<{ id: string; environments: { id: string; key: string }[] }>('POST', `/orgs/${db.organization.id}/projects`, { name: 'Acme Website', description: 'Marketing site, blog and product catalogue', icon: 'globe', color: '#1F6F5C' });
  const envId = (key: string) => project.environments.find((e) => e.key === key)?.id as string;
  const proj = `/projects/${project.id}`;
  const env = `/envs/${envId('production')}`;
  call('PATCH', proj, { settings: { siteUrl: 'https://www.acme.example', previewUrl: 'https://www.acme.example/api/preview?token={token}&path={path}' } });
  call('POST', `${proj}/locales`, { code: 'fr', name: 'French', fallbackCode: 'en' });

  // ── Media ───────────────────────────────────────────────────────────────────
  const folder = (name: string) => call<{ id: string }>('POST', `${proj}/media-folders`, { name }).id;
  const folders = { brand: folder('Brand'), covers: folder('Blog covers'), people: folder('People'), products: folder('Products') };
  const media: Record<string, string> = {};
  const upload = (folderId: string | null, files: UploadedFile[], actor: Actor, meta: Record<string, { alt: string; tags: string[]; caption?: string }>) => {
    const result = call<{ items: { id: string; filename: string }[] }>('POST', `${proj}/media`, { files, folderId }, actor);
    for (const asset of result.items) {
      const key = asset.filename.replace(/\.[a-z]+$/, '');
      media[key] = asset.id;
      if (meta[key]) call('PATCH', `${proj}/media/${asset.id}`, meta[key], actor);
    }
  };
  upload(folders.brand, [svgImage('hero-workspace.svg', 1600, 900, '#1F6F5C', '#0F3D33', 'Acme'), svgImage('logo-acme.svg', 320, 96, '#1B1B19', '#3A3A37', 'acme'), pdfDocument('brand-guidelines.pdf', 'Acme brand guidelines 2026')], maya.actor, {
    'hero-workspace': { alt: 'A calm green workspace backdrop', tags: ['hero', 'brand'] },
    'logo-acme': { alt: 'Acme wordmark', tags: ['brand', 'logo'] },
    'brand-guidelines': { alt: '', tags: ['brand'], caption: 'Colors, type and tone of voice' },
  });
  at(33);
  upload(
    folders.covers,
    [svgImage('cover-design-systems.svg', 1200, 675, '#4A6B85', '#22384A', 'Design systems'), svgImage('cover-headless.svg', 1200, 675, '#8A5A2B', '#3F2A14', 'Going headless'), svgImage('cover-performance.svg', 1200, 675, '#6B5B7B', '#322A3B', 'Performance'), pngImage('texture-paper.png', 320, 200, [242, 241, 238], [201, 196, 184])],
    maya.actor,
    {
      'cover-design-systems': { alt: 'Abstract blue cover for the design systems article', tags: ['cover'] },
      'cover-headless': { alt: 'Abstract brown cover for the headless article', tags: ['cover'] },
      'cover-performance': { alt: 'Abstract purple cover for the performance article', tags: ['cover'] },
      'texture-paper': { alt: 'Warm paper texture', tags: ['texture'] },
    },
  );
  upload(folders.people, [svgImage('avatar-maya.svg', 400, 400, '#2E8A73', '#175746', 'MO'), svgImage('avatar-jonas.svg', 400, 400, '#4A6B85', '#2B4257', 'JB')], priya.actor, {
    'avatar-maya': { alt: 'Portrait of Maya Okafor', tags: ['avatar'] },
    'avatar-jonas': { alt: 'Portrait of Jonas Berg', tags: ['avatar'] },
  });
  upload(
    folders.products,
    [svgImage('product-notebook.svg', 1000, 1000, '#3A3A37', '#1B1B19', 'Notebook'), svgImage('product-bottle.svg', 1000, 1000, '#B4721A', '#6B430E', 'Bottle'), pngImage('swatch-amber.png', 160, 160, [180, 114, 26], [107, 67, 14]), textFile('price-list.csv', 'text/csv', 'sku,name,price\nNB-0001,Graphite Notebook,18.00\nBT-0002,Amber Bottle,24.50\nTT-0003,Field Tote,42.00\n')],
    priya.actor,
    {
      'product-notebook': { alt: 'Graphite notebook', tags: ['product'] },
      'product-bottle': { alt: 'Amber water bottle', tags: ['product'] },
      'swatch-amber': { alt: 'Amber colour swatch', tags: ['product', 'swatch'] },
      'price-list': { alt: '', tags: ['product'], caption: 'Current price list' },
    },
  );
  // One file left in the trash, so the trash view has something to restore.
  upload(null, [pngImage('old-banner.png', 240, 80, [74, 107, 133], [34, 56, 74])], jonas.actor, { 'old-banner': { alt: 'Retired sale banner', tags: ['archive'] } });
  call('DELETE', `${proj}/media/${media['old-banner']}`, undefined, jonas.actor);

  // ── Content model ───────────────────────────────────────────────────────────
  at(32);
  const model = (base: string, actor: Actor) => {
    const component = (body: Record<string, unknown>) => call('POST', `${base}/components`, body, actor);
    const type = (body: Record<string, unknown>) => call('POST', `${base}/content-types`, body, actor);
    component({ apiId: 'seo-meta', displayName: 'SEO metadata', category: 'Shared', icon: 'globe', fields: [f('title', 'SEO title', 'text', { config: { maxLength: 60, helpText: 'Shown in search results. Aim for 30–60 characters.' } }), f('description', 'Meta description', 'textarea', { config: { maxLength: 160 } })] });
    component({ apiId: 'link-item', displayName: 'Link', category: 'Shared', icon: 'navigation', fields: [f('label', 'Label', 'text', { required: true, config: { width: 6 } }), f('url', 'URL', 'url', { required: true, config: { width: 6 } })] });
    component({ apiId: 'pull-quote', displayName: 'Pull quote', category: 'Editorial', icon: 'quote', fields: [f('quote', 'Quote', 'textarea', { required: true }), f('attribution', 'Attribution', 'text')] });
    component({
      apiId: 'promo-banner',
      displayName: 'Promo banner',
      category: 'Marketing',
      icon: 'bolt',
      isBlock: true,
      description: 'A slim announcement strip',
      fields: [
        f('message', 'Message', 'text', { required: true }),
        f('tone', 'Tone', 'select', { config: { defaultValue: 'info', options: [{ label: 'Info', value: 'info' }, { label: 'Sale', value: 'sale' }] } }),
        f('linkLabel', 'Link label', 'text', { config: { width: 6 } }),
        f('linkUrl', 'Link', 'url', { config: { width: 6 } }),
      ],
    });
    type({
      apiId: 'authors', displayName: 'Authors', singularName: 'Author', pluralName: 'Authors', icon: 'person', options: { titleField: 'name' },
      fields: [f('name', 'Name', 'text', { required: true, config: { width: 6 } }), f('role', 'Role', 'text', { config: { width: 6 } }), f('email', 'Email', 'email', { unique: true, config: { width: 6 } }), f('avatar', 'Avatar', 'image', { config: { width: 6 } }), f('bio', 'Bio', 'textarea', { config: { maxLength: 400 } })],
    });
    type({
      apiId: 'categories', displayName: 'Categories', singularName: 'Category', pluralName: 'Categories', icon: 'category', options: { titleField: 'name' },
      fields: [f('name', 'Name', 'text', { required: true, config: { width: 6 } }), f('slug', 'Slug', 'slug', { unique: true, config: { sourceField: 'name', width: 6 } }), f('color', 'Color', 'color', { config: { width: 6 } })],
    });
    type({
      apiId: 'articles', displayName: 'Articles', singularName: 'Article', pluralName: 'Articles', icon: 'article', description: 'Blog posts and announcements', options: { titleField: 'title', localized: true, requireApproval: true },
      fields: [
        f('title', 'Title', 'text', { required: true, localized: true, config: { maxLength: 120 } }),
        f('slug', 'Slug', 'slug', { required: true, unique: true, config: { sourceField: 'title', width: 6 } }),
        f('publishedOn', 'Publish date', 'date', { config: { width: 6 } }),
        f('excerpt', 'Excerpt', 'textarea', { localized: true, config: { maxLength: 240, helpText: 'One or two sentences for listings and social cards' } }),
        f('cover', 'Cover image', 'image'),
        f('body', 'Body', 'richtext', { required: true, localized: true }),
        f('highlights', 'Highlights', 'dynamiczone', { config: { allowedComponents: ['pull-quote'], tab: 'Extras' } }),
        f('author', 'Author', 'relation', { config: { targetType: 'authors', width: 6, tab: 'Details' } }),
        f('category', 'Category', 'relation', { config: { targetType: 'categories', width: 6, tab: 'Details' } }),
        f('tags', 'Tags', 'multiselect', { config: { tab: 'Details', options: ['Design', 'Engineering', 'Product', 'Company'].map((t) => ({ label: t, value: t.toLowerCase() })) } }),
        f('readingTime', 'Reading time (minutes)', 'integer', { config: { min: 1, max: 60, width: 6, tab: 'Details' } }),
        f('featured', 'Featured', 'boolean', { config: { width: 6, tab: 'Details' } }),
        f('seo', 'SEO', 'component', { config: { component: 'seo-meta', tab: 'SEO' } }),
        f('editorNotes', 'Editor notes', 'textarea', { config: { private: true, tab: 'Extras', helpText: 'Internal only — never delivered through the API' } }),
      ],
    });
    type({
      apiId: 'products', displayName: 'Products', singularName: 'Product', pluralName: 'Products', icon: 'product', options: { titleField: 'name' },
      fields: [
        f('name', 'Name', 'text', { required: true, config: { width: 8 } }),
        f('sku', 'SKU', 'uid', { required: true, unique: true, config: { width: 4 } }),
        f('slug', 'Slug', 'slug', { unique: true, config: { sourceField: 'name', width: 6 } }),
        f('price', 'Price', 'decimal', { required: true, config: { min: 0, step: 0.01, width: 3 } }),
        f('rating', 'Rating', 'rating', { config: { maxRating: 5, width: 3 } }),
        f('description', 'Description', 'markdown'),
        f('gallery', 'Gallery', 'images'),
        f('inStock', 'In stock', 'boolean', { config: { defaultValue: true, width: 6 } }),
        f('specs', 'Specifications', 'json', { config: { helpText: 'Free-form attributes shown on the product page' } }),
      ],
    });
    type({ apiId: 'faqs', displayName: 'FAQs', singularName: 'FAQ', pluralName: 'FAQs', icon: 'faq', options: { titleField: 'question' }, fields: [f('question', 'Question', 'text', { required: true }), f('answer', 'Answer', 'textarea', { required: true }), f('order', 'Order', 'integer', { config: { width: 4 } })] });
    type({
      apiId: 'site-settings', displayName: 'Site settings', singularName: 'Site settings', pluralName: 'Site settings', kind: 'SINGLE', icon: 'settings', options: { titleField: 'siteName' },
      fields: [f('siteName', 'Site name', 'text', { required: true, config: { width: 6 } }), f('tagline', 'Tagline', 'text', { config: { width: 6 } }), f('brandColor', 'Brand color', 'color', { config: { width: 6 } }), f('supportEmail', 'Support email', 'email', { config: { width: 6 } }), f('footerLinks', 'Footer links', 'repeatable', { config: { component: 'link-item', maxItems: 8 } })],
    });
  };
  model(env, jonas.actor);

  // ── Entries ─────────────────────────────────────────────────────────────────
  const create = (base: string, typeId: string, data: Record<string, unknown>, actor: Actor, extra: Record<string, unknown> = {}) => call('POST', `${base}/entries/${typeId}`, { data, ...extra }, actor);
  const publish = (id: string, actor: Actor = maya.actor) => call('POST', `${env}/entry/${id}/publish`, {}, actor);
  const transition = (id: string, action: string, actor: Actor, comment?: string) => call('POST', `${env}/entry/${id}/transition`, { action, ...(comment ? { comment } : {}) }, actor);
  const approve = (id: string, author: Actor) => {
    transition(id, 'submit', author);
    transition(id, 'approve', hannah.actor, 'Reads well. Approved.');
  };

  at(31);
  const authorMaya = create(env, 'authors', { name: 'Maya Okafor', role: 'Head of Design', email: 'maya@acme.example', avatar: media['avatar-maya'], bio: 'Maya leads design at Acme and writes about systems, craft and teams.' }, priya.actor);
  const authorJonas = create(env, 'authors', { name: 'Jonas Berg', role: 'Staff Engineer', email: 'jonas@acme.example', avatar: media['avatar-jonas'], bio: 'Jonas works on platform and performance.' }, priya.actor);
  for (const a of [authorMaya, authorJonas]) publish(a.id);
  create(env, 'authors', { name: 'Priya Raman', role: 'Managing Editor', email: 'priya@acme.example', bio: '' }, priya.actor);

  const cats: Record<string, Row> = {};
  for (const [name, color] of [['Design', '#1F6F5C'], ['Engineering', '#4A6B85'], ['Company', '#8A5A2B']] as const) {
    cats[name] = create(env, 'categories', { name, color }, priya.actor);
    publish(cats[name].id);
  }

  interface Article { title: string; cover: string | null; author: Row; by: typeof maya; category: string; tags: string[]; featured: boolean; readingTime: number; excerpt: string; daysAgo: number }
  const article = (a: Article, index: number) => {
    at(a.daysAgo);
    return create(
      env,
      'articles',
      {
        title: a.title,
        excerpt: a.excerpt,
        cover: a.cover ? media[a.cover] : null,
        publishedOn: new Date(t0 - a.daysAgo * DAY).toISOString().slice(0, 10),
        body: doc(a.excerpt || 'Work in progress.', 'Teams rarely fail for lack of ideas. They fail when the distance between an idea and a published page is too long, or passes through too many hands.', 'This article walks through what worked for us, what did not, and what we would do differently next time.'),
        author: a.author.documentId,
        category: cats[a.category].documentId,
        tags: a.tags,
        featured: a.featured,
        readingTime: a.readingTime,
        seo: { title: a.title.slice(0, 58), description: a.excerpt.slice(0, 155) },
        highlights: index === 0 ? [{ id: 'hl-1', type: 'pull-quote', props: { quote: 'A design system is a product. Treat it like one or watch it rot.', attribution: 'Maya Okafor' } }] : [],
        editorNotes: index === 3 ? 'Check contrast figures with Jonas before publishing.' : null,
      },
      a.by.actor,
    );
  };
  const save = (row: Row, changes: Record<string, unknown>, actor: Actor, note?: string) => {
    const current = call('GET', `${env}/entry/${row.id}`);
    return call('PUT', `${env}/entry/${row.id}`, { data: { ...current.data, ...changes }, lockVersion: current.lockVersion, ...(note ? { note } : {}) }, actor);
  };

  const systems = article({ title: 'Design systems that survive contact with reality', cover: 'cover-design-systems', author: authorMaya, by: maya, category: 'Design', tags: ['design', 'product'], featured: true, readingTime: 7, daysAgo: 28, excerpt: 'Why most design systems stall after launch, and the habits of the ones that keep paying off.' }, 0);
  save(systems, { readingTime: 8 }, maya.actor, 'Added the section on governance');
  approve(systems.id, maya.actor);
  publish(systems.id);
  // A French translation of the same document, published too.
  const systemsData = call('GET', `${env}/entry/${systems.id}`).data;
  const systemsFr = create(env, 'articles', { ...systemsData, title: 'Des design systems qui résistent à la réalité', slug: 'design-systems-qui-resistent', excerpt: 'Pourquoi la plupart des design systems s’essoufflent après leur lancement.' }, tomas.actor, { locale: 'fr', documentId: systems.documentId });
  approve(systemsFr.id, tomas.actor);
  publish(systemsFr.id);

  const headless = article({ title: 'Going headless without losing your editors', cover: 'cover-headless', author: authorJonas, by: tomas, category: 'Engineering', tags: ['engineering'], featured: false, readingTime: 9, daysAgo: 22, excerpt: 'A practical guide to separating content from presentation while keeping the editing experience humane.' }, 1);
  approve(headless.id, tomas.actor);

  const homepage = article({ title: 'What we learned shipping a faster homepage', cover: 'cover-performance', author: authorJonas, by: tomas, category: 'Engineering', tags: ['engineering', 'product'], featured: false, readingTime: 5, daysAgo: 17, excerpt: 'Three changes that cut our largest contentful paint in half.' }, 2);
  approve(homepage.id, tomas.actor);
  publish(homepage.id);

  const yearInReview = article({ title: 'Our year in review', cover: null, author: authorMaya, by: maya, category: 'Company', tags: ['company'], featured: false, readingTime: 4, daysAgo: 26, excerpt: 'Twelve months, four product launches and one very long winter.' }, 8);
  approve(yearInReview.id, maya.actor);
  publish(yearInReview.id);

  const color = article({ title: 'Our approach to accessible color', cover: null, author: authorMaya, by: tomas, category: 'Design', tags: ['design'], featured: false, readingTime: 6, daysAgo: 6, excerpt: 'Contrast is the start, not the finish.' }, 3);
  transition(color.id, 'submit', tomas.actor);
  call('PATCH', `${env}/entry/${color.id}/assignee`, { assigneeId: hannah.id }, maya.actor);
  db.comments.push({ id: newId(), entryId: color.id, userId: hannah.id, body: 'Could we add an example with our own palette?', kind: 'comment', resolvedAt: null, createdAt: new Date(t0 - 5.6 * DAY).toISOString() });
  db.comments.push({ id: newId(), entryId: color.id, userId: tomas.id, body: 'Good idea — I will add the brand greens tomorrow.', kind: 'comment', resolvedAt: null, createdAt: new Date(t0 - 5.4 * DAY).toISOString() });

  const hiring = article({ title: 'Acme is hiring across design and engineering', cover: null, author: authorMaya, by: maya, category: 'Company', tags: ['company'], featured: false, readingTime: 3, daysAgo: 5, excerpt: 'Five open roles and how we interview.' }, 4);
  approve(hiring.id, maya.actor);

  const writing = article({ title: 'Writing for the web, briefly', cover: null, author: authorMaya, by: tomas, category: 'Design', tags: ['design', 'company'], featured: false, readingTime: 4, daysAgo: 4, excerpt: 'Short sentences. Real verbs. One idea per paragraph.' }, 5);
  transition(writing.id, 'submit', tomas.actor);
  transition(writing.id, 'request_changes', hannah.actor, 'The second half repeats the intro. Please cut it and add two concrete examples.');

  const spring = article({ title: 'A first look at the spring collection', cover: 'cover-design-systems', author: authorMaya, by: maya, category: 'Company', tags: ['product', 'company'], featured: true, readingTime: 3, daysAgo: 3, excerpt: 'Three new objects, two new colours and a notebook that finally lies flat.' }, 6);
  approve(spring.id, maya.actor);
  call('POST', `${env}/entry/${spring.id}/schedule`, { publishAt: new Date(t0 + 5 * DAY).toISOString() }, maya.actor);

  article({ title: 'Notes on the next release', cover: null, author: authorJonas, by: jonas, category: 'Company', tags: ['company'], featured: false, readingTime: 4, daysAgo: 2, excerpt: '' }, 7);
  const scrap = article({ title: 'Untitled test post', cover: null, author: authorJonas, by: tomas, category: 'Company', tags: [], featured: false, readingTime: 1, daysAgo: 9, excerpt: 'Trying out the editor.' }, 9);
  call('DELETE', `${env}/entry/${scrap.id}`, undefined, tomas.actor);

  at(21);
  for (const [name, sku, price, rating, cover, live] of [
    ['Graphite Notebook', 'NB-0001', 18, 5, 'product-notebook', true],
    ['Amber Bottle', 'BT-0002', 24.5, 4, 'product-bottle', true],
    ['Field Tote', 'TT-0003', 42, 4, null, false],
    ['Desk Tray', 'DT-0004', 31, 5, null, true],
  ] as const) {
    const product = create(env, 'products', { name, sku, price, rating, inStock: name !== 'Field Tote', description: `## ${name}\n\nMade to be used every day.\n\n- Durable materials\n- Repairable\n- Ships in recycled packaging`, gallery: cover ? [media[cover]] : [], specs: { weight: '320 g', origin: 'Portugal' } }, priya.actor);
    if (live) publish(product.id, priya.actor);
  }
  [
    ['Do you ship internationally?', 'Yes — to more than 40 countries. Delivery takes 3 to 8 working days.'],
    ['Can I return an order?', 'Returns are free within 30 days of delivery.'],
    ['How do I contact support?', 'Write to support@acme.example and we reply within one working day.'],
  ].forEach(([question, answer], i) => publish(create(env, 'faqs', { question, answer, order: i + 1 }, priya.actor).id, priya.actor));
  const settings = create(env, 'site-settings', { siteName: 'Acme', tagline: 'Everyday objects, made well.', brandColor: '#1F6F5C', supportEmail: 'support@acme.example', footerLinks: [{ label: 'About', url: '/about' }, { label: 'Journal', url: '/journal' }, { label: 'Contact', url: '/contact' }] }, jonas.actor);
  publish(settings.id, jonas.actor);

  // ── Pages ───────────────────────────────────────────────────────────────────
  at(19);
  const page = (base: string, data: Record<string, unknown>, parentId?: string) => call('POST', `${base}/entries/pages`, { data, parentId }, maya.actor);
  const nav = { id: 'nav', type: 'navigation', props: { brand: 'Acme', links: [{ label: 'Products', url: '/products' }, { label: 'Journal', url: '/journal' }, { label: 'About', url: '/about' }], ctaLabel: 'Contact', ctaUrl: '/contact', sticky: true } };
  const footer = { id: 'footer', type: 'footer', props: { tagline: 'Everyday objects, made well.', columns: [{ title: 'Company', links: [{ label: 'About', url: '/about' }, { label: 'Journal', url: '/journal' }] }, { title: 'Help', links: [{ label: 'Contact', url: '/contact' }, { label: 'FAQ', url: '/about#faq' }] }], copyright: '© Acme Studio' } };
  const homeBlocks = [
    nav,
    { id: 'promo', type: 'promo-banner', props: { message: 'Free shipping on orders over $50 this month', tone: 'sale', linkLabel: 'Shop now', linkUrl: '/products' } },
    { id: 'hero', type: 'hero', props: { eyebrow: 'New collection', heading: 'Everyday objects, made well.', subheading: 'Designed in small batches, built to last, and easy to repair.', image: media['hero-workspace'], layout: 'split', primaryLabel: 'Browse products', primaryUrl: '/products', secondaryLabel: 'Our story', secondaryUrl: '/about' }, style: { padding: { top: 96, bottom: 96 } } },
    {
      id: 'story',
      type: 'section',
      props: { label: 'Workshop story' },
      style: { padding: { top: 64, bottom: 64 }, maxWidth: 'lg', background: { color: '#F2F1EE' } },
      children: [
        {
          id: 'story-columns',
          type: 'columns',
          props: { gap: 'lg' },
          style: { columns: { desktop: 2, tablet: 2, mobile: 1 } },
          children: [
            { id: 'story-text', type: 'text', props: { content: doc('Every Acme product starts with a year of daily use by the people who design it.', 'If it does not earn its place on our own desks, it never reaches yours.') } },
            { id: 'story-image', type: 'image', props: { image: media['texture-paper'], alt: 'Warm paper texture from the workshop', caption: 'Paper stock for the spring notebooks', aspect: '4:3' } },
          ],
        },
      ],
    },
    { id: 'features', type: 'feature-grid', props: { heading: 'Why people stay with Acme', items: [{ icon: 'leaf', title: 'Responsible materials', description: 'Recycled and renewable wherever it performs as well.' }, { icon: 'wrench', title: 'Built to be repaired', description: 'Spare parts for every product we have ever made.' }, { icon: 'truck', title: 'Fast, plastic-free delivery', description: 'Ships within two working days.' }] }, style: { columns: { desktop: 3, tablet: 2, mobile: 1 }, padding: { top: 64, bottom: 64 } } },
    { id: 'products', type: 'product-listing', props: { heading: 'Popular right now', contentType: 'products', limit: 4, sort: 'newest', layout: 'grid', showExcerpt: false } },
    { id: 'stats', type: 'stats', props: { items: [{ value: '40+', label: 'Countries served' }, { value: '98%', label: 'Would recommend' }, { value: '12 yrs', label: 'Average product life' }, { value: '0', label: 'Plastic in packaging' }] }, style: { padding: { top: 56, bottom: 56 } } },
    { id: 'journal', type: 'blog-listing', props: { heading: 'From the journal', contentType: 'articles', limit: 3, sort: 'newest', layout: 'grid', showExcerpt: true } },
    { id: 'cta', type: 'cta', props: { heading: 'Questions before you order?', body: 'We answer every message within one working day.', primaryLabel: 'Contact us', primaryUrl: '/contact' }, style: { align: 'center', padding: { top: 72, bottom: 72 } } },
    footer,
  ];
  const home = page(env, { title: 'Home', slug: '', template: 'landing', seo: { title: 'Acme — everyday objects, made well', description: 'Thoughtfully designed objects for daily use, built to last and easy to repair.', ogImage: media['hero-workspace'] }, blocks: homeBlocks });
  const about = page(env, {
    title: 'About',
    slug: 'about',
    seo: { title: 'About Acme', description: 'Who we are, how we work and what we believe about making things.' },
    blocks: [
      nav,
      { id: 'hero', type: 'hero', props: { heading: 'A small studio with a long view', subheading: 'We have been making a handful of things well since 2014.', layout: 'centered' } },
      { id: 'story', type: 'split', props: { heading: 'How we work', body: doc('Every product starts with a year of use by the people who design it.', 'If it does not earn its place on our own desks, it never reaches yours.'), image: media['hero-workspace'], imagePosition: 'right' } },
      { id: 'team', type: 'team', props: { heading: 'The team', members: [{ name: 'Maya Okafor', role: 'Head of Design', photo: media['avatar-maya'] }, { name: 'Jonas Berg', role: 'Staff Engineer', photo: media['avatar-jonas'] }] }, style: { columns: { desktop: 4, tablet: 2, mobile: 1 } } },
      { id: 'faq', type: 'faq', props: { heading: 'Frequently asked', items: [{ question: 'Where are products made?', answer: 'In Portugal and northern Italy, by workshops we visit every year.' }, { question: 'Do you offer repairs?', answer: 'Yes. Send it back and we fix it at cost.' }] }, style: { anchor: 'faq', maxWidth: 'md' } },
      footer,
    ],
  });
  const careers = page(env, { title: 'Careers', slug: 'careers', seo: { title: 'Careers at Acme' }, blocks: [nav, { id: 'hero', type: 'hero', props: { heading: 'Do the best work of your career', subheading: 'Five open roles across design and engineering.', layout: 'centered' } }, footer] }, about.id);
  const journal = page(env, { title: 'Journal', slug: 'journal', template: 'article', seo: { title: 'The Acme journal', description: 'Notes on design, engineering and running a small studio.' }, blocks: [nav, { id: 'list', type: 'blog-listing', props: { heading: 'Latest articles', contentType: 'articles', limit: 9, sort: 'newest', layout: 'list', showExcerpt: true } }, footer] });
  const contact = page(env, { title: 'Contact', slug: 'contact', seo: { title: 'Contact Acme', description: 'Get in touch with the Acme team.' }, blocks: [nav, { id: 'contact', type: 'contact', props: { heading: 'Talk to us', body: 'We reply within one working day.', email: 'support@acme.example', phone: '+1 555 010 2030', showForm: true, formAction: 'https://www.acme.example/api/contact' } }, footer] });
  const pricing = page(env, {
    title: 'Pricing',
    slug: 'pricing',
    seo: { title: 'Pricing' },
    blocks: [nav, { id: 'pricing', type: 'pricing', props: { heading: 'Simple pricing', plans: [{ name: 'Single', price: '$18', period: 'per item', features: 'One product\nStandard delivery', ctaLabel: 'Shop', ctaUrl: '/products' }, { name: 'Studio set', price: '$72', period: 'per set', features: 'Five products\nFree delivery\nGift wrapping', ctaLabel: 'Shop sets', ctaUrl: '/products', highlighted: true }] } }, footer],
  });
  for (const p of [home, about, journal]) publish(p.id);

  // ── Releases ────────────────────────────────────────────────────────────────
  at(12);
  const winter = call<{ id: string }>('POST', `${env}/releases`, { name: 'Winter refresh', description: 'The headless article and the new contact page went live together.' }, maya.actor);
  call('POST', `${env}/releases/${winter.id}/items`, { entryIds: [headless.id, contact.id] }, maya.actor);
  call('POST', `${env}/releases/${winter.id}/publish`, {}, maya.actor);

  // A published article with newer, unpublished edits; an archived one; a scheduled page.
  at(8);
  save(homepage, { title: 'What we learned shipping a faster homepage (updated)' }, tomas.actor, 'Tightened the headline');
  at(7);
  transition(yearInReview.id, 'archive', maya.actor);
  at(4, 15);
  call('POST', `${env}/entry/${careers.id}/schedule`, { publishAt: new Date(t0 + 3 * DAY).toISOString() }, maya.actor);
  at(1, 16);
  const launch = call<{ id: string }>('POST', `${env}/releases`, { name: 'Spring launch', description: 'Pricing page and the hiring announcement go live together.' }, maya.actor);
  call('POST', `${env}/releases/${launch.id}/items`, { entryIds: [pricing.id, hiring.id] }, maya.actor);

  // ── Staging: the same model with a little work in progress ──────────────────
  at(15);
  const staging = `/envs/${envId('staging')}`;
  model(staging, jonas.actor);
  const stagingAuthor = create(staging, 'authors', { name: 'Maya Okafor', role: 'Head of Design', email: 'maya@acme.example', bio: 'Maya leads design at Acme.' }, jonas.actor);
  create(staging, 'articles', { title: 'Staging: draft of the spring announcement', excerpt: 'Checking how the new layout handles long titles.', body: doc('Placeholder copy for layout testing.'), author: stagingAuthor.documentId, tags: ['company'], readingTime: 2 }, jonas.actor);
  page(staging, { title: 'Home', slug: '', template: 'landing', seo: { title: 'Acme (staging)' }, blocks: [nav, { id: 'hero', type: 'hero', props: { heading: 'Staging home page', subheading: 'Used to try out new blocks before they reach production.', layout: 'centered' } }, footer] });

  // ── API keys and traffic ────────────────────────────────────────────────────
  at(30);
  const key = (name: string, description: string, type: string, environment: string, actor: Actor) => call<{ id: string }>('POST', `${proj}/tokens`, { name, description, type, environmentId: envId(environment) }, actor).id;
  const website = key('Website (production)', 'Read-only key for the public site', 'READ_ONLY', 'production', jonas.actor);
  const mobile = key('Mobile app', 'Read-only key bundled with the iOS and Android apps', 'READ_ONLY', 'production', jonas.actor);
  at(18);
  const previews = key('Preview deployments', 'Lets the staging site render unpublished drafts', 'PREVIEW', 'staging', jonas.actor);
  const importer = key('Catalogue importer', 'One-off import of the product catalogue', 'READ_WRITE', 'production', jonas.actor);
  at(14);
  call('DELETE', `${proj}/tokens/${importer}`, undefined, jonas.actor);

  const random = mulberry32(20260);
  const traffic: [string, string, [string, number][]][] = [
    [website, envId('production'), [['articles', 420], ['pages', 610], ['products', 380], ['site-settings', 240], ['faqs', 90], ['media', 60]]],
    [mobile, envId('production'), [['products', 260], ['articles', 140], ['site-settings', 110]]],
    [previews, envId('staging'), [['pages', 34], ['articles', 22]]],
  ];
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const date = new Date(t0 - daysAgo * DAY);
    const day = date.toISOString().slice(0, 10);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.55 : 1;
    const growth = 0.7 + ((29 - daysAgo) / 29) * 0.45;
    for (const [tokenId, environmentId, resources] of traffic) {
      for (const [resource, base] of resources) {
        const requests = Math.max(1, Math.round(base * weekend * growth * (0.8 + random() * 0.4)));
        // One rough day a couple of weeks ago, so the error chart is not a flat line.
        const errorRate = daysAgo === 11 ? 0.06 : 0.004 + random() * 0.008;
        db.usage.push({ environmentId, tokenId, resource, day, requests, errors: Math.round(requests * errorRate), latencyMsTotal: Math.round(requests * (28 + random() * 22)) });
      }
    }
  }
  for (const [tokenId, hoursAgo] of [[website, 0.1], [mobile, 2], [previews, 30]] as const) {
    const token = db.tokens.find((t) => t.id === tokenId);
    if (token) token.lastUsedAt = new Date(t0 - hoursAgo * 3_600_000).toISOString();
  }

  // ── Webhooks, with a sample delivery log ────────────────────────────────────
  at(30, 14);
  const rebuild = call<{ id: string }>('POST', `${env}/webhooks`, { name: 'Rebuild website', url: 'https://www.acme.example/api/revalidate', events: ['content.published', 'content.unpublished', 'page.published', 'page.unpublished', 'release.published'], headers: { 'X-Site': 'acme-www' } }, jonas.actor);
  call('POST', `${env}/webhooks`, { name: 'Search index sync', url: 'https://search.acme.example/hooks/meridian', events: ['*'], isActive: false }, jonas.actor);
  const sample = (hoursAgo: number, event: string, title: string, outcome: 'ok' | 'error' | 'timeout'): DbDelivery => {
    const when = new Date(t0 - hoursAgo * 3_600_000).toISOString();
    const eventId = newId();
    return {
      id: newId(),
      webhookId: rebuild.id,
      eventId,
      event,
      payload: { id: eventId, event, organization: db.organization.slug, project: 'acme-website', projectId: project.id, environment: 'production', environmentId: envId('production'), title, timestamp: when, sample: true },
      status: outcome === 'ok' ? 'SUCCESS' : 'FAILED',
      attempts: outcome === 'ok' ? 1 : 5,
      responseStatus: outcome === 'ok' ? 200 : outcome === 'error' ? 502 : null,
      responseBody: outcome === 'ok' ? '{"revalidated":true}' : outcome === 'error' ? 'Bad Gateway' : null,
      error: outcome === 'timeout' ? 'Request timed out after 10000 ms' : outcome === 'error' ? 'Endpoint answered 502' : null,
      durationMs: outcome === 'ok' ? 140 + Math.round(random() * 220) : outcome === 'error' ? 310 : 10_000,
      nextRetryAt: null,
      createdAt: when,
      completedAt: when,
    };
  };
  db.deliveries.push(
    sample(27 * 24, 'content.published', 'Design systems that survive contact with reality', 'ok'),
    sample(18.6 * 24, 'page.published', 'Home', 'ok'),
    sample(18.5 * 24, 'page.published', 'About', 'ok'),
    sample(16.4 * 24, 'content.published', 'What we learned shipping a faster homepage', 'ok'),
    sample(11.9 * 24, 'release.published', 'Winter refresh', 'error'),
    sample(11.8 * 24, 'content.published', 'Going headless without losing your editors', 'ok'),
    sample(11.8 * 24, 'page.published', 'Contact', 'ok'),
    sample(6.9 * 24, 'content.unpublished', 'Our year in review', 'timeout'),
    sample(52, 'content.published', 'Desk Tray', 'ok'),
  );

  db.seededAt = nowIso();
}
