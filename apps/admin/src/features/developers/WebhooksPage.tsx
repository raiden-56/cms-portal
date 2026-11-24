import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import AutorenewOutlined from '@mui/icons-material/AutorenewOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import ListAltOutlined from '@mui/icons-material/ListAltOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import WebhookOutlined from '@mui/icons-material/WebhookOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, Mono, Page, PageHeader, RelativeTime, Section, TableSkeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Webhook } from '@/lib/types';
import { toast } from '@/store';
import { DeliveryStatusPill, NoAccess, SecretRevealDialog, Snippets, useWebhooks } from './shared';
import { GuestNote } from '@/features/guest/guest';
import { isGuestMode } from '@/lib/guest';
import { NEXT_REVALIDATE_ROUTE, NODE_VERIFY } from './snippets';
import { WEBHOOK_PRESETS, WebhookFormDialog, type WebhookPreset } from './WebhookForm';

function EventChips({ events }: { events: string[] }) {
  if (events.includes('*')) return <Chip label="All events" variant="outlined" />;
  const shown = events.slice(0, 2);
  const rest = events.slice(2);
  return (
    <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
      {shown.map((event) => (
        <Chip key={event} label={event} variant="outlined" sx={{ fontSize: '0.6875rem' }} />
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.join(', ')}>
          <Chip label={`+${rest.length}`} variant="outlined" sx={{ fontSize: '0.6875rem' }} />
        </Tooltip>
      )}
    </Stack>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <Tooltip title={`${value} ${label} in the last 7 days`}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: value > 0 ? 'text.primary' : 'text.disabled' }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: value > 0 ? tone : 'text.disabled' }} />
        <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
          {value}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

function PresetCard({ preset, onUse }: { preset: WebhookPreset; onUse: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ p: 4, alignItems: { sm: 'center' } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {preset.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {preset.summary}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
          <Button size="small" onClick={() => setOpen((o) => !o)} aria-expanded={open} endIcon={<ExpandMoreOutlined sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 140ms' }} />}>
            Receiver code
          </Button>
          <Button size="small" variant="outlined" onClick={onUse}>
            Use this preset
          </Button>
        </Stack>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ p: 4, pt: 0 }}>
          <Snippets items={preset.receiver} maxHeight={360} />
        </Box>
      </Collapse>
    </Box>
  );
}

export default function WebhooksPage() {
  const ws = useProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const webhooks = useWebhooks();
  useCrumbs([]);

  const [form, setForm] = useState<{ open: boolean; webhook?: Webhook | null; preset?: WebhookPreset }>({ open: false });
  const [menu, setMenu] = useState<{ anchor: HTMLElement; webhook: Webhook } | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string; rotated: boolean } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks', ws.environment.id] });

  const toggle = useMutation({
    mutationFn: ({ webhook, isActive }: { webhook: Webhook; isActive: boolean }) => api.patch<Webhook>(`${ws.envBase}/webhooks/${webhook.id}`, { isActive }),
    onSuccess: async (_, { isActive }) => {
      await refresh();
      toast.success(isActive ? 'Webhook activated' : 'Webhook paused');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const test = useMutation({
    mutationFn: (webhook: Webhook) => api.post<{ deliveryId: string }>(`${ws.envBase}/webhooks/${webhook.id}/test`),
    onSuccess: async (_, webhook) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['webhook-deliveries', webhook.id] });
      toast.success(isGuestMode() ? 'Simulated test delivery recorded — nothing was sent' : 'Test event queued', { label: 'View deliveries', href: ws.href(`dev/webhooks/${webhook.id}`) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!ws.can('webhook.manage')) return <NoAccess title="webhooks" what="configure webhooks" />;

  const rotate = async (webhook: Webhook) => {
    const issued: { value: string | null } = { value: null };
    const ok = await confirm({
      title: `Rotate the signing secret of “${webhook.name}”?`,
      message: 'Deliveries are signed with the new secret straight away. Update your endpoint with the new value, or it will reject them.',
      confirmLabel: 'Rotate secret',
      onConfirm: async () => {
        issued.value = (await api.post<{ secret: string }>(`${ws.envBase}/webhooks/${webhook.id}/rotate-secret`)).secret;
      },
    });
    if (ok && issued.value) setSecret({ name: webhook.name, value: issued.value, rotated: true });
  };

  const remove = async (webhook: Webhook) => {
    const ok = await confirm({
      title: `Delete “${webhook.name}”?`,
      message: 'The endpoint stops receiving events and its delivery history is deleted. This cannot be undone.',
      confirmLabel: 'Delete webhook',
      destructive: true,
      onConfirm: () => api.delete(`${ws.envBase}/webhooks/${webhook.id}`),
    });
    if (!ok) return;
    await refresh();
    toast.success('Webhook deleted');
  };

  const items = webhooks.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Webhooks"
        description={`Notify your applications when content changes in ${ws.environment.name}. Deliveries are signed, retried with backoff, and logged.`}
        actions={
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setForm({ open: true })}>
            Create webhook
          </Button>
        }
      />

      <GuestNote sx={{ mb: 4 }}>
        Guest mode cannot call your endpoint: there is no server to send from. The delivery history is sample data, and publishing, “Send test” and redelivery only record a simulated delivery, labelled as such.
      </GuestNote>

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden', mb: 5 }}>
        {webhooks.isLoading ? (
          <TableSkeleton rows={4} columns={5} />
        ) : webhooks.isError ? (
          <ErrorState error={webhooks.error} onRetry={() => void webhooks.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<WebhookOutlined />}
            title="No webhooks in this environment"
            description="Create a webhook to revalidate a site, purge a CDN or trigger a build whenever content is published."
            action={
              <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setForm({ open: true })}>
                Create webhook
              </Button>
            }
          />
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Endpoint</TableCell>
                  <TableCell>Events</TableCell>
                  <TableCell>Deliveries · 7d</TableCell>
                  <TableCell>Last delivery</TableCell>
                  <TableCell>Active</TableCell>
                  <TableCell align="right" sx={{ width: 48 }}>
                    <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((webhook) => {
                  const stats = webhook.deliveries7d ?? { success: 0, failed: 0, pending: 0 };
                  return (
                    <TableRow key={webhook.id} hover>
                      <TableCell sx={{ maxWidth: 360 }}>
                        <Link component={RouterLink} to={ws.href(`dev/webhooks/${webhook.id}`)} color="inherit" underline="hover" sx={{ fontWeight: 500, display: 'block' }} noWrap>
                          {webhook.name}
                        </Link>
                        <Mono sx={{ color: 'text.secondary', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{webhook.url}</Mono>
                      </TableCell>
                      <TableCell>
                        <EventChips events={webhook.events} />
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={3}>
                          <Count value={stats.success} label="delivered" tone="success.main" />
                          <Count value={stats.failed} label="failed" tone="error.main" />
                          <Count value={stats.pending} label="queued or retrying" tone="warning.main" />
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {webhook.lastDelivery ? (
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                            <DeliveryStatusPill status={webhook.lastDelivery.status} simulated={webhook.lastDelivery.simulated} />
                            <Typography variant="caption" color="text.secondary">
                              <RelativeTime value={webhook.lastDelivery.createdAt} />
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.disabled">
                            Nothing sent yet
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={webhook.isActive}
                          disabled={toggle.isPending && toggle.variables?.webhook.id === webhook.id}
                          onChange={(e) => toggle.mutate({ webhook, isActive: e.target.checked })}
                          slotProps={{ input: { 'aria-label': `${webhook.isActive ? 'Pause' : 'Activate'} ${webhook.name}` } }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton aria-label={`Actions for ${webhook.name}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchor: e.currentTarget, webhook })}>
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
      </Paper>

      <Section title="Recipes" description="Ready-made receivers for the most common setups. Each preset selects the right events for you.">
        <Stack spacing={3}>
          {WEBHOOK_PRESETS.map((preset) => (
            <PresetCard key={preset.id} preset={preset} onUse={() => setForm({ open: true, preset })} />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 4, mb: 0, maxWidth: 760 }}>
          Meridian’s own API always serves the new version the instant something is published. A webhook is what tells <i>your</i> site or CDN to drop its cached copy —
          until that happens, visitors may still see the previous version.
        </Typography>
      </Section>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem
          onClick={() => {
            if (menu) navigate(ws.href(`dev/webhooks/${menu.webhook.id}`));
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <ListAltOutlined />
          </ListItemIcon>
          View deliveries
        </MenuItem>
        <MenuItem
          disabled={!menu?.webhook.isActive}
          onClick={() => {
            if (menu) test.mutate(menu.webhook);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <SendOutlined />
          </ListItemIcon>
          Send test event
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) setForm({ open: true, webhook: menu.webhook });
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <EditOutlined />
          </ListItemIcon>
          Edit
        </MenuItem>
        <MenuItem
          onClick={() => {
            const webhook = menu?.webhook;
            setMenu(null);
            if (webhook) void rotate(webhook);
          }}
        >
          <ListItemIcon>
            <AutorenewOutlined />
          </ListItemIcon>
          Rotate secret
        </MenuItem>
        <MenuItem
          onClick={() => {
            const webhook = menu?.webhook;
            setMenu(null);
            if (webhook) void remove(webhook);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteOutlineOutlined />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      <WebhookFormDialog
        open={form.open}
        webhook={form.webhook}
        preset={form.preset}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onCreated={(webhook, value) => setSecret({ name: webhook.name, value, rotated: false })}
      />

      <SecretRevealDialog
        open={!!secret}
        title={secret?.rotated ? 'New signing secret' : 'Webhook created'}
        secret={secret?.value ?? ''}
        label="signing secret"
        warning={
          <>
            Copy this signing secret now. It is <b>shown only once</b>; it is stored encrypted and can be replaced but never read back.
          </>
        }
        onClose={() => setSecret(null)}
      >
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Verify deliveries with it
        </Typography>
        <Snippets
          maxHeight={260}
          items={[
            { label: 'Next.js', caption: 'app/api/revalidate/route.ts', language: 'typescript', code: NEXT_REVALIDATE_ROUTE },
            { label: 'Node.js', caption: 'verify-meridian-webhook.js', language: 'javascript', code: NODE_VERIFY },
          ]}
        />
      </SecretRevealDialog>
    </Page>
  );
}
