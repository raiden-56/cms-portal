import type { Entry } from '@prisma/client';
import { sameJson } from '@meridian/shared';
import { HttpError, conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma } from '../../lib/infra';
import { writeAudit } from '../audit/audit.service';
import { emitEvent } from '../events/events.service';
import { type EngineContext, prepareData, publishInTx, unpublishInTx } from '../entries/entries.service';
import { isPageType } from '../schema/schema.service';

export interface ReleaseCheck {
  itemId: string;
  entryId: string;
  title: string | null;
  contentType: string;
  action: 'PUBLISH' | 'UNPUBLISH';
  ok: boolean;
  problems: string[];
}

/** Dry-run of a release: reports, per item, whether it would publish cleanly right now. */
export async function validateRelease(ctx: EngineContext, releaseId: string): Promise<ReleaseCheck[]> {
  const release = await prisma.release.findFirst({
    where: { id: releaseId, environmentId: ctx.scope.environment.id },
    include: { items: { include: { entry: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!release) throw notFound('Release');
  return release.items.map((item) => {
    const type = ctx.schema.typeById.get(item.entry.contentTypeId);
    const problems: string[] = [];
    if (!type) problems.push('Content type no longer exists');
    else if (item.entry.deletedAt) problems.push('Entry is in the trash');
    else if (item.action === 'UNPUBLISH') {
      if (!item.entry.publishedAt) problems.push('Entry is not published');
    } else {
      if (item.entry.status === 'ARCHIVED') problems.push('Entry is archived');
      for (const issue of prepareData(ctx.schema, type, item.entry.data, 'publish').issues) problems.push(issue.message);
      if (type.options.requireApproval && item.entry.status !== 'APPROVED') {
        const unchanged = item.entry.publishedAt && sameJson(item.entry.data, item.entry.publishedData);
        if (!unchanged) problems.push('Awaiting approval');
      }
    }
    return {
      itemId: item.id,
      entryId: item.entryId,
      title: item.entry.title,
      contentType: type?.apiId ?? 'unknown',
      action: item.action,
      ok: problems.length === 0,
      problems,
    };
  });
}

/**
 * Publishes every item of a release in a single database transaction: either all changes
 * go live together or none do. Events are emitted only after the commit.
 */
export async function publishRelease(ctx: EngineContext, releaseId: string) {
  const environmentId = ctx.scope.environment.id;
  const release = await prisma.release.findFirst({ where: { id: releaseId, environmentId }, include: { items: { orderBy: { createdAt: 'asc' } } } });
  if (!release) throw notFound('Release');
  if (release.status === 'PUBLISHED') throw conflict('This release has already been published');
  if (release.items.length === 0) throw conflict('Add at least one entry to the release before publishing');

  const published: { entry: Entry; before: Entry; action: 'PUBLISH' | 'UNPUBLISH' }[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const item of release.items) {
          const entry = await tx.entry.findFirst({ where: { id: item.entryId, environmentId, deletedAt: null } });
          if (!entry) throw unprocessable('A release item refers to content that no longer exists', [{ path: item.id, message: 'Entry was deleted' }]);
          const type = ctx.schema.typeById.get(entry.contentTypeId);
          if (!type) throw unprocessable('A release item refers to a content type that no longer exists');
          if (item.action === 'UNPUBLISH') {
            if (!entry.publishedAt) continue;
            published.push({ entry: await unpublishInTx(tx, ctx, entry), before: entry, action: 'UNPUBLISH' });
          } else {
            published.push({ entry: await publishInTx(tx, ctx, type, entry, { note: `Release: ${release.name}` }), before: entry, action: 'PUBLISH' });
          }
        }
        await tx.release.update({ where: { id: release.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), scheduledAt: null, error: null } });
      },
      { timeout: 120_000 },
    );
  } catch (err) {
    published.length = 0;
    const message = err instanceof HttpError ? err.message : 'Release failed unexpectedly';
    // Recorded outside the rolled-back transaction so the failure is visible on the release.
    await prisma.release.update({ where: { id: release.id }, data: { status: release.scheduledAt ? 'FAILED' : 'OPEN', error: message.slice(0, 500) } });
    throw err;
  }

  await writeAudit({
    organizationId: ctx.scope.organizationId,
    projectId: ctx.scope.project.id,
    environmentId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    actorLabel: ctx.actor.label,
    ip: ctx.actor.ip,
    action: 'release.published',
    resourceType: 'release',
    resourceId: release.id,
    resourceLabel: release.name,
    metadata: { items: published.length },
  });

  const documents: { contentType: string; documentId: string; slug?: string | null; path?: string | null }[] = [];
  for (const { entry, before, action } of published) {
    const type = ctx.schema.typeById.get(entry.contentTypeId);
    if (!type) continue;
    const live = action === 'PUBLISH' ? entry : before;
    const info = {
      contentType: type.apiId,
      documentId: entry.documentId,
      entryId: entry.id,
      locale: entry.locale,
      slug: live.publishedSlug ?? live.slug,
      path: live.publishedPath ?? live.path,
      title: live.publishedTitle ?? live.title,
    };
    documents.push({ contentType: info.contentType, documentId: info.documentId, slug: info.slug, path: info.path });
    const kind = action === 'PUBLISH' ? 'published' : 'unpublished';
    await emitEvent(ctx.scope, { event: isPageType(type) ? `page.${kind}` : `content.${kind}`, ...info, releaseId: release.id });
  }
  await emitEvent(ctx.scope, { event: 'release.published', releaseId: release.id, title: release.name, documents });
  return prisma.release.findUniqueOrThrow({ where: { id: release.id } });
}
