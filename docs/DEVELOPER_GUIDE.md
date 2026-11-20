# Developer integration guide

How to connect a website or application to Meridian. Everything here is also available, with your project's real content types filled in, under **Developers → SDK Documentation** and **API Explorer** in the admin.

- [1. Get a key](#1-get-a-key)
- [2. Read content](#2-read-content)
- [3. Pages and blocks](#3-pages-and-blocks)
- [4. GraphQL](#4-graphql)
- [5. Media](#5-media)
- [6. Drafts and preview](#6-drafts-and-preview)
- [7. Staying in sync: webhooks and live events](#7-staying-in-sync)
- [8. Writing content](#8-writing-content)
- [9. Errors, limits and caching](#9-errors-limits-and-caching)

## 1. Get a key

**Developers → API Keys → Create API key.** A key belongs to one project *and one environment*; the key alone decides which content you see.

| Type | Prefix | Can read | Where it may live |
| --- | --- | --- | --- |
| Read-only | `mrd_ro_` | Published content | Browser or server |
| Preview | `mrd_pv_` | Published content + drafts | Server only |
| Read/write | `mrd_rw_` | Everything, and can change content | Server only |

Keys are shown once and stored only as a hash. You can restrict a key to specific browser origins, give it an expiry and a rate limit, rotate it, or revoke it. Preview and read/write keys are refused when a request carries a browser `Origin` that is not on the key's allow-list.

```bash
curl -H "Authorization: Bearer $MERIDIAN_API_KEY" https://cms.example.com/api/v1/
```

## 2. Read content

Every content type gets endpoints named after its API identifier.

```
GET /api/v1/articles                 list
GET /api/v1/articles/{id-or-slug}    one entry
GET /api/v1/site-settings            a single type returns its one entry
GET /api/v1/content-types            the content model
GET /api/v1/openapi.json             OpenAPI 3.1 for this environment
```

A list response:

```json
{
  "data": [
    { "id": "8f0c…", "type": "articles", "locale": "en",
      "createdAt": "…", "updatedAt": "…", "publishedAt": "…",
      "title": "Going headless", "slug": "going-headless",
      "cover": { "id": "…", "url": "https://cms.example.com/media/…/1/cover.jpg", "width": 1200, "height": 675, "alt": "…" },
      "author": { "id": "…", "type": "authors" } }
  ],
  "meta": { "total": 42, "limit": 25, "offset": 0, "page": 1, "pageCount": 2 }
}
```

`id` is the document id — stable across edits and shared by every locale variant. Media fields are always expanded to objects with URLs. Relations are references (`{ id, type }`) until you ask for them.

| Parameter | Example | Meaning |
| --- | --- | --- |
| `limit`, `offset` / `page` | `limit=20&page=2` | Pagination (limit ≤ 100) |
| `sort` | `sort=-publishedOn,title` | `-` = descending |
| `search` | `search=design` | Case-insensitive, across text fields |
| `filter[field]` | `filter[category]=news` | Equals |
| `filter[field][op]` | `filter[price][gte]=10` | `eq ne gt gte lt lte contains startsWith in nin null` |
| `populate` | `populate=author,category.parent` or `*` | Expand relations (up to 4 levels) |
| `fields` | `fields=title,slug` | Return only these fields |
| `locale` | `locale=fr` | Falls back to the locale's fallback, then the default |
| `richtext` | `richtext=html` | Rich text as sanitized HTML instead of a JSON document |
| `status` | `status=draft` | Drafts — preview or read/write keys only |

With the SDK:

```ts
import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({ baseURL: process.env.MERIDIAN_URL!, apiKey: process.env.MERIDIAN_API_KEY });

const { data, meta } = await cms.content('articles').find({
  filter: { category: 'news', readingTime: { lte: 8 } },
  sort: '-publishedOn',
  populate: ['author'],
  limit: 10,
});
const article = await cms.content('articles').findOne('going-headless'); // null if missing or unpublished
```

Fields marked **private** in the content model, and password fields, are never returned by the delivery API.

## 3. Pages and blocks

Pages are built by editors in the page builder and delivered as structured data:

```
GET /api/v1/pages?path=/company/team     resolve a URL
GET /api/v1/pages/{id-or-slug}
GET /api/v1/pages                        list (filter, sort, paginate like any type)
```

```json
{
  "data": {
    "id": "…", "type": "pages", "title": "Team", "slug": "team", "path": "/company/team",
    "parent": { "id": "…", "path": "/company" }, "template": "default",
    "seo": { "title": "…", "description": "…", "ogImage": { "url": "…" } },
    "blocks": [
      { "id": "b1", "type": "hero",
        "props": { "heading": "Meet the team", "primaryLabel": "Join us", "primaryUrl": "/careers" },
        "style": { "align": "center", "padding": { "top": 96, "bottom": 96 } } },
      { "id": "b2", "type": "section", "props": {}, "children": [
        { "id": "b3", "type": "team", "props": { "members": [ … ] } } ] }
    ]
  }
}
```

**Meridian does not render pages for you, on purpose.** A block is `{ id, type, props, style, children }` — nothing in it depends on React, Vue or any framework. Your application owns the look: keep a map from block `type` to your component and render the tree. Skip types you have not implemented; never crash on them. `style` carries the editor's layout choices (background, spacing, alignment, per-device columns and visibility, animation hints) for you to honour in your own design system.

Built-in types: `section`, `columns`, `hero`, `text`, `image`, `video`, `split`, `feature-grid`, `cards`, `testimonials`, `faq`, `pricing`, `stats`, `logos`, `gallery`, `cta`, `contact`, `team`, `blog-listing`, `product-listing`, `breadcrumbs`, `navigation`, `footer`, `html`, `json` — plus any component your team marked as a page block. Each block's props are documented by `GET /api/v1/content-types` and in the API explorer.

`blog-listing` and `product-listing` name a content type and a limit; fetch those entries yourself (that keeps listings fresh without republishing the page).

See [`examples/nextjs`](../examples/nextjs) for a complete catch-all route, block renderer, metadata, revalidation and preview.

## 4. GraphQL

`POST /api/v1/graphql` with the same key. The schema is generated from your content model.

```graphql
query Home($limit: Int) {
  articles(limit: $limit, sort: "-publishedOn", filter: { featured: true }) {
    total
    items { id title slug cover { url alt } author { name } }
  }
  page(path: "/") { title blocks seo }
}
```

Relations are real fields you can select through. `filter` takes the same shape as the SDK (`{ price: { gte: 10 } }`). Read/write keys also get `createX`, `updateX`, `publishX`, `unpublishX`, `deleteX` mutations. Queries are limited to 10 levels of nesting.

## 5. Media

Media URLs are immutable: they include a revision that changes when a file is replaced, so cache them forever.

```
https://cms.example.com/media/{id}/{revision}/{filename}?w=800&h=600&fit=cover&format=webp&q=75
```

| Parameter | Values |
| --- | --- |
| `w`, `h` | 1–4096 |
| `fit` | `cover` (default), `contain`, `fill`, `inside`, `outside` |
| `position` | `center`, `top`, `right`, `bottom`, `left`, `entropy`, `attention` |
| `format` | `webp`, `avif`, `jpeg`, `png` |
| `q` | 1–100 (default 80) |

Variants are generated on first request and stored, so later requests are plain file reads. Put a CDN in front by setting `MEDIA_CDN_URL`.

## 6. Drafts and preview

Two ways to show unpublished content:

**Preview links (recommended for editors).** Set **Settings → Project → Preview URL**, for example `https://www.example.com/api/preview?token={token}&path={path}`. When an editor clicks *Preview*, Meridian issues a token valid for one hour for exactly that entry. Your route exchanges it — no API key needed:

```ts
const draft = await cms.preview(token);          // GET /api/v1/preview?token=…
```

**Preview keys (for staging sites).** A `mrd_pv_` key may add `status=draft` to any read to see working copies of everything. Server-side only.

Read-only keys can never see drafts, whatever parameters they send.

## 7. Staying in sync

Publishing makes content available from the API immediately — the API's own cache is invalidated in the same moment. If *your* application caches (a CDN, static generation, an in-memory cache), tell it when to refresh:

### Webhooks

**Developers → Webhooks.** Choose events; Meridian POSTs JSON to your URL:

```json
{ "id": "…", "event": "content.published", "project": "acme-website", "environment": "production",
  "contentType": "articles", "documentId": "…", "slug": "going-headless", "locale": "en",
  "timestamp": "2026-01-01T10:00:00.000Z" }
```

Events: `content.created` `content.updated` `content.deleted` `content.published` `content.unpublished` `content.scheduled` `page.published` `page.unpublished` `media.uploaded` `media.updated` `media.deleted` `schema.updated` `release.published`.

Verify every delivery before trusting it:

```
X-Meridian-Signature:  sha256=<hex HMAC-SHA256(secret, timestamp + "." + rawBody)>
X-Meridian-Timestamp:  unix seconds
X-Meridian-Delivery:   stable id across retries → de-duplicate on it
X-Meridian-Event:      event name
```

```ts
import { parseWebhook } from '@meridian/sdk/webhooks';

export async function POST(request: Request) {
  try {
    const { event, deliveryId } = await parseWebhook(request, process.env.MERIDIAN_WEBHOOK_SECRET!);
    // revalidate / purge what changed
    return Response.json({ ok: true });
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }
}
```

Respond 2xx within 10 seconds. Failures (5xx, timeouts, 429) are retried with exponential backoff; 4xx responses are not. Every attempt is logged under the webhook, where you can inspect payloads and redeliver.

For CDNs, point a webhook at a small function that calls the provider's purge API (Cloudflare `purge_cache`, Fastly surrogate keys, Vercel/Netlify revalidation hooks) using `path`, `slug` or `contentType` from the event.

### Live events

```ts
const stop = cms.subscribe((event) => { /* event.event, event.contentType, event.documentId … */ });
```

A WebSocket to `/api/v1/events`. The first message authenticates (`{ "type": "auth", "token": "mrd_ro_…" }`); the server then pushes `{ "type": "event", "data": { … } }` for that key's environment only.

## 8. Writing content

With a read/write key:

```
POST   /api/v1/articles                 { "data": { … }, "publish": false, "locale": "en" }
PATCH  /api/v1/articles/{id}            { "data": { changed fields }, "publish": true }
PUT    /api/v1/articles/{id}            { "data": { whole document } }
POST   /api/v1/articles/{id}/publish
POST   /api/v1/articles/{id}/unpublish
DELETE /api/v1/articles/{id}            moves to trash
```

Writes go through the same validation, versioning, approval rules and audit log as the admin. A 422 lists the fields that failed:

```json
{ "error": { "code": "validation_failed", "message": "Some fields are invalid",
    "details": [{ "path": "views", "message": "Views must be at least 0", "code": "min" }] } }
```

## 9. Errors, limits and caching

Every error has the same shape: `{ "error": { "code", "message", "details"?, "requestId" } }`. Quote `requestId` when reporting a problem.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | Malformed query (unknown field in a filter, bad number…) |
| 401 | `unauthorized` | Missing, unknown, expired or revoked key |
| 403 | `forbidden` | Key type or origin not allowed for this operation |
| 404 | `not_found` | No such content — or it is not published |
| 409 | `conflict` | E.g. publishing something that still needs approval |
| 422 | `validation_failed` | Field-level problems in `details` |
| 429 | `rate_limited` | Slow down; see `Retry-After` |

Rate limits are per key, per minute (default 600), reported in `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

Published responses carry an `ETag` and `Cache-Control: public, max-age=0, must-revalidate`. Send `If-None-Match` to get a bodiless 304 when nothing changed (the SDK does this for you). `X-Cache: HIT|MISS` reports Meridian's own response cache.
