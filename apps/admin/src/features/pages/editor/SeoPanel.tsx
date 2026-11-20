import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { PAGE_TEMPLATES, type PageData, type SeoData, analyzeSeo } from '@meridian/shared';
import { Mono } from '@/components/ui';
import { JsonEditor } from '@/features/fields/CodeEditor';
import { AssetThumb, MediaPickerDialog } from '@/features/fields/MediaField';
import { useAppDispatch } from '@/store';
import { joinPagePath } from '../hooks';
import { useEditorLive, useEditorStatic } from './context';
import { pageEditorActions } from './editorSlice';

function Counter({ length, min, max }: { length: number; min: number; max: number }) {
  const tone = length === 0 ? 'text.disabled' : length < min || length > max ? 'warning.dark' : 'success.main';
  return (
    <Typography variant="caption" sx={{ color: tone, fontVariantNumeric: 'tabular-nums' }}>
      {length} / {max}
    </Typography>
  );
}

function FieldHead({ label, htmlFor, extra }: { label: string; htmlFor: string; extra?: React.ReactNode }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
      <Typography variant="subtitle2" component="label" htmlFor={htmlFor} sx={{ fontSize: '0.8125rem' }}>
        {label}
      </Typography>
      {extra}
    </Stack>
  );
}

/** Page-level settings shown when no block is selected. */
export function PageSettingsPanel({ page, parentPath, errors }: { page: PageData; parentPath: string | null; errors: Record<string, string> }) {
  const st = useEditorStatic();
  const dispatch = useAppDispatch();
  const off = st.readOnly;
  const slugInvalid = !!page.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.slug);
  const path = joinPagePath(parentPath, page.slug);

  return (
    <Stack spacing={4} sx={{ p: 4 }}>
      <Box>
        <FieldHead label="Title" htmlFor="page-title" />
        <TextField id="page-title" disabled={off} value={page.title} error={!!errors.title || !page.title.trim()} helperText={errors.title ?? (!page.title.trim() ? 'A page needs a title' : undefined)} onChange={(e) => dispatch(pageEditorActions.metaChanged({ title: e.target.value }))} slotProps={{ htmlInput: { maxLength: 200 } }} />
      </Box>
      <Box>
        <FieldHead label="Slug" htmlFor="page-slug" />
        <TextField
          id="page-slug"
          disabled={off}
          value={page.slug}
          error={!!errors.slug || slugInvalid}
          placeholder="Leave empty for the home page"
          helperText={errors.slug ?? (slugInvalid ? 'Use lowercase letters, numbers and hyphens' : undefined)}
          onChange={(e) => dispatch(pageEditorActions.metaChanged({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-/, '') }))}
          slotProps={{ htmlInput: { spellCheck: false, maxLength: 96 } }}
        />
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          URL path: <Mono>{path}</Mono>
        </Typography>
      </Box>
      <Box>
        <FieldHead label="Description" htmlFor="page-description" />
        <TextField id="page-description" disabled={off} multiline minRows={2} maxRows={6} value={page.description ?? ''} placeholder="An internal summary of what this page is for" onChange={(e) => dispatch(pageEditorActions.metaChanged({ description: e.target.value || undefined }))} slotProps={{ htmlInput: { maxLength: 500 } }} />
      </Box>
      <Box>
        <FieldHead label="Template" htmlFor="page-template" />
        <TextField id="page-template" select disabled={off} value={page.template ?? 'default'} onChange={(e) => dispatch(pageEditorActions.metaChanged({ template: e.target.value }))} helperText="Tells your frontend which layout to wrap this page in">
          {PAGE_TEMPLATES.map((t) => (
            <MenuItem key={t.value} value={t.value}>
              {t.label}
            </MenuItem>
          ))}
          {page.template && !PAGE_TEMPLATES.some((t) => t.value === page.template) && <MenuItem value={page.template}>{page.template}</MenuItem>}
        </TextField>
      </Box>
      <Box>
        <FieldHead label="Category" htmlFor="page-category" />
        <TextField id="page-category" disabled={off} value={page.category ?? ''} placeholder="e.g. Marketing, Legal" onChange={(e) => dispatch(pageEditorActions.metaChanged({ category: e.target.value || undefined }))} slotProps={{ htmlInput: { maxLength: 80 } }} />
      </Box>
    </Stack>
  );
}

const CHECK_ICON = {
  pass: <CheckCircleOutlined sx={{ fontSize: 15, color: 'success.main' }} />,
  warn: <WarningAmberOutlined sx={{ fontSize: 15, color: 'warning.main' }} />,
  fail: <ErrorOutlineOutlined sx={{ fontSize: 15, color: 'error.main' }} />,
};

/** Search and social metadata, with a result preview and editorial checks. */
export function SeoSettingsPanel({ page, parentPath, siteUrl }: { page: PageData; parentPath: string | null; siteUrl?: string }) {
  const st = useEditorStatic();
  const live = useEditorLive();
  const dispatch = useAppDispatch();
  const [picking, setPicking] = useState(false);
  const off = st.readOnly;
  const seo = page.seo ?? {};

  const set = (patch: Partial<SeoData>) => {
    const next: Record<string, unknown> = { ...seo, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === '' || next[key] === false || next[key] === null) delete next[key];
    dispatch(pageEditorActions.seoChanged(next as SeoData));
  };

  const checks = useMemo(() => analyzeSeo({ title: page.title, slug: page.slug, seo, blocks: page.blocks }), [page.title, page.slug, seo, page.blocks]);
  const path = joinPagePath(parentPath, page.slug);
  const origin = (siteUrl ?? '').replace(/\/$/, '') || 'https://your-site.example';
  const shownTitle = seo.title || page.title || 'Untitled page';
  const shownDescription = seo.description || 'Add a meta description to control the text search engines show under the title.';
  const ogAsset = seo.ogImage ? live.assets.get(seo.ogImage) : undefined;
  const canonicalInvalid = !!seo.canonicalUrl && !/^(https?:\/\/|\/)/.test(seo.canonicalUrl);

  return (
    <Stack spacing={4} sx={{ p: 4 }}>
      <Box>
        <Typography variant="overline" color="text.secondary" component="h4" sx={{ mb: 1.5 }}>
          Search preview
        </Typography>
        {/* A fixed light card: this imitates a search result, not the studio's theme. */}
        <Box data-color-scheme="light" sx={{ p: 3.5, borderRadius: '10px', border: 1, borderColor: 'border.subtle', bgcolor: '#FFFFFF', color: '#1C1C1A' }}>
          <Typography variant="caption" noWrap component="div" sx={{ color: '#5E5C56' }}>
            {origin.replace(/^https?:\/\//, '')}
            {path === '/' ? '' : path.split('/').filter(Boolean).map((s) => ` › ${s}`).join('')}
          </Typography>
          <Typography component="div" sx={{ fontSize: '1.0625rem', lineHeight: 1.3, color: '#1A4FA0', mt: 0.5, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {shownTitle}
          </Typography>
          <Typography variant="body2" component="div" sx={{ color: seo.description ? '#4A4843' : '#9A978F', mt: 0.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {shownDescription}
          </Typography>
          {seo.noIndex && (
            <Typography variant="caption" component="div" sx={{ mt: 1.5, color: '#8A5510' }}>
              Hidden from search engines (noindex)
            </Typography>
          )}
        </Box>
      </Box>

      <Box component="ul" aria-label="SEO checks" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5 }}>
        {checks.map((check) => (
          <Stack component="li" key={check.id} direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ pt: 0.25, display: 'flex' }}>{CHECK_ICON[check.level]}</Box>
            <Typography variant="body2" color={check.level === 'pass' ? 'text.secondary' : 'text.primary'}>
              {check.message}
            </Typography>
          </Stack>
        ))}
      </Box>

      <Box>
        <FieldHead label="SEO title" htmlFor="seo-title" extra={<Counter length={(seo.title ?? '').length} min={30} max={60} />} />
        <TextField id="seo-title" disabled={off} value={seo.title ?? ''} placeholder={page.title} onChange={(e) => set({ title: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
      </Box>
      <Box>
        <FieldHead label="Meta description" htmlFor="seo-description" extra={<Counter length={(seo.description ?? '').length} min={70} max={160} />} />
        <TextField id="seo-description" disabled={off} multiline minRows={3} maxRows={6} value={seo.description ?? ''} onChange={(e) => set({ description: e.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} />
      </Box>
      <Box>
        <FieldHead label="Canonical URL" htmlFor="seo-canonical" />
        <TextField id="seo-canonical" disabled={off} value={seo.canonicalUrl ?? ''} error={canonicalInvalid} placeholder={`${origin}${path}`} helperText={canonicalInvalid ? 'Use a full https:// address or a path starting with /' : 'Only needed when this content also lives at another address'} onChange={(e) => set({ canonicalUrl: e.target.value.trim() })} slotProps={{ htmlInput: { spellCheck: false, maxLength: 2048 } }} />
      </Box>
      <Box>
        <FormControlLabel sx={{ ml: 0, width: '100%', justifyContent: 'space-between', flexDirection: 'row-reverse' }} control={<Switch disabled={off} checked={!!seo.noIndex} onChange={(e) => set({ noIndex: e.target.checked })} />} label={<Typography variant="body2">Hide from search engines (noindex)</Typography>} />
        <FormControlLabel sx={{ ml: 0, mt: 1, width: '100%', justifyContent: 'space-between', flexDirection: 'row-reverse' }} control={<Switch disabled={off} checked={!!seo.noFollow} onChange={(e) => set({ noFollow: e.target.checked })} />} label={<Typography variant="body2">Do not follow links (nofollow)</Typography>} />
      </Box>

      <Typography variant="overline" color="text.secondary" component="h4" sx={{ pt: 2, borderTop: 1, borderColor: 'border.subtle' }}>
        Social sharing
      </Typography>
      <Box>
        <FieldHead label="Sharing image" htmlFor="seo-og-image" />
        {seo.ogImage ? (
          <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center', p: 2, border: 1, borderColor: 'border.strong', borderRadius: '8px' }}>
            {ogAsset ? <AssetThumb asset={ogAsset} size={52} radius={6} /> : <Box sx={{ width: 52, height: 52, borderRadius: '6px', bgcolor: 'surface.sunken' }} />}
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {ogAsset?.filename ?? 'Image'}
            </Typography>
            {!off && (
              <>
                <Button size="small" onClick={() => setPicking(true)}>
                  Change
                </Button>
                <IconButton size="small" aria-label="Remove sharing image" onClick={() => set({ ogImage: undefined })}>
                  <CloseOutlined sx={{ fontSize: '15px !important' }} />
                </IconButton>
              </>
            )}
          </Stack>
        ) : (
          <Button id="seo-og-image" variant="outlined" fullWidth disabled={off} onClick={() => setPicking(true)}>
            Choose image
          </Button>
        )}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          Recommended 1200 × 630
        </Typography>
      </Box>
      <Box>
        <FieldHead label="Sharing title" htmlFor="seo-og-title" />
        <TextField id="seo-og-title" disabled={off} value={seo.ogTitle ?? ''} placeholder={shownTitle} onChange={(e) => set({ ogTitle: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
      </Box>
      <Box>
        <FieldHead label="Sharing description" htmlFor="seo-og-description" />
        <TextField id="seo-og-description" disabled={off} multiline minRows={2} maxRows={5} value={seo.ogDescription ?? ''} placeholder={seo.description ?? ''} onChange={(e) => set({ ogDescription: e.target.value })} slotProps={{ htmlInput: { maxLength: 500 } }} />
      </Box>
      <Box>
        <FieldHead label="Twitter / X card" htmlFor="seo-twitter" />
        <TextField id="seo-twitter" select disabled={off} value={seo.twitterCard ?? ''} onChange={(e) => set({ twitterCard: (e.target.value || undefined) as SeoData['twitterCard'] })} slotProps={{ select: { displayEmpty: true } }}>
          <MenuItem value="">Default</MenuItem>
          <MenuItem value="summary">Summary</MenuItem>
          <MenuItem value="summary_large_image">Summary with large image</MenuItem>
        </TextField>
      </Box>

      <Box sx={{ pt: 2, borderTop: 1, borderColor: 'border.subtle' }}>
        <Typography variant="subtitle2" sx={{ fontSize: '0.8125rem', mb: 0.5 }}>
          Structured data (JSON-LD)
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          Delivered with the page for your frontend to place in a script tag.
        </Typography>
        <JsonEditor value={seo.jsonLd ?? null} readOnly={off} minHeight={110} maxHeight={280} ariaLabel="Structured data" onChange={(value) => set({ jsonLd: value && typeof value === 'object' ? value : undefined })} />
      </Box>

      <MediaPickerDialog
        open={picking}
        kind="image"
        onClose={() => setPicking(false)}
        selected={seo.ogImage ? [seo.ogImage] : []}
        onSelect={([asset]) => {
          if (asset) set({ ogImage: asset.id });
        }}
      />
    </Stack>
  );
}
