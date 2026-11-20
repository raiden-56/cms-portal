import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import FilterAltOffOutlined from '@mui/icons-material/FilterAltOffOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import { useWorkspace } from '@/app/workspace';
import { CodeBlock, CopyButton, EmptyState, ErrorState, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput, TableFooter, TableSkeleton, UserAvatar, useDebounced } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { actionVerb, fullDateTime, humanize } from '@/lib/format';
import type { AuditLog, Page as Paged } from '@/lib/types';
import { toast, useAppSelector } from '@/store';

const ACTION_GROUPS = [
  { value: 'entry.', label: 'Content' },
  { value: 'schema.', label: 'Content model' },
  { value: 'media.', label: 'Media' },
  { value: 'release.', label: 'Releases' },
  { value: 'token.', label: 'API keys' },
  { value: 'webhook.', label: 'Webhooks' },
  { value: 'member.', label: 'Members' },
  { value: 'role.', label: 'Roles' },
  { value: 'project.', label: 'Projects' },
  { value: 'organization.', label: 'Organization' },
];
const RESOURCE_TYPES = ['entry', 'page', 'content_type', 'component', 'media', 'release', 'api_token', 'webhook', 'member', 'invitation', 'role', 'project', 'locale', 'organization'];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const pretty = (value: unknown): string => (value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const hasValue = (value: unknown) => value !== null && value !== undefined;

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={3} sx={{ py: 1.75, alignItems: 'baseline', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 112, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Stack>
  );
}

function ValueBox({ value, tone }: { value: unknown; tone: 'before' | 'after' }) {
  const missing = value === undefined;
  return (
    <Box sx={{ minWidth: 0, borderRadius: '6px', border: 1, borderColor: 'border.subtle', bgcolor: missing ? 'surface.sunken' : tone === 'before' ? 'error.light' : 'success.light', px: 2.5, py: 1.5 }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {tone === 'before' ? 'Before' : 'After'}
      </Typography>
      {missing ? (
        <Typography variant="caption" color="text.disabled">
          Not set
        </Typography>
      ) : (
        <Box component="pre" tabIndex={0} sx={{ m: 0, fontSize: '0.75rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, overflow: 'auto', color: 'text.primary' }}>
          {pretty(value) || '""'}
        </Box>
      )}
    </Box>
  );
}

/** Field-by-field comparison when both sides are objects; otherwise the two values side by side. */
function ChangeView({ before, after }: { before: unknown; after: unknown }) {
  const [showSame, setShowSame] = useState(false);
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const changed = keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    const same = keys.filter((key) => !changed.includes(key));
    return (
      <Stack spacing={3}>
        {changed.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            The recorded values are identical.
          </Typography>
        )}
        {changed.map((key) => (
          <Box key={key}>
            <Mono sx={{ fontWeight: 600 }}>{key}</Mono>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 1 }}>
              <ValueBox value={before[key]} tone="before" />
              <ValueBox value={after[key]} tone="after" />
            </Box>
          </Box>
        ))}
        {same.length > 0 && (
          <Box>
            <Button size="small" onClick={() => setShowSame((s) => !s)} aria-expanded={showSame} sx={{ color: 'text.secondary' }}>
              {showSame ? 'Hide' : 'Show'} {same.length} unchanged field{same.length === 1 ? '' : 's'}
            </Button>
            {showSame && (
              <Box sx={{ mt: 2 }}>
                <CodeBlock language="json" code={JSON.stringify(Object.fromEntries(same.map((key) => [key, after[key]])), null, 2)} maxHeight={260} />
              </Box>
            )}
          </Box>
        )}
      </Stack>
    );
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: hasValue(before) && hasValue(after) ? '1fr 1fr' : '1fr' }, gap: 3 }}>
      {hasValue(before) && (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            Before
          </Typography>
          <CodeBlock language="json" code={pretty(before)} maxHeight={320} />
        </Box>
      )}
      {hasValue(after) && (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            After
          </Typography>
          <CodeBlock language="json" code={pretty(after)} maxHeight={320} />
        </Box>
      )}
    </Box>
  );
}

function ActorCell({ log }: { log: AuditLog }) {
  const name = log.actorLabel ?? (log.actorType === 'system' ? 'System' : 'Unknown');
  return (
    <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center', minWidth: 0 }}>
      <UserAvatar name={name} size={24} />
      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
        {name}
      </Typography>
      {log.actorType !== 'user' && <Pill label={log.actorType === 'token' ? 'API token' : 'System'} />}
    </Stack>
  );
}

export default function AuditLogsPage() {
  const ws = useWorkspace();
  const density = useAppSelector((s) => s.ui.tableDensity);
  const allowed = ws.can('org.audit.read');
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

  const action = params.get('action') ?? '';
  const resourceType = params.get('type') ?? '';
  const projectId = params.get('project') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 50;

  const [search, setSearch] = useState(params.get('q') ?? '');
  const term = useDebounced(search.trim(), 250);
  useEffect(() => {
    if ((params.get('q') ?? '') !== term) update({ q: term });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const filters = useMemo(() => {
    const start = from ? new Date(`${from}T00:00:00`) : null;
    const end = to ? new Date(`${to}T23:59:59.999`) : null;
    return {
      search: term || undefined,
      action: action || undefined,
      resourceType: resourceType || undefined,
      projectId: projectId || undefined,
      from: start && !Number.isNaN(start.getTime()) ? start.toISOString() : undefined,
      to: end && !Number.isNaN(end.getTime()) ? end.toISOString() : undefined,
    };
  }, [term, action, resourceType, projectId, from, to]);
  const invalidRange = !!from && !!to && from > to;

  const logs = useQuery({
    queryKey: ['audit-logs', ws.org.id, { ...filters, page, pageSize }],
    queryFn: () => api.get<Paged<AuditLog>>(`${ws.orgBase}/audit-logs`, { ...filters, page, pageSize }),
    enabled: allowed && !invalidRange,
    placeholderData: keepPreviousData,
  });

  const [open, setOpenLog] = useState<AuditLog | null>(null);
  // Kept separately so the drawer keeps its content while it slides out.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const setOpen = (log: AuditLog | null) => {
    if (log) setOpenLog(log);
    setDrawerOpen(!!log);
  };
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await api.download(`${ws.orgBase}/audit-logs`, { ...filters, format: 'csv' }, 'audit-log.csv');
      toast.success('Audit log exported');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  const projectName = useCallback((id: string | null) => (id ? (ws.projects.find((p) => p.id === id)?.name ?? 'Deleted project') : null), [ws.projects]);
  const environmentName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      for (const project of ws.projects) {
        const env = project.environments.find((e) => e.id === id);
        if (env) return env.name;
      }
      return null;
    },
    [ws.projects],
  );

  const filtered = !!(term || action || resourceType || projectId || from || to);
  const clear = () => {
    setSearch('');
    update({ q: null, action: null, type: null, project: null, from: null, to: null });
  };
  const items = logs.data?.items ?? [];
  const total = logs.data?.meta.total ?? 0;

  if (!allowed) {
    return (
      <Page>
        <PageHeader title="Audit logs" />
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState icon={<LockOutlined />} title="You do not have access to the audit log" description="Viewing and exporting the audit trail needs the “View and export audit logs” permission. Ask an organization administrator." />
        </Paper>
      </Page>
    );
  }

  return (
    <Page width={1440}>
      <PageHeader
        title="Audit logs"
        description="Every change in this organization: who made it, what it affected, and the values before and after."
        actions={
          <Button variant="outlined" startIcon={<FileDownloadOutlined />} loading={exporting} onClick={() => void exportCsv()} disabled={invalidRange}>
            Export CSV
          </Button>
        }
      />

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        <Stack direction="row" sx={{ p: 3, gap: 2, flexWrap: 'wrap', alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search person, resource or action…" width={280} />
          <TextField select value={action} onChange={(e) => update({ action: e.target.value })} sx={{ width: 170 }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Area' } }}>
            <MenuItem value="">All areas</MenuItem>
            {ACTION_GROUPS.map((g) => (
              <MenuItem key={g.value} value={g.value}>
                {g.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField select value={resourceType} onChange={(e) => update({ type: e.target.value })} sx={{ width: 170 }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Resource type' } }}>
            <MenuItem value="">All resources</MenuItem>
            {RESOURCE_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {humanize(t)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select value={projectId} onChange={(e) => update({ project: e.target.value })} sx={{ width: 180 }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Project' } }}>
            <MenuItem value="">All projects</MenuItem>
            {ws.projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField type="date" label="From" value={from} onChange={(e) => update({ from: e.target.value })} error={invalidRange} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: to || undefined } }} />
          <TextField type="date" label="To" value={to} onChange={(e) => update({ to: e.target.value })} error={invalidRange} sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: from || undefined } }} />
          {filtered && (
            <Button startIcon={<FilterAltOffOutlined />} onClick={clear} sx={{ color: 'text.secondary' }}>
              Clear
            </Button>
          )}
        </Stack>
        {logs.isFetching && !logs.isLoading && <LinearProgress color="secondary" sx={{ height: 2 }} />}

        {invalidRange ? (
          <EmptyState compact icon={<ReceiptLongOutlined />} title="The date range is reversed" description="“From” must be on or before “To”." />
        ) : logs.isLoading ? (
          <TableSkeleton rows={10} columns={6} />
        ) : logs.isError ? (
          <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ReceiptLongOutlined />}
            title={filtered ? 'No activity matches these filters' : 'No activity recorded yet'}
            description={filtered ? 'Widen the date range or remove a filter.' : 'Changes to content, the content model, media, members and settings will appear here.'}
            action={
              filtered ? (
                <Button variant="outlined" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableContainer>
            <Table size={density === 'compact' ? 'small' : 'medium'} aria-label="Audit log">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 130 }}>When</TableCell>
                  <TableCell>Who</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Resource</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>IP address</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((log) => {
                  const project = projectName(log.projectId);
                  const environment = environmentName(log.environmentId);
                  return (
                    <TableRow
                      key={log.id}
                      hover
                      tabIndex={0}
                      onClick={() => setOpen(log)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setOpen(log);
                        }
                      }}
                      aria-label={`${log.actorLabel ?? 'System'} ${actionVerb(log.action)} ${log.resourceLabel ?? ''}. Open details.`}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell sx={{ color: 'text.secondary' }}>
                        <RelativeTime value={log.createdAt} />
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>
                        <ActorCell log={log} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{capitalize(actionVerb(log.action))}</Typography>
                        <Mono sx={{ color: 'text.disabled' }}>{log.action}</Mono>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                          {log.resourceLabel ?? '—'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap component="div">
                          {humanize(log.resourceType)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        {project ? (
                          <>
                            <Typography variant="body2" noWrap>
                              {project}
                            </Typography>
                            {environment && (
                              <Typography variant="caption" color="text.secondary" noWrap component="div">
                                {environment}
                              </Typography>
                            )}
                          </>
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            Organization
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Mono sx={{ color: 'text.secondary' }}>{log.ip ?? '—'}</Mono>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {total > 0 && !invalidRange && <TableFooter page={page} pageSize={pageSize} total={total} onPage={(next) => update({ page: next === 1 ? null : String(next) }, true)} onPageSize={(size) => update({ size: size === 50 ? null : String(size) })} />}
      </Paper>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2.5 }}>
        The export contains every entry matching the current filters, up to 10,000 rows.
      </Typography>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setOpen(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 }, display: 'flex', flexDirection: 'column' } } }}>
        {open && (
          <>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', px: 5, height: 52, flexShrink: 0, borderBottom: 1, borderColor: 'border.subtle' }}>
              <Typography variant="h5" component="h2" noWrap sx={{ flex: 1 }}>
                {capitalize(actionVerb(open.action))} {open.resourceLabel ?? ''}
              </Typography>
              <IconButton aria-label="Close details" onClick={() => setOpen(null)} edge="end">
                <CloseOutlined />
              </IconButton>
            </Stack>
            <Box sx={{ flex: 1, overflowY: 'auto', p: 5 }}>
              <Fact label="When">{fullDateTime(open.createdAt)}</Fact>
              <Fact label="Who">
                <ActorCell log={open} />
              </Fact>
              <Fact label="Action">
                <Mono>{open.action}</Mono>
              </Fact>
              <Fact label="Resource">
                {open.resourceLabel ?? '—'}
                <Typography variant="caption" color="text.secondary" component="div">
                  {humanize(open.resourceType)}
                </Typography>
              </Fact>
              {open.resourceId && (
                <Fact label="Resource ID">
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Mono>{open.resourceId}</Mono>
                    <CopyButton value={open.resourceId} label="Copy resource ID" />
                  </Stack>
                </Fact>
              )}
              <Fact label="Project">{projectName(open.projectId) ?? 'Organization-wide'}</Fact>
              {open.environmentId && <Fact label="Environment">{environmentName(open.environmentId) ?? 'Unknown'}</Fact>}
              <Fact label="IP address">{open.ip ? <Mono>{open.ip}</Mono> : '—'}</Fact>

              {(hasValue(open.before) || hasValue(open.after)) && (
                <Box sx={{ mt: 6 }}>
                  <Typography variant="overline" color="text.secondary" component="h3" sx={{ display: 'block', mb: 2.5 }}>
                    What changed
                  </Typography>
                  <ChangeView before={open.before} after={open.after} />
                </Box>
              )}
              {open.metadata && Object.keys(open.metadata).length > 0 && (
                <Box sx={{ mt: 6 }}>
                  <Typography variant="overline" color="text.secondary" component="h3" sx={{ display: 'block', mb: 2.5 }}>
                    Additional details
                  </Typography>
                  <CodeBlock language="json" code={JSON.stringify(open.metadata, null, 2)} maxHeight={280} />
                </Box>
              )}
              {!hasValue(open.before) && !hasValue(open.after) && !(open.metadata && Object.keys(open.metadata).length) && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 5 }}>
                  No values were recorded for this action.
                </Typography>
              )}
            </Box>
          </>
        )}
      </Drawer>
    </Page>
  );
}
