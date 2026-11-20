import { Router } from 'express';
import { z } from 'zod';
import { TOKEN_TYPES } from '@meridian/shared';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { param, parse } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { projectScope, userOf } from '../../middleware/auth';
import { audit } from '../audit/audit.service';

export const tokensRouter = Router({ mergeParams: true });

const TYPE_PREFIX = { READ_ONLY: 'ro', READ_WRITE: 'rw', PREVIEW: 'pv' } as const;

export function generateApiToken(type: keyof typeof TYPE_PREFIX) {
  const token = `mrd_${TYPE_PREFIX[type]}_${randomToken(32)}`;
  return { token, prefix: token.slice(0, 14), tokenHash: sha256(token) };
}

const origin = z
  .string()
  .trim()
  .max(200)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === v.replace(/\/$/, '');
    } catch {
      return false;
    }
  }, 'Origins look like https://example.com (no path)');

const tokenMeta = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  description: z.string().trim().max(300).default(''),
  allowedOrigins: z.array(origin).max(30).default([]),
  rateLimitPerMinute: z.number().int().min(1).max(100_000).default(600),
});

const createSchema = tokenMeta.extend({
  type: z.enum(TOKEN_TYPES),
  environmentId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

const publicFields = {
  id: true,
  name: true,
  description: true,
  type: true,
  prefix: true,
  environmentId: true,
  allowedOrigins: true,
  rateLimitPerMinute: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

tokensRouter.get('/', projectScope('token.manage'), async (req, res) => {
  const projectId = param(req, 'projectId');
  const tokens = await prisma.apiToken.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: publicFields });
  const since = new Date(Date.now() - 7 * 86400 * 1000);
  const usage = await prisma.apiUsage.groupBy({
    by: ['tokenId'],
    where: { tokenId: { in: tokens.map((t) => t.id) }, bucket: { gte: since } },
    _sum: { requests: true, errors: true },
  });
  const byToken = new Map(usage.map((u) => [u.tokenId, u._sum]));
  res.json({
    items: tokens.map((t) => ({
      ...t,
      status: t.revokedAt ? 'revoked' : t.expiresAt && t.expiresAt < new Date() ? 'expired' : 'active',
      requests7d: byToken.get(t.id)?.requests ?? 0,
      errors7d: byToken.get(t.id)?.errors ?? 0,
    })),
  });
});

tokensRouter.post('/', projectScope('token.manage'), async (req, res) => {
  const input = parse(createSchema, req.body);
  const projectId = param(req, 'projectId');
  const environment = await prisma.environment.findFirst({ where: { id: input.environmentId, projectId }, select: { id: true, key: true } });
  if (!environment) throw badRequest('Environment does not belong to this project');
  const secret = generateApiToken(input.type);
  const created = await prisma.apiToken.create({
    data: {
      projectId,
      environmentId: environment.id,
      name: input.name,
      description: input.description,
      type: input.type,
      prefix: secret.prefix,
      tokenHash: secret.tokenHash,
      allowedOrigins: input.allowedOrigins.map((o) => o.replace(/\/$/, '')),
      rateLimitPerMinute: input.rateLimitPerMinute,
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400 * 1000) : null,
      createdById: userOf(req).id,
    },
    select: publicFields,
  });
  await audit(req, {
    environmentId: environment.id,
    action: 'token.created',
    resourceType: 'api_token',
    resourceId: created.id,
    resourceLabel: created.name,
    after: { type: created.type, environment: environment.key, expiresAt: created.expiresAt },
  });
  // The plaintext token exists only in this response.
  res.status(201).json({ ...created, status: 'active', requests7d: 0, errors7d: 0, token: secret.token });
});

tokensRouter.patch('/:tokenId', projectScope('token.manage'), async (req, res) => {
  const input = parse(tokenMeta.partial(), req.body);
  const token = await prisma.apiToken.findFirst({ where: { id: param(req, 'tokenId'), projectId: param(req, 'projectId') } });
  if (!token) throw notFound('API token');
  const updated = await prisma.apiToken.update({
    where: { id: token.id },
    data: {
      name: input.name ?? token.name,
      description: input.description ?? token.description,
      allowedOrigins: input.allowedOrigins?.map((o) => o.replace(/\/$/, '')) ?? token.allowedOrigins,
      rateLimitPerMinute: input.rateLimitPerMinute ?? token.rateLimitPerMinute,
    },
    select: publicFields,
  });
  await audit(req, { environmentId: token.environmentId, action: 'token.updated', resourceType: 'api_token', resourceId: token.id, resourceLabel: updated.name });
  res.json(updated);
});

/** Issues a new secret for the same token record. The previous secret stops working immediately. */
tokensRouter.post('/:tokenId/rotate', projectScope('token.manage'), async (req, res) => {
  const token = await prisma.apiToken.findFirst({ where: { id: param(req, 'tokenId'), projectId: param(req, 'projectId') } });
  if (!token) throw notFound('API token');
  if (token.revokedAt) throw badRequest('A revoked token cannot be rotated. Create a new one.');
  const secret = generateApiToken(token.type);
  const updated = await prisma.apiToken.update({
    where: { id: token.id },
    data: { prefix: secret.prefix, tokenHash: secret.tokenHash },
    select: publicFields,
  });
  await audit(req, { environmentId: token.environmentId, action: 'token.rotated', resourceType: 'api_token', resourceId: token.id, resourceLabel: token.name });
  res.json({ ...updated, token: secret.token });
});

tokensRouter.delete('/:tokenId', projectScope('token.manage'), async (req, res) => {
  const token = await prisma.apiToken.findFirst({ where: { id: param(req, 'tokenId'), projectId: param(req, 'projectId') } });
  if (!token) throw notFound('API token');
  await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: token.revokedAt ?? new Date() } });
  await audit(req, { environmentId: token.environmentId, action: 'token.revoked', resourceType: 'api_token', resourceId: token.id, resourceLabel: token.name });
  res.status(204).end();
});
