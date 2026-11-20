import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ApiOutlined from '@mui/icons-material/ApiOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { CardSkeleton, CodeBlock, CopyButton, ErrorState, Mono, Page, PageHeader, Pill } from '@/components/ui';
import { API_URL, api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { MediaAsset } from '@/lib/types';
import { FONT_MONO } from '@/theme/theme';
import { docsCode, docsContext } from './sdkDocs';
import { Snippets } from './shared';

const SECTIONS = [
  { id: 'sdk-quick-start', nav: 'Quick start', title: 'Quick start' },
  { id: 'sdk-authentication', nav: 'Authentication', title: 'Authentication and key types' },
  { id: 'sdk-fetching', nav: 'Fetching content', title: 'Fetching content' },
  { id: 'sdk-pages', nav: 'Pages and blocks', title: 'Pages and blocks' },
  { id: 'sdk-rich-text', nav: 'Rich text', title: 'Rich text' },
  { id: 'sdk-media', nav: 'Media and images', title: 'Media and image transformations' },
  { id: 'sdk-preview', nav: 'Drafts and preview', title: 'Drafts and preview' },
  { id: 'sdk-graphql', nav: 'GraphQL', title: 'GraphQL' },
  { id: 'sdk-webhooks', nav: 'Webhooks', title: 'Webhooks and signature verification' },
  { id: 'sdk-realtime', nav: 'Real-time events', title: 'Real-time events' },
  { id: 'sdk-caching', nav: 'Caching', title: 'Caching' },
  { id: 'sdk-errors', nav: 'Errors and rate limits', title: 'Errors and rate limits' },
  { id: 'sdk-typescript', nav: 'TypeScript types', title: 'TypeScript types' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];
const titleOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.title ?? '';

/** Block types every project starts with; replaced by the environment's own list once the content model has loaded. */
const BUILTIN_BLOCKS = [
  'section',
  'columns',
  'hero',
  'text',
  'image',
  'video',
  'split',
  'feature-grid',
  'cards',
  'testimonials',
  'faq',
  'pricing',
  'stats',
  'logos',
  'gallery',
  'cta',
  'contact',
  'team',
  'blog-listing',
  'product-listing',
  'breadcrumbs',
  'navigation',
  'footer',
  'html',
  'json',
];

const WEBHOOK_EVENTS = [
  'content.created',
  'content.updated',
  'content.deleted',
  'content.published',
  'content.unpublished',
  'content.scheduled',
  'page.published',
  'page.unpublished',
  'media.uploaded',
  'media.updated',
  'media.deleted',
  'schema.updated',
  'release.published',
];

/** Formats the image pipeline can resize and convert. Others (SVG, GIF) are served as uploaded. */
const TRANSFORMABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

// ─── Building blocks ─────────────────────────────────────────────────────────

const C = ({ children }: { children: ReactNode }) => (
  <Box component="code" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'surface.sunken', overflowWrap: 'anywhere' }}>
    {children}
  </Box>
);

const P = ({ children }: { children: ReactNode }) => (
  <Typography variant="body2" sx={{ lineHeight: 1.7, maxWidth: 780 }}>
    {children}
  </Typography>
);

const H3 = ({ children }: { children: ReactNode }) => (
  <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, pt: 1.5 }}>
    {children}
  </Typography>
);

function Note({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2.5} role="note" sx={{ border: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle', borderRadius: '8px', px: 3.5, py: 2.5, maxWidth: 780 }}>
      <InfoOutlined sx={{ fontSize: 17, color: 'text.secondary', mt: 0.5, flexShrink: 0 }} />
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
        {children}
      </Typography>
    </Stack>
  );
}

function DocTable({ label, head, rows }: { label: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <TableContainer sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', '& tbody tr:last-of-type td': { borderBottom: 0 } }}>
      <Table size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            {head.map((cell) => (
              <TableCell key={cell} sx={{ whiteSpace: 'nowrap' }}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, r) => (
            <TableRow key={r}>
              {row.map((cell, c) => (
                <TableCell key={c} sx={{ verticalAlign: 'top', color: c === 0 ? 'text.primary' : 'text.secondary' }}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function TokenList({ label, items }: { label: string; items: string[] }) {
  return (
    <Stack direction="row" component="ul" aria-label={label} sx={{ listStyle: 'none', m: 0, p: 0, flexWrap: 'wrap', gap: 1.5 }}>
      {items.map((item) => (
        <Box component="li" key={item} sx={{ display: 'flex' }}>
          <Pill label={<Mono sx={{ fontSize: '0.6875rem' }}>{item}</Mono>} />
        </Box>
      ))}
    </Stack>
  );
}

function DocSection({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <Paper component="section" id={id} aria-labelledby={`${id}-title`} sx={{ borderRadius: '10px', p: { xs: 4, md: 6 }, scrollMarginTop: { xs: 84, md: 16 }, minWidth: 0 }}>
      <Typography variant="h3" component="h2" id={`${id}-title`} tabIndex={-1} sx={{ mb: 3.5, outline: 'none' }}>
        {titleOf(id)}
      </Typography>
      <Stack spacing={3.5} sx={{ minWidth: 0 }}>
        {children}
      </Stack>
    </Paper>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={3} component="li" sx={{ minWidth: 0 }}>
      <Box aria-hidden sx={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', border: 1, borderColor: 'border.strong', display: 'grid', placeItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
        {number}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 600, mb: 1.5, lineHeight: '24px' }}>
          {title}
        </Typography>
        <Stack spacing={2}>{children}</Stack>
      </Box>
    </Stack>
  );
}

/** A real image from this project's media library, served through the transformation parameters. */
function LiveImageExample() {
  const ws = useProject();
  const canRead = ws.can('media.read');
  const media = useQuery({
    queryKey: ['sdk-docs', 'image-example', ws.project.id],
    queryFn: () => api.get<{ items: MediaAsset[] }>(`${ws.projectBase}/media`, { pageSize: 1, kind: 'image' }).then((r) => r.items[0] ?? null),
    enabled: canRead,
    staleTime: 60_000,
  });

  if (!canRead) return <Note>A live example with one of your own images appears here for roles that can view the media library.</Note>;
  if (media.isPending) return <Skeleton variant="rounded" height={168} sx={{ borderRadius: '8px' }} aria-label="Loading an example image" />;
  if (media.isError) {
    return (
      <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px' }}>
        <ErrorState compact error={media.error} onRetry={() => void media.refetch()} />
      </Box>
    );
  }
  const asset = media.data;
  if (!asset) {
    return (
      <Note>
        Upload an image to the{' '}
        <Link component={RouterLink} to={ws.href('media')} color="secondary">
          media library
        </Link>{' '}
        and a live example, with its real URL and a preview, appears here.
      </Note>
    );
  }

  const transformable = TRANSFORMABLE.includes(asset.mimeType);
  const url = transformable ? `${asset.url}?w=480&h=320&fit=cover&format=webp&q=75` : asset.url;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', p: 3.5, alignItems: { sm: 'flex-start' } }}>
      <Box
        component="img"
        src={url}
        alt={asset.alt || asset.filename}
        loading="lazy"
        sx={{ width: { xs: '100%', sm: 240 }, maxWidth: 320, aspectRatio: '3 / 2', objectFit: 'cover', borderRadius: '6px', border: 1, borderColor: 'border.subtle', bgcolor: 'surface.sunken', flexShrink: 0 }}
      />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Live example from your media library
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, mb: 2 }}>
          {asset.filename}
          {asset.width && asset.height ? ` · original ${asset.width} × ${asset.height}` : ''} · {formatBytes(asset.size)}
          {transformable ? ' · requested at 480 × 320, cropped to cover, as WebP at quality 75' : ' · this format is served as uploaded, without transformations'}
        </Typography>
        <CodeBlock code={url} />
      </Box>
    </Stack>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SdkDocsPage() {
  const ws = useProject();
  const schema = useSchema();
  useCrumbs([]);

  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  const jumpLock = useRef(0);
  const ready = !schema.isPending;

  const ctx = useMemo(
    () =>
      docsContext(API_URL, schema.data, {
        defaultLocale: ws.defaultLocale,
        locales: ws.project.locales.map((l) => l.code),
        projectSlug: ws.project.slug,
        environmentKey: ws.environment.key,
      }),
    [schema.data, ws.defaultLocale, ws.project.locales, ws.project.slug, ws.environment.key],
  );
  const code = useMemo(() => docsCode(ctx), [ctx]);
  const blockTypes = schema.data?.builtinBlocks?.length ? schema.data.builtinBlocks : BUILTIN_BLOCKS;

  // Highlight the section being read: the first one inside the upper part of the viewport.
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // While a jump is still scrolling, the section the reader chose stays highlighted.
        if (Date.now() < jumpLock.current) return;
        const first = SECTIONS.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-88px 0px -55% 0px' },
    );
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [ready]);

  const jump = (id: SectionId) => {
    const element = document.getElementById(id);
    if (!element) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    jumpLock.current = Date.now() + 1000;
    element.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActive(id);
    // Move focus with the viewport, so keyboard and screen-reader users continue from the new section.
    document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
  };

  const explorerHref = ws.href('dev/explorer');
  const canExplore = ws.can('schema.read');
  const canManageKeys = ws.can('token.manage');

  return (
    <Page>
      <PageHeader
        title="SDK documentation"
        description="How to connect a website or application to this project. Every sample uses your API URL and your own content types, so it can be copied as it stands."
        actions={
          <>
            {canManageKeys && (
              <Button variant="outlined" startIcon={<KeyOutlined />} component={RouterLink} to={ws.href('dev/keys')}>
                API keys
              </Button>
            )}
            {canExplore && (
              <Button variant="outlined" startIcon={<ApiOutlined />} component={RouterLink} to={explorerHref}>
                API explorer
              </Button>
            )}
          </>
        }
      />

      {/* Section picker for narrow screens */}
      <Box sx={{ display: { xs: 'block', md: 'none' }, position: 'sticky', top: 0, zIndex: 3, bgcolor: 'background.default', mx: -4, px: 4, py: 2.5, mb: 3, borderBottom: 1, borderColor: 'border.subtle' }}>
        <TextField select fullWidth label="Section" value={active} onChange={(e) => jump(e.target.value as SectionId)} disabled={!ready}>
          {SECTIONS.map((section) => (
            <MenuItem key={section.id} value={section.id}>
              {section.nav}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '208px minmax(0, 1fr)' }, gap: { xs: 4, md: 6 }, alignItems: 'start' }}>
        <Box component="nav" aria-label="Documentation sections" sx={{ display: { xs: 'none', md: 'block' }, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 96px)', overflowY: 'auto' }}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ fontWeight: 600, px: 2.5, mb: 1.5 }}>
            On this page
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {SECTIONS.map((section) => {
              const current = section.id === active;
              return (
                <Box component="li" key={section.id}>
                  <ButtonBase
                    onClick={() => jump(section.id)}
                    disabled={!ready}
                    aria-current={current ? 'location' : undefined}
                    sx={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      px: 2.5,
                      py: 1.5,
                      borderRadius: '7px',
                      fontSize: '0.8125rem',
                      lineHeight: 1.35,
                      color: current ? 'text.primary' : 'text.secondary',
                      fontWeight: current ? 600 : 400,
                      bgcolor: current ? 'action.selected' : 'transparent',
                      '&:hover': { bgcolor: current ? 'action.selected' : 'action.hover' },
                    }}
                  >
                    {section.nav}
                  </ButtonBase>
                </Box>
              );
            })}
          </Box>
        </Box>

        {!ready ? (
          <Stack spacing={5} aria-busy="true" aria-label="Loading documentation">
            <CardSkeleton height={96} />
            <CardSkeleton height={420} count={3} />
          </Stack>
        ) : (
          <Stack spacing={5} sx={{ minWidth: 0 }}>
            {/* Facts used throughout the page */}
            <Paper sx={{ borderRadius: '10px', display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, overflow: 'hidden' }}>
              {[
                { label: 'API URL', value: API_URL, hint: `REST under /api/v1 · ${ws.environment.name} is chosen by the key` },
                { label: 'Package', value: '@meridian/sdk', hint: 'No dependencies · Node 18+, browsers, edge, React Native' },
                { label: 'Authentication', value: 'Authorization: Bearer <API key>', hint: 'One key per project and environment' },
              ].map((fact, index) => (
                <Box key={fact.label} sx={{ p: 4, minWidth: 0, borderTop: { xs: index ? 1 : 0, lg: 0 }, borderLeft: { lg: index ? 1 : 0 }, borderColor: 'border.subtle' }}>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {fact.label}
                  </Typography>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, mt: 0.5 }}>
                    <Mono sx={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fact.value}</Mono>
                    <CopyButton value={fact.value} label={`Copy ${fact.label.toLowerCase()}`} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                    {fact.hint}
                  </Typography>
                </Box>
              ))}
            </Paper>

            {schema.isError && (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void schema.refetch()}>
                    Try again
                  </Button>
                }
              >
                The content model could not be loaded, so the samples use an example type named <C>articles</C> instead of your own.
              </Alert>
            )}
            {!schema.isError && ctx.example && (
              <Note>
                This environment has no collection type yet, so the samples use an example type named <C>articles</C>. They switch to your own types as soon as you{' '}
                <Link component={RouterLink} to={ws.href('model/types')} color="secondary">
                  create one
                </Link>
                .
              </Note>
            )}

            <DocSection id="sdk-quick-start">
              <P>
                Meridian delivers content over a REST and a GraphQL API. The SDK is a small TypeScript client for both, with no dependencies, that runs wherever <C>fetch</C> exists. Five steps take you from nothing to a list of {ctx.label}.
              </P>
              <Stack component="ol" spacing={4} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                <Step number={1} title="Create an API key">
                  <P>
                    A key belongs to one project and one environment. A read-only key is all you need to read published content, and it is safe in browser code.{' '}
                    {canManageKeys ? (
                      <Link component={RouterLink} to={ws.href('dev/keys')} color="secondary">
                        Create one under API keys
                      </Link>
                    ) : (
                      'Ask an administrator of this organization for one.'
                    )}
                  </P>
                </Step>
                <Step number={2} title="Install the SDK">
                  <CodeBlock code={code.install} language="bash" />
                </Step>
                <Step number={3} title="Add the URL and the key to your environment">
                  <CodeBlock code={code.env} language=".env" />
                </Step>
                <Step number={4} title="Create a client">
                  <Snippets items={[{ label: 'Client', caption: 'lib/cms.ts', language: 'typescript', code: code.client }]} />
                </Step>
                <Step number={5} title={`Fetch ${ctx.label}`}>
                  <Snippets
                    items={[
                      { label: 'SDK', language: 'typescript', code: code.firstRequest },
                      { label: 'cURL', language: 'bash', code: code.firstCurl },
                      { label: 'Response shape', language: 'json', code: code.listResponse },
                    ]}
                  />
                </Step>
              </Stack>
            </DocSection>

            <DocSection id="sdk-authentication">
              <P>
                Every request carries an API key in the <C>Authorization</C> header. The key alone decides which project and environment you read, and what you are allowed to do there. There are three kinds, told apart by their prefix.
              </P>
              <DocTable
                label="Key types"
                head={['Type', 'Prefix', 'Can read', 'Where it may run']}
                rows={[
                  ['Read-only', <C key="p">mrd_ro_</C>, 'Published content only', 'Browser, mobile app or server'],
                  ['Preview', <C key="p">mrd_pv_</C>, 'Published content and drafts', 'Server only'],
                  ['Read/write', <C key="p">mrd_rw_</C>, 'Everything, and it can create, update, publish and delete', 'Server only'],
                ]}
              />
              <Alert severity="warning" sx={{ maxWidth: 780 }}>
                Preview and read/write keys are secrets. Anyone can read what ships in a bundle, so keep them on a server. The API refuses them when a request carries a browser origin that is not on the key’s allow-list, and the SDK throws if one is
                constructed in a browser.
              </Alert>
              <Snippets
                items={[
                  { label: 'Header', language: 'bash', code: code.rawHeader },
                  { label: 'Browser client', caption: 'src/cms.ts', language: 'typescript', code: code.browserClient },
                  { label: 'Server client', caption: 'lib/cms.ts', language: 'typescript', code: code.serverClient },
                  { label: 'Writing content', caption: 'Server only', language: 'typescript', code: code.writes },
                ]}
              />
              <P>
                Keys are shown once, when they are created, and stored only as a hash. Each key can be limited to specific browser origins, given an expiry and its own rate limit, rotated, or revoked. Writes made with a read/write key go through the
                same validation, versioning, approval rules and audit log as the admin.
              </P>
            </DocSection>

            <DocSection id="sdk-fetching">
              <P>
                Every content type gets endpoints named after its API identifier: <C>GET /api/v1/{ctx.type}</C> lists entries and <C>GET /api/v1/{ctx.type}/{'{id-or-slug}'}</C> returns one. The same parameters work in the SDK, over REST and in
                GraphQL.
              </P>
              <Snippets
                items={[
                  { label: 'SDK', language: 'typescript', code: code.fetchSdk },
                  { label: 'REST', language: 'bash', code: code.fetchRest },
                ]}
                maxHeight={520}
              />
              <DocTable
                label="Query parameters"
                head={['Parameter', 'Example', 'Meaning']}
                rows={[
                  [<C key="p">limit, offset / page</C>, <Mono key="e">limit=20&page=2</Mono>, 'Pagination. limit is at most 100 and defaults to 25.'],
                  [<C key="p">sort</C>, <Mono key="e">sort=-publishedAt</Mono>, 'Comma-separated fields. A leading - sorts descending.'],
                  [<C key="p">search</C>, <Mono key="e">search=design</Mono>, 'Case-insensitive, across text fields.'],
                  [<C key="p">filter[field]</C>, <Mono key="e">{ctx.filter ? `filter[${ctx.filter.field}]=${ctx.filter.value}` : 'filter[slug]=my-slug'}</Mono>, 'Equals.'],
                  [<C key="p">filter[field][op]</C>, <Mono key="e">filter[publishedAt][gte]=2026-01-01</Mono>, 'Operators: eq ne gt gte lt lte contains startsWith in nin null.'],
                  [<C key="p">populate</C>, <Mono key="e">{`populate=${ctx.relationField ?? '*'}`}</Mono>, 'Expand relations, nested with dots up to 4 levels. * expands every first-level relation.'],
                  [<C key="p">fields</C>, <Mono key="e">{`fields=${ctx.fieldNames.length ? ctx.fieldNames.join(',') : 'title,slug'}`}</Mono>, 'Return only these fields. System attributes are always included.'],
                  [<C key="p">locale</C>, <Mono key="e">{`locale=${ctx.locale}`}</Mono>, 'Falls back to the locale’s fallback, then to the project default.'],
                  [<C key="p">richtext</C>, <Mono key="e">richtext=html</Mono>, 'Rich text as sanitized HTML instead of a JSON document.'],
                  [<C key="p">status</C>, <Mono key="e">status=draft</Mono>, 'Drafts. Preview and read/write keys only.'],
                ]}
              />
              <P>
                <C>id</C> is the document id: stable across edits and shared by every locale variant. Media fields are always expanded to objects with URLs. Relations are references of the form <C>{'{ id, type }'}</C> until you ask for them with{' '}
                <C>populate</C>. Fields marked private in the content model, and password fields, are never returned.
              </P>
            </DocSection>

            <DocSection id="sdk-pages">
              <P>
                Pages are built by editors in the page builder and delivered as structured data. Meridian does not render pages for you, on purpose: a block is <C>{'{ id, type, props, style, children }'}</C>, and nothing in it depends on React, Vue
                or any other framework.
              </P>
              <P>
                Your application owns the look. Keep a map from block <C>type</C> to your own component and render the tree. Skip types you have not implemented, and never crash on them. <C>style</C> carries the editor’s layout choices, such as
                background, spacing, alignment, per-device columns and visibility, for you to honour in your own design system.
              </P>
              <Snippets
                items={[
                  { label: 'Blocks renderer', caption: 'components/Blocks.tsx', language: 'tsx', code: code.blocks },
                  { label: 'Next.js route', caption: 'app/[[...path]]/page.tsx', language: 'tsx', code: code.pageRoute },
                  { label: 'Fetch a page', language: 'typescript', code: code.pageSdk },
                  { label: 'REST', language: 'bash', code: code.pageRest },
                  { label: 'Response shape', language: 'json', code: code.pageResponse },
                ]}
                maxHeight={520}
              />
              <H3>Built-in block types</H3>
              <TokenList label="Built-in block types" items={blockTypes} />
              <P>
                Components your team marked as page blocks arrive with their own type names. Each block’s props are described by <C>GET /api/v1/content-types</C>. Listing blocks such as <C>blog-listing</C> name a content type and a limit; fetch
                those entries yourself, which keeps listings fresh without republishing the page.
              </P>
            </DocSection>

            <DocSection id="sdk-rich-text">
              <P>
                Rich text fields are returned as a structured JSON document by default, so you can render every node with your own components. Ask for <C>richtext=html</C> and the same field arrives as sanitized HTML, ready to place in a page.
              </P>
              <DocTable
                label="Rich text formats"
                head={['Format', 'How to ask', 'You get', 'Choose it when']}
                rows={[
                  ['JSON document', 'Default', <C key="v">{"{ type: 'doc', content: [ … ] }"}</C>, 'You render nodes with your own components, or the content feeds a native app.'],
                  ['HTML', <C key="h">richtext=html</C>, 'A sanitized HTML string', 'You want to place the content in a page with your own typography styles.'],
                ]}
              />
              <Snippets
                items={[
                  { label: 'HTML', language: 'tsx', code: code.richHtml },
                  { label: 'JSON document', language: 'typescript', code: code.richJson },
                  { label: 'REST', language: 'bash', code: code.richRest },
                ]}
              />
              {!ctx.richText.real && !ctx.example && (
                <Note>
                  None of your content types has a rich text field yet, so these samples use a field named <C>{ctx.richText.field}</C>.
                </Note>
              )}
            </DocSection>

            <DocSection id="sdk-media">
              <P>
                Media URLs are immutable: they include a revision that changes when a file is replaced, so they can be cached forever. Add transformation parameters to resize, crop and convert an image. A variant is generated on the first request
                and stored, so later requests are plain file reads.
              </P>
              <CodeBlock code={code.mediaPattern} />
              <DocTable
                label="Image transformation parameters"
                head={['Parameter', 'Values', 'Meaning']}
                rows={[
                  [<C key="p">w, h</C>, '1–4096', 'Width and height in pixels.'],
                  [<C key="p">fit</C>, 'cover (default), contain, fill, inside, outside', 'How the image fills the requested box.'],
                  [<C key="p">position</C>, 'center, top, right, bottom, left, entropy, attention', 'Which part to keep when cropping.'],
                  [<C key="p">format</C>, 'webp, avif, jpeg, png', 'Output format.'],
                  [<C key="p">q</C>, '1–100 (default 80)', 'Quality.'],
                ]}
              />
              <LiveImageExample />
              <Snippets
                items={[
                  { label: 'SDK', language: 'typescript', code: code.mediaSdk },
                  { label: 'HTML', language: 'html', code: code.mediaImg },
                ]}
              />
              {!ctx.image.real && !ctx.example && (
                <Note>
                  None of your content types has an image field yet, so the SDK sample uses a field named <C>{ctx.image.field}</C>.
                </Note>
              )}
            </DocSection>

            <DocSection id="sdk-preview">
              <P>
                Read-only keys can never see drafts, whatever parameters they send. There are two ways to show unpublished content, and both belong on a server.
              </P>
              <H3>Preview links, for editors</H3>
              <P>
                Set a preview URL under Settings → Project, for example <C>{'https://www.example.com/api/preview?token={token}&path={path}'}</C>. When an editor chooses Preview, Meridian issues a token that is valid for one hour and for exactly
                that entry. Your route exchanges it for the draft, and no API key is involved.
              </P>
              <H3>Preview keys, for staging sites</H3>
              <P>
                A <C>mrd_pv_</C> key may add <C>status=draft</C> to any read to see the working copy of everything. Use it on a staging server that should always show the latest edits.
              </P>
              <Snippets
                items={[
                  { label: 'Preview route', caption: 'app/api/preview/route.ts', language: 'typescript', code: code.previewRoute },
                  { label: 'Preview key', caption: 'Server only', language: 'typescript', code: code.previewKey },
                  { label: 'REST', language: 'bash', code: code.previewRest },
                ]}
              />
            </DocSection>

            <DocSection id="sdk-graphql">
              <P>
                Send a <C>POST</C> to <C>/api/v1/graphql</C> with the same key. The schema is generated from your content model: every collection gets a list field that returns <C>{'{ items, total, limit, offset }'}</C> and a field that returns
                one entry by id or slug.
              </P>
              <Snippets
                items={[
                  { label: 'Query', language: 'graphql', code: code.graphqlQuery },
                  { label: 'SDK', language: 'typescript', code: code.graphqlSdk },
                  { label: 'cURL', language: 'bash', code: code.graphqlCurl },
                ]}
              />
              <P>
                Relations are real fields that you can select through. <C>filter</C> takes the same shape as the SDK, for example <C>{'{ price: { gte: 10 } }'}</C>. Read/write keys also get create, update, publish, unpublish and delete mutations
                for every type. Queries may nest up to 10 levels.
                {canExplore && (
                  <>
                    {' '}
                    <Link component={RouterLink} to={explorerHref} color="secondary">
                      Try queries against live data in the API explorer
                    </Link>
                    .
                  </>
                )}
              </P>
            </DocSection>

            <DocSection id="sdk-webhooks">
              <P>
                Publishing makes content available from the API immediately. If your own application caches, through a CDN, static generation or an in-memory cache, a webhook tells it when to refresh. Add one under Developers → Webhooks, choose the
                events, and Meridian sends a JSON <C>POST</C> to your URL.
              </P>
              <TokenList label="Webhook events" items={WEBHOOK_EVENTS} />
              <H3>Verify every delivery</H3>
              <P>
                Each delivery is signed with the webhook’s signing secret. The signature is an HMAC-SHA256 over the timestamp, a dot and the raw request body. Check it against the body exactly as it was received, before parsing it, and reject old
                timestamps so a captured request cannot be replayed. <C>parseWebhook</C> from <C>@meridian/sdk/webhooks</C> does all of this and throws when the signature is wrong.
              </P>
              <CodeBlock code={code.webhookHeaders} language="headers" />
              <Snippets
                items={[
                  { label: 'Next.js revalidation', caption: 'app/api/revalidate/route.ts', language: 'typescript', code: code.webhookNext },
                  { label: 'Tagged client', caption: 'lib/cms.ts', language: 'typescript', code: code.webhookTagged },
                  { label: 'Node.js, by hand', caption: 'verify-meridian-webhook.js', language: 'javascript', code: code.webhookNode },
                  { label: 'Payload', language: 'json', code: code.webhookPayload },
                ]}
                maxHeight={520}
              />
              <H3>Delivery and retries</H3>
              <P>
                Respond with a 2xx status within 10 seconds. Server errors, timeouts and 429 responses are retried with exponential backoff; other 4xx responses are not. Retries carry the same <C>X-Meridian-Delivery</C> id, so use it to ignore
                duplicates. Every attempt is logged under the webhook, where you can inspect payloads and redeliver.
              </P>
            </DocSection>

            <DocSection id="sdk-realtime">
              <P>
                For interfaces that should update while they are open, subscribe to live events. <C>cms.subscribe</C> opens a WebSocket to <C>/api/v1/events</C>, reconnects automatically and returns a function that closes the connection.
              </P>
              <Snippets
                items={[
                  { label: 'SDK', language: 'typescript', code: code.realtimeSdk },
                  { label: 'Node.js', language: 'typescript', code: code.realtimeNode },
                  { label: 'Plain WebSocket', language: 'javascript', code: code.realtimeRaw },
                ]}
              />
              <P>
                The first message authenticates the connection with <C>{"{ type: 'auth', token }"}</C>, so the key never appears in a URL. The server then pushes <C>{"{ type: 'event', data }"}</C> for that key’s environment only. Events have the
                same names and fields as webhook payloads. A read-only key is enough, and it is the only kind that belongs in a browser.
              </P>
            </DocSection>

            <DocSection id="sdk-caching">
              <P>
                Published responses carry an <C>ETag</C> and <C>Cache-Control: public, max-age=0, must-revalidate</C>. Send the tag back in <C>If-None-Match</C> and you get a 304 with no body while nothing has changed. The SDK does this for
                every request. <C>X-Cache: HIT</C> or <C>MISS</C> reports Meridian’s own response cache.
              </P>
              <Alert severity="warning" sx={{ maxWidth: 780 }}>
                Meridian’s cache is invalidated the moment content is published, so the API always serves the latest version. A CDN or framework cache in front of your own site is a separate layer: it only updates when your webhook purges or
                revalidates it.
              </Alert>
              <Snippets
                items={[
                  { label: 'Conditional request', language: 'bash', code: code.cacheCurl },
                  { label: 'SDK cache', caption: 'lib/cms.ts', language: 'typescript', code: code.cacheSdk },
                  { label: 'Purge a CDN', caption: 'server.js', language: 'javascript', code: code.cdnPurge },
                ]}
                maxHeight={520}
              />
              <P>
                The CDN sample is a webhook receiver that verifies the signature, skips duplicate deliveries and calls the provider’s purge API with the paths from the event. Media URLs change whenever a file is replaced, so they never need
                purging.
              </P>
            </DocSection>

            <DocSection id="sdk-errors">
              <P>
                Every error has the same shape. Quote <C>requestId</C> when you report a problem.
              </P>
              <CodeBlock code={code.errorShape} language="json" />
              <DocTable
                label="Error codes"
                head={['Status', 'Code', 'Meaning']}
                rows={[
                  ['400', <C key="c">bad_request</C>, 'Malformed query, such as an unknown field in a filter or a bad number.'],
                  ['401', <C key="c">unauthorized</C>, 'Missing, unknown, expired or revoked key.'],
                  ['403', <C key="c">forbidden</C>, 'Key type or origin not allowed for this operation.'],
                  ['404', <C key="c">not_found</C>, 'No such content, or it is not published.'],
                  ['409', <C key="c">conflict</C>, 'For example, publishing something that still needs approval.'],
                  ['422', <C key="c">validation_failed</C>, 'Field-level problems, listed in details.'],
                  ['429', <C key="c">rate_limited</C>, 'Too many requests. Wait for the time given in Retry-After.'],
                ]}
              />
              <P>
                Rate limits are counted per key and per minute, 600 by default, and can be set for each key. Every response reports <C>X-RateLimit-Limit</C>, <C>X-RateLimit-Remaining</C> and <C>X-RateLimit-Reset</C>. Over the limit, the API
                answers 429 with a <C>Retry-After</C> header.
              </P>
              <Snippets
                items={[
                  { label: 'SDK', language: 'typescript', code: code.errorSdk },
                  { label: 'fetch with Retry-After', language: 'typescript', code: code.errorFetch },
                ]}
              />
              <P>
                In the SDK, <C>findOne</C>, <C>single</C> and the <C>pages.get…</C> methods resolve to <C>null</C> when content does not exist or is not published, so optional content needs no try/catch. Everything else throws{' '}
                <C>MeridianError</C> with <C>status</C>, <C>code</C>, <C>details</C>, <C>requestId</C> and <C>retryable</C>. Failed and rate-limited reads are retried twice with backoff; writes are never retried.
              </P>
            </DocSection>

            <DocSection id="sdk-typescript">
              <P>
                The SDK is written in TypeScript and exports the types you need: <C>Entry</C>, <C>ListResult</C>, <C>ListParams</C>, <C>QueryParams</C>, <C>Page</C>, <C>Block</C>, <C>MediaAsset</C>, <C>ContentEvent</C>, <C>ImageTransform</C>{' '}
                and <C>MeridianError</C>. Describe a content type once and pass it as a generic; every method then returns typed entries.
              </P>
              <Snippets
                items={[
                  { label: 'Your types', caption: 'types.ts', language: 'typescript', code: code.typesInterface },
                  { label: 'Typed requests', language: 'typescript', code: code.typesUsage },
                  { label: 'From OpenAPI', language: 'bash', code: code.typesOpenapi },
                ]}
              />
              <Note>
                {ctx.example ? (
                  <>The interface is an example. Once this environment has a collection type, it is generated from that type’s fields.</>
                ) : (
                  <>
                    The interface is generated from the current fields of <C>{ctx.type}</C>. Copy it again after the content model changes, or generate types for every endpoint from the OpenAPI document.
                  </>
                )}
              </Note>
            </DocSection>
          </Stack>
        )}
      </Box>
    </Page>
  );
}
