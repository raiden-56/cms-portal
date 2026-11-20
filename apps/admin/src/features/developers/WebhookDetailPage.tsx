import { Fragment, type ReactNode, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
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
import Typography from '@mui/material/Typography';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject } from '@/app/workspace';
import { StatTile } from '@/components/charts';
import { CardSkeleton, CodeBlock, CopyButton, EmptyState, ErrorState, Mono, Page, PageHeader, Pill, RelativeTime, Section, TableFooter, TableSkeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fullDateTime, percent } from '@/lib/format';
import type { Page as Paged, WebhookDelivery } from '@/lib/types';
import { toast } from '@/store';
import { DeliveryStatusPill, NoAccess, isInFlight, useWebhooks } from './shared';
import { WebhookFormDialog } from './WebhookForm';

type StatusFilter = 'ALL' | WebhookDelivery['status'];

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Box>
  );
}

function DeliveryDetails({ delivery, onRedeliver, redelivering }: { delivery: WebhookDelivery; onRedeliver: () => void; redelivering: boolean }) {
  return (
    <Box sx={{ px: 5, py: 4, bgcolor: 'surface.subtle', borderTop: 1, borderColor: 'border.subtle' }}>
      {delivery.error && (
        <Alert severity={delivery.status === 'FAILED' ? 'error' : 'warning'} sx={{ mb: 4 }}>
          {delivery.error}
          {delivery.nextRetryAt && delivery.status === 'RETRYING' ? ` — next attempt ${fullDateTime(delivery.nextRetryAt)}.` : ''}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, minmax(0, 1fr))' }, gap: 4, mb: 4 }}>
        <Detail label="Delivery id">
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Mono>{delivery.id.slice(0, 8)}…</Mono>
            <CopyButton value={delivery.id} label="Copy delivery id" />
          </Stack>
        </Detail>
        <Detail label="Queued">{fullDateTime(delivery.createdAt)}</Detail>
        <Detail label="Completed">{delivery.completedAt ? fullDateTime(delivery.completedAt) : 'In progress'}</Detail>
        <Detail label="Attempts">{delivery.attempts}</Detail>
        <Detail label="Next retry">{delivery.nextRetryAt ? fullDateTime(delivery.nextRetryAt) : '—'}</Detail>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 4 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Payload sent
          </Typography>
          <CodeBlock language="json" code={JSON.stringify(delivery.payload, null, 2)} maxHeight={300} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Response{delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}
          </Typography>
          {delivery.responseBody ? (
            <CodeBlock code={delivery.responseBody} maxHeight={300} />
          ) : (
            <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', p: 4, bgcolor: 'background.paper' }}>
              <Typography variant="body2" color="text.secondary">
                {delivery.responseStatus ? 'The endpoint returned an empty body.' : isInFlight(delivery.status) ? 'Waiting for the endpoint to respond.' : 'No response was received.'}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      <Stack direction="row" sx={{ mt: 4, justifyContent: 'flex-end' }}>
        <Button variant="outlined" startIcon={<ReplayOutlined />} onClick={onRedeliver} loading={redelivering} disabled={isInFlight(delivery.status)}>
          Redeliver
        </Button>
      </Stack>
    </Box>
  );
}

export default function WebhookDetailPage() {
  const ws = useProject();
  const { webhookId = '' } = useParams();
  const queryClient = useQueryClient();
  const webhooks = useWebhooks();
  const webhook = webhooks.data?.find((w) => w.id === webhookId);
  useCrumbs(webhook ? [{ label: webhook.name }] : []);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', webhookId, { page, pageSize, status }],
    queryFn: () => api.get<Paged<WebhookDelivery>>(`${ws.envBase}/webhooks/${webhookId}/deliveries`, { page, pageSize, status: status === 'ALL' ? undefined : status }),
    enabled: !!webhook,
    placeholderData: keepPreviousData,
    // Keep watching while anything is still on its way; stop polling once everything has settled.
    refetchInterval: (query) => (query.state.data?.items.some((d) => isInFlight(d.status)) ? 5000 : false),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', webhookId] });
    await queryClient.invalidateQueries({ queryKey: ['webhooks', ws.environment.id] });
  };

  const test = useMutation({
    mutationFn: () => api.post<{ deliveryId: string }>(`${ws.envBase}/webhooks/${webhookId}/test`),
    onSuccess: async () => {
      setStatus('ALL');
      setPage(1);
      await refresh();
      toast.success('Test event queued');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const redeliver = useMutation({
    mutationFn: (deliveryId: string) => api.post<{ deliveryId: string }>(`${ws.envBase}/webhooks/${webhookId}/deliveries/${deliveryId}/redeliver`),
    onSuccess: async () => {
      setPage(1);
      await refresh();
      toast.success('Queued for redelivery');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!ws.can('webhook.manage')) return <NoAccess title="webhooks" what="configure webhooks" />;

  if (webhooks.isLoading) {
    return (
      <Page>
        <Box sx={{ display: 'grid', gap: 4 }} aria-busy="true">
          <CardSkeleton height={72} />
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 3 }}>
            <CardSkeleton count={4} height={92} />
          </Box>
          <CardSkeleton height={320} />
        </Box>
      </Page>
    );
  }
  if (webhooks.isError) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={webhooks.error} onRetry={() => void webhooks.refetch()} />
        </Paper>
      </Page>
    );
  }
  if (!webhook) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<SearchOffOutlined />}
            title="Webhook not found"
            description="It may have been deleted, or it belongs to another environment."
            action={
              <Button variant="contained" component={RouterLink} to={ws.href('dev/webhooks')}>
                Back to webhooks
              </Button>
            }
          />
        </Paper>
      </Page>
    );
  }

  const stats = webhook.deliveries7d ?? { success: 0, failed: 0, pending: 0 };
  const settled = stats.success + stats.failed;
  const headerNames = Object.keys(webhook.headers ?? {});
  const rows = deliveries.data?.items ?? [];
  const live = rows.some((d) => isInFlight(d.status));

  return (
    <Page>
      <Button component={RouterLink} to={ws.href('dev/webhooks')} size="small" startIcon={<ArrowBackOutlined />} sx={{ mb: 3, color: 'text.secondary' }}>
        All webhooks
      </Button>
      <PageHeader
        title={webhook.name}
        meta={webhook.isActive ? <Pill label="Active" fg="success.dark" bg="success.light" dot /> : <Pill label="Paused" dot />}
        description={<Mono sx={{ fontSize: '0.8125rem' }}>{webhook.url}</Mono>}
        actions={
          <>
            <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="contained" startIcon={<SendOutlined />} onClick={() => test.mutate()} loading={test.isPending} disabled={!webhook.isActive}>
              Send test event
            </Button>
          </>
        }
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 3, mb: 5 }}>
        <StatTile label="Success rate · 7d" value={settled ? percent(stats.success / settled) : '—'} hint={settled ? `${settled} completed deliveries` : 'No completed deliveries yet'} />
        <StatTile label="Delivered · 7d" value={stats.success} />
        <StatTile label="Failed · 7d" value={stats.failed} tone={stats.failed > 0 ? 'error' : 'default'} hint={stats.failed > 0 ? 'Open a failed delivery to redeliver it' : undefined} />
        <StatTile label="Queued or retrying" value={stats.pending} tone={stats.pending > 0 ? 'warning' : 'default'} />
      </Box>

      <Section title="Configuration" sx={{ mb: 5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr' }, gap: 5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Events
            </Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
              {webhook.events.includes('*') ? (
                <Chip label="All events" variant="outlined" />
              ) : (
                webhook.events.map((event) => <Chip key={event} label={event} variant="outlined" sx={{ fontSize: '0.6875rem' }} />)
              )}
            </Stack>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Custom headers
            </Typography>
            {headerNames.length ? (
              <Stack spacing={0.5}>
                {headerNames.map((name) => (
                  <Typography key={name} variant="body2">
                    <Mono>{name}</Mono>
                    <Box component="span" sx={{ color: 'text.disabled' }}>
                      {' '}
                      · value hidden
                    </Box>
                  </Typography>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                None
              </Typography>
            )}
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Signature
            </Typography>
            <Typography variant="body2">
              <Mono>X-Meridian-Signature</Mono>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              HMAC-SHA256 of “timestamp.body”. Retries keep the same <Mono>X-Meridian-Delivery</Mono> id.
            </Typography>
          </Box>
        </Box>
      </Section>

      <Section
        title="Delivery log"
        description={live ? 'Deliveries are in progress — this list refreshes every few seconds.' : 'Every attempt to reach your endpoint, newest first.'}
        flush
        action={
          <ToggleButtonGroup
            size="small"
            exclusive
            value={status}
            onChange={(_, next: StatusFilter | null) => {
              if (!next) return;
              setStatus(next);
              setPage(1);
              setExpanded(null);
            }}
            aria-label="Filter deliveries by status"
          >
            <ToggleButton value="ALL">All</ToggleButton>
            <ToggleButton value="SUCCESS">Delivered</ToggleButton>
            <ToggleButton value="FAILED">Failed</ToggleButton>
            <ToggleButton value="RETRYING">Retrying</ToggleButton>
            <ToggleButton value="PENDING">Queued</ToggleButton>
          </ToggleButtonGroup>
        }
      >
        {deliveries.isLoading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : deliveries.isError ? (
          <ErrorState compact error={deliveries.error} onRetry={() => void deliveries.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={<InboxOutlined />}
            title={status === 'ALL' ? 'Nothing has been sent yet' : 'No deliveries with this status'}
            description={status === 'ALL' ? 'Publish some content or send a test event to see deliveries here.' : 'Choose another status to see more of the log.'}
          />
        ) : (
          <>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 44 }} />
                    <TableCell>Status</TableCell>
                    <TableCell>Event</TableCell>
                    <TableCell align="right">Attempts</TableCell>
                    <TableCell align="right">Response</TableCell>
                    <TableCell align="right">Duration</TableCell>
                    <TableCell>Sent</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((delivery) => {
                    const open = expanded === delivery.id;
                    return (
                      <Fragment key={delivery.id}>
                        <TableRow hover onClick={() => setExpanded(open ? null : delivery.id)} sx={{ cursor: 'pointer', '& > td': { borderBottom: open ? 0 : undefined } }}>
                          <TableCell>
                            <IconButton size="small" aria-label={open ? 'Hide delivery details' : 'Show delivery details'} aria-expanded={open}>
                              <ExpandMoreOutlined sx={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 140ms' }} />
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <DeliveryStatusPill status={delivery.status} />
                          </TableCell>
                          <TableCell>
                            <Mono>{delivery.event}</Mono>
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {delivery.attempts}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: delivery.responseStatus && delivery.responseStatus >= 400 ? 'error.main' : undefined }}>
                            {delivery.responseStatus ?? '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {delivery.durationMs !== null ? `${delivery.durationMs} ms` : '—'}
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={delivery.createdAt} />
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={7} sx={{ p: 0, borderBottom: open ? undefined : 0 }}>
                            <Collapse in={open} unmountOnExit>
                              <DeliveryDetails delivery={delivery} onRedeliver={() => redeliver.mutate(delivery.id)} redelivering={redeliver.isPending && redeliver.variables === delivery.id} />
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <TableFooter
              page={deliveries.data?.meta.page ?? page}
              pageSize={pageSize}
              total={deliveries.data?.meta.total ?? 0}
              onPage={(next) => {
                setPage(next);
                setExpanded(null);
              }}
              onPageSize={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </Section>

      <WebhookFormDialog open={editing} webhook={webhook} onClose={() => setEditing(false)} />
    </Page>
  );
}
