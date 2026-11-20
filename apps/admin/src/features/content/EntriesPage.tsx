import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteForeverOutlined from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DensityMediumOutlined from '@mui/icons-material/DensityMediumOutlined';
import DensitySmallOutlined from '@mui/icons-material/DensitySmallOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import PublicOffOutlined from '@mui/icons-material/PublicOffOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import RestoreFromTrashOutlined from '@mui/icons-material/RestoreFromTrashOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { ENTRY_STATUSES, type EntryStatus, type FieldDef, STATUS_LABELS } from '@meridian/shared';
import { useCrumbs } from '@/app/shell';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { IconFor } from '@/components/icons';
import { EmptyState, ErrorState, Page, PageHeader, Pill, RelativeTime, SearchInput, StatusChip, TableFooter, TableSkeleton, useDebounced } from '@/components/ui';
import { useAssets } from '@/features/fields/MediaField';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fullDateTime } from '@/lib/format';
import type { ContentType, EntryDetail, EntrySummary, Page as Paged } from '@/lib/types';
import { setTableDensity, toast, useAppDispatch, useAppSelector } from '@/store';
import { FieldCell, type ListFilter, collectAssetIds, describeFilter, isCompactField, isFilterableField, isSortableField } from './cells';
import { useContentType, useInvalidateContent, usePreference, useRelationTitles } from './hooks';
import { type BulkOutcome, BulkOutcomeDialog, type ColumnOption, ColumnsMenu, FilterBuilder, ImportDialog, type SavedView, SavedViewsMenu, type ViewParams } from './listParts';

type Row = EntrySummary & { data?: Record<string, unknown> };
type BulkAction = 'publish' | 'unpublish' | 'archive' | 'delete' | 'restore';

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SORT = '-updatedAt';
const NO_COLUMNS: string[] | null = null;
const NO_VIEWS: SavedView[] = [];

interface SystemColumn {
  id: string;
  label: string;
  sortKey?: string;
  render: (row: Row) => React.ReactNode;
}

const SYSTEM_COLUMNS: SystemColumn[] = [
  { id: 'status', label: 'Status', sortKey: 'status', render: (r) => <StatusChip status={r.status} isPublished={r.isPublished} hasChanges={r.hasChanges} /> },
  { id: 'locale', label: 'Locale', sortKey: 'locale', render: (r) => <Pill label={r.locale} /> },
  { id: 'updatedAt', label: 'Updated', sortKey: 'updatedAt', render: (r) => <RelativeTime value={r.updatedAt} /> },
  { id: 'updatedBy', label: 'Updated by', render: (r) => r.updatedBy ?? '—' },
  { id: 'publishedAt', label: 'Published', sortKey: 'publishedAt', render: (r) => (r.publishedAt ? <RelativeTime value={r.publishedAt} /> : '—') },
  { id: 'createdAt', label: 'Created', sortKey: 'createdAt', render: (r) => <RelativeTime value={r.createdAt} /> },
  { id: 'createdBy', label: 'Created by', render: (r) => r.createdBy ?? '—' },
];

const encodeFilter = (f: ListFilter) => `${f.field}~${f.op}~${f.value}`;
function decodeFilter(raw: string): ListFilter | null {
  const first = raw.indexOf('~');
  const second = raw.indexOf('~', first + 1);
  if (first <= 0 || second <= first) return null;
  const op = raw.slice(first + 1, second);
  if (!['eq', 'ne', 'contains', 'gt', 'gte', 'lt', 'lte', 'null'].includes(op)) return null;
  return { field: raw.slice(0, first), op: op as ListFilter['op'], value: raw.slice(second + 1) };
}

/** List state lives in the URL, so a filtered view can be bookmarked, shared and restored with Back. */
function useListState() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => {
    const pageSize = Number(params.get('pageSize'));
    return {
      q: params.get('q') ?? '',
      statuses: (params.get('status') ?? '').split(',').filter((s): s is EntryStatus => (ENTRY_STATUSES as readonly string[]).includes(s)),
      locale: params.get('locale') ?? '',
      sort: params.get('sort') ?? DEFAULT_SORT,
      page: Math.max(1, Number(params.get('page')) || 1),
      pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 25,
      trash: params.get('view') === 'trash',
      filters: params.getAll('f').map(decodeFilter).filter((f): f is ListFilter => !!f),
    };
  }, [params]);

  const update = useCallback(
    (patch: Partial<typeof state>, opts: { sync?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const set = (key: string, value: string | undefined | null, fallback = '') => (value && value !== fallback ? next.set(key, value) : next.delete(key));
          if ('q' in patch) set('q', patch.q);
          if ('statuses' in patch) set('status', patch.statuses?.join(','));
          if ('locale' in patch) set('locale', patch.locale);
          if ('sort' in patch) set('sort', patch.sort, DEFAULT_SORT);
          if ('pageSize' in patch) set('pageSize', String(patch.pageSize), '25');
          if ('trash' in patch) set('view', patch.trash ? 'trash' : '');
          if ('filters' in patch) {
            next.delete('f');
            for (const f of patch.filters ?? []) next.append('f', encodeFilter(f));
          }
          // Any change to what is listed starts again from the first page.
          if ('page' in patch) set('page', String(patch.page), '1');
          else next.delete('page');
          return next;
        },
        // The router defers URL updates by default. `sync` applies one immediately, for a control that
        // derives its next value from the current one and would otherwise lose a quick second click.
        { replace: true, flushSync: opts.sync },
      );
    },
    [setParams],
  );
  return [state, update] as const;
}

export default function EntriesPage() {
  const { typeId } = useParams();
  const ws = useProject();
  const { schema, type } = useContentType(typeId);

  if (schema.isLoading) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <TableSkeleton rows={8} columns={5} />
        </Paper>
      </Page>
    );
  }
  if (schema.isError) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      </Page>
    );
  }
  if (!type) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<SearchOffOutlined />}
            title="Content type not found"
            description={`There is no content type “${typeId}” in the ${ws.environment.name} environment. It may exist in another environment, or have been deleted.`}
            action={
              <Button variant="contained" component={RouterLink} to={ws.href('content')}>
                All content
              </Button>
            }
          />
        </Paper>
      </Page>
    );
  }
  // Pages have their own tree view and visual editor.
  if (type.isSystem) return <Navigate to={ws.href('pages')} replace />;
  if (type.kind === 'SINGLE') return <SingleRedirect type={type} />;
  return <EntriesList key={type.id} type={type} />;
}

/** A single type holds one entry: go straight to it, or to the form that creates it. */
function SingleRedirect({ type }: { type: ContentType }) {
  const ws = useProject();
  const first = useQuery({
    queryKey: ['entries', ws.environment.id, type.apiId, 'single'],
    queryFn: () => api.get<Paged<Row>>(`${ws.envBase}/entries/${type.apiId}`, { pageSize: 1, locale: ws.defaultLocale }),
  });
  if (first.isLoading) return <LinearProgress aria-label="Loading" />;
  if (first.isError) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={first.error} onRetry={() => void first.refetch()} />
        </Paper>
      </Page>
    );
  }
  const entry = first.data?.items[0];
  return <Navigate to={ws.href(`content/${type.apiId}/${entry ? entry.id : 'new'}`)} replace />;
}

function EntriesList({ type }: { type: ContentType }) {
  const ws = useProject();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const dispatch = useAppDispatch();
  const invalidate = useInvalidateContent();
  const density = useAppSelector((s) => s.ui.tableDensity);
  const [state, update] = useListState();
  const [search, setSearch] = useState(state.q);
  const term = useDebounced(search.trim(), 280);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: Row } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const columnsPref = usePreference<string[] | null>(`columns.${type.apiId}`, NO_COLUMNS);
  const viewsPref = usePreference<SavedView[]>(`savedFilters.${type.apiId}`, NO_VIEWS);
  const localized = !!type.options.localized && ws.project.locales.length > 1;

  useCrumbs([{ label: type.displayName }]);

  // Typing updates the URL after a pause; the URL changing from elsewhere (a saved view, Back) updates the box.
  useEffect(() => {
    if (term !== state.q) update({ q: term });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  useEffect(() => {
    setSearch((current) => (current.trim() === state.q ? current : state.q));
  }, [state.q]);

  const fields = useMemo(() => [...type.fields].sort((a, b) => a.position - b.position), [type.fields]);
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.apiId, f])), [fields]);
  const titleFieldId = type.options.titleField ?? fields.find((f) => f.type === 'text')?.apiId;
  const filterable = useMemo(() => fields.filter(isFilterableField), [fields]);

  const columnOptions = useMemo<ColumnOption[]>(
    () => [
      ...fields.filter((f) => f.apiId !== titleFieldId && f.type !== 'password' && !f.config.hidden).map((f) => ({ id: `f:${f.apiId}`, label: f.label, group: 'Fields' as const })),
      ...SYSTEM_COLUMNS.filter((c) => c.id !== 'locale' || localized).map((c) => ({ id: c.id, label: c.label, group: 'System' as const })),
    ],
    [fields, titleFieldId, localized],
  );
  const defaultColumns = useMemo(
    () => [
      ...fields.filter((f) => f.apiId !== titleFieldId && isCompactField(f) && !f.config.hidden).slice(0, 3).map((f) => `f:${f.apiId}`),
      'status',
      ...(localized ? ['locale'] : []),
      'updatedAt',
    ],
    [fields, titleFieldId, localized],
  );
  const visibleIds = useMemo(() => {
    const known = new Set(columnOptions.map((o) => o.id));
    // A saved choice may mention fields that have since been removed from the model.
    return (columnsPref.value ?? defaultColumns).filter((id) => known.has(id));
  }, [columnsPref.value, defaultColumns, columnOptions]);
  const visibleFields = useMemo(() => visibleIds.filter((id) => id.startsWith('f:')).map((id) => fieldById.get(id.slice(2))).filter((f): f is FieldDef => !!f), [visibleIds, fieldById]);

  const query = useMemo(() => {
    const params: Record<string, string | number | undefined> = {
      page: state.page,
      pageSize: state.pageSize,
      sort: state.sort,
      search: state.q || undefined,
      status: state.trash ? undefined : state.statuses.join(',') || undefined,
      locale: localized ? state.locale || undefined : undefined,
      trash: state.trash ? 'true' : undefined,
    };
    for (const f of state.filters) if (fieldById.has(f.field)) params[`filter[${f.field}][${f.op}]`] = f.value;
    return params;
  }, [state, localized, fieldById]);

  const list = useQuery({
    queryKey: ['entries', ws.environment.id, type.apiId, query],
    queryFn: () => api.get<Paged<Row>>(`${ws.envBase}/entries/${type.apiId}`, query),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.meta.total ?? 0;
  const assets = useAssets(useMemo(() => collectAssetIds(visibleFields, rows), [visibleFields, rows]));
  const relations = useRelationTitles(visibleFields, rows);
  const cellContext = useMemo(() => ({ assets: assets.data, relations }), [assets.data, relations]);

  // Selection only ever refers to rows that are on screen.
  const rowKey = rows.map((r) => r.id).join(',');
  useEffect(() => {
    setSelected(new Set());
  }, [rowKey, state.trash]);

  const sortField = state.sort.replace(/^-/, '');
  const sortDir: 'asc' | 'desc' = state.sort.startsWith('-') ? 'desc' : 'asc';
  const toggleSort = (key: string) => update({ sort: sortField !== key ? key : sortDir === 'asc' ? `-${key}` : key });
  const titleField = fieldById.get('title');
  const titleSortable = !titleField || isSortableField(titleField);

  const filtered = !!state.q || state.statuses.length > 0 || state.filters.length > 0 || (localized && !!state.locale);
  const currentView: ViewParams = { q: state.q, statuses: state.statuses, locale: state.locale, sort: state.sort, filters: state.filters };
  const clearFilters = () => {
    setSearch('');
    update({ q: '', statuses: [], locale: '', filters: [] });
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const explain = (err: unknown) => {
    const first = err instanceof ApiError && Array.isArray(err.details) ? err.details[0]?.message : undefined;
    return first ? `${errorMessage(err)} — ${first}` : errorMessage(err);
  };

  const act = async (key: string, request: () => Promise<unknown>, success: string, entryId?: string) => {
    setBusy(key);
    try {
      await request();
      toast.success(success);
      invalidate(entryId);
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setBusy(null);
    }
  };
  const label = (row: Row) => row.title ?? `Untitled ${type.singularName.toLowerCase()}`;
  const entryUrl = (row: Row) => `${ws.envBase}/entry/${row.id}`;

  const duplicate = async (row: Row) => {
    setBusy(row.id);
    try {
      const copy = await api.post<EntryDetail>(`${entryUrl(row)}/duplicate`);
      invalidate();
      toast.success(`Duplicated “${label(row)}”`);
      navigate(ws.href(`content/${type.apiId}/${copy.id}`));
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setBusy(null);
    }
  };
  const remove = (row: Row) =>
    confirm({
      title: `Move “${label(row)}” to the trash?`,
      message: row.isPublished ? 'It is published, so it will also disappear from the API immediately. You can restore it from the trash.' : 'You can restore it from the trash later.',
      confirmLabel: 'Move to trash',
      destructive: true,
      onConfirm: async () => {
        await api.delete(entryUrl(row));
        toast.success('Moved to trash');
        invalidate(row.id);
      },
    });
  const purge = (row: Row) =>
    confirm({
      title: `Delete “${label(row)}” permanently?`,
      message: 'The entry and its entire version history will be erased. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      destructive: true,
      onConfirm: async () => {
        await api.delete(entryUrl(row), { permanent: true });
        toast.success('Deleted permanently');
        invalidate(row.id);
      },
    });

  const runBulk = async (action: BulkAction) => {
    const ids = [...selected];
    const past = { publish: 'published', unpublish: 'unpublished', archive: 'archived', delete: 'moved to trash', restore: 'restored' }[action];
    const send = async () => {
      const result = await api.post<{ results: { id: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>(`${ws.envBase}/entries/${type.apiId}/bulk`, { ids, action });
      invalidate();
      setSelected(new Set());
      if (result.succeeded > 0) toast.success(`${result.succeeded} ${result.succeeded === 1 ? 'entry' : 'entries'} ${past}`);
      if (result.failed > 0) {
        const titles = new Map(rows.map((r) => [r.id, label(r)]));
        setOutcome({ action: past, succeeded: result.succeeded, failures: result.results.filter((r) => !r.ok).map((r) => ({ title: titles.get(r.id) ?? r.id, error: r.error ?? 'Unknown error' })) });
      }
    };
    if (action === 'delete' || action === 'archive' || action === 'unpublish') {
      const copy = {
        delete: { title: `Move ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} to the trash?`, message: 'Published entries will also disappear from the API immediately. Everything can be restored from the trash.', confirmLabel: 'Move to trash' },
        archive: { title: `Archive ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}?`, message: 'Archived entries are taken offline and become read-only until restored.', confirmLabel: 'Archive' },
        unpublish: { title: `Unpublish ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}?`, message: 'They will disappear from the API immediately and return to draft.', confirmLabel: 'Unpublish' },
      }[action];
      await confirm({ ...copy, destructive: action === 'delete', onConfirm: send });
      return;
    }
    setBusy('bulk');
    try {
      await send();
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleRow = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canCreate = ws.can('content.create');
  const canPublish = ws.can('content.publish');
  const canDelete = ws.can('content.delete');
  const selectable = canPublish || canDelete;
  const columnCount = 1 + visibleIds.length + (selectable ? 1 : 0) + 1;

  return (
    <Page width="full">
      <PageHeader
        title={
          <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center' }} component="span">
            <IconFor name={type.icon} sx={{ fontSize: 22, color: 'text.secondary' }} />
            <span>{type.displayName}</span>
          </Stack>
        }
        description={type.description || undefined}
        meta={type.options.requireApproval ? <Pill label="Approval required" fg="info.dark" bg="info.light" title="Entries must be approved before they can be published" /> : undefined}
        actions={
          <>
            <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={() => void api.download(`${ws.envBase}/entries/${type.apiId}/export`, undefined, `${type.apiId}-export.json`).catch((err) => toast.error(errorMessage(err)))}>
              Export
            </Button>
            {canCreate && (
              <Button variant="outlined" startIcon={<FileUploadOutlined />} onClick={() => setImporting(true)}>
                Import
              </Button>
            )}
            {canCreate && (
              <Button variant="contained" startIcon={<AddOutlined />} component={RouterLink} to={ws.href(`content/${type.apiId}/new`)}>
                New {type.singularName.toLowerCase()}
              </Button>
            )}
          </>
        }
      />

      <Tabs value={state.trash ? 'trash' : 'all'} onChange={(_, value) => update({ trash: value === 'trash', statuses: [] })} sx={{ mb: 4 }}>
        <Tab value="all" label={`All ${type.pluralName.toLowerCase()}`} />
        <Tab value="trash" label="Trash" />
      </Tabs>

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mb: 3, alignItems: 'center' }}>
        <SearchInput value={search} onChange={setSearch} placeholder={`Search ${type.pluralName.toLowerCase()}…`} />
        {!state.trash && (
          <TextField
            select
            value={state.statuses}
            onChange={(e) => update({ statuses: e.target.value as unknown as EntryStatus[] }, { sync: true })}
            sx={{ width: 170 }}
            slotProps={{
              htmlInput: { 'aria-label': 'Filter by status' },
              select: {
                multiple: true,
                displayEmpty: true,
                renderValue: (value) => {
                  const picked = value as EntryStatus[];
                  return picked.length === 0 ? <Box component="span" sx={{ color: 'text.secondary' }}>Any status</Box> : picked.length === 1 ? STATUS_LABELS[picked[0]] : `${picked.length} statuses`;
                },
              },
            }}
          >
            {ENTRY_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                <Checkbox checked={state.statuses.includes(status)} sx={{ p: 0, mr: 1 }} tabIndex={-1} />
                {STATUS_LABELS[status]}
              </MenuItem>
            ))}
          </TextField>
        )}
        {localized && (
          <TextField select value={state.locale} onChange={(e) => update({ locale: e.target.value })} sx={{ width: 150 }} slotProps={{ htmlInput: { 'aria-label': 'Filter by locale' }, select: { displayEmpty: true } }}>
            <MenuItem value="">All locales</MenuItem>
            {ws.project.locales.map((l) => (
              <MenuItem key={l.code} value={l.code}>
                {l.name} ({l.code})
              </MenuItem>
            ))}
          </TextField>
        )}
        <FilterBuilder fields={filterable} onAdd={(f) => update({ filters: [...state.filters.filter((x) => !(x.field === f.field && x.op === f.op)), f] })} />
        <Box sx={{ flex: 1 }} />
        <SavedViewsMenu
          views={viewsPref.value}
          current={currentView}
          canSave={filtered || state.sort !== DEFAULT_SORT}
          onApply={(view) => {
            setSearch(view.params.q);
            update({ ...view.params, trash: false });
          }}
          onSave={(name) => {
            viewsPref.set([...viewsPref.value.filter((v) => v.name.toLowerCase() !== name.toLowerCase()), { id: crypto.randomUUID(), name, params: currentView }]);
            toast.success(`View “${name}” saved`);
          }}
          onDelete={(id) => viewsPref.set(viewsPref.value.filter((v) => v.id !== id))}
        />
        <ColumnsMenu options={columnOptions} visible={visibleIds} onChange={(ids) => columnsPref.set(ids)} onReset={() => columnsPref.set(null)} />
        <Tooltip title={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}>
          <IconButton aria-label={density === 'compact' ? 'Switch to comfortable rows' : 'Switch to compact rows'} aria-pressed={density === 'compact'} onClick={() => dispatch(setTableDensity(density === 'compact' ? 'comfortable' : 'compact'))}>
            {density === 'compact' ? <DensityMediumOutlined /> : <DensitySmallOutlined />}
          </IconButton>
        </Tooltip>
      </Stack>

      {state.filters.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mb: 3, alignItems: 'center' }}>
          {state.filters.map((f) => (
            <Chip key={encodeFilter(f)} label={describeFilter(f, fieldById.get(f.field))} variant="outlined" onDelete={() => update({ filters: state.filters.filter((x) => x !== f) })} />
          ))}
          <Button size="small" onClick={clearFilters}>
            Clear all
          </Button>
        </Stack>
      )}

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden', position: 'relative' }}>
        {list.isFetching && !list.isLoading && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 2 }} aria-label="Refreshing" />}

        {selected.size > 0 && (
          <Stack direction="row" sx={{ px: 4, py: 2, gap: 2, alignItems: 'center', flexWrap: 'wrap', bgcolor: 'action.selected', borderBottom: 1, borderColor: 'border.subtle' }} role="toolbar" aria-label="Bulk actions">
            <Typography variant="subtitle2" sx={{ mr: 2 }}>
              {selected.size} selected
            </Typography>
            {state.trash ? (
              canDelete && (
                <Button size="small" variant="outlined" startIcon={<RestoreFromTrashOutlined />} loading={busy === 'bulk'} onClick={() => void runBulk('restore')}>
                  Restore
                </Button>
              )
            ) : (
              <>
                {canPublish && (
                  <>
                    <Button size="small" variant="outlined" startIcon={<PublicOutlined />} loading={busy === 'bulk'} onClick={() => void runBulk('publish')}>
                      Publish
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<PublicOffOutlined />} onClick={() => void runBulk('unpublish')}>
                      Unpublish
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<ArchiveOutlined />} onClick={() => void runBulk('archive')}>
                      Archive
                    </Button>
                  </>
                )}
                {canDelete && (
                  <Button size="small" variant="outlined" color="error" startIcon={<DeleteOutlineOutlined />} onClick={() => void runBulk('delete')}>
                    Move to trash
                  </Button>
                )}
              </>
            )}
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </Stack>
        )}

        {list.isLoading ? (
          <TableSkeleton rows={8} columns={Math.min(6, columnCount)} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          state.trash ? (
            <EmptyState icon={<DeleteOutlineOutlined />} title={state.q ? 'Nothing in the trash matches' : 'The trash is empty'} description="Deleted entries stay here until they are restored or deleted permanently." />
          ) : filtered ? (
            <EmptyState
              icon={<SearchOffOutlined />}
              title={`No ${type.pluralName.toLowerCase()} match`}
              description="Try a different search term or remove some filters."
              action={
                <Button variant="outlined" onClick={clearFilters}>
                  Clear search and filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<InboxOutlined />}
              title={`No ${type.pluralName.toLowerCase()} yet`}
              description={canCreate ? `Create the first ${type.singularName.toLowerCase()}, or import existing content from JSON.` : `Nobody has created a ${type.singularName.toLowerCase()} yet.`}
              action={
                canCreate && (
                  <Button variant="contained" startIcon={<AddOutlined />} component={RouterLink} to={ws.href(`content/${type.apiId}/new`)}>
                    New {type.singularName.toLowerCase()}
                  </Button>
                )
              }
            />
          )
        ) : (
          <TableContainer>
            <Table size={density === 'compact' ? 'small' : 'medium'} aria-label={type.displayName}>
              <TableHead>
                <TableRow>
                  {selectable && (
                    <TableCell padding="checkbox">
                      <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} slotProps={{ input: { 'aria-label': 'Select all entries on this page' } }} />
                    </TableCell>
                  )}
                  <TableCell sortDirection={sortField === 'title' ? sortDir : false} sx={{ minWidth: 240 }}>
                    {titleSortable ? (
                      <TableSortLabel active={sortField === 'title'} direction={sortField === 'title' ? sortDir : 'asc'} onClick={() => toggleSort('title')}>
                        {type.singularName}
                      </TableSortLabel>
                    ) : (
                      type.singularName
                    )}
                  </TableCell>
                  {visibleIds.map((id) => {
                    const field = id.startsWith('f:') ? fieldById.get(id.slice(2)) : undefined;
                    const system = SYSTEM_COLUMNS.find((c) => c.id === id);
                    const sortKey = field ? (isSortableField(field) ? field.apiId : undefined) : system?.sortKey;
                    const text = field?.label ?? system?.label ?? id;
                    return (
                      <TableCell key={id} sortDirection={sortKey && sortField === sortKey ? sortDir : false}>
                        {sortKey ? (
                          <TableSortLabel active={sortField === sortKey} direction={sortField === sortKey ? sortDir : 'asc'} onClick={() => toggleSort(sortKey)}>
                            {text}
                          </TableSortLabel>
                        ) : (
                          text
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell align="right" sx={{ width: 48 }}>
                    <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const isSelected = selected.has(row.id);
                  const to = ws.href(`content/${type.apiId}/${row.id}`);
                  return (
                    <TableRow key={row.id} hover selected={isSelected} sx={{ opacity: busy === row.id ? 0.5 : 1, '&.Mui-selected': { bgcolor: 'action.selected' } }}>
                      {selectable && (
                        <TableCell padding="checkbox">
                          <Checkbox checked={isSelected} onChange={() => toggleRow(row.id)} slotProps={{ input: { 'aria-label': `Select ${label(row)}` } }} />
                        </TableCell>
                      )}
                      <TableCell sx={{ maxWidth: 420 }}>
                        <Typography
                          component={RouterLink}
                          to={to}
                          variant="body2"
                          noWrap
                          sx={{ display: 'block', fontWeight: 500, color: row.title ? 'text.primary' : 'text.secondary', fontStyle: row.title ? 'normal' : 'italic', '&:hover': { color: 'secondary.main', textDecoration: 'none' } }}
                        >
                          {label(row)}
                        </Typography>
                        {state.trash && row.deletedAt && (
                          <Typography variant="caption" color="text.secondary" title={fullDateTime(row.deletedAt)}>
                            Deleted <RelativeTime value={row.deletedAt} />
                          </Typography>
                        )}
                      </TableCell>
                      {visibleIds.map((id) => {
                        if (id.startsWith('f:')) {
                          const field = fieldById.get(id.slice(2));
                          return <TableCell key={id}>{field ? <FieldCell field={field} value={row.data?.[field.apiId]} ctx={cellContext} /> : null}</TableCell>;
                        }
                        const system = SYSTEM_COLUMNS.find((c) => c.id === id);
                        return (
                          <TableCell key={id} sx={{ whiteSpace: 'nowrap', color: id === 'status' || id === 'locale' ? undefined : 'text.secondary' }}>
                            {system?.render(row)}
                          </TableCell>
                        );
                      })}
                      <TableCell align="right" padding="none" sx={{ pr: 2 }}>
                        <IconButton aria-label={`Actions for ${label(row)}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchor: e.currentTarget, row })}>
                          <MoreHorizOutlined />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {!list.isLoading && !list.isError && total > 0 && (
          <TableFooter page={state.page} pageSize={state.pageSize} total={total} onPage={(page) => update({ page })} onPageSize={(pageSize) => update({ pageSize })} />
        )}
      </Paper>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {menu &&
          (state.trash
            ? [
                <MenuItem key="open" component={RouterLink} to={ws.href(`content/${type.apiId}/${menu.row.id}`)} onClick={() => setMenu(null)}>
                  <ListItemIcon>
                    <OpenInNewOutlined />
                  </ListItemIcon>
                  View
                </MenuItem>,
                canDelete && (
                  <MenuItem
                    key="restore"
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void act(row.id, () => api.post(`${entryUrl(row)}/restore`), `Restored “${label(row)}”`, row.id);
                    }}
                  >
                    <ListItemIcon>
                      <RestoreFromTrashOutlined />
                    </ListItemIcon>
                    Restore
                  </MenuItem>
                ),
                canDelete && <Divider key="divider" sx={{ my: 1 }} />,
                canDelete && (
                  <MenuItem
                    key="purge"
                    sx={{ color: 'error.main' }}
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void purge(row);
                    }}
                  >
                    <ListItemIcon>
                      <DeleteForeverOutlined />
                    </ListItemIcon>
                    Delete permanently
                  </MenuItem>
                ),
              ]
            : [
                <MenuItem key="open" component={RouterLink} to={ws.href(`content/${type.apiId}/${menu.row.id}`)} onClick={() => setMenu(null)}>
                  <ListItemIcon>
                    <OpenInNewOutlined />
                  </ListItemIcon>
                  Open
                </MenuItem>,
                canCreate && (
                  <MenuItem
                    key="duplicate"
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void duplicate(row);
                    }}
                  >
                    <ListItemIcon>
                      <ContentCopyOutlined />
                    </ListItemIcon>
                    Duplicate
                  </MenuItem>
                ),
                canPublish && menu.row.status !== 'ARCHIVED' && (!menu.row.isPublished || menu.row.hasChanges) && (
                  <MenuItem
                    key="publish"
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void act(row.id, () => api.post(`${entryUrl(row)}/publish`), `Published “${label(row)}”`, row.id);
                    }}
                  >
                    <ListItemIcon>
                      <PublicOutlined />
                    </ListItemIcon>
                    {menu.row.isPublished ? 'Publish changes' : 'Publish'}
                  </MenuItem>
                ),
                canPublish && menu.row.isPublished && (
                  <MenuItem
                    key="unpublish"
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void act(row.id, () => api.post(`${entryUrl(row)}/unpublish`), `Unpublished “${label(row)}”`, row.id);
                    }}
                  >
                    <ListItemIcon>
                      <PublicOffOutlined />
                    </ListItemIcon>
                    Unpublish
                  </MenuItem>
                ),
                canDelete && <Divider key="divider" sx={{ my: 1 }} />,
                canDelete && (
                  <MenuItem
                    key="delete"
                    sx={{ color: 'error.main' }}
                    onClick={() => {
                      const row = menu.row;
                      setMenu(null);
                      void remove(row);
                    }}
                  >
                    <ListItemIcon>
                      <DeleteOutlineOutlined />
                    </ListItemIcon>
                    Move to trash
                  </MenuItem>
                ),
              ])}
      </Menu>

      <ImportDialog type={type} open={importing} onClose={() => setImporting(false)} onImported={() => invalidate()} />
      <BulkOutcomeDialog outcome={outcome} onClose={() => setOutcome(null)} />
    </Page>
  );
}
