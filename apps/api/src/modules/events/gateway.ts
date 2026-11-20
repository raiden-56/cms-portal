import type { Server } from 'node:http';
import type { Redis } from 'ioredis';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ContentEvent } from '@meridian/shared';
import { sha256 } from '../../lib/crypto';
import { createRedisConnection, logger, prisma } from '../../lib/infra';
import { EVENTS_CHANNEL } from './events.service';

interface Client {
  socket: WebSocket;
  environmentId: string | null;
  alive: boolean;
}

const clients = new Set<Client>();
let wss: WebSocketServer | null = null;
let subscriber: Redis | null = null;
let heartbeat: NodeJS.Timeout | null = null;

const send = (socket: WebSocket, message: unknown) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

async function authenticate(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !token.startsWith('mrd_')) return null;
  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { environmentId: true, revokedAt: true, expiresAt: true, project: { select: { deletedAt: true } } },
  });
  if (!record || record.revokedAt || record.project.deletedAt || (record.expiresAt && record.expiresAt < new Date())) return null;
  return record.environmentId;
}

/**
 * Real-time event stream for connected applications.
 *
 *   ws://host/api/v1/events
 *   → { "type": "auth", "token": "mrd_ro_…" }      (first message, within 10 seconds)
 *   ← { "type": "ready", "environmentId": "…" }
 *   ← { "type": "event", "data": { "event": "content.published", … } }
 *
 * The token travels in a message rather than the URL so it never lands in access logs.
 * Events reach every API instance through Redis pub/sub.
 */
export function attachEventGateway(server: Server) {
  wss = new WebSocketServer({ server, path: '/api/v1/events', maxPayload: 16 * 1024 });

  wss.on('connection', (socket) => {
    const client: Client = { socket, environmentId: null, alive: true };
    clients.add(client);
    const authTimeout = setTimeout(() => {
      if (!client.environmentId) socket.close(4401, 'Authentication timeout');
    }, 10_000);

    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('message', async (raw) => {
      let message: { type?: string; token?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return send(socket, { type: 'error', message: 'Messages must be JSON' });
      }
      if (message.type === 'auth' && !client.environmentId) {
        const environmentId = await authenticate(message.token).catch(() => null);
        if (!environmentId) {
          send(socket, { type: 'error', message: 'Invalid API token' });
          return socket.close(4401, 'Invalid API token');
        }
        client.environmentId = environmentId;
        clearTimeout(authTimeout);
        send(socket, { type: 'ready', environmentId });
      } else if (message.type === 'ping') {
        send(socket, { type: 'pong' });
      }
    });
    socket.on('close', () => {
      clearTimeout(authTimeout);
      clients.delete(client);
    });
    socket.on('error', () => clients.delete(client));
  });

  subscriber = createRedisConnection();
  subscriber.subscribe(EVENTS_CHANNEL).catch((err) => logger.error({ err: err.message }, 'event subscription failed'));
  subscriber.on('message', (_channel, payload) => {
    let event: ContentEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    for (const client of clients) {
      // Strict tenant isolation: a socket only ever receives events of the environment its token belongs to.
      if (client.environmentId === event.environmentId) send(client.socket, { type: 'event', data: event });
    }
  });

  heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }, 30_000);
  heartbeat.unref();
}

export const connectedClients = () => [...clients].filter((c) => c.environmentId).length;

export async function closeEventGateway() {
  if (heartbeat) clearInterval(heartbeat);
  for (const client of clients) client.socket.terminate();
  clients.clear();
  await Promise.allSettled([subscriber?.quit(), new Promise<void>((resolve) => (wss ? wss.close(() => resolve()) : resolve()))]);
  subscriber = null;
  wss = null;
}
