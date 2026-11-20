import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { createRedisConnection, logger, prisma } from '../../lib/infra';
import { writeAudit } from '../audit/audit.service';
import { scopeFromEnvironment } from '../events/events.service';
import { type EngineContext, SYSTEM_ACTOR, publishEntry, unpublishEntry } from '../entries/entries.service';
import { publishRelease } from '../releases/releases.service';
import { loadSchema } from '../schema/schema.service';

const QUEUE_NAME = 'scheduler';
let queue: Queue | null = null;
let worker: Worker | null = null;

async function systemContext(environmentId: string): Promise<EngineContext> {
  const [scope, schema] = await Promise.all([scopeFromEnvironment(environmentId), loadSchema(environmentId)]);
  const locale = await prisma.locale.findFirst({ where: { projectId: scope.project.id, isDefault: true }, select: { code: true } });
  return { scope, schema, defaultLocale: locale?.code ?? 'en', actor: SYSTEM_ACTOR };
}

/**
 * Executes everything that is due: scheduled publishes, scheduled unpublishes and scheduled
 * releases. The database is the source of truth for schedules, so a restart or a missed
 * tick never loses work — the next sweep simply picks it up.
 */
export async function runScheduledWork(now = new Date()) {
  const summary = { published: 0, unpublished: 0, releases: 0, failed: 0 };

  const duePublish = await prisma.entry.findMany({
    where: { scheduledPublishAt: { lte: now }, deletedAt: null, environment: { project: { deletedAt: null } } },
    orderBy: { scheduledPublishAt: 'asc' },
    take: 100,
    select: { id: true, environmentId: true, contentTypeId: true, title: true },
  });
  for (const due of duePublish) {
    try {
      const ctx = await systemContext(due.environmentId);
      const type = ctx.schema.typeById.get(due.contentTypeId);
      if (!type) throw new Error('Content type no longer exists');
      // Approval was verified when the schedule was set, and editing afterwards cancels the schedule.
      await publishEntry(ctx, type, due.id, { note: 'Scheduled publish', skipApproval: true });
      summary.published += 1;
    } catch (err) {
      summary.failed += 1;
      const message = (err as Error).message;
      logger.warn({ entryId: due.id, err: message }, 'scheduled publish failed');
      // Clear the schedule so a broken entry is not retried forever, and leave a trace for editors.
      await prisma.entry.update({ where: { id: due.id }, data: { scheduledPublishAt: null, status: 'DRAFT' } }).catch(() => undefined);
      const scope = await scopeFromEnvironment(due.environmentId).catch(() => null);
      if (scope) {
        await writeAudit({
          organizationId: scope.organizationId,
          projectId: scope.project.id,
          environmentId: due.environmentId,
          actorType: 'system',
          actorLabel: SYSTEM_ACTOR.label,
          action: 'entry.schedule_failed',
          resourceType: 'entry',
          resourceId: due.id,
          resourceLabel: due.title,
          metadata: { reason: message },
        });
      }
    }
  }

  const dueUnpublish = await prisma.entry.findMany({
    where: { scheduledUnpublishAt: { lte: now }, deletedAt: null, environment: { project: { deletedAt: null } } },
    take: 100,
    select: { id: true, environmentId: true, contentTypeId: true, publishedAt: true },
  });
  for (const due of dueUnpublish) {
    try {
      if (due.publishedAt) {
        const ctx = await systemContext(due.environmentId);
        const type = ctx.schema.typeById.get(due.contentTypeId);
        if (!type) throw new Error('Content type no longer exists');
        await unpublishEntry(ctx, type, due.id);
        summary.unpublished += 1;
      } else {
        await prisma.entry.update({ where: { id: due.id }, data: { scheduledUnpublishAt: null } });
      }
    } catch (err) {
      summary.failed += 1;
      logger.warn({ entryId: due.id, err: (err as Error).message }, 'scheduled unpublish failed');
      await prisma.entry.update({ where: { id: due.id }, data: { scheduledUnpublishAt: null } }).catch(() => undefined);
    }
  }

  const dueReleases = await prisma.release.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now }, environment: { project: { deletedAt: null } } },
    take: 20,
    select: { id: true, environmentId: true },
  });
  for (const due of dueReleases) {
    try {
      await publishRelease(await systemContext(due.environmentId), due.id);
      summary.releases += 1;
    } catch (err) {
      summary.failed += 1;
      // publishRelease has already marked the release FAILED with the reason.
      logger.warn({ releaseId: due.id, err: (err as Error).message }, 'scheduled release failed');
    }
  }
  return summary;
}

/** Registers the repeating sweep. BullMQ guarantees a single execution per tick across all API instances. */
export async function startScheduler() {
  if (worker) return;
  queue = new Queue(QUEUE_NAME, { connection: createRedisConnection() });
  await queue.upsertJobScheduler('sweep', { every: env.SCHEDULER_INTERVAL_MS }, { name: 'sweep', opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } } });
  worker = new Worker(
    QUEUE_NAME,
    async () => {
      const summary = await runScheduledWork();
      if (summary.published || summary.unpublished || summary.releases || summary.failed) logger.info(summary, 'scheduler sweep');
      return summary;
    },
    { connection: createRedisConnection(), concurrency: 1 },
  );
  worker.on('error', (err) => logger.error({ err: err.message }, 'scheduler worker error'));
}

export async function stopScheduler() {
  await Promise.allSettled([worker?.close(), queue?.close()]);
  worker = null;
  queue = null;
}
