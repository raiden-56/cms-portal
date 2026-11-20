import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
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
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import PlaylistAddOutlined from '@mui/icons-material/PlaylistAddOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, Page, PageHeader, Pill, SearchInput, Section, StatusChip, TableSkeleton, useDebounced } from '@/components/ui';
import { ProblemAlert } from '@/features/content/dialogs';
import { entryHref, useInvalidateContent } from '@/features/content/hooks';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fullDateTime, relativeTime, toLocalInput } from '@/lib/format';
import type { EntryListItem, Release, ReleaseItem, SearchHit } from '@/lib/types';
import { toast } from '@/store';
import { ActionPill, Hint, NO_RELEASE_ACCESS, ReleaseFormDialog, ReleaseStatusPill, entryCount, titleLinkSx } from './parts';

interface Check {
  itemId: string;
  entryId: string;
  title: string | null;
  contentType: string | null;
  action: ReleaseItem['action'];
  ok: boolean;
  problems: string[];
}

interface Validation {
  ready: boolean;
  checks: Check[];
}

const untitled = (title: string | null | undefined) => title ?? 'Untitled';

// ─── Schedule ────────────────────────────────────────────────────────────────

/** Tomorrow at 09:00 in the viewer's timezone: a sensible starting point for a launch. */
function suggestedTime(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

function ScheduleReleaseDialog({ open, release, base, onClose, onSaved }: { open: boolean; release: Release; base: string; onClose: () => void; onSaved: (release: Release) => void }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setValue(toLocalInput(release.scheduledAt ?? suggestedTime()));
    setTouched(false);
    setError(null);
  }, [open, release.scheduledAt]);

  const at = value ? new Date(value).getTime() : Number.NaN;
  const problem = Number.isNaN(at) ? 'Choose a date and time' : at <= Date.now() ? 'Choose a time in the future' : null;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.patch<Release>(base, { scheduledAt: new Date(value).toISOString() }));
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" aria-labelledby="release-schedule-title">
      <form noValidate onSubmit={(e) => void submit(e)}>
        <DialogTitle id="release-schedule-title">{release.status === 'SCHEDULED' ? 'Reschedule release' : 'Schedule release'}</DialogTitle>
        <DialogContent>
          <Stack spacing={4} sx={{ pt: 1 }}>
            <ProblemAlert error={error} />
            <TextField
              label="Publish at"
              type="datetime-local"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              error={touched && !!problem}
              helperText={touched && problem ? problem : 'Every entry in the release goes live at this time, or none of them do.'}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: toLocalInput(new Date()) } }}
            />
            <Typography variant="caption" color="text.secondary">
              Times are in your timezone ({timezone}). The release is checked again when it runs; if an entry is not ready then, nothing is published and the release is marked as failed.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={busy}>
            {release.status === 'SCHEDULED' ? 'Save new time' : 'Schedule release'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ─── Add entries ─────────────────────────────────────────────────────────────

function AddEntriesDialog({ open, release, base, onClose, onAdded }: { open: boolean; release: Release; base: string; onClose: () => void; onAdded: (release: Release, count: number) => void }) {
  const { environment, envBase, project } = useProject();
  const [text, setText] = useState('');
  const term = useDebounced(text.trim().slice(0, 100), 250);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [action, setAction] = useState<ReleaseItem['action']>('PUBLISH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setSelected({});
    setAction('PUBLISH');
    setError(null);
  }, [open]);

  const searching = term.length > 0;
  const recent = useQuery({
    queryKey: ['recent', environment.id, 'release-picker'],
    queryFn: () => api.get<{ items: EntryListItem[] }>(`${envBase}/recent`).then((r) => r.items),
    enabled: open,
  });
  const search = useQuery<SearchHit[]>({
    queryKey: ['search', environment.id, 'release-picker', term],
    queryFn: ({ signal }) => api.get<{ items: SearchHit[] }>(`${envBase}/search`, { q: term }, signal).then((r) => r.items),
    enabled: open && searching,
    placeholderData: keepPreviousData,
  });
  const source = searching ? search : recent;
  const rows: (EntryListItem | SearchHit)[] = (searching ? search.data : recent.data) ?? [];
  const inRelease = useMemo(() => new Map((release.items ?? []).map((item) => [item.entryId, item.action])), [release.items]);
  const ids = Object.keys(selected);
  const multiLocale = project.locales.length > 1;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });

  const add = async () => {
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await api.post<Release>(`${base}/items`, { entryIds: ids, action }), ids.length);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" aria-labelledby="add-entries-title">
      <DialogTitle id="add-entries-title">Add entries to “{release.name}”</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <ProblemAlert error={error} />
          <SearchInput value={text} onChange={setText} placeholder="Search entries and pages by title" width="100%" autoFocus />
          <Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
              {searching ? `Results for “${term}”` : 'Recently edited'}
            </Typography>
            <Box sx={{ position: 'relative', height: 304, overflowY: 'auto', border: 1, borderColor: 'border.subtle', borderRadius: '8px' }}>
              {searching && search.isFetching && <LinearProgress color="secondary" aria-label="Searching" sx={{ position: 'sticky', top: 0, height: 2, mb: '-2px', zIndex: 1 }} />}
              {source.isLoading ? (
                <TableSkeleton rows={6} columns={2} />
              ) : source.isError ? (
                <ErrorState compact error={source.error} onRetry={() => void source.refetch()} />
              ) : rows.length === 0 ? (
                <EmptyState
                  compact
                  icon={<SearchOutlined />}
                  title={searching ? 'No matching entries' : 'No content yet'}
                  description={searching ? 'Try a different title. Entries in the trash cannot be added.' : 'Entries and pages appear here once they have been created.'}
                />
              ) : (
                <List dense disablePadding aria-label={searching ? 'Search results' : 'Recently edited entries'}>
                  {rows.map((row) => {
                    const labelId = `add-entry-${row.id}`;
                    const existing = inRelease.get(row.id);
                    return (
                      <ListItem key={row.id} disablePadding divider>
                        <ListItemButton role={undefined} onClick={() => toggle(row.id)} sx={{ borderRadius: 0, gap: 2, py: 1.5, pl: 3, pr: 3 }}>
                          <Checkbox edge="start" checked={!!selected[row.id]} tabIndex={-1} disableRipple slotProps={{ input: { 'aria-labelledby': labelId } }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography id={labelId} variant="body2" noWrap sx={{ fontWeight: 500 }}>
                              {untitled(row.title)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {row.contentTypeName}
                              {row.path ? ` · ${row.path}` : ''}
                              {multiLocale && row.locale ? ` · ${row.locale}` : ''}
                            </Typography>
                          </Box>
                          {existing && <Pill label={existing === 'PUBLISH' ? 'In release · publish' : 'In release · unpublish'} title="Adding it again changes what the release does with it" />}
                          <StatusChip status={row.status} />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </Box>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" id="add-entries-action">
                When the release is published
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {action === 'PUBLISH' ? 'The current draft of each selected entry goes live.' : 'Each selected entry is taken offline.'}
              </Typography>
            </Box>
            <ToggleButtonGroup exclusive size="small" value={action} onChange={(_, next: ReleaseItem['action'] | null) => next && setAction(next)} aria-labelledby="add-entries-action" sx={{ flexShrink: 0 }}>
              <ToggleButton value="PUBLISH">Publish</ToggleButton>
              <ToggleButton value="UNPUBLISH">Unpublish</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" aria-live="polite" noWrap>
            {ids.length === 0 ? 'Nothing selected' : `${ids.length} selected`}
          </Typography>
          {ids.length > 0 && (
            <Button size="small" onClick={() => setSelected({})} disabled={busy}>
              Clear
            </Button>
          )}
        </Stack>
        <Stack direction="row" spacing={2}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" disabled={ids.length === 0} loading={busy} onClick={() => void add()}>
            {ids.length > 1 ? `Add ${ids.length} entries` : 'Add entry'}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReleaseDetailPage() {
  const { releaseId = '' } = useParams();
  const ws = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const invalidateContent = useInvalidateContent();
  const envId = ws.environment.id;
  const base = `${ws.envBase}/releases/${releaseId}`;
  const key = useMemo(() => ['release', envId, releaseId], [envId, releaseId]);
  const listHref = ws.href('publishing/releases');

  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [checked, setChecked] = useState(false);
  const [publishError, setPublishError] = useState<unknown>(null);

  useEffect(() => {
    setChecked(false);
    setPublishError(null);
  }, [releaseId]);

  const query = useQuery({ queryKey: key, queryFn: () => api.get<Release>(base), enabled: !!releaseId });
  const release = query.data;
  const editable = !!release && release.status !== 'PUBLISHED';
  const validation = useQuery({
    queryKey: [...key, 'validation'],
    queryFn: () => api.get<Validation>(`${base}/validate`),
    enabled: checked && editable,
    staleTime: 0,
  });
  const checks = useMemo(() => new Map((validation.data?.checks ?? []).map((check) => [check.itemId, check])), [validation.data]);

  useCrumbs(release ? [{ label: release.name }] : []);

  /** Shows the server's copy at once, then refreshes everything that lists or summarises releases. */
  const applied = (updated: Release) => {
    queryClient.setQueryData(key, updated);
    void queryClient.invalidateQueries({ queryKey: [...key, 'validation'] });
    void queryClient.invalidateQueries({ queryKey: ['releases', envId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', envId] });
  };

  const remove = useMutation({
    mutationFn: (item: ReleaseItem) => api.delete<Release>(`${base}/items/${item.id}`),
    onSuccess: (updated, item) => {
      applied(updated);
      toast.success(`Removed “${untitled(item.title)}” from the release`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const missing = query.error instanceof ApiError && query.error.status === 404;

  if (query.isLoading) {
    return (
      <Page>
        <Box aria-busy="true" aria-label="Loading release">
          <Skeleton variant="rounded" width={260} height={28} sx={{ mb: 2 }} />
          <Skeleton variant="rounded" height={14} sx={{ mb: 6, maxWidth: 440 }} />
        </Box>
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <TableSkeleton rows={5} columns={5} />
        </Paper>
      </Page>
    );
  }

  if (!release || missing) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          {missing ? (
            <EmptyState
              icon={<RocketLaunchOutlined />}
              title="This release no longer exists"
              description="It may have been deleted, or it belongs to another environment."
              action={
                <Button variant="outlined" component={RouterLink} to={listHref}>
                  Back to releases
                </Button>
              }
            />
          ) : (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          )}
        </Paper>
      </Page>
    );
  }

  const items = release.items ?? [];
  const empty = items.length === 0;
  const canManage = ws.can('release.manage');
  const canPublish = canManage && ws.can('content.publish');
  const publishes = items.filter((item) => item.action === 'PUBLISH').length;
  const unpublishes = items.length - publishes;
  const failing = validation.data ? validation.data.checks.filter((check) => !check.ok).length : 0;
  const showChecks = checked && editable;

  const validate = () => {
    if (checked) void validation.refetch();
    else setChecked(true);
  };

  const publish = () => {
    const changes = [publishes ? `${entryCount(publishes)} will be published` : '', unpublishes ? `${entryCount(unpublishes)} will be unpublished` : ''].filter(Boolean).join(' and ');
    void confirm({
      title: `Publish “${release.name}”?`,
      message: (
        <>
          {changes}, all at the same moment. If any of them cannot go through, nothing changes on the live site.
          {release.status === 'SCHEDULED' ? ' Publishing now replaces the scheduled time.' : ''}
        </>
      ),
      confirmLabel: 'Publish release',
      onConfirm: async () => {
        try {
          const updated = await api.post<Release>(`${base}/publish`, {});
          setPublishError(null);
          queryClient.setQueryData(key, updated);
          invalidateContent();
          for (const item of items) void queryClient.invalidateQueries({ queryKey: ['entry', envId, item.entryId] });
          toast.success(`Published “${release.name}”`);
        } catch (err) {
          // Keep the full list of problems on the page; the dialog only has room for the summary.
          setPublishError(err);
          setChecked(true);
          void queryClient.invalidateQueries({ queryKey: key });
          void queryClient.invalidateQueries({ queryKey: ['releases', envId] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard', envId] });
          throw err;
        }
      },
    });
  };

  const unschedule = () =>
    void confirm({
      title: 'Unschedule this release?',
      message: 'It goes back to open and stays unpublished until you publish it or schedule it again.',
      confirmLabel: 'Unschedule',
      cancelLabel: 'Keep schedule',
      onConfirm: async () => {
        applied(await api.patch<Release>(base, { scheduledAt: null }));
        toast.success('Release unscheduled');
      },
    });

  const destroy = async () => {
    const confirmed = await confirm({
      title: `Delete “${release.name}”?`,
      message:
        release.status === 'PUBLISHED'
          ? 'Only the record of this release is deleted. The content it published stays live.'
          : `The release and its list of ${entryCount(items.length)} are deleted. The entries themselves are not changed.`,
      confirmLabel: 'Delete release',
      destructive: true,
      onConfirm: () => api.delete(base),
    });
    if (!confirmed) return;
    toast.success(`Deleted “${release.name}”`);
    navigate(listHref, { replace: true });
    void queryClient.invalidateQueries({ queryKey: ['releases', envId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', envId] });
  };

  const addButton = (
    <Hint title={canManage ? '' : NO_RELEASE_ACCESS}>
      <Button size="small" variant="outlined" startIcon={<AddOutlined />} disabled={!canManage} onClick={() => setAdding(true)}>
        Add entries
      </Button>
    </Hint>
  );

  return (
    <Page>
      <Button component={RouterLink} to={listHref} size="small" startIcon={<ArrowBackOutlined />} sx={{ mb: 2, ml: -2, color: 'text.secondary' }}>
        Releases
      </Button>
      <PageHeader
        title={release.name}
        meta={<ReleaseStatusPill status={release.status} />}
        description={release.description || (editable ? 'No description yet.' : undefined)}
        actions={
          <>
            {editable && (
              <>
                <Hint title={empty ? 'Add at least one entry first' : ''}>
                  <Button variant="outlined" startIcon={<FactCheckOutlined />} disabled={empty} loading={validation.isFetching} onClick={validate}>
                    Validate
                  </Button>
                </Hint>
                {release.status !== 'SCHEDULED' && (
                  <Hint title={!canManage ? NO_RELEASE_ACCESS : empty ? 'Add at least one entry first' : ''}>
                    <Button variant="outlined" startIcon={<EventOutlined />} disabled={!canManage || empty} onClick={() => setScheduling(true)}>
                      Schedule
                    </Button>
                  </Hint>
                )}
                <Hint title={!canPublish ? 'Publishing a release needs both release and publishing rights' : empty ? 'Add at least one entry first' : ''}>
                  <Button variant="contained" startIcon={<RocketLaunchOutlined />} disabled={!canPublish || empty} onClick={publish}>
                    {release.status === 'SCHEDULED' ? 'Publish now' : 'Publish release'}
                  </Button>
                </Hint>
                <Tooltip title={canManage ? 'Edit name and description' : NO_RELEASE_ACCESS}>
                  <span style={{ display: 'inline-flex' }}>
                    <IconButton aria-label="Edit name and description" disabled={!canManage} onClick={() => setEditing(true)}>
                      <EditOutlined />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
            <Tooltip title={canManage ? 'Delete release' : NO_RELEASE_ACCESS}>
              <span style={{ display: 'inline-flex' }}>
                <IconButton aria-label="Delete release" disabled={!canManage} onClick={() => void destroy()}>
                  <DeleteOutlineOutlined />
                </IconButton>
              </span>
            </Tooltip>
          </>
        }
      />

      <Stack spacing={3} sx={{ mb: 5, '&:empty': { display: 'none' } }}>
        {release.status === 'PUBLISHED' && (
          <Alert severity="success">
            Published {fullDateTime(release.publishedAt)}. This release is now a record of what went live and can no longer be changed.
          </Alert>
        )}
        {release.status === 'SCHEDULED' && release.scheduledAt && (
          <Alert
            severity="info"
            icon={<EventOutlined fontSize="inherit" />}
            action={
              canManage ? (
                <Stack direction="row" spacing={1}>
                  <Button size="small" color="inherit" onClick={() => setScheduling(true)}>
                    Reschedule
                  </Button>
                  <Button size="small" color="inherit" onClick={unschedule}>
                    Unschedule
                  </Button>
                </Stack>
              ) : undefined
            }
          >
            Scheduled to publish on <strong>{fullDateTime(release.scheduledAt)}</strong> ({relativeTime(release.scheduledAt)}).
          </Alert>
        )}
        {release.status === 'FAILED' && !publishError && (
          <Alert severity="error" sx={{ alignItems: 'flex-start' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              The last attempt to publish this release failed, so nothing went live
            </Typography>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {release.error ?? 'Validate the release to see which entries need attention.'}
            </Typography>
          </Alert>
        )}
        <ProblemAlert error={publishError} onClose={() => setPublishError(null)} />
        {showChecks && validation.isError && (
          <Alert
            severity="error"
            action={
              <Button size="small" color="inherit" onClick={() => void validation.refetch()}>
                Try again
              </Button>
            }
          >
            The release could not be validated. {errorMessage(validation.error)}
          </Alert>
        )}
        {showChecks && validation.data && !validation.isError && !empty && (
          <Alert severity={validation.data.ready ? 'success' : 'warning'} onClose={() => setChecked(false)}>
            {validation.data.ready
              ? `All ${entryCount(validation.data.checks.length)} passed validation. This release is ready to publish.`
              : `${failing} of ${entryCount(validation.data.checks.length)} cannot be published yet. A release is all or nothing, so fix or remove them first.`}
          </Alert>
        )}
      </Stack>

      <Section
        title="Entries"
        description={empty ? 'Nothing has been added yet.' : [publishes ? `${publishes} to publish` : '', unpublishes ? `${unpublishes} to unpublish` : ''].filter(Boolean).join(' · ')}
        action={editable ? addButton : undefined}
        flush
      >
        {empty ? (
          <EmptyState
            compact
            icon={<PlaylistAddOutlined />}
            title={editable ? 'This release is empty' : 'This release had no entries'}
            description={editable ? 'Add the entries and pages that should change together. Each one is either published or taken offline when the release runs.' : undefined}
            action={editable && canManage ? addButton : undefined}
          />
        ) : (
          <TableContainer>
            <Table aria-label="Entries in this release">
              <TableHead>
                <TableRow>
                  <TableCell>Entry</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Current status</TableCell>
                  {showChecks && <TableCell>Validation</TableCell>}
                  {editable && canManage && <TableCell align="right" aria-label="Remove" />}
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const working = remove.isPending && remove.variables?.id === item.id;
                  const linkable = !item.deleted && (item.isPage || !!item.contentType);
                  const check = checks.get(item.id);
                  const detail = [item.path, ws.project.locales.length > 1 ? item.locale : ''].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={item.id} hover sx={{ opacity: working ? 0.55 : 1 }}>
                      <TableCell sx={{ maxWidth: 380, minWidth: 200 }}>
                        {linkable ? (
                          <Typography component={RouterLink} to={entryHref(ws, { id: item.entryId, contentType: item.contentType, isPage: item.isPage })} variant="body2" noWrap sx={titleLinkSx}>
                            {untitled(item.title)}
                          </Typography>
                        ) : (
                          <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: item.deleted ? 'text.secondary' : 'text.primary' }}>
                            {untitled(item.title)}
                          </Typography>
                        )}
                        {(detail || item.deleted) && (
                          <Typography variant="caption" color={item.deleted ? 'warning.dark' : 'text.secondary'} noWrap component="div">
                            {item.deleted ? 'This entry is in the trash' : detail}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{item.contentTypeName}</TableCell>
                      <TableCell>
                        <ActionPill action={item.action} />
                      </TableCell>
                      <TableCell>
                        <StatusChip status={item.status} isPublished={item.isPublished} hasChanges={item.hasChanges} />
                      </TableCell>
                      {showChecks && (
                        <TableCell sx={{ minWidth: 200, maxWidth: 360 }}>
                          {validation.isFetching && !check ? (
                            <Skeleton variant="rounded" width={72} height={14} />
                          ) : !check ? (
                            <Typography variant="body2" color="text.disabled">
                              Not checked
                            </Typography>
                          ) : check.ok ? (
                            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'success.dark' }}>
                              <CheckCircleOutlined sx={{ fontSize: 16 }} aria-hidden />
                              <Typography variant="body2" color="inherit">
                                Ready
                              </Typography>
                            </Stack>
                          ) : (
                            <Box component="ul" aria-label={`Problems with ${untitled(item.title)}`} sx={{ m: 0, pl: 4, color: 'error.main' }}>
                              {(check.problems.length ? check.problems : ['This entry cannot be published as it is.']).map((problem, index) => (
                                <li key={index}>
                                  <Typography variant="body2" color="inherit" sx={{ overflowWrap: 'anywhere' }}>
                                    {problem}
                                  </Typography>
                                </li>
                              ))}
                            </Box>
                          )}
                        </TableCell>
                      )}
                      {editable && canManage && (
                        <TableCell align="right" sx={{ width: 48 }}>
                          <Tooltip title="Remove from release">
                            <span>
                              <IconButton size="small" aria-label={`Remove ${untitled(item.title)} from the release`} disabled={working} onClick={() => remove.mutate(item)}>
                                <CloseOutlined sx={{ fontSize: 16 }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <ReleaseFormDialog
        open={editing}
        release={release}
        onClose={() => setEditing(false)}
        onSaved={(updated) => {
          applied(updated);
          toast.success('Release details saved');
        }}
      />
      <ScheduleReleaseDialog
        open={scheduling}
        release={release}
        base={base}
        onClose={() => setScheduling(false)}
        onSaved={(updated) => {
          applied(updated);
          void queryClient.invalidateQueries({ queryKey: ['scheduled', envId] });
          toast.success(`Scheduled for ${fullDateTime(updated.scheduledAt)}`);
        }}
      />
      <AddEntriesDialog
        open={adding}
        release={release}
        base={base}
        onClose={() => setAdding(false)}
        onAdded={(updated, count) => {
          applied(updated);
          toast.success(`Added ${entryCount(count)} to the release`);
        }}
      />
    </Page>
  );
}
