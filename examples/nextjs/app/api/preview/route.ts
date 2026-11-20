import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCMSClient } from '@meridian/sdk';

/**
 * Target of the project's preview URL: /api/preview?token={token}&path={path}
 * The token is short-lived and unlocks the draft of exactly one entry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const path = url.searchParams.get('path') || '/';
  if (!token) return new Response('Missing preview token', { status: 400 });

  // Prove the token is genuine before switching this visitor into draft mode.
  const cms = createCMSClient({ baseURL: process.env.MERIDIAN_URL!, cache: false });
  try {
    await cms.preview(token);
  } catch {
    return new Response('This preview link is invalid or has expired', { status: 401 });
  }

  (await draftMode()).enable();
  // Only ever redirect to a path on this site.
  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  redirect(`${safePath}?previewToken=${encodeURIComponent(token)}`);
}
