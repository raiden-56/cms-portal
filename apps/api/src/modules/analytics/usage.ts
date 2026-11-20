import { logger, prisma } from '../../lib/infra';

interface Counter {
  environmentId: string;
  tokenId: string;
  resource: string;
  bucket: Date;
  requests: number;
  errors: number;
  latencyMsTotal: number;
}

/**
 * Delivery API usage is counted in memory and flushed to hourly rows in batches, so
 * tracking adds no database write to the request path.
 */
const pending = new Map<string, Counter>();
let timer: NodeJS.Timeout | null = null;

export function recordUsage(input: { environmentId: string; tokenId?: string | null; resource: string; status: number; durationMs: number }) {
  const bucket = new Date();
  bucket.setUTCMinutes(0, 0, 0);
  const tokenId = input.tokenId ?? '';
  const resource = input.resource.slice(0, 80);
  const key = `${input.environmentId}|${tokenId}|${resource}|${bucket.getTime()}`;
  const counter = pending.get(key) ?? { environmentId: input.environmentId, tokenId, resource, bucket, requests: 0, errors: 0, latencyMsTotal: 0 };
  counter.requests += 1;
  if (input.status >= 400) counter.errors += 1;
  counter.latencyMsTotal += Math.max(0, Math.round(input.durationMs));
  pending.set(key, counter);
}

export async function flushUsage(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.values()];
  pending.clear();
  for (const c of batch) {
    try {
      await prisma.apiUsage.upsert({
        where: { environmentId_tokenId_resource_bucket: { environmentId: c.environmentId, tokenId: c.tokenId, resource: c.resource, bucket: c.bucket } },
        create: { environmentId: c.environmentId, tokenId: c.tokenId, resource: c.resource, bucket: c.bucket, requests: c.requests, errors: c.errors, latencyMsTotal: c.latencyMsTotal },
        update: { requests: { increment: c.requests }, errors: { increment: c.errors }, latencyMsTotal: { increment: c.latencyMsTotal } },
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'failed to flush API usage');
    }
  }
}

export function startUsageRecorder(intervalMs = 5000) {
  if (timer) return;
  timer = setInterval(() => void flushUsage(), intervalMs);
  timer.unref();
}

export async function stopUsageRecorder() {
  if (timer) clearInterval(timer);
  timer = null;
  await flushUsage();
}
