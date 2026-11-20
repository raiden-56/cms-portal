# Architecture

Meridian is a headless content platform: editors model, write and publish content in the admin; applications read it through a delivery API. This document explains how the pieces fit and why they are shaped the way they are.

## Repository

```
apps/
  api/      Node.js + Express + Prisma. Management API, delivery API (REST + GraphQL),
            media delivery, webhooks, scheduler, WebSocket gateway.
  admin/    React + Vite + MUI. The content studio.
packages/
  shared/   Field catalogue, validation, rich-text schema, page-block model, permissions,
            workflow state machine. Imported by the API, the admin and (as types) the SDK.
  sdk/      @meridian/sdk — the client applications use.
examples/
  nextjs/   Reference integration (routing, block rendering, revalidation, preview).
docs/       This documentation.
```

`packages/shared` is the reason the system stays consistent: the same `validateEntryData` runs in the browser form and on the server, the same block definitions drive the page builder palette and the API's validation, and the same permission keys gate buttons and requests.

## Three API surfaces

| Surface | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| Management | `/admin/api/*` | Session (JWT access token + httpOnly refresh cookie) | Everything the admin does |
| Delivery | `/api/v1/*` | API token (`Authorization: Bearer mrd_…`) | Applications reading (and optionally writing) content |
| Media | `/media/*` | None (unguessable ids, immutable URLs) | Files and on-the-fly image transformations |

They share one process today and are mounted separately in `apps/api/src/app.ts`, each with its own CORS policy, body limits and middleware, so they can be split into separate deployments without code changes.

## Tenancy

```
Organization ─┬─ Members ── Role (permissions[])
              └─ Project ─┬─ Locales, Media, API tokens
                          └─ Environment (development / staging / production)
                               ├─ Content types, Components        ← the content model
                               ├─ Entries (incl. pages), Versions  ← the content
                               └─ Releases, Webhooks
```

Each environment owns its content model *and* its content, so schema changes can be tried in development before they exist in production.

**Isolation is structural, not conventional.** Every management route is declared with a scope guard (`orgScope`, `projectScope`, `envScope` in `middleware/auth.ts`) that resolves the resource in the URL, proves the caller is an active member of the organization that owns it, checks the required permissions, and attaches the resolved scope to the request. Handlers then query *inside* that scope (`where: { id, environmentId }`), so an id belonging to another tenant simply does not exist — the answer is 404, never 403, and never data. Delivery tokens carry their project and environment; there is no URL parameter through which another tenant's content could be addressed. `test/auth-tenancy.test.ts` exercises this across every route family.

## Content model

Content types and components are rows (`ContentType`, `Component`, `Field`). A field has a type from a fixed catalogue of 34 (`packages/shared/src/fields.ts`) and a JSON `config` (validation, presentation, conditions, relation targets).

Entry values live in JSONB (`Entry.data`), validated on every write against the type's fields. JSONB was chosen over generating a physical table per content type because:

- schema changes are transactional row updates instead of DDL, so they are fast, reversible and safe under load;
- components, repeatables and dynamic zones are naturally nested;
- everything structural — ownership, versions, relations, publication state, schedule — stays relational with real foreign keys and indexes.

Filtering and sorting compile to SQL over JSONB with type-aware casts (`entries.query.ts`). Field names are resolved against the content type's own schema and every value is a bound parameter, so no user input reaches SQL text. GIN indexes cover containment queries.

### Schema migrations

Saving a content type's fields goes through a planner (`schema.fields.ts`):

1. **Plan** — diff the proposed fields against the current ones and count affected entries. Renames are detected by field id, so a rename is never mistaken for delete-plus-add.
2. **Block** what cannot be done safely (making a field unique while duplicates exist, renaming a component field).
3. **Require confirmation** for anything that discards values (removing a field that holds data, an incompatible type change). The admin shows this plan before saving (`?dryRun=true`).
4. **Apply** in one transaction: rename keys in `data` and `publishedData`, drop removed keys, back-fill defaults for newly required fields, rewrite the field rows, bump the schema version, append to `SchemaChange`.

Version history is never rewritten, so earlier versions keep values of fields that were later removed.

## Publishing engine

An entry has two copies of its content:

| Column | Read by | Changed by |
| --- | --- | --- |
| `data` | Editors, previews | Save, autosave, restore |
| `publishedData` (+ `publishedTitle/Slug/Path`) | The delivery API — and nothing else | Publish, unpublish |

Publishing copies the working copy into the live snapshot inside a transaction and records a `PUBLISH` version. Editing afterwards changes only `data`; the site keeps serving the snapshot until the next publish. Because the delivery API reads only the snapshot columns and filters on `publishedAt IS NOT NULL`, a draft cannot leak through a public endpoint by construction.

- **Versions** — every save is a version; autosaves by one editor within ten minutes fold into one. Restoring writes a new version rather than rewinding history.
- **Concurrency** — each entry carries `lockVersion`. A save presents the value it loaded; the row is re-read under `SELECT … FOR UPDATE` and a mismatch returns 409 with who saved in between.
- **Workflow** — `DRAFT → IN_REVIEW → APPROVED → PUBLISHED`, plus `CHANGES_REQUESTED`, `SCHEDULED`, `ARCHIVED`, defined once in `packages/shared/src/lifecycle.ts` with the permission each transition needs. Content types can require approval; editing approved content returns it to draft because approval covers exact content.
- **Scheduling** — schedules are columns on the entry. A BullMQ repeating job sweeps for due work; because the database is the source of truth, a restart or missed tick loses nothing.
- **Releases** — a set of entries published in a single database transaction: all go live or none do.

## Pages

Pages are entries of a built-in `pages` content type, so they get versions, workflow, scheduling, releases, webhooks and both APIs for free. What is special about them:

- `data.blocks` is a tree of `{ id, type, props, style, children }`.
- Block definitions (`packages/shared/src/blocks.ts`) describe each block's props with the same field schema as content types, so validation and the editing form are shared.
- Custom components flagged "page block" join the built-in library.
- A page has a slug and a parent; its full `path` is derived and kept unique. Renaming a parent recalculates descendants' draft paths immediately and their live paths on publish.

**The page model is deliberately frontend-neutral.** Meridian stores structure and content, never markup or framework-specific output. The delivery API returns the block tree with media expanded; each application maps `type` to its own components (`examples/nextjs/components/Blocks.tsx`). The admin's canvas is just one more such renderer.

## Delivery and distribution

```
publish ──▶ transaction commits
        ├─▶ cache version++            (Redis)  → next API request is served fresh
        ├─▶ webhook deliveries queued  (BullMQ) → signed POST, retried with backoff
        └─▶ event published            (Redis pub/sub) → WebSocket clients of that environment
```

- **Cache** — delivery responses are cached in Redis under a key that embeds a per-environment version and the schema stamp. Publishing increments the version, abandoning every cached response for that environment at once. Responses carry `ETag` and `Cache-Control: public, max-age=0, must-revalidate`, so clients revalidate cheaply and never serve stale content.
- **Webhooks** — one delivery row per subscribed endpoint, signed `sha256=HMAC(secret, timestamp + "." + body)`, with a stable delivery id across retries. 4xx responses are not retried; 5xx, timeouts and 429 are, with exponential backoff. Targets are checked against private address ranges and redirects are not followed.
- **WebSocket** — clients authenticate with an API token in the first message (never in the URL) and receive only their environment's events.

What Meridian cannot do is invalidate a cache it does not own. If an application sits behind its own CDN or framework cache, the webhook is how that layer learns to refresh.

## GraphQL and OpenAPI

Both are generated from the content model at request time and cached per schema stamp: a GraphQL object type per content type (relations resolved through a batching loader, private fields absent from the schema, mutations only for read/write tokens, depth-limited), and an OpenAPI 3.1 document that the API explorer renders.

## Media

Uploads are validated by content (magic bytes), not by filename or the browser-supplied MIME type; the extension must match what the bytes are. SVGs with executable content are rejected and are served under a sandboxing CSP regardless. Files go to a storage driver (`local` or any S3-compatible store). URLs embed a revision, so they are immutable and cacheable forever; replacing a file bumps the revision while the asset id — and every reference to it — stays put. Image variants are produced on first request with `sharp` and stored beside the original.

## Admin frontend

- **State** — server state in TanStack Query; Redux Toolkit for the session, UI preferences and the page editor's undo/redo history.
- **Routing** — `/w/:org/p/:project/:environment/…`, so every screen is linkable and the workspace context is derived from the URL.
- **Forms** — one renderer (`features/fields/FieldForm.tsx`) for content entries, component instances and page-block props.
- **Design system** — tokens and component overrides in `theme/theme.ts`; shared primitives in `components/`.

## Extending

A feature is a folder under `apps/api/src/modules` (routes + service) and one under `apps/admin/src/features`. New field types are added in `packages/shared/src/fields.ts` (catalogue + validation) and `FieldForm.tsx` (input). New built-in blocks are entries in `blocks.ts`. Storage backends implement the five-method `StorageDriver` interface.
