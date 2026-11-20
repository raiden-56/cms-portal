import type { Metadata } from 'next';
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';
import { createCMSClient } from '@meridian/sdk';
import { Blocks } from '../../components/Blocks';
import { cms } from '../../lib/cms';

type Props = { params: Promise<{ slug?: string[] }>; searchParams: Promise<{ previewToken?: string }> };

async function loadPage(slug: string[] | undefined, previewToken?: string) {
  const { isEnabled } = await draftMode();
  if (isEnabled && previewToken) {
    // Draft preview: the signed token unlocks exactly one entry, no API key involved.
    const preview = createCMSClient({ baseURL: process.env.MERIDIAN_URL!, cache: false });
    return (await preview.preview(previewToken, { richtext: 'html' })) as Awaited<ReturnType<typeof cms.pages.getByPath>>;
  }
  // `richtext: 'html'` asks Meridian to render rich-text fields to sanitized HTML.
  return cms.pages.getByPath(`/${(slug ?? []).join('/')}`, { richtext: 'html' });
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const page = await loadPage((await params).slug, (await searchParams).previewToken);
  if (!page) return {};
  const { seo } = page;
  return {
    title: seo.title ?? page.title,
    description: seo.description ?? page.description ?? undefined,
    alternates: seo.canonicalUrl ? { canonical: seo.canonicalUrl } : undefined,
    robots: { index: !seo.noIndex, follow: !seo.noFollow },
    openGraph: {
      title: seo.ogTitle ?? seo.title ?? page.title,
      description: seo.ogDescription ?? seo.description,
      images: seo.ogImage ? [cms.media.url(seo.ogImage, { w: 1200, h: 630, fit: 'cover', format: 'jpeg' })] : undefined,
    },
    twitter: { card: seo.twitterCard ?? 'summary_large_image' },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const page = await loadPage((await params).slug, (await searchParams).previewToken);
  if (!page) notFound();
  return (
    <main data-template={page.template}>
      {page.seo.jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(page.seo.jsonLd) }} /> : null}
      <Blocks blocks={page.blocks} />
    </main>
  );
}
