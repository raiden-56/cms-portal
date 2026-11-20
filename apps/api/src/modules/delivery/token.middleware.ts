import type { NextFunction, Request, Response } from 'express';
import { sha256 } from '../../lib/crypto';
import { forbidden, unauthorized } from '../../lib/errors';
import { logger, prisma } from '../../lib/infra';
import { rateLimit } from '../../middleware/common';
import type { TokenContext } from '../../types/express';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const key = req.headers['x-api-key'];
  return typeof key === 'string' && key ? key.trim() : null;
}

/**
 * Authenticates a delivery API request. The token alone determines the project and
 * environment — there is no way to address another tenant's content through the URL.
 */
export async function requireApiToken(req: Request, _res: Response, next: NextFunction) {
  const raw = extractToken(req);
  if (!raw) throw unauthorized('Provide an API token: Authorization: Bearer <token>');
  if (!raw.startsWith('mrd_')) throw unauthorized('API token is not recognised');

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: {
      environment: { select: { id: true, key: true, name: true } },
      project: {
        select: {
          id: true,
          slug: true,
          name: true,
          deletedAt: true,
          organization: { select: { id: true, slug: true, deletedAt: true } },
          locales: { select: { code: true, isDefault: true, fallbackCode: true } },
        },
      },
    },
  });
  if (!token || token.project.deletedAt || token.project.organization.deletedAt) throw unauthorized('API token is not recognised');
  if (token.revokedAt) throw unauthorized('API token has been revoked');
  if (token.expiresAt && token.expiresAt < new Date()) throw unauthorized('API token has expired');

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/$/, '') : null;
  if (origin) {
    const listed = token.allowedOrigins.includes(origin);
    if (token.allowedOrigins.length > 0 && !listed) throw forbidden('This origin is not allowed to use this API token');
    // Write and preview tokens are secrets: refuse them from a browser unless that origin was explicitly allowed.
    if (token.type !== 'READ_ONLY' && !listed) {
      throw forbidden('Read/write and preview tokens must only be used from a server. Use a read-only token in the browser.');
    }
  }

  const { project, environment, ...record } = token;
  const context: TokenContext = {
    token: record,
    organizationId: project.organization.id,
    organizationSlug: project.organization.slug,
    project: { id: project.id, slug: project.slug, name: project.name },
    environment,
    defaultLocale: project.locales.find((l) => l.isDefault)?.code ?? 'en',
    locales: project.locales,
  };
  req.apiToken = context;

  // Touch lastUsedAt at most once a minute so reads stay read-only in the common case.
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch((err) => logger.warn({ err: err.message }, 'lastUsedAt update failed'));
  }
  next();
}

export const tokenRateLimit = rateLimit({
  name: 'token',
  windowSeconds: 60,
  limit: (req) => req.apiToken?.token.rateLimitPerMinute ?? 60,
  key: (req) => req.apiToken?.token.id ?? null,
});

export function tokenOf(req: Request): TokenContext {
  if (!req.apiToken) throw unauthorized();
  return req.apiToken;
}

export function requireWriteToken(req: Request) {
  if (tokenOf(req).token.type !== 'READ_WRITE') throw forbidden('This operation needs a read/write API token');
}
