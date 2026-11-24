/** Dashboard, analytics and the generated OpenAPI document. */
import { z } from 'zod';
import { PAGE_TYPE_ID } from '@meridian/shared';
import { envScope, isPageType, loadSchema, userNames } from '../context';
import { type DbEntry, db, now, persistenceKind } from '../db';
import { parse } from '../http';
import { buildOpenApi } from '../openapi';
import type { Router } from '../router';

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Dense list of the last `days` calendar days (UTC), oldest first. */
function lastDays(days: number): string[] {
  const today = now();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => dayKey(new Date(today.getTime() - (days - 1 - i) * 86_400_000)));
}

const sum = <T>(rows: T[], pick: (row: T) => number) => rows.reduce((n, row) => n + pick(row), 0);

function versionsByDay(environmentId: string, since: string) {
  const entries = new Set(db.entries.filter((e) => e.environmentId === environmentId).map((e) => e.id));
  return db.versions.filter((v) => entries.has(v.entryId) && v.createdAt >= since && v.kind !== 'AUTOSAVE');
}

export function analyticsRoutes(r: Router): void {
  r.get('/envs/:envId/dashboard', (c) => {
    const { environment, project } = envScope(c);
    const schema = loadSchema(environment.id);
    const pageType = schema.typeByApiId.get(PAGE_TYPE_ID);
    const days = lastDays(14);
    const since = `${days[0]}T00:00:00.000Z`;
    const live = db.entries.filter((e) => e.environmentId === environment.id && !e.deletedAt);
    const media = db.assets.filter((a) => a.projectId === project.id && !a.deletedAt);
    const names = userNames();
    const yesterday = dayKey(new Date(now().getTime() - 86_400_000));
    const monthAgo = new Date(now().getTime() - 30 * 86_400_000).toISOString();
    const usage = db.usage.filter((u) => u.environmentId === environment.id);
    const versions = versionsByDay(environment.id, since);
    const pages = live.filter((e) => e.contentTypeId === pageType?.id).length;
    const published = live.filter((e) => e.publishedAt).length;

    const shape = (e: DbEntry) => {
      const type = schema.typeById.get(e.contentTypeId);
      return {
        id: e.id,
        title: e.title,
        status: e.status,
        updatedAt: e.updatedAt,
        publishedAt: e.publishedAt,
        path: e.path,
        contentTypeId: e.contentTypeId,
        contentType: type?.apiId ?? null,
        contentTypeName: type?.singularName ?? 'Entry',
        isPage: !!type && isPageType(type),
        updatedBy: e.updatedById ? (names.get(e.updatedById) ?? null) : null,
      };
    };
    const recentUpdates = [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8).map(shape);
    const audits = [...db.audit].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      counts: {
        entries: live.length - pages,
        pages,
        published,
        drafts: live.length - published,
        scheduled: live.filter((e) => e.scheduledPublishAt || e.scheduledUnpublishAt).length,
        pendingApprovals: live.filter((e) => e.status === 'IN_REVIEW').length,
        mediaAssets: media.length,
        storageBytes: sum(media, (a) => a.size),
        connectedApps: db.tokens.filter((t) => t.environmentId === environment.id && !t.revokedAt && t.lastUsedAt && t.lastUsedAt >= monthAgo).length,
        activeWebhooks: db.webhooks.filter((h) => h.environmentId === environment.id && h.isActive).length,
        contentTypes: schema.types.filter((t) => !t.isSystem).length,
        apiRequests24h: sum(usage.filter((u) => u.day >= yesterday), (u) => u.requests),
        apiErrors24h: sum(usage.filter((u) => u.day >= yesterday), (u) => u.errors),
      },
      publishingActivity: days.map((day) => ({
        date: day,
        published: versions.filter((v) => v.createdAt.startsWith(day) && v.kind === 'PUBLISH').length,
        saved: versions.filter((v) => v.createdAt.startsWith(day) && v.kind !== 'PUBLISH').length,
      })),
      apiUsage: days.map((day) => ({ date: day, requests: sum(usage.filter((u) => u.day === day), (u) => u.requests), errors: sum(usage.filter((u) => u.day === day), (u) => u.errors) })),
      typeDistribution: schema.types
        .map((t) => ({ apiId: t.apiId, name: t.displayName, count: live.filter((e) => e.contentTypeId === t.id).length }))
        .filter((t) => t.count > 0)
        .sort((a, b) => b.count - a.count),
      recentUpdates,
      recentPages: recentUpdates.filter((e) => e.isPage),
      pendingReviews: live.filter((e) => e.status === 'IN_REVIEW').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, 6).map(shape),
      recentPublishing: audits
        .filter((a) => a.environmentId === environment.id && ['entry.published', 'entry.unpublished', 'release.published'].includes(a.action))
        .slice(0, 8)
        .map(({ id, action, actorLabel, resourceLabel, resourceId, resourceType, createdAt }) => ({ id, action, actorLabel, resourceLabel, resourceId, resourceType, createdAt })),
      userActivity: audits
        .filter((a) => a.projectId === project.id || a.environmentId === environment.id)
        .slice(0, 10)
        .map(({ id, action, actorLabel, actorType, resourceLabel, resourceType, createdAt }) => ({ id, action, actorLabel, actorType, resourceLabel, resourceType, createdAt })),
      // There are no services to probe: the whole backend is this page. The dashboard says so in guest mode.
      health: {
        database: { ok: true, latencyMs: 0 },
        cache: { ok: true, latencyMs: 0 },
        storage: { ok: true, latencyMs: 0, driver: persistenceKind() === 'indexeddb' ? 'browser storage' : 'memory only' },
        queue: { waiting: 0, active: 0, delayed: 0, failed: 0 },
        realtimeClients: 0,
      },
    };
  });

  r.get('/envs/:envId/analytics', (c) => {
    const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), c.query);
    const { environment, project } = envScope(c);
    const schema = loadSchema(environment.id);
    const days = lastDays(q.days);
    const since = `${days[0]}T00:00:00.000Z`;
    const usage = db.usage.filter((u) => u.environmentId === environment.id && u.day >= days[0]);
    const versions = versionsByDay(environment.id, since);
    const entries = db.entries.filter((e) => e.environmentId === environment.id);
    const media = db.assets.filter((a) => a.projectId === project.id && !a.deletedAt);

    const group = <T>(rows: T[], key: (row: T) => string) => {
      const out = new Map<string, T[]>();
      for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
      return [...out.entries()];
    };
    const requests = sum(usage, (u) => u.requests);
    const errors = sum(usage, (u) => u.errors);
    const latency = sum(usage, (u) => u.latencyMsTotal);
    const avg = (rows: typeof usage) => (sum(rows, (u) => u.requests) ? Math.round(sum(rows, (u) => u.latencyMsTotal) / sum(rows, (u) => u.requests)) : 0);
    const actions = db.audit.filter((a) => a.environmentId === environment.id && a.createdAt >= since && a.actorType === 'user');

    return {
      range: { days: q.days, from: days[0], to: days[days.length - 1] },
      totals: { requests, errors, errorRate: requests ? errors / requests : 0, avgLatencyMs: requests ? latency / requests : 0 },
      usage: days.map((day) => {
        const rows = usage.filter((u) => u.day === day);
        return { date: day, requests: sum(rows, (u) => u.requests), errors: sum(rows, (u) => u.errors), avgLatencyMs: avg(rows) };
      }),
      byResource: group(usage, (u) => u.resource)
        .map(([resource, rows]) => ({ resource, name: schema.typeByApiId.get(resource)?.displayName ?? resource, requests: sum(rows, (u) => u.requests), errors: sum(rows, (u) => u.errors), avgLatencyMs: avg(rows) }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 12),
      byToken: group(usage, (u) => u.tokenId)
        .map(([tokenId, rows]) => {
          const token = db.tokens.find((t) => t.id === tokenId);
          return { tokenId, name: token?.name ?? 'Deleted token', type: token?.type ?? null, requests: sum(rows, (u) => u.requests), errors: sum(rows, (u) => u.errors) };
        })
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 12),
      content: days.map((day) => ({
        date: day,
        created: entries.filter((e) => e.createdAt.startsWith(day)).length,
        published: versions.filter((v) => v.createdAt.startsWith(day) && v.kind === 'PUBLISH').length,
        saved: versions.filter((v) => v.createdAt.startsWith(day) && v.kind !== 'PUBLISH').length,
      })),
      mostUpdated: group(versions, (v) => v.entryId)
        .flatMap(([entryId, rows]) => {
          const entry = entries.find((e) => e.id === entryId && !e.deletedAt);
          const type = entry && schema.typeById.get(entry.contentTypeId);
          return entry ? [{ entryId, title: entry.title, versions: rows.length, contentType: type?.apiId ?? null, contentTypeName: type?.singularName ?? 'Entry', isPage: !!type && isPageType(type) }] : [];
        })
        .sort((a, b) => b.versions - a.versions)
        .slice(0, 10),
      userActivity: group(actions, (a) => a.actorLabel ?? 'Unknown')
        .map(([name, rows]) => ({ name, actions: rows.length }))
        .sort((a, b) => b.actions - a.actions)
        .slice(0, 10),
      media: group(media, (a) => a.kind).map(([kind, rows]) => ({ kind, count: rows.length, bytes: sum(rows, (a) => a.size) })),
    };
  });

  /** The delivery API's OpenAPI document for this environment, for the in-app API explorer and docs. */
  r.get('/envs/:envId/openapi', (c) => {
    const { environment, project } = envScope(c);
    return buildOpenApi(loadSchema(environment.id), { project: project.name, environment: environment.key, writable: true });
  });
}
