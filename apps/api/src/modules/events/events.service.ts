import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { ContentEvent, EventType } from '@meridian/shared';
import { logger, prisma, redis } from '../../lib/infra';
import { envOf } from '../../middleware/auth';
import { enqueueWebhooks } from '../webhooks/webhooks.service';

export const EVENTS_CHANNEL = 'meridian:events';

/** Tenant coordinates carried by every event. */
export interface EventScope {
  organizationId: string;
  organizationSlug: string;
  project: { id: string; slug: string };
  environment: { id: string; key: string };
}

export function scopeFromRequest(req: Request): EventScope {
  const { tenant, project, environment } = envOf(req);
  return {
    organizationId: tenant.organizationId,
    organizationSlug: tenant.organizationSlug,
    project: { id: project.id, slug: project.slug },
    environment: { id: environment.id, key: environment.key },
  };
}

export async function scopeFromEnvironment(environmentId: string): Promise<EventScope> {
  const env = await prisma.environment.findUniqueOrThrow({
    where: { id: environmentId },
    select: { id: true, key: true, project: { select: { id: true, slug: true, organization: { select: { id: true, slug: true } } } } },
  });
  return {
    organizationId: env.project.organization.id,
    organizationSlug: env.project.organization.slug,
    project: { id: env.project.id, slug: env.project.slug },
    environment: { id: env.id, key: env.key },
  };
}

const cacheVersionKey = (environmentId: string) => `cv:${environmentId}`;

/** Delivery responses are cached under a per-environment version; bumping it invalidates them all at once. */
export async function getCacheVersion(environmentId: string): Promise<string> {
  return (await redis.get(cacheVersionKey(environmentId))) ?? '0';
}

export async function invalidateDeliveryCache(environmentId: string): Promise<void> {
  await redis.incr(cacheVersionKey(environmentId));
}

export type EventInput = Omit<ContentEvent, 'id' | 'timestamp' | 'organization' | 'project' | 'projectId' | 'environment' | 'environmentId'>;

/**
 * Publishes a domain event:
 *   1. invalidates the delivery cache, so the API serves the new state on the very next request;
 *   2. queues signed webhook deliveries (with retries) for subscribed endpoints;
 *   3. fans out to WebSocket subscribers via Redis pub/sub.
 * Called after the database transaction has committed.
 */
export async function emitEvent(scope: EventScope, input: EventInput): Promise<ContentEvent> {
  const event: ContentEvent = {
    id: randomUUID(),
    ...input,
    organization: scope.organizationSlug,
    project: scope.project.slug,
    projectId: scope.project.id,
    environment: scope.environment.key,
    environmentId: scope.environment.id,
    timestamp: new Date().toISOString(),
  };
  try {
    await invalidateDeliveryCache(scope.environment.id);
    await enqueueWebhooks(scope.environment.id, event);
    await redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  } catch (err) {
    // The content change itself is already committed; distribution problems are logged, not surfaced as a failed save.
    logger.error({ err: (err as Error).message, event: event.event }, 'event distribution failed');
  }
  return event;
}

export type { EventType };
