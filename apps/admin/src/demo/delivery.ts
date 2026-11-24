/**
 * The public delivery API (/api/v1), answered inside the browser for demo keys.
 * Published content only, private fields removed, locale fallback, populate, filters —
 * the same contract a connected website would get from a Meridian server.
 */
import { z } from 'zod';
import { type BlockNode, type FieldDef, PAGE_TYPE_ID, type PageData, isRelationField, isUuid, newId, renderRichTextToHtml } from '@meridian/shared';
import { type Ctx, type EnvSchema, isPageType, loadSchema } from './context';
import { type DbEntry, type DbToken, type DbType, type Json, db, now, nowIso, replaceState } from './db';
import { type Engine, createEntry, deleteEntry, publishEntry, unpublishEntry, updateEntry } from './engine';
import { Reply, badRequest, created, errorReply, forbidden, noContent, notFound, parse, unauthorized } from './http';
import { PUBLIC_API_URL, buildOpenApi } from './openapi';
import { type EntryQuery, parseEntryQuery, runEntryQuery } from './query';
import { Router } from './router';
import { toMediaOut } from './routes/media';

// ─── Serializer ──────────────────────────────────────────────────────────────

type PopulateTree = { [field: string]: PopulateTree } | '*';

/** `author,category.parent` → { author: {}, category: { parent: {} } }. `*` populates every relation one level deep. */
function parsePopulate(raw: unknown): PopulateTree {
  const value = typeof raw === 'string' ? raw : '';
  if (!value.trim()) return {};
  if (value.trim() === '*') return '*';
  const tree: { [field: string]: PopulateTree } = {};
  for (const path of value.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 40)) {
    let node = tree;
    for (const part of path.split('.').slice(0, 4)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(part)) break;
      if (node[part] === '*' || node[part] === undefined) node[part] = {};
      node = node[part] as { [field: string]: PopulateTree };
    }
  }
  return tree;
}

interface DeliveryContext {
  schema: EnvSchema;
  environmentId: string;
  projectId: string;
  /** `live` reads only published snapshots. `draft` reads working copies and is reserved for authorised previews. */
  mode: 'live' | 'draft';
  /** Locales to try, most preferred first: requested → its fallback → project default. */
  localeChain: string[];
  richtext: 'json' | 'html';
}

interface SerializeOptions {
  populate?: PopulateTree;
  select?: Set<string>;
}

type MediaOut = ReturnType<typeof toMediaOut>;
type Populated = Map<string, Json>;

const MAX_POPULATE_DEPTH = 4;

const mediaOut = (ctx: DeliveryContext, id: unknown): MediaOut | null => {
  const asset = typeof id === 'string' ? db.assets.find((a) => a.id === id && a.projectId === ctx.projectId && !a.deletedAt) : undefined;
  return asset ? toMediaOut(asset) : null;
};

const dataOf = (ctx: DeliveryContext, row: DbEntry): Json => (ctx.mode === 'live' ? row.publishedData : row.data) ?? {};

/** Loads documents by id, choosing for each the best available locale variant. */
function loadDocuments(ctx: DeliveryContext, type: DbType, documentIds: string[]): DbEntry[] {
  const ids = [...new Set(documentIds)].filter(isUuid);
  const best = new Map<string, DbEntry>();
  for (const row of db.entries) {
    if (row.environmentId !== ctx.environmentId || row.contentTypeId !== type.id || row.deletedAt) continue;
    if (!ids.includes(row.documentId) || !ctx.localeChain.includes(row.locale) || (ctx.mode === 'live' && !row.publishedAt)) continue;
    const current = best.get(row.documentId);
    if (!current || ctx.localeChain.indexOf(row.locale) < ctx.localeChain.indexOf(current.locale)) best.set(row.documentId, row);
  }
  return ids.map((id) => best.get(id)).filter((row): row is DbEntry => !!row);
}

function shapeObject(ctx: DeliveryContext, fields: FieldDef[], data: Json | null | undefined, populated: Populated | null, select?: Set<string>): Json {
  const out: Json = {};
  const source = data ?? {};
  for (const f of fields) {
    // Private fields and secrets never leave through the delivery API.
    if (f.config.private || f.type === 'password') continue;
    if (select && !select.has(f.apiId)) continue;
    out[f.apiId] = shapeValue(ctx, f, source[f.apiId], populated);
  }
  return out;
}

function shapeValue(ctx: DeliveryContext, f: FieldDef, value: unknown, populated: Populated | null): unknown {
  if (value === undefined || value === null) return f.type === 'images' || f.type === 'files' || f.type === 'relations' ? [] : null;
  switch (f.type) {
    case 'image':
    case 'video':
    case 'file':
      return mediaOut(ctx, value);
    case 'images':
    case 'files':
      return Array.isArray(value) ? value.map((id) => mediaOut(ctx, id)).filter(Boolean) : [];
    case 'relation': {
      if (typeof value !== 'string') return null;
      const hit = populated?.get(`${f.apiId}:${value}`);
      if (hit) return hit;
      // A populated relation whose target is not visible (e.g. unpublished) resolves to null rather than leaking its id.
      return populated?.has(`${f.apiId}:*`) ? null : { id: value, type: f.config.targetType ?? null };
    }
    case 'relations': {
      if (!Array.isArray(value)) return [];
      if (populated?.has(`${f.apiId}:*`)) return value.map((id) => populated.get(`${f.apiId}:${id}`)).filter(Boolean);
      return value.map((id) => ({ id, type: f.config.targetType ?? null }));
    }
    case 'richtext':
      return ctx.richtext === 'html' ? renderRichTextToHtml(value) : value;
    case 'component': {
      const fields = ctx.schema.componentFields[f.config.component ?? ''];
      return fields && typeof value === 'object' ? shapeObject(ctx, fields, value as Json, null) : null;
    }
    case 'repeatable': {
      const fields = ctx.schema.componentFields[f.config.component ?? ''];
      return fields && Array.isArray(value) ? value.map((item) => shapeObject(ctx, fields, item as Json, null)) : [];
    }
    case 'dynamiczone': {
      if (!Array.isArray(value)) return [];
      return value.flatMap((item) => {
        const node = item as { id?: string; type?: string; props?: Json };
        const fields = node?.type ? ctx.schema.componentFields[node.type] : undefined;
        return fields ? [{ id: node.id, type: node.type, props: shapeObject(ctx, fields, node.props, null) }] : [];
      });
    }
    default:
      return value;
  }
}

function shapeBlocks(ctx: DeliveryContext, nodes: BlockNode[] | undefined): unknown[] {
  return (nodes ?? []).flatMap((node) => {
    const def = ctx.schema.blockRegistry[node.type];
    // Blocks whose definition has been removed are omitted instead of delivering unvalidated data.
    if (!def) return [];
    const out: Json = { id: node.id, type: node.type, props: shapeObject(ctx, def.fields, node.props, null) };
    if (node.style) {
      const { background, ...rest } = node.style;
      out.style = background ? { ...rest, background: { color: background.color, overlay: background.overlay, image: background.imageId ? mediaOut(ctx, background.imageId) : null } } : rest;
    }
    if (def.acceptsChildren) out.children = shapeBlocks(ctx, node.children);
    return [out];
  });
}

/** Turns stored rows into API resources: expands media, resolves requested relations, renders rich text, removes private fields. */
function serializeEntries(ctx: DeliveryContext, type: DbType, rows: DbEntry[], opts: SerializeOptions = {}, depth = 0): Json[] {
  if (rows.length === 0) return [];
  const populate = opts.populate ?? {};
  const datas = rows.map((row) => dataOf(ctx, row));
  const base = (row: DbEntry) => ({
    id: row.documentId,
    type: type.apiId,
    locale: row.locale,
    ...(ctx.mode === 'draft' ? { status: row.status } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  });

  if (isPageType(type)) {
    return rows.map((row, i) => {
      const data = datas[i] as unknown as PageData;
      const parent = row.parentId ? db.entries.find((e) => e.id === row.parentId) : undefined;
      const seo = data.seo ?? {};
      return {
        ...base(row),
        title: data.title ?? null,
        slug: data.slug ?? '',
        path: (ctx.mode === 'live' ? row.publishedPath : row.path) ?? '/',
        parent: parent ? { id: parent.documentId, path: (ctx.mode === 'live' ? parent.publishedPath : parent.path) ?? null } : null,
        description: data.description ?? null,
        template: data.template ?? 'default',
        category: data.category ?? null,
        seo: { ...seo, ogImage: seo.ogImage ? mediaOut(ctx, seo.ogImage) : null },
        blocks: shapeBlocks(ctx, data.blocks),
      };
    });
  }

  const populated: Populated = new Map();
  if (depth < MAX_POPULATE_DEPTH) {
    for (const f of type.fields) {
      if (!isRelationField(f.type) || f.config.private) continue;
      const sub = populate === '*' ? {} : populate[f.apiId];
      if (sub === undefined) continue;
      const target = ctx.schema.typeByApiId.get(f.config.targetType ?? '');
      if (!target) continue;
      // Marker: this field was populated, so unresolved targets become null instead of bare references.
      populated.set(`${f.apiId}:*`, {});
      const ids = datas.flatMap((d) => {
        const v = d[f.apiId];
        return Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
      });
      const serialized = serializeEntries(ctx, target, loadDocuments(ctx, target, ids), { populate: sub === '*' ? {} : sub }, depth + 1);
      for (const item of serialized) populated.set(`${f.apiId}:${item.id as string}`, item);
    }
  }
  return rows.map((row, i) => ({ ...base(row), ...shapeObject(ctx, type.fields, datas[i], populated, opts.select) }));
}

// ─── Token and request context ───────────────────────────────────────────────

interface TokenContext {
  token: DbToken;
  project: { id: string; slug: string; name: string };
  environment: { id: string; key: string; name: string };
  defaultLocale: string;
  locales: { code: string; isDefault: boolean; fallbackCode: string | null }[];
}

/** Authenticates a demo key. The key alone determines the project and environment. */
function authenticate(raw: string): TokenContext {
  if (!raw) throw unauthorized('Provide an API token: Authorization: Bearer <token>');
  if (!raw.startsWith('mrd_')) throw unauthorized('API token is not recognised');
  const token = db.tokens.find((t) => t.secret === raw);
  const project = token && db.projects.find((p) => p.id === token.projectId && !p.deletedAt);
  const environment = token && db.environments.find((e) => e.id === token.environmentId);
  if (!token || !project || !environment) throw unauthorized('API token is not recognised');
  if (token.revokedAt) throw unauthorized('API token has been revoked');
  if (token.expiresAt && token.expiresAt < nowIso()) throw unauthorized('API token has expired');

  // The request comes from this page, so its origin is the one a server would see.
  const origin = typeof window === 'undefined' ? null : window.location.origin;
  if (origin) {
    const listed = token.allowedOrigins.includes(origin);
    if (token.allowedOrigins.length > 0 && !listed) throw forbidden('This origin is not allowed to use this API token');
    if (token.type !== 'READ_ONLY' && !listed) throw forbidden('Read/write and preview tokens must only be used from a server. Use a read-only token in the browser.');
  }
  const locales = db.locales.filter((l) => l.projectId === project.id);
  return { token, project, environment, defaultLocale: locales.find((l) => l.isDefault)?.code ?? 'en', locales };
}

/** Draft content is only ever served to preview or read/write keys. */
function resolveMode(token: TokenContext, status: unknown): 'live' | 'draft' {
  if (status === undefined || status === '' || status === 'published') return 'live';
  if (status === 'draft' || status === 'preview') {
    if (token.token.type === 'READ_ONLY') throw forbidden('Draft content needs a preview token. Read-only tokens can only read published content.');
    return 'draft';
  }
  throw badRequest('status must be "published" or "draft"');
}

function localeChain(token: TokenContext, requested: unknown): string[] {
  const chain: string[] = [];
  if (typeof requested === 'string' && requested) {
    const locale = token.locales.find((l) => l.code === requested);
    if (!locale) throw badRequest(`Unknown locale "${requested}". Available: ${token.locales.map((l) => l.code).join(', ')}`);
    chain.push(locale.code);
    if (locale.fallbackCode) chain.push(locale.fallbackCode);
  }
  if (!chain.includes(token.defaultLocale)) chain.push(token.defaultLocale);
  return chain;
}

function deliveryContext(token: TokenContext, query: Record<string, unknown>): DeliveryContext {
  return {
    schema: loadSchema(token.environment.id),
    environmentId: token.environment.id,
    projectId: token.project.id,
    mode: resolveMode(token, query.status),
    localeChain: localeChain(token, query.locale),
    richtext: query.richtext === 'html' ? 'html' : 'json',
  };
}

function typeOrThrow(schema: EnvSchema, apiId: string): DbType {
  const type = schema.typeByApiId.get(apiId);
  if (!type) throw notFound(`Content type "${apiId}"`);
  return type;
}

function serializeOptions(query: Record<string, unknown>): SerializeOptions {
  const raw = query.fields;
  const select = typeof raw === 'string' && raw.trim() ? new Set(raw.split(',').map((f) => f.trim()).filter(Boolean)) : undefined;
  return { populate: parsePopulate(query.populate), select };
}

function pickByLocale(ctx: DeliveryContext, rows: DbEntry[]): DbEntry | null {
  let best: DbEntry | null = null;
  for (const row of rows) if (!best || ctx.localeChain.indexOf(row.locale) < ctx.localeChain.indexOf(best.locale)) best = row;
  return best;
}

/** Finds one document by id, slug, or (for pages) URL path. */
function findRow(ctx: DeliveryContext, type: DbType, key: { id?: string; path?: string }): DbEntry | null {
  if (key.id && isUuid(key.id)) return loadDocuments(ctx, type, [key.id])[0] ?? null;
  const live = ctx.mode === 'live';
  const candidates = db.entries.filter((e) => e.environmentId === ctx.environmentId && e.contentTypeId === type.id && !e.deletedAt && ctx.localeChain.includes(e.locale) && (!live || e.publishedAt));
  if (key.path !== undefined) {
    const path = key.path === '' ? '/' : `/${key.path.replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/');
    return pickByLocale(ctx, candidates.filter((e) => (live ? e.publishedPath : e.path) === path));
  }
  if (!key.id) return null;
  return pickByLocale(ctx, candidates.filter((e) => (live ? e.publishedSlug : e.slug) === key.id));
}

function listResources(ctx: DeliveryContext, type: DbType, query: EntryQuery, opts: SerializeOptions) {
  // Lists return one locale. Types that are not localized only ever hold the default locale.
  const locale = type.options.localized ? ctx.localeChain[0] : ctx.localeChain[ctx.localeChain.length - 1];
  const { rows, total } = runEntryQuery({ environmentId: ctx.environmentId, type, query: { ...query, locale, statuses: undefined }, mode: ctx.mode });
  return {
    data: serializeEntries(ctx, type, rows, opts),
    meta: { total, limit: query.limit, offset: query.offset, page: Math.floor(query.offset / query.limit) + 1, pageCount: Math.max(1, Math.ceil(total / query.limit)) },
  };
}

function describeTypes(schema: EnvSchema) {
  return schema.types.map((t) => ({
    apiId: t.apiId,
    displayName: t.displayName,
    singularName: t.singularName,
    pluralName: t.pluralName,
    kind: t.kind,
    localized: !!t.options.localized,
    isPageType: isPageType(t),
    fields: t.fields
      .filter((f) => !f.config.private && f.type !== 'password')
      .map((f) => ({
        apiId: f.apiId,
        label: f.label,
        type: f.type,
        required: f.required,
        localized: f.localized,
        ...(f.config.options ? { options: f.config.options } : {}),
        ...(f.config.targetType ? { targetType: f.config.targetType } : {}),
        ...(f.config.component ? { component: f.config.component } : {}),
        ...(f.config.allowedComponents ? { allowedComponents: f.config.allowedComponents } : {}),
      })),
  }));
}

// ─── Routes ──────────────────────────────────────────────────────────────────

interface DeliveryCtx extends Ctx {
  token: TokenContext;
}

const tokenOf = (c: Ctx): TokenContext => (c as DeliveryCtx).token;
const cached = (body: unknown) => new Reply(200, body, { 'cache-control': 'public, max-age=0, must-revalidate' });
const privately = (body: unknown, status = 200) => new Reply(status, body, { 'cache-control': 'private, no-store' });
const send = (ctx: DeliveryContext, body: unknown) => (ctx.mode === 'draft' ? privately(body) : cached(body));

const writeBody = z.object({ data: z.record(z.string(), z.unknown()), locale: z.string().max(20).optional(), publish: z.boolean().default(false) });

function writeContext(c: Ctx) {
  const token = tokenOf(c);
  if (token.token.type !== 'READ_WRITE') throw forbidden('This operation needs a read/write API token');
  const schema = loadSchema(token.environment.id);
  const project = db.projects.find((p) => p.id === token.project.id);
  const environment = db.environments.find((e) => e.id === token.environment.id);
  if (!project || !environment) throw unauthorized();
  const engine: Engine = { scope: { project, environment }, schema, defaultLocale: token.defaultLocale, actor: { type: 'token', id: token.token.id, label: `API token “${token.token.name}”` } };
  return { token, type: typeOrThrow(schema, c.params.type), engine };
}

function respondWithDraft(c: Ctx, type: DbType, entry: DbEntry) {
  const token = tokenOf(c);
  const ctx = deliveryContext(token, { status: 'draft' });
  ctx.localeChain = [entry.locale];
  return { data: serializeEntries(ctx, type, [entry], {})[0] };
}

function entryForWrite(c: Ctx, type: DbType): DbEntry {
  const token = tokenOf(c);
  const locale = typeof c.query.locale === 'string' ? c.query.locale : token.defaultLocale;
  const entry = isUuid(c.params.id)
    ? db.entries.find((e) => e.documentId === c.params.id && e.locale === locale && e.environmentId === token.environment.id && e.contentTypeId === type.id && !e.deletedAt)
    : undefined;
  if (!entry) throw notFound(type.singularName);
  return entry;
}

const router = new Router();

router.get('/', (c) => {
  const token = tokenOf(c);
  const schema = loadSchema(token.environment.id);
  return {
    name: 'Meridian Content Delivery API',
    version: 'v1',
    project: token.project.slug,
    environment: token.environment.key,
    access: token.token.type,
    defaultLocale: token.defaultLocale,
    locales: token.locales.map((l) => l.code),
    endpoints: {
      contentTypes: `${PUBLIC_API_URL}/api/v1/content-types`,
      graphql: `${PUBLIC_API_URL}/api/v1/graphql`,
      openapi: `${PUBLIC_API_URL}/api/v1/openapi.json`,
      collections: Object.fromEntries(schema.types.map((t) => [t.apiId, `${PUBLIC_API_URL}/api/v1/${t.apiId}`])),
    },
  };
});

router.get('/content-types', (c) => ({ data: describeTypes(loadSchema(tokenOf(c).environment.id)) }));

router.get('/openapi.json', (c) => {
  const token = tokenOf(c);
  return buildOpenApi(loadSchema(token.environment.id), { project: token.project.name, environment: token.environment.key, writable: token.token.type === 'READ_WRITE' });
});

// GraphQL is executed by the server's GraphQL engine. Guest mode has none, and says so instead of inventing results.
router.post('/graphql', () =>
  new Reply(501, {
    errors: [
      {
        message: 'GraphQL is not available in guest mode. Queries are executed by the Meridian server, and this demo runs entirely in your browser. The REST tab works with the same content.',
        extensions: { code: 'GUEST_MODE_UNSUPPORTED' },
      },
    ],
  }),
);

router.get('/media/:assetId', (c) => {
  const token = tokenOf(c);
  const asset = db.assets.find((a) => a.id === c.params.assetId && a.projectId === token.project.id && !a.deletedAt);
  if (!asset) throw notFound('Media asset');
  return cached({ data: { ...toMediaOut(asset), tags: asset.tags, createdAt: asset.createdAt, updatedAt: asset.updatedAt } });
});

router.get('/:type', (c) => {
  const ctx = deliveryContext(tokenOf(c), c.query);
  const type = typeOrThrow(ctx.schema, c.params.type);
  const opts = serializeOptions(c.query);
  if (type.kind === 'SINGLE') {
    const row = pickByLocale(ctx, db.entries.filter((e) => e.environmentId === ctx.environmentId && e.contentTypeId === type.id && !e.deletedAt && ctx.localeChain.includes(e.locale) && (ctx.mode === 'draft' || e.publishedAt)));
    if (!row) throw notFound(type.displayName);
    return send(ctx, { data: serializeEntries(ctx, type, [row], opts)[0] });
  }
  // Pages can be fetched by URL path, which is how most sites resolve a route: /api/v1/pages?path=/about/team
  if (type.apiId === PAGE_TYPE_ID && typeof c.query.path === 'string') {
    const row = findRow(ctx, type, { path: c.query.path === '/' ? '' : c.query.path });
    if (!row) throw notFound('Page');
    return send(ctx, { data: serializeEntries(ctx, type, [row], opts)[0] });
  }
  return send(ctx, listResources(ctx, type, parseEntryQuery(c.query, { maxLimit: 100, defaultLimit: 25 }), opts));
});

router.get('/:type/:id', (c) => {
  const ctx = deliveryContext(tokenOf(c), c.query);
  const type = typeOrThrow(ctx.schema, c.params.type);
  const row = findRow(ctx, type, { id: c.params.id });
  if (!row) throw notFound(type.singularName);
  return send(ctx, { data: serializeEntries(ctx, type, [row], serializeOptions(c.query))[0] });
});

router.post('/:type', (c) => {
  const { type, engine } = writeContext(c);
  const input = parse(writeBody, c.body);
  let entry = createEntry(engine, type, { data: input.data, locale: input.locale });
  if (input.publish) entry = publishEntry(engine, type, entry.id);
  return created(respondWithDraft(c, type, entry));
});

for (const method of ['PUT', 'PATCH'] as const) {
  router.on(method, '/:type/:id', (c) => {
    const { type, engine } = writeContext(c);
    const input = parse(writeBody.omit({ locale: true }), c.body);
    const current = entryForWrite(c, type);
    // PUT replaces the document; PATCH changes only the fields that were sent.
    let entry = updateEntry(engine, type, current.id, { data: method === 'PATCH' ? { ...current.data, ...input.data } : input.data });
    if (input.publish) entry = publishEntry(engine, type, entry.id);
    return respondWithDraft(c, type, entry);
  });
}

router.delete('/:type/:id', (c) => {
  const { type, engine } = writeContext(c);
  deleteEntry(engine, type, entryForWrite(c, type).id);
  return noContent();
});

router.post('/:type/:id/:action', (c) => {
  const { action } = c.params;
  if (action !== 'publish' && action !== 'unpublish') throw badRequest('Unknown action. Use "publish" or "unpublish".');
  const { type, engine } = writeContext(c);
  const entry = entryForWrite(c, type);
  return respondWithDraft(c, type, action === 'publish' ? publishEntry(engine, type, entry.id) : unpublishEntry(engine, type, entry.id));
});

/** Reads one draft with a preview token minted by the editor. Needs no API key, as on the server. */
function preview(query: Record<string, unknown>): Reply {
  const raw = typeof query.token === 'string' ? query.token : '';
  const claims = db.previewTokens[raw];
  if (!claims || claims.expiresAt < nowIso()) throw unauthorized('Preview token is missing, invalid or expired');
  const entry = db.entries.find((e) => e.id === claims.entryId && e.environmentId === claims.environmentId && !e.deletedAt);
  const environment = entry && db.environments.find((e) => e.id === entry.environmentId);
  if (!entry || !environment) throw notFound('Previewed content');
  const schema = loadSchema(claims.environmentId);
  const type = schema.typeById.get(entry.contentTypeId);
  if (!type) throw notFound('Content type');
  const ctx: DeliveryContext = { schema, environmentId: claims.environmentId, projectId: environment.projectId, mode: 'draft', localeChain: [entry.locale], richtext: query.richtext === 'html' ? 'html' : 'json' };
  return new Reply(200, { data: serializeEntries(ctx, type, [entry], serializeOptions(query))[0], preview: true }, { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
}

function recordUsage(token: DbToken, resource: string, status: number, durationMs: number) {
  const day = now().toISOString().slice(0, 10);
  let row = db.usage.find((u) => u.tokenId === token.id && u.day === day && u.resource === resource);
  if (!row) {
    row = { environmentId: token.environmentId, tokenId: token.id, resource, day, requests: 0, errors: 0, latencyMsTotal: 0 };
    db.usage.push(row);
  }
  row.requests += 1;
  if (status >= 400) row.errors += 1;
  row.latencyMsTotal += durationMs;
  token.lastUsedAt = nowIso();
}

/** Answers one delivery request. Never throws: errors come back in the API's error envelope. */
export function deliver(request: { method: string; path: string; query: Record<string, unknown>; body: unknown; token: string }): Reply {
  const started = performance.now();
  const requestId = newId();
  const resource = request.path.split('/').filter(Boolean)[0] ?? 'index';
  // A failed write must leave no trace, as a database transaction would guarantee on the server.
  const snapshot = request.method === 'GET' ? null : structuredClone(db);
  let token: DbToken | null = null;
  let reply: Reply;
  try {
    if (request.method === 'GET' && request.path.replace(/\/+$/, '') === '/preview') {
      reply = preview(request.query);
    } else {
      const context = authenticate(request.token.trim());
      token = context.token;
      const match = router.match(request.method, request.path);
      if (!match) throw notFound('Route');
      const c: DeliveryCtx = { method: request.method, params: match.params, query: request.query, body: request.body, actor: { type: 'token', id: context.token.id, label: `API token “${context.token.name}”` }, token: context };
      const result = match.handler(c);
      reply = result instanceof Reply ? result : new Reply(200, result);
    }
  } catch (err) {
    if (snapshot) replaceState(snapshot);
    reply = errorReply(err);
  }
  const used = token && db.tokens.find((t) => t.id === token?.id);
  if (used) recordUsage(used, resource, reply.status, performance.now() - started);
  return new Reply(reply.status, reply.body, {
    ...(reply.status === 204 ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    ...reply.headers,
    'x-request-id': requestId,
    // So nobody mistakes a response in the explorer for one that came from a server.
    'x-served-by': 'meridian guest mode (in this browser)',
  });
}
