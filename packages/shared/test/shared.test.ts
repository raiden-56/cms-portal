import { describe, expect, it } from 'vitest';
import {
  BUILTIN_BLOCKS,
  BUILTIN_COMPONENTS,
  type BlockNode,
  type FieldDef,
  FIELD_TYPES,
  FIELD_TYPE_META,
  SYSTEM_ROLES,
  WORKFLOW_TRANSITIONS,
  ALL_PERMISSIONS,
  analyzeSeo,
  buildBlockRegistry,
  buildDefaults,
  canTransition,
  collectReferences,
  createBlockNode,
  duplicateBlock,
  evaluateCondition,
  findBlock,
  findParentId,
  insertBlock,
  isCompatibleTypeChange,
  moveBlock,
  pluralize,
  removeBlock,
  renderRichTextToHtml,
  richTextToPlainText,
  sanitizeBlockStyle,
  sanitizeRichText,
  slugify,
  toFieldApiId,
  toPascalCase,
  validateEntryData,
  validatePageData,
} from '../src/index';

const field = (apiId: string, type: FieldDef['type'], extra: Partial<FieldDef> = {}): FieldDef => ({
  apiId,
  label: apiId.charAt(0).toUpperCase() + apiId.slice(1),
  type,
  required: false,
  unique: false,
  localized: false,
  config: {},
  position: 0,
  ...extra,
});

const UUID = '3f2b8c1e-5d4a-4f6b-9c7d-1e2f3a4b5c6d';
const UUID2 = '7a1c9e2f-3b4d-4a5e-8f6a-0b1c2d3e4f5a';

describe('field catalogue', () => {
  it('describes all 34 field types', () => {
    expect(FIELD_TYPES).toHaveLength(34);
    for (const type of FIELD_TYPES) expect(FIELD_TYPE_META[type].label).toBeTruthy();
  });

  it('knows which type changes keep data', () => {
    expect(isCompatibleTypeChange('text', 'textarea')).toBe(true);
    expect(isCompatibleTypeChange('integer', 'decimal')).toBe(true);
    expect(isCompatibleTypeChange('text', 'integer')).toBe(false);
    expect(isCompatibleTypeChange('richtext', 'text')).toBe(false);
  });
});

describe('entry validation', () => {
  const fields = [
    field('title', 'text', { required: true, config: { minLength: 3, maxLength: 20 } }),
    field('email', 'email'),
    field('site', 'url'),
    field('views', 'integer', { config: { min: 0, max: 100 } }),
    field('price', 'decimal'),
    field('live', 'boolean'),
    field('day', 'date'),
    field('at', 'datetime'),
    field('kind', 'select', { config: { options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] } }),
    field('tags', 'multiselect', { config: { options: [{ label: 'X', value: 'x' }, { label: 'Y', value: 'y' }] } }),
    field('tint', 'color'),
    field('slug', 'slug'),
    field('code', 'text', { config: { pattern: '^[A-Z]{3}$', patternMessage: 'Three capital letters' } }),
    field('cover', 'image'),
    field('gallery', 'images', { config: { maxItems: 2 } }),
    field('author', 'relation'),
    field('where', 'geolocation'),
    field('stars', 'rating', { config: { maxRating: 5 } }),
    field('meta', 'json'),
  ];

  it('accepts a complete, valid entry and normalises it', () => {
    const { data, issues } = validateEntryData(
      fields,
      { title: 'Hello', email: ' a@b.co ', site: 'https://x.dev', views: 3, price: 9.5, live: true, day: '2026-03-01', at: '2026-03-01T10:00:00+01:00', kind: 'a', tags: ['x', 'x', 'y'], tint: '#1F6F5C', slug: 'hello-world', code: 'ABC', cover: UUID, gallery: [UUID, UUID2], author: UUID, where: { lat: 52.5, lng: 13.4 }, stars: 4, meta: { a: 1 }, unknown: 'dropped' },
      { mode: 'publish' },
    );
    expect(issues).toEqual([]);
    expect(data.email).toBe('a@b.co');
    expect(data.at).toBe('2026-03-01T09:00:00.000Z');
    expect(data.tags).toEqual(['x', 'y']);
    expect(data).not.toHaveProperty('unknown');
  });

  it('reports every kind of problem with its path', () => {
    const { issues } = validateEntryData(
      fields,
      { title: 'Hi', email: 'nope', site: 'javascript:alert(1)', views: 2.5, price: 'x', live: 'yes', day: '03/01/2026', kind: 'z', tags: ['q'], tint: 'red', slug: 'Not A Slug', code: 'abc', cover: 'x', gallery: [UUID, UUID2, '11111111-1111-4111-8111-111111111111'], where: { lat: 200, lng: 0 }, stars: 9 },
      { mode: 'publish' },
    );
    const byPath = Object.fromEntries(issues.map((i) => [i.path, i.code]));
    expect(byPath).toMatchObject({
      title: 'min_length',
      email: 'invalid_email',
      site: 'invalid_url',
      views: 'not_integer',
      price: 'invalid_type',
      live: 'invalid_type',
      day: 'invalid_type',
      kind: 'invalid_option',
      tags: 'invalid_option',
      tint: 'invalid_color',
      slug: 'invalid_slug',
      code: 'pattern',
      cover: 'invalid_type',
      gallery: 'max_items',
      'where.lat': 'out_of_range',
      stars: 'out_of_range',
    });
    expect(issues.find((i) => i.path === 'code')?.message).toBe('Three capital letters');
  });

  it('lets drafts be incomplete but never wrongly typed', () => {
    const draft = validateEntryData(fields, { title: '', views: 500 }, { mode: 'draft' });
    expect(draft.issues).toEqual([]);
    expect(draft.data.title).toBeNull();
    const publish = validateEntryData(fields, { title: '', views: 500 }, { mode: 'publish' });
    expect(publish.issues.map((i) => i.code).sort()).toEqual(['max', 'required']);
    expect(validateEntryData(fields, { views: 'many' }, { mode: 'draft' }).issues[0].code).toBe('invalid_type');
    expect(validateEntryData(fields, 'not an object', { mode: 'draft' }).issues[0].code).toBe('invalid_type');
  });

  it('applies conditional visibility and conditional requirement', () => {
    const conditional = [
      field('kind', 'select', { config: { options: [{ label: 'Link', value: 'link' }, { label: 'None', value: 'none' }] } }),
      field('url', 'url', { required: true, config: { visibleWhen: { field: 'kind', operator: 'eq', value: 'link' } } }),
      field('note', 'text', { config: { requiredWhen: { field: 'kind', operator: 'eq', value: 'none' } } }),
    ];
    expect(validateEntryData(conditional, { kind: 'none', note: 'ok' }, { mode: 'publish' }).issues).toEqual([]);
    expect(validateEntryData(conditional, { kind: 'link' }, { mode: 'publish' }).issues.map((i) => i.path)).toEqual(['url']);
    expect(validateEntryData(conditional, { kind: 'none' }, { mode: 'publish' }).issues.map((i) => i.path)).toEqual(['note']);
    expect(evaluateCondition({ field: 'n', operator: 'gt', value: 3 }, { n: 5 })).toBe(true);
    expect(evaluateCondition({ field: 'n', operator: 'in', value: ['a', 'b'] }, { n: 'c' })).toBe(false);
  });

  it('validates nested components, repeatables and dynamic zones', () => {
    const components = {
      link: [field('label', 'text', { required: true }), field('url', 'url', { required: true })],
      quote: [field('text', 'textarea', { required: true })],
    };
    const nested = [
      field('primary', 'component', { config: { component: 'link' } }),
      field('links', 'repeatable', { config: { component: 'link', minItems: 2 } }),
      field('zone', 'dynamiczone', { config: { allowedComponents: ['quote'] } }),
    ];
    const ok = validateEntryData(nested, { primary: { label: 'A', url: '/a' }, links: [{ label: 'B', url: '/b', _key: 'k1' }, { label: 'C', url: '/c' }], zone: [{ id: 'z1', type: 'quote', props: { text: 'Hi' } }] }, { mode: 'publish', components });
    expect(ok.issues).toEqual([]);
    expect((ok.data.links as { _key: string }[])[0]._key).toBe('k1');

    // An optional list may be empty; once it has items, the minimum applies.
    expect(validateEntryData(nested, { links: [] }, { mode: 'publish', components }).issues).toEqual([]);
    const bad = validateEntryData(nested, { primary: { label: '', url: 'nope' }, links: [{ label: 'Only one', url: '/x' }], zone: [{ id: 'z1', type: 'link', props: {} }, { id: 'z2', type: 'ghost', props: {} }] }, { mode: 'publish', components });
    expect(bad.issues.map((i) => `${i.path}:${i.code}`)).toEqual(
      expect.arrayContaining(['primary.label:required', 'primary.url:invalid_url', 'links:min_items', 'zone.0:component_not_allowed', 'zone.1:unknown_component']),
    );
  });

  it('collects media and relation references, including nested ones', () => {
    const components = { card: [field('image', 'image'), field('target', 'relation')] };
    const refs = collectReferences(
      [field('cover', 'image'), field('gallery', 'images'), field('author', 'relation'), field('cards', 'repeatable', { config: { component: 'card' } })],
      { cover: UUID, gallery: [UUID, UUID2], author: UUID, cards: [{ image: UUID2, target: UUID2 }] },
      components,
    );
    expect(refs.media.sort()).toEqual([UUID, UUID2].sort());
    expect(refs.relations).toEqual([{ field: 'author', target: UUID }, { field: 'cards.target', target: UUID2 }]);
  });

  it('builds defaults for a new entry', () => {
    expect(buildDefaults([field('a', 'text', { config: { defaultValue: 'x' } }), field('b', 'boolean'), field('c', 'images'), field('d', 'integer')])).toEqual({ a: 'x', b: false, c: [], d: null });
  });
});

describe('rich text', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2, textAlign: 'center', onclick: 'steal()' }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Safe ', marks: [{ type: 'bold' }] },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }] },
          { type: 'text', text: ' bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'text', text: ' <script>alert(1)</script>' },
        ],
      },
      { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
      { type: 'image', attrs: { src: 'javascript:alert(1)' } },
      { type: 'image', attrs: { src: 'https://cdn.example.com/a.png', alt: 'A "quoted" alt' } },
    ],
  };

  it('keeps only whitelisted nodes, marks and attributes', () => {
    const clean = sanitizeRichText(doc);
    expect(clean?.content?.map((n) => n.type)).toEqual(['heading', 'paragraph', 'image']);
    expect(clean?.content?.[0].attrs).toEqual({ level: 2, textAlign: 'center' });
    const marks = clean?.content?.[1].content?.map((n) => n.marks?.[0]?.type);
    expect(marks).toEqual(['bold', 'link', undefined, undefined]);
    expect(sanitizeRichText({ type: 'paragraph' })).toBeNull();
    expect(sanitizeRichText('<p>html</p>')).toBeNull();
  });

  it('renders escaped, script-free HTML', () => {
    const html = renderRichTextToHtml(doc);
    expect(html).toContain('<h2 style="text-align:center">Title</h2>');
    expect(html).toContain('<strong>Safe </strong>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('alt="A &quot;quoted&quot; alt"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });

  it('extracts plain text', () => {
    expect(richTextToPlainText(doc)).toContain('Title');
    expect(richTextToPlainText(null)).toBe('');
  });
});

describe('page blocks', () => {
  const registry = buildBlockRegistry([{ apiId: 'promo', displayName: 'Promo', fields: [field('message', 'text', { required: true })] }]);
  const node = (id: string, type = 'text', children?: BlockNode[]): BlockNode => ({ id, type, props: {}, ...(children ? { children } : {}) });

  it('ships the built-in block library with consistent definitions', () => {
    const types = BUILTIN_BLOCKS.map((b) => b.type);
    for (const expected of ['hero', 'text', 'image', 'video', 'split', 'feature-grid', 'cards', 'testimonials', 'faq', 'pricing', 'stats', 'logos', 'gallery', 'cta', 'contact', 'team', 'blog-listing', 'product-listing', 'breadcrumbs', 'navigation', 'footer', 'html', 'json']) {
      expect(types).toContain(expected);
    }
    expect(new Set(types).size).toBe(types.length);
    // Every repeatable inside a block points at an item schema that exists.
    for (const block of BUILTIN_BLOCKS) {
      for (const f of block.fields) if (f.type === 'repeatable') expect(BUILTIN_COMPONENTS[f.config.component as string]).toBeDefined();
    }
    expect(registry.promo.category).toBe('custom');
    expect(registry.hero.builtIn).toBe(true);
  });

  it('creates blocks with defaults and unique ids', () => {
    const a = createBlockNode(registry.hero);
    const b = createBlockNode(registry.section);
    expect(a.props.heading).toBe('A clear, confident headline');
    expect(a.id).not.toBe(b.id);
    expect(b.children).toEqual([]);
    expect(a.children).toBeUndefined();
  });

  it('inserts, moves, duplicates and removes without mutating the input', () => {
    const tree: BlockNode[] = [node('a'), node('s', 'section', [node('c'), node('d')]), node('e')];
    const frozen = JSON.stringify(tree);

    const inserted = insertBlock(tree, node('x'), 's', 1);
    expect(findBlock(inserted, 's')?.children?.map((c) => c.id)).toEqual(['c', 'x', 'd']);

    const moved = moveBlock(tree, 'a', 's', 2);
    expect(moved.map((n) => n.id)).toEqual(['s', 'e']);
    expect(findBlock(moved, 's')?.children?.map((c) => c.id)).toEqual(['c', 'd', 'a']);
    expect(findParentId(moved, 'a')).toBe('s');

    // Moving down within the same parent accounts for the removed item.
    expect(moveBlock(tree, 'a', null, 3).map((n) => n.id)).toEqual(['s', 'e', 'a']);
    // A block can never be moved into itself or its own subtree.
    expect(moveBlock(tree, 's', 's', 0)).toBe(tree);
    const deep: BlockNode[] = [node('p', 'section', [node('q', 'section', [])])];
    expect(moveBlock(deep, 'p', 'q', 0)).toBe(deep);

    const { blocks, newId } = duplicateBlock(tree, 's');
    expect(blocks.map((n) => n.type)).toEqual(['text', 'section', 'section', 'text']);
    expect(newId).not.toBe('s');
    expect(findBlock(blocks, newId as string)?.children?.map((c) => c.id)).not.toContain('c');

    expect(removeBlock(tree, 'c').find((n) => n.id === 's')?.children?.map((c) => c.id)).toEqual(['d']);
    expect(JSON.stringify(tree)).toBe(frozen);
  });

  it('validates pages: unknown blocks, required props, nested children and style sanitising', () => {
    const page = {
      title: 'Landing',
      slug: 'landing',
      seo: { title: 'T', noIndex: true, junk: 1, canonicalUrl: 'javascript:1' },
      blocks: [
        { id: 'h', type: 'hero', props: { heading: '' }, style: { align: 'center', padding: { top: 9999 }, background: { color: 'url(x)' }, position: 'fixed' } },
        { id: 's', type: 'section', props: {}, children: [{ id: 'p', type: 'promo', props: { message: 'Hi' } }, { id: 'p', type: 'promo', props: {} }] },
        { id: 'z', type: 'does-not-exist', props: {} },
      ],
    };
    const draft = validatePageData(page, { mode: 'draft', registry });
    expect(draft.issues.map((i) => i.code)).toEqual(['unknown_block']);
    expect(draft.data.blocks).toHaveLength(2);
    expect(draft.data.blocks[0].style).toEqual({ align: 'center', padding: { top: 400 } });
    expect(draft.data.seo).toEqual({ title: 'T', noIndex: true });
    // Duplicate ids are replaced so every block stays addressable.
    const ids = draft.data.blocks[1].children?.map((c) => c.id) ?? [];
    expect(new Set(ids).size).toBe(2);

    const publish = validatePageData(page, { mode: 'publish', registry });
    expect(publish.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['blocks.0.props.heading', 'blocks.1.children.1.props.message']));
    expect(validatePageData({ slug: 'Bad Slug', blocks: [] }, { mode: 'draft', registry }).issues.map((i) => i.path)).toEqual(['title', 'slug']);
  });

  it('sanitises block styles', () => {
    expect(sanitizeBlockStyle({ textColor: '#fff', maxWidth: 'huge', columns: { desktop: 99, mobile: 1 }, visibility: { mobile: false }, animation: { type: 'spin', delay: 100 }, anchor: 'faq', cssClass: 'a b<script>' })).toEqual({
      textColor: '#fff',
      columns: { desktop: 6, mobile: 1 },
      visibility: { mobile: false },
      animation: { delay: 100 },
      anchor: 'faq',
    });
    expect(sanitizeBlockStyle(null)).toBeUndefined();
    expect(sanitizeBlockStyle({ nothing: true })).toBeUndefined();
  });

  it('gives editors SEO guidance', () => {
    const checks = analyzeSeo({ title: 'Home', slug: '', seo: {}, blocks: [{ id: 'i', type: 'image', props: { image: UUID } }] });
    const level = Object.fromEntries(checks.map((c) => [c.id, c.level]));
    expect(level).toMatchObject({ title: 'warn', description: 'fail', alt: 'warn', og: 'warn' });
    const good = analyzeSeo({ title: 'x', slug: 'x', seo: { title: 'A descriptive, well sized page title', description: 'A meta description that is long enough to be useful to searchers and short enough to fit.', ogImage: UUID }, blocks: [] });
    expect(good.every((c) => c.level === 'pass')).toBe(true);
  });
});

describe('workflow and permissions', () => {
  it('only allows defined transitions', () => {
    expect(canTransition('submit', 'DRAFT')).toBe(true);
    expect(canTransition('approve', 'DRAFT')).toBe(false);
    expect(canTransition('approve', 'IN_REVIEW')).toBe(true);
    expect(canTransition('unarchive', 'PUBLISHED')).toBe(false);
    expect(WORKFLOW_TRANSITIONS.approve.permission).toBe('content.review');
    expect(WORKFLOW_TRANSITIONS.publish.permission).toBe('content.publish');
  });

  it('defines system roles using only real permissions, with sensible boundaries', () => {
    const role = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)?.permissions ?? [];
    for (const r of SYSTEM_ROLES) for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
    expect(role('org_admin')).toHaveLength(ALL_PERMISSIONS.length);
    expect(role('viewer').some((p) => /create|update|delete|publish|manage|upload/.test(p))).toBe(false);
    expect(role('author')).not.toContain('content.publish');
    expect(role('author')).not.toContain('schema.manage');
    expect(role('reviewer')).toContain('content.review');
    expect(role('reviewer')).not.toContain('content.update');
    expect(role('publisher')).toContain('content.publish');
    expect(role('developer')).toContain('schema.manage');
    expect(role('developer')).not.toContain('org.members.manage');
  });
});

describe('text helpers', () => {
  it('slugifies, builds identifiers and pluralises', () => {
    expect(slugify('  Héllo, Wörld & Friends!  ')).toBe('hello-world-and-friends');
    expect(slugify('---')).toBe('');
    expect(toFieldApiId('Cover image (large)')).toBe('coverImageLarge');
    expect(toFieldApiId('2nd title')).toBe('f2ndTitle');
    expect(toPascalCase('blog-post')).toBe('BlogPost');
    expect(pluralize('Category')).toBe('Categories');
    expect(pluralize('Box')).toBe('Boxes');
    expect(pluralize('Article')).toBe('Articles');
  });
});
