# Next.js example

A reference integration for the Next.js App Router. Copy these files into a Next.js 14+ project; they are deliberately few and small.

| File | What it shows |
| --- | --- |
| `lib/cms.ts` | One shared client, tagged for on-demand revalidation |
| `app/[[...slug]]/page.tsx` | Resolving any URL to a Meridian page, with metadata from its SEO fields |
| `components/Blocks.tsx` | Mapping block `type` to your own components |
| `app/api/revalidate/route.ts` | Verifying a Meridian webhook and revalidating what changed |
| `app/api/preview/route.ts` | Draft preview from the admin's "Preview" button |

## Setup

```bash
npm install @meridian/sdk
```

`.env.local`:

```
MERIDIAN_URL=http://localhost:4000
MERIDIAN_API_KEY=mrd_ro_…            # read-only key: Developers → API Keys
MERIDIAN_WEBHOOK_SECRET=whsec_…      # shown once when you create the webhook
```

In Meridian:

1. **Developers → Webhooks → New webhook** — URL `https://your-site/api/revalidate`, events `content.published`, `content.unpublished`, `page.published`, `page.unpublished`, `release.published`.
2. **Settings → Project → Preview URL** — `https://your-site/api/preview?token={token}&path={path}`.

Published changes then appear on the site without a redeploy: Meridian serves the new content immediately, and the webhook tells Next.js which cached pages to regenerate.
