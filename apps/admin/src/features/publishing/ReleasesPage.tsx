import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
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
import AddOutlined from '@mui/icons-material/AddOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import { useProject } from '@/app/workspace';
import { EmptyState, ErrorState, Page, PageHeader, RelativeTime, TableSkeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { fullDateTime, relativeTime } from '@/lib/format';
import type { Release } from '@/lib/types';
import { toast } from '@/store';
import { Hint, NO_RELEASE_ACCESS, ReleaseFormDialog, ReleaseStatusPill, entryCount, releaseStatusLabel, titleLinkSx } from './parts';

type Filter = 'ALL' | Release['status'];

const FILTERS: Filter[] = ['ALL', 'OPEN', 'SCHEDULED', 'PUBLISHED', 'FAILED'];

/** Releases that need attention first, then what is coming up, then history. */
const ORDER: Record<Release['status'], number> = { FAILED: 0, SCHEDULED: 1, OPEN: 2, PUBLISHED: 3 };

const time = (value: string | null) => (value ? new Date(value).getTime() : 0);

function byUrgency(a: Release, b: Release): number {
  if (a.status !== b.status) return ORDER[a.status] - ORDER[b.status];
  if (a.status === 'SCHEDULED') return time(a.scheduledAt) - time(b.scheduledAt);
  if (a.status === 'PUBLISHED') return time(b.publishedAt) - time(a.publishedAt);
  return time(b.updatedAt) - time(a.updatedAt);
}

function Timing({ release }: { release: Release }) {
  if (release.status === 'PUBLISHED') {
    return (
      <>
        Published <RelativeTime value={release.publishedAt} />
      </>
    );
  }
  if (release.status === 'SCHEDULED' && release.scheduledAt) {
    return (
      <Tooltip title={relativeTime(release.scheduledAt)}>
        <Box component="time" dateTime={new Date(release.scheduledAt).toISOString()} sx={{ color: 'text.primary' }}>
          Publishes {fullDateTime(release.scheduledAt)}
        </Box>
      </Tooltip>
    );
  }
  if (release.status === 'FAILED') return <>Did not publish</>;
  return (
    <Box component="span" sx={{ color: 'text.disabled' }}>
      Not scheduled
    </Box>
  );
}

export default function ReleasesPage() {
  const ws = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const envId = ws.environment.id;
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('ALL');
  const canManage = ws.can('release.manage');

  const releases = useQuery({
    queryKey: ['releases', envId],
    queryFn: () => api.get<{ items: Release[] }>(`${ws.envBase}/releases`).then((r) => r.items),
  });
  const all = useMemo(() => [...(releases.data ?? [])].sort(byUrgency), [releases.data]);
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { ALL: all.length, OPEN: 0, SCHEDULED: 0, PUBLISHED: 0, FAILED: 0 };
    for (const release of all) out[release.status] += 1;
    return out;
  }, [all]);
  const rows = filter === 'ALL' ? all : all.filter((r) => r.status === filter);
  const detailHref = (release: Release) => ws.href(`publishing/releases/${release.id}`);

  const newButton = (
    <Hint title={canManage ? '' : NO_RELEASE_ACCESS}>
      <Button variant="contained" startIcon={<AddOutlined />} disabled={!canManage} onClick={() => setCreating(true)}>
        New release
      </Button>
    </Hint>
  );

  return (
    <Page>
      <PageHeader title="Releases" description="Group related changes and put them live at the same moment. A release publishes everything in it, or nothing at all." actions={newButton} />

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        {releases.isLoading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : releases.isError ? (
          <ErrorState error={releases.error} onRetry={() => void releases.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<RocketLaunchOutlined />}
            title="No releases yet"
            description="A release bundles several changes — entries to publish and entries to take offline — and applies them together. If any one of them cannot be published, nothing changes."
            action={canManage ? newButton : undefined}
          />
        ) : (
          <>
            <Stack direction="row" spacing={3} sx={{ px: 3, py: 2.5, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle', overflowX: 'auto' }}>
              <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, next: Filter | null) => next && setFilter(next)} aria-label="Filter releases by status">
                {FILTERS.map((value) => (
                  <ToggleButton key={value} value={value} sx={{ whiteSpace: 'nowrap' }}>
                    {value === 'ALL' ? 'All' : releaseStatusLabel(value)}
                    <Box component="span" sx={{ ml: 1.5, color: value === 'FAILED' && counts.FAILED > 0 ? 'error.main' : 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
                      {counts[value]}
                    </Box>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
            {rows.length === 0 ? (
              <EmptyState compact icon={<RocketLaunchOutlined />} title={`No ${releaseStatusLabel(filter as Release['status']).toLowerCase()} releases`} description="Choose another status to see the rest of your releases." />
            ) : (
              <TableContainer>
                <Table aria-label="Releases">
                  <TableHead>
                    <TableRow>
                      <TableCell>Release</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Entries</TableCell>
                      <TableCell>Timing</TableCell>
                      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Last change</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((release) => (
                      <TableRow key={release.id} hover onClick={() => navigate(detailHref(release))} sx={{ cursor: 'pointer' }}>
                        <TableCell sx={{ maxWidth: 440, minWidth: 220 }}>
                          <Typography component={RouterLink} to={detailHref(release)} onClick={(e) => e.stopPropagation()} variant="body2" noWrap sx={titleLinkSx}>
                            {release.name}
                          </Typography>
                          {release.description && (
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {release.description}
                            </Typography>
                          )}
                          {release.status === 'FAILED' && (
                            <Typography variant="caption" color="error.main" component="div" role="status" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                              {release.error ?? 'Publishing failed and nothing went live. Open the release to see what needs fixing.'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <ReleaseStatusPill status={release.status} />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{entryCount(release.itemCount ?? 0)}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                          <Timing release={release} />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary', display: { xs: 'none', md: 'table-cell' } }}>
                          <RelativeTime value={release.updatedAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </>
        )}
      </Paper>

      <ReleaseFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(release) => {
          toast.success(`Created “${release.name}”`);
          queryClient.setQueryData(['release', envId, release.id], release);
          void queryClient.invalidateQueries({ queryKey: ['releases', envId] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard', envId] });
          navigate(ws.href(`publishing/releases/${release.id}`));
        }}
      />
    </Page>
  );
}
