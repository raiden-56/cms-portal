import { revalidatePath, revalidateTag } from 'next/cache';
import { parseWebhook } from '@meridian/sdk/webhooks';

interface MeridianEvent {
  event: string;
  contentType?: string;
  path?: string | null;
  documents?: { contentType: string; path?: string | null }[];
}

// Deliveries are retried with the same id; remember recent ones so a retry is a no-op.
const seen = new Set<string>();

export async function POST(request: Request) {
  let hook: Awaited<ReturnType<typeof parseWebhook<MeridianEvent>>>;
  try {
    // Verifies the HMAC signature and rejects deliveries older than five minutes.
    hook = await parseWebhook<MeridianEvent>(request, process.env.MERIDIAN_WEBHOOK_SECRET!);
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }
  if (hook.deliveryId) {
    if (seen.has(hook.deliveryId)) return Response.json({ revalidated: false, duplicate: true });
    seen.add(hook.deliveryId);
    if (seen.size > 1000) seen.delete(seen.values().next().value as string);
  }

  // Everything fetched through lib/cms.ts carries the `cms` tag.
  revalidateTag('cms');
  // Regenerate the exact pages that changed right away, rather than on their next visit.
  const paths = [hook.event.path, ...(hook.event.documents ?? []).map((d) => d.path)].filter((p): p is string => !!p);
  for (const path of new Set(paths)) revalidatePath(path);

  return Response.json({ revalidated: true, paths });
}
