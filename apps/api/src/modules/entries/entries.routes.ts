import { Router, type Request } from 'express';
import type { Entry, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PAGE_TYPE_ID, WORKFLOW_TRANSITIONS, type WorkflowAction, sameJson } from '@meridian/shared';
import { env } from '../../config/env';
import { badRequest, notFound } from '../../lib/errors';
import { clientIp, param, parse, toPage } from '../../lib/http';
import { prisma, redis } from '../../lib/infra';
import { envOf, envScope, requirePermission, signPreviewToken, userOf } from '../../middleware/auth';
import { scopeFromRequest } from '../events/events.service';
import { type LoadedType, isPageType, loadSchema } from '../schema/schema.service';
import { parseEntryQuery, runEntryQuery } from './entries.query';
import {
  type EngineContext,
  bulkAction,
  createEntry,
  deleteEntry,
  duplicateEntry,
  getEntry,
  publishEntry,
  restoreFromTrash,
  restoreVersion,
  scheduleEntry,
  transitionEntry,
  unpublishEntry,
  updateEntry,
} from './entries.service';

export const entriesRouter = Router({ mergeParams: true });

export async function defaultLocaleOf(projectId: string): Promise<string> {
  const locale = await prisma.locale.findFirst({ where: { projectId, isDefault: true }, select: { code: true } });
  return locale?.code ?? 'en';
}

async function engine(req: Request): Promise<EngineContext> {
  const { environment, project } = envOf(req);
  const user = userOf(req);
  const [schema, defaultLocale] = await Promise.all([loadSchema(environment.id), defaultLocaleOf(project.id)]);
  return {
    scope: scopeFromRequest(req),
    schema,
    defaultLocale,
    actor: { type: 'user', id: user.id, label: user.name, ip: clientIp(req) },
  };
}

function typeFromParam(ctx: EngineContext, key: string): LoadedType {
  const type = ctx.schema.typeById.get(key) ?? ctx.schema.typeByApiId.get(key);
  if (!type) throw notFound('Content type');
  return type;
}

async function entryAndType(req: Request, ctx: EngineContext, opts: { includeDeleted?: boolean } = {}) {
  const entry = await getEntry(ctx.scope.environment.id, param(req, 'entryId'), opts);
  const type = ctx.schema.typeById.get(entry.contentTypeId);
  if (!type) throw notFound('Content type');
  return { entry, type };
}

async function userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

const hasChanges = (e: Entry) => !!e.publishedAt && !sameJson(e.data, e.publishedData);

/** Hides sealed secrets from the management API too: editors see whether one is set, never its hash. */
function maskSecrets(type: LoadedType, data: unknown) {
  const out = { ...(data as Record<string, unknown>) };
  for (const f of type.fields) if (f.type === 'password' && out[f.apiId]) out[f.apiId] = { $secret: 'set' };
  return out;
}

function summary(entry: Entry & { hasChanges?: boolean }, type: LoadedType, names: Map<string, string>) {
  return {
    id: entry.id,
    documentId: entry.documentId,
    contentType: type.apiId,
    locale: entry.locale,
    title: entry.title,
    slug: entry.slug,
    path: entry.path,
    parentId: entry.parentId,
    position: entry.position,
    status: entry.status,
    isPublished: !!entry.publishedAt,
    hasChanges: entry.hasChanges ?? hasChanges(entry),
    publishedAt: entry.publishedAt,
    scheduledPublishAt: entry.scheduledPublishAt,
    scheduledUnpublishAt: entry.scheduledUnpublishAt,
    lockVersion: entry.lockVersion,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    deletedAt: entry.deletedAt,
    updatedBy: entry.updatedById ? (names.get(entry.updatedById) ?? null) : null,
    createdBy: entry.createdById ? (names.get(entry.createdById) ?? null) : null,
  };
}

async function detail(ctx: EngineContext, entry: Entry, type: LoadedType) {
  const [names, variants, versionCount, commentCount] = await Promise.all([
    userNames([entry.updatedById, entry.createdById, entry.assigneeId]),
    prisma.entry.findMany({
      where: { documentId: entry.documentId, deletedAt: null },
      select: { id: true, locale: true, status: true, publishedAt: true },
      orderBy: { locale: 'asc' },
    }),
    prisma.entryVersion.count({ where: { entryId: entry.id } }),
    prisma.comment.count({ where: { entryId: entry.id, resolvedAt: null } }),
  ]);
  return {
    ...summary(entry, type, names),
    data: isPageType(type) ? entry.data : maskSecrets(type, entry.data),
    assigneeId: entry.assigneeId,
    assignee: entry.assigneeId ? (names.get(entry.assigneeId) ?? null) : null,
    firstPublishedAt: entry.firstPublishedAt,
    publishedVersionId: entry.publishedVersionId,
    variants: variants.map((v) => ({ id: v.id, locale: v.locale, status: v.status, isPublished: !!v.publishedAt })),
    versionCount,
    openComments: commentCount,
    requiresApproval: !!type.options.requireApproval,
    defaultLocale: ctx.defaultLocale,
  };
}

// ─── Lists ───────────────────────────────────────────────────────────────────

entriesRouter.get('/entries/:typeId', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const type = typeFromParam(ctx, param(req, 'typeId'));
  const query = parseEntryQuery(req.query as Record<string, unknown>, { maxLimit: 200 });
  const trash = req.query.trash === 'true';
  const { rows, total } = await runEntryQuery({ environmentId: ctx.scope.environment.id, type, query, mode: 'draft', trash });
  const names = await userNames(rows.flatMap((r) => [r.updatedById, r.createdById]));
  const page = Math.floor(query.offset / query.limit) + 1;
  res.json(
    toPage(
      rows.map((r) => ({ ...summary(r, type, names), data: isPageType(type) ? undefined : maskSecrets(type, r.data) })),
      total,
      page,
      query.limit,
    ),
  );
});

const createBody = z.object({
  data: z.record(z.string(), z.unknown()),
  locale: z.string().max(20).optional(),
  parentId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid().optional(),
});

entriesRouter.post('/entries/:typeId', envScope('content.create'), async (req, res) => {
  const ctx = await engine(req);
  const type = typeFromParam(ctx, param(req, 'typeId'));
  const input = parse(createBody, req.body);
  const entry = await createEntry(ctx, type, input);
  res.status(201).json(await detail(ctx, entry, type));
});

entriesRouter.post('/entries/:typeId/bulk', envScope('content.read'), async (req, res) => {
  const input = parse(
    z.object({ ids: z.array(z.string().uuid()).min(1).max(200), action: z.enum(['publish', 'unpublish', 'delete', 'archive', 'restore']) }),
    req.body,
  );
  requirePermission(req, input.action === 'delete' || input.action === 'restore' ? 'content.delete' : 'content.publish');
  const ctx = await engine(req);
  const type = typeFromParam(ctx, param(req, 'typeId'));
  res.json(await bulkAction(ctx, type, input.ids, input.action));
});

entriesRouter.get('/entries/:typeId/export', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const type = typeFromParam(ctx, param(req, 'typeId'));
  const rows = await prisma.entry.findMany({
    where: { environmentId: ctx.scope.environment.id, contentTypeId: type.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 5000,
  });
  res.setHeader('Content-Disposition', `attachment; filename="${type.apiId}-export.json"`);
  res.json({
    contentType: type.apiId,
    schemaVersion: type.schemaVersion,
    exportedAt: new Date().toISOString(),
    items: rows.map((r) => {
      const data = { ...(r.data as Record<string, unknown>) };
      // Secrets never leave the system, even in an export.
      for (const f of type.fields) if (f.type === 'password') delete data[f.apiId];
      return { documentId: r.documentId, locale: r.locale, status: r.status, isPublished: !!r.publishedAt, data };
    }),
  });
});

entriesRouter.post('/entries/:typeId/import', envScope('content.create'), async (req, res) => {
  const input = parse(
    z.object({ items: z.array(z.object({ data: z.record(z.string(), z.unknown()), locale: z.string().max(20).optional() })).min(1).max(500) }),
    req.body,
  );
  const ctx = await engine(req);
  const type = typeFromParam(ctx, param(req, 'typeId'));
  if (isPageType(type)) throw badRequest('Pages cannot be imported through the content importer');
  const results: { index: number; ok: boolean; id?: string; error?: string; details?: unknown }[] = [];
  for (const [index, item] of input.items.entries()) {
    try {
      const entry = await createEntry(ctx, type, { data: item.data, locale: item.locale });
      results.push({ index, ok: true, id: entry.id });
    } catch (err) {
      const e = err as { message: string; details?: unknown };
      results.push({ index, ok: false, error: e.message, details: e.details });
    }
  }
  res.json({ results, imported: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});

// ─── Single entry ────────────────────────────────────────────────────────────

entriesRouter.get('/entry/:entryId', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry, type } = await entryAndType(req, ctx, { includeDeleted: true });
  res.json(await detail(ctx, entry, type));
});

const updateBody = z.object({
  data: z.record(z.string(), z.unknown()),
  lockVersion: z.number().int().optional(),
  autosave: z.boolean().default(false),
  note: z.string().max(500).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

entriesRouter.put('/entry/:entryId', envScope('content.update'), async (req, res) => {
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const input = parse(updateBody, req.body);
  const entry = await updateEntry(ctx, type, param(req, 'entryId'), input);
  res.json(await detail(ctx, entry, type));
});

entriesRouter.patch('/entry/:entryId/assignee', envScope('content.update'), async (req, res) => {
  const input = parse(z.object({ assigneeId: z.string().uuid().nullable() }), req.body);
  const ctx = await engine(req);
  const { entry, type } = await entryAndType(req, ctx);
  if (input.assigneeId) {
    const member = await prisma.membership.findFirst({
      where: { organizationId: ctx.scope.organizationId, userId: input.assigneeId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) throw badRequest('Assignee must be an active member of this organization');
  }
  const updated = await prisma.entry.update({ where: { id: entry.id }, data: { assigneeId: input.assigneeId } });
  res.json(await detail(ctx, updated, type));
});

entriesRouter.delete('/entry/:entryId', envScope('content.delete'), async (req, res) => {
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx, { includeDeleted: true });
  await deleteEntry(ctx, type, param(req, 'entryId'), { permanent: req.query.permanent === 'true' });
  res.status(204).end();
});

entriesRouter.post('/entry/:entryId/restore', envScope('content.delete'), async (req, res) => {
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx, { includeDeleted: true });
  const entry = await restoreFromTrash(ctx, type, param(req, 'entryId'));
  res.json(await detail(ctx, entry, type));
});

entriesRouter.post('/entry/:entryId/duplicate', envScope('content.create'), async (req, res) => {
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const entry = await duplicateEntry(ctx, type, param(req, 'entryId'));
  res.status(201).json(await detail(ctx, entry, type));
});

entriesRouter.post('/entry/:entryId/publish', envScope('content.publish'), async (req, res) => {
  const input = parse(z.object({ note: z.string().max(500).optional() }), req.body ?? {});
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const entry = await publishEntry(ctx, type, param(req, 'entryId'), input);
  res.json(await detail(ctx, entry, type));
});

entriesRouter.post('/entry/:entryId/unpublish', envScope('content.publish'), async (req, res) => {
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const entry = await unpublishEntry(ctx, type, param(req, 'entryId'));
  res.json(await detail(ctx, entry, type));
});

entriesRouter.post('/entry/:entryId/schedule', envScope('content.publish'), async (req, res) => {
  const input = parse(
    z.object({ publishAt: z.coerce.date().nullable().optional(), unpublishAt: z.coerce.date().nullable().optional() }),
    req.body,
  );
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const entry = await scheduleEntry(ctx, type, param(req, 'entryId'), input);
  res.json(await detail(ctx, entry, type));
});

const WORKFLOW_ACTIONS = ['submit', 'withdraw', 'approve', 'request_changes', 'archive', 'unarchive'] as const;

entriesRouter.post('/entry/:entryId/transition', envScope('content.read'), async (req, res) => {
  const input = parse(z.object({ action: z.enum(WORKFLOW_ACTIONS), comment: z.string().max(4000).optional() }), req.body);
  // Each workflow step carries its own permission (e.g. only reviewers may approve).
  requirePermission(req, WORKFLOW_TRANSITIONS[input.action as WorkflowAction].permission);
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const entry = await transitionEntry(ctx, type, param(req, 'entryId'), input.action, input.comment);
  res.json(await detail(ctx, entry, type));
});

// ─── Versions ────────────────────────────────────────────────────────────────

entriesRouter.get('/entry/:entryId/versions', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx, { includeDeleted: true });
  const versions = await prisma.entryVersion.findMany({
    where: { entryId: entry.id },
    orderBy: { number: 'desc' },
    take: 200,
    select: { id: true, number: true, kind: true, title: true, note: true, createdById: true, createdAt: true, updatedAt: true },
  });
  const names = await userNames(versions.map((v) => v.createdById));
  res.json({
    items: versions.map((v) => ({
      ...v,
      createdBy: v.createdById ? (names.get(v.createdById) ?? null) : null,
      isPublished: v.id === entry.publishedVersionId,
    })),
  });
});

entriesRouter.get('/entry/:entryId/versions/:versionId', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry, type } = await entryAndType(req, ctx, { includeDeleted: true });
  const version = await prisma.entryVersion.findFirst({ where: { id: param(req, 'versionId'), entryId: entry.id } });
  if (!version) throw notFound('Version');
  const names = await userNames([version.createdById]);
  res.json({
    ...version,
    data: isPageType(type) ? version.data : maskSecrets(type, version.data),
    createdBy: version.createdById ? (names.get(version.createdById) ?? null) : null,
    isPublished: version.id === entry.publishedVersionId,
  });
});

entriesRouter.post('/entry/:entryId/versions/:versionId/restore', envScope('content.update'), async (req, res) => {
  const ctx = await engine(req);
  const { type } = await entryAndType(req, ctx);
  const entry = await restoreVersion(ctx, type, param(req, 'entryId'), param(req, 'versionId'));
  res.json(await detail(ctx, entry, type));
});

// ─── Comments and activity ───────────────────────────────────────────────────

entriesRouter.get('/entry/:entryId/comments', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx, { includeDeleted: true });
  const comments = await prisma.comment.findMany({ where: { entryId: entry.id }, orderBy: { createdAt: 'asc' }, take: 500 });
  const names = await userNames(comments.map((c) => c.userId));
  res.json({ items: comments.map((c) => ({ ...c, author: names.get(c.userId) ?? 'Former member' })) });
});

entriesRouter.post('/entry/:entryId/comments', envScope('content.read'), async (req, res) => {
  const input = parse(z.object({ body: z.string().trim().min(1, 'Write a comment').max(4000) }), req.body);
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx);
  const user = userOf(req);
  const comment = await prisma.comment.create({ data: { entryId: entry.id, userId: user.id, body: input.body } });
  res.status(201).json({ ...comment, author: user.name });
});

entriesRouter.patch('/entry/:entryId/comments/:commentId', envScope('content.read'), async (req, res) => {
  const input = parse(z.object({ resolved: z.boolean() }), req.body);
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx);
  const comment = await prisma.comment.findFirst({ where: { id: param(req, 'commentId'), entryId: entry.id } });
  if (!comment) throw notFound('Comment');
  const updated = await prisma.comment.update({ where: { id: comment.id }, data: { resolvedAt: input.resolved ? new Date() : null } });
  const names = await userNames([updated.userId]);
  res.json({ ...updated, author: names.get(updated.userId) ?? 'Former member' });
});

entriesRouter.delete('/entry/:entryId/comments/:commentId', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx);
  // People delete their own comments; moderators with delete rights can remove any.
  const comment = await prisma.comment.findFirst({ where: { id: param(req, 'commentId'), entryId: entry.id } });
  if (!comment) throw notFound('Comment');
  if (comment.userId !== userOf(req).id) requirePermission(req, 'content.delete');
  await prisma.comment.delete({ where: { id: comment.id } });
  res.status(204).end();
});

entriesRouter.get('/entry/:entryId/activity', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx, { includeDeleted: true });
  const items = await prisma.auditLog.findMany({
    where: { environmentId: ctx.scope.environment.id, resourceId: entry.id, resourceType: { in: ['entry', 'page'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, action: true, actorLabel: true, actorType: true, metadata: true, createdAt: true },
  });
  res.json({ items });
});

// ─── Preview and presence ────────────────────────────────────────────────────

entriesRouter.post('/entry/:entryId/preview-token', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry, type } = await entryAndType(req, ctx);
  const token = await signPreviewToken({ environmentId: ctx.scope.environment.id, entryId: entry.id }, 3600);
  const apiUrl = `${env.PUBLIC_API_URL}/api/v1/preview?token=${token}`;
  const template = type.options.previewUrl || (envOf(req).project.settings.previewUrl as string | undefined);
  const fill = (t: string) =>
    t
      .replaceAll('{token}', encodeURIComponent(token))
      .replaceAll('{id}', entry.documentId)
      .replaceAll('{slug}', encodeURIComponent(entry.slug ?? ''))
      .replaceAll('{path}', entry.path ?? '')
      .replaceAll('{locale}', entry.locale)
      .replaceAll('{type}', type.apiId);
  res.json({ token, expiresIn: 3600, apiUrl, previewUrl: template ? fill(template) : null });
});

const lockKey = (entryId: string) => `editing:${entryId}`;

/** Advisory presence: tells editors who else has this entry open. Saves are protected separately by lockVersion. */
entriesRouter.post('/entry/:entryId/presence', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const { entry } = await entryAndType(req, ctx);
  const user = userOf(req);
  const key = lockKey(entry.id);
  await redis.hset(key, user.id, JSON.stringify({ name: user.name, at: Date.now() }));
  await redis.expire(key, 90);
  const all = await redis.hgetall(key);
  const others = Object.entries(all)
    .filter(([id]) => id !== user.id)
    .map(([id, raw]) => ({ id, ...(JSON.parse(raw) as { name: string; at: number }) }))
    .filter((o) => Date.now() - o.at < 45_000);
  res.json({ others: others.map((o) => ({ id: o.id, name: o.name })) });
});

entriesRouter.delete('/entry/:entryId/presence', envScope('content.read'), async (req, res) => {
  await redis.hdel(lockKey(param(req, 'entryId')), userOf(req).id);
  res.status(204).end();
});

// ─── Cross-type views ────────────────────────────────────────────────────────

entriesRouter.get('/pages/tree', envScope('content.read'), async (req, res) => {
  const ctx = await engine(req);
  const type = typeFromParam(ctx, PAGE_TYPE_ID);
  const locale = typeof req.query.locale === 'string' ? req.query.locale : ctx.defaultLocale;
  const rows = await prisma.entry.findMany({
    where: { environmentId: ctx.scope.environment.id, contentTypeId: type.id, deletedAt: null, locale },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    take: 2000,
  });
  const names = await userNames(rows.map((r) => r.updatedById));
  res.json({
    items: rows.map((r) => {
      const data = r.data as { template?: string; category?: string; blocks?: unknown[] };
      return { ...summary(r, type, names), template: data.template ?? 'default', category: data.category ?? null, blockCount: Array.isArray(data.blocks) ? data.blocks.length : 0 };
    }),
  });
});

entriesRouter.post('/pages/reorder', envScope('content.update'), async (req, res) => {
  const input = parse(z.object({ parentId: z.string().uuid().nullable(), orderedIds: z.array(z.string().uuid()).min(1).max(500) }), req.body);
  const ctx = await engine(req);
  const type = typeFromParam(ctx, PAGE_TYPE_ID);
  const pages = await prisma.entry.findMany({
    where: { id: { in: input.orderedIds }, environmentId: ctx.scope.environment.id, contentTypeId: type.id, parentId: input.parentId, deletedAt: null },
    select: { id: true },
  });
  if (pages.length !== input.orderedIds.length) throw badRequest('Reorder list must contain exactly the sibling pages of one parent');
  await prisma.$transaction(input.orderedIds.map((id, position) => prisma.entry.update({ where: { id }, data: { position } })));
  res.status(204).end();
});

async function crossTypeList(req: Request, where: Prisma.EntryWhereInput, orderBy: Prisma.EntryOrderByWithRelationInput, take = 50) {
  const ctx = await engine(req);
  const rows = await prisma.entry.findMany({ where: { environmentId: ctx.scope.environment.id, deletedAt: null, ...where }, orderBy, take });
  const names = await userNames(rows.flatMap((r) => [r.updatedById, r.assigneeId]));
  return rows.flatMap((r) => {
    const type = ctx.schema.typeById.get(r.contentTypeId);
    return type ? [{ ...summary(r, type, names), contentTypeName: type.displayName, isPage: isPageType(type), assignee: r.assigneeId ? (names.get(r.assigneeId) ?? null) : null }] : [];
  });
}

entriesRouter.get('/scheduled', envScope('content.read'), async (req, res) => {
  res.json({
    items: await crossTypeList(
      req,
      { OR: [{ scheduledPublishAt: { not: null } }, { scheduledUnpublishAt: { not: null } }] },
      { scheduledPublishAt: 'asc' },
      200,
    ),
  });
});

entriesRouter.get('/reviews', envScope('content.read'), async (req, res) => {
  res.json({ items: await crossTypeList(req, { status: { in: ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] } }, { updatedAt: 'desc' }, 200) });
});

entriesRouter.get('/recent', envScope('content.read'), async (req, res) => {
  res.json({ items: await crossTypeList(req, {}, { updatedAt: 'desc' }, 20) });
});

entriesRouter.get('/versions', envScope('content.read'), async (req, res) => {
  const q = parse(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
      kind: z.enum(['SAVE', 'AUTOSAVE', 'PUBLISH', 'RESTORE']).optional(),
    }),
    req.query,
  );
  const ctx = await engine(req);
  const where: Prisma.EntryVersionWhereInput = { entry: { environmentId: ctx.scope.environment.id }, ...(q.kind ? { kind: q.kind } : { kind: { not: 'AUTOSAVE' } }) };
  const [versions, total] = await Promise.all([
    prisma.entryVersion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        number: true,
        kind: true,
        title: true,
        note: true,
        createdById: true,
        createdAt: true,
        entry: { select: { id: true, contentTypeId: true, title: true, locale: true, publishedVersionId: true, deletedAt: true } },
      },
    }),
    prisma.entryVersion.count({ where }),
  ]);
  const names = await userNames(versions.map((v) => v.createdById));
  res.json(
    toPage(
      versions.map((v) => {
        const type = ctx.schema.typeById.get(v.entry.contentTypeId);
        return {
          id: v.id,
          number: v.number,
          kind: v.kind,
          title: v.title ?? v.entry.title,
          note: v.note,
          createdAt: v.createdAt,
          createdBy: v.createdById ? (names.get(v.createdById) ?? null) : null,
          entryId: v.entry.id,
          entryDeleted: !!v.entry.deletedAt,
          locale: v.entry.locale,
          contentType: type?.apiId ?? null,
          contentTypeName: type?.displayName ?? 'Unknown',
          isPage: type ? isPageType(type) : false,
          isPublished: v.id === v.entry.publishedVersionId,
        };
      }),
      total,
      q.page,
      q.pageSize,
    ),
  );
});

/** Global search across entries and pages, used by the command palette. */
entriesRouter.get('/search', envScope('content.read'), async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
  const ctx = await engine(req);
  const rows = await prisma.entry.findMany({
    where: {
      environmentId: ctx.scope.environment.id,
      deletedAt: null,
      OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q, mode: 'insensitive' } }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 12,
    select: { id: true, title: true, slug: true, path: true, status: true, contentTypeId: true, locale: true },
  });
  res.json({
    items: rows.flatMap((r) => {
      const type = ctx.schema.typeById.get(r.contentTypeId);
      return type ? [{ ...r, contentType: type.apiId, contentTypeName: type.singularName, isPage: isPageType(type) }] : [];
    }),
  });
});

/** Entries of one type, shaped for relationship pickers. */
entriesRouter.get('/relation-options/:typeId', envScope('content.read'), async (req, res) => {
  const q = parse(z.object({ search: z.string().trim().max(100).optional(), ids: z.string().max(8000).optional() }), req.query);
  const ctx = await engine(req);
  const type = typeFromParam(ctx, param(req, 'typeId'));
  const ids = q.ids?.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = await prisma.entry.findMany({
    where: {
      environmentId: ctx.scope.environment.id,
      contentTypeId: type.id,
      deletedAt: null,
      locale: ctx.defaultLocale,
      ...(ids ? { documentId: { in: ids } } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: ids ? 200 : 25,
    select: { id: true, documentId: true, title: true, status: true, publishedAt: true },
  });
  res.json({
    items: rows.map((r) => ({ id: r.documentId, entryId: r.id, title: r.title ?? `Untitled ${type.singularName.toLowerCase()}`, status: r.status, isPublished: !!r.publishedAt })),
  });
});
