import { Router, type Request } from 'express';
import { z } from 'zod';
import { PAGE_TYPE_ID, isUuid } from '@meridian/shared';
import { env } from '../../config/env';
import { badRequest, notFound, unauthorized } from '../../lib/errors';
import { param, parse } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { verifyPreviewToken } from '../../middleware/auth';
import { ipKey, rateLimit } from '../../middleware/common';
import { recordUsage } from '../analytics/usage';
import { parseEntryQuery } from '../entries/entries.query';
import { createEntry, deleteEntry, publishEntry, unpublishEntry, updateEntry } from '../entries/entries.service';
import { type LoadedType, loadSchema } from '../schema/schema.service';
import {
  deliveryContext,
  describeTypes,
  engineOfToken,
  findResource,
  findRow,
  listResources,
  sendCached,
  singleResource,
  typeOrThrow,
} from './delivery.service';
import { graphqlHandler } from './graphql';
import { buildOpenApi } from './openapi';
import { type SerializeOptions, createDeliveryContext, parsePopulate, serializeEntries, toMediaOut } from './serializer';
import { requireApiToken, requireWriteToken, tokenOf, tokenRateLimit } from './token.middleware';

export const deliveryRouter = Router();

function serializeOptions(req: Request): SerializeOptions {
  const raw = Array.isArray(req.query.fields) ? req.query.fields.join(',') : req.query.fields;
  const select = typeof raw === 'string' && raw.trim() ? new Set(raw.split(',').map((f) => f.trim()).filter(Boolean)) : undefined;
  return { populate: parsePopulate(req.query.populate), select };
}

// ─── Preview (authorised by a short-lived signed token instead of an API key) ─

const previewLimiter = rateLimit({ name: 'preview', limit: 120, windowSeconds: 60, key: ipKey });

deliveryRouter.get('/preview', previewLimiter, async (req, res) => {
  const raw = typeof req.query.token === 'string' ? req.query.token : (req.headers['x-preview-token'] as string | undefined);
  const claims = raw ? await verifyPreviewToken(raw) : null;
  if (!claims) throw unauthorized('Preview token is missing, invalid or expired');
  const entry = await prisma.entry.findFirst({
    where: { id: claims.entryId, environmentId: claims.environmentId, deletedAt: null },
    include: { environment: { select: { projectId: true } } },
  });
  if (!entry) throw notFound('Previewed content');
  const schema = await loadSchema(claims.environmentId);
  const type = schema.typeById.get(entry.contentTypeId);
  if (!type) throw notFound('Content type');
  const ctx = createDeliveryContext({
    schema,
    environmentId: claims.environmentId,
    projectId: entry.environment.projectId,
    mode: 'draft',
    localeChain: [entry.locale],
    richtext: req.query.richtext === 'html' ? 'html' : 'json',
  });
  const [data] = await serializeEntries(ctx, type, [entry], serializeOptions(req));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.json({ data, preview: true });
});

// ─── Everything below requires an API token ──────────────────────────────────

deliveryRouter.use(requireApiToken, tokenRateLimit, (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const token = req.apiToken;
    if (!token) return;
    recordUsage({
      environmentId: token.environment.id,
      tokenId: token.token.id,
      resource: req.path.split('/').filter(Boolean)[0] ?? 'index',
      status: res.statusCode,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    });
  });
  next();
});

deliveryRouter.get('/', async (req, res) => {
  const token = tokenOf(req);
  const schema = await loadSchema(token.environment.id);
  res.json({
    name: 'Meridian Content Delivery API',
    version: 'v1',
    project: token.project.slug,
    environment: token.environment.key,
    access: token.token.type,
    defaultLocale: token.defaultLocale,
    locales: token.locales.map((l) => l.code),
    endpoints: {
      contentTypes: `${env.PUBLIC_API_URL}/api/v1/content-types`,
      graphql: `${env.PUBLIC_API_URL}/api/v1/graphql`,
      openapi: `${env.PUBLIC_API_URL}/api/v1/openapi.json`,
      collections: Object.fromEntries(schema.types.map((t) => [t.apiId, `${env.PUBLIC_API_URL}/api/v1/${t.apiId}`])),
    },
  });
});

deliveryRouter.get('/content-types', async (req, res) => {
  const schema = await loadSchema(tokenOf(req).environment.id);
  res.json({ data: describeTypes(schema) });
});

deliveryRouter.get('/openapi.json', async (req, res) => {
  const token = tokenOf(req);
  res.json(buildOpenApi(await loadSchema(token.environment.id), { project: token.project.name, environment: token.environment.key, writable: token.token.type === 'READ_WRITE' }));
});

deliveryRouter.post('/graphql', graphqlHandler);

deliveryRouter.get('/media/:assetId', async (req, res) => {
  const token = tokenOf(req);
  const id = param(req, 'assetId');
  const asset = isUuid(id) ? await prisma.mediaAsset.findFirst({ where: { id, projectId: token.project.id, deletedAt: null } }) : null;
  if (!asset) throw notFound('Media asset');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.json({ data: { ...toMediaOut(asset), tags: asset.tags, createdAt: asset.createdAt, updatedAt: asset.updatedAt } });
});

// ─── Read ────────────────────────────────────────────────────────────────────

deliveryRouter.get('/:type', async (req, res) => {
  const token = tokenOf(req);
  const ctx = await deliveryContext(token, req.query);
  const type = typeOrThrow(ctx.schema, param(req, 'type'));
  const opts = serializeOptions(req);

  if (type.kind === 'SINGLE') {
    await sendCached(req, res, ctx, async () => {
      const data = await singleResource(ctx, type, opts);
      if (!data) throw notFound(type.displayName);
      return { data };
    });
    return;
  }
  // Pages can be fetched by URL path, which is how most sites resolve a route: /api/v1/pages?path=/about/team
  if (type.apiId === PAGE_TYPE_ID && typeof req.query.path === 'string') {
    const path = req.query.path;
    await sendCached(req, res, ctx, async () => {
      const data = await findResource(ctx, type, { path: path === '/' ? '' : path }, opts);
      if (!data) throw notFound('Page');
      return { data };
    });
    return;
  }
  const query = parseEntryQuery(req.query as Record<string, unknown>, { maxLimit: 100, defaultLimit: 25 });
  await sendCached(req, res, ctx, () => listResources(ctx, type, query, opts));
});

deliveryRouter.get('/:type/:id', async (req, res) => {
  const token = tokenOf(req);
  const ctx = await deliveryContext(token, req.query);
  const type = typeOrThrow(ctx.schema, param(req, 'type'));
  const opts = serializeOptions(req);
  await sendCached(req, res, ctx, async () => {
    const data = await findResource(ctx, type, { id: param(req, 'id') }, opts);
    if (!data) throw notFound(type.singularName);
    return { data };
  });
});

// ─── Write (read/write tokens only) ──────────────────────────────────────────

const writeBody = z.object({
  data: z.record(z.string(), z.unknown()),
  locale: z.string().max(20).optional(),
  publish: z.boolean().default(false),
});

async function writeContext(req: Request) {
  requireWriteToken(req);
  const token = tokenOf(req);
  const schema = await loadSchema(token.environment.id);
  const type = typeOrThrow(schema, param(req, 'type'));
  return { token, schema, type, engine: engineOfToken(req, token, schema) };
}

async function respondWithDraft(req: Request, type: LoadedType, entryId: string) {
  const token = tokenOf(req);
  const ctx = await deliveryContext(token, { status: 'draft', locale: undefined });
  const row = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
  ctx.localeChain = [row.locale];
  const [data] = await serializeEntries(ctx, type, [row], {});
  return { data };
}

async function entryForWrite(req: Request, type: LoadedType) {
  const token = tokenOf(req);
  const id = param(req, 'id');
  if (!isUuid(id)) throw notFound(type.singularName);
  const locale = typeof req.query.locale === 'string' ? req.query.locale : token.defaultLocale;
  const entry = await prisma.entry.findFirst({
    where: { documentId: id, locale, environmentId: token.environment.id, contentTypeId: type.id, deletedAt: null },
  });
  if (!entry) throw notFound(type.singularName);
  return entry;
}

deliveryRouter.post('/:type', async (req, res) => {
  const { type, engine } = await writeContext(req);
  const input = parse(writeBody, req.body);
  let entry = await createEntry(engine, type, { data: input.data, locale: input.locale });
  if (input.publish) entry = await publishEntry(engine, type, entry.id);
  res.status(201).json(await respondWithDraft(req, type, entry.id));
});

for (const method of ['put', 'patch'] as const) {
  deliveryRouter[method]('/:type/:id', async (req, res) => {
    const { type, engine } = await writeContext(req);
    const input = parse(writeBody.omit({ locale: true }), req.body);
    const current = await entryForWrite(req, type);
    // PUT replaces the document; PATCH changes only the fields that were sent.
    const data = method === 'patch' ? { ...(current.data as Record<string, unknown>), ...input.data } : input.data;
    let entry = await updateEntry(engine, type, current.id, { data });
    if (input.publish) entry = await publishEntry(engine, type, entry.id);
    res.json(await respondWithDraft(req, type, entry.id));
  });
}

deliveryRouter.delete('/:type/:id', async (req, res) => {
  const { type, engine } = await writeContext(req);
  const entry = await entryForWrite(req, type);
  await deleteEntry(engine, type, entry.id);
  res.status(204).end();
});

deliveryRouter.post('/:type/:id/:action', async (req, res) => {
  const action = param(req, 'action');
  if (action !== 'publish' && action !== 'unpublish') throw badRequest('Unknown action. Use "publish" or "unpublish".');
  const { type, engine } = await writeContext(req);
  const entry = await entryForWrite(req, type);
  if (action === 'publish') await publishEntry(engine, type, entry.id);
  else await unpublishEntry(engine, type, entry.id);
  res.json(await respondWithDraft(req, type, entry.id));
});

export { findRow };
