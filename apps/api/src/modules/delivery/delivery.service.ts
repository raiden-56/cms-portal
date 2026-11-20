import type { Entry } from '@prisma/client';
import type { Request, Response } from 'express';
import { isUuid } from '@meridian/shared';
import { env } from '../../config/env';
import { sha256 } from '../../lib/crypto';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { clientIp } from '../../lib/http';
import { prisma, redis } from '../../lib/infra';
import type { TokenContext } from '../../types/express';
import type { EventScope } from '../events/events.service';
import { getCacheVersion } from '../events/events.service';
import { type EntryQuery, runEntryQuery } from '../entries/entries.query';
import type { EngineContext } from '../entries/entries.service';
import { type EnvSchema, type LoadedType, isPageType, loadSchema } from '../schema/schema.service';
import { type DeliveryContext, type SerializeOptions, createDeliveryContext, loadDocuments, serializeEntries } from './serializer';

export function scopeOfToken(token: TokenContext): EventScope {
  return {
    organizationId: token.organizationId,
    organizationSlug: token.organizationSlug,
    project: { id: token.project.id, slug: token.project.slug },
    environment: { id: token.environment.id, key: token.environment.key },
  };
}

export function engineOfToken(req: Request, token: TokenContext, schema: EnvSchema): EngineContext {
  return {
    scope: scopeOfToken(token),
    schema,
    defaultLocale: token.defaultLocale,
    actor: { type: 'token', id: token.token.id, label: `API token “${token.token.name}”`, ip: clientIp(req) },
  };
}

/** Draft content is only ever served to preview or read/write tokens. Read-only tokens always get published content. */
export function resolveMode(token: TokenContext, status: unknown): 'live' | 'draft' {
  const value = Array.isArray(status) ? status[0] : status;
  if (value === undefined || value === '' || value === 'published') return 'live';
  if (value === 'draft' || value === 'preview') {
    if (token.token.type === 'READ_ONLY') throw forbidden('Draft content needs a preview token. Read-only tokens can only read published content.');
    return 'draft';
  }
  throw badRequest('status must be "published" or "draft"');
}

export function localeChain(token: TokenContext, requested: unknown): string[] {
  const value = Array.isArray(requested) ? requested[0] : requested;
  const chain: string[] = [];
  if (typeof value === 'string' && value) {
    const locale = token.locales.find((l) => l.code === value);
    if (!locale) throw badRequest(`Unknown locale "${value}". Available: ${token.locales.map((l) => l.code).join(', ')}`);
    chain.push(locale.code);
    if (locale.fallbackCode) chain.push(locale.fallbackCode);
  }
  if (!chain.includes(token.defaultLocale)) chain.push(token.defaultLocale);
  return chain;
}

export async function deliveryContext(
  token: TokenContext,
  opts: { status?: unknown; locale?: unknown; richtext?: unknown },
): Promise<DeliveryContext> {
  const schema = await loadSchema(token.environment.id);
  return createDeliveryContext({
    schema,
    environmentId: token.environment.id,
    projectId: token.project.id,
    mode: resolveMode(token, opts.status),
    localeChain: localeChain(token, opts.locale),
    richtext: opts.richtext === 'html' ? 'html' : 'json',
  });
}

export function typeOrThrow(schema: EnvSchema, apiId: string): LoadedType {
  const type = schema.typeByApiId.get(apiId);
  if (!type) throw notFound(`Content type "${apiId}"`);
  return type;
}

export async function listResources(ctx: DeliveryContext, type: LoadedType, query: EntryQuery, opts: SerializeOptions) {
  // Lists return one locale. Types that are not localized only ever hold the default locale.
  const locale = type.options.localized ? ctx.localeChain[0] : ctx.localeChain[ctx.localeChain.length - 1];
  const { rows, total } = await runEntryQuery({
    environmentId: ctx.environmentId,
    type,
    query: { ...query, locale, statuses: undefined },
    mode: ctx.mode,
  });
  const data = await serializeEntries(ctx, type, rows, opts);
  return {
    data,
    meta: {
      total,
      limit: query.limit,
      offset: query.offset,
      page: Math.floor(query.offset / query.limit) + 1,
      pageCount: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

function pickByLocale(ctx: DeliveryContext, rows: Entry[]): Entry | null {
  let best: Entry | null = null;
  for (const row of rows) {
    if (!best || ctx.localeChain.indexOf(row.locale) < ctx.localeChain.indexOf(best.locale)) best = row;
  }
  return best;
}

/** Finds one document by id, slug, or (for pages) URL path. */
export async function findRow(ctx: DeliveryContext, type: LoadedType, key: { id?: string; slug?: string; path?: string }): Promise<Entry | null> {
  if (key.id && isUuid(key.id)) return (await loadDocuments(ctx, type, [key.id]))[0] ?? null;
  const live = ctx.mode === 'live';
  const base = {
    environmentId: ctx.environmentId,
    contentTypeId: type.id,
    deletedAt: null,
    locale: { in: ctx.localeChain },
    ...(live ? { publishedAt: { not: null } } : {}),
  };
  if (key.path !== undefined) {
    const path = key.path === '' ? '/' : `/${key.path.replace(/^\/+|\/+$/g, '')}`.replace(/\/{2,}/g, '/');
    return pickByLocale(ctx, await prisma.entry.findMany({ where: { ...base, ...(live ? { publishedPath: path } : { path }) } }));
  }
  const slug = key.slug ?? key.id;
  if (!slug) return null;
  return pickByLocale(ctx, await prisma.entry.findMany({ where: { ...base, ...(live ? { publishedSlug: slug } : { slug }) }, take: 10 }));
}

export async function findResource(ctx: DeliveryContext, type: LoadedType, key: { id?: string; slug?: string; path?: string }, opts: SerializeOptions) {
  const row = await findRow(ctx, type, key);
  if (!row) return null;
  return (await serializeEntries(ctx, type, [row], opts))[0] ?? null;
}

export async function singleResource(ctx: DeliveryContext, type: LoadedType, opts: SerializeOptions) {
  const rows = await prisma.entry.findMany({
    where: {
      environmentId: ctx.environmentId,
      contentTypeId: type.id,
      deletedAt: null,
      locale: { in: ctx.localeChain },
      ...(ctx.mode === 'live' ? { publishedAt: { not: null } } : {}),
    },
  });
  const row = pickByLocale(ctx, rows);
  return row ? ((await serializeEntries(ctx, type, [row], opts))[0] ?? null) : null;
}

/** Public description of the content model, with private fields removed. */
export function describeTypes(schema: EnvSchema) {
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

/**
 * Sends a published-content response through the Redis cache.
 *
 * Keys embed the environment's cache version and schema stamp. Publishing bumps the
 * version, so every cached response for that environment is abandoned at once and the
 * next request is served from the database — no per-key purging, no stale reads.
 */
export async function sendCached(req: Request, res: Response, ctx: DeliveryContext, produce: () => Promise<unknown>) {
  res.setHeader('Vary', 'Authorization, Accept-Encoding');
  if (ctx.mode === 'draft' || env.DELIVERY_CACHE_TTL_SECONDS === 0) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await produce());
    return;
  }
  const version = `${await getCacheVersion(ctx.environmentId)}.${ctx.schema.stamp}`;
  const key = `dc:${ctx.environmentId}:${version}:${sha256(req.originalUrl)}`;
  let body = await redis.get(key).catch(() => null);
  const hit = body !== null;
  if (body === null) {
    body = JSON.stringify(await produce());
    await redis.set(key, body, 'EX', env.DELIVERY_CACHE_TTL_SECONDS).catch(() => undefined);
  }
  const etag = `"${sha256(body).slice(0, 32)}"`;
  res.setHeader('ETag', etag);
  // Clients and CDNs must revalidate, so a publish is visible on the next request.
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }
  res.type('application/json').send(body);
}
