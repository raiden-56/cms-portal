import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { adminOrigins, env } from './config/env';
import { prisma, redis } from './lib/infra';
import { requireAuth } from './middleware/auth';
import { errorHandler, notFoundHandler, rateLimit, requestId, requestLogger } from './middleware/common';
import { analyticsRouter } from './modules/analytics/analytics.routes';
import { authRouter } from './modules/auth/auth.routes';
import { deliveryRouter } from './modules/delivery/rest.routes';
import { entriesRouter } from './modules/entries/entries.routes';
import { mediaDeliveryRouter, mediaRouter } from './modules/media/media.routes';
import { organizationsRouter } from './modules/organizations/organizations.routes';
import { projectsRouter } from './modules/projects/projects.routes';
import { releasesRouter } from './modules/releases/releases.routes';
import { schemaRouter } from './modules/schema/schema.routes';
import { tokensRouter } from './modules/tokens/tokens.routes';
import { webhooksRouter } from './modules/webhooks/webhooks.routes';

/**
 * Three surfaces share one process:
 *
 *   /admin/api/*  Management API. Session-authenticated, restricted to the admin origin,
 *                 every route guarded by a tenant scope and a permission.
 *   /api/v1/*     Content delivery API (REST + GraphQL). Token-authenticated, open CORS,
 *                 published content only unless a preview credential says otherwise.
 *   /media/*      Public, immutable media delivery with image transformations.
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  // Nested query parameters (filter[price][gte]=10) need the extended parser.
  app.set('query parser', 'extended');

  app.use(requestId);
  app.use(requestLogger);
  app.use(
    helmet({
      // This server returns JSON and media, never HTML documents of its own.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.get('/health', async (_req, res) => {
    const [db, cache] = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    const ok = db.status === 'fulfilled' && cache.status === 'fulfilled';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      database: db.status === 'fulfilled' ? 'up' : 'down',
      redis: cache.status === 'fulfilled' ? 'up' : 'down',
      uptime: Math.round(process.uptime()),
    });
  });

  // ── Media ────────────────────────────────────────────────────────────────
  app.use('/media', mediaDeliveryRouter);

  // ── Delivery API ─────────────────────────────────────────────────────────
  const deliveryCors = cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key', 'If-None-Match', 'X-Preview-Token', 'X-Meridian-Status'],
    exposedHeaders: ['ETag', 'X-Cache', 'X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
    maxAge: 86400,
  });
  app.use('/api/v1', deliveryCors, express.json({ limit: '2mb' }), deliveryRouter);

  // ── Management API ───────────────────────────────────────────────────────
  const admin = express.Router();
  admin.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || adminOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Meridian-Client'],
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
      maxAge: 600,
    }),
  );
  admin.use(express.json({ limit: '5mb' }));
  admin.use(cookieParser());
  admin.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  admin.use('/auth', authRouter);
  admin.use(requireAuth);
  // A generous ceiling per signed-in user: far above normal editing (autosave included), low enough to blunt scripted abuse.
  admin.use(rateLimit({ name: 'admin', limit: 1500, windowSeconds: 60, key: (req) => req.user?.id ?? null }));
  admin.use('/orgs', organizationsRouter);
  admin.use('/', projectsRouter);
  admin.use('/projects/:projectId/tokens', tokensRouter);
  admin.use('/projects/:projectId', mediaRouter);
  admin.use('/envs/:envId', schemaRouter);
  admin.use('/envs/:envId', entriesRouter);
  admin.use('/envs/:envId', analyticsRouter);
  admin.use('/envs/:envId/releases', releasesRouter);
  admin.use('/envs/:envId/webhooks', webhooksRouter);
  app.use('/admin/api', admin);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
