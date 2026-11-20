import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import type { ContentEvent } from '@meridian/shared';
import { env } from '../../config/env';
import { decryptSecret, hmacSha256 } from '../../lib/crypto';
import { createRedisConnection, logger, prisma } from '../../lib/infra';

const QUEUE_NAME = 'webhook-deliveries';

let queue: Queue | null = null;
let worker: Worker | null = null;

export function getWebhookQueue(): Queue {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

async function enqueueDelivery(deliveryId: string) {
  await getWebhookQueue().add(
    'deliver',
    { deliveryId },
    {
      jobId: deliveryId,
      attempts: env.WEBHOOK_MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: env.WEBHOOK_BACKOFF_MS },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  );
}

/** Records one delivery per subscribed webhook and hands each to the queue. */
export async function enqueueWebhooks(environmentId: string, event: ContentEvent): Promise<void> {
  const hooks = await prisma.webhook.findMany({
    where: { environmentId, isActive: true, OR: [{ events: { has: event.event } }, { events: { has: '*' } }] },
    select: { id: true },
  });
  for (const hook of hooks) {
    const delivery = await prisma.webhookDelivery.create({
      data: { webhookId: hook.id, eventId: event.id, event: event.event, payload: event as unknown as Prisma.InputJsonValue },
    });
    await enqueueDelivery(delivery.id);
  }
}

/** Sends an existing payload again as a fresh delivery. */
export async function redeliver(deliveryId: string, webhookId: string): Promise<string> {
  const original = await prisma.webhookDelivery.findFirstOrThrow({ where: { id: deliveryId, webhookId } });
  const copy = await prisma.webhookDelivery.create({
    data: { webhookId, eventId: original.eventId, event: original.event, payload: original.payload as Prisma.InputJsonValue },
  });
  await enqueueDelivery(copy.id);
  return copy.id;
}

export async function sendTestEvent(webhookId: string, scope: { organization: string; project: string; projectId: string; environment: string; environmentId: string }) {
  const payload = {
    id: crypto.randomUUID(),
    event: 'ping',
    ...scope,
    message: 'Test delivery from Meridian. If you can verify this signature, your endpoint is ready.',
    timestamp: new Date().toISOString(),
  };
  const delivery = await prisma.webhookDelivery.create({
    data: { webhookId, eventId: payload.id, event: 'ping', payload },
  });
  await enqueueDelivery(delivery.id);
  return delivery.id;
}

function isPrivateIp(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice(7));
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

/**
 * Guards against server-side request forgery: webhook targets must be http(s) and, unless
 * explicitly allowed for local development, must not resolve to a private or loopback address.
 */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Webhook URL must use http or https');
  if (url.username || url.password) throw new Error('Webhook URL must not contain credentials');
  if (env.WEBHOOK_ALLOW_PRIVATE_URLS) return url;
  if (url.protocol !== 'https:') throw new Error('Webhook URL must use https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error('Webhook host could not be resolved');
  if (addresses.some((a) => isPrivateIp(a.address))) throw new Error('Webhook URL resolves to a private network address');
  return url;
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

async function attemptDelivery(deliveryId: string, attempt: number, maxAttempts: number): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!delivery) return;
  const fail = async (error: string, extra: { responseStatus?: number; responseBody?: string; durationMs?: number } = {}, permanent = false) => {
    const exhausted = permanent || attempt >= maxAttempts;
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: exhausted ? 'FAILED' : 'RETRYING',
        attempts: attempt,
        error: error.slice(0, 500),
        responseStatus: extra.responseStatus ?? null,
        responseBody: extra.responseBody?.slice(0, 2000) ?? null,
        durationMs: extra.durationMs ?? null,
        nextRetryAt: exhausted ? null : new Date(Date.now() + env.WEBHOOK_BACKOFF_MS * 2 ** (attempt - 1)),
        completedAt: exhausted ? new Date() : null,
      },
    });
    // UnrecoverableError tells BullMQ not to schedule further attempts.
    throw permanent ? new UnrecoverableError(error) : new Error(error);
  };

  if (!delivery.webhook.isActive) await fail('Webhook is disabled', {}, true);

  let url: URL;
  try {
    url = await assertSafeWebhookUrl(delivery.webhook.url);
  } catch (err) {
    await fail((err as Error).message, {}, true);
    return;
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const custom = (delivery.webhook.headers ?? {}) as Record<string, string>;
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      // Redirects are not followed: a redirect could point back into a private network.
      redirect: 'manual',
      signal: AbortSignal.timeout(env.WEBHOOK_TIMEOUT_MS),
      headers: {
        ...custom,
        'Content-Type': 'application/json',
        'User-Agent': 'Meridian-Webhooks/1.0',
        'X-Meridian-Event': delivery.event,
        // Stable across retries, so receivers can de-duplicate.
        'X-Meridian-Delivery': delivery.id,
        'X-Meridian-Event-Id': delivery.eventId,
        'X-Meridian-Timestamp': String(timestamp),
        'X-Meridian-Signature': signPayload(decryptSecret(delivery.webhook.secretEnc), timestamp, body),
      },
      body,
    });
  } catch (err) {
    const e = err as Error;
    const message = e.name === 'TimeoutError' ? `Timed out after ${env.WEBHOOK_TIMEOUT_MS} ms` : `Request failed: ${(e.cause as Error | undefined)?.message ?? e.message}`;
    await fail(message, { durationMs: Date.now() - started });
    return;
  }
  const durationMs = Date.now() - started;
  const text = await response.text().catch(() => '');
  if (response.status >= 200 && response.status < 300) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'SUCCESS',
        attempts: attempt,
        responseStatus: response.status,
        responseBody: text.slice(0, 2000),
        durationMs,
        error: null,
        nextRetryAt: null,
        completedAt: new Date(),
      },
    });
    return;
  }
  // 4xx (other than 408/429) means the receiver rejected the request; retrying will not help.
  const permanent = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
  await fail(`Endpoint responded with HTTP ${response.status}`, { responseStatus: response.status, responseBody: text, durationMs }, permanent);
}

export function startWebhookWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ deliveryId: string }>) => attemptDelivery(job.data.deliveryId, job.attemptsMade + 1, job.opts.attempts ?? 1),
    { connection: createRedisConnection(), concurrency: 8 },
  );
  worker.on('error', (err) => logger.error({ err: err.message }, 'webhook worker error'));
  return worker;
}

export async function webhookQueueStats() {
  const counts = await getWebhookQueue().getJobCounts('waiting', 'active', 'delayed', 'failed');
  return { waiting: counts.waiting ?? 0, active: counts.active ?? 0, delayed: counts.delayed ?? 0, failed: counts.failed ?? 0 };
}

export async function stopWebhooks() {
  await Promise.allSettled([worker?.close(), queue?.close()]);
  worker = null;
  queue = null;
}
