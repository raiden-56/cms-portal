import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import { type EntryStatus, STATUS_LABELS } from '@meridian/shared';
import { useProject, useSchema } from '@/app/workspace';
import { IconFor } from '@/components/icons';
import { EmptyState, ErrorState, Page, PageHeader, RelativeTime, Section, SettingRow, StatusChip, TableSkeleton, UserAvatar } from '@/components/ui';
import { NoteDialog } from '@/features/content/dialogs';
import { entryHref, useInvalidateContent } from '@/features/content/hooks';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { ContentType, EntryDetail, EntryListItem } from '@/lib/types';
import { toast } from '@/store';

type QueueTab = Extract<EntryStatus, 'IN_REVIEW' | 'CHANGES_REQUESTED' | 'APPROVED'>;

const TABS: { value: QueueTab; empty: string; hint: string }[] = [
  { value: 'IN_REVIEW', empty: 'Nothing is waiting for review', hint: 'Submitted content appears here until a reviewer approves it or asks for changes.' },
  { value: 'CHANGES_REQUESTED', empty: 'No changes have been requested', hint: 'Content a reviewer sent back to its author appears here until it is resubmitted.' },
  { value: 'APPROVED', empty: 'Nothing is approved and waiting', hint: 'Approved content appears here until it is published or scheduled.' },
];

const STEPS: { role: string; text: string; status: EntryStatus }[] = [
  { role: 'Writer', text: 'Drafts the content and submits it for review.', status: 'IN_REVIEW' },
  { role: 'Reviewer', text: 'Approves it, or requests changes with a comment.', status: 'APPROVED' },
  { role: 'Publisher', text: 'Publishes approved content, or schedules it.', status: 'PUBLISHED' },
];

/** First validation problem of a failed request, appended to its message. */
function explain(err: unknown): string {
  const first = err instanceof ApiError && Array.isArray(err.details) ? err.details[0]?.message : undefined;
  return first ? `${errorMessage(err)} — ${first}` : errorMessage(err);
}

export default function WorkflowsPage() {
  const ws = useProject();
  const schema = useSchema();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateContent();
  const envId = ws.environment.id;
  const [tab, setTab] = useState<QueueTab>('IN_REVIEW');
  const [busy, setBusy] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<EntryListItem | null>(null);

  const reviews = useQuery({
    queryKey: ['reviews', envId],
    queryFn: () => api.get<{ items: EntryListItem[] }>(`${ws.envBase}/reviews`).then((r) => r.items),
    refetchInterval: 60_000,
  });
  const all = useMemo(() => reviews.data ?? [], [reviews.data]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.value, all.filter((e) => e.status === t.value).length])) as Record<QueueTab, number>, [all]);
  const rows = all.filter((e) => e.status === tab);
  const current = TABS.find((t) => t.value === tab) as (typeof TABS)[number];

  const act = async (entry: EntryListItem, request: () => Promise<unknown>, success: string) => {
    setBusy(entry.id);
    try {
      await request();
      toast.success(success);
      invalidate(entry.id);
      void queryClient.invalidateQueries({ queryKey: ['entry', envId, entry.id] });
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setBusy(null);
    }
  };
  const entryUrl = (entry: EntryListItem) => `${ws.envBase}/entry/${entry.id}`;
  const name = (entry: EntryListItem) => entry.title ?? 'Untitled';

  const rule = useMutation({
    mutationFn: ({ type, requireApproval }: { type: ContentType; requireApproval: boolean }) => api.patch(`${ws.envBase}/content-types/${type.id}`, { options: { requireApproval } }),
    onSuccess: (_, { type, requireApproval }) => {
      toast.success(requireApproval ? `${type.displayName} now need approval before publishing` : `${type.displayName} can be published without approval`);
      void queryClient.invalidateQueries({ queryKey: ['schema', envId] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const canReview = ws.can('content.review');
  const canPublish = ws.can('content.publish');
  const canEdit = ws.can('content.update');
  const canManageRules = ws.can('schema.manage');
  const types = schema.data?.types ?? [];

  return (
    <Page>
      <PageHeader title="Workflows" description="Content moves from draft to live through review and approval. This is everything currently in that process." />

      <Paper sx={{ borderRadius: '10px', p: 5, mb: 5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: { xs: 4, md: 3 } }}>
          {STEPS.map((step, index) => (
            <Stack key={step.role} direction="row" spacing={3} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ width: 26, height: 26, borderRadius: '50%', border: 1, borderColor: 'border.strong', display: 'grid', placeItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', flexShrink: 0 }}>{index + 1}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {step.role}
                  </Typography>
                  <ArrowForwardOutlined sx={{ fontSize: 14, color: 'text.disabled' }} aria-hidden />
                  <StatusChip status={step.status} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {step.text}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      </Paper>

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden', mb: 6 }}>
        <Tabs value={tab} onChange={(_, next: QueueTab) => setTab(next)} sx={{ px: 3 }} aria-label="Review queue">
          {TABS.map((t) => (
            <Tab
              key={t.value}
              value={t.value}
              label={
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <span>{STATUS_LABELS[t.value]}</span>
                  <Box component="span" sx={{ minWidth: 18, px: 1, borderRadius: '9px', fontSize: '0.6875rem', lineHeight: '18px', fontWeight: 600, bgcolor: counts[t.value] && t.value === 'IN_REVIEW' ? 'secondary.main' : 'surface.sunken', color: counts[t.value] && t.value === 'IN_REVIEW' ? 'secondary.contrastText' : 'text.secondary' }}>
                    {counts[t.value] ?? 0}
                  </Box>
                </Stack>
              }
            />
          ))}
        </Tabs>
        {reviews.isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : reviews.isError ? (
          <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={<FactCheckOutlined />} title={current.empty} description={current.hint} />
        ) : (
          <TableContainer>
            <Table aria-label={`${STATUS_LABELS[tab]} entries`}>
              <TableHead>
                <TableRow>
                  <TableCell>Content</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Assigned to</TableCell>
                  <TableCell>Last change</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((entry) => {
                  const working = busy === entry.id;
                  return (
                    <TableRow key={entry.id} hover sx={{ opacity: working ? 0.55 : 1 }}>
                      <TableCell sx={{ maxWidth: 360 }}>
                        <Typography component={RouterLink} to={entryHref(ws, entry)} variant="body2" noWrap sx={{ display: 'block', fontWeight: 500, color: 'text.primary', '&:hover': { color: 'secondary.main', textDecoration: 'none' } }}>
                          {name(entry)}
                        </Typography>
                        {entry.isPublished && (
                          <Typography variant="caption" color="text.secondary">
                            An earlier version is live
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                        {entry.contentTypeName}
                        {entry.locale && ws.project.locales.length > 1 ? ` · ${entry.locale}` : ''}
                      </TableCell>
                      <TableCell>
                        {entry.assignee ? (
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                            <UserAvatar name={entry.assignee} size={22} />
                            <Typography variant="body2" noWrap>
                              {entry.assignee}
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.disabled">
                            Unassigned
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                        <RelativeTime value={entry.updatedAt} />
                        {entry.updatedBy ? ` by ${entry.updatedBy}` : ''}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
                          {tab === 'IN_REVIEW' && canReview && (
                            <Button size="small" variant="contained" color="secondary" startIcon={<CheckCircleOutlined />} disabled={working} onClick={() => void act(entry, () => api.post<EntryDetail>(`${entryUrl(entry)}/transition`, { action: 'approve' }), `Approved “${name(entry)}”`)}>
                              Approve
                            </Button>
                          )}
                          {(tab === 'IN_REVIEW' || tab === 'APPROVED') && canReview && (
                            <Button size="small" variant="outlined" disabled={working} onClick={() => setRequesting(entry)}>
                              Request changes
                            </Button>
                          )}
                          {tab === 'APPROVED' && canPublish && (
                            <Button size="small" variant="contained" startIcon={<PublicOutlined />} disabled={working} onClick={() => void act(entry, () => api.post<EntryDetail>(`${entryUrl(entry)}/publish`), `Published “${name(entry)}”`)}>
                              Publish
                            </Button>
                          )}
                          {tab === 'CHANGES_REQUESTED' && canEdit && (
                            <Tooltip
                              title="Send it back to the reviewers as it is now"
                              // The tooltip describes the button; its accessible name stays "Resubmit".
                              describeChild
                            >
                              <Button size="small" variant="outlined" disabled={working} onClick={() => void act(entry, () => api.post<EntryDetail>(`${entryUrl(entry)}/transition`, { action: 'submit' }), `Resubmitted “${name(entry)}”`)}>
                                Resubmit
                              </Button>
                            </Tooltip>
                          )}
                          <Button size="small" component={RouterLink} to={entryHref(ws, entry)}>
                            Open
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Section
        title="Approval rules"
        description={
          canManageRules
            ? 'Choose which content must be approved by a reviewer before it can be published or scheduled.'
            : 'Content marked here must be approved by a reviewer before it can be published. Changing these rules needs access to the content model.'
        }
      >
        {schema.isLoading ? (
          <TableSkeleton rows={4} columns={2} />
        ) : schema.isError ? (
          <ErrorState compact error={schema.error} onRetry={() => void schema.refetch()} />
        ) : (
          types.map((type) => (
            <SettingRow
              key={type.id}
              label={
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }} component="span">
                  <IconFor name={type.icon} sx={{ fontSize: 16, color: 'text.secondary' }} />
                  <span>{type.displayName}</span>
                </Stack>
              }
              description={type.options.requireApproval ? 'Must be approved before publishing. Editing approved content requires a new approval.' : 'Anyone with publishing rights can publish directly.'}
            >
              <Tooltip title={canManageRules ? '' : 'Your role cannot change approval rules'}>
                <span>
                  <Switch
                    checked={!!type.options.requireApproval}
                    disabled={!canManageRules || (rule.isPending && rule.variables?.type.id === type.id)}
                    onChange={(e) => rule.mutate({ type, requireApproval: e.target.checked })}
                    slotProps={{ input: { 'aria-label': `Require approval for ${type.displayName}` } }}
                  />
                </span>
              </Tooltip>
            </SettingRow>
          ))
        )}
      </Section>

      <NoteDialog
        open={!!requesting}
        title={`Request changes on “${requesting ? name(requesting) : ''}”`}
        description="The note is added to the entry’s comments and the entry returns to its author."
        label="What needs to change?"
        confirmLabel="Request changes"
        required
        onClose={() => setRequesting(null)}
        onSubmit={async (comment) => {
          if (!requesting) return;
          await api.post<EntryDetail>(`${entryUrl(requesting)}/transition`, { action: 'request_changes', comment });
          toast.success('Changes requested');
          invalidate(requesting.id);
          void queryClient.invalidateQueries({ queryKey: ['entry', envId, requesting.id] });
        }}
      />
    </Page>
  );
}
