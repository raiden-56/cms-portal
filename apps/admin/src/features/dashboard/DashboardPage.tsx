import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined';
import DashboardCustomizeOutlined from '@mui/icons-material/DashboardCustomizeOutlined';
import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import SchemaOutlined from '@mui/icons-material/SchemaOutlined';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import SwapVertOutlined from '@mui/icons-material/SwapVertOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import WebOutlined from '@mui/icons-material/WebOutlined';
import { useProject, useSchema } from '@/app/workspace';
import { BarList, ChartCard, type ChartSeries, StatTile, TimeSeriesChart } from '@/components/charts';
import { IconFor } from '@/components/icons';
import { CardSkeleton, EmptyState, ErrorState, Page, PageHeader, RelativeTime, StatusChip, UserAvatar } from '@/components/ui';
import { api } from '@/lib/api';
import { actionVerb, compactNumber, formatBytes } from '@/lib/format';
import { isGuestMode } from '@/lib/guest';
import type { DashboardData, DashboardEntry } from '@/lib/types';
import { toast } from '@/store';

interface Layout {
  order: string[];
  hidden: string[];
}

const PUBLISHING_SERIES: ChartSeries[] = [
  { key: 'published', label: 'Published' },
  { key: 'saved', label: 'Saved drafts' },
];
const USAGE_SERIES: ChartSeries[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'errors', label: 'Errors', tone: 'error' },
];

function ListCard({ title, action, children, empty }: { title: string; action?: ReactNode; children: ReactNode; empty?: boolean }) {
  return (
    <Paper sx={{ borderRadius: '10px', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ px: 5, py: 3.5, alignItems: 'center', justifyContent: 'space-between', borderBottom: empty ? 0 : 1, borderColor: 'border.subtle' }}>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        {action}
      </Stack>
      <Box sx={{ flex: 1 }}>{children}</Box>
    </Paper>
  );
}

const ViewAll = ({ to }: { to: string }) => (
  <Button size="small" component={RouterLink} to={to} endIcon={<ArrowForwardOutlined />} sx={{ color: 'text.secondary' }}>
    View all
  </Button>
);

function EntryRows({ entries, href, empty }: { entries: DashboardEntry[]; href: (path: string) => string; empty: string }) {
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 5, py: 8, textAlign: 'center' }}>
        {empty}
      </Typography>
    );
  }
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 1.5 }}>
      {entries.map((entry) => (
        <Box component="li" key={entry.id}>
          <ButtonBase
            component={RouterLink}
            to={href(entry.isPage ? `pages/${entry.id}` : `content/${entry.contentType}/${entry.id}`)}
            sx={{ width: '100%', px: 3.5, py: 2, gap: 3, borderRadius: '8px', justifyContent: 'flex-start', textAlign: 'left', color: 'text.primary', textDecoration: 'none !important', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                {entry.title ?? 'Untitled'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {entry.isPage ? (entry.path ?? 'Page') : entry.contentTypeName}
                {entry.updatedBy ? ` · ${entry.updatedBy}` : ''} · <RelativeTime value={entry.updatedAt} />
              </Typography>
            </Box>
            <StatusChip status={entry.status} isPublished={!!entry.publishedAt} hasChanges={!!entry.publishedAt && entry.status === 'DRAFT'} />
          </ButtonBase>
        </Box>
      ))}
    </Box>
  );
}

function ActivityRows({ items, empty }: { items: { id: string; action: string; actorLabel: string | null; resourceLabel: string | null; createdAt: string }[]; empty: string }) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 5, py: 8, textAlign: 'center' }}>
        {empty}
      </Typography>
    );
  }
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, px: 5, py: 2 }}>
      {items.map((item) => (
        <Stack component="li" key={item.id} direction="row" spacing={3} sx={{ py: 2, alignItems: 'center' }}>
          <UserAvatar name={item.actorLabel ?? 'System'} size={24} />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
            <Box component="span" sx={{ fontWeight: 600 }}>
              {item.actorLabel ?? 'System'}
            </Box>{' '}
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {actionVerb(item.action)}
            </Box>{' '}
            {item.resourceLabel}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
            <RelativeTime value={item.createdAt} />
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center', py: 2, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      {ok ? <CheckCircleOutlined sx={{ fontSize: 17, color: 'success.main' }} /> : <ErrorOutlineOutlined sx={{ fontSize: 17, color: 'error.main' }} />}
      <Typography variant="body2" sx={{ flex: 1 }}>
        {label}
      </Typography>
      <Typography variant="caption" color={ok ? 'text.secondary' : 'error'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {ok ? detail : 'Unavailable'}
      </Typography>
    </Stack>
  );
}

function SortableWidget({ id, span, editing, title, onHide, children }: { id: string; span: number; editing: boolean; title: string; onHide: () => void; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editing });
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{ gridColumn: { xs: 'span 12', lg: `span ${span}` }, minWidth: 0, position: 'relative', zIndex: isDragging ? 2 : 'auto', opacity: isDragging ? 0.85 : 1 }}
    >
      {editing && (
        <Stack direction="row" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 3, bgcolor: 'background.paper', border: 1, borderColor: 'border.strong', borderRadius: '8px', boxShadow: '0 4px 12px rgba(17,17,16,0.10)' }}>
          <Tooltip title="Drag to reorder (or focus and use the arrow keys)">
            <IconButton size="small" aria-label={`Reorder ${title}`} sx={{ cursor: 'grab' }} {...attributes} {...listeners}>
              <DragIndicatorOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title="Hide">
            <IconButton size="small" aria-label={`Hide ${title}`} onClick={onHide}>
              <VisibilityOffOutlined />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
      <Box sx={{ height: '100%', pointerEvents: editing ? 'none' : 'auto', outline: editing ? '1px dashed' : 'none', outlineColor: 'border.strong', outlineOffset: 3, borderRadius: '12px' }}>{children}</Box>
    </Box>
  );
}

export default function DashboardPage() {
  const ws = useProject();
  const queryClient = useQueryClient();
  const schema = useSchema();
  const dashboard = useQuery({
    queryKey: ['dashboard', ws.environment.id],
    queryFn: () => api.get<DashboardData>(`${ws.envBase}/dashboard`),
    refetchInterval: 60_000,
  });
  const preference = useQuery({
    queryKey: ['preference', 'dashboard-layout'],
    queryFn: () => api.get<{ value: Layout | null }>('/auth/me/preferences/dashboard-layout').then((r) => r.value),
    staleTime: Infinity,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Layout | null>(null);
  const saveLayout = useMutation({
    mutationFn: (layout: Layout) => api.put('/auth/me/preferences/dashboard-layout', { value: layout }),
    onSuccess: (_, layout) => {
      queryClient.setQueryData(['preference', 'dashboard-layout'], layout);
      toast.success('Dashboard layout saved');
    },
    onError: () => toast.error('Your layout could not be saved'),
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const data = dashboard.data;
  const types = (schema.data?.types ?? []).filter((t) => !t.isSystem);

  const widgets = useMemo(() => {
    if (!data) return [];
    const c = data.counts;
    const publishedTotal = data.publishingActivity.reduce((n, d) => n + d.published, 0);
    const requestsTotal = (data.apiUsage ?? []).reduce((n, d) => n + d.requests, 0);
    const errorsTotal = (data.apiUsage ?? []).reduce((n, d) => n + d.errors, 0);
    const list: { id: string; title: string; span: number; node: ReactNode }[] = [
      {
        id: 'stats',
        title: 'Key numbers',
        span: 12,
        node: (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 3 }}>
            <StatTile label="Content entries" value={compactNumber(c.entries)} icon={<ArticleOutlined />} hint={`${c.contentTypes} content type${c.contentTypes === 1 ? '' : 's'}`} />
            <StatTile label="Pages" value={compactNumber(c.pages)} icon={<WebOutlined />} />
            <StatTile label="Published" value={compactNumber(c.published)} icon={<PublicOutlined />} hint="Live through the API" />
            <StatTile label="Drafts" value={compactNumber(c.drafts)} icon={<EditNoteOutlined />} hint="Not yet published" />
            <StatTile label="Scheduled" value={compactNumber(c.scheduled)} icon={<EventOutlined />} />
            <StatTile label="Pending approvals" value={compactNumber(c.pendingApprovals)} icon={<FactCheckOutlined />} tone={c.pendingApprovals > 0 ? 'warning' : 'default'} />
            <StatTile label="Media assets" value={compactNumber(c.mediaAssets)} icon={<PhotoLibraryOutlined />} />
            <StatTile label="Storage used" value={formatBytes(c.storageBytes)} icon={<StorageOutlined />} />
            <StatTile label="Connected apps" value={compactNumber(c.connectedApps)} icon={<HubOutlined />} hint="Keys used in the last 30 days" />
            {c.apiRequests24h !== null && <StatTile label="API requests · 24h" value={compactNumber(c.apiRequests24h)} icon={<SwapVertOutlined />} />}
            {c.apiErrors24h !== null && <StatTile label="API errors · 24h" value={compactNumber(c.apiErrors24h)} icon={<ErrorOutlineOutlined />} tone={c.apiErrors24h > 0 ? 'error' : 'default'} />}
          </Box>
        ),
      },
      {
        id: 'publishing',
        title: 'Publishing activity',
        span: 8,
        node: (
          <ChartCard title="Publishing activity" summary={`${publishedTotal} publish${publishedTotal === 1 ? '' : 'es'} in the last 14 days`} series={PUBLISHING_SERIES} data={data.publishingActivity}>
            <TimeSeriesChart data={data.publishingActivity} series={PUBLISHING_SERIES} kind="bar" ariaLabel="Published and saved versions per day over the last 14 days" />
          </ChartCard>
        ),
      },
      {
        id: 'distribution',
        title: 'Content by type',
        span: 4,
        node: (
          <ListCard title="Content by type" action={<ViewAll to={ws.href('content')} />}>
            <Box sx={{ p: 5 }}>
              <BarList items={data.typeDistribution.map((t) => ({ label: t.name, value: t.count }))} emptyLabel="No content yet" />
            </Box>
          </ListCard>
        ),
      },
      ...(data.apiUsage
        ? [
            {
              id: 'apiUsage',
              title: 'API usage',
              span: 8,
              node: (
                <ChartCard
                  title="API usage"
                  summary={`${compactNumber(requestsTotal)} requests, ${compactNumber(errorsTotal)} errors in the last 14 days`}
                  series={USAGE_SERIES}
                  data={data.apiUsage}
                  action={ws.can('analytics.read') ? <ViewAll to={ws.href('analytics')} /> : undefined}
                >
                  <TimeSeriesChart data={data.apiUsage} series={USAGE_SERIES} kind="area" ariaLabel="Delivery API requests and errors per day over the last 14 days" />
                </ChartCard>
              ),
            },
          ]
        : []),
      {
        id: 'health',
        title: 'System health',
        span: 4,
        node: (
          <ListCard title="System health">
            {isGuestMode() ? (
              // Guest mode has no services to probe, and must not show green lights for a database that does not exist.
              <Box sx={{ px: 5, py: 2 }}>
                <HealthRow label="Demo backend" ok detail="runs in this browser" />
                <HealthRow label="Demo data" ok={data.health.storage.driver !== 'memory only'} detail={data.health.storage.driver} />
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 1 }}>
                  Guest mode has no database, queue, webhook sender or real-time service to monitor.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ px: 5, py: 2 }}>
                <HealthRow label="Database" ok={data.health.database.ok} detail={`${data.health.database.latencyMs} ms`} />
                <HealthRow label="Cache and queues" ok={data.health.cache.ok} detail={`${data.health.cache.latencyMs} ms`} />
                <HealthRow label={`Media storage (${data.health.storage.driver})`} ok={data.health.storage.ok} detail={`${data.health.storage.latencyMs} ms`} />
                <HealthRow
                  label="Webhook deliveries"
                  ok={data.health.queue.failed === 0}
                  detail={`${data.health.queue.waiting + data.health.queue.active + data.health.queue.delayed} queued`}
                />
                <HealthRow label="Real-time connections" ok detail={`${data.health.realtimeClients} connected`} />
              </Box>
            )}
          </ListCard>
        ),
      },
      {
        id: 'reviews',
        title: 'Pending review',
        span: 6,
        node: (
          <ListCard title="Pending review" action={<ViewAll to={ws.href('publishing/workflows')} />}>
            <EntryRows entries={data.pendingReviews} href={ws.href} empty="Nothing is waiting for review." />
          </ListCard>
        ),
      },
      {
        id: 'updates',
        title: 'Recent content updates',
        span: 6,
        node: (
          <ListCard title="Recent content updates" action={<ViewAll to={ws.href('content')} />}>
            <EntryRows entries={data.recentUpdates.filter((e) => !e.isPage).slice(0, 6)} href={ws.href} empty="No content has been edited yet." />
          </ListCard>
        ),
      },
      {
        id: 'pages',
        title: 'Recently edited pages',
        span: 6,
        node: (
          <ListCard title="Recently edited pages" action={<ViewAll to={ws.href('pages')} />}>
            <EntryRows entries={data.recentPages.slice(0, 6)} href={ws.href} empty="No pages have been edited yet." />
          </ListCard>
        ),
      },
      {
        id: 'publishingLog',
        title: 'Recent publishing',
        span: 6,
        node: (
          <ListCard title="Recent publishing" action={<ViewAll to={ws.href('publishing/history')} />}>
            <ActivityRows items={data.recentPublishing} empty="Nothing has been published yet." />
          </ListCard>
        ),
      },
      {
        id: 'activity',
        title: 'Team activity',
        span: 6,
        node: (
          <ListCard title="Team activity" action={ws.can('org.audit.read') ? <ViewAll to={ws.orgHref('admin/audit')} /> : undefined}>
            <ActivityRows items={data.userActivity.slice(0, 7)} empty="No activity recorded yet." />
          </ListCard>
        ),
      },
      {
        id: 'projects',
        title: 'Recent projects',
        span: 6,
        node: (
          <ListCard title="Recent projects" action={<ViewAll to={ws.orgHref('projects')} />}>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 1.5 }}>
              {ws.projects.slice(0, 5).map((p) => (
                <Box component="li" key={p.id}>
                  <ButtonBase component={RouterLink} to={ws.hrefFor(p, 'production')} sx={{ width: '100%', px: 3.5, py: 2, gap: 3, borderRadius: '8px', justifyContent: 'flex-start', textAlign: 'left', color: 'text.primary', textDecoration: 'none !important', '&:hover': { bgcolor: 'action.hover' } }}>
                    <Box sx={{ width: 26, height: 26, borderRadius: '7px', bgcolor: p.color, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, '& svg': { fontSize: 15 } }}>
                      <IconFor name={p.icon} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                        {p.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div">
                        {p.environments.reduce((n, e) => n + e.entryCount, 0)} entries · updated <RelativeTime value={p.updatedAt} />
                      </Typography>
                    </Box>
                    {p.id === ws.project.id && <Chip label="Current" variant="outlined" />}
                  </ButtonBase>
                </Box>
              ))}
            </Box>
          </ListCard>
        ),
      },
    ];
    return list;
  }, [data, ws]);

  const saved = preference.data;
  const layout = useMemo<Layout>(() => {
    const base = draft ?? saved ?? { order: [], hidden: [] };
    const ids = widgets.map((w) => w.id);
    // Widgets added in a later version appear at the end; ids that no longer exist are dropped.
    const order = [...base.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !base.order.includes(id))];
    return { order, hidden: base.hidden.filter((id) => ids.includes(id)) };
  }, [draft, saved, widgets]);

  useEffect(() => {
    if (!editing) setDraft(null);
  }, [editing]);

  const visible = layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => widgets.find((w) => w.id === id)).filter((w): w is (typeof widgets)[number] => !!w);
  const hidden = layout.hidden.map((id) => widgets.find((w) => w.id === id)).filter((w): w is (typeof widgets)[number] => !!w);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = layout.order.indexOf(String(active.id));
    const to = layout.order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setDraft({ ...layout, order: arrayMove(layout.order, from, to) });
  };

  const gettingStarted = data && data.counts.contentTypes === 0 && data.counts.entries === 0 && data.counts.pages === 0;
  const steps = data
    ? [
        { done: data.counts.contentTypes > 0, label: 'Model your content', hint: 'Create a content type and add fields', to: ws.href('model/types'), show: ws.can('schema.manage') },
        { done: data.counts.entries + data.counts.pages > 0, label: 'Create content', hint: 'Add an entry or build a page', to: ws.href('pages'), show: ws.can('content.create') },
        { done: data.counts.published > 0, label: 'Publish', hint: 'Published content is available through the API immediately', to: ws.href('content'), show: ws.can('content.publish') },
        { done: data.counts.connectedApps > 0, label: 'Connect an application', hint: 'Generate an API key and fetch your content', to: ws.href('dev/integrations'), show: ws.can('token.manage') },
      ].filter((s) => s.show)
    : [];

  return (
    <Page width={1360}>
      <PageHeader
        title="Dashboard"
        description={`${ws.project.name} · ${ws.environment.name}`}
        actions={
          editing ? (
            <>
              <Button onClick={() => setDraft({ order: widgets.map((w) => w.id), hidden: [] })}>Reset</Button>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
              <Button
                variant="contained"
                loading={saveLayout.isPending}
                onClick={() => {
                  saveLayout.mutate(layout, { onSuccess: () => setEditing(false) });
                }}
              >
                Save layout
              </Button>
            </>
          ) : (
            <>
              <Button variant="outlined" startIcon={<DashboardCustomizeOutlined />} onClick={() => setEditing(true)} disabled={!data}>
                Customize
              </Button>
              {ws.can('content.create') && (
                <Button variant="contained" startIcon={<AddOutlined />} component={RouterLink} to={`${ws.href('pages')}?new=1`}>
                  New page
                </Button>
              )}
            </>
          )
        }
      />

      {dashboard.isLoading ? (
        <Box sx={{ display: 'grid', gap: 4 }} aria-busy="true">
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 3 }}>
            <CardSkeleton count={8} height={96} />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' }, gap: 4 }}>
            <CardSkeleton count={2} height={320} />
          </Box>
        </Box>
      ) : dashboard.isError || !data ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        </Paper>
      ) : (
        <>
          {gettingStarted && steps.length > 0 && !editing && (
            <Paper sx={{ borderRadius: '10px', p: 5, mb: 4 }}>
              <Typography variant="h4" component="h2">
                Get {ws.project.name} ready
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 4 }}>
                Four steps take you from an empty project to content served by the API.
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${steps.length}, 1fr)` }, gap: 3 }}>
                {steps.map((step, index) => (
                  <ButtonBase key={step.label} component={RouterLink} to={step.to} sx={{ p: 3.5, borderRadius: '8px', border: 1, borderColor: 'border.subtle', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', gap: 2.5, color: 'text.primary', textDecoration: 'none !important', '&:hover': { borderColor: 'secondary.main', bgcolor: 'action.hover' } }}>
                    {step.done ? <CheckCircleOutlined sx={{ fontSize: 18, color: 'success.main', mt: 0.25 }} /> : <RadioButtonUncheckedOutlined sx={{ fontSize: 18, color: 'text.disabled', mt: 0.25 }} />}
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {index + 1}. {step.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {step.hint}
                      </Typography>
                    </Box>
                  </ButtonBase>
                ))}
              </Box>
            </Paper>
          )}

          {!editing && (ws.can('content.create') || ws.can('media.upload') || ws.can('schema.manage')) && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mb: 4, alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                Quick create
              </Typography>
              {ws.can('content.create') &&
                types
                  .filter((t) => t.kind === 'COLLECTION')
                  .slice(0, 4)
                  .map((t) => (
                    <Button key={t.id} size="small" variant="outlined" startIcon={<IconFor name={t.icon} />} component={RouterLink} to={ws.href(`content/${t.apiId}/new`)}>
                      {t.singularName}
                    </Button>
                  ))}
              {ws.can('media.upload') && (
                <Button size="small" variant="outlined" startIcon={<CloudUploadOutlined />} component={RouterLink} to={`${ws.href('media')}?upload=1`}>
                  Upload media
                </Button>
              )}
              {ws.can('schema.manage') && (
                <Button size="small" variant="outlined" startIcon={<SchemaOutlined />} component={RouterLink} to={`${ws.href('model/types')}?new=1`}>
                  Content type
                </Button>
              )}
            </Stack>
          )}

          {editing && hidden.length > 0 && (
            <Paper sx={{ borderRadius: '10px', p: 4, mb: 4, bgcolor: 'surface.subtle' }}>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
                Hidden widgets — select one to show it again
              </Typography>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
                {hidden.map((w) => (
                  <Chip key={w.id} label={w.title} icon={<AddOutlined />} variant="outlined" onClick={() => setDraft({ ...layout, hidden: layout.hidden.filter((id) => id !== w.id) })} />
                ))}
              </Stack>
            </Paper>
          )}

          {visible.length === 0 ? (
            <Paper sx={{ borderRadius: '10px' }}>
              <EmptyState icon={<DashboardCustomizeOutlined />} title="Every widget is hidden" description="Choose Customize to bring widgets back." />
            </Paper>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={visible.map((w) => w.id)} strategy={rectSortingStrategy}>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 4 }}>
                  {visible.map((w) => (
                    <SortableWidget key={w.id} id={w.id} span={w.span} title={w.title} editing={editing} onHide={() => setDraft({ ...layout, hidden: [...layout.hidden, w.id] })}>
                      {w.node}
                    </SortableWidget>
                  ))}
                </Box>
              </SortableContext>
            </DndContext>
          )}
        </>
      )}
    </Page>
  );
}
