import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { EVENT_TYPES } from '@meridian/shared';
import { encryptSecret, randomToken } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { param, parse, toPage } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { envOf, envScope, userOf } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { scopeFromRequest } from '../events/events.service';
import { assertSafeWebhookUrl, redeliver, sendTestEvent } from './webhooks.service';

export const webhooksRouter = Router({ mergeParams: true });

const FORBIDDEN_HEADERS = ['host', 'content-length', 'content-type', 'user-agent', 'connection', 'transfer-encoding'];

const headers = z
  .record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'Invalid header name'), z.string().max(1000))
  .refine((h) => Object.keys(h).length <= 20, 'At most 20 custom headers')
  .refine((h) => Object.keys(h).every((k) => !FORBIDDEN_HEADERS.includes(k.toLowerCase()) && !k.toLowerCase().startsWith('x-meridian-')), 'That header is managed by Meridian');

const webhookInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  url: z.string().trim().url('Enter a valid URL').max(1000),
  events: z.array(z.enum([...EVENT_TYPES, '*'] as [string, ...string[]])).min(1, 'Choose at least one event'),
  headers: headers.default({}),
  isActive: z.boolean().default(true),
});

const newSecret = () => `whsec_${randomToken(32)}`;

async function checkUrl(url: string) {
  try {
    await assertSafeWebhookUrl(url);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
}

const present = <T extends { secretEnc: string }>(hook: T) => {
  const { secretEnc: _secret, ...rest } = hook;
  return rest;
};

webhooksRouter.get('/', envScope('webhook.manage'), async (req, res) => {
  const environmentId = envOf(req).environment.id;
  const hooks = await prisma.webhook.findMany({ where: { environmentId }, orderBy: { createdAt: 'desc' } });
  const since = new Date(Date.now() - 7 * 86400 * 1000);
  const stats = await prisma.webhookDelivery.groupBy({
    by: ['webhookId', 'status'],
    where: { webhookId: { in: hooks.map((h) => h.id) }, createdAt: { gte: since } },
    _count: true,
  });
  const last = await prisma.webhookDelivery.findMany({
    where: { webhookId: { in: hooks.map((h) => h.id) } },
    orderBy: { createdAt: 'desc' },
    distinct: ['webhookId'],
    select: { webhookId: true, status: true, createdAt: true, responseStatus: true },
  });
  res.json({
    items: hooks.map((h) => {
      const own = stats.filter((s) => s.webhookId === h.id);
      const count = (status: string) => own.find((s) => s.status === status)?._count ?? 0;
      return {
        ...present(h),
        deliveries7d: { success: count('SUCCESS'), failed: count('FAILED'), pending: count('PENDING') + count('RETRYING') },
        lastDelivery: last.find((l) => l.webhookId === h.id) ?? null,
      };
    }),
  });
});

webhooksRouter.post('/', envScope('webhook.manage'), async (req, res) => {
  const input = parse(webhookInput, req.body);
  await checkUrl(input.url);
  const secret = newSecret();
  const hook = await prisma.webhook.create({
    data: {
      environmentId: envOf(req).environment.id,
      name: input.name,
      url: input.url,
      events: [...new Set(input.events)],
      headers: input.headers as Prisma.InputJsonValue,
      isActive: input.isActive,
      secretEnc: encryptSecret(secret),
      createdById: userOf(req).id,
    },
  });
  await audit(req, { action: 'webhook.created', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name, after: { url: hook.url, events: hook.events } });
  // The signing secret is shown once. It is stored encrypted and can only be replaced, not read back.
  res.status(201).json({ ...present(hook), secret });
});

webhooksRouter.patch('/:webhookId', envScope('webhook.manage'), async (req, res) => {
  const input = parse(webhookInput.partial(), req.body);
  const hook = await prisma.webhook.findFirst({ where: { id: param(req, 'webhookId'), environmentId: envOf(req).environment.id } });
  if (!hook) throw notFound('Webhook');
  if (input.url && input.url !== hook.url) await checkUrl(input.url);
  const updated = await prisma.webhook.update({
    where: { id: hook.id },
    data: {
      name: input.name ?? hook.name,
      url: input.url ?? hook.url,
      events: input.events ? [...new Set(input.events)] : hook.events,
      headers: (input.headers ?? hook.headers) as Prisma.InputJsonValue,
      isActive: input.isActive ?? hook.isActive,
    },
  });
  await audit(req, {
    action: 'webhook.updated',
    resourceType: 'webhook',
    resourceId: hook.id,
    resourceLabel: updated.name,
    before: { url: hook.url, events: hook.events, isActive: hook.isActive },
    after: { url: updated.url, events: updated.events, isActive: updated.isActive },
  });
  res.json(present(updated));
});

webhooksRouter.post('/:webhookId/rotate-secret', envScope('webhook.manage'), async (req, res) => {
  const hook = await prisma.webhook.findFirst({ where: { id: param(req, 'webhookId'), environmentId: envOf(req).environment.id } });
  if (!hook) throw notFound('Webhook');
  const secret = newSecret();
  await prisma.webhook.update({ where: { id: hook.id }, data: { secretEnc: encryptSecret(secret) } });
  await audit(req, { action: 'webhook.secret_rotated', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name });
  res.json({ secret });
});

webhooksRouter.post('/:webhookId/test', envScope('webhook.manage'), async (req, res) => {
  const hook = await prisma.webhook.findFirst({ where: { id: param(req, 'webhookId'), environmentId: envOf(req).environment.id } });
  if (!hook) throw notFound('Webhook');
  if (!hook.isActive) throw badRequest('Enable the webhook before sending a test');
  const scope = scopeFromRequest(req);
  const deliveryId = await sendTestEvent(hook.id, {
    organization: scope.organizationSlug,
    project: scope.project.slug,
    projectId: scope.project.id,
    environment: scope.environment.key,
    environmentId: scope.environment.id,
  });
  res.status(202).json({ deliveryId });
});

webhooksRouter.delete('/:webhookId', envScope('webhook.manage'), async (req, res) => {
  const hook = await prisma.webhook.findFirst({ where: { id: param(req, 'webhookId'), environmentId: envOf(req).environment.id } });
  if (!hook) throw notFound('Webhook');
  await prisma.webhook.delete({ where: { id: hook.id } });
  await audit(req, { action: 'webhook.deleted', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name, before: { url: hook.url } });
  res.status(204).end();
});

webhooksRouter.get('/:webhookId/deliveries', envScope('webhook.manage'), async (req, res) => {
  const q = parse(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      status: z.enum(['PENDING', 'RETRYING', 'SUCCESS', 'FAILED']).optional(),
    }),
    req.query,
  );
  const hook = await prisma.webhook.findFirst({ where: { id: param(req, 'webhookId'), environmentId: envOf(req).environment.id }, select: { id: true } });
  if (!hook) throw notFound('Webhook');
  const where = { webhookId: hook.id, ...(q.status ? { status: q.status } : {}) };
  const [items, total] = await Promise.all([
    prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.webhookDelivery.count({ where }),
  ]);
  res.json(toPage(items, total, q.page, q.pageSize));
});

webhooksRouter.post('/:webhookId/deliveries/:deliveryId/redeliver', envScope('webhook.manage'), async (req, res) => {
  const hook = await prisma.webhook.findFirst({ where: { id: param(req, 'webhookId'), environmentId: envOf(req).environment.id }, select: { id: true } });
  if (!hook) throw notFound('Webhook');
  const exists = await prisma.webhookDelivery.findFirst({ where: { id: param(req, 'deliveryId'), webhookId: hook.id }, select: { id: true } });
  if (!exists) throw notFound('Delivery');
  res.status(202).json({ deliveryId: await redeliver(exists.id, hook.id) });
});
