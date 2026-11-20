import { type ReactNode, memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import { type BlockDefinition, type BlockNode, type FieldDef, isRichTextEmpty, renderRichTextToHtml } from '@meridian/shared';
import { proseSx } from '@/features/fields/CodeEditor';
import { api } from '@/lib/api';
import type { EntrySummary, MediaAsset, Page } from '@/lib/types';
import type { Device } from './editorSlice';

/**
 * Admin-side rendering of page blocks.
 *
 * This is the studio's own "frontend": a neutral, light site skin so editors can see
 * structure and content while they work. The stored data stays framework-neutral — a
 * connected application renders the same block tree with its own components.
 */

/** Fixed light palette: the canvas looks like a website, whatever theme the studio uses. */
export const SITE = {
  surface: '#FFFFFF',
  soft: '#F5F4F1',
  line: '#E6E4DF',
  ink: '#1C1C1A',
  muted: '#5E5C56',
  faint: '#9A978F',
  accent: '#1F6F5C',
  accentSoft: '#E8F2EE',
};

const SITE_FONT = '"Geist Variable", "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface PreviewContext {
  device: Device;
  assets: Map<string, MediaAsset>;
  registry: Record<string, BlockDefinition>;
  componentFields: Record<string, FieldDef[]>;
  typeIds: Set<string>;
  envBase: string;
  envId: string;
  pagePath: string;
  pageTitle: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const list = <T extends Record<string, unknown>>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as T[]) : []);

/** Full-size delivery URL for an asset; raster images are resized by the media service. */
export function imageUrl(asset: MediaAsset | undefined, width = 1280): string | null {
  if (!asset || asset.kind !== 'image') return null;
  if (asset.mimeType === 'image/svg+xml' || asset.mimeType === 'image/gif') return asset.url;
  return `${asset.url}?w=${width}&fit=inside&format=webp&q=78`;
}

function Missing({ label, ratio = '16 / 9', icon, radius = 10 }: { label: string; ratio?: string; icon?: ReactNode; radius?: number }) {
  return (
    <Box sx={{ aspectRatio: ratio, width: '100%', borderRadius: `${radius}px`, border: `1.5px dashed ${SITE.line}`, bgcolor: SITE.soft, color: SITE.faint, display: 'grid', placeItems: 'center', fontSize: 13 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, '& svg': { fontSize: 22 } }}>
        {icon ?? <ImageOutlined />}
        {label}
      </Box>
    </Box>
  );
}

function Img({ asset, ratio, radius = 10, width = 1280, fit = 'cover', alt }: { asset: MediaAsset | undefined; ratio?: string; radius?: number; width?: number; fit?: 'cover' | 'contain'; alt?: string }) {
  const src = imageUrl(asset, width);
  if (!src) return <Missing label={asset ? asset.filename : 'No image selected'} ratio={ratio ?? '16 / 9'} radius={radius} />;
  return (
    <Box
      component="img"
      src={src}
      alt={alt || asset?.alt || ''}
      loading="lazy"
      draggable={false}
      sx={{ display: 'block', width: '100%', height: ratio ? undefined : 'auto', aspectRatio: ratio, objectFit: fit, borderRadius: `${radius}px`, bgcolor: SITE.soft }}
    />
  );
}

function Avatar({ asset, name, size = 44 }: { asset: MediaAsset | undefined; name: string; size?: number }) {
  const src = imageUrl(asset, size * 3);
  return src ? (
    <Box component="img" src={src} alt="" draggable={false} sx={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  ) : (
    <Box sx={{ width: size, height: size, borderRadius: '50%', bgcolor: SITE.accentSoft, color: SITE.accent, display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: size * 0.38, flexShrink: 0 }}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </Box>
  );
}

function Btn({ label, variant = 'primary' }: { label: string; variant?: 'primary' | 'secondary' | 'link' }) {
  if (!label) return null;
  if (variant === 'link') return <Box component="span" sx={{ color: SITE.accent, fontWeight: 600, fontSize: '0.9375em' }}>{label} →</Box>;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 42,
        px: '20px',
        borderRadius: '8px',
        fontSize: 15,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        ...(variant === 'primary' ? { bgcolor: SITE.ink, color: '#fff' } : { border: `1px solid ${SITE.line}`, bgcolor: SITE.surface, color: SITE.ink }),
      }}
    >
      {label}
    </Box>
  );
}

const H1: SxProps<Theme> = { fontSize: 'var(--site-h1)', fontWeight: 'var(--site-hw)', letterSpacing: '-0.028em', lineHeight: 1.08, m: 0, overflowWrap: 'anywhere' };
const H2: SxProps<Theme> = { fontSize: 'var(--site-h2)', fontWeight: 'var(--site-hw)', letterSpacing: '-0.02em', lineHeight: 1.18, m: 0, overflowWrap: 'anywhere' };
const H3: SxProps<Theme> = { fontSize: '1.125em', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3, m: 0, overflowWrap: 'anywhere' };
const LEAD: SxProps<Theme> = { fontSize: '1.125em', lineHeight: 1.55, opacity: 0.72, m: 0, whiteSpace: 'pre-line' };
const BODY: SxProps<Theme> = { lineHeight: 1.6, opacity: 0.72, m: 0, whiteSpace: 'pre-line' };
const GRID: SxProps<Theme> = { display: 'grid', gridTemplateColumns: 'repeat(var(--site-cols), minmax(0, 1fr))', gap: '24px' };
const CARD: SxProps<Theme> = { border: `1px solid ${SITE.line}`, borderRadius: '12px', p: '20px', bgcolor: SITE.surface, color: SITE.ink, textAlign: 'left', minWidth: 0 };

function Head({ heading, sub }: { heading: string; sub?: string }) {
  if (!heading && !sub) return null;
  return (
    <Box sx={{ mb: '32px' }}>
      {heading && <Box component="h2" sx={H2}>{heading}</Box>}
      {sub && <Box component="p" sx={{ ...LEAD, mt: '10px', maxWidth: 640, marginInline: 'var(--site-mx)' } as SxProps<Theme>}>{sub}</Box>}
    </Box>
  );
}

function EmptyItems({ label }: { label: string }) {
  return (
    <Box sx={{ border: `1.5px dashed ${SITE.line}`, borderRadius: '10px', p: '24px', textAlign: 'center', color: SITE.faint, fontSize: 14 }}>{label}</Box>
  );
}

function Prose({ doc }: { doc: unknown }) {
  const html = useMemo(() => renderRichTextToHtml(doc), [doc]);
  if (isRichTextEmpty(doc)) return null;
  // The renderer re-sanitizes the stored document, so its output is safe to inject.
  return <Box sx={{ ...proseSx, fontSize: '1em', color: 'inherit', '& a': { color: SITE.accent, textDecoration: 'underline', pointerEvents: 'none' }, '& blockquote': { m: 0, my: 3, pl: 4, borderLeft: `3px solid ${SITE.line}`, opacity: 0.8 } } as SxProps<Theme>} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Stars({ value, max = 5 }: { value: unknown; max?: number }) {
  const n = typeof value === 'number' ? Math.round(value) : 0;
  if (!n) return null;
  return (
    <Box aria-label={`${n} out of ${max}`} sx={{ color: '#B4721A', letterSpacing: '2px', fontSize: 14 }}>
      {'★'.repeat(Math.min(max, n))}
      <Box component="span" sx={{ color: SITE.line }}>{'★'.repeat(Math.max(0, max - n))}</Box>
    </Box>
  );
}

function Listing({ node, ctx, noun }: { node: BlockNode; ctx: PreviewContext; noun: string }) {
  const p = node.props;
  const typeId = str(p.contentType).trim();
  const limit = typeof p.limit === 'number' && p.limit > 0 ? Math.min(24, p.limit) : 6;
  const sort = p.sort === 'oldest' ? 'createdAt' : p.sort === 'title' ? 'title' : '-createdAt';
  const exists = !!typeId && ctx.typeIds.has(typeId);
  const query = useQuery({
    queryKey: ['entries', ctx.envId, typeId, 'block-preview', limit, sort],
    queryFn: () => api.get<Page<EntrySummary>>(`${ctx.envBase}/entries/${typeId}`, { pageSize: limit, sort }),
    enabled: exists,
    staleTime: 60_000,
  });
  const items = query.data?.items ?? [];
  const asList = p.layout === 'list';
  const excerptOf = (entry: EntrySummary) => {
    const data = entry.data ?? {};
    for (const key of ['excerpt', 'summary', 'description', 'tagline']) if (typeof data[key] === 'string' && data[key]) return String(data[key]);
    return '';
  };
  return (
    <Box>
      <Head heading={str(p.heading)} />
      {!typeId ? (
        <EmptyItems label={`Choose the content type this ${noun} listing shows.`} />
      ) : !exists ? (
        <EmptyItems label={`Content type “${typeId}” does not exist in this environment.`} />
      ) : query.isLoading ? (
        <Box sx={asList ? { display: 'grid', gap: '12px' } : GRID}>
          {Array.from({ length: Math.min(limit, 3) }, (_, i) => (
            <Box key={i} sx={{ ...CARD, height: 96, bgcolor: SITE.soft, borderColor: 'transparent' } as SxProps<Theme>} />
          ))}
        </Box>
      ) : query.isError ? (
        <EmptyItems label="These entries could not be loaded for the preview." />
      ) : items.length === 0 ? (
        <EmptyItems label={`No ${typeId} yet. Entries appear here as they are created.`} />
      ) : (
        <Box sx={asList ? { display: 'grid', gap: '12px' } : GRID}>
          {items.map((entry) => {
            const price = entry.data?.price;
            return (
              <Box key={entry.id} sx={CARD}>
                <Box component="h3" sx={H3}>{entry.title ?? 'Untitled'}</Box>
                {typeof price === 'number' && <Box sx={{ mt: '6px', fontWeight: 600 }}>{price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Box>}
                {p.showExcerpt !== false && excerptOf(entry) && <Box component="p" sx={{ ...BODY, mt: '8px', fontSize: '0.9375em' } as SxProps<Theme>}>{excerptOf(entry)}</Box>}
                {!entry.isPublished && <Box sx={{ mt: '10px', fontSize: 12, color: SITE.faint }}>Draft — not on the live site yet</Box>}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function PreviewBody({ node, def, ctx }: { node: BlockNode; def: BlockDefinition; ctx: PreviewContext }) {
  const p = node.props ?? {};
  const asset = (id: unknown) => (typeof id === 'string' ? ctx.assets.get(id) : undefined);
  const stacked = ctx.device === 'mobile';

  switch (node.type) {
    case 'hero': {
      const layout = str(p.layout) || 'centered';
      const image = asset(p.image);
      const copy = (
        <Box sx={{ minWidth: 0 }}>
          {str(p.eyebrow) && <Box sx={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: layout === 'background' && image ? 'inherit' : SITE.accent, mb: '14px' }}>{str(p.eyebrow)}</Box>}
          <Box component="h1" sx={H1}>{str(p.heading) || 'Add a heading'}</Box>
          {str(p.subheading) && <Box component="p" sx={{ ...LEAD, mt: '18px', maxWidth: 620, marginInline: layout === 'split' ? 0 : 'var(--site-mx)' } as SxProps<Theme>}>{str(p.subheading)}</Box>}
          {(str(p.primaryLabel) || str(p.secondaryLabel)) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px', mt: '28px', justifyContent: layout === 'split' ? 'flex-start' : 'var(--site-justify)' }}>
              <Btn label={str(p.primaryLabel)} />
              <Btn label={str(p.secondaryLabel)} variant="secondary" />
            </Box>
          )}
        </Box>
      );
      if (layout === 'split') {
        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: stacked ? '1fr' : '1fr 1fr', gap: stacked ? '28px' : '56px', alignItems: 'center', textAlign: 'left' }}>
            {copy}
            <Img asset={image} ratio="4 / 3" radius={14} />
          </Box>
        );
      }
      if (layout === 'background') {
        const src = imageUrl(image, 1600);
        return (
          <Box sx={{ position: 'relative', borderRadius: '14px', overflow: 'hidden', px: stacked ? '24px' : '64px', py: stacked ? '56px' : '96px', color: src ? '#fff' : 'inherit', bgcolor: src ? '#111' : SITE.soft }}>
            {src && <Box component="img" src={src} alt="" draggable={false} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} />}
            <Box sx={{ position: 'relative' }}>{copy}</Box>
            {!src && <Box sx={{ mt: '20px', fontSize: 13, color: SITE.faint }}>Choose an image to use as the background</Box>}
          </Box>
        );
      }
      return (
        <Box>
          {copy}
          {image && <Box sx={{ mt: '44px' }}><Img asset={image} ratio="21 / 9" radius={14} /></Box>}
        </Box>
      );
    }
    case 'text':
      return isRichTextEmpty(p.content) ? <EmptyItems label="Write this section’s text in the Content panel." /> : <Prose doc={p.content} />;
    case 'image': {
      const ratio = str(p.aspect) && p.aspect !== 'auto' ? str(p.aspect).replace(':', ' / ') : undefined;
      return (
        <Box component="figure" sx={{ m: 0 }}>
          <Img asset={asset(p.image)} ratio={ratio} alt={str(p.alt)} />
          {str(p.caption) && <Box component="figcaption" sx={{ mt: '10px', fontSize: 14, opacity: 0.65 }}>{str(p.caption)}</Box>}
        </Box>
      );
    }
    case 'video': {
      const embed = p.source === 'embed';
      const video = asset(p.video);
      const poster = imageUrl(asset(p.poster), 1280);
      return (
        <Box component="figure" sx={{ m: 0 }}>
          {embed && str(p.embedUrl) ? (
            <Box sx={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: '12px', overflow: 'hidden', bgcolor: '#111' }}>
              {/* Shown inert: the editor never runs or navigates embedded content. */}
              <Box component="iframe" src={str(p.embedUrl)} title="Embedded video" loading="lazy" sandbox="allow-scripts allow-same-origin allow-presentation" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none' }} />
            </Box>
          ) : !embed && video ? (
            <Box component="video" src={video.url} poster={poster ?? undefined} controls preload="metadata" sx={{ display: 'block', width: '100%', aspectRatio: '16 / 9', borderRadius: '12px', bgcolor: '#111' }} />
          ) : poster ? (
            <Box component="img" src={poster} alt="" draggable={false} sx={{ display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '12px' }} />
          ) : (
            <Missing label={embed ? 'Paste an embed URL' : 'No video selected'} icon={<MovieOutlined />} radius={12} />
          )}
          {str(p.caption) && <Box component="figcaption" sx={{ mt: '10px', fontSize: 14, opacity: 0.65 }}>{str(p.caption)}</Box>}
        </Box>
      );
    }
    case 'split': {
      const imageFirst = p.imagePosition === 'left';
      const text = (
        <Box sx={{ minWidth: 0, textAlign: 'left' }}>
          <Box component="h2" sx={H2}>{str(p.heading) || 'Add a heading'}</Box>
          <Box sx={{ mt: '14px', opacity: 0.8 }}><Prose doc={p.body} /></Box>
          {str(p.ctaLabel) && <Box sx={{ mt: '22px' }}><Btn label={str(p.ctaLabel)} /></Box>}
        </Box>
      );
      const picture = <Img asset={asset(p.image)} ratio="4 / 3" radius={14} />;
      return (
        <Box sx={{ display: 'grid', gridTemplateColumns: stacked ? '1fr' : '1fr 1fr', gap: stacked ? '24px' : '56px', alignItems: 'center' }}>
          {imageFirst && !stacked ? <>{picture}{text}</> : <>{text}{picture}</>}
        </Box>
      );
    }
    case 'feature-grid': {
      const items = list(p.items);
      return (
        <Box>
          <Head heading={str(p.heading)} sub={str(p.subheading)} />
          {items.length === 0 ? <EmptyItems label="Add features in the Content panel." /> : (
            <Box sx={GRID}>
              {items.map((item, i) => (
                <Box key={i} sx={{ textAlign: 'left', minWidth: 0 }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '9px', bgcolor: SITE.accentSoft, color: SITE.accent, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, mb: '14px', textTransform: 'uppercase' }}>{(str(item.icon) || str(item.title) || '•').slice(0, 2)}</Box>
                  <Box component="h3" sx={H3}>{str(item.title)}</Box>
                  {str(item.description) && <Box component="p" sx={{ ...BODY, mt: '6px', fontSize: '0.9375em' } as SxProps<Theme>}>{str(item.description)}</Box>}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'cards': {
      const items = list(p.items);
      return (
        <Box>
          <Head heading={str(p.heading)} />
          {items.length === 0 ? <EmptyItems label="Add cards in the Content panel." /> : (
            <Box sx={GRID}>
              {items.map((item, i) => (
                <Box key={i} sx={{ ...CARD, p: 0, overflow: 'hidden' } as SxProps<Theme>}>
                  {asset(item.image) && <Img asset={asset(item.image)} ratio="16 / 10" radius={0} width={720} />}
                  <Box sx={{ p: '20px' }}>
                    <Box component="h3" sx={H3}>{str(item.title)}</Box>
                    {str(item.description) && <Box component="p" sx={{ ...BODY, mt: '6px', fontSize: '0.9375em' } as SxProps<Theme>}>{str(item.description)}</Box>}
                    {str(item.linkLabel) && <Box sx={{ mt: '14px' }}><Btn label={str(item.linkLabel)} variant="link" /></Box>}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'testimonials': {
      const items = list(p.items);
      return (
        <Box>
          <Head heading={str(p.heading)} />
          {items.length === 0 ? <EmptyItems label="Add testimonials in the Content panel." /> : (
            <Box sx={GRID}>
              {items.map((item, i) => (
                <Box key={i} sx={CARD}>
                  <Stars value={item.rating} />
                  <Box component="blockquote" sx={{ m: 0, mt: '10px', fontSize: '1.0625em', lineHeight: 1.55 }}>“{str(item.quote)}”</Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', mt: '18px' }}>
                    <Avatar asset={asset(item.avatar)} name={str(item.author)} size={38} />
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ fontWeight: 600, fontSize: 14 }}>{str(item.author)}</Box>
                      {str(item.role) && <Box sx={{ fontSize: 13, color: SITE.muted }}>{str(item.role)}</Box>}
                    </Box>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'faq': {
      const items = list(p.items);
      return (
        <Box>
          <Head heading={str(p.heading)} />
          {items.length === 0 ? <EmptyItems label="Add questions in the Content panel." /> : (
            <Box sx={{ borderTop: `1px solid ${SITE.line}`, textAlign: 'left' }}>
              {items.map((item, i) => (
                <Box key={i} sx={{ borderBottom: `1px solid ${SITE.line}`, py: '18px' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontWeight: 600 }}>
                    <span>{str(item.question)}</span>
                    <Box component="span" sx={{ opacity: 0.45 }}>{i === 0 ? '–' : '+'}</Box>
                  </Box>
                  {i === 0 && str(item.answer) && <Box component="p" sx={{ ...BODY, mt: '10px' } as SxProps<Theme>}>{str(item.answer)}</Box>}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'pricing': {
      const plans = list(p.plans);
      return (
        <Box>
          <Head heading={str(p.heading)} sub={str(p.subheading)} />
          {plans.length === 0 ? <EmptyItems label="Add plans in the Content panel." /> : (
            <Box sx={GRID}>
              {plans.map((plan, i) => (
                <Box key={i} sx={{ ...CARD, p: '26px', borderColor: plan.highlighted ? SITE.accent : SITE.line, boxShadow: plan.highlighted ? `0 0 0 1px ${SITE.accent}` : 'none' } as SxProps<Theme>}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <Box component="h3" sx={H3}>{str(plan.name)}</Box>
                    {plan.highlighted === true && <Box sx={{ fontSize: 11, fontWeight: 600, px: '8px', py: '3px', borderRadius: '999px', bgcolor: SITE.accentSoft, color: SITE.accent }}>Popular</Box>}
                  </Box>
                  <Box sx={{ mt: '14px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                    <Box sx={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>{str(plan.price)}</Box>
                    {str(plan.period) && <Box sx={{ fontSize: 14, color: SITE.muted }}>{str(plan.period)}</Box>}
                  </Box>
                  {str(plan.description) && <Box component="p" sx={{ ...BODY, mt: '8px', fontSize: '0.9375em' } as SxProps<Theme>}>{str(plan.description)}</Box>}
                  {str(plan.features) && (
                    <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: '18px', display: 'grid', gap: '8px', fontSize: 14 }}>
                      {str(plan.features).split('\n').map((line) => line.trim()).filter(Boolean).map((line, j) => (
                        <Box component="li" key={j} sx={{ display: 'flex', gap: '8px' }}><Box component="span" sx={{ color: SITE.accent, fontWeight: 700 }}>✓</Box>{line}</Box>
                      ))}
                    </Box>
                  )}
                  {str(plan.ctaLabel) && <Box sx={{ mt: '22px' }}><Btn label={str(plan.ctaLabel)} variant={plan.highlighted ? 'primary' : 'secondary'} /></Box>}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'stats': {
      const items = list(p.items);
      return (
        <Box>
          <Head heading={str(p.heading)} />
          {items.length === 0 ? <EmptyItems label="Add statistics in the Content panel." /> : (
            <Box sx={GRID}>
              {items.map((item, i) => (
                <Box key={i} sx={{ minWidth: 0 }}>
                  <Box sx={{ fontSize: 'var(--site-h2)', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{str(item.value)}</Box>
                  <Box sx={{ mt: '6px', fontWeight: 500 }}>{str(item.label)}</Box>
                  {str(item.description) && <Box sx={{ mt: '2px', fontSize: 14, opacity: 0.65 }}>{str(item.description)}</Box>}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'logos': {
      const logos = list(p.logos);
      return (
        <Box>
          {str(p.heading) && <Box sx={{ fontSize: 14, fontWeight: 500, opacity: 0.6, mb: '20px' }}>{str(p.heading)}</Box>}
          {logos.length === 0 ? <EmptyItems label="Add logos in the Content panel." /> : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'var(--site-justify)', gap: '36px' }}>
              {logos.map((logo, i) => {
                const src = imageUrl(asset(logo.image), 320);
                return src ? <Box key={i} component="img" src={src} alt={str(logo.name)} draggable={false} sx={{ height: 34, maxWidth: 140, objectFit: 'contain', filter: 'grayscale(1)', opacity: 0.75 }} /> : <Box key={i} sx={{ fontWeight: 600, color: SITE.faint }}>{str(logo.name) || 'Logo'}</Box>;
              })}
            </Box>
          )}
        </Box>
      );
    }
    case 'gallery': {
      const ids = Array.isArray(p.images) ? (p.images as unknown[]) : [];
      return (
        <Box>
          <Head heading={str(p.heading)} />
          {ids.length === 0 ? <EmptyItems label="Choose images in the Content panel." /> : (
            <Box sx={GRID}>
              {ids.map((id, i) => <Img key={`${String(id)}-${i}`} asset={asset(id)} ratio={p.layout === 'masonry' && i % 3 === 0 ? '3 / 4' : '1 / 1'} width={720} />)}
            </Box>
          )}
        </Box>
      );
    }
    case 'cta':
      return (
        <Box sx={{ borderRadius: '16px', border: `1px solid ${SITE.line}`, px: stacked ? '24px' : '56px', py: stacked ? '36px' : '56px' }}>
          <Box component="h2" sx={H2}>{str(p.heading) || 'Add a heading'}</Box>
          {str(p.body) && <Box component="p" sx={{ ...LEAD, mt: '12px', maxWidth: 560, marginInline: 'var(--site-mx)' } as SxProps<Theme>}>{str(p.body)}</Box>}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px', mt: '26px', justifyContent: 'var(--site-justify)' }}>
            <Btn label={str(p.primaryLabel)} />
            <Btn label={str(p.secondaryLabel)} variant="secondary" />
          </Box>
        </Box>
      );
    case 'contact': {
      const rows = [['Email', str(p.email)], ['Phone', str(p.phone)], ['Address', str(p.address)]].filter(([, v]) => v);
      const field = (label: string, tall?: boolean) => (
        <Box>
          <Box sx={{ fontSize: 13, fontWeight: 500, mb: '6px' }}>{label}</Box>
          <Box sx={{ height: tall ? 96 : 40, borderRadius: '8px', border: `1px solid ${SITE.line}`, bgcolor: SITE.surface }} />
        </Box>
      );
      return (
        <Box sx={{ display: 'grid', gridTemplateColumns: p.showForm === true && !stacked ? '1fr 1fr' : '1fr', gap: '48px', textAlign: 'left' }}>
          <Box>
            <Box component="h2" sx={H2}>{str(p.heading) || 'Contact'}</Box>
            {str(p.body) && <Box component="p" sx={{ ...LEAD, mt: '12px' } as SxProps<Theme>}>{str(p.body)}</Box>}
            <Box sx={{ mt: '22px', display: 'grid', gap: '12px' }}>
              {rows.map(([label, value]) => (
                <Box key={label}>
                  <Box sx={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', opacity: 0.5 }}>{label}</Box>
                  <Box sx={{ whiteSpace: 'pre-line' }}>{value}</Box>
                </Box>
              ))}
            </Box>
          </Box>
          {p.showForm === true && (
            <Box sx={{ ...CARD, display: 'grid', gap: '14px' } as SxProps<Theme>}>
              {field('Name')}
              {field('Email')}
              {field('Message', true)}
              <Box><Btn label="Send message" /></Box>
            </Box>
          )}
        </Box>
      );
    }
    case 'team': {
      const members = list(p.members);
      return (
        <Box>
          <Head heading={str(p.heading)} sub={str(p.subheading)} />
          {members.length === 0 ? <EmptyItems label="Add team members in the Content panel." /> : (
            <Box sx={GRID}>
              {members.map((m, i) => (
                <Box key={i} sx={{ textAlign: 'left', minWidth: 0 }}>
                  {asset(m.photo) ? <Img asset={asset(m.photo)} ratio="1 / 1" radius={12} width={640} /> : <Box sx={{ aspectRatio: '1 / 1', borderRadius: '12px', bgcolor: SITE.accentSoft, color: SITE.accent, display: 'grid', placeItems: 'center', fontSize: 40, fontWeight: 600 }}>{(str(m.name)[0] ?? '?').toUpperCase()}</Box>}
                  <Box component="h3" sx={{ ...H3, mt: '14px' } as SxProps<Theme>}>{str(m.name)}</Box>
                  {str(m.role) && <Box sx={{ fontSize: 14, color: SITE.muted }}>{str(m.role)}</Box>}
                  {str(m.bio) && <Box component="p" sx={{ ...BODY, mt: '8px', fontSize: 14 } as SxProps<Theme>}>{str(m.bio)}</Box>}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    case 'blog-listing':
      return <Listing node={node} ctx={ctx} noun="blog" />;
    case 'product-listing':
      return <Listing node={node} ctx={ctx} noun="product" />;
    case 'breadcrumbs': {
      const sep = p.separator === 'chevron' ? '›' : p.separator === 'dot' ? '·' : '/';
      const segments = ctx.pagePath.split('/').filter(Boolean);
      const crumbs = [...(p.showHome !== false ? ['Home'] : []), ...segments.slice(0, -1).map((s) => s.replace(/-/g, ' ')), ctx.pageTitle || segments[segments.length - 1] || 'Home'];
      const trail = crumbs.filter((c, i) => !(i > 0 && c === 'Home' && segments.length === 0));
      return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: 14, textAlign: 'left' }}>
          {trail.map((crumb, i) => (
            <Box key={i} sx={{ display: 'flex', gap: '8px', textTransform: 'capitalize' }}>
              <Box component="span" sx={{ opacity: i === trail.length - 1 ? 1 : 0.6, fontWeight: i === trail.length - 1 ? 600 : 400 }}>{crumb}</Box>
              {i < trail.length - 1 && <Box component="span" sx={{ opacity: 0.35 }}>{sep}</Box>}
            </Box>
          ))}
        </Box>
      );
    }
    case 'navigation': {
      const links = list(p.links);
      const logo = imageUrl(asset(p.logo), 320);
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '28px', textAlign: 'left' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>
            {logo && <Box component="img" src={logo} alt="" draggable={false} sx={{ height: 28, maxWidth: 120, objectFit: 'contain' }} />}
            {str(p.brand) || (!logo && 'Brand')}
          </Box>
          {stacked ? (
            <Box sx={{ ml: 'auto', display: 'grid', gap: '4px' }} aria-label="Menu">
              {[0, 1, 2].map((i) => <Box key={i} sx={{ width: 20, height: 2, bgcolor: 'currentColor', borderRadius: 1 }} />)}
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', gap: '24px', ml: 'auto', fontSize: 15, fontWeight: 500 }}>
                {links.map((link, i) => <Box key={i} component="span" sx={{ opacity: 0.8 }}>{str(link.label)}</Box>)}
              </Box>
              <Btn label={str(p.ctaLabel)} />
            </>
          )}
        </Box>
      );
    }
    case 'footer': {
      const columns = list(p.columns);
      const logo = imageUrl(asset(p.logo), 320);
      return (
        <Box sx={{ textAlign: 'left' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: stacked ? '1fr' : `1.4fr repeat(${Math.max(1, columns.length)}, 1fr)`, gap: '36px' }}>
            <Box>
              {logo ? <Box component="img" src={logo} alt="" draggable={false} sx={{ height: 28, maxWidth: 140, objectFit: 'contain' }} /> : null}
              {str(p.tagline) && <Box component="p" sx={{ ...BODY, mt: logo ? '12px' : 0, maxWidth: 320 } as SxProps<Theme>}>{str(p.tagline)}</Box>}
            </Box>
            {columns.map((column, i) => (
              <Box key={i}>
                <Box sx={{ fontSize: 13, fontWeight: 600, mb: '12px' }}>{str(column.title)}</Box>
                <Box sx={{ display: 'grid', gap: '8px', fontSize: 14, opacity: 0.72 }}>
                  {list(column.links).map((link, j) => <span key={j}>{str(link.label)}</span>)}
                </Box>
              </Box>
            ))}
          </Box>
          {str(p.copyright) && <Box sx={{ mt: '36px', pt: '20px', borderTop: `1px solid ${SITE.line}`, fontSize: 13, opacity: 0.6 }}>{str(p.copyright)}</Box>}
        </Box>
      );
    }
    case 'html':
      return str(p.html).trim() ? (
        <Box sx={{ textAlign: 'left' }}>
          {/* sandbox="" disables scripts, forms and navigation: the markup is shown, never executed. */}
          <Box component="iframe" title="Custom HTML preview" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1C1C1A}</style>${str(p.html)}`} sx={{ width: '100%', height: 220, border: `1px solid ${SITE.line}`, borderRadius: '10px', bgcolor: SITE.surface, pointerEvents: 'none', display: 'block' }} />
          <Box sx={{ mt: '8px', fontSize: 12, color: SITE.faint }}>Custom HTML — shown without scripts here; your frontend decides how to render it.</Box>
        </Box>
      ) : <EmptyItems label="Add HTML in the Content panel." />;
    case 'json':
      return (
        <Box sx={{ textAlign: 'left' }}>
          <Box sx={{ fontSize: 13, fontWeight: 600, mb: '8px' }}>{str(p.component) ? `Custom component: ${str(p.component)}` : 'Custom JSON'}</Box>
          <Box component="pre" sx={{ m: 0, p: '16px', borderRadius: '10px', bgcolor: SITE.soft, color: SITE.ink, fontSize: 13, lineHeight: 1.6, overflow: 'auto', maxHeight: 280, fontFamily: '"Geist Mono Variable", ui-monospace, monospace' }}>{JSON.stringify(p.data ?? {}, null, 2)}</Box>
        </Box>
      );
    default:
      return <GenericBlock node={node} def={def} ctx={ctx} />;
  }
}

/** Custom components have no built-in look, so their content is summarised field by field. */
function GenericBlock({ node, def, ctx }: { node: BlockNode; def: BlockDefinition; ctx: PreviewContext }) {
  const summarise = (field: FieldDef, value: unknown): ReactNode => {
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return <Box component="span" sx={{ color: SITE.faint }}>—</Box>;
    switch (field.type) {
      case 'image': {
        const src = imageUrl(ctx.assets.get(String(value)), 320);
        return src ? <Box component="img" src={src} alt="" draggable={false} sx={{ height: 56, borderRadius: '6px', display: 'block' }} /> : 'Image';
      }
      case 'images':
      case 'files':
      case 'relations':
      case 'repeatable':
      case 'dynamiczone':
        return `${(value as unknown[]).length} item${(value as unknown[]).length === 1 ? '' : 's'}`;
      case 'richtext':
        return <Prose doc={value} />;
      case 'boolean':
      case 'checkbox':
        return value ? 'Yes' : 'No';
      case 'select':
      case 'radio':
        return field.config.options?.find((o) => o.value === value)?.label ?? String(value);
      case 'password':
        return '••••••';
      case 'color':
        return (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Box sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: String(value), border: `1px solid ${SITE.line}` }} />
            {String(value)}
          </Box>
        );
      default:
        return typeof value === 'object' ? <Box component="code" sx={{ fontSize: 12 }}>{JSON.stringify(value).slice(0, 160)}</Box> : String(value).slice(0, 400);
    }
  };
  return (
    <Box sx={{ border: `1px solid ${SITE.line}`, borderRadius: '12px', overflow: 'hidden', textAlign: 'left', bgcolor: SITE.surface, color: SITE.ink }}>
      <Box sx={{ px: '18px', py: '12px', bgcolor: SITE.soft, borderBottom: `1px solid ${SITE.line}`, display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline' }}>
        <Box sx={{ fontWeight: 600 }}>{def.label}</Box>
        <Box sx={{ fontSize: 12, color: SITE.faint }}>Custom component · rendered by your frontend</Box>
      </Box>
      <Box sx={{ px: '18px', py: '6px' }}>
        {def.fields.length === 0 && <Box sx={{ py: '12px', color: SITE.faint, fontSize: 14 }}>This component has no fields.</Box>}
        {def.fields.map((field) => (
          <Box key={field.apiId} sx={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '16px', py: '10px', fontSize: 14, '&:not(:last-of-type)': { borderBottom: `1px solid ${SITE.line}` } }}>
            <Box sx={{ color: SITE.muted }}>{field.label}</Box>
            <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{summarise(field, node.props?.[field.apiId])}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function BlockPreviewInner({ node, def, ctx }: { node: BlockNode; def: BlockDefinition; ctx: PreviewContext }) {
  return (
    <Box sx={{ fontFamily: SITE_FONT, fontSize: 'var(--site-body)', lineHeight: 1.55, '& *': { boxSizing: 'border-box' } }}>
      <PreviewBody node={node} def={def} ctx={ctx} />
    </Box>
  );
}

/** Visual stand-in for one block. Re-renders only when the block itself or the preview context changes. */
export const BlockPreview = memo(BlockPreviewInner);

export { SITE_FONT };
