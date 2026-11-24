import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FolderZipOutlined from '@mui/icons-material/FolderZipOutlined';
import LinkOutlined from '@mui/icons-material/LinkOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import RestoreFromTrashOutlined from '@mui/icons-material/RestoreFromTrashOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import { formatBytes } from '@meridian/shared';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CopyButton, ErrorState, Mono, RelativeTime, StatusChip, useCopy, useDebounced } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { GuestNote } from '@/features/guest/guest';
import { fullDateTime } from '@/lib/format';
import { isGuestMode, loadDemo } from '@/lib/guest';
import type { MediaAsset, MediaFolder, MediaUsage } from '@/lib/types';
import { toast } from '@/store';

const TAG_PATTERN = /^[a-z0-9][a-z0-9 _-]*$/;
const TRANSFORMABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** Normalises free-typed tags to what the API accepts and reports the ones that cannot be used. */
export function cleanTags(input: string[]): { tags: string[]; rejected: string[] } {
  const tags: string[] = [];
  const rejected: string[] = [];
  for (const raw of input) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tag.length > 40 || !TAG_PATTERN.test(tag)) rejected.push(raw.trim());
    else if (!tags.includes(tag)) tags.push(tag);
  }
  return { tags: tags.slice(0, 30), rejected };
}

function splitName(filename: string): { stem: string; extension: string } {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? { stem: filename.slice(0, dot), extension: filename.slice(dot + 1) } : { stem: filename, extension: '' };
}

function Heading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
      <Typography variant="overline" color="text.secondary" component="h3">
        {children}
      </Typography>
      {action}
    </Stack>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={3} sx={{ py: 1.5, justifyContent: 'space-between', alignItems: 'baseline', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Stack>
  );
}

function UsageList({ usages }: { usages: MediaUsage[] }) {
  const ws = useProject();
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'hidden' }}>
      {usages.map((usage) => {
        const envKey = ws.project.environments.find((e) => e.id === usage.environmentId)?.key;
        const to = envKey ? ws.hrefFor(ws.project, envKey, usage.isPage ? `pages/${usage.entryId}` : `content/${usage.contentType}/${usage.entryId}`) : null;
        const row = (
          <>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                {usage.title ?? 'Untitled'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {usage.isPage ? 'Page' : usage.contentTypeName} · {usage.environment}
              </Typography>
            </Box>
            <StatusChip status={usage.status} />
          </>
        );
        const sx = { width: '100%', px: 3, py: 2, gap: 3, justifyContent: 'flex-start', textAlign: 'left', color: 'text.primary', textDecoration: 'none !important' } as const;
        return (
          <Box component="li" key={`${usage.entryId}-${usage.environmentId}`} sx={{ '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
            {to ? (
              <ButtonBase component={RouterLink} to={to} sx={{ ...sx, '&:hover': { bgcolor: 'action.hover' } }}>
                {row}
              </ButtonBase>
            ) : (
              <Stack direction="row" sx={{ ...sx, alignItems: 'center' }}>
                {row}
              </Stack>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Transform & export ──────────────────────────────────────────────────────

const FITS = [
  { value: 'cover', label: 'Cover — fill the box, crop the overflow' },
  { value: 'contain', label: 'Contain — fit inside, letterbox' },
  { value: 'inside', label: 'Inside — fit inside, keep proportions' },
  { value: 'outside', label: 'Outside — cover the box, keep proportions' },
  { value: 'fill', label: 'Fill — stretch to the exact size' },
];
const POSITIONS = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'entropy', label: 'Smart — most detail' },
  { value: 'attention', label: 'Smart — focal point' },
];
const FORMATS = [
  { value: '', label: 'Original format' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' },
];
const PRESETS = [
  { label: 'Thumbnail', w: '320', h: '320', fit: 'cover', format: 'webp', q: 72 },
  { label: 'Card', w: '640', h: '360', fit: 'cover', format: 'webp', q: 78 },
  { label: 'Social share', w: '1200', h: '630', fit: 'cover', format: 'jpeg', q: 82 },
  { label: 'Full width', w: '1600', h: '', fit: 'inside', format: 'webp', q: 80 },
];

const dimension = (raw: string): string => {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  return String(Math.min(4096, Math.max(1, Number(digits))));
};

/**
 * Builds a media-service URL for a resized, cropped, converted or recompressed variant.
 * Variants are generated on first request and cached, so the URL can be used anywhere.
 */
function TransformPanel({ asset }: { asset: MediaAsset }) {
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  const [fit, setFit] = useState('cover');
  const [position, setPosition] = useState('center');
  const [format, setFormat] = useState('');
  const [q, setQ] = useState(80);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [copied, copy] = useCopy();

  const outputFormat = format || asset.mimeType.replace('image/', '');
  const active = !!(w || h || format);
  const url = useMemo(() => {
    if (!active) return asset.url;
    const query = new URLSearchParams();
    if (w) query.set('w', w);
    if (h) query.set('h', h);
    if (w || h) {
      query.set('fit', fit);
      if (fit === 'cover' || fit === 'contain') query.set('position', position);
    }
    if (format) query.set('format', format);
    if (outputFormat !== 'png') query.set('q', String(q));
    return `${asset.url}?${query.toString()}`;
  }, [active, asset.url, w, h, fit, position, format, outputFormat, q]);
  const previewUrl = useDebounced(url, 350);

  useEffect(() => setNatural(null), [previewUrl]);

  const guest = isGuestMode();
  const variant = useQuery({
    queryKey: ['media-variant', previewUrl],
    queryFn: async (): Promise<{ size: number; src: string }> => {
      if (guest) {
        // There is no media service in guest mode: the browser renders the variant itself.
        const rendered = await (await loadDemo()).transformImage(previewUrl);
        return { size: rendered.size, src: rendered.url };
      }
      const res = await fetch(previewUrl);
      if (!res.ok) throw new Error(`The media service answered ${res.status}`);
      return { size: (await res.blob()).size, src: previewUrl };
    },
    enabled: active && previewUrl === url,
    staleTime: Infinity,
    retry: false,
  });
  const variantSize = variant.data?.size;
  // The server's variant has its own URL; a guest-mode variant only exists once the browser has rendered it.
  const variantSrc = guest ? variant.data?.src : previewUrl;
  const saving = variantSize !== undefined && asset.size > 0 ? Math.round((1 - variantSize / asset.size) * 100) : null;

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Resize, crop, convert or compress on delivery. The original file is never changed — each variant has its own cacheable URL.
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mb: 3 }}>
        {PRESETS.map((preset) => (
          <Chip
            key={preset.label}
            label={preset.label}
            variant="outlined"
            onClick={() => {
              setW(preset.w);
              setH(preset.h);
              setFit(preset.fit);
              setFormat(preset.format);
              setQ(preset.q);
            }}
          />
        ))}
        {active && (
          <Chip
            label="Reset"
            onClick={() => {
              setW('');
              setH('');
              setFormat('');
              setFit('cover');
              setPosition('center');
              setQ(80);
            }}
          />
        )}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        <TextField label="Width" value={w} onChange={(e) => setW(dimension(e.target.value))} placeholder={asset.width ? String(asset.width) : 'auto'} slotProps={{ htmlInput: { inputMode: 'numeric' }, input: { endAdornment: <InputAdornment position="end">px</InputAdornment> } }} />
        <TextField label="Height" value={h} onChange={(e) => setH(dimension(e.target.value))} placeholder={asset.height ? String(asset.height) : 'auto'} slotProps={{ htmlInput: { inputMode: 'numeric' }, input: { endAdornment: <InputAdornment position="end">px</InputAdornment> } }} />
        <TextField select label="Fit" value={fit} onChange={(e) => setFit(e.target.value)} disabled={!w && !h} sx={{ gridColumn: 'span 2' }}>
          {FITS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Crop position" value={position} onChange={(e) => setPosition(e.target.value)} disabled={(!w && !h) || (fit !== 'cover' && fit !== 'contain')}>
          {POSITIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Format" value={format} onChange={(e) => setFormat(e.target.value)} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
          {FORMATS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <Box sx={{ mt: 3, px: 1 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary" id="transform-quality">
            Quality
          </Typography>
          <Typography variant="caption" color={outputFormat === 'png' ? 'text.disabled' : 'text.primary'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {outputFormat === 'png' ? 'Lossless (PNG)' : q}
          </Typography>
        </Stack>
        <Slider size="small" color="secondary" min={1} max={100} value={q} disabled={outputFormat === 'png'} onChange={(_, value) => setQ(value as number)} aria-labelledby="transform-quality" />
      </Box>

      {active ? (
        <Box sx={{ mt: 2 }}>
          <Box
            sx={{
              position: 'relative',
              borderRadius: '8px',
              border: 1,
              borderColor: 'border.subtle',
              bgcolor: 'surface.sunken',
              backgroundImage: 'repeating-conic-gradient(rgba(128,128,128,0.10) 0% 25%, transparent 0% 50%)',
              backgroundSize: '12px 12px',
              display: 'grid',
              placeItems: 'center',
              minHeight: 140,
              maxHeight: 300,
              overflow: 'hidden',
            }}
          >
            {variant.isError ? (
              <Typography variant="body2" color="error" sx={{ p: 4, textAlign: 'center' }}>
                {errorMessage(variant.error, 'This variant could not be generated.')}
              </Typography>
            ) : !variantSrc ? null : (
              <Box
                component="img"
                key={variantSrc}
                src={variantSrc}
                alt={`Preview of ${asset.filename} with the chosen transformation`}
                onLoad={(e: React.SyntheticEvent<HTMLImageElement>) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                sx={{ maxWidth: '100%', maxHeight: 300, display: 'block', objectFit: 'contain' }}
              />
            )}
            {(variant.isFetching || previewUrl !== url) && <LinearProgress color="secondary" sx={{ position: 'absolute', left: 0, right: 0, top: 0, height: 2 }} />}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
            {natural ? `${natural.width} × ${natural.height} px` : 'Generating…'}
            {variantSize !== undefined && ` · ${formatBytes(variantSize)}`}
            {saving !== null && saving > 0 && ` · ${saving}% smaller than the original`}
            {saving !== null && saving < 0 && ` · ${Math.abs(saving)}% larger than the original`}
          </Typography>
          <GuestNote sx={{ mt: 2 }}>
            Guest mode renders this variant in your browser, so it has no address to copy, smart cropping falls back to the centre, and only formats this browser can encode are available. On a server every variant has its own cacheable URL.
          </GuestNote>
          <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center', border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'surface.subtle', pl: 2.5, pr: 1, py: 1, display: guest ? 'none' : 'flex' }}>
            <Mono sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</Mono>
            <Tooltip title={copied ? 'Copied' : 'Copy variant URL'}>
              <IconButton size="small" aria-label="Copy variant URL" onClick={() => copy(url)}>
                {copied ? <CheckOutlined sx={{ color: 'success.main' }} /> : <LinkOutlined />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Open in a new tab">
              <IconButton size="small" aria-label="Open variant in a new tab" component="a" href={url} target="_blank" rel="noopener noreferrer">
                <OpenInNewOutlined />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          Choose a preset, a size or a format to generate a variant.
        </Typography>
      )}
    </Box>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

export interface AssetDrawerProps {
  assetId: string | null;
  onClose: () => void;
  folders: MediaFolder[];
  knownTags: string[];
  /** Called after any change so the library can refresh its lists and counters. */
  onChanged: () => Promise<unknown> | void;
}

export function AssetDrawer({ assetId, onClose, folders, knownTags, onChanged }: AssetDrawerProps) {
  const ws = useProject();
  const confirm = useConfirm();
  const canManage = ws.can('media.manage');
  const fileInput = useRef<HTMLInputElement>(null);
  const [copied, copy] = useCopy();
  const [replaceProgress, setReplaceProgress] = useState<number | null>(null);

  const detail = useQuery({
    queryKey: ['media', ws.project.id, 'detail', assetId],
    queryFn: () => api.get<MediaAsset>(`${ws.projectBase}/media/${assetId}`),
    enabled: !!assetId,
  });
  const asset = detail.data;
  const path = `${ws.projectBase}/media/${assetId}`;
  const trashed = !!asset?.deletedAt;

  const [stem, setStem] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [folderId, setFolderId] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);
  const name = useMemo(() => splitName(asset?.filename ?? ''), [asset?.filename]);

  // Reset the form whenever another asset is opened or the server copy changes.
  useEffect(() => {
    if (!asset) return;
    setStem(splitName(asset.filename).stem);
    setAlt(asset.alt);
    setCaption(asset.caption);
    setTags(asset.tags);
    setFolderId(asset.folderId ?? '');
    setTagError(null);
  }, [asset?.id, asset?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = useMemo(() => {
    if (!asset) return {};
    const patch: Record<string, unknown> = {};
    if (stem.trim() && stem.trim() !== name.stem) patch.filename = stem.trim();
    if (alt.trim() !== asset.alt) patch.alt = alt.trim();
    if (caption.trim() !== asset.caption) patch.caption = caption.trim();
    if (JSON.stringify(tags) !== JSON.stringify(asset.tags)) patch.tags = tags;
    if ((folderId || null) !== asset.folderId) patch.folderId = folderId || null;
    return patch;
  }, [asset, stem, alt, caption, tags, folderId, name.stem]);
  const dirty = Object.keys(changes).length > 0;

  const save = useMutation({
    mutationFn: () => api.patch<MediaAsset>(path, changes),
    onSuccess: async () => {
      toast.success('File details saved');
      await onChanged();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const restore = useMutation({
    mutationFn: () => api.post(`${path}/restore`),
    onSuccess: async () => {
      toast.success('File restored');
      await onChanged();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const replace = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    setReplaceProgress(0);
    try {
      await api.upload<MediaAsset>(`${path}/replace`, form, setReplaceProgress);
      toast.success('File replaced. Everything that references it now uses the new version.');
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReplaceProgress(null);
    }
  };

  const remove = async () => {
    if (!asset) return;
    const usages = asset.usages ?? [];
    const done = await confirm({
      title: usages.length ? 'This file is in use' : 'Move this file to the trash?',
      destructive: true,
      confirmLabel: usages.length ? 'Delete anyway' : 'Move to trash',
      message: usages.length ? (
        <>
          <Box sx={{ mb: 3 }}>
            <b>{asset.filename}</b> is used by {usages.length} {usages.length === 1 ? 'entry' : 'entries'}. If you delete it, those places will show no file until someone picks a new one.
          </Box>
          <UsageList usages={usages.slice(0, 6)} />
          {usages.length > 6 && <Box sx={{ mt: 2 }}>…and {usages.length - 6} more.</Box>}
        </>
      ) : (
        <>
          <b>{asset.filename}</b> will stop being delivered. You can restore it from the trash.
        </>
      ),
      onConfirm: async () => {
        try {
          await api.delete(path, usages.length ? { force: 'true' } : undefined);
        } catch (err) {
          // Someone started using the file after this drawer loaded: show the fresh usage list.
          if (err instanceof ApiError && err.status === 409) await detail.refetch();
          throw err;
        }
      },
    });
    if (done) {
      toast.success('File moved to the trash');
      onClose();
      await onChanged();
    }
  };

  const purge = async () => {
    if (!asset) return;
    const done = await confirm({
      title: 'Delete this file permanently?',
      message: (
        <>
          <b>{asset.filename}</b> will be removed from storage. This cannot be undone.
        </>
      ),
      destructive: true,
      confirmLabel: 'Delete permanently',
      onConfirm: () => api.delete(path, { permanent: 'true' }),
    });
    if (done) {
      toast.success('File deleted permanently');
      onClose();
      await onChanged();
    }
  };

  const Icon = asset?.kind === 'archive' ? FolderZipOutlined : DescriptionOutlined;
  const previewSrc = asset && asset.kind === 'image' ? (TRANSFORMABLE.includes(asset.mimeType) ? `${asset.url}?w=960&fit=inside&format=webp&q=80` : asset.url) : null;

  return (
    <Drawer anchor="right" open={!!assetId} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 480 }, display: 'flex', flexDirection: 'column' } } }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center', px: 5, height: 52, flexShrink: 0, borderBottom: 1, borderColor: 'border.subtle' }}>
        <Typography variant="h5" component="h2" noWrap sx={{ flex: 1 }}>
          {asset?.filename ?? 'File details'}
        </Typography>
        <IconButton aria-label="Close file details" onClick={onClose} edge="end">
          <CloseOutlined />
        </IconButton>
      </Stack>
      {replaceProgress !== null && <LinearProgress variant="determinate" value={replaceProgress * 100} color="secondary" aria-label="Replacing file" />}

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {detail.isLoading ? (
          <Box sx={{ p: 5 }} aria-busy="true">
            <Skeleton variant="rounded" height={240} />
            <Skeleton variant="rounded" height={36} sx={{ mt: 4 }} />
            <Skeleton variant="rounded" height={36} sx={{ mt: 3 }} />
            <Skeleton variant="rounded" height={80} sx={{ mt: 3 }} />
          </Box>
        ) : detail.isError || !asset ? (
          <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <Box
              sx={{
                m: 5,
                mb: 4,
                borderRadius: '10px',
                border: 1,
                borderColor: 'border.subtle',
                bgcolor: 'surface.sunken',
                backgroundImage: previewSrc ? 'repeating-conic-gradient(rgba(128,128,128,0.10) 0% 25%, transparent 0% 50%)' : 'none',
                backgroundSize: '12px 12px',
                overflow: 'hidden',
                display: 'grid',
                placeItems: 'center',
                minHeight: 200,
              }}
            >
              {previewSrc ? (
                <Box component="img" src={previewSrc} alt={asset.alt || asset.filename} sx={{ maxWidth: '100%', maxHeight: 340, display: 'block', objectFit: 'contain' }} />
              ) : asset.kind === 'video' ? (
                <Box component="video" src={asset.url} controls preload="metadata" aria-label={asset.filename} sx={{ width: '100%', maxHeight: 340, display: 'block', bgcolor: '#000' }} />
              ) : (
                <Stack spacing={2} sx={{ alignItems: 'center', py: 8, color: 'text.disabled' }}>
                  <Icon sx={{ fontSize: 40 }} />
                  <Typography variant="body2" color="text.secondary">
                    No preview for this file type
                  </Typography>
                </Stack>
              )}
            </Box>

            <Stack direction="row" sx={{ px: 5, flexWrap: 'wrap', gap: 2 }}>
              <Button variant="outlined" size="small" startIcon={copied ? <CheckOutlined /> : <LinkOutlined />} onClick={() => copy(asset.url)}>
                {copied ? 'Copied' : 'Copy URL'}
              </Button>
              <Button variant="outlined" size="small" startIcon={<FileDownloadOutlined />} component="a" href={`${asset.url}?download=true`} download={asset.filename}>
                Download
              </Button>
              {canManage && !trashed && (
                <>
                  <Button variant="outlined" size="small" startIcon={<SwapHorizOutlined />} disabled={replaceProgress !== null} onClick={() => fileInput.current?.click()}>
                    Replace file
                  </Button>
                  <Button variant="outlined" size="small" color="error" startIcon={<DeleteOutlineOutlined />} onClick={() => void remove()} sx={{ color: 'error.main' }}>
                    Delete
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    hidden
                    accept={asset.kind === 'image' ? 'image/*' : asset.kind === 'video' ? 'video/*' : undefined}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void replace(file);
                    }}
                  />
                </>
              )}
            </Stack>

            {trashed && (
              <Alert
                severity="warning"
                sx={{ mx: 5, mt: 4, alignItems: 'flex-start' }}
                action={
                  canManage ? (
                    <Stack direction="row" spacing={1}>
                      <Button size="small" color="inherit" startIcon={<RestoreFromTrashOutlined />} loading={restore.isPending} onClick={() => restore.mutate()}>
                        Restore
                      </Button>
                      <Button size="small" color="inherit" onClick={() => void purge()}>
                        Delete permanently
                      </Button>
                    </Stack>
                  ) : undefined
                }
              >
                In the trash since {fullDateTime(asset.deletedAt)}. It is no longer delivered.
              </Alert>
            )}

            <Box sx={{ p: 5 }}>
              <Heading>Details</Heading>
              <Stack spacing={3.5}>
                <TextField
                  label="File name"
                  value={stem}
                  onChange={(e) => setStem(e.target.value)}
                  disabled={!canManage || trashed}
                  helperText={name.extension ? 'The extension always matches the file content and cannot be changed.' : undefined}
                  slotProps={{ htmlInput: { maxLength: 150 }, input: { endAdornment: name.extension ? <InputAdornment position="end">.{name.extension}</InputAdornment> : undefined } }}
                />
                <TextField
                  label="Alt text"
                  value={alt}
                  onChange={(e) => setAlt(e.target.value)}
                  disabled={!canManage || trashed}
                  multiline
                  minRows={2}
                  helperText={asset.kind === 'image' ? 'Describe the image for people who cannot see it. Delivered with every reference.' : 'A short description, delivered with every reference.'}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                />
                <TextField label="Caption" value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!canManage || trashed} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 1000 } }} />
                <Autocomplete<string, true, false, true>
                  multiple
                  freeSolo
                  autoSelect
                  disabled={!canManage || trashed}
                  options={knownTags.filter((t) => !tags.includes(t))}
                  value={tags}
                  onChange={(_, next) => {
                    const { tags: clean, rejected } = cleanTags(next);
                    setTags(clean);
                    setTagError(rejected.length ? `“${rejected[0]}” is not a valid tag. Use letters, numbers, spaces, hyphens and underscores.` : null);
                  }}
                  renderValue={(values, getItemProps) =>
                    values.map((option, index) => {
                      const { key, ...item } = getItemProps({ index });
                      return <Chip key={key} {...item} label={option} variant="outlined" />;
                    })
                  }
                  renderInput={(params) => <TextField {...params} label="Tags" placeholder={tags.length ? undefined : 'Type and press Enter'} error={!!tagError} helperText={tagError ?? undefined} />}
                />
                <TextField select label="Folder" value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={!canManage || trashed} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                  <MenuItem value="">Unfiled</MenuItem>
                  {folders.map((folder) => (
                    <MenuItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </MenuItem>
                  ))}
                </TextField>
                {canManage && !trashed && (
                  <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
                    <Button
                      disabled={!dirty || save.isPending}
                      onClick={() => {
                        setStem(name.stem);
                        setAlt(asset.alt);
                        setCaption(asset.caption);
                        setTags(asset.tags);
                        setFolderId(asset.folderId ?? '');
                        setTagError(null);
                      }}
                    >
                      Discard
                    </Button>
                    <Button variant="contained" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                      Save details
                    </Button>
                  </Stack>
                )}
              </Stack>

              <Divider sx={{ my: 5 }} />
              <Heading>Used in{asset.usages?.length ? ` · ${asset.usages.length}` : ''}</Heading>
              {asset.usages && asset.usages.length > 0 ? (
                <UsageList usages={asset.usages} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No entry or page references this file. It is safe to delete.
                </Typography>
              )}

              {TRANSFORMABLE.includes(asset.mimeType) && !trashed && (
                <>
                  <Divider sx={{ my: 5 }} />
                  <Heading>Transform &amp; export</Heading>
                  <TransformPanel key={`${asset.id}-${asset.revision}`} asset={asset} />
                </>
              )}

              <Divider sx={{ my: 5 }} />
              <Heading>File</Heading>
              <Fact label="Type">{asset.mimeType}</Fact>
              <Fact label="Size">{formatBytes(asset.size)}</Fact>
              {asset.width && asset.height && (
                <Fact label="Dimensions">
                  {asset.width} × {asset.height} px
                </Fact>
              )}
              <Fact label="Uploaded">
                <RelativeTime value={asset.createdAt} />
              </Fact>
              <Fact label="Last changed">
                <RelativeTime value={asset.updatedAt} />
              </Fact>
              <Fact label="Revision">{asset.revision}</Fact>
              <Fact label="Checksum (SHA-256)">
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Tooltip title={asset.checksum}>
                    <span>
                      <Mono>{asset.checksum.slice(0, 12)}…</Mono>
                    </span>
                  </Tooltip>
                  <CopyButton value={asset.checksum} label="Copy checksum" />
                </Stack>
              </Fact>
              <Fact label="Asset ID">
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                  <Mono>{asset.id.slice(0, 8)}…</Mono>
                  <CopyButton value={asset.id} label="Copy asset ID" />
                </Stack>
              </Fact>
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}
