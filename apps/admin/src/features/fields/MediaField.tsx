import { type DragEvent, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import CheckCircle from '@mui/icons-material/CheckCircle';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import FolderZipOutlined from '@mui/icons-material/FolderZipOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import { useWorkspace } from '@/app/workspace';
import { EmptyState, ErrorState, SearchInput, useDebounced } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { MediaAsset, Page } from '@/lib/types';
import { toast } from '@/store';

export type MediaKindFilter = 'image' | 'video' | 'document' | 'any';

/** Thumbnail URL for an asset. Raster images are resized by the media service; other files have no thumbnail. */
export function thumbUrl(asset: Pick<MediaAsset, 'url' | 'mimeType' | 'kind'>, size = 320): string | null {
  if (asset.kind !== 'image') return null;
  if (asset.mimeType === 'image/svg+xml' || asset.mimeType === 'image/gif') return asset.url;
  return `${asset.url}?w=${size}&h=${size}&fit=cover&format=webp&q=72`;
}

export function AssetThumb({ asset, size = 96, radius = 8, fit = 'cover' }: { asset: Pick<MediaAsset, 'url' | 'mimeType' | 'kind' | 'alt' | 'filename'>; size?: number | string; radius?: number; fit?: 'cover' | 'contain' }) {
  const src = thumbUrl(asset, typeof size === 'number' ? Math.min(640, size * 2) : 480);
  const Icon = asset.kind === 'video' ? MovieOutlined : asset.kind === 'archive' ? FolderZipOutlined : DescriptionOutlined;
  return (
    <Box
      sx={{
        width: size,
        aspectRatio: '1 / 1',
        borderRadius: `${radius}px`,
        overflow: 'hidden',
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'surface.sunken',
        color: 'text.disabled',
        // A checkerboard makes transparent images readable on either theme.
        backgroundImage: src ? 'repeating-conic-gradient(rgba(128,128,128,0.10) 0% 25%, transparent 0% 50%)' : 'none',
        backgroundSize: '12px 12px',
      }}
    >
      {src ? <Box component="img" src={src} alt={asset.alt || asset.filename} loading="lazy" sx={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} /> : <Icon sx={{ fontSize: 26 }} />}
    </Box>
  );
}

/** Resolves a list of asset ids into asset records with one request. */
export function useAssets(ids: string[]) {
  const { project, projectBase } = useWorkspace();
  const key = [...new Set(ids)].sort().join(',');
  return useQuery({
    queryKey: ['media-by-id', project?.id, key],
    queryFn: () => api.get<Page<MediaAsset>>(`${projectBase}/media`, { ids: key }).then((r) => new Map(r.items.map((a) => [a.id, a]))),
    enabled: !!project && key.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

interface UploadState {
  progress: number;
  count: number;
}

/** Matches the API's per-request file limit. */
const UPLOAD_BATCH = 10;

/** Uploads files to the project's media library and reports per-file problems. */
export function useUpload(onUploaded?: (assets: MediaAsset[]) => void) {
  const { projectBase, project } = useWorkspace();
  const queryClient = useQueryClient();
  const [state, setState] = useState<UploadState | null>(null);
  const [problems, setProblems] = useState<{ filename: string; message: string }[]>([]);

  const upload = useCallback(
    async (files: File[], folderId?: string | null) => {
      if (files.length === 0) return;
      setProblems([]);
      setState({ progress: 0, count: files.length });
      const items: MediaAsset[] = [];
      const errors: { filename: string; message: string }[] = [];
      // The API accepts a limited number of files per request, so large drops go up in batches.
      const batches: File[][] = [];
      for (let i = 0; i < files.length; i += UPLOAD_BATCH) batches.push(files.slice(i, i + UPLOAD_BATCH));
      try {
        for (const [index, batch] of batches.entries()) {
          const form = new FormData();
          for (const file of batch) form.append('files', file);
          if (folderId) form.append('folderId', folderId);
          try {
            const result = await api.upload<{ items: MediaAsset[]; errors: { filename: string; message: string }[] }>(`${projectBase}/media`, form, (progress) =>
              setState({ progress: (index + progress) / batches.length, count: files.length }),
            );
            items.push(...(result.items ?? []));
            errors.push(...(result.errors ?? []));
          } catch (err) {
            errors.push({ filename: batch.length === 1 ? batch[0].name : `${batch.length} files`, message: errorMessage(err) });
          }
        }
        setProblems(errors);
        const fresh = items.filter((a) => !a.duplicate);
        const duplicates = items.length - fresh.length;
        if (items.length) {
          toast.success(
            `${fresh.length ? `${fresh.length} file${fresh.length === 1 ? '' : 's'} uploaded` : ''}${fresh.length && duplicates ? ', ' : ''}${duplicates ? `${duplicates} already in the library` : ''}`,
          );
          await queryClient.invalidateQueries({ queryKey: ['media', project?.id] });
          await queryClient.invalidateQueries({ queryKey: ['media-stats', project?.id] });
          onUploaded?.(items);
        }
      } finally {
        setState(null);
      }
    },
    [projectBase, project?.id, queryClient, onUploaded],
  );

  return { upload, uploading: state, problems, clearProblems: () => setProblems([]) };
}

export function UploadProblems({ problems, onClose }: { problems: { filename: string; message: string }[]; onClose: () => void }) {
  if (problems.length === 0) return null;
  return (
    <Alert severity="error" onClose={onClose} sx={{ alignItems: 'flex-start', '& .MuiAlert-message': { py: 1 } }}>
      {problems.length === 1 ? problems[0].message : `${problems.length} files could not be uploaded:`}
      {problems.length > 1 && (
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 4 }}>
          {problems.map((p, i) => (
            <li key={i}>{p.message}</li>
          ))}
        </Box>
      )}
    </Alert>
  );
}

/** Drop target + browse button. Children render inside; the overlay appears while dragging files over it. */
export function Dropzone({ onFiles, disabled, children, compact }: { onFiles: (files: File[]) => void; disabled?: boolean; children?: ReactNode; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <Box
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!disabled && hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      sx={{ position: 'relative' }}
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      {children ?? (
        <ButtonBase
          disabled={disabled}
          onClick={() => input.current?.click()}
          sx={{ width: '100%', py: compact ? 5 : 10, px: 4, borderRadius: '10px', border: '1.5px dashed', borderColor: 'border.strong', flexDirection: 'column', gap: 1.5, color: 'text.secondary', bgcolor: 'surface.subtle', '&:hover': { borderColor: 'secondary.main', bgcolor: 'action.hover' } }}
        >
          <CloudUploadOutlined sx={{ fontSize: 26, color: 'text.disabled' }} />
          <Typography variant="subtitle2" color="text.primary">
            Drop files here or click to browse
          </Typography>
          <Typography variant="caption">Images, video, PDF and office documents</Typography>
        </ButtonBase>
      )}
      {over && (
        <Box sx={{ position: 'absolute', inset: 0, zIndex: 5, borderRadius: '10px', border: '2px dashed', borderColor: 'secondary.main', bgcolor: 'action.selected', display: 'grid', placeItems: 'center', pointerEvents: 'none', backdropFilter: 'blur(1px)' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Drop to upload
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export function browseFiles(onFiles: (files: File[]) => void, accept?: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;
  input.onchange = () => onFiles(Array.from(input.files ?? []));
  input.click();
}

// ─── Picker dialog ───────────────────────────────────────────────────────────

export interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (assets: MediaAsset[]) => void;
  multiple?: boolean;
  kind?: MediaKindFilter;
  /** Ids already chosen, shown as selected when the dialog opens. */
  selected?: string[];
}

export function MediaPickerDialog({ open, onClose, onSelect, multiple, kind = 'any', selected = [] }: MediaPickerProps) {
  const { project, projectBase, can } = useWorkspace();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MediaKindFilter>(kind);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Map<string, MediaAsset>>(new Map());
  const term = useDebounced(search, 250);
  const pageSize = 40;

  const query = useQuery({
    queryKey: ['media', project?.id, 'picker', term, filter, page],
    queryFn: () => api.get<Page<MediaAsset>>(`${projectBase}/media`, { search: term, kind: filter === 'any' ? undefined : filter, page, pageSize }),
    enabled: open && !!project,
    placeholderData: keepPreviousData,
  });

  const toggle = (asset: MediaAsset) => {
    if (!multiple) {
      onSelect([asset]);
      onClose();
      return;
    }
    setPicked((current) => {
      const next = new Map(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.set(asset.id, asset);
      return next;
    });
  };

  const { upload, uploading, problems, clearProblems } = useUpload((assets) => {
    // Freshly uploaded files are selected straight away — that is almost always why they were uploaded.
    const usable = assets.filter((a) => filter === 'any' || a.kind === filter);
    if (!multiple && usable[0]) {
      onSelect([usable[0]]);
      onClose();
    } else if (multiple) {
      setPicked((current) => new Map([...current, ...usable.map((a) => [a.id, a] as const)]));
    }
  });

  const items = query.data?.items ?? [];
  const already = useMemo(() => new Set(selected), [selected]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      aria-labelledby="media-picker-title"
      slotProps={{ transition: { onExited: () => { setPicked(new Map()); setSearch(''); setPage(1); clearProblems(); } } }}
    >
      <DialogTitle id="media-picker-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {multiple ? 'Choose files' : 'Choose a file'}
        <IconButton aria-label="Close" onClick={onClose} edge="end">
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 440 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search files…" width="100%" autoFocus />
          {kind === 'any' && (
            <TextField select value={filter} onChange={(e) => { setFilter(e.target.value as MediaKindFilter); setPage(1); }} sx={{ width: { sm: 160 }, flexShrink: 0 }} slotProps={{ htmlInput: { 'aria-label': 'File type' } }}>
              <MenuItem value="any">All types</MenuItem>
              <MenuItem value="image">Images</MenuItem>
              <MenuItem value="video">Video</MenuItem>
              <MenuItem value="document">Documents</MenuItem>
            </TextField>
          )}
          {can('media.upload') && (
            <Button variant="outlined" startIcon={<CloudUploadOutlined />} onClick={() => browseFiles((files) => void upload(files))} disabled={!!uploading} sx={{ flexShrink: 0 }}>
              Upload
            </Button>
          )}
        </Stack>
        {uploading && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Uploading {uploading.count} file{uploading.count === 1 ? '' : 's'}… {Math.round(uploading.progress * 100)}%
            </Typography>
            <LinearProgress variant="determinate" value={uploading.progress * 100} color="secondary" sx={{ mt: 1 }} />
          </Box>
        )}
        <UploadProblems problems={problems} onClose={clearProblems} />
        <Dropzone onFiles={(files) => void upload(files)} disabled={!can('media.upload') || !!uploading}>
          <Box sx={{ minHeight: 300 }}>
            {query.isLoading ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 3 }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <Skeleton key={i} variant="rounded" sx={{ aspectRatio: '1 / 1', height: 'auto' }} />
                ))}
              </Box>
            ) : query.isError ? (
              <ErrorState compact error={query.error} onRetry={() => void query.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                compact
                icon={<PhotoLibraryOutlined />}
                title={term ? 'No files match your search' : 'The media library is empty'}
                description={can('media.upload') ? 'Drop files here or use Upload to add some.' : 'Ask someone with upload rights to add files.'}
              />
            ) : (
              <Box role="listbox" aria-multiselectable={multiple} aria-label="Media files" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 3 }}>
                {items.map((asset) => {
                  const isPicked = picked.has(asset.id) || (!multiple && already.has(asset.id));
                  return (
                    <ButtonBase
                      key={asset.id}
                      role="option"
                      aria-selected={isPicked}
                      onClick={() => toggle(asset)}
                      sx={{ flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', borderRadius: '10px', p: 1, border: 2, borderColor: isPicked ? 'secondary.main' : 'transparent', position: 'relative', '&:hover': { bgcolor: 'action.hover' } }}
                    >
                      <AssetThumb asset={asset} size="100%" />
                      {isPicked && <CheckCircle sx={{ position: 'absolute', top: 8, right: 8, fontSize: 20, color: 'secondary.main', bgcolor: 'background.paper', borderRadius: '50%' }} />}
                      <Typography variant="caption" noWrap sx={{ mt: 1, px: 0.5, fontWeight: 500 }} title={asset.filename}>
                        {asset.filename}
                      </Typography>
                      <Typography variant="caption" color="text.disabled" noWrap sx={{ px: 0.5 }}>
                        {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                        {formatBytes(asset.size)}
                      </Typography>
                    </ButtonBase>
                  );
                })}
              </Box>
            )}
          </Box>
        </Dropzone>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <IconButton aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ArrowBackOutlined />
          </IconButton>
          <Typography variant="caption" color="text.secondary">
            Page {query.data?.meta.page ?? 1} of {query.data?.meta.pageCount ?? 1}
          </Typography>
          <IconButton aria-label="Next page" disabled={page >= (query.data?.meta.pageCount ?? 1)} onClick={() => setPage((p) => p + 1)}>
            <ArrowForwardOutlined />
          </IconButton>
        </Stack>
        <Stack direction="row" spacing={2}>
          <Button onClick={onClose}>Cancel</Button>
          {multiple && (
            <Button
              variant="contained"
              disabled={picked.size === 0}
              onClick={() => {
                onSelect([...picked.values()]);
                onClose();
              }}
            >
              Add {picked.size || ''} file{picked.size === 1 ? '' : 's'}
            </Button>
          )}
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

// ─── Form field ──────────────────────────────────────────────────────────────

const KIND_FOR_TYPE: Record<string, MediaKindFilter> = { image: 'image', images: 'image', video: 'video', file: 'any', files: 'any' };

export function MediaField({
  type,
  value,
  onChange,
  disabled,
  invalid,
}: {
  type: 'image' | 'images' | 'video' | 'file' | 'files';
  value: unknown;
  onChange: (value: string | string[] | null) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const multiple = type === 'images' || type === 'files';
  const ids = useMemo(() => (multiple ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === 'string' && value ? [value] : []), [value, multiple]);
  const assets = useAssets(ids);
  const [open, setOpen] = useState(false);
  const kind = KIND_FOR_TYPE[type];
  const noun = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'file';

  const select = (chosen: MediaAsset[]) => {
    if (multiple) onChange([...new Set([...ids, ...chosen.map((a) => a.id)])]);
    else onChange(chosen[0]?.id ?? null);
  };
  const move = (index: number, delta: number) => {
    const next = [...ids];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  return (
    <Box>
      {ids.length === 0 ? (
        <ButtonBase
          disabled={disabled}
          onClick={() => setOpen(true)}
          sx={{ width: '100%', py: 5, borderRadius: '8px', border: '1.5px dashed', borderColor: invalid ? 'error.main' : 'border.strong', gap: 2, color: 'text.secondary', fontSize: '0.8125rem', bgcolor: 'surface.subtle', '&:hover': { borderColor: 'secondary.main', color: 'text.primary' } }}
        >
          <AddPhotoAlternateOutlined sx={{ fontSize: 18 }} />
          Choose {multiple ? `${noun}s` : `${noun === 'image' ? 'an' : 'a'} ${noun}`}
        </ButtonBase>
      ) : multiple ? (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2.5 }}>
          {ids.map((id, index) => {
            const asset = assets.data?.get(id);
            return (
              <Box key={id} sx={{ position: 'relative', width: 96, '&:hover .media-actions, &:focus-within .media-actions': { opacity: 1 } }}>
                {asset ? <AssetThumb asset={asset} size={96} /> : assets.isLoading ? <Skeleton variant="rounded" width={96} height={96} /> : <MissingAsset />}
                <Typography variant="caption" noWrap component="div" color="text.secondary" sx={{ mt: 0.5 }} title={asset?.filename}>
                  {asset?.filename ?? 'Missing file'}
                </Typography>
                {!disabled && (
                  <Stack className="media-actions" direction="row" sx={{ position: 'absolute', top: 4, left: 4, right: 4, justifyContent: 'space-between', opacity: 0, transition: 'opacity 120ms' }}>
                    <Stack direction="row" sx={{ bgcolor: 'background.paper', borderRadius: '6px', border: 1, borderColor: 'border.subtle' }}>
                      <IconButton size="small" aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, -1)} sx={{ p: 0.5 }}>
                        <ArrowBackOutlined sx={{ fontSize: '14px !important' }} />
                      </IconButton>
                      <IconButton size="small" aria-label="Move later" disabled={index === ids.length - 1} onClick={() => move(index, 1)} sx={{ p: 0.5 }}>
                        <ArrowForwardOutlined sx={{ fontSize: '14px !important' }} />
                      </IconButton>
                    </Stack>
                    <IconButton size="small" aria-label={`Remove ${asset?.filename ?? 'file'}`} onClick={() => onChange(ids.filter((x) => x !== id))} sx={{ p: 0.5, bgcolor: 'background.paper', border: 1, borderColor: 'border.subtle', '&:hover': { bgcolor: 'background.paper', color: 'error.main' } }}>
                      <CloseOutlined sx={{ fontSize: '14px !important' }} />
                    </IconButton>
                  </Stack>
                )}
              </Box>
            );
          })}
          {!disabled && (
            <ButtonBase onClick={() => setOpen(true)} aria-label={`Add ${noun}s`} sx={{ width: 96, height: 96, borderRadius: '8px', border: '1.5px dashed', borderColor: 'border.strong', color: 'text.secondary', '&:hover': { borderColor: 'secondary.main', color: 'text.primary' } }}>
              <AddPhotoAlternateOutlined />
            </ButtonBase>
          )}
        </Stack>
      ) : (
        <Stack direction="row" spacing={3} sx={{ alignItems: 'center', p: 2, border: 1, borderColor: invalid ? 'error.main' : 'border.strong', borderRadius: '8px', bgcolor: 'background.paper' }}>
          {assets.data?.get(ids[0]) ? <AssetThumb asset={assets.data.get(ids[0]) as MediaAsset} size={64} /> : assets.isLoading ? <Skeleton variant="rounded" width={64} height={64} /> : <MissingAsset size={64} />}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" noWrap>
              {assets.data?.get(ids[0])?.filename ?? (assets.isLoading ? 'Loading…' : 'This file no longer exists')}
            </Typography>
            {assets.data?.get(ids[0]) && (
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {(() => {
                  const a = assets.data.get(ids[0]) as MediaAsset;
                  return `${a.width && a.height ? `${a.width}×${a.height} · ` : ''}${formatBytes(a.size)}${a.alt ? ` · “${a.alt}”` : kind === 'image' ? ' · no alt text' : ''}`;
                })()}
              </Typography>
            )}
          </Box>
          {!disabled && (
            <>
              <Tooltip title="Replace">
                <IconButton aria-label="Replace file" onClick={() => setOpen(true)}>
                  <SwapHorizOutlined />
                </IconButton>
              </Tooltip>
              <Tooltip title="Remove">
                <IconButton aria-label="Remove file" onClick={() => onChange(null)}>
                  <CloseOutlined />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Stack>
      )}
      <MediaPickerDialog open={open} onClose={() => setOpen(false)} onSelect={select} multiple={multiple} kind={kind} selected={ids} />
    </Box>
  );
}

function MissingAsset({ size = 96 }: { size?: number }) {
  return (
    <Tooltip title="This file was deleted from the media library">
      <Box sx={{ width: size, height: size, borderRadius: '8px', border: '1px dashed', borderColor: 'error.main', color: 'error.main', display: 'grid', placeItems: 'center', fontSize: '0.6875rem', textAlign: 'center', p: 1 }}>Missing</Box>
    </Tooltip>
  );
}
