import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import RestoreOutlined from '@mui/icons-material/RestoreOutlined';
import { useProject, useSchema } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CodeBlock, EmptyState, ErrorState, Page, PageHeader, Pill, RelativeTime, TableFooter, TableSkeleton, UserAvatar } from '@/components/ui';
import { VersionKindPill } from '@/features/content/EntryPanels';
import { DataPreview } from '@/features/content/VersionDiff';
import { entryHref, useInvalidateContent } from '@/features/content/hooks';
import { api } from '@/lib/api';
import { fullDateTime } from '@/lib/format';
import type { EntryDetail, EntryVersion, Page as Paged } from '@/lib/types';
import { toast } from '@/store';
import { Hint, titleLinkSx } from './parts';

/** A version as listed in the environment-wide feed: the version plus the entry it belongs to. */
interface VersionRow {
  id: string;
  number: number;
  kind: EntryVersion['kind'];
  title: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  entryId: string;
  entryDeleted: boolean;
  locale: string;
  contentType: string | null;
  contentTypeName: string;
  isPage: boolean;
  isPublished: boolean;
}

type KindFilter = 'ALL' | 'PUBLISH' | 'SAVE' | 'RESTORE';

const FILTERS: { value: KindFilter; label: string; empty: string }[] = [
  { value: 'ALL', label: 'All', empty: 'No versions yet' },
  { value: 'PUBLISH', label: 'Published', empty: 'Nothing has been published yet' },
  { value: 'SAVE', label: 'Saved', empty: 'No saved versions yet' },
  { value: 'RESTORE', label: 'Restored', empty: 'No versions have been restored' },
];

const untitled = (title: string | null | undefined) => title ?? 'Untitled';

const LivePill = () => <Pill label="Live" fg="success.dark" bg="success.light" dot title="This is the version currently served by the API" />;

// ─── Version viewer ──────────────────────────────────────────────────────────

function VersionDialog({ row, onClose }: { row: VersionRow | null; onClose: () => void }) {
  const ws = useProject();
  const schema = useSchema();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const invalidate = useInvalidateContent();
  const envId = ws.environment.id;
  const [view, setView] = useState<'fields' | 'json'>('fields');

  // Keep showing the last version while the dialog animates out.
  const [shown, setShown] = useState<VersionRow | null>(row);
  if (row && row !== shown) setShown(row);

  const version = useQuery({
    queryKey: ['entry-version', envId, shown?.entryId, shown?.id],
    queryFn: () => api.get<EntryVersion>(`${ws.envBase}/entry/${shown?.entryId}/versions/${shown?.id}`),
    enabled: !!row,
    staleTime: Infinity,
  });

  const type = schema.data?.types.find((t) => t.apiId === shown?.contentType);
  const fields = useMemo(() => (type ? [...type.fields].sort((a, b) => a.position - b.position) : []), [type]);
  const hasFields = fields.length > 0;
  const mode = hasFields ? view : 'json';

  const canRestore = ws.can('content.update');
  const href = shown && !shown.entryDeleted && (shown.isPage || shown.contentType) ? entryHref(ws, { id: shown.entryId, contentType: shown.contentType, isPage: shown.isPage }) : null;
  const blocked = !shown ? '' : shown.entryDeleted ? 'This entry is in the trash. Restore the entry itself before restoring one of its versions.' : !canRestore ? 'Your role cannot edit content' : '';

  const restore = () => {
    if (!shown) return;
    const target = shown;
    void confirm({
      title: `Restore version ${target.number}?`,
      message: (
        <>
          The working copy of “{untitled(target.title)}” will be replaced with the content of version {target.number}. Nothing changes on the live site until it is published.
        </>
      ),
      confirmLabel: 'Restore version',
      onConfirm: async () => {
        await api.post<EntryDetail>(`${ws.envBase}/entry/${target.entryId}/versions/${target.id}/restore`, {});
        invalidate(target.entryId);
        void queryClient.invalidateQueries({ queryKey: ['entry', envId, target.entryId] });
        toast.success(`Restored version ${target.number} of “${untitled(target.title)}”`, href ? { label: 'Open entry', href } : undefined);
        onClose();
      },
    });
  };

  return (
    <Dialog open={!!row} onClose={onClose} maxWidth="md" scroll="paper" aria-labelledby="version-title">
      <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box component="h2" id="version-title" sx={{ m: 0, font: 'inherit', overflowWrap: 'anywhere' }}>
            Version {shown?.number} of “{untitled(shown?.title)}”
          </Box>
          {shown && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1.5 }}>
              <VersionKindPill kind={shown.kind} />
              {shown.isPublished && <LivePill />}
              {shown.entryDeleted && <Pill label="Entry in trash" fg="warning.dark" bg="warning.light" />}
              <Typography variant="caption" color="text.secondary">
                {shown.contentTypeName} · {shown.createdBy ?? 'System'} · {fullDateTime(shown.createdAt)}
              </Typography>
            </Stack>
          )}
        </Box>
        <IconButton aria-label="Close" edge="end" onClick={onClose} sx={{ mt: -1 }}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 280 }}>
        {shown?.note && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4, overflowWrap: 'anywhere' }}>
            Note: {shown.note}
          </Typography>
        )}
        {version.isLoading ? (
          <Stack spacing={4} aria-busy="true" aria-label="Loading version">
            {[0, 1, 2, 3].map((i) => (
              <Box key={i}>
                <Skeleton variant="rounded" width={120} height={10} sx={{ mb: 1.5 }} />
                <Skeleton variant="rounded" height={16} sx={{ maxWidth: `${88 - i * 14}%` }} />
              </Box>
            ))}
          </Stack>
        ) : version.isError ? (
          <ErrorState compact error={version.error} onRetry={() => void version.refetch()} />
        ) : version.data ? (
          <>
            {hasFields && (
              <ToggleButtonGroup exclusive size="small" value={view} onChange={(_, next: 'fields' | 'json' | null) => next && setView(next)} aria-label="How to show this version" sx={{ mb: 4 }}>
                <ToggleButton value="fields">Fields</ToggleButton>
                <ToggleButton value="json">JSON</ToggleButton>
              </ToggleButtonGroup>
            )}
            {mode === 'fields' ? <DataPreview data={version.data.data} fields={fields} /> : <CodeBlock code={JSON.stringify(version.data.data ?? {}, null, 2)} language="json" maxHeight={520} />}
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Box>
          {href && (
            <Button component={RouterLink} to={href}>
              Open entry
            </Button>
          )}
        </Box>
        <Stack direction="row" spacing={2}>
          <Hint title={blocked}>
            <Button variant="outlined" startIcon={<RestoreOutlined />} disabled={!!blocked || !version.data} onClick={restore}>
              Restore this version
            </Button>
          </Hint>
          <Button variant="contained" onClick={onClose}>
            Close
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function VersionHistoryPage() {
  const ws = useProject();
  const envId = ws.environment.id;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [viewing, setViewing] = useState<VersionRow | null>(null);
  const multiLocale = ws.project.locales.length > 1;

  const params = { page, pageSize, kind: kind === 'ALL' ? undefined : kind };
  const versions = useQuery({
    queryKey: ['versions', envId, params],
    queryFn: () => api.get<Paged<VersionRow>>(`${ws.envBase}/versions`, params),
    placeholderData: keepPreviousData,
  });
  const rows = versions.data?.items ?? [];
  const total = versions.data?.meta.total ?? 0;
  const filter = FILTERS.find((f) => f.value === kind) as (typeof FILTERS)[number];

  return (
    <Page>
      <PageHeader title="Version history" description="Every saved, published and restored version across this environment, newest first. Open one to see its content or bring it back as the working copy." />

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        <Stack direction="row" spacing={3} sx={{ px: 3, py: 2.5, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle', overflowX: 'auto' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={kind}
            onChange={(_, next: KindFilter | null) => {
              if (!next) return;
              setKind(next);
              setPage(1);
            }}
            aria-label="Filter versions by kind"
          >
            {FILTERS.map((f) => (
              <ToggleButton key={f.value} value={f.value}>
                {f.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {versions.data && (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} aria-live="polite">
              {total.toLocaleString('en')} {total === 1 ? 'version' : 'versions'}
            </Typography>
          )}
        </Stack>

        {versions.isLoading ? (
          <TableSkeleton rows={10} columns={6} />
        ) : versions.isError ? (
          <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            compact={kind !== 'ALL'}
            icon={<HistoryOutlined />}
            title={filter.empty}
            description={kind === 'ALL' ? 'A version is recorded each time content is saved, published or restored. They will be listed here.' : 'Choose another filter to see the rest of the history.'}
          />
        ) : (
          <>
            <TableContainer sx={{ opacity: versions.isPlaceholderData ? 0.55 : 1, transition: 'opacity 120ms' }} aria-busy={versions.isPlaceholderData}>
              <Table aria-label="Version history">
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Entry</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Change</TableCell>
                    <TableCell>Author</TableCell>
                    <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>Note</TableCell>
                    <TableCell align="right" aria-label="Actions" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const linkable = !row.entryDeleted && (row.isPage || !!row.contentType);
                    return (
                      <TableRow key={row.id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                          <RelativeTime value={row.createdAt} />
                        </TableCell>
                        <TableCell sx={{ maxWidth: 340, minWidth: 200 }}>
                          {linkable ? (
                            <Typography component={RouterLink} to={entryHref(ws, { id: row.entryId, contentType: row.contentType, isPage: row.isPage })} variant="body2" noWrap sx={titleLinkSx}>
                              {untitled(row.title)}
                            </Typography>
                          ) : (
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: row.entryDeleted ? 'text.secondary' : 'text.primary' }}>
                              {untitled(row.title)}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            Version {row.number}
                            {multiLocale && row.locale ? ` · ${row.locale}` : ''}
                            {row.entryDeleted ? ' · Entry in trash' : ''}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{row.contentTypeName}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                            <VersionKindPill kind={row.kind} />
                            {row.isPublished && <LivePill />}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', minWidth: 0 }}>
                            <UserAvatar name={row.createdBy ?? 'System'} size={22} />
                            <Typography variant="body2" noWrap color={row.createdBy ? 'text.primary' : 'text.secondary'}>
                              {row.createdBy ?? 'System'}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 260, display: { xs: 'none', lg: 'table-cell' } }}>
                          {row.note ? (
                            <Tooltip title={row.note.length > 40 ? row.note : ''}>
                              <Typography variant="body2" color="text.secondary" noWrap>
                                {row.note}
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography variant="body2" color="text.disabled">
                              —
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Button size="small" onClick={() => setViewing(row)} aria-label={`View version ${row.number} of ${untitled(row.title)}`}>
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <TableFooter
              page={page}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Paper>

      <VersionDialog row={viewing} onClose={() => setViewing(null)} />
    </Page>
  );
}
