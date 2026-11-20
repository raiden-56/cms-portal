import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { flushUsage } from '../src/modules/analytics/usage';
import { attachEventGateway, closeEventGateway } from '../src/modules/events/gateway';
import { startWebhookWorker, stopWebhooks } from '../src/modules/webhooks/webhooks.service';
import request from 'supertest';
import {
  type ProjectFixture,
  type Session,
  app,
  as,
  createArticleType,
  createProject,
  createToken,
  expectedSignature,
  register,
  waitFor,
  webhookReceiver,
} from './helpers';

describe('real-time content distribution', () => {
  let session: Session;
  let project: ProjectFixture;
  let server: Server;
  let wsUrl: string;

  beforeAll(async () => {
    session = await register();
    project = await createProject(session);
    await createArticleType(session, project);
    startWebhookWorker();
    server = createServer(app);
    attachEventGateway(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    wsUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/events`;
  });

  afterAll(async () => {
    await closeEventGateway();
    await stopWebhooks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const publishArticle = async (title: string) => {
    const entry = await as(session).post(`${project.base}/entries/articles`, { data: { title } }).expect(201);
    await as(session).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(200);
    return entry.body as { id: string; documentId: string };
  };

  it('delivers a signed webhook when content is published', async () => {
    const receiver = await webhookReceiver();
    const hook = await as(session)
      .post(`${project.base}/webhooks`, { name: 'Next.js revalidate', url: receiver.url, events: ['content.published', 'content.unpublished'], headers: { 'X-Site': 'marketing' } })
      .expect(201);
    expect(hook.body.secret).toMatch(/^whsec_/);
    expect(hook.body).not.toHaveProperty('secretEnc');

    const entry = await publishArticle('Webhook me');
    const call = await waitFor(() => receiver.received[0]);

    expect(call.json).toMatchObject({
      event: 'content.published',
      project: project.slug,
      environment: 'production',
      contentType: 'articles',
      documentId: entry.documentId,
      slug: 'webhook-me',
    });
    expect(call.json.timestamp).toBeTruthy();
    expect(call.headers['x-meridian-event']).toBe('content.published');
    expect(call.headers['x-site']).toBe('marketing');
    // The signature covers the timestamp and the exact body, using the secret shown at creation.
    const timestamp = call.headers['x-meridian-timestamp'] as string;
    expect(call.headers['x-meridian-signature']).toBe(expectedSignature(hook.body.secret, timestamp, call.body));

    // Only subscribed events are sent: saving a draft does not call this webhook.
    await as(session).post(`${project.base}/entries/articles`, { data: { title: 'Just a draft' } }).expect(201);
    await new Promise((r) => setTimeout(r, 300));
    expect(receiver.received).toHaveLength(1);

    const deliveries = await waitFor(async () => {
      const res = await as(session).get(`${project.base}/webhooks/${hook.body.id}/deliveries`).expect(200);
      return res.body.items[0]?.status === 'SUCCESS' ? res.body : null;
    });
    expect(deliveries.items[0]).toMatchObject({ event: 'content.published', status: 'SUCCESS', attempts: 1, responseStatus: 200 });
    await receiver.close();
  });

  it('retries failed deliveries with the same delivery id, and records the outcome', async () => {
    const receiver = await webhookReceiver({ failFirst: 2 });
    const hook = await as(session).post(`${project.base}/webhooks`, { name: 'Flaky', url: receiver.url, events: ['content.published'] }).expect(201);
    await publishArticle('Retry me');

    await waitFor(() => receiver.received.length >= 3, 15000);
    const ids = receiver.received.map((r) => r.headers['x-meridian-delivery']);
    // Same idempotency key on every attempt, so receivers can de-duplicate.
    expect(new Set(ids).size).toBe(1);
    const done = await waitFor(async () => {
      const res = await as(session).get(`${project.base}/webhooks/${hook.body.id}/deliveries`).expect(200);
      return res.body.items[0]?.status === 'SUCCESS' ? res.body.items[0] : null;
    });
    expect(done.attempts).toBe(3);
    await receiver.close();
  });

  it('marks a delivery failed after the last attempt, supports redelivery and secret rotation', async () => {
    const receiver = await webhookReceiver({ failFirst: 3 });
    const hook = await as(session).post(`${project.base}/webhooks`, { name: 'Down', url: receiver.url, events: ['content.published'] }).expect(201);
    await publishArticle('Will fail');

    const failed = await waitFor(async () => {
      const res = await as(session).get(`${project.base}/webhooks/${hook.body.id}/deliveries?status=FAILED`).expect(200);
      return res.body.items[0] ?? null;
    }, 15000);
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 3, responseStatus: 503 });
    expect(failed.error).toMatch(/503/);

    const rotated = await as(session).post(`${project.base}/webhooks/${hook.body.id}/rotate-secret`, {}).expect(200);
    expect(rotated.body.secret).not.toBe(hook.body.secret);

    // The endpoint has recovered; redelivering sends the same event, signed with the new secret.
    await as(session).post(`${project.base}/webhooks/${hook.body.id}/deliveries/${failed.id}/redeliver`, {}).expect(202);
    await waitFor(() => receiver.received.length >= 4);
    const last = receiver.received[receiver.received.length - 1];
    expect(last.json.id).toBe(failed.eventId);
    expect(last.headers['x-meridian-signature']).toBe(expectedSignature(rotated.body.secret, last.headers['x-meridian-timestamp'] as string, last.body));
    await receiver.close();
  });

  it('validates webhook configuration', async () => {
    await as(session).post(`${project.base}/webhooks`, { name: 'Bad', url: 'ftp://example.com/x', events: ['content.published'] }).expect(400);
    await as(session).post(`${project.base}/webhooks`, { name: 'Bad', url: 'https://user:pw@example.com/x', events: ['content.published'] }).expect(400);
    await as(session).post(`${project.base}/webhooks`, { name: 'Bad', url: 'https://example.com/x', events: ['content.exploded'] }).expect(422);
    await as(session).post(`${project.base}/webhooks`, { name: 'Bad', url: 'https://example.com/x', events: ['content.published'], headers: { 'X-Meridian-Signature': 'forged' } }).expect(422);
  });

  it('pushes events over WebSocket only to clients of the same environment', async () => {
    const prodToken = await createToken(session, project, 'READ_ONLY', 'production');
    const stagingToken = await createToken(session, project, 'READ_ONLY', 'staging');

    const connect = (token: string) =>
      new Promise<{ socket: WebSocket; events: Record<string, unknown>[] }>((resolve, reject) => {
        const socket = new WebSocket(wsUrl);
        const events: Record<string, unknown>[] = [];
        socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
        socket.on('message', (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.type === 'ready') resolve({ socket, events });
          if (message.type === 'event') events.push(message.data);
          if (message.type === 'error') reject(new Error(message.message));
        });
        socket.on('error', reject);
      });

    const prod = await connect(prodToken);
    const staging = await connect(stagingToken);
    await expect(connect('mrd_ro_invalid')).rejects.toThrow(/Invalid API token/);

    const entry = await publishArticle('Live update');
    const event = await waitFor(() => prod.events.find((e) => e.event === 'content.published'));
    expect(event).toMatchObject({ contentType: 'articles', documentId: entry.documentId, environment: 'production' });
    await new Promise((r) => setTimeout(r, 200));
    expect(staging.events).toHaveLength(0);
    prod.socket.close();
    staging.socket.close();
  });

  it('records real API usage for analytics and the dashboard', async () => {
    const token = await createToken(session, project);
    for (let i = 0; i < 3; i += 1) await request(app).get('/api/v1/articles').set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).get('/api/v1/nonexistent-type').set('Authorization', `Bearer ${token}`).expect(404);
    await flushUsage();

    const analytics = await as(session).get(`${project.base}/analytics?days=7`).expect(200);
    expect(analytics.body.totals.requests).toBeGreaterThanOrEqual(4);
    expect(analytics.body.totals.errors).toBeGreaterThanOrEqual(1);
    expect(analytics.body.byResource.find((r: { resource: string }) => r.resource === 'articles').requests).toBeGreaterThanOrEqual(3);

    const dashboard = await as(session).get(`${project.base}/dashboard`).expect(200);
    expect(dashboard.body.counts.apiRequests24h).toBeGreaterThanOrEqual(4);
    expect(dashboard.body.counts.published).toBeGreaterThanOrEqual(4);
    expect(dashboard.body.health.database.ok).toBe(true);
    expect(dashboard.body.health.cache.ok).toBe(true);
    expect(dashboard.body.publishingActivity).toHaveLength(14);
    expect(dashboard.body.publishingActivity.at(-1).published).toBeGreaterThanOrEqual(4);
  });

  it('writes a searchable, exportable audit trail with before and after values', async () => {
    const entry = await as(session).post(`${project.base}/entries/articles`, { data: { title: 'Audited' } }).expect(201);
    await as(session).put(`${project.base}/entry/${entry.body.id}`, { data: { title: 'Audited (edited)' }, lockVersion: 1 }).expect(200);
    const logs = await as(session).get(`/admin/api/orgs/${session.orgId}/audit-logs?search=Audited&action=entry.updated`).expect(200);
    expect(logs.body.items[0]).toMatchObject({ action: 'entry.updated', actorType: 'user', resourceType: 'entry' });
    expect(logs.body.items[0].before.title).toBe('Audited');
    expect(logs.body.items[0].after.title).toBe('Audited (edited)');
    expect(logs.body.items[0].ip).toBeTruthy();

    const csv = await as(session).get(`/admin/api/orgs/${session.orgId}/audit-logs?format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toBe('timestamp,actor,actorType,action,resourceType,resourceId,resource,projectId,environmentId,ip,before,after');
    expect(csv.text).toContain('entry.published');
  });
});
