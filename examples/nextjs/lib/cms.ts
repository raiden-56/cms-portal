import { createCMSClient } from '@meridian/sdk';

/**
 * Server-side client. Next.js caches these fetches indefinitely under the `cms` tag;
 * the revalidate route clears the tag when Meridian reports a change, so pages are
 * static-fast and still update the moment an editor publishes.
 */
export const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY,
  // Let Next.js own caching; the SDK's in-memory cache would outlive revalidation.
  cache: false,
  fetchOptions: { next: { tags: ['cms'] } },
});
