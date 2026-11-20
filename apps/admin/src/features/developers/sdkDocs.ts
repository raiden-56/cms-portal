/**
 * Code samples for the SDK documentation screen. Every sample is generated from the project's
 * own API URL and content model, so it can be pasted and run as it stands.
 *
 * Samples never contain a real key: keys are always read from environment variables.
 */
import { type FieldDef, toPascalCase } from '@meridian/shared';
import type { ContentType, SchemaResponse } from '@/lib/types';
import { sampleBody } from './explorer/openapi';
import { CDN_PURGE_RECEIVER, NODE_VERIFY, camel, describeGraphql, graphqlQueryFor } from './snippets';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** `.name`, or `['some-name']` when the field id is not a valid identifier. */
const prop = (name: string) => (IDENTIFIER.test(name) ? `.${name}` : `['${name}']`);
const key = (name: string) => (IDENTIFIER.test(name) ? name : `'${name}'`);
const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function literal(value: unknown): string {
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? `{ ${entries.map(([k, v]) => `${key(k)}: ${literal(v)}`).join(', ')} }` : '{}';
  }
  return String(value);
}

/** Makes a GraphQL document safe to place inside a JavaScript template literal. */
const inTemplate = (text: string) => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

export interface FieldExample {
  /** apiId of the content type the field belongs to. */
  type: string;
  field: string;
  /** False when the project has no such field yet and a conventional name is shown instead. */
  real: boolean;
}

export interface DocsContext {
  apiUrl: string;
  /** True when the project has no collection type yet and the samples use `articles`. */
  example: boolean;
  /** apiId of the collection used in samples. */
  type: string;
  /** Interface name for that type, e.g. `Article`. */
  typeName: string;
  /** Variable name for a list of that type, e.g. `articles`. */
  listVar: string;
  /** Lower-case display name, for prose. */
  label: string;
  titleField: string | null;
  relationField: string | null;
  filter: { field: string; value: string } | null;
  /** Up to two field ids for the `fields` parameter. */
  fieldNames: string[];
  richText: FieldExample;
  image: FieldExample;
  /** apiId of a single type, when the project has one. */
  singleType: string | null;
  /** Object literal used in write samples. */
  writeData: string;
  interfaceBody: string[];
  graphql: { query: string; listField: string };
  defaultLocale: string;
  /** A locale to request explicitly: a second locale when the project has one. */
  locale: string;
  projectSlug: string;
  environmentKey: string;
}

const visibleFields = (type: ContentType): FieldDef[] => [...type.fields].sort((a, b) => a.position - b.position).filter((f) => !f.config.private && f.type !== 'password');

function tsType(field: FieldDef): string {
  const options = field.config.options?.map((o) => quote(o.value)) ?? [];
  switch (field.type) {
    case 'integer':
    case 'decimal':
    case 'rating':
      return 'number';
    case 'boolean':
    case 'checkbox':
      return 'boolean';
    case 'select':
    case 'radio':
      return options.length ? options.join(' | ') : 'string';
    case 'multiselect':
      return options.length ? `(${options.join(' | ')})[]` : 'string[]';
    case 'image':
    case 'video':
    case 'file':
      return 'MediaAsset | null';
    case 'images':
    case 'files':
      return 'MediaAsset[]';
    case 'relation':
      return 'Reference | null';
    case 'relations':
      return 'Reference[]';
    case 'richtext':
      return 'RichText';
    case 'json':
    case 'component':
    case 'geolocation':
      return 'unknown';
    case 'repeatable':
    case 'dynamiczone':
      return 'unknown[]';
    default:
      return 'string';
  }
}

function interfaceLines(type: ContentType): string[] {
  return visibleFields(type).map((field) => {
    const base = tsType(field);
    const nullable = !field.required && !base.endsWith('| null') && !base.endsWith('[]') && base !== 'unknown';
    return `  ${key(field.apiId)}${field.required ? '' : '?'}: ${base}${nullable ? ' | null' : ''};`;
  });
}

function findField(types: ContentType[], preferred: ContentType, fieldType: FieldDef['type'], fallback: string): FieldExample {
  for (const type of [preferred, ...types.filter((t) => t !== preferred)]) {
    const field = visibleFields(type).find((f) => f.type === fieldType);
    if (field) return { type: type.apiId, field: field.apiId, real: true };
  }
  return { type: preferred.apiId, field: fallback, real: false };
}

function writeSample(type: ContentType): string {
  const one = sampleBody(type, 'PATCH') as { data: Record<string, unknown> };
  if (Object.keys(one.data).length > 0) return literal(one.data);
  const full = sampleBody(type, 'POST') as { data: Record<string, unknown> };
  const first = Object.entries(full.data)[0];
  return first ? literal({ [first[0]]: first[1] }) : '{}';
}

const FALLBACK_QUERY = `query Articles($limit: Int = 5) {
  articles(limit: $limit, sort: "-publishedAt") {
    total
    items {
      id
      title
      slug
    }
  }
}`;

export interface DocsWorkspace {
  defaultLocale: string;
  locales: string[];
  projectSlug: string;
  environmentKey: string;
}

/** Derives everything the samples mention from the project's real content model. */
export function docsContext(apiUrl: string, schema: SchemaResponse | undefined, workspace: DocsWorkspace): DocsContext {
  const shared = {
    apiUrl,
    defaultLocale: workspace.defaultLocale,
    locale: workspace.locales.find((code) => code !== workspace.defaultLocale) ?? workspace.defaultLocale,
    projectSlug: workspace.projectSlug,
    environmentKey: workspace.environmentKey,
  };
  const custom = (schema?.types ?? []).filter((t) => !t.isSystem);
  const type = custom.find((t) => t.kind === 'COLLECTION');
  const singleType = custom.find((t) => t.kind === 'SINGLE')?.apiId ?? null;

  if (!schema || !type) {
    return {
      ...shared,
      example: true,
      type: 'articles',
      typeName: 'Article',
      listVar: 'articles',
      label: 'articles',
      titleField: 'title',
      relationField: 'author',
      filter: { field: 'category', value: 'news' },
      fieldNames: ['title', 'slug'],
      richText: { type: 'articles', field: 'body', real: false },
      image: { type: 'articles', field: 'cover', real: false },
      singleType,
      writeData: "{ title: 'Hello from the API' }",
      interfaceBody: ['  title: string;', '  slug: string;', "  category?: 'news' | 'guides' | null;", '  body?: RichText | null;', '  cover?: MediaAsset | null;', '  author?: Reference | null;'],
      graphql: { query: FALLBACK_QUERY, listField: 'articles' },
    };
  }

  const fields = visibleFields(type);
  const texts = fields.filter((f) => ['text', 'slug', 'uid', 'textarea', 'email', 'url'].includes(f.type));
  const titleField = type.options.titleField ?? fields.find((f) => f.type === 'text')?.apiId ?? null;
  const choice = fields.find((f) => (f.type === 'select' || f.type === 'radio') && f.config.options?.length);
  const flag = fields.find((f) => f.type === 'boolean');
  const ref = describeGraphql(schema).find((r) => r.apiId === type.apiId);
  const fieldNames = [...new Set([titleField, ...texts.map((f) => f.apiId)].filter((name): name is string => !!name))].slice(0, 2);

  return {
    ...shared,
    example: false,
    type: type.apiId,
    typeName: toPascalCase(type.singularName) || toPascalCase(type.apiId),
    listVar: camel(type.apiId) || 'entries',
    label: type.displayName.toLowerCase(),
    titleField,
    relationField: fields.find((f) => f.type === 'relation' || f.type === 'relations')?.apiId ?? null,
    filter: choice ? { field: choice.apiId, value: choice.config.options?.[0]?.value ?? '' } : flag ? { field: flag.apiId, value: 'true' } : null,
    fieldNames,
    richText: findField(custom, type, 'richtext', 'body'),
    image: findField(custom, type, 'image', 'cover'),
    singleType,
    writeData: writeSample(type),
    interfaceBody: interfaceLines(type),
    graphql: { query: ref ? graphqlQueryFor(ref) : FALLBACK_QUERY, listField: ref?.listField ?? camel(type.apiId) },
  };
}

/** Every code sample on the documentation screen, keyed by where it is shown. */
export function docsCode(ctx: DocsContext) {
  const { apiUrl: api, type: t, listVar: v } = ctx;
  const auth = '-H "Authorization: Bearer $MERIDIAN_API_KEY"';
  const title = `entry${prop(ctx.titleField ?? 'id')}`;
  const wsUrl = api.replace(/^http/, 'ws');
  const isFlag = ctx.filter?.value === 'true' || ctx.filter?.value === 'false';
  const sdkFilter = [...(ctx.filter ? [`${key(ctx.filter.field)}: ${isFlag ? ctx.filter.value : quote(ctx.filter.value)}`] : []), "publishedAt: { gte: '2026-01-01' }"].join(', ');
  const restFilter = [...(ctx.filter ? [`filter[${ctx.filter.field}]=${encodeURIComponent(ctx.filter.value)}`] : []), 'filter[publishedAt][gte]=2026-01-01'].join('&');
  const populateSdk = ctx.relationField ? `[${quote(ctx.relationField)}]` : "'*'";
  const populateRest = ctx.relationField ?? '*';
  const rich = ctx.richText;
  const image = ctx.image;
  const compactQuery = ctx.graphql.query.replace(/\s+/g, ' ').trim();

  // ─── Quick start ───────────────────────────────────────────────────────────
  const install = 'npm install @meridian/sdk';
  const env = `MERIDIAN_URL=${api}
# Created under Developers → API keys. Keep real keys out of version control.
MERIDIAN_API_KEY=mrd_ro_your_key`;
  const client = `import { createCMSClient } from '@meridian/sdk';

export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!, // ${api}
  apiKey: process.env.MERIDIAN_API_KEY,
});`;
  const firstRequest = `import { cms } from './lib/cms';

const { data: ${v}, meta } = await cms.content('${t}').find({ limit: 10, sort: '-publishedAt' });

console.log(\`\${meta.total} ${ctx.label}\`);
for (const entry of ${v}) console.log(entry.id, ${title});`;
  const firstCurl = `curl ${auth} \\
  "${api}/api/v1/${t}?limit=10&sort=-publishedAt"`;
  const listResponse = `{
  "data": [
    {
      "id": "8f0c…",
      "type": "${t}",
      "locale": "${ctx.defaultLocale}",
      "createdAt": "…",
      "updatedAt": "…",
      "publishedAt": "…"${ctx.titleField ? `,\n      "${ctx.titleField}": "…"` : ''}
    }
  ],
  "meta": { "total": 42, "limit": 10, "offset": 0, "page": 1, "pageCount": 5 }
}`;

  // ─── Authentication ────────────────────────────────────────────────────────
  const rawHeader = `curl ${auth} "${api}/api/v1/"`;
  const browserClient = `import { createCMSClient } from '@meridian/sdk';

// A read-only key (mrd_ro_…) can only read published content, so it may ship to browsers.
export const cms = createCMSClient({
  baseURL: '${api}',
  apiKey: import.meta.env.VITE_MERIDIAN_API_KEY,
});`;
  const serverClient = `import { createCMSClient } from '@meridian/sdk';

// Preview (mrd_pv_…) and read/write (mrd_rw_…) keys are secrets: server-side code only.
// The client throws if one of them is constructed in a browser.
export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});`;
  const writes = `import { createCMSClient } from '@meridian/sdk';

// Needs a read/write key. Writes pass the same validation, versioning and audit log as the admin.
const admin = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_WRITE_KEY!,
});

const ${v} = admin.content('${t}');
const entry = await ${v}.create(${ctx.writeData}, { publish: false });
await ${v}.update(entry.id, ${ctx.writeData}, { publish: true }); // changes only the fields you pass
await ${v}.unpublish(entry.id);
await ${v}.delete(entry.id); // moves it to the trash`;

  // ─── Fetching content ──────────────────────────────────────────────────────
  const fetchSdk = [
    `const ${v} = cms.content('${t}');`,
    '',
    `const { data, meta } = await ${v}.find({`,
    '  // Pagination: limit is at most 100 (default 25); use page or offset',
    '  limit: 20,',
    '  page: 2,',
    '  // A leading "-" sorts descending; pass an array to sort by several fields',
    "  sort: '-publishedAt',",
    '  // Case-insensitive search across text fields',
    "  search: 'design',",
    '  // Equals, or an operator: eq ne gt gte lt lte contains startsWith in nin null',
    `  filter: { ${sdkFilter} },`,
    "  // Expand relations, nested with dots up to 4 levels; '*' expands every first-level relation",
    `  populate: ${populateSdk},`,
    ...(ctx.fieldNames.length ? ['  // Return only these fields (system attributes are always included)', `  fields: [${ctx.fieldNames.map(quote).join(', ')}],`] : []),
    "  // Falls back to the locale's fallback, then the project default",
    `  locale: ${quote(ctx.locale)},`,
    '});',
    'console.log(meta.total, meta.page, meta.pageCount);',
    '',
    '// One entry by id or slug. Resolves to null when it does not exist or is not published.',
    `const entry = await ${v}.findOne('my-slug', { populate: ${populateSdk} });`,
    '',
    '// Every matching entry: the SDK walks the pages for you.',
    `for await (const item of ${v}.all({ filter: { ${sdkFilter} } })) {`,
    '  console.log(item.id);',
    '}',
    ...(ctx.singleType ? ['', '// A single type returns its one entry (null until it is published).', `const single = await cms.content('${ctx.singleType}').single();`] : []),
  ].join('\n');
  const fetchRest = [
    '# List, newest first, second page',
    `curl ${auth} \\`,
    `  "${api}/api/v1/${t}?limit=20&page=2&sort=-publishedAt"`,
    '',
    '# Filter: filter[field]=value is "equals"; filter[field][operator]=value for the rest.',
    '# -g stops curl from interpreting the square brackets.',
    `curl -g ${auth} \\`,
    `  "${api}/api/v1/${t}?${restFilter}"`,
    '',
    '# Search, expand relations, trim the payload and pick a locale',
    `curl ${auth} \\`,
    `  "${api}/api/v1/${t}?search=design&populate=${populateRest}${ctx.fieldNames.length ? `&fields=${ctx.fieldNames.join(',')}` : ''}&locale=${ctx.locale}"`,
    '',
    '# One entry by id or slug',
    `curl ${auth} \\`,
    `  "${api}/api/v1/${t}/my-slug"`,
    ...(ctx.singleType ? ['', '# A single type returns its one entry', `curl ${auth} \\`, `  "${api}/api/v1/${ctx.singleType}"`] : []),
  ].join('\n');

  // ─── Pages and blocks ──────────────────────────────────────────────────────
  const pageSdk = `// Resolve a URL to a page. null when no published page lives at that path.
const page = await cms.pages.getByPath('/');

if (page) {
  console.log(page.title, page.path, page.seo.title);
  console.log(page.blocks.map((block) => block.type));
}

// Pages can also be listed, filtered and sorted like any content type.
const { data: pages } = await cms.pages.list({ sort: 'title', limit: 50 });`;
  const blocks = `import type { ComponentType } from 'react';
import type { Block } from '@meridian/sdk';
import { FeatureGrid } from './blocks/FeatureGrid';
import { Hero } from './blocks/Hero';
import { RichText } from './blocks/RichText';

// Map each block type coming from Meridian to one of YOUR components.
// Meridian stores structured data only; how a "hero" looks is entirely up to you.
const components: Record<string, ComponentType<any>> = {
  hero: Hero,
  text: RichText,
  'feature-grid': FeatureGrid,
};

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block) => {
        const Component = components[block.type];
        if (!Component) return null; // a type this frontend does not implement: skip it, never crash
        return (
          <Component key={block.id} {...block.props} blockStyle={block.style}>
            {block.children?.length ? <Blocks blocks={block.children} /> : null}
          </Component>
        );
      })}
    </>
  );
}`;
  const pageRoute = `import { notFound } from 'next/navigation';
import { Blocks } from '@/components/Blocks';
import { cms } from '@/lib/cms';

// One catch-all route renders every page built in the page builder.
export default async function CmsPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const page = await cms.pages.getByPath('/' + path.join('/'));
  if (!page) notFound();

  return <Blocks blocks={page.blocks} />;
}`;
  const pageRest = `# Resolve a URL path
curl ${auth} \\
  "${api}/api/v1/pages?path=/"

# By id or slug
curl ${auth} \\
  "${api}/api/v1/pages/{id-or-slug}"`;
  const pageResponse = `{
  "data": {
    "id": "…",
    "type": "pages",
    "title": "…",
    "slug": "…",
    "path": "/",
    "parent": null,
    "template": "default",
    "seo": { "title": "…", "description": "…", "ogImage": { "url": "…" } },
    "blocks": [
      {
        "id": "b1",
        "type": "hero",
        "props": { "heading": "…", "primaryLabel": "…", "primaryUrl": "…" },
        "style": { "align": "center", "padding": { "top": 96, "bottom": 96 } }
      },
      {
        "id": "b2",
        "type": "section",
        "props": {},
        "children": [{ "id": "b3", "type": "text", "props": { "…": "…" } }]
      }
    ]
  }
}`;

  // ─── Rich text ─────────────────────────────────────────────────────────────
  const richHtml = `// richtext: 'html' returns sanitized HTML instead of the JSON document.
const entry = await cms.content('${rich.type}').findOne('my-slug', { richtext: 'html' });

export function RichTextHtml({ html }: { html: string }) {
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

// <RichTextHtml html={entry${prop(rich.field)}} />`;
  const richJson = `// Default: a structured JSON document that you render with your own components.
const entry = await cms.content('${rich.type}').findOne('my-slug');

// entry${prop(rich.field)} →
// { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '…' }] }] }

type RichTextNode = { type: string; text?: string; content?: RichTextNode[] };

// Walk the tree yourself, for example to build a plain-text excerpt.
export function plainText(node: RichTextNode): string {
  return node.text ?? (node.content ?? []).map(plainText).join(' ');
}`;
  const richRest = `# JSON document (default)
curl ${auth} \\
  "${api}/api/v1/${rich.type}/my-slug"

# Sanitized HTML
curl ${auth} \\
  "${api}/api/v1/${rich.type}/my-slug?richtext=html"`;

  // ─── Media ─────────────────────────────────────────────────────────────────
  const mediaPattern = `${api}/media/{id}/{revision}/{filename}?w=800&h=600&fit=cover&format=webp&q=75`;
  const mediaSdk = `const entry = await cms.content('${image.type}').findOne('my-slug');

// Media fields are always expanded to objects: { id, url, width, height, alt, … }
const image = entry?${IDENTIFIER.test(image.field) ? `.${image.field}` : `.['${image.field}']`};
if (image) {
  const src = cms.media.url(image, { w: 1200, h: 630, fit: 'cover', format: 'webp', q: 75 });

  // Responsive images: one URL per width. Variants are generated once, then served as plain files.
  const srcSet = [480, 960, 1440].map((w) => \`\${cms.media.url(image, { w, format: 'webp' })} \${w}w\`).join(', ');
}`;
  const mediaImg = `<img
  src="{url}?w=960&format=webp&q=75"
  srcset="{url}?w=480&format=webp 480w, {url}?w=960&format=webp 960w, {url}?w=1440&format=webp 1440w"
  sizes="(min-width: 960px) 960px, 100vw"
  width="{width}" height="{height}" alt="{alt}" loading="lazy"
/>`;

  // ─── Drafts and preview ────────────────────────────────────────────────────
  const previewRoute = `import { cms } from '@/lib/cms';

// Preview URL in Settings → Project:
//   https://www.example.com/api/preview?token={token}&path={path}
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return new Response('Missing preview token', { status: 400 });

  // Exchanges the one-hour token for exactly that draft. No API key is involved.
  const draft = await cms.preview(token);
  return Response.json(draft);
}`;
  const previewKey = `import { createCMSClient } from '@meridian/sdk';

// A preview key (mrd_pv_…) on a staging server sees working copies of everything.
const preview = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_PREVIEW_KEY!,
});

const { data: drafts } = await preview.content('${t}').find({ status: 'draft' });
const draft = await preview.content('${t}').findOne('my-slug', { status: 'draft' });`;
  const previewRest = `# Exchange a preview token from the admin (no API key)
curl "${api}/api/v1/preview?token=$PREVIEW_TOKEN"

# Drafts with a preview key
curl -H "Authorization: Bearer $MERIDIAN_PREVIEW_KEY" \\
  "${api}/api/v1/${t}?status=draft"`;

  // ─── GraphQL ───────────────────────────────────────────────────────────────
  const graphqlQuery = ctx.graphql.query;
  const graphqlSdk = `const query = /* GraphQL */ \`
${inTemplate(ctx.graphql.query)}
\`;

// Resolves to the "data" object; throws MeridianError when the response has errors.
const data = await cms.graphql<{ ${ctx.graphql.listField}: { total: number; items: { id: string }[] } }>(query, { limit: 5 });
console.log(data.${ctx.graphql.listField}.total);`;
  const graphqlCurl = `curl -X POST "${api}/api/v1/graphql" \\
  ${auth} \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ query: compactQuery, variables: { limit: 5 } }).replace(/'/g, "'\\''")}'`;

  // ─── Webhooks ──────────────────────────────────────────────────────────────
  const webhookPayload = `{
  "id": "…",
  "event": "content.published",
  "project": "${ctx.projectSlug}",
  "environment": "${ctx.environmentKey}",
  "contentType": "${t}",
  "documentId": "…",
  "slug": "…",
  "locale": "${ctx.defaultLocale}",
  "timestamp": "2026-01-01T10:00:00.000Z"
}`;
  const webhookHeaders = `X-Meridian-Signature:  sha256=HMAC_SHA256(secret, timestamp + "." + rawBody)
X-Meridian-Timestamp:  unix seconds
X-Meridian-Delivery:   stable id across retries; de-duplicate on it
X-Meridian-Event:      event name, e.g. content.published`;
  const webhookNext = `import { revalidatePath, revalidateTag } from 'next/cache';
import { parseWebhook } from '@meridian/sdk/webhooks';

interface MeridianEvent {
  event: string;
  contentType?: string;
  path?: string | null;
}

export async function POST(request: Request) {
  let hook;
  try {
    // Checks X-Meridian-Signature against the raw body and rejects stale timestamps.
    hook = await parseWebhook<MeridianEvent>(request, process.env.MERIDIAN_WEBHOOK_SECRET!);
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }

  // Refresh whatever the event touched, e.g. fetches tagged '${t}'.
  if (hook.event.contentType) revalidateTag(hook.event.contentType);
  if (hook.event.path) revalidatePath(hook.event.path);

  return Response.json({ revalidated: true, delivery: hook.deliveryId });
}`;
  const webhookTagged = `import { createCMSClient } from '@meridian/sdk';

// Tag the requests so the webhook route can revalidate exactly these.
export const ${v}Client = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY,
  fetchOptions: { next: { tags: ['${t}'] } },
});`;

  // ─── Real-time ─────────────────────────────────────────────────────────────
  const realtimeSdk = `// Opens a WebSocket to /api/v1/events and reconnects automatically.
const stop = cms.subscribe(
  (event) => {
    if (event.event === 'content.published' && event.contentType === '${t}') {
      console.log('Published', event.documentId, event.slug);
    }
  },
  { onStatus: (status) => console.log('Live events:', status) }, // connecting | open | closed
);

// Later, for example when the component unmounts:
stop();`;
  const realtimeNode = `import WebSocket from 'ws';

// Node has no global WebSocket in older versions: pass an implementation.
const stop = cms.subscribe((event) => console.log(event.event, event.contentType), { WebSocket });`;
  const realtimeRaw = `const socket = new WebSocket('${wsUrl}/api/v1/events');

// The first message authenticates. The key is never part of the URL.
socket.addEventListener('open', () => {
  socket.send(JSON.stringify({ type: 'auth', token: MERIDIAN_API_KEY }));
});

socket.addEventListener('message', (message) => {
  const frame = JSON.parse(message.data);
  // { "type": "event", "data": { "event": "content.published", "contentType": "${t}", … } }
  if (frame.type === 'event') console.log(frame.data.event, frame.data.contentType, frame.data.documentId);
});`;

  // ─── Caching ───────────────────────────────────────────────────────────────
  const cacheCurl = `# The response carries an ETag
curl -i ${auth} \\
  "${api}/api/v1/${t}"

# Send it back: 304 Not Modified, with no body, while nothing has changed
curl -i ${auth} \\
  -H 'If-None-Match: "<etag from the first response>"' \\
  "${api}/api/v1/${t}"`;
  const cacheSdk = `import { createCMSClient } from '@meridian/sdk';

// Default: every request revalidates with If-None-Match, so a publish shows on the next request.
// With ttlMs, responses are served from memory for that long before they are revalidated.
const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY,
  cache: { ttlMs: 60_000 },
});

// Forget cached responses the moment Meridian reports a change.
cms.subscribe((event) => cms.cache.clear(event.contentType));`;

  // ─── Errors ────────────────────────────────────────────────────────────────
  const errorShape = `{
  "error": {
    "code": "validation_failed",
    "message": "Some fields are invalid",
    "details": [{ "path": "…", "message": "…", "code": "min" }],
    "requestId": "…"
  }
}`;
  const errorSdk = `import { MeridianError } from '@meridian/sdk';

try {
  const { data } = await cms.content('${t}').find({ limit: 10 });
} catch (err) {
  if (err instanceof MeridianError) {
    console.error(err.status, err.code, err.message, err.requestId);
    if (err.status === 422) console.error(err.details); // field-level problems
    if (err.retryable) {
      // 429, 5xx or a network failure: safe to try again later.
      // Reads are already retried twice with backoff; writes are never retried.
    }
  }
  throw err;
}`;
  const errorFetch = `async function meridian(path: string, attempt = 0): Promise<unknown> {
  const response = await fetch(\`${api}/api/v1\${path}\`, {
    headers: { Authorization: \`Bearer \${process.env.MERIDIAN_API_KEY}\` },
  });

  // Rate limited: wait as long as the server asks, then try again.
  if (response.status === 429 && attempt < 3) {
    const seconds = Number(response.headers.get('Retry-After') ?? 1);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return meridian(path, attempt + 1);
  }

  const body = await response.json();
  if (!response.ok) {
    throw new Error(\`\${body.error.code}: \${body.error.message} (request \${body.error.requestId})\`);
  }
  return body;
}

const ${v} = await meridian('/${t}?limit=10');`;

  // ─── TypeScript ────────────────────────────────────────────────────────────
  const needs = ctx.interfaceBody.join('\n');
  const typesInterface = [
    `import type { ${needs.includes('MediaAsset') ? 'Entry, MediaAsset' : 'Entry'} } from '@meridian/sdk';`,
    ...(needs.includes('Reference') ? ['', '/** A relation that has not been expanded with populate. */', 'interface Reference {', '  id: string;', '  type: string;', '}'] : []),
    ...(needs.includes('RichText')
      ? ['', "/** A JSON document by default; an HTML string when you ask for richtext: 'html'. */", 'type RichText = { type: string; text?: string; content?: RichText[] } | string;']
      : []),
    '',
    `export interface ${ctx.typeName} {`,
    ...(ctx.interfaceBody.length ? ctx.interfaceBody : ['  // This content type has no fields yet.']),
    '}',
    '',
    `// Entry<${ctx.typeName}> adds the system attributes: id, type, locale, createdAt, updatedAt, publishedAt.`,
    `export type ${ctx.typeName}Entry = Entry<${ctx.typeName}>;`,
  ].join('\n');
  const typesUsage = `import type { Block, ListResult, Page } from '@meridian/sdk';
import type { ${ctx.typeName}, ${ctx.typeName}Entry } from './types';

const ${v} = cms.content<${ctx.typeName}>('${t}');

const list: ListResult<${ctx.typeName}Entry> = await ${v}.find({ limit: 10 });
const one: ${ctx.typeName}Entry | null = await ${v}.findOne('my-slug');

const page: Page | null = await cms.pages.getByPath('/');
const blocks: Block[] = page?.blocks ?? [];`;
  const typesOpenapi = `# The OpenAPI 3.1 document describes this environment's content model.
curl ${auth} \\
  "${api}/api/v1/openapi.json" -o openapi.json

# Generate types for every endpoint and schema
npx openapi-typescript openapi.json -o src/meridian.d.ts`;

  return {
    install,
    env,
    client,
    firstRequest,
    firstCurl,
    listResponse,
    rawHeader,
    browserClient,
    serverClient,
    writes,
    fetchSdk,
    fetchRest,
    pageSdk,
    blocks,
    pageRoute,
    pageRest,
    pageResponse,
    richHtml,
    richJson,
    richRest,
    mediaPattern,
    mediaSdk,
    mediaImg,
    previewRoute,
    previewKey,
    previewRest,
    graphqlQuery,
    graphqlSdk,
    graphqlCurl,
    webhookPayload,
    webhookHeaders,
    webhookNext,
    webhookTagged,
    webhookNode: NODE_VERIFY,
    realtimeSdk,
    realtimeNode,
    realtimeRaw,
    cacheCurl,
    cacheSdk,
    cdnPurge: CDN_PURGE_RECEIVER,
    errorShape,
    errorSdk,
    errorFetch,
    typesInterface,
    typesUsage,
    typesOpenapi,
  };
}

export type DocsCode = ReturnType<typeof docsCode>;
