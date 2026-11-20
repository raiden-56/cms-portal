# @meridian/sdk

JavaScript / TypeScript client for the Meridian content delivery API. No dependencies; runs wherever `fetch` exists (Node 18+, browsers, edge runtimes, React Native).

```bash
npm install @meridian/sdk
```

```ts
import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,      // e.g. https://cms.example.com
  apiKey: process.env.MERIDIAN_API_KEY,    // created under Developers → API Keys
});

const pages = await cms.pages.list();
const page = await cms.pages.getByPath('/about');          // or getBySlug('about-us')
const articles = await cms.content('articles').find({
  limit: 10,
  sort: '-publishedOn',
  filter: { category: 'news', readingTime: { lte: 8 } },
  populate: ['author'],
});
```

## Keys and where they may run

| Key type | Prefix | Reads | Use it in |
| --- | --- | --- | --- |
| Read-only | `mrd_ro_` | Published content only | Browser or server |
| Preview | `mrd_pv_` | Published content and drafts (`status: 'draft'`) | Server only |
| Read/write | `mrd_rw_` | Everything, plus create / update / publish / delete | Server only |

The client throws if a preview or read/write key is constructed in a browser. Those keys are secrets; anyone can read what ships in a bundle.

## Reading content

```ts
const articles = cms.content<Article>('articles');

await articles.find({ page: 2, limit: 20, search: 'design', fields: ['title', 'slug'] });
await articles.findOne('my-slug');                  // id or slug → entry, or null
await cms.content<Settings>('site-settings').single();   // single types

for await (const article of articles.all({ filter: { featured: true } })) {
  // walks every page for you
}
```

Filters: `{ field: value }` (equals), `{ field: { gte: 10, lt: 50 } }`, `{ field: ['a', 'b'] }` (in), `{ field: null }` (is empty).
Operators: `eq ne gt gte lt lte contains startsWith in nin null`.

`findOne`, `single` and the `pages.get*` methods resolve to `null` when the content does not exist or is not published, so optional content needs no try/catch. Everything else throws `MeridianError` (`status`, `code`, `details`, `requestId`, `retryable`).

### Pages and blocks

A page is data: a tree of blocks, each `{ id, type, props, style, children }`. Your application decides how each `type` looks.

```tsx
const components = { hero: Hero, text: RichText, 'feature-grid': FeatureGrid /* … */ };

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block) => {
    const Component = components[block.type];
    if (!Component) return null;                       // ignore types this frontend does not implement
    return (
      <Component key={block.id} {...block.props} blockStyle={block.style}>
        {block.children && <Blocks blocks={block.children} />}
      </Component>
    );
  });
}
```

### Images

```ts
cms.media.url(article.cover, { w: 1200, h: 630, fit: 'cover', format: 'webp', q: 75 });
```

### GraphQL

```ts
const data = await cms.graphql<{ articles: { items: { title: string }[] } }>(
  `query ($limit: Int) { articles(limit: $limit, sort: "-publishedOn") { items { title slug } } }`,
  { limit: 5 },
);
```

## Writing content (server only)

```ts
const admin = createCMSClient({ baseURL, apiKey: process.env.MERIDIAN_WRITE_KEY });
const entry = await admin.content('articles').create({ title: 'Hello' }, { publish: true });
await admin.content('articles').update(entry.id, { featured: true }, { publish: true });
await admin.content('articles').unpublish(entry.id);
await admin.content('articles').delete(entry.id);
```

## Staying fresh

By default every request revalidates with the server using `ETag` / `If-None-Match`, so a publish is visible on the next request and unchanged content costs a 304. To serve from memory for a while, set `cache: { ttlMs }` and clear it when Meridian tells you something changed:

```ts
// app/api/revalidate/route.ts (Next.js)
import { parseWebhook } from '@meridian/sdk/webhooks';
import { revalidatePath, revalidateTag } from 'next/cache';

export async function POST(request: Request) {
  let hook;
  try {
    hook = await parseWebhook<{ contentType: string; path?: string }>(request, process.env.MERIDIAN_WEBHOOK_SECRET!);
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }
  revalidateTag(`cms:${hook.event.contentType}`);
  if (hook.event.path) revalidatePath(hook.event.path);
  return Response.json({ revalidated: true });
}
```

Deliveries are retried with the same `X-Meridian-Delivery` id; use it to ignore duplicates. Meridian's own cache is invalidated the moment content is published — but if you put a CDN or framework cache in front of your site, that layer only updates when your webhook purges or revalidates it.

Live updates over WebSocket:

```ts
const stop = cms.subscribe((event) => {
  if (event.event === 'content.published') refresh(event.contentType);
});
```

In Node, pass an implementation: `cms.subscribe(handler, { WebSocket: (await import('ws')).default })`.

## Preview

The admin issues short-lived preview tokens for a single entry. Exchange one for the draft without any API key:

```ts
const draft = await cms.preview(searchParams.get('token')!);
```

## Options

| Option | Default | |
| --- | --- | --- |
| `baseURL` | — | Origin of the Meridian API |
| `apiKey` | — | API key |
| `locale` | project default | Locale for every request |
| `timeoutMs` | `15000` | Per-request timeout |
| `retries` | `2` | Retries for failed or rate-limited reads (never for writes) |
| `cache` | `{ ttlMs: 0, max: 200 }` | In-memory cache; `false` disables it |
| `fetch` / `fetchOptions` | global fetch | Custom fetch and extra init, e.g. `{ next: { tags: ['cms'] } }` |
