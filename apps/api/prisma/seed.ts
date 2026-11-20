/**
 * Demo data: one organization, one project with a realistic content model, media, entries
 * in every editorial state, pages built from blocks, a release and an API key.
 *
 *   npm run db:seed
 *
 * The seed talks to the real HTTP API (started in-process on a random port), so everything
 * it creates has passed the same validation and permission checks as user-made content.
 * It is safe to run twice: an existing demo project is left untouched.
 *
 * Credentials come from SEED_EMAIL / SEED_PASSWORD (see .env.example).
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createApp } from '../src/app';
import { closeInfra } from '../src/lib/infra';
import { stopWebhooks } from '../src/modules/webhooks/webhooks.service';

const EMAIL = process.env.SEED_EMAIL ?? 'demo@meridian.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'meridian-demo-2026';
const ORG = 'Acme Studio';
const PROJECT = 'Acme Website';

let base = '';
let token = '';

async function call<T = any>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok && !raw) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json?.error ?? json)}`);
  return (raw ? { status: res.status, body: json } : json) as T;
}

const doc = (...paragraphs: string[]) => ({ type: 'doc', content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const f = (apiId: string, label: string, type: string, extra: Record<string, unknown> = {}) => ({ apiId, label, type, config: {}, ...extra });

async function image(name: string, width: number, height: number, from: string, to: string, label: string): Promise<{ name: string; data: Buffer }> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width * 0.78}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.28}" fill="rgba(255,255,255,0.10)"/>
    <text x="${width * 0.06}" y="${height * 0.86}" font-family="Arial, sans-serif" font-size="${Math.round(Math.min(width, height) * 0.09)}" font-weight="700" fill="rgba(255,255,255,0.92)">${label}</text>
  </svg>`;
  return { name, data: await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer() };
}

async function main() {
  const server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // ── Account ────────────────────────────────────────────────────────────
    const login = await call<{ status: number; body: any }>('POST', '/admin/api/auth/login', { email: EMAIL, password: PASSWORD }, true);
    const session = login.status === 200 ? login.body : await call('POST', '/admin/api/auth/register', { name: 'Demo Admin', email: EMAIL, password: PASSWORD, organizationName: ORG });
    token = session.accessToken;
    const orgId = session.memberships[0].organization.id as string;

    const existing = await call<{ items: { name: string }[] }>('GET', `/admin/api/orgs/${orgId}/projects`);
    if (existing.items.some((p) => p.name === PROJECT)) {
      console.log(`\n"${PROJECT}" already exists — nothing to do.\nSign in with ${EMAIL} (password: see SEED_PASSWORD in .env.example).\n`);
      return;
    }

    // ── Project, locale ────────────────────────────────────────────────────
    const project = await call('POST', `/admin/api/orgs/${orgId}/projects`, { name: PROJECT, description: 'Marketing site, blog and product catalogue', icon: 'globe', color: '#1F6F5C' });
    const envId = project.environments.find((e: { key: string }) => e.key === 'production').id as string;
    const env = `/admin/api/envs/${envId}`;
    const proj = `/admin/api/projects/${project.id}`;
    await call('PATCH', proj, { settings: { siteUrl: 'https://www.acme.example', previewUrl: 'https://www.acme.example/api/preview?token={token}&path={path}' } });
    await call('POST', `${proj}/locales`, { code: 'fr', name: 'French', fallbackCode: 'en' });

    // ── Media ──────────────────────────────────────────────────────────────
    const files = await Promise.all([
      image('hero-workspace.jpg', 1600, 900, '#1F6F5C', '#0F3D33', 'Acme'),
      image('cover-design-systems.jpg', 1200, 675, '#4A6B85', '#22384A', 'Design systems'),
      image('cover-headless.jpg', 1200, 675, '#8A5A2B', '#3F2A14', 'Going headless'),
      image('cover-performance.jpg', 1200, 675, '#6B5B7B', '#322A3B', 'Performance'),
      image('avatar-maya.jpg', 400, 400, '#2E8A73', '#175746', 'MO'),
      image('avatar-jonas.jpg', 400, 400, '#4A6B85', '#2B4257', 'JB'),
      image('product-notebook.jpg', 1000, 1000, '#3A3A37', '#1B1B19', 'Notebook'),
      image('product-bottle.jpg', 1000, 1000, '#B4721A', '#6B430E', 'Bottle'),
    ]);
    const form = new FormData();
    for (const file of files) form.append('files', new Blob([new Uint8Array(file.data)], { type: 'image/jpeg' }), file.name);
    const uploaded = await call<{ items: { id: string; filename: string }[] }>('POST', `${proj}/media`, form);
    const media = Object.fromEntries(uploaded.items.map((a) => [a.filename.replace(/\.jpg$/, ''), a.id]));
    const alts: Record<string, string> = {
      'hero-workspace': 'A calm green workspace backdrop',
      'cover-design-systems': 'Abstract blue cover for the design systems article',
      'cover-headless': 'Abstract brown cover for the headless article',
      'cover-performance': 'Abstract purple cover for the performance article',
      'avatar-maya': 'Portrait of Maya Okafor',
      'avatar-jonas': 'Portrait of Jonas Berg',
      'product-notebook': 'Graphite notebook',
      'product-bottle': 'Amber water bottle',
    };
    for (const [name, id] of Object.entries(media)) {
      await call('PATCH', `${proj}/media/${id}`, { alt: alts[name], tags: [name.split('-')[0]] });
    }

    // ── Components ─────────────────────────────────────────────────────────
    await call('POST', `${env}/components`, {
      apiId: 'seo-meta', displayName: 'SEO metadata', category: 'Shared', icon: 'globe',
      fields: [f('title', 'SEO title', 'text', { config: { maxLength: 60, helpText: 'Shown in search results. Aim for 30–60 characters.' } }), f('description', 'Meta description', 'textarea', { config: { maxLength: 160 } })],
    });
    await call('POST', `${env}/components`, {
      apiId: 'link-item', displayName: 'Link', category: 'Shared', icon: 'navigation',
      fields: [f('label', 'Label', 'text', { required: true, config: { width: 6 } }), f('url', 'URL', 'url', { required: true, config: { width: 6 } })],
    });
    await call('POST', `${env}/components`, {
      apiId: 'pull-quote', displayName: 'Pull quote', category: 'Editorial', icon: 'quote',
      fields: [f('quote', 'Quote', 'textarea', { required: true }), f('attribution', 'Attribution', 'text')],
    });
    await call('POST', `${env}/components`, {
      apiId: 'promo-banner', displayName: 'Promo banner', category: 'Marketing', icon: 'bolt', isBlock: true, description: 'A slim announcement strip',
      fields: [
        f('message', 'Message', 'text', { required: true }),
        f('tone', 'Tone', 'select', { config: { defaultValue: 'info', options: [{ label: 'Info', value: 'info' }, { label: 'Sale', value: 'sale' }] } }),
        f('linkLabel', 'Link label', 'text', { config: { width: 6 } }),
        f('linkUrl', 'Link', 'url', { config: { width: 6 } }),
      ],
    });

    // ── Content types ──────────────────────────────────────────────────────
    const type = (body: Record<string, unknown>) => call('POST', `${env}/content-types`, body);
    await type({
      apiId: 'authors', displayName: 'Authors', singularName: 'Author', pluralName: 'Authors', icon: 'person', options: { titleField: 'name' },
      fields: [
        f('name', 'Name', 'text', { required: true, config: { width: 6 } }),
        f('role', 'Role', 'text', { config: { width: 6 } }),
        f('email', 'Email', 'email', { unique: true, config: { width: 6 } }),
        f('avatar', 'Avatar', 'image', { config: { width: 6 } }),
        f('bio', 'Bio', 'textarea', { config: { maxLength: 400 } }),
      ],
    });
    await type({
      apiId: 'categories', displayName: 'Categories', singularName: 'Category', pluralName: 'Categories', icon: 'category', options: { titleField: 'name' },
      fields: [f('name', 'Name', 'text', { required: true, config: { width: 6 } }), f('slug', 'Slug', 'slug', { unique: true, config: { sourceField: 'name', width: 6 } }), f('color', 'Color', 'color', { config: { width: 6 } })],
    });
    await type({
      apiId: 'articles', displayName: 'Articles', singularName: 'Article', pluralName: 'Articles', icon: 'article',
      description: 'Blog posts and announcements', options: { titleField: 'title', localized: true, requireApproval: true },
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
    await type({
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
    await type({
      apiId: 'faqs', displayName: 'FAQs', singularName: 'FAQ', pluralName: 'FAQs', icon: 'faq', options: { titleField: 'question' },
      fields: [f('question', 'Question', 'text', { required: true }), f('answer', 'Answer', 'textarea', { required: true }), f('order', 'Order', 'integer', { config: { width: 4 } })],
    });
    await type({
      apiId: 'site-settings', displayName: 'Site settings', singularName: 'Site settings', pluralName: 'Site settings', kind: 'SINGLE', icon: 'settings', options: { titleField: 'siteName' },
      fields: [
        f('siteName', 'Site name', 'text', { required: true, config: { width: 6 } }),
        f('tagline', 'Tagline', 'text', { config: { width: 6 } }),
        f('brandColor', 'Brand color', 'color', { config: { width: 6 } }),
        f('supportEmail', 'Support email', 'email', { config: { width: 6 } }),
        f('footerLinks', 'Footer links', 'repeatable', { config: { component: 'link-item', maxItems: 8 } }),
      ],
    });

    // ── Entries ────────────────────────────────────────────────────────────
    const create = async (typeId: string, data: Record<string, unknown>) => (await call(`POST`, `${env}/entries/${typeId}`, { data })) as { id: string; documentId: string };
    const publish = (id: string) => call('POST', `${env}/entry/${id}/publish`, {});
    const approve = async (id: string) => {
      await call('POST', `${env}/entry/${id}/transition`, { action: 'submit' });
      await call('POST', `${env}/entry/${id}/transition`, { action: 'approve', comment: 'Reads well. Approved.' });
    };

    const maya = await create('authors', { name: 'Maya Okafor', role: 'Head of Design', email: 'maya@acme.example', avatar: media['avatar-maya'], bio: 'Maya leads design at Acme and writes about systems, craft and teams.' });
    const jonas = await create('authors', { name: 'Jonas Berg', role: 'Staff Engineer', email: 'jonas@acme.example', avatar: media['avatar-jonas'], bio: 'Jonas works on platform and performance.' });
    for (const a of [maya, jonas]) await publish(a.id);

    const cats: Record<string, { id: string; documentId: string }> = {};
    for (const [name, color] of [['Design', '#1F6F5C'], ['Engineering', '#4A6B85'], ['Company', '#8A5A2B']] as const) {
      cats[name] = await create('categories', { name, color });
      await publish(cats[name].id);
    }

    const articles = [
      { title: 'Design systems that survive contact with reality', cover: 'cover-design-systems', author: maya, category: 'Design', tags: ['design', 'product'], featured: true, readingTime: 7, state: 'published', excerpt: 'Why most design systems stall after launch, and the habits of the ones that keep paying off.' },
      { title: 'Going headless without losing your editors', cover: 'cover-headless', author: jonas, category: 'Engineering', tags: ['engineering'], featured: false, readingTime: 9, state: 'published', excerpt: 'A practical guide to separating content from presentation while keeping the editing experience humane.' },
      { title: 'What we learned shipping a faster homepage', cover: 'cover-performance', author: jonas, category: 'Engineering', tags: ['engineering', 'product'], featured: false, readingTime: 5, state: 'published', excerpt: 'Three changes that cut our largest contentful paint in half.' },
      { title: 'Our approach to accessible color', cover: null, author: maya, category: 'Design', tags: ['design'], featured: false, readingTime: 6, state: 'review', excerpt: 'Contrast is the start, not the finish.' },
      { title: 'Acme is hiring across design and engineering', cover: null, author: maya, category: 'Company', tags: ['company'], featured: false, readingTime: 3, state: 'approved', excerpt: 'Five open roles and how we interview.' },
      { title: 'Notes on the next release', cover: null, author: jonas, category: 'Company', tags: ['company'], featured: false, readingTime: 4, state: 'draft', excerpt: '' },
    ];
    const made: { id: string; documentId: string; state: string }[] = [];
    for (const [i, a] of articles.entries()) {
      const entry = await create('articles', {
        title: a.title,
        excerpt: a.excerpt,
        cover: a.cover ? media[a.cover] : null,
        publishedOn: new Date(Date.now() - (i + 1) * 4 * 86400_000).toISOString().slice(0, 10),
        body: doc(
          a.excerpt || 'Work in progress.',
          'Teams rarely fail for lack of ideas. They fail when the distance between an idea and a published page is too long, or passes through too many hands.',
          'This article walks through what worked for us, what did not, and what we would do differently next time.',
        ),
        author: a.author.documentId,
        category: cats[a.category].documentId,
        tags: a.tags,
        featured: a.featured,
        readingTime: a.readingTime,
        seo: { title: a.title.slice(0, 58), description: a.excerpt.slice(0, 155) },
        highlights: i === 0 ? [{ id: 'hl-1', type: 'pull-quote', props: { quote: 'A design system is a product. Treat it like one or watch it rot.', attribution: 'Maya Okafor' } }] : [],
        editorNotes: i === 3 ? 'Check contrast figures with Jonas before publishing.' : null,
      });
      if (a.state === 'published') {
        await approve(entry.id);
        await publish(entry.id);
      } else if (a.state === 'approved') await approve(entry.id);
      else if (a.state === 'review') await call('POST', `${env}/entry/${entry.id}/transition`, { action: 'submit' });
      made.push({ ...entry, state: a.state });
    }
    // A published article with newer, unpublished edits.
    const edited = await call('GET', `${env}/entry/${made[2].id}`);
    await call('PUT', `${env}/entry/${made[2].id}`, { data: { ...edited.data, title: `${edited.data.title} (updated)` }, lockVersion: edited.lockVersion, note: 'Tightened the headline' });
    await call('POST', `${env}/entry/${made[3].id}/comments`, { body: 'Could we add an example with our own palette?' });

    for (const [name, sku, price, rating, cover] of [
      ['Graphite Notebook', 'NB-0001', 18, 5, 'product-notebook'],
      ['Amber Bottle', 'BT-0002', 24.5, 4, 'product-bottle'],
      ['Field Tote', 'TT-0003', 42, 4, null],
    ] as const) {
      const p = await create('products', {
        name, sku, price, rating, inStock: true,
        description: `## ${name}\n\nMade to be used every day.\n\n- Durable materials\n- Repairable\n- Ships in recycled packaging`,
        gallery: cover ? [media[cover]] : [],
        specs: { weight: '320 g', origin: 'Portugal' },
      });
      if (cover) await publish(p.id);
    }
    for (const [i, [question, answer]] of [
      ['Do you ship internationally?', 'Yes — to more than 40 countries. Delivery takes 3 to 8 working days.'],
      ['Can I return an order?', 'Returns are free within 30 days of delivery.'],
      ['How do I contact support?', 'Write to support@acme.example and we reply within one working day.'],
    ].entries()) {
      const faq = await create('faqs', { question, answer, order: i + 1 });
      await publish(faq.id);
    }
    const settings = await create('site-settings', {
      siteName: 'Acme', tagline: 'Everyday objects, made well.', brandColor: '#1F6F5C', supportEmail: 'support@acme.example',
      footerLinks: [{ label: 'About', url: '/about' }, { label: 'Journal', url: '/journal' }, { label: 'Contact', url: '/contact' }],
    });
    await publish(settings.id);

    // ── Pages ──────────────────────────────────────────────────────────────
    const page = async (data: Record<string, unknown>, parentId?: string) => (await call('POST', `${env}/entries/pages`, { data, parentId })) as { id: string };
    const nav = { id: 'nav', type: 'navigation', props: { brand: 'Acme', links: [{ label: 'Products', url: '/products' }, { label: 'Journal', url: '/journal' }, { label: 'About', url: '/about' }], ctaLabel: 'Contact', ctaUrl: '/contact', sticky: true } };
    const footer = { id: 'footer', type: 'footer', props: { tagline: 'Everyday objects, made well.', columns: [{ title: 'Company', links: [{ label: 'About', url: '/about' }, { label: 'Journal', url: '/journal' }] }, { title: 'Help', links: [{ label: 'Contact', url: '/contact' }, { label: 'FAQ', url: '/about#faq' }] }], copyright: '© Acme Studio' } };

    const home = await page({
      title: 'Home', slug: '', template: 'landing',
      seo: { title: 'Acme — everyday objects, made well', description: 'Thoughtfully designed objects for daily use, built to last and easy to repair.', ogImage: media['hero-workspace'] },
      blocks: [
        nav,
        { id: 'promo', type: 'promo-banner', props: { message: 'Free shipping on orders over $50 this month', tone: 'sale', linkLabel: 'Shop now', linkUrl: '/products' } },
        { id: 'hero', type: 'hero', props: { eyebrow: 'New collection', heading: 'Everyday objects, made well.', subheading: 'Designed in small batches, built to last, and easy to repair.', image: media['hero-workspace'], layout: 'split', primaryLabel: 'Browse products', primaryUrl: '/products', secondaryLabel: 'Our story', secondaryUrl: '/about' }, style: { padding: { top: 96, bottom: 96 } } },
        { id: 'features', type: 'feature-grid', props: { heading: 'Why people stay with Acme', items: [{ icon: 'leaf', title: 'Responsible materials', description: 'Recycled and renewable wherever it performs as well.' }, { icon: 'wrench', title: 'Built to be repaired', description: 'Spare parts for every product we have ever made.' }, { icon: 'truck', title: 'Fast, plastic-free delivery', description: 'Ships within two working days.' }] }, style: { columns: { desktop: 3, tablet: 2, mobile: 1 }, padding: { top: 64, bottom: 64 } } },
        { id: 'products', type: 'product-listing', props: { heading: 'Popular right now', contentType: 'products', limit: 4, sort: 'newest', layout: 'grid', showExcerpt: false } },
        { id: 'stats', type: 'stats', props: { items: [{ value: '40+', label: 'Countries served' }, { value: '98%', label: 'Would recommend' }, { value: '12 yrs', label: 'Average product life' }, { value: '0', label: 'Plastic in packaging' }] }, style: { background: { color: '#F2F1EE' }, padding: { top: 56, bottom: 56 } } },
        { id: 'journal', type: 'blog-listing', props: { heading: 'From the journal', contentType: 'articles', limit: 3, sort: 'newest', layout: 'grid', showExcerpt: true } },
        { id: 'cta', type: 'cta', props: { heading: 'Questions before you order?', body: 'We answer every message within one working day.', primaryLabel: 'Contact us', primaryUrl: '/contact' }, style: { align: 'center', padding: { top: 72, bottom: 72 } } },
        footer,
      ],
    });
    const about = await page({
      title: 'About', slug: 'about',
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
    const team = await page({ title: 'Careers', slug: 'careers', seo: { title: 'Careers at Acme' }, blocks: [nav, { id: 'hero', type: 'hero', props: { heading: 'Do the best work of your career', subheading: 'Five open roles across design and engineering.', layout: 'centered' } }, footer] }, about.id);
    const contact = await page({
      title: 'Contact', slug: 'contact',
      seo: { title: 'Contact Acme', description: 'Get in touch with the Acme team.' },
      blocks: [nav, { id: 'contact', type: 'contact', props: { heading: 'Talk to us', body: 'We reply within one working day.', email: 'support@acme.example', phone: '+1 555 010 2030', showForm: true, formAction: 'https://www.acme.example/api/contact' } }, footer],
    });
    const pricing = await page({
      title: 'Pricing', slug: 'pricing',
      seo: { title: 'Pricing' },
      blocks: [nav, { id: 'pricing', type: 'pricing', props: { heading: 'Simple pricing', plans: [{ name: 'Single', price: '$18', period: 'per item', features: 'One product\nStandard delivery', ctaLabel: 'Shop', ctaUrl: '/products' }, { name: 'Studio set', price: '$72', period: 'per set', features: 'Five products\nFree delivery\nGift wrapping', ctaLabel: 'Shop sets', ctaUrl: '/products', highlighted: true }] } }, footer],
    });
    for (const p of [home, about, contact]) await publish(p.id);
    await call('POST', `${env}/entry/${team.id}/schedule`, { publishAt: new Date(Date.now() + 3 * 86400_000).toISOString() });

    // ── Release, API key ───────────────────────────────────────────────────
    const release = await call('POST', `${env}/releases`, { name: 'Spring launch', description: 'Pricing page and the hiring announcement go live together.' });
    await call('POST', `${env}/releases/${release.id}/items`, { entryIds: [pricing.id, made[4].id] });
    const key = await call('POST', `${proj}/tokens`, { name: 'Website (production)', description: 'Read-only key for the public site', type: 'READ_ONLY', environmentId: envId });
    // Use the key once so the project shows a connected application.
    await fetch(`${base}/api/v1/articles?limit=3`, { headers: { Authorization: `Bearer ${key.token}` } });

    console.log(`
Seeded "${PROJECT}" in organization "${ORG}".

  Sign in:        ${EMAIL}
  Password:       value of SEED_PASSWORD (default documented in apps/api/.env.example)
  Read-only key:  ${key.token}

  Try it:  curl -H "Authorization: Bearer ${key.token}" "http://localhost:${process.env.PORT ?? 4000}/api/v1/pages?path=/"
`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stopWebhooks();
    await closeInfra();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
