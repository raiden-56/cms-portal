/** Entries, pages, versions, comments and the cross-type editorial lists. */
import { z } from 'zod';
import { PAGE_TYPE_ID, newId } from '@meridian/shared';
import { type Ctx, defaultLocaleOf, envScope, guest, isPageType, loadSchema, str, userNames } from '../context';
import { type DbEntry, type DbType, type Json, db, now, nowIso } from '../db';
import {
  type Engine,
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
} from '../engine';
import { HttpError, Reply, badRequest, created, noContent, notFound, paginate, parse, toPage } from '../http';
import { PUBLIC_API_URL } from '../openapi';
import { hasChanges, parseEntryQuery, runEntryQuery } from '../query';
import type { Router } from '../router';

export function engineOf(c: Ctx): Engine {
  const scope = envScope(c);
  return { scope, schema: loadSchema(scope.environment.id), defaultLocale: defaultLocaleOf(scope.project.id), actor: c.actor };
}

function typeFromParam(ctx: Engine, key: string): DbType {
  const type = ctx.schema.typeById.get(key) ?? ctx.schema.typeByApiId.get(key);
  if (!type) throw notFound('Content type');
  return type;
}

function entryAndType(c: Ctx, ctx: Engine, opts: { includeDeleted?: boolean } = {}) {
  const entry = getEntry(ctx.scope.environment.id, c.params.entryId, opts);
  const type = ctx.schema.typeById.get(entry.contentTypeId);
  if (!type) throw notFound('Content type');
  return { entry, type };
}

/** Editors see whether a secret is set, never what was typed. */
function maskSecrets(type: DbType, data: Json): Json {
  const out = { ...data };
  for (const f of type.fields) if (f.type === 'password' && out[f.apiId]) out[f.apiId] = { $secret: 'set' };
  return out;
}

export function summary(entry: DbEntry, type: DbType, names: Map<string, string>) {
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
    hasChanges: hasChanges(entry),
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

function detail(ctx: Engine, entry: DbEntry, type: DbType) {
  const names = userNames();
  const variants = db.entries.filter((e) => e.documentId === entry.documentId && !e.deletedAt).sort((a, b) => a.locale.localeCompare(b.locale));
  return {
    ...summary(entry, type, names),
    data: isPageType(type) ? entry.data : maskSecrets(type, entry.data),
    assigneeId: entry.assigneeId,
    assignee: entry.assigneeId ? (names.get(entry.assigneeId) ?? null) : null,
    firstPublishedAt: entry.firstPublishedAt,
    publishedVersionId: entry.publishedVersionId,
    variants: variants.map((v) => ({ id: v.id, locale: v.locale, status: v.status, isPublished: !!v.publishedAt })),
    versionCount: db.versions.filter((v) => v.entryId === entry.id).length,
    openComments: db.comments.filter((x) => x.entryId === entry.id && !x.resolvedAt).length,
    requiresApproval: !!type.options.requireApproval,
    defaultLocale: ctx.defaultLocale,
  };
}

const uuid = z.string().uuid();
const createBody = z.object({ data: z.record(z.string(), z.unknown()), locale: z.string().max(20).optional(), parentId: uuid.nullable().optional(), documentId: uuid.optional() });
const updateBody = z.object({
  data: z.record(z.string(), z.unknown()),
  lockVersion: z.number().int().optional(),
  autosave: z.boolean().default(false),
  note: z.string().max(500).optional(),
  parentId: uuid.nullable().optional(),
});
const WORKFLOW_ACTIONS = ['submit', 'withdraw', 'approve', 'request_changes', 'archive', 'unarchive'] as const;

export function entryRoutes(r: Router): void {
  const env = '/envs/:envId';

  // ─── Lists ─────────────────────────────────────────────────────────────────

  r.get(`${env}/entries/:typeId`, (c) => {
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, c.params.typeId);
    const query = parseEntryQuery(c.query, { maxLimit: 200 });
    const { rows, total } = runEntryQuery({ environmentId: ctx.scope.environment.id, type, query, mode: 'draft', trash: c.query.trash === 'true' });
    const names = userNames();
    return toPage(
      rows.map((row) => ({ ...summary(row, type, names), data: isPageType(type) ? undefined : maskSecrets(type, row.data) })),
      total,
      Math.floor(query.offset / query.limit) + 1,
      query.limit,
    );
  });

  r.post(`${env}/entries/:typeId`, (c) => {
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, c.params.typeId);
    return created(detail(ctx, createEntry(ctx, type, parse(createBody, c.body)), type));
  });

  r.post(`${env}/entries/:typeId/bulk`, (c) => {
    const input = parse(z.object({ ids: z.array(uuid).min(1).max(200), action: z.enum(['publish', 'unpublish', 'delete', 'archive', 'restore']) }), c.body);
    const ctx = engineOf(c);
    return bulkAction(ctx, typeFromParam(ctx, c.params.typeId), input.ids, input.action);
  });

  r.get(`${env}/entries/:typeId/export`, (c) => {
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, c.params.typeId);
    const rows = db.entries
      .filter((e) => e.environmentId === ctx.scope.environment.id && e.contentTypeId === type.id && !e.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return new Reply(
      200,
      {
        contentType: type.apiId,
        schemaVersion: type.schemaVersion,
        exportedAt: nowIso(),
        items: rows.map((row) => {
          const data = { ...row.data };
          // Secrets never leave the system, even in an export.
          for (const f of type.fields) if (f.type === 'password') delete data[f.apiId];
          return { documentId: row.documentId, locale: row.locale, status: row.status, isPublished: !!row.publishedAt, data };
        }),
      },
      { 'content-disposition': `attachment; filename="${type.apiId}-export.json"` },
    );
  });

  r.post(`${env}/entries/:typeId/import`, (c) => {
    const input = parse(z.object({ items: z.array(z.object({ data: z.record(z.string(), z.unknown()), locale: z.string().max(20).optional() })).min(1).max(500) }), c.body);
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, c.params.typeId);
    if (isPageType(type)) throw badRequest('Pages cannot be imported through the content importer');
    const results: { index: number; ok: boolean; id?: string; error?: string; details?: unknown }[] = [];
    input.items.forEach((item, index) => {
      try {
        results.push({ index, ok: true, id: createEntry(ctx, type, { data: item.data, locale: item.locale }).id });
      } catch (err) {
        const e = err as HttpError;
        results.push({ index, ok: false, error: e.message, details: e.details });
      }
    });
    return { results, imported: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length };
  });

  // ─── Single entry ──────────────────────────────────────────────────────────

  r.get(`${env}/entry/:entryId`, (c) => {
    const ctx = engineOf(c);
    const { entry, type } = entryAndType(c, ctx, { includeDeleted: true });
    return detail(ctx, entry, type);
  });

  r.put(`${env}/entry/:entryId`, (c) => {
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return detail(ctx, updateEntry(ctx, type, c.params.entryId, parse(updateBody, c.body)), type);
  });

  r.patch(`${env}/entry/:entryId/assignee`, (c) => {
    const input = parse(z.object({ assigneeId: uuid.nullable() }), c.body);
    const ctx = engineOf(c);
    const { entry, type } = entryAndType(c, ctx);
    if (input.assigneeId && !db.memberships.some((m) => m.userId === input.assigneeId && m.status === 'ACTIVE')) {
      throw badRequest('Assignee must be an active member of this organization');
    }
    entry.assigneeId = input.assigneeId;
    entry.updatedAt = nowIso();
    return detail(ctx, entry, type);
  });

  r.delete(`${env}/entry/:entryId`, (c) => {
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx, { includeDeleted: true });
    deleteEntry(ctx, type, c.params.entryId, { permanent: c.query.permanent === 'true' });
    return noContent();
  });

  r.post(`${env}/entry/:entryId/restore`, (c) => {
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx, { includeDeleted: true });
    return detail(ctx, restoreFromTrash(ctx, type, c.params.entryId), type);
  });

  r.post(`${env}/entry/:entryId/duplicate`, (c) => {
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return created(detail(ctx, duplicateEntry(ctx, type, c.params.entryId), type));
  });

  r.post(`${env}/entry/:entryId/publish`, (c) => {
    const input = parse(z.object({ note: z.string().max(500).optional() }), c.body ?? {});
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return detail(ctx, publishEntry(ctx, type, c.params.entryId, input), type);
  });

  r.post(`${env}/entry/:entryId/unpublish`, (c) => {
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return detail(ctx, unpublishEntry(ctx, type, c.params.entryId), type);
  });

  r.post(`${env}/entry/:entryId/schedule`, (c) => {
    const input = parse(z.object({ publishAt: z.coerce.date().nullable().optional(), unpublishAt: z.coerce.date().nullable().optional() }), c.body);
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return detail(ctx, scheduleEntry(ctx, type, c.params.entryId, input), type);
  });

  r.post(`${env}/entry/:entryId/transition`, (c) => {
    const input = parse(z.object({ action: z.enum(WORKFLOW_ACTIONS), comment: z.string().max(4000).optional() }), c.body);
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return detail(ctx, transitionEntry(ctx, type, c.params.entryId, input.action, input.comment), type);
  });

  // ─── Versions ──────────────────────────────────────────────────────────────

  r.get(`${env}/entry/:entryId/versions`, (c) => {
    const ctx = engineOf(c);
    const { entry } = entryAndType(c, ctx, { includeDeleted: true });
    const names = userNames();
    const versions = db.versions.filter((v) => v.entryId === entry.id).sort((a, b) => b.number - a.number).slice(0, 200);
    return {
      items: versions.map(({ data: _data, entryId: _entryId, ...v }) => ({ ...v, createdBy: v.createdById ? (names.get(v.createdById) ?? null) : null, isPublished: v.id === entry.publishedVersionId })),
    };
  });

  r.get(`${env}/entry/:entryId/versions/:versionId`, (c) => {
    const ctx = engineOf(c);
    const { entry, type } = entryAndType(c, ctx, { includeDeleted: true });
    const version = db.versions.find((v) => v.id === c.params.versionId && v.entryId === entry.id);
    if (!version) throw notFound('Version');
    return {
      ...version,
      data: isPageType(type) ? version.data : maskSecrets(type, version.data),
      createdBy: version.createdById ? (userNames().get(version.createdById) ?? null) : null,
      isPublished: version.id === entry.publishedVersionId,
    };
  });

  r.post(`${env}/entry/:entryId/versions/:versionId/restore`, (c) => {
    const ctx = engineOf(c);
    const { type } = entryAndType(c, ctx);
    return detail(ctx, restoreVersion(ctx, type, c.params.entryId, c.params.versionId), type);
  });

  // ─── Comments and activity ─────────────────────────────────────────────────

  const withAuthor = (comment: (typeof db.comments)[number]) => ({ ...comment, author: userNames().get(comment.userId) ?? 'Former member' });

  r.get(`${env}/entry/:entryId/comments`, (c) => {
    const { entry } = entryAndType(c, engineOf(c), { includeDeleted: true });
    return { items: db.comments.filter((x) => x.entryId === entry.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(withAuthor) };
  });

  r.post(`${env}/entry/:entryId/comments`, (c) => {
    const input = parse(z.object({ body: z.string().trim().min(1, 'Write a comment').max(4000) }), c.body);
    const { entry } = entryAndType(c, engineOf(c));
    const comment = { id: newId(), entryId: entry.id, userId: guest().id, body: input.body, kind: 'comment' as const, resolvedAt: null, createdAt: nowIso() };
    db.comments.push(comment);
    return created(withAuthor(comment));
  });

  r.patch(`${env}/entry/:entryId/comments/:commentId`, (c) => {
    const input = parse(z.object({ resolved: z.boolean() }), c.body);
    const { entry } = entryAndType(c, engineOf(c));
    const comment = db.comments.find((x) => x.id === c.params.commentId && x.entryId === entry.id);
    if (!comment) throw notFound('Comment');
    comment.resolvedAt = input.resolved ? nowIso() : null;
    return withAuthor(comment);
  });

  r.delete(`${env}/entry/:entryId/comments/:commentId`, (c) => {
    const { entry } = entryAndType(c, engineOf(c));
    if (!db.comments.some((x) => x.id === c.params.commentId && x.entryId === entry.id)) throw notFound('Comment');
    db.comments = db.comments.filter((x) => x.id !== c.params.commentId);
    return noContent();
  });

  r.get(`${env}/entry/:entryId/activity`, (c) => {
    const ctx = engineOf(c);
    const { entry } = entryAndType(c, ctx, { includeDeleted: true });
    return {
      items: db.audit
        .filter((a) => a.environmentId === ctx.scope.environment.id && a.resourceId === entry.id && (a.resourceType === 'entry' || a.resourceType === 'page'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 100)
        .map((a) => ({ id: a.id, action: a.action, actorLabel: a.actorLabel, actorType: a.actorType, metadata: a.metadata, createdAt: a.createdAt })),
    };
  });

  // ─── Preview and presence ──────────────────────────────────────────────────

  r.post(`${env}/entry/:entryId/preview-token`, (c) => {
    const ctx = engineOf(c);
    const { entry, type } = entryAndType(c, ctx);
    const token = `demo-preview-${newId()}`;
    db.previewTokens[token] = { environmentId: ctx.scope.environment.id, entryId: entry.id, expiresAt: new Date(now().getTime() + 3600_000).toISOString() };
    const template = type.options.previewUrl || ctx.scope.project.settings.previewUrl;
    const fill = (t: string) =>
      t
        .replaceAll('{token}', encodeURIComponent(token))
        .replaceAll('{id}', entry.documentId)
        .replaceAll('{slug}', encodeURIComponent(entry.slug ?? ''))
        .replaceAll('{path}', entry.path ?? '')
        .replaceAll('{locale}', entry.locale)
        .replaceAll('{type}', type.apiId);
    // The address a server would answer at. In guest mode only the API explorer in this browser accepts the token.
    return { token, expiresIn: 3600, apiUrl: `${PUBLIC_API_URL}/api/v1/preview?token=${token}`, previewUrl: template ? fill(template) : null };
  });

  // A second person can never be present: the demo data exists in this browser only.
  r.post(`${env}/entry/:entryId/presence`, () => ({ others: [] }));
  r.delete(`${env}/entry/:entryId/presence`, () => noContent());

  // ─── Pages ─────────────────────────────────────────────────────────────────

  r.get(`${env}/pages/tree`, (c) => {
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, PAGE_TYPE_ID);
    const locale = str(c.query.locale) ?? ctx.defaultLocale;
    const names = userNames();
    const rows = db.entries
      .filter((e) => e.environmentId === ctx.scope.environment.id && e.contentTypeId === type.id && !e.deletedAt && e.locale === locale)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    return {
      items: rows.map((row) => {
        const data = row.data as { template?: string; category?: string; blocks?: unknown[] };
        return { ...summary(row, type, names), template: data.template ?? 'default', category: data.category ?? null, blockCount: Array.isArray(data.blocks) ? data.blocks.length : 0 };
      }),
    };
  });

  r.post(`${env}/pages/reorder`, (c) => {
    const input = parse(z.object({ parentId: uuid.nullable(), orderedIds: z.array(uuid).min(1).max(500) }), c.body);
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, PAGE_TYPE_ID);
    const pages = db.entries.filter((e) => input.orderedIds.includes(e.id) && e.environmentId === ctx.scope.environment.id && e.contentTypeId === type.id && e.parentId === input.parentId && !e.deletedAt);
    if (pages.length !== input.orderedIds.length) throw badRequest('Reorder list must contain exactly the sibling pages of one parent');
    for (const page of pages) page.position = input.orderedIds.indexOf(page.id);
    return noContent();
  });

  // ─── Cross-type views ──────────────────────────────────────────────────────

  const crossType = (c: Ctx, keep: (e: DbEntry) => boolean, order: (a: DbEntry, b: DbEntry) => number, take: number) => {
    const ctx = engineOf(c);
    const names = userNames();
    return db.entries
      .filter((e) => e.environmentId === ctx.scope.environment.id && !e.deletedAt && keep(e))
      .sort(order)
      .slice(0, take)
      .flatMap((row) => {
        const type = ctx.schema.typeById.get(row.contentTypeId);
        return type ? [{ ...summary(row, type, names), contentTypeName: type.displayName, isPage: isPageType(type), assignee: row.assigneeId ? (names.get(row.assigneeId) ?? null) : null }] : [];
      });
  };
  const newestFirst = (a: DbEntry, b: DbEntry) => b.updatedAt.localeCompare(a.updatedAt);

  r.get(`${env}/scheduled`, (c) => ({
    items: crossType(c, (e) => !!e.scheduledPublishAt || !!e.scheduledUnpublishAt, (a, b) => (a.scheduledPublishAt ?? '9').localeCompare(b.scheduledPublishAt ?? '9'), 200),
  }));
  r.get(`${env}/reviews`, (c) => ({ items: crossType(c, (e) => ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(e.status), newestFirst, 200) }));
  r.get(`${env}/recent`, (c) => ({ items: crossType(c, () => true, newestFirst, 20) }));

  r.get(`${env}/versions`, (c) => {
    const q = parse(
      z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30), kind: z.enum(['SAVE', 'AUTOSAVE', 'PUBLISH', 'RESTORE']).optional() }),
      c.query,
    );
    const ctx = engineOf(c);
    const names = userNames();
    const entries = new Map(db.entries.filter((e) => e.environmentId === ctx.scope.environment.id).map((e) => [e.id, e]));
    const rows = db.versions
      .filter((v) => entries.has(v.entryId) && (q.kind ? v.kind === q.kind : v.kind !== 'AUTOSAVE'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
    const page = paginate(rows, q.page, q.pageSize);
    return {
      ...page,
      items: page.items.map((v) => {
        const entry = entries.get(v.entryId) as DbEntry;
        const type = ctx.schema.typeById.get(entry.contentTypeId);
        return {
          id: v.id,
          number: v.number,
          kind: v.kind,
          title: v.title ?? entry.title,
          note: v.note,
          createdAt: v.createdAt,
          createdBy: v.createdById ? (names.get(v.createdById) ?? null) : null,
          entryId: entry.id,
          entryDeleted: !!entry.deletedAt,
          locale: entry.locale,
          contentType: type?.apiId ?? null,
          contentTypeName: type?.displayName ?? 'Unknown',
          isPage: type ? isPageType(type) : false,
          isPublished: v.id === entry.publishedVersionId,
        };
      }),
    };
  });

  /** Global search across entries and pages, used by the command palette. */
  r.get(`${env}/search`, (c) => {
    const q = parse(z.object({ q: z.string().trim().min(1).max(100) }), c.query);
    const ctx = engineOf(c);
    const needle = q.q.toLowerCase();
    const has = (v: string | null) => !!v && v.toLowerCase().includes(needle);
    return {
      items: db.entries
        .filter((e) => e.environmentId === ctx.scope.environment.id && !e.deletedAt && (has(e.title) || has(e.slug)))
        .sort(newestFirst)
        .slice(0, 12)
        .flatMap((row) => {
          const type = ctx.schema.typeById.get(row.contentTypeId);
          return type
            ? [{ id: row.id, title: row.title, slug: row.slug, path: row.path, status: row.status, contentTypeId: row.contentTypeId, locale: row.locale, contentType: type.apiId, contentTypeName: type.singularName, isPage: isPageType(type) }]
            : [];
        }),
    };
  });

  /** Entries of one type, shaped for relationship pickers. */
  r.get(`${env}/relation-options/:typeId`, (c) => {
    const q = parse(z.object({ search: z.string().trim().max(100).optional(), ids: z.string().max(8000).optional() }), c.query);
    const ctx = engineOf(c);
    const type = typeFromParam(ctx, c.params.typeId);
    const ids = q.ids?.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const needle = q.search?.toLowerCase();
    const rows = db.entries
      .filter(
        (e) =>
          e.environmentId === ctx.scope.environment.id &&
          e.contentTypeId === type.id &&
          !e.deletedAt &&
          e.locale === ctx.defaultLocale &&
          (!ids || ids.includes(e.documentId)) &&
          (!needle || (e.title ?? '').toLowerCase().includes(needle)),
      )
      .sort(newestFirst)
      .slice(0, ids ? 200 : 25);
    return { items: rows.map((row) => ({ id: row.documentId, entryId: row.id, title: row.title ?? `Untitled ${type.singularName.toLowerCase()}`, status: row.status, isPublished: !!row.publishedAt })) };
  });
}
