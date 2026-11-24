/** API keys and webhooks. Keys are random strings valid only inside this browser; webhook deliveries are simulated. */
import { z } from 'zod';
import { EVENT_TYPES, TOKEN_TYPES, type TokenType, newId } from '@meridian/shared';
import { type Ctx, audit, envScope, projectScope, simulateDelivery } from '../context';
import { type DbToken, type DbWebhook, db, now, nowIso } from '../db';
import { Reply, badRequest, created, noContent, notFound, paginate, parse } from '../http';
import type { Router } from '../router';

const TYPE_PREFIX: Record<TokenType, string> = { READ_ONLY: 'ro', READ_WRITE: 'rw', PREVIEW: 'pv' };

function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Same format as a real key. It was never issued by a server, so it opens nothing outside this browser. */
export function generateApiToken(type: TokenType) {
  const token = `mrd_${TYPE_PREFIX[type]}_${randomToken(32)}`;
  return { token, prefix: token.slice(0, 14) };
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

const createSchema = tokenMeta.extend({ type: z.enum(TOKEN_TYPES), environmentId: z.string().uuid(), expiresInDays: z.number().int().min(1).max(3650).nullable().optional() });

const publicFields = ({ secret: _secret, projectId: _projectId, ...token }: DbToken) => token;

export const tokenStatus = (t: DbToken): 'active' | 'revoked' | 'expired' => (t.revokedAt ? 'revoked' : t.expiresAt && t.expiresAt < nowIso() ? 'expired' : 'active');

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

function checkUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Webhook URL is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Webhook URL must use http or https');
  if (url.username || url.password) throw badRequest('Webhook URL must not contain credentials');
}

export function developerRoutes(r: Router): void {
  // ─── API keys ──────────────────────────────────────────────────────────────

  const tokens = '/projects/:projectId/tokens';
  const findToken = (c: Ctx) => {
    const project = projectScope(c);
    const token = db.tokens.find((t) => t.id === c.params.tokenId && t.projectId === project.id);
    if (!token) throw notFound('API token');
    return token;
  };

  r.get(tokens, (c) => {
    const project = projectScope(c);
    const since = new Date(now().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    return {
      items: db.tokens
        .filter((t) => t.projectId === project.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => {
          const usage = db.usage.filter((u) => u.tokenId === t.id && u.day >= since);
          return { ...publicFields(t), status: tokenStatus(t), requests7d: usage.reduce((n, u) => n + u.requests, 0), errors7d: usage.reduce((n, u) => n + u.errors, 0) };
        }),
    };
  });

  r.post(tokens, (c) => {
    const input = parse(createSchema, c.body);
    const project = projectScope(c);
    const environment = db.environments.find((e) => e.id === input.environmentId && e.projectId === project.id);
    if (!environment) throw badRequest('Environment does not belong to this project');
    const secret = generateApiToken(input.type);
    const token: DbToken = {
      id: newId(),
      projectId: project.id,
      environmentId: environment.id,
      name: input.name,
      description: input.description,
      type: input.type,
      prefix: secret.prefix,
      secret: secret.token,
      allowedOrigins: input.allowedOrigins.map((o) => o.replace(/\/$/, '')),
      rateLimitPerMinute: input.rateLimitPerMinute,
      expiresAt: input.expiresInDays ? new Date(now().getTime() + input.expiresInDays * 86_400_000).toISOString() : null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: nowIso(),
    };
    db.tokens.push(token);
    audit(c, { environmentId: environment.id, action: 'token.created', resourceType: 'api_token', resourceId: token.id, resourceLabel: token.name, after: { type: token.type, environment: environment.key, expiresAt: token.expiresAt } });
    // The key is shown once, exactly as on a server.
    return created({ ...publicFields(token), status: 'active', requests7d: 0, errors7d: 0, token: secret.token });
  });

  r.patch(`${tokens}/:tokenId`, (c) => {
    const input = parse(tokenMeta.partial(), c.body);
    const token = findToken(c);
    token.name = input.name ?? token.name;
    token.description = input.description ?? token.description;
    token.allowedOrigins = input.allowedOrigins?.map((o) => o.replace(/\/$/, '')) ?? token.allowedOrigins;
    token.rateLimitPerMinute = input.rateLimitPerMinute ?? token.rateLimitPerMinute;
    audit(c, { environmentId: token.environmentId, action: 'token.updated', resourceType: 'api_token', resourceId: token.id, resourceLabel: token.name });
    return publicFields(token);
  });

  /** Issues a new secret for the same key. The previous secret stops working immediately. */
  r.post(`${tokens}/:tokenId/rotate`, (c) => {
    const token = findToken(c);
    if (token.revokedAt) throw badRequest('A revoked token cannot be rotated. Create a new one.');
    const secret = generateApiToken(token.type);
    token.prefix = secret.prefix;
    token.secret = secret.token;
    audit(c, { environmentId: token.environmentId, action: 'token.rotated', resourceType: 'api_token', resourceId: token.id, resourceLabel: token.name });
    return { ...publicFields(token), token: secret.token };
  });

  r.delete(`${tokens}/:tokenId`, (c) => {
    const token = findToken(c);
    token.revokedAt = token.revokedAt ?? nowIso();
    audit(c, { environmentId: token.environmentId, action: 'token.revoked', resourceType: 'api_token', resourceId: token.id, resourceLabel: token.name });
    return noContent();
  });

  // ─── Webhooks ──────────────────────────────────────────────────────────────

  const hooks = '/envs/:envId/webhooks';
  const findHook = (c: Ctx): DbWebhook => {
    const { environment } = envScope(c);
    const hook = db.webhooks.find((h) => h.id === c.params.webhookId && h.environmentId === environment.id);
    if (!hook) throw notFound('Webhook');
    return hook;
  };

  r.get(hooks, (c) => {
    const { environment } = envScope(c);
    const since = new Date(now().getTime() - 7 * 86_400_000).toISOString();
    return {
      items: db.webhooks
        .filter((h) => h.environmentId === environment.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((h) => {
          const own = db.deliveries.filter((d) => d.webhookId === h.id);
          // Simulated deliveries were never sent, so they are not counted as delivered (or as anything else).
          const recent = own.filter((d) => d.createdAt >= since && d.payload.simulated !== true);
          const count = (...statuses: string[]) => recent.filter((d) => statuses.includes(d.status)).length;
          const last = [...own].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          return {
            ...h,
            deliveries7d: { success: count('SUCCESS'), failed: count('FAILED'), pending: count('PENDING', 'RETRYING') },
            lastDelivery: last ? { webhookId: h.id, status: last.status, createdAt: last.createdAt, responseStatus: last.responseStatus, simulated: last.payload.simulated === true } : null,
          };
        }),
    };
  });

  r.post(hooks, (c) => {
    const input = parse(webhookInput, c.body);
    const { environment } = envScope(c);
    checkUrl(input.url);
    const at = nowIso();
    const hook: DbWebhook = { id: newId(), environmentId: environment.id, name: input.name, url: input.url, events: [...new Set(input.events)], headers: input.headers, isActive: input.isActive, createdAt: at, updatedAt: at };
    db.webhooks.push(hook);
    audit(c, { action: 'webhook.created', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name, after: { url: hook.url, events: hook.events } });
    // Shown once and not stored: nothing in guest mode ever signs a request with it.
    return created({ ...hook, secret: newSecret() });
  });

  r.patch(`${hooks}/:webhookId`, (c) => {
    const input = parse(webhookInput.partial(), c.body);
    const hook = findHook(c);
    if (input.url && input.url !== hook.url) checkUrl(input.url);
    const before = { url: hook.url, events: hook.events, isActive: hook.isActive };
    hook.name = input.name ?? hook.name;
    hook.url = input.url ?? hook.url;
    hook.events = input.events ? [...new Set(input.events)] : hook.events;
    hook.headers = input.headers ?? hook.headers;
    hook.isActive = input.isActive ?? hook.isActive;
    hook.updatedAt = nowIso();
    audit(c, { action: 'webhook.updated', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name, before, after: { url: hook.url, events: hook.events, isActive: hook.isActive } });
    return hook;
  });

  r.post(`${hooks}/:webhookId/rotate-secret`, (c) => {
    const hook = findHook(c);
    audit(c, { action: 'webhook.secret_rotated', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name });
    return { secret: newSecret() };
  });

  r.post(`${hooks}/:webhookId/test`, (c) => {
    const hook = findHook(c);
    if (!hook.isActive) throw badRequest('Enable the webhook before sending a test');
    const { environment, project } = envScope(c);
    const payload = {
      id: newId(),
      event: 'ping',
      organization: db.organization.slug,
      project: project.slug,
      projectId: project.id,
      environment: environment.key,
      environmentId: environment.id,
      message: 'Test delivery from Meridian. If you can verify this signature, your endpoint is ready.',
      timestamp: nowIso(),
    };
    return new Reply(202, { deliveryId: simulateDelivery(hook.id, 'ping', payload) });
  });

  r.delete(`${hooks}/:webhookId`, (c) => {
    const hook = findHook(c);
    db.webhooks = db.webhooks.filter((h) => h.id !== hook.id);
    db.deliveries = db.deliveries.filter((d) => d.webhookId !== hook.id);
    audit(c, { action: 'webhook.deleted', resourceType: 'webhook', resourceId: hook.id, resourceLabel: hook.name, before: { url: hook.url } });
    return noContent();
  });

  r.get(`${hooks}/:webhookId/deliveries`, (c) => {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: z.enum(['PENDING', 'RETRYING', 'SUCCESS', 'FAILED']).optional() }), c.query);
    const hook = findHook(c);
    const rows = db.deliveries.filter((d) => d.webhookId === hook.id && (!q.status || d.status === q.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return paginate(rows, q.page, q.pageSize);
  });

  r.post(`${hooks}/:webhookId/deliveries/:deliveryId/redeliver`, (c) => {
    const hook = findHook(c);
    const original = db.deliveries.find((d) => d.id === c.params.deliveryId && d.webhookId === hook.id);
    if (!original) throw notFound('Delivery');
    return new Reply(202, { deliveryId: simulateDelivery(hook.id, original.event, { ...original.payload, redeliveryOf: original.id }) });
  });
}
