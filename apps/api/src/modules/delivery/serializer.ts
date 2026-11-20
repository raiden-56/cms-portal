import type { Entry, MediaAsset } from '@prisma/client';
import {
  type BlockNode,
  type FieldDef,
  type PageData,
  collectReferences,
  isRelationField,
  isUuid,
  renderRichTextToHtml,
  walkBlocks,
} from '@meridian/shared';
import { env } from '../../config/env';
import { prisma } from '../../lib/infra';
import { type EnvSchema, type LoadedType, isPageType } from '../schema/schema.service';

export interface MediaOut {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  kind: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  caption: string;
}

export function mediaUrl(asset: Pick<MediaAsset, 'id' | 'revision' | 'filename'>): string {
  const base = (env.MEDIA_CDN_URL ?? env.PUBLIC_API_URL).replace(/\/$/, '');
  // The revision is part of the URL, so a replaced file gets a new address while the asset id stays stable.
  return `${base}/media/${asset.id}/${asset.revision}/${encodeURIComponent(asset.filename)}`;
}

export function toMediaOut(asset: MediaAsset): MediaOut {
  return {
    id: asset.id,
    url: mediaUrl(asset),
    filename: asset.filename,
    mimeType: asset.mimeType,
    kind: asset.kind,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    alt: asset.alt,
    caption: asset.caption,
  };
}

export type PopulateTree = { [field: string]: PopulateTree } | '*';

/** `author,category.parent` → { author: {}, category: { parent: {} } }. `*` populates every relation one level deep. */
export function parsePopulate(raw: unknown): PopulateTree {
  const value = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '';
  if (!value.trim()) return {};
  if (value.trim() === '*') return '*';
  const tree: { [field: string]: PopulateTree } = {};
  for (const path of value.split(',').map((p) => p.trim()).filter(Boolean).slice(0, 40)) {
    let node = tree;
    for (const part of path.split('.').slice(0, 4)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(part)) break;
      const next = node[part];
      if (next === '*' || next === undefined) node[part] = {};
      node = node[part] as { [field: string]: PopulateTree };
    }
  }
  return tree;
}

export interface DeliveryContext {
  schema: EnvSchema;
  environmentId: string;
  projectId: string;
  /** `live` reads only published snapshots. `draft` reads working copies and is reserved for authorised previews. */
  mode: 'live' | 'draft';
  /** Locales to try, most preferred first: requested → its fallback → project default. */
  localeChain: string[];
  richtext: 'json' | 'html';
  media: Map<string, MediaOut | null>;
}

export function createDeliveryContext(input: Omit<DeliveryContext, 'media'>): DeliveryContext {
  return { ...input, media: new Map() };
}

const MAX_POPULATE_DEPTH = 4;

async function loadMedia(ctx: DeliveryContext, ids: string[]) {
  const missing = [...new Set(ids)].filter((id) => !ctx.media.has(id));
  if (missing.length === 0) return;
  const assets = await prisma.mediaAsset.findMany({ where: { id: { in: missing }, projectId: ctx.projectId, deletedAt: null } });
  for (const id of missing) ctx.media.set(id, null);
  for (const asset of assets) ctx.media.set(asset.id, toMediaOut(asset));
}

/** Loads documents by id, choosing for each the best available locale variant. */
export async function loadDocuments(ctx: DeliveryContext, type: LoadedType, documentIds: string[]): Promise<Entry[]> {
  const ids = [...new Set(documentIds)].filter(isUuid);
  if (ids.length === 0) return [];
  const rows = await prisma.entry.findMany({
    where: {
      environmentId: ctx.environmentId,
      contentTypeId: type.id,
      documentId: { in: ids },
      locale: { in: ctx.localeChain },
      deletedAt: null,
      ...(ctx.mode === 'live' ? { publishedAt: { not: null } } : {}),
    },
  });
  const best = new Map<string, Entry>();
  for (const row of rows) {
    const current = best.get(row.documentId);
    if (!current || ctx.localeChain.indexOf(row.locale) < ctx.localeChain.indexOf(current.locale)) best.set(row.documentId, row);
  }
  return ids.map((id) => best.get(id)).filter((row): row is Entry => !!row);
}

const dataOf = (ctx: DeliveryContext, row: Entry) => ((ctx.mode === 'live' ? row.publishedData : row.data) ?? {}) as Record<string, unknown>;

function pageMedia(schema: EnvSchema, page: PageData): string[] {
  const ids = new Set<string>();
  if (isUuid(page.seo?.ogImage)) ids.add(page.seo.ogImage);
  walkBlocks((page.blocks ?? []) as BlockNode[], (node) => {
    const def = schema.blockRegistry[node.type];
    if (def) collectReferences(def.fields, node.props ?? {}, schema.componentFields).media.forEach((id) => ids.add(id));
    if (isUuid(node.style?.background?.imageId)) ids.add(node.style.background.imageId);
  });
  return [...ids];
}

type Populated = Map<string, Record<string, unknown>>;

function shapeObject(
  ctx: DeliveryContext,
  fields: FieldDef[],
  data: Record<string, unknown> | null | undefined,
  populated: Populated | null,
  select?: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
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
      return typeof value === 'string' ? (ctx.media.get(value) ?? null) : null;
    case 'images':
    case 'files':
      return Array.isArray(value) ? value.map((id) => ctx.media.get(String(id))).filter(Boolean) : [];
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
      return fields && typeof value === 'object' ? shapeObject(ctx, fields, value as Record<string, unknown>, null) : null;
    }
    case 'repeatable': {
      const fields = ctx.schema.componentFields[f.config.component ?? ''];
      return fields && Array.isArray(value) ? value.map((item) => shapeObject(ctx, fields, item as Record<string, unknown>, null)) : [];
    }
    case 'dynamiczone': {
      if (!Array.isArray(value)) return [];
      return value.flatMap((item) => {
        const node = item as { id?: string; type?: string; props?: Record<string, unknown> };
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
    const out: Record<string, unknown> = { id: node.id, type: node.type, props: shapeObject(ctx, def.fields, node.props, null) };
    if (node.style) {
      const { background, ...rest } = node.style;
      out.style = background
        ? { ...rest, background: { color: background.color, overlay: background.overlay, image: background.imageId ? (ctx.media.get(background.imageId) ?? null) : null } }
        : rest;
    }
    if (def.acceptsChildren) out.children = shapeBlocks(ctx, node.children);
    return [out];
  });
}

export interface SerializeOptions {
  populate?: PopulateTree;
  /** Restrict output to these field ids (system attributes are always included). */
  select?: Set<string>;
}

/**
 * Turns stored rows into API resources: expands media, resolves requested relations
 * (batched per level, so list size never multiplies queries), renders rich text and
 * removes private fields.
 */
export async function serializeEntries(
  ctx: DeliveryContext,
  type: LoadedType,
  rows: Entry[],
  opts: SerializeOptions = {},
  depth = 0,
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const populate = opts.populate ?? {};
  const datas = rows.map((row) => dataOf(ctx, row));
  const page = isPageType(type);

  const mediaIds = new Set<string>();
  for (const data of datas) {
    const ids = page ? pageMedia(ctx.schema, data as unknown as PageData) : collectReferences(type.fields, data, ctx.schema.componentFields).media;
    ids.forEach((id) => mediaIds.add(id));
  }
  await loadMedia(ctx, [...mediaIds]);

  const base = (row: Entry) => ({
    id: row.documentId,
    type: type.apiId,
    locale: row.locale,
    ...(ctx.mode === 'draft' ? { status: row.status } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  });

  if (page) {
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((id): id is string => !!id))];
    const parents = parentIds.length
      ? await prisma.entry.findMany({ where: { id: { in: parentIds } }, select: { id: true, documentId: true, path: true, publishedPath: true } })
      : [];
    const parentById = new Map(parents.map((p) => [p.id, p]));
    return rows.map((row, i) => {
      const data = datas[i] as unknown as PageData;
      const parent = row.parentId ? parentById.get(row.parentId) : undefined;
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
        seo: { ...seo, ogImage: seo.ogImage ? (ctx.media.get(seo.ogImage) ?? null) : null },
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
      const targets = await loadDocuments(ctx, target, ids);
      const serialized = await serializeEntries(ctx, target, targets, { populate: sub === '*' ? {} : sub }, depth + 1);
      for (const item of serialized) populated.set(`${f.apiId}:${item.id as string}`, item);
    }
  }

  return rows.map((row, i) => ({ ...base(row), ...shapeObject(ctx, type.fields, datas[i], populated, opts.select) }));
}
