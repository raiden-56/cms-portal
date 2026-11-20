import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PAGE_TYPE_ID } from '@meridian/shared';
import { parse } from '../../lib/http';
import { prisma, redis } from '../../lib/infra';
import { can, envOf, envScope } from '../../middleware/auth';
import { buildOpenApi } from '../delivery/openapi';
import { connectedClients } from '../events/gateway';
import { storage } from '../media/storage';
import { loadSchema } from '../schema/schema.service';
import { webhookQueueStats } from '../webhooks/webhooks.service';

export const analyticsRouter = Router({ mergeParams: true });

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Dense list of the last `days` calendar days (UTC), oldest first. */
function lastDays(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) out.push(dayKey(new Date(today.getTime() - i * 86400_000)));
  return out;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

async function usageByDay(environmentId: string, since: Date) {
  return prisma.$queryRaw<{ day: string; requests: number; errors: number; latency: number }[]>(Prisma.sql`
    SELECT to_char(date_trunc('day', "bucket"), 'YYYY-MM-DD') AS day,
           sum("requests")::int AS requests, sum("errors")::int AS errors, sum("latencyMsTotal")::float AS latency
    FROM "ApiUsage" WHERE "environmentId" = ${environmentId}::uuid AND "bucket" >= ${since}
    GROUP BY 1 ORDER BY 1`);
}

async function versionsByDay(environmentId: string, since: Date) {
  return prisma.$queryRaw<{ day: string; kind: string; n: number }[]>(Prisma.sql`
    SELECT to_char(date_trunc('day', v."createdAt"), 'YYYY-MM-DD') AS day, v."kind"::text AS kind, count(*)::int AS n
    FROM "EntryVersion" v JOIN "Entry" e ON e."id" = v."entryId"
    WHERE e."environmentId" = ${environmentId}::uuid AND v."createdAt" >= ${since} AND v."kind" <> 'AUTOSAVE'
    GROUP BY 1, 2`);
}

analyticsRouter.get('/dashboard', envScope('content.read'), async (req, res) => {
  const { environment, project, tenant } = envOf(req);
  const environmentId = environment.id;
  const schema = await loadSchema(environmentId);
  const pageType = schema.typeByApiId.get(PAGE_TYPE_ID);
  const days = lastDays(14);
  const since = new Date(`${days[0]}T00:00:00.000Z`);
  const dayAgo = new Date(Date.now() - 86400_000);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);
  const live = { environmentId, deletedAt: null };
  const seeUsage = can(req, 'analytics.read');

  const [
    byType,
    published,
    scheduled,
    pendingApprovals,
    media,
    connectedApps,
    webhooks,
    usage24h,
    versionRows,
    usageRows,
    recentUpdates,
    pendingReviews,
    recentPublishing,
    userActivity,
    database,
    cache,
    objectStore,
    queue,
  ] = await Promise.all([
    prisma.entry.groupBy({ by: ['contentTypeId'], where: live, _count: true }),
    prisma.entry.count({ where: { ...live, publishedAt: { not: null } } }),
    prisma.entry.count({ where: { ...live, OR: [{ scheduledPublishAt: { not: null } }, { scheduledUnpublishAt: { not: null } }] } }),
    prisma.entry.count({ where: { ...live, status: 'IN_REVIEW' } }),
    prisma.mediaAsset.aggregate({ where: { projectId: project.id, deletedAt: null }, _count: true, _sum: { size: true } }),
    prisma.apiToken.count({ where: { environmentId, revokedAt: null, lastUsedAt: { gte: monthAgo } } }),
    prisma.webhook.count({ where: { environmentId, isActive: true } }),
    seeUsage ? prisma.apiUsage.aggregate({ where: { environmentId, bucket: { gte: dayAgo } }, _sum: { requests: true, errors: true } }) : null,
    versionsByDay(environmentId, since),
    seeUsage ? usageByDay(environmentId, since) : [],
    prisma.entry.findMany({
      where: live,
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { id: true, title: true, status: true, updatedAt: true, contentTypeId: true, publishedAt: true, updatedById: true, path: true },
    }),
    prisma.entry.findMany({
      where: { ...live, status: 'IN_REVIEW' },
      orderBy: { updatedAt: 'asc' },
      take: 6,
      select: { id: true, title: true, status: true, updatedAt: true, contentTypeId: true, updatedById: true },
    }),
    prisma.auditLog.findMany({
      where: { environmentId, action: { in: ['entry.published', 'entry.unpublished', 'release.published'] } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, action: true, actorLabel: true, resourceLabel: true, resourceId: true, resourceType: true, createdAt: true },
    }),
    prisma.auditLog.findMany({
      where: { organizationId: tenant.organizationId, OR: [{ projectId: project.id }, { environmentId }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, action: true, actorLabel: true, actorType: true, resourceLabel: true, resourceType: true, createdAt: true },
    }),
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(() => redis.ping()),
    timed(async () => {
      if (!(await storage().ping())) throw new Error('storage unreachable');
    }),
    webhookQueueStats().catch(() => ({ waiting: 0, active: 0, delayed: 0, failed: 0 })),
  ]);

  const countOf = new Map(byType.map((t) => [t.contentTypeId, t._count]));
  const pages = pageType ? (countOf.get(pageType.id) ?? 0) : 0;
  const total = byType.reduce((n, t) => n + t._count, 0);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([...recentUpdates, ...pendingReviews].map((e) => e.updatedById).filter((id): id is string => !!id))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const shapeEntry = <T extends { contentTypeId: string; updatedById: string | null }>(e: T) => {
    const type = schema.typeById.get(e.contentTypeId);
    return { ...e, contentType: type?.apiId ?? null, contentTypeName: type?.singularName ?? 'Entry', isPage: type?.apiId === PAGE_TYPE_ID && !!type?.isSystem, updatedBy: e.updatedById ? (nameOf.get(e.updatedById) ?? null) : null };
  };

  res.json({
    counts: {
      entries: total - pages,
      pages,
      published,
      drafts: total - published,
      scheduled,
      pendingApprovals,
      mediaAssets: media._count,
      storageBytes: media._sum.size ?? 0,
      connectedApps,
      activeWebhooks: webhooks,
      contentTypes: schema.types.filter((t) => !t.isSystem).length,
      apiRequests24h: usage24h ? (usage24h._sum.requests ?? 0) : null,
      apiErrors24h: usage24h ? (usage24h._sum.errors ?? 0) : null,
    },
    publishingActivity: days.map((day) => ({
      date: day,
      published: versionRows.filter((r) => r.day === day && r.kind === 'PUBLISH').reduce((n, r) => n + r.n, 0),
      saved: versionRows.filter((r) => r.day === day && r.kind !== 'PUBLISH').reduce((n, r) => n + r.n, 0),
    })),
    apiUsage: seeUsage
      ? days.map((day) => {
          const row = usageRows.find((r) => r.day === day);
          return { date: day, requests: row?.requests ?? 0, errors: row?.errors ?? 0 };
        })
      : null,
    typeDistribution: schema.types
      .map((t) => ({ apiId: t.apiId, name: t.displayName, count: countOf.get(t.id) ?? 0 }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count),
    recentUpdates: recentUpdates.map(shapeEntry),
    recentPages: recentUpdates.map(shapeEntry).filter((e) => e.isPage),
    pendingReviews: pendingReviews.map(shapeEntry),
    recentPublishing,
    userActivity,
    health: {
      database,
      cache,
      storage: { ...objectStore, driver: storage().name },
      queue,
      realtimeClients: connectedClients(),
    },
  });
});

analyticsRouter.get('/analytics', envScope('analytics.read'), async (req, res) => {
  const q = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }), req.query);
  const { environment, project } = envOf(req);
  const environmentId = environment.id;
  const days = lastDays(q.days);
  const since = new Date(`${days[0]}T00:00:00.000Z`);
  const schema = await loadSchema(environmentId);

  const [usageRows, byResource, byToken, versionRows, createdRows, mostUpdated, actors, media] = await Promise.all([
    usageByDay(environmentId, since),
    prisma.apiUsage.groupBy({ by: ['resource'], where: { environmentId, bucket: { gte: since } }, _sum: { requests: true, errors: true, latencyMsTotal: true }, orderBy: { _sum: { requests: 'desc' } }, take: 12 }),
    prisma.apiUsage.groupBy({ by: ['tokenId'], where: { environmentId, bucket: { gte: since } }, _sum: { requests: true, errors: true }, orderBy: { _sum: { requests: 'desc' } }, take: 12 }),
    versionsByDay(environmentId, since),
    prisma.$queryRaw<{ day: string; n: number }[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Entry" WHERE "environmentId" = ${environmentId}::uuid AND "createdAt" >= ${since} GROUP BY 1`),
    prisma.$queryRaw<{ id: string; title: string | null; contentTypeId: string; n: number }[]>(Prisma.sql`
      SELECT e."id", e."title", e."contentTypeId", count(v."id")::int AS n
      FROM "EntryVersion" v JOIN "Entry" e ON e."id" = v."entryId"
      WHERE e."environmentId" = ${environmentId}::uuid AND e."deletedAt" IS NULL AND v."createdAt" >= ${since} AND v."kind" <> 'AUTOSAVE'
      GROUP BY e."id" ORDER BY n DESC LIMIT 10`),
    prisma.auditLog.groupBy({
      by: ['actorLabel'],
      where: { environmentId, createdAt: { gte: since }, actorType: 'user' },
      _count: true,
      orderBy: { _count: { actorLabel: 'desc' } },
      take: 10,
    }),
    prisma.mediaAsset.groupBy({ by: ['kind'], where: { projectId: project.id, deletedAt: null }, _count: true, _sum: { size: true } }),
  ]);

  const tokens = await prisma.apiToken.findMany({
    where: { id: { in: byToken.map((t) => t.tokenId).filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } },
    select: { id: true, name: true, type: true },
  });
  const totals = usageRows.reduce((acc, r) => ({ requests: acc.requests + r.requests, errors: acc.errors + r.errors, latency: acc.latency + r.latency }), { requests: 0, errors: 0, latency: 0 });

  res.json({
    range: { days: q.days, from: days[0], to: days[days.length - 1] },
    totals: {
      requests: totals.requests,
      errors: totals.errors,
      errorRate: totals.requests ? totals.errors / totals.requests : 0,
      avgLatencyMs: totals.requests ? totals.latency / totals.requests : 0,
    },
    usage: days.map((day) => {
      const row = usageRows.find((r) => r.day === day);
      return { date: day, requests: row?.requests ?? 0, errors: row?.errors ?? 0, avgLatencyMs: row?.requests ? Math.round(row.latency / row.requests) : 0 };
    }),
    byResource: byResource.map((r) => ({
      resource: r.resource,
      name: schema.typeByApiId.get(r.resource)?.displayName ?? r.resource,
      requests: r._sum.requests ?? 0,
      errors: r._sum.errors ?? 0,
      avgLatencyMs: r._sum.requests ? Math.round((r._sum.latencyMsTotal ?? 0) / r._sum.requests) : 0,
    })),
    byToken: byToken.map((t) => {
      const token = tokens.find((x) => x.id === t.tokenId);
      return { tokenId: t.tokenId, name: token?.name ?? 'Deleted token', type: token?.type ?? null, requests: t._sum.requests ?? 0, errors: t._sum.errors ?? 0 };
    }),
    content: days.map((day) => ({
      date: day,
      created: createdRows.find((r) => r.day === day)?.n ?? 0,
      published: versionRows.filter((r) => r.day === day && r.kind === 'PUBLISH').reduce((n, r) => n + r.n, 0),
      saved: versionRows.filter((r) => r.day === day && r.kind !== 'PUBLISH').reduce((n, r) => n + r.n, 0),
    })),
    mostUpdated: mostUpdated.map((m) => {
      const type = schema.typeById.get(m.contentTypeId);
      return { entryId: m.id, title: m.title, versions: m.n, contentType: type?.apiId ?? null, contentTypeName: type?.singularName ?? 'Entry', isPage: type?.apiId === PAGE_TYPE_ID && !!type?.isSystem };
    }),
    userActivity: actors.map((a) => ({ name: a.actorLabel ?? 'Unknown', actions: a._count })),
    media: media.map((m) => ({ kind: m.kind, count: m._count, bytes: m._sum.size ?? 0 })),
  });
});

/** The delivery API's OpenAPI document for this environment, for the in-app API explorer and docs. */
analyticsRouter.get('/openapi', envScope('schema.read'), async (req, res) => {
  const { environment, project } = envOf(req);
  res.json(buildOpenApi(await loadSchema(environment.id), { project: project.name, environment: environment.key, writable: true }));
});
