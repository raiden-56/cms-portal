/**
 * Webhook verification for Meridian events.
 *
 * Every delivery carries:
 *   X-Meridian-Signature   sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 *   X-Meridian-Timestamp   unix seconds when it was signed
 *   X-Meridian-Delivery    stable id across retries — use it to de-duplicate
 *   X-Meridian-Event       event name, e.g. content.published
 *
 * Uses the Web Crypto API, so it works in Node 18+, edge runtimes and Deno.
 */

export interface WebhookHeaders {
  signature: string | null | undefined;
  timestamp: string | null | undefined;
}

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison, so response timing reveals nothing about the expected value. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(input: {
  /** The raw request body, exactly as received. Do not re-serialise parsed JSON. */
  payload: string;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  secret: string;
  /** Reject deliveries signed longer ago than this, to stop replays. Default 300 seconds. */
  toleranceSeconds?: number;
}): Promise<boolean> {
  const { payload, signature, timestamp, secret } = input;
  if (!signature || !timestamp || !secret) return false;
  const signedAt = Number(timestamp);
  if (!Number.isFinite(signedAt)) return false;
  const tolerance = input.toleranceSeconds ?? 300;
  if (tolerance > 0 && Math.abs(Date.now() / 1000 - signedAt) > tolerance) return false;

  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  return safeEqual(`sha256=${toHex(mac)}`, signature.trim());
}

/**
 * Verifies a fetch-style Request (Next.js route handlers, Remix, Hono, Cloudflare Workers…)
 * and returns the event. Throws when the signature is missing, wrong or too old.
 */
export async function parseWebhook<T = Record<string, unknown>>(request: Request, secret: string, options: { toleranceSeconds?: number } = {}): Promise<{ event: T; deliveryId: string | null; eventName: string | null }> {
  const payload = await request.text();
  const ok = await verifyWebhookSignature({
    payload,
    signature: request.headers.get('x-meridian-signature'),
    timestamp: request.headers.get('x-meridian-timestamp'),
    secret,
    toleranceSeconds: options.toleranceSeconds,
  });
  if (!ok) throw new Error('Invalid Meridian webhook signature');
  return {
    event: JSON.parse(payload) as T,
    deliveryId: request.headers.get('x-meridian-delivery'),
    eventName: request.headers.get('x-meridian-event'),
  };
}
