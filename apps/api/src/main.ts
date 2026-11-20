import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { closeInfra, logger, prisma, redis } from './lib/infra';
import { startUsageRecorder, stopUsageRecorder } from './modules/analytics/usage';
import { attachEventGateway, closeEventGateway } from './modules/events/gateway';
import { startScheduler, stopScheduler } from './modules/scheduler/scheduler';
import { startWebhookWorker, stopWebhooks } from './modules/webhooks/webhooks.service';

async function main() {
  // Refuse to start if the backing services are unreachable, rather than failing on the first request.
  await prisma.$queryRaw`SELECT 1`;
  await redis.ping();

  const app = createApp();
  const server = createServer(app);
  attachEventGateway(server);
  startWebhookWorker();
  await startScheduler();
  startUsageRecorder();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, storage: env.STORAGE_DRIVER }, `Meridian API listening on http://localhost:${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    // Stop accepting work, let in-flight requests and jobs finish, then release connections.
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.allSettled([closeEventGateway(), stopScheduler(), stopWebhooks(), stopUsageRecorder()]);
    await closeInfra();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, 'failed to start');
  process.exit(1);
});
