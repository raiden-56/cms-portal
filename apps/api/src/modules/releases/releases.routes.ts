import { Router, type Request } from 'express';
import { z } from 'zod';
import { sameJson } from '@meridian/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { clientIp, param, parse } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { envOf, envScope, userOf } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { scopeFromRequest } from '../events/events.service';
import { defaultLocaleOf } from '../entries/entries.routes';
import type { EngineContext } from '../entries/entries.service';
import { isPageType, loadSchema } from '../schema/schema.service';
import { publishRelease, validateRelease } from './releases.service';

export const releasesRouter = Router({ mergeParams: true });

async function engine(req: Request): Promise<EngineContext> {
  const { environment, project } = envOf(req);
  const user = userOf(req);
  const [schema, defaultLocale] = await Promise.all([loadSchema(environment.id), defaultLocaleOf(project.id)]);
  return { scope: scopeFromRequest(req), schema, defaultLocale, actor: { type: 'user', id: user.id, label: user.name, ip: clientIp(req) } };
}

const releaseInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(1000).default(''),
});

async function findRelease(req: Request) {
  const release = await prisma.release.findFirst({ where: { id: param(req, 'releaseId'), environmentId: envOf(req).environment.id } });
  if (!release) throw notFound('Release');
  return release;
}

async function releaseDetail(req: Request, releaseId: string) {
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const release = await prisma.release.findUniqueOrThrow({
    where: { id: releaseId },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: { entry: { select: { id: true, title: true, status: true, locale: true, contentTypeId: true, publishedAt: true, path: true, deletedAt: true, data: true, publishedData: true } } },
      },
    },
  });
  return {
    ...release,
    items: release.items.map((item) => {
      const type = schema.typeById.get(item.entry.contentTypeId);
      return {
        id: item.id,
        action: item.action,
        entryId: item.entryId,
        title: item.entry.title,
        status: item.entry.status,
        locale: item.entry.locale,
        path: item.entry.path,
        isPublished: !!item.entry.publishedAt,
        hasChanges: !!item.entry.publishedAt && !sameJson(item.entry.data, item.entry.publishedData),
        deleted: !!item.entry.deletedAt,
        contentType: type?.apiId ?? null,
        contentTypeName: type?.singularName ?? 'Unknown',
        isPage: type ? isPageType(type) : false,
      };
    }),
  };
}

releasesRouter.get('/', envScope('content.read'), async (req, res) => {
  const releases = await prisma.release.findMany({
    where: { environmentId: envOf(req).environment.id },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: { _count: { select: { items: true } } },
    take: 200,
  });
  res.json({ items: releases.map(({ _count, ...r }) => ({ ...r, itemCount: _count.items })) });
});

releasesRouter.post('/', envScope('release.manage'), async (req, res) => {
  const input = parse(releaseInput, req.body);
  const release = await prisma.release.create({
    data: { environmentId: envOf(req).environment.id, name: input.name, description: input.description, createdById: userOf(req).id },
  });
  await audit(req, { action: 'release.created', resourceType: 'release', resourceId: release.id, resourceLabel: release.name });
  res.status(201).json({ ...release, items: [] });
});

releasesRouter.get('/:releaseId', envScope('content.read'), async (req, res) => {
  const release = await findRelease(req);
  res.json(await releaseDetail(req, release.id));
});

releasesRouter.patch('/:releaseId', envScope('release.manage'), async (req, res) => {
  const input = parse(releaseInput.partial().extend({ scheduledAt: z.coerce.date().nullable().optional() }), req.body);
  const release = await findRelease(req);
  if (release.status === 'PUBLISHED') throw conflict('A published release can no longer be changed');
  if (input.scheduledAt && input.scheduledAt.getTime() <= Date.now()) throw badRequest('Scheduled time must be in the future');
  if (input.scheduledAt) {
    const items = await prisma.releaseItem.count({ where: { releaseId: release.id } });
    if (items === 0) throw conflict('Add at least one entry before scheduling the release');
  }
  const updated = await prisma.release.update({
    where: { id: release.id },
    data: {
      name: input.name ?? release.name,
      description: input.description ?? release.description,
      ...(input.scheduledAt !== undefined
        ? { scheduledAt: input.scheduledAt, status: input.scheduledAt ? 'SCHEDULED' : 'OPEN', error: null }
        : {}),
    },
  });
  await audit(req, {
    action: input.scheduledAt !== undefined ? (input.scheduledAt ? 'release.scheduled' : 'release.unscheduled') : 'release.updated',
    resourceType: 'release',
    resourceId: release.id,
    resourceLabel: updated.name,
    metadata: input.scheduledAt ? { scheduledAt: input.scheduledAt.toISOString() } : undefined,
  });
  res.json(await releaseDetail(req, updated.id));
});

releasesRouter.delete('/:releaseId', envScope('release.manage'), async (req, res) => {
  const release = await findRelease(req);
  await prisma.release.delete({ where: { id: release.id } });
  await audit(req, { action: 'release.deleted', resourceType: 'release', resourceId: release.id, resourceLabel: release.name });
  res.status(204).end();
});

releasesRouter.post('/:releaseId/items', envScope('release.manage'), async (req, res) => {
  const input = parse(z.object({ entryIds: z.array(z.string().uuid()).min(1).max(200), action: z.enum(['PUBLISH', 'UNPUBLISH']).default('PUBLISH') }), req.body);
  const release = await findRelease(req);
  if (release.status === 'PUBLISHED') throw conflict('A published release can no longer be changed');
  const entries = await prisma.entry.findMany({
    where: { id: { in: input.entryIds }, environmentId: release.environmentId, deletedAt: null },
    select: { id: true },
  });
  if (entries.length !== new Set(input.entryIds).size) throw badRequest('Some entries do not exist in this environment');
  for (const entry of entries) {
    await prisma.releaseItem.upsert({
      where: { releaseId_entryId: { releaseId: release.id, entryId: entry.id } },
      create: { releaseId: release.id, entryId: entry.id, action: input.action },
      update: { action: input.action },
    });
  }
  res.status(201).json(await releaseDetail(req, release.id));
});

releasesRouter.delete('/:releaseId/items/:itemId', envScope('release.manage'), async (req, res) => {
  const release = await findRelease(req);
  if (release.status === 'PUBLISHED') throw conflict('A published release can no longer be changed');
  const removed = await prisma.releaseItem.deleteMany({ where: { id: param(req, 'itemId'), releaseId: release.id } });
  if (removed.count === 0) throw notFound('Release item');
  res.json(await releaseDetail(req, release.id));
});

releasesRouter.get('/:releaseId/validate', envScope('content.read'), async (req, res) => {
  const release = await findRelease(req);
  const checks = await validateRelease(await engine(req), release.id);
  res.json({ ready: checks.length > 0 && checks.every((c) => c.ok), checks });
});

releasesRouter.post('/:releaseId/publish', envScope('release.manage', 'content.publish'), async (req, res) => {
  const release = await findRelease(req);
  await publishRelease(await engine(req), release.id);
  res.json(await releaseDetail(req, release.id));
});
