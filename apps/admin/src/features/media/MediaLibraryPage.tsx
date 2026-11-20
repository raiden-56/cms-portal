import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
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
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import CreateNewFolderOutlined from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteForeverOutlined from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import DriveFileRenameOutlineOutlined from '@mui/icons-material/DriveFileRenameOutlineOutlined';
import FilterAltOffOutlined from '@mui/icons-material/FilterAltOffOutlined';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import LabelOutlined from '@mui/icons-material/LabelOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import RestoreFromTrashOutlined from '@mui/icons-material/RestoreFromTrashOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import ViewListOutlined from '@mui/icons-material/ViewListOutlined';
import { formatBytes } from '@meridian/shared';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, Page, PageHeader, Pill, RelativeTime, SearchInput, TableFooter, useDebounced } from '@/components/ui';
import { AssetThumb, Dropzone, UploadProblems, browseFiles, useUpload } from '@/features/fields/MediaField';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { MediaAsset, MediaFolder, MediaStats, Page as Paged } from '@/lib/types';
import { toast, useAppSelector } from '@/store';
import { AssetDrawer, cleanTags } from './AssetDrawer';

const KINDS = [
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Documents' },
  { value: 'archive', label: 'Archives' },
];
const KIND_LABEL: Record<string, string> = { image: 'Images', video: 'Video', document: 'Documents', archive: 'Archives', other: 'Other' };
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'largest', label: 'Largest first' },
];
const VIEW_KEY = 'meridian.mediaView';

const dimensionsOf = (asset: MediaAsset) => (asset.width && asset.height ? `${asset.width}×${asset.height}` : null);

// ─── Small dialogs ───────────────────────────────────────────────────────────

function NameDialog({
  open,
  title,
  label,
  initial = '',
  confirmLabel,
  helperText,
  validate,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  confirmLabel: string;
  helperText?: string;
  validate?: (value: string) => string | null;
  onClose: () => void;
  onSubmit: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setError(null);
      setBusy(false);
    }
  }, [open, initial]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    const problem = !next ? `${label} is required` : (validate?.(next) ?? null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await onSubmit(next);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" aria-labelledby="name-dialog-title">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogTitle id="name-dialog-title">{title}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label={label}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            error={!!error}
            helperText={error ?? helperText}
            sx={{ mt: 2 }}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={busy}>
            {confirmLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function NavRow({ label, count, icon, selected, onClick, action, depth = 0 }: { label: string; count?: number; icon: ReactNode; selected: boolean; onClick: () => void; action?: ReactNode; depth?: number }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', borderRadius: '7px', bgcolor: selected ? 'action.selected' : 'transparent', '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' }, '&:hover .folder-action, &:focus-within .folder-action': { opacity: 1 } }}>
      <ButtonBase
        onClick={onClick}
        aria-current={selected ? 'true' : undefined}
        sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 2, pl: 2 + depth * 3, pr: 1, height: 32, borderRadius: '7px', fontSize: '0.8125rem', fontWeight: selected ? 600 : 450, color: selected ? 'text.primary' : 'text.secondary', '& svg': { fontSize: 16, color: selected ? 'secondary.main' : 'inherit', flexShrink: 0 } }}
      >
        {icon}
        <Box component="span" sx={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </Box>
        {count !== undefined && (
          <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {count}
          </Typography>
        )}
      </ButtonBase>
      {action && (
        <Box className="folder-action" sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms', pr: 0.5 }}>
          {action}
        </Box>
      )}
    </Stack>
  );
}

/** Folders ordered so children follow their parent, with their nesting depth. */
function orderFolders(folders: MediaFolder[]): { folder: MediaFolder; depth: number }[] {
  const byParent = new Map<string | null, MediaFolder[]>();
  const ids = new Set(folders.map((f) => f.id));
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }
  const out: { folder: MediaFolder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const folder of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ folder, depth });
      if (depth < 6) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ─── Asset presentations ─────────────────────────────────────────────────────

function UsagePill({ asset }: { asset: MediaAsset }) {
  return asset.usageCount > 0 ? (
    <Pill label={`In use · ${asset.usageCount}`} fg="success.dark" bg="success.light" title={`Referenced by ${asset.usageCount} ${asset.usageCount === 1 ? 'entry' : 'entries'}`} />
  ) : (
    <Pill label="Unused" title="No entry or page references this file" />
  );
}

function AssetCard({ asset, selected, selecting, selectable, trash, onOpen, onToggle }: { asset: MediaAsset; selected: boolean; selecting: boolean; selectable: boolean; trash: boolean; onOpen: () => void; onToggle: () => void }) {
  return (
    <Box
      component={motion.div}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      sx={{
        position: 'relative',
        minWidth: 0,
        borderRadius: '10px',
        border: 1,
        borderColor: selected ? 'secondary.main' : 'border.subtle',
        boxShadow: selected ? '0 0 0 1px var(--mui-palette-secondary-main)' : 'none',
        bgcolor: 'background.paper',
        overflow: 'hidden',
        transition: 'border-color 120ms',
        '&:hover': { borderColor: selected ? 'secondary.main' : 'border.strong' },
        '&:hover .asset-check, &:focus-within .asset-check': { opacity: 1 },
      }}
    >
      <ButtonBase onClick={onOpen} aria-label={`Open details of ${asset.filename}`} sx={{ display: 'block', width: '100%', textAlign: 'left' }}>
        <Box sx={{ p: 1.5, pb: 0 }}>
          <AssetThumb asset={asset} size="100%" radius={7} />
        </Box>
        <Box sx={{ px: 3, pt: 2, pb: 2.5 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 500 }} title={asset.filename}>
            {asset.filename}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 1, alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {dimensionsOf(asset) ? `${dimensionsOf(asset)} · ` : ''}
              {formatBytes(asset.size)}
            </Typography>
            {!trash && <UsagePill asset={asset} />}
          </Stack>
        </Box>
      </ButtonBase>
      {selectable && (
        <Checkbox
          className="asset-check"
          checked={selected}
          onChange={onToggle}
          slotProps={{ input: { 'aria-label': `Select ${asset.filename}` } }}
          sx={{ position: 'absolute', top: 10, left: 10, p: 0.5, borderRadius: '6px', bgcolor: 'background.paper', opacity: { xs: 1, md: selected || selecting ? 1 : 0 }, transition: 'opacity 120ms', '&:hover': { bgcolor: 'background.paper' } }}
        />
      )}
    </Box>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MediaLibraryPage() {
  const ws = useProject();
  const projectId = ws.project.id;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const density = useAppSelector((s) => s.ui.tableDensity);
  const canUpload = ws.can('media.upload');
  const canManage = ws.can('media.manage');

  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: Record<string, string | null>, keepPage = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          if (!keepPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const trash = params.get('view') === 'trash';
  const folder = trash ? 'all' : (params.get('folder') ?? 'all');
  const kind = params.get('kind') ?? '';
  const tag = params.get('tag') ?? '';
  const unused = params.get('unused') === '1';
  const sort = params.get('sort') ?? 'newest';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 50;
  const openId = params.get('asset');

  const [search, setSearch] = useState(params.get('q') ?? '');
  const term = useDebounced(search.trim(), 250);
  useEffect(() => {
    if ((params.get('q') ?? '') !== term) update({ q: term });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const [view, setView] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const changeView = (next: 'grid' | 'list') => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The preference simply does not persist when storage is unavailable.
    }
  };

  const stats = useQuery({ queryKey: ['media-stats', projectId], queryFn: () => api.get<MediaStats>(`${ws.projectBase}/media-stats`) });
  const folders = useQuery({
    queryKey: ['media-folders', projectId],
    queryFn: () => api.get<{ items: MediaFolder[] }>(`${ws.projectBase}/media-folders`).then((r) => r.items),
  });
  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const orderedFolders = useMemo(() => orderFolders(folderList), [folderList]);
  const currentFolder = folderList.find((f) => f.id === folder) ?? null;
  // A folder id from an old link that no longer exists falls back to the whole library.
  const folderFilter = folder === 'root' ? 'root' : currentFolder ? currentFolder.id : undefined;

  const listParams = { page, pageSize, search: term, kind, tag, sort, unused: unused ? 'true' : undefined, trash: trash ? 'true' : undefined, folderId: folderFilter };
  const list = useQuery({
    queryKey: ['media', projectId, 'library', listParams],
    queryFn: () => api.get<Paged<MediaAsset>>(`${ws.projectBase}/media`, listParams),
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.meta.total ?? 0;

  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['media', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['media-stats', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['media-folders', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['media-by-id', projectId] }),
      ]),
    [queryClient, projectId],
  );

  const onUploaded = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['media-folders', projectId] });
  }, [queryClient, projectId]);
  const { upload, uploading, problems, clearProblems } = useUpload(onUploaded);
  const startUpload = useCallback((files: File[]) => void upload(files, currentFolder?.id ?? null), [upload, currentFolder?.id]);

  // Arriving from "Upload media" elsewhere in the app opens the file dialog straight away.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (params.get('upload') !== '1' || autoOpened.current) return;
    autoOpened.current = true;
    update({ upload: null }, true);
    if (canUpload) browseFiles(startUpload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Selection ────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const scopeKey = JSON.stringify([folder, trash, kind, tag, unused, sort, page, term]);
  useEffect(() => setSelected(new Set()), [scopeKey]);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedAssets = items.filter((a) => selected.has(a.id));
  const allSelected = items.length > 0 && selectedAssets.length === items.length;

  const [busy, setBusy] = useState(false);
  const [moveAnchor, setMoveAnchor] = useState<HTMLElement | null>(null);
  const [tagDialog, setTagDialog] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{ mode: 'create' } | { mode: 'rename'; folder: MediaFolder } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ anchor: HTMLElement; folder: MediaFolder } | null>(null);

  /** Runs one request per selected asset and reports how many succeeded. */
  const runBulk = async (assets: MediaAsset[], action: (asset: MediaAsset) => Promise<unknown>, done: (count: number) => string) => {
    setBusy(true);
    const results = await Promise.allSettled(assets.map(action));
    setBusy(false);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    const succeeded = results.length - failed.length;
    if (succeeded > 0) toast.success(done(succeeded));
    if (failed.length > 0) toast.error(`${failed.length} file${failed.length === 1 ? '' : 's'} could not be changed: ${errorMessage(failed[0].reason)}`);
    setSelected(new Set());
    await refresh();
  };

  const moveSelected = (target: MediaFolder | null) => {
    setMoveAnchor(null);
    void runBulk(
      selectedAssets,
      (asset) => api.patch(`${ws.projectBase}/media/${asset.id}`, { folderId: target?.id ?? null }),
      (n) => `${n} file${n === 1 ? '' : 's'} moved to ${target ? `“${target.name}”` : 'Unfiled'}`,
    );
  };

  const tagSelected = async (raw: string) => {
    const { tags } = cleanTags([raw]);
    await runBulk(
      selectedAssets,
      (asset) => (asset.tags.includes(tags[0]) ? Promise.resolve() : api.patch(`${ws.projectBase}/media/${asset.id}`, { tags: [...asset.tags, tags[0]].slice(0, 30) })),
      (n) => `Tag “${tags[0]}” added to ${n} file${n === 1 ? '' : 's'}`,
    );
  };

  const deleteSelected = async () => {
    const assets = selectedAssets;
    const ok = await confirm({
      title: `Move ${assets.length} file${assets.length === 1 ? '' : 's'} to the trash?`,
      message: 'They stop being delivered straight away. You can restore them from the trash.',
      destructive: true,
      confirmLabel: 'Move to trash',
    });
    if (!ok) return;
    setBusy(true);
    const inUse: MediaAsset[] = [];
    let removed = 0;
    let failure: unknown = null;
    for (const asset of assets) {
      try {
        await api.delete(`${ws.projectBase}/media/${asset.id}`);
        removed += 1;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) inUse.push(asset);
        else failure = err;
      }
    }
    setBusy(false);
    if (inUse.length > 0) {
      // Files that content still references need a second, explicit decision.
      const force = await confirm({
        title: `${inUse.length} file${inUse.length === 1 ? ' is' : 's are'} still in use`,
        message: (
          <>
            {inUse.slice(0, 5).map((a) => (
              <Box key={a.id} sx={{ fontWeight: 500 }}>
                {a.filename}
              </Box>
            ))}
            {inUse.length > 5 && <Box>…and {inUse.length - 5} more</Box>}
            <Box sx={{ mt: 2 }}>Entries and pages that reference them will show no file until someone picks a new one.</Box>
          </>
        ),
        destructive: true,
        confirmLabel: 'Delete anyway',
        cancelLabel: 'Keep them',
        onConfirm: async () => {
          for (const asset of inUse) await api.delete(`${ws.projectBase}/media/${asset.id}`, { force: 'true' });
        },
      });
      if (force) removed += inUse.length;
    }
    if (removed > 0) toast.success(`${removed} file${removed === 1 ? '' : 's'} moved to the trash`);
    if (failure) toast.error(errorMessage(failure));
    setSelected(new Set());
    await refresh();
  };

  const restoreSelected = () =>
    void runBulk(
      selectedAssets,
      (asset) => api.post(`${ws.projectBase}/media/${asset.id}/restore`),
      (n) => `${n} file${n === 1 ? '' : 's'} restored`,
    );

  const purgeSelected = async () => {
    const assets = selectedAssets;
    const ok = await confirm({
      title: `Delete ${assets.length} file${assets.length === 1 ? '' : 's'} permanently?`,
      message: 'The files are removed from storage. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete permanently',
    });
    if (ok) {
      await runBulk(
        assets,
        (asset) => api.delete(`${ws.projectBase}/media/${asset.id}`, { permanent: 'true' }),
        (n) => `${n} file${n === 1 ? '' : 's'} deleted permanently`,
      );
    }
  };

  const deleteFolder = async (target: MediaFolder) => {
    const ok = await confirm({
      title: `Delete the folder “${target.name}”?`,
      message: 'Files inside are not deleted — they move back to Unfiled. Folders inside it are deleted too.',
      destructive: true,
      confirmLabel: 'Delete folder',
      onConfirm: () => api.delete(`${ws.projectBase}/media-folders/${target.id}`),
    });
    if (ok) {
      toast.success('Folder deleted');
      if (folder === target.id) update({ folder: null });
      await refresh();
    }
  };

  const filtered = !!(term || kind || tag || unused);
  const clearFilters = () => {
    setSearch('');
    update({ q: null, kind: null, tag: null, unused: null });
  };
  const s = stats.data;
  const filedCount = folderList.reduce((n, f) => n + f.assetCount, 0);
  const summary = s
    ? `${s.totalAssets} file${s.totalAssets === 1 ? '' : 's'} · ${formatBytes(s.totalBytes)} · ${s.unusedAssets} unused · ${s.storageDriver === 's3' ? 'S3-compatible storage' : 'local storage'}`
    : 'Images, video and documents for this project, shared by all of its environments.';
  const scopeTitle = trash ? 'Trash' : folder === 'root' ? 'Unfiled' : (currentFolder?.name ?? 'All files');
  const selectable = canManage;

  const emptyState = trash ? (
    <EmptyState icon={<DeleteOutlineOutlined />} title="The trash is empty" description="Deleted files wait here until they are restored or deleted permanently." />
  ) : filtered ? (
    <EmptyState
      icon={<SearchOffOutlined />}
      title="No files match these filters"
      description="Try a different search term or remove a filter."
      action={
        <Button variant="outlined" startIcon={<FilterAltOffOutlined />} onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  ) : folderFilter ? (
    <EmptyState
      icon={<FolderOpenOutlined />}
      title={folder === 'root' ? 'Every file is in a folder' : 'This folder is empty'}
      description={canUpload && folder !== 'root' ? 'Drop files here to upload them straight into this folder, or move existing files in.' : undefined}
      action={
        canUpload && folder !== 'root' ? (
          <Button variant="contained" startIcon={<CloudUploadOutlined />} onClick={() => browseFiles(startUpload)}>
            Upload to this folder
          </Button>
        ) : undefined
      }
    />
  ) : (
    <EmptyState
      icon={<PhotoLibraryOutlined />}
      title="Upload your first files"
      description={
        canUpload
          ? `Drop files anywhere on this page or browse for them. ${s ? `Up to ${formatBytes(s.maxUploadBytes)} per file: ${s.allowedExtensions.join(', ')}.` : ''}`
          : 'Nothing has been uploaded yet. Ask someone with upload rights to add files.'
      }
      action={
        canUpload ? (
          <Button variant="contained" startIcon={<CloudUploadOutlined />} onClick={() => browseFiles(startUpload)}>
            Upload files
          </Button>
        ) : undefined
      }
    />
  );

  const sidebar = (
    <Box component="nav" aria-label="Folders">
      <NavRow label="All files" count={s?.totalAssets} icon={<PhotoLibraryOutlined />} selected={!trash && folder === 'all'} onClick={() => update({ folder: null, view: null })} />
      <NavRow label="Unfiled" count={s ? Math.max(0, s.totalAssets - filedCount) : undefined} icon={<InboxOutlined />} selected={!trash && folder === 'root'} onClick={() => update({ folder: 'root', view: null })} />
      <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 2, pt: 3, pb: 1 }}>
        Folders
      </Typography>
      {folders.isLoading && <Skeleton variant="rounded" height={28} sx={{ mx: 1 }} />}
      {orderedFolders.map(({ folder: f, depth }) => (
        <NavRow
          key={f.id}
          label={f.name}
          count={f.assetCount}
          depth={depth}
          icon={!trash && folder === f.id ? <FolderOpenOutlined /> : <FolderOutlined />}
          selected={!trash && folder === f.id}
          onClick={() => update({ folder: f.id, view: null })}
          action={
            canManage ? (
              <IconButton size="small" aria-label={`Actions for folder ${f.name}`} aria-haspopup="menu" onClick={(e) => setFolderMenu({ anchor: e.currentTarget, folder: f })} sx={{ p: 0.5 }}>
                <MoreHorizOutlined sx={{ fontSize: '16px !important' }} />
              </IconButton>
            ) : undefined
          }
        />
      ))}
      {!folders.isLoading && folderList.length === 0 && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 2, py: 1 }}>
          No folders yet.
        </Typography>
      )}
      {canManage && (
        <Button size="small" startIcon={<CreateNewFolderOutlined />} onClick={() => setFolderDialog({ mode: 'create' })} sx={{ mt: 1, ml: 0.5, color: 'text.secondary' }}>
          New folder
        </Button>
      )}
      <Divider sx={{ my: 2.5 }} />
      <NavRow label="Trash" icon={<DeleteOutlineOutlined />} selected={trash} onClick={() => update({ view: 'trash', folder: null })} />
      {s && s.byKind.length > 0 && (
        <Box sx={{ mt: 4, px: 2 }}>
          <Typography variant="overline" color="text.disabled" component="div" sx={{ pb: 1 }}>
            Storage by type
          </Typography>
          {s.byKind
            .slice()
            .sort((a, b) => b.bytes - a.bytes)
            .map((k) => (
              <Stack key={k.kind} direction="row" sx={{ justifyContent: 'space-between', py: 0.75 }}>
                <Typography variant="caption" color="text.secondary">
                  {KIND_LABEL[k.kind] ?? k.kind} · {k.count}
                </Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatBytes(k.bytes)}
                </Typography>
              </Stack>
            ))}
        </Box>
      )}
    </Box>
  );

  return (
    <Page width={1440}>
      <PageHeader
        title="Media library"
        description={summary}
        actions={
          canUpload && !trash ? (
            <Button variant="contained" startIcon={<CloudUploadOutlined />} disabled={!!uploading} onClick={() => browseFiles(startUpload)}>
              Upload
            </Button>
          ) : undefined
        }
      />

      <Dropzone onFiles={startUpload} disabled={!canUpload || trash || !!uploading}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '228px minmax(0, 1fr)' }, gap: 5, alignItems: 'start' }}>
          {/* Folders: a sidebar on desktop, a compact selector on small screens. */}
          <Paper sx={{ display: { xs: 'none', md: 'block' }, borderRadius: '10px', p: 2, position: 'sticky', top: 16 }}>{sidebar}</Paper>
          <TextField
            select
            label="Folder"
            value={trash ? '__trash' : folder}
            onChange={(e) => (e.target.value === '__trash' ? update({ view: 'trash', folder: null }) : update({ folder: e.target.value === 'all' ? null : e.target.value, view: null }))}
            sx={{ display: { md: 'none' } }}
          >
            <MenuItem value="all">All files</MenuItem>
            <MenuItem value="root">Unfiled</MenuItem>
            {orderedFolders.map(({ folder: f }) => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
            <MenuItem value="__trash">Trash</MenuItem>
          </TextField>

          <Box sx={{ minWidth: 0 }}>
            <Stack spacing={3} sx={{ mb: 3 }}>
              {uploading && (
                <Paper sx={{ borderRadius: '10px', px: 4, py: 3 }} role="status">
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    Uploading {uploading.count} file{uploading.count === 1 ? '' : 's'}
                    {currentFolder ? ` to “${currentFolder.name}”` : ''}… {Math.round(uploading.progress * 100)}%
                  </Typography>
                  <LinearProgress variant="determinate" value={uploading.progress * 100} color="secondary" sx={{ mt: 2 }} />
                </Paper>
              )}
              <UploadProblems problems={problems} onClose={clearProblems} />
            </Stack>

            <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
              {/* Toolbar */}
              <Stack direction="row" sx={{ p: 3, gap: 2, flexWrap: 'wrap', alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle' }}>
                <Typography variant="h5" component="h2" sx={{ mr: 1, display: { xs: 'none', lg: 'block' } }}>
                  {scopeTitle}
                </Typography>
                <SearchInput value={search} onChange={setSearch} placeholder="Search name, alt text or tag…" width={260} />
                <TextField select value={kind} onChange={(e) => update({ kind: e.target.value })} sx={{ width: 140 }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'File type' } }}>
                  <MenuItem value="">All types</MenuItem>
                  {KINDS.map((k) => (
                    <MenuItem key={k.value} value={k.value}>
                      {k.label}
                    </MenuItem>
                  ))}
                </TextField>
                {(s?.tags.length ?? 0) > 0 && (
                  <TextField select value={tag} onChange={(e) => update({ tag: e.target.value })} sx={{ width: 150 }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Tag' } }}>
                    <MenuItem value="">All tags</MenuItem>
                    {s?.tags.map((t) => (
                      <MenuItem key={t.tag} value={t.tag}>
                        {t.tag}
                        <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', pl: 3 }}>
                          {t.n}
                        </Typography>
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                {!trash && (
                  <Tooltip
                    title="Files that no entry or page references"
                    // The tooltip explains the filter; its accessible name stays "Unused only".
                    describeChild
                  >
                    <Chip
                      label={`Unused only${s ? ` · ${s.unusedAssets}` : ''}`}
                      variant={unused ? 'filled' : 'outlined'}
                      color={unused ? 'secondary' : 'default'}
                      onClick={() => update({ unused: unused ? null : '1' })}
                      aria-pressed={unused}
                      sx={{ height: 30, borderRadius: '7px', px: 0.5 }}
                    />
                  </Tooltip>
                )}
                <Box sx={{ flex: 1 }} />
                <TextField select value={sort} onChange={(e) => update({ sort: e.target.value === 'newest' ? null : e.target.value })} sx={{ width: 150 }} slotProps={{ htmlInput: { 'aria-label': 'Sort' } }}>
                  {SORTS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </TextField>
                <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, next) => next && changeView(next)} aria-label="Layout">
                  <ToggleButton value="grid" aria-label="Grid view">
                    <GridViewOutlined sx={{ fontSize: 17 }} />
                  </ToggleButton>
                  <ToggleButton value="list" aria-label="List view">
                    <ViewListOutlined sx={{ fontSize: 17 }} />
                  </ToggleButton>
                </ToggleButtonGroup>
              </Stack>

              {/* Selection bar */}
              {selectable && items.length > 0 && (
                <Stack direction="row" sx={{ px: 3, minHeight: 44, gap: 2, flexWrap: 'wrap', alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle', bgcolor: selected.size ? 'action.selected' : 'surface.subtle' }}>
                  <Checkbox
                    checked={allSelected}
                    indeterminate={selected.size > 0 && !allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((a) => a.id)))}
                    slotProps={{ input: { 'aria-label': 'Select every file on this page' } }}
                    sx={{ ml: -0.5 }}
                  />
                  <Typography variant="body2" color={selected.size ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: selected.size ? 600 : 400 }} aria-live="polite">
                    {selected.size ? `${selected.size} selected` : 'Select all on this page'}
                  </Typography>
                  {selected.size > 0 &&
                    (trash ? (
                      <>
                        <Button size="small" startIcon={<RestoreFromTrashOutlined />} disabled={busy} onClick={restoreSelected}>
                          Restore
                        </Button>
                        <Button size="small" startIcon={<DeleteForeverOutlined />} disabled={busy} onClick={() => void purgeSelected()} sx={{ color: 'error.main' }}>
                          Delete permanently
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="small" startIcon={<DriveFileMoveOutlined />} disabled={busy} onClick={(e) => setMoveAnchor(e.currentTarget)} aria-haspopup="menu">
                          Move to folder
                        </Button>
                        <Button size="small" startIcon={<LabelOutlined />} disabled={busy} onClick={() => setTagDialog(true)}>
                          Add tag
                        </Button>
                        <Button size="small" startIcon={<DeleteOutlineOutlined />} disabled={busy} onClick={() => void deleteSelected()} sx={{ color: 'error.main' }}>
                          Delete
                        </Button>
                      </>
                    ))}
                  {selected.size > 0 && (
                    <Button size="small" onClick={() => setSelected(new Set())} sx={{ ml: 'auto', color: 'text.secondary' }}>
                      Clear selection
                    </Button>
                  )}
                </Stack>
              )}
              {(busy || (list.isFetching && !list.isLoading)) && <LinearProgress color="secondary" sx={{ height: 2 }} />}

              {/* Content */}
              {list.isLoading ? (
                <Box sx={{ p: 4, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 3.5 }} aria-busy="true" aria-label="Loading files">
                  {Array.from({ length: 12 }, (_, i) => (
                    <Skeleton key={i} variant="rounded" sx={{ aspectRatio: '1 / 1.25', height: 'auto', borderRadius: '10px' }} />
                  ))}
                </Box>
              ) : list.isError ? (
                <ErrorState error={list.error} onRetry={() => void list.refetch()} />
              ) : items.length === 0 ? (
                emptyState
              ) : view === 'grid' ? (
                <Box sx={{ p: 4, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 3.5 }}>
                  {items.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      trash={trash}
                      selectable={selectable}
                      selected={selected.has(asset.id)}
                      selecting={selected.size > 0}
                      onOpen={() => update({ asset: asset.id }, true)}
                      onToggle={() => toggle(asset.id)}
                    />
                  ))}
                </Box>
              ) : (
                <TableContainer>
                  <Table size={density === 'compact' ? 'small' : 'medium'} aria-label="Files">
                    <TableHead>
                      <TableRow>
                        {selectable && <TableCell padding="checkbox" />}
                        <TableCell>File</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell align="right">Size</TableCell>
                        <TableCell>Dimensions</TableCell>
                        {!trash && <TableCell>Usage</TableCell>}
                        <TableCell>Tags</TableCell>
                        <TableCell>{trash ? 'Deleted' : 'Uploaded'}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {items.map((asset) => (
                        <TableRow key={asset.id} hover selected={selected.has(asset.id)} onClick={() => update({ asset: asset.id }, true)} sx={{ cursor: 'pointer' }}>
                          {selectable && (
                            <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={selected.has(asset.id)} onChange={() => toggle(asset.id)} slotProps={{ input: { 'aria-label': `Select ${asset.filename}` } }} />
                            </TableCell>
                          )}
                          <TableCell sx={{ maxWidth: 320 }}>
                            <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
                              <AssetThumb asset={asset} size={36} radius={6} />
                              <Box sx={{ minWidth: 0 }}>
                                <ButtonBase
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    update({ asset: asset.id }, true);
                                  }}
                                  sx={{ maxWidth: '100%', fontSize: '0.8125rem', fontWeight: 500, borderRadius: '4px' }}
                                >
                                  <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {asset.filename}
                                  </Box>
                                </ButtonBase>
                                {asset.alt && (
                                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                                    {asset.alt}
                                  </Typography>
                                )}
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{asset.mimeType}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {formatBytes(asset.size)}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{dimensionsOf(asset) ?? '—'}</TableCell>
                          {!trash && (
                            <TableCell>
                              <UsagePill asset={asset} />
                            </TableCell>
                          )}
                          <TableCell sx={{ maxWidth: 200 }}>
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {asset.tags.length ? asset.tags.join(', ') : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            <RelativeTime value={trash ? asset.deletedAt : asset.createdAt} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              {total > 0 && <TableFooter page={page} pageSize={pageSize} total={total} onPage={(next) => update({ page: next === 1 ? null : String(next) }, true)} onPageSize={(size) => update({ size: size === 50 ? null : String(size) })} />}
            </Paper>
            {canUpload && !trash && items.length > 0 && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2.5, textAlign: 'center' }}>
                Drop files anywhere on this page to upload{currentFolder ? ` into “${currentFolder.name}”` : ''}.{s ? ` Up to ${formatBytes(s.maxUploadBytes)} per file.` : ''}
              </Typography>
            )}
          </Box>
        </Box>
      </Dropzone>

      {/* Move selection */}
      <Menu anchorEl={moveAnchor} open={!!moveAnchor} onClose={() => setMoveAnchor(null)}>
        <MenuItem onClick={() => moveSelected(null)}>
          <ListItemIcon>
            <InboxOutlined />
          </ListItemIcon>
          Unfiled
        </MenuItem>
        {orderedFolders.map(({ folder: f }) => (
          <MenuItem key={f.id} onClick={() => moveSelected(f)}>
            <ListItemIcon>
              <FolderOutlined />
            </ListItemIcon>
            {f.name}
          </MenuItem>
        ))}
        {folderList.length === 0 && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 2.5, py: 1.5, maxWidth: 220 }}>
            Create a folder first to organise files.
          </Typography>
        )}
      </Menu>

      {/* Folder actions */}
      <Menu anchorEl={folderMenu?.anchor} open={!!folderMenu} onClose={() => setFolderMenu(null)}>
        <MenuItem
          onClick={() => {
            if (folderMenu) setFolderDialog({ mode: 'rename', folder: folderMenu.folder });
            setFolderMenu(null);
          }}
        >
          <ListItemIcon>
            <DriveFileRenameOutlineOutlined />
          </ListItemIcon>
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            const target = folderMenu?.folder;
            setFolderMenu(null);
            if (target) void deleteFolder(target);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteOutlineOutlined />
          </ListItemIcon>
          Delete folder
        </MenuItem>
      </Menu>

      <NameDialog
        open={!!folderDialog}
        title={folderDialog?.mode === 'rename' ? 'Rename folder' : 'New folder'}
        label="Folder name"
        initial={folderDialog?.mode === 'rename' ? folderDialog.folder.name : ''}
        confirmLabel={folderDialog?.mode === 'rename' ? 'Rename' : 'Create folder'}
        onClose={() => setFolderDialog(null)}
        onSubmit={async (name) => {
          if (folderDialog?.mode === 'rename') {
            await api.patch(`${ws.projectBase}/media-folders/${folderDialog.folder.id}`, { name });
            toast.success('Folder renamed');
          } else {
            const created = await api.post<MediaFolder>(`${ws.projectBase}/media-folders`, { name });
            toast.success(`Folder “${created.name}” created`);
          }
          await queryClient.invalidateQueries({ queryKey: ['media-folders', projectId] });
        }}
      />
      <NameDialog
        open={tagDialog}
        title={`Add a tag to ${selected.size} file${selected.size === 1 ? '' : 's'}`}
        label="Tag"
        confirmLabel="Add tag"
        helperText="Letters, numbers, spaces, hyphens and underscores. Saved in lowercase."
        validate={(value) => (cleanTags([value]).tags.length ? null : 'Use letters, numbers, spaces, hyphens and underscores (up to 40 characters)')}
        onClose={() => setTagDialog(false)}
        onSubmit={tagSelected}
      />

      <AssetDrawer assetId={openId} onClose={() => update({ asset: null }, true)} folders={orderedFolders.map((f) => f.folder)} knownTags={s?.tags.map((t) => t.tag) ?? []} onChanged={refresh} />
    </Page>
  );
}
