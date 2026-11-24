/** Releases: groups of entries published together, all or nothing. */
import { z } from 'zod';
import { newId, sameJson } from '@meridian/shared';
import { type Ctx, audit, emitEvent, envScope, isPageType } from '../context';
import { type DbRelease, db, nowIso, replaceState } from '../db';
import { type Engine, prepareData, publishCore, unpublishCore } from '../engine';
import { HttpError, badRequest, conflict, created, noContent, notFound, parse, unprocessable } from '../http';
import type { Router } from '../router';
import { engineOf } from './entries';

const releaseInput = z.object({ name: z.string().trim().min(1, 'Name is required').max(120), description: z.string().trim().max(1000).default('') });

const itemsOf = (releaseId: string) => db.releaseItems.filter((i) => i.releaseId === releaseId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

function findRelease(c: Ctx): DbRelease {
  const { environment } = envScope(c);
  const release = db.releases.find((x) => x.id === c.params.releaseId && x.environmentId === environment.id);
  if (!release) throw notFound('Release');
  return release;
}

function releaseDetail(release: DbRelease) {
  return {
    ...release,
    items: itemsOf(release.id).flatMap((item) => {
      const entry = db.entries.find((e) => e.id === item.entryId);
      if (!entry) return [];
      const type = db.contentTypes.find((t) => t.id === entry.contentTypeId);
      return [
        {
          id: item.id,
          action: item.action,
          entryId: item.entryId,
          title: entry.title,
          status: entry.status,
          locale: entry.locale,
          path: entry.path,
          isPublished: !!entry.publishedAt,
          hasChanges: !!entry.publishedAt && !sameJson(entry.data, entry.publishedData),
          deleted: !!entry.deletedAt,
          contentType: type?.apiId ?? null,
          contentTypeName: type?.singularName ?? 'Unknown',
          isPage: type ? isPageType(type) : false,
        },
      ];
    }),
  };
}

/** Dry run: reports, per item, whether it would publish cleanly right now. */
function validateRelease(ctx: Engine, release: DbRelease) {
  return itemsOf(release.id).flatMap((item) => {
    const entry = db.entries.find((e) => e.id === item.entryId);
    if (!entry) return [];
    const type = ctx.schema.typeById.get(entry.contentTypeId);
    const problems: string[] = [];
    if (!type) problems.push('Content type no longer exists');
    else if (entry.deletedAt) problems.push('Entry is in the trash');
    else if (item.action === 'UNPUBLISH') {
      if (!entry.publishedAt) problems.push('Entry is not published');
    } else {
      if (entry.status === 'ARCHIVED') problems.push('Entry is archived');
      for (const issue of prepareData(ctx.schema, type, entry.data, 'publish').issues) problems.push(issue.message);
      if (type.options.requireApproval && entry.status !== 'APPROVED' && !(entry.publishedAt && sameJson(entry.data, entry.publishedData))) problems.push('Awaiting approval');
    }
    return [{ itemId: item.id, entryId: item.entryId, title: entry.title, contentType: type?.apiId ?? 'unknown', action: item.action, ok: problems.length === 0, problems }];
  });
}

/** Publishes every item of a release: either all changes go live together or none do. */
export function publishRelease(ctx: Engine, releaseId: string): DbRelease {
  const find = () => db.releases.find((x) => x.id === releaseId && x.environmentId === ctx.scope.environment.id);
  const release = find();
  if (!release) throw notFound('Release');
  if (release.status === 'PUBLISHED') throw conflict('This release has already been published');
  const items = itemsOf(release.id);
  if (items.length === 0) throw conflict('Add at least one entry to the release before publishing');

  const snapshot = structuredClone(db);
  const done: { entryId: string; action: 'PUBLISH' | 'UNPUBLISH'; live: { slug: string | null; path: string | null; title: string | null } }[] = [];
  try {
    for (const item of items) {
      const entry = db.entries.find((e) => e.id === item.entryId && e.environmentId === ctx.scope.environment.id && !e.deletedAt);
      if (!entry) throw unprocessable('A release item refers to content that no longer exists', [{ path: item.id, message: 'Entry was deleted' }]);
      const type = ctx.schema.typeById.get(entry.contentTypeId);
      if (!type) throw unprocessable('A release item refers to a content type that no longer exists');
      const liveBefore = { slug: entry.publishedSlug ?? entry.slug, path: entry.publishedPath ?? entry.path, title: entry.publishedTitle ?? entry.title };
      if (item.action === 'UNPUBLISH') {
        if (!entry.publishedAt) continue;
        unpublishCore(ctx, entry);
        done.push({ entryId: entry.id, action: 'UNPUBLISH', live: liveBefore });
      } else {
        publishCore(ctx, type, entry, { note: `Release: ${release.name}` });
        done.push({ entryId: entry.id, action: 'PUBLISH', live: { slug: entry.publishedSlug, path: entry.publishedPath, title: entry.publishedTitle } });
      }
    }
  } catch (err) {
    // Nothing of a failed release stays applied; only the reason is kept, on the release itself.
    replaceState(snapshot);
    const failed = find();
    if (failed) {
      failed.status = failed.scheduledAt ? 'FAILED' : 'OPEN';
      failed.error = (err instanceof HttpError ? err.message : 'Release failed unexpectedly').slice(0, 500);
      failed.updatedAt = nowIso();
    }
    if (err instanceof HttpError) err.keepChanges = true;
    throw err;
  }
  Object.assign(release, { status: 'PUBLISHED', publishedAt: nowIso(), scheduledAt: null, error: null, updatedAt: nowIso() });
  audit({ actor: ctx.actor, project: ctx.scope.project, environment: ctx.scope.environment }, { action: 'release.published', resourceType: 'release', resourceId: release.id, resourceLabel: release.name, metadata: { items: done.length } });

  const documents: { contentType: string; documentId: string; slug?: string | null; path?: string | null }[] = [];
  for (const { entryId, action, live } of done) {
    const entry = db.entries.find((e) => e.id === entryId);
    const type = entry && ctx.schema.typeById.get(entry.contentTypeId);
    if (!entry || !type) continue;
    documents.push({ contentType: type.apiId, documentId: entry.documentId, slug: live.slug, path: live.path });
    const kind = action === 'PUBLISH' ? 'published' : 'unpublished';
    emitEvent(ctx.scope, { event: isPageType(type) ? `page.${kind}` : `content.${kind}`, contentType: type.apiId, documentId: entry.documentId, entryId: entry.id, locale: entry.locale, ...live, releaseId: release.id });
  }
  emitEvent(ctx.scope, { event: 'release.published', releaseId: release.id, title: release.name, documents });
  return release;
}

export function releaseRoutes(r: Router): void {
  const base = '/envs/:envId/releases';

  r.get(base, (c) => {
    const { environment } = envScope(c);
    return {
      items: db.releases
        .filter((x) => x.environmentId === environment.id)
        .sort((a, b) => a.status.localeCompare(b.status) || b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 200)
        .map((x) => ({ ...x, itemCount: itemsOf(x.id).length })),
    };
  });

  r.post(base, (c) => {
    const input = parse(releaseInput, c.body);
    const { environment } = envScope(c);
    const at = nowIso();
    const release: DbRelease = { id: newId(), environmentId: environment.id, name: input.name, description: input.description, status: 'OPEN', scheduledAt: null, publishedAt: null, error: null, createdAt: at, updatedAt: at };
    db.releases.push(release);
    audit(c, { action: 'release.created', resourceType: 'release', resourceId: release.id, resourceLabel: release.name });
    return created({ ...release, items: [] });
  });

  r.get(`${base}/:releaseId`, (c) => releaseDetail(findRelease(c)));

  r.patch(`${base}/:releaseId`, (c) => {
    const input = parse(releaseInput.partial().extend({ scheduledAt: z.coerce.date().nullable().optional() }), c.body);
    const release = findRelease(c);
    if (release.status === 'PUBLISHED') throw conflict('A published release can no longer be changed');
    if (input.scheduledAt && input.scheduledAt.getTime() <= Date.parse(nowIso())) throw badRequest('Scheduled time must be in the future');
    if (input.scheduledAt && itemsOf(release.id).length === 0) throw conflict('Add at least one entry before scheduling the release');
    release.name = input.name ?? release.name;
    release.description = input.description ?? release.description;
    if (input.scheduledAt !== undefined) {
      release.scheduledAt = input.scheduledAt?.toISOString() ?? null;
      release.status = input.scheduledAt ? 'SCHEDULED' : 'OPEN';
      release.error = null;
    }
    release.updatedAt = nowIso();
    audit(c, {
      action: input.scheduledAt !== undefined ? (input.scheduledAt ? 'release.scheduled' : 'release.unscheduled') : 'release.updated',
      resourceType: 'release',
      resourceId: release.id,
      resourceLabel: release.name,
      metadata: input.scheduledAt ? { scheduledAt: input.scheduledAt.toISOString() } : undefined,
    });
    return releaseDetail(release);
  });

  r.delete(`${base}/:releaseId`, (c) => {
    const release = findRelease(c);
    db.releases = db.releases.filter((x) => x.id !== release.id);
    db.releaseItems = db.releaseItems.filter((i) => i.releaseId !== release.id);
    audit(c, { action: 'release.deleted', resourceType: 'release', resourceId: release.id, resourceLabel: release.name });
    return noContent();
  });

  r.post(`${base}/:releaseId/items`, (c) => {
    const input = parse(z.object({ entryIds: z.array(z.string().uuid()).min(1).max(200), action: z.enum(['PUBLISH', 'UNPUBLISH']).default('PUBLISH') }), c.body);
    const release = findRelease(c);
    if (release.status === 'PUBLISHED') throw conflict('A published release can no longer be changed');
    const ids = [...new Set(input.entryIds)];
    const entries = db.entries.filter((e) => ids.includes(e.id) && e.environmentId === release.environmentId && !e.deletedAt);
    if (entries.length !== ids.length) throw badRequest('Some entries do not exist in this environment');
    for (const entry of entries) {
      const existing = db.releaseItems.find((i) => i.releaseId === release.id && i.entryId === entry.id);
      if (existing) existing.action = input.action;
      else db.releaseItems.push({ id: newId(), releaseId: release.id, entryId: entry.id, action: input.action, createdAt: nowIso() });
    }
    release.updatedAt = nowIso();
    return created(releaseDetail(release));
  });

  r.delete(`${base}/:releaseId/items/:itemId`, (c) => {
    const release = findRelease(c);
    if (release.status === 'PUBLISHED') throw conflict('A published release can no longer be changed');
    if (!db.releaseItems.some((i) => i.id === c.params.itemId && i.releaseId === release.id)) throw notFound('Release item');
    db.releaseItems = db.releaseItems.filter((i) => i.id !== c.params.itemId);
    return releaseDetail(release);
  });

  r.get(`${base}/:releaseId/validate`, (c) => {
    const checks = validateRelease(engineOf(c), findRelease(c));
    return { ready: checks.length > 0 && checks.every((x) => x.ok), checks };
  });

  r.post(`${base}/:releaseId/publish`, (c) => {
    const release = findRelease(c);
    return releaseDetail(publishRelease(engineOf(c), release.id));
  });
}
