import { type ReactNode, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
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
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import PercentOutlined from '@mui/icons-material/PercentOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SpeedOutlined from '@mui/icons-material/SpeedOutlined';
import SwapVertOutlined from '@mui/icons-material/SwapVertOutlined';
import type { TokenType } from '@meridian/shared';
import { useCrumbs } from '@/app/shell';
import { useProject } from '@/app/workspace';
import { BarList, ChartCard, type ChartSeries, StatTile, TimeSeriesChart } from '@/components/charts';
import { CardSkeleton, EmptyState, ErrorState, Page, PageHeader, Pill, Section } from '@/components/ui';
import { NoAccess, TOKEN_TYPE_INFO } from '@/features/developers/shared';
import { api } from '@/lib/api';
import { compactNumber, formatBytes, percent } from '@/lib/format';
import type { AnalyticsData } from '@/lib/types';

const RANGES = [7, 14, 30, 90] as const;
type Range = (typeof RANGES)[number];

const USAGE_SERIES: ChartSeries[] = [
  { key: 'requests', label: 'Requests' },
  { key: 'errors', label: 'Errors', tone: 'error' },
];
const LATENCY_SERIES: ChartSeries[] = [{ key: 'avgLatencyMs', label: 'Average latency' }];
// Tones match the dashboard, where published and saved already own the first two colours.
const CONTENT_SERIES: ChartSeries[] = [
  { key: 'created', label: 'Created', tone: 2 },
  { key: 'published', label: 'Published', tone: 0 },
  { key: 'saved', label: 'Saved', tone: 1 },
];

const MEDIA_KIND_LABELS: Record<string, string> = { image: 'Images', video: 'Videos', document: 'Documents', archive: 'Archives', other: 'Other files' };

const milliseconds = (n: number) => `${compactNumber(Math.round(n))} ms`;
const plural = (n: number, one: string, many = `${one}s`) => `${compactNumber(n)} ${n === 1 ? one : many}`;

const dayText = (value: string, pattern = 'd MMM yyyy') => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : format(date, pattern);
};

/** Bar lists are keyed by label, so two rows with the same name need telling apart. */
function distinct<T extends { label: string }>(items: T[]): T[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const count = (seen.get(item.label) ?? 0) + 1;
    seen.set(item.label, count);
    return count === 1 ? item : { ...item, label: `${item.label} (${count})` };
  });
}

const tokenTypeLabel = (type: string | null) => (type && type in TOKEN_TYPE_INFO ? TOKEN_TYPE_INFO[type as TokenType].label : null);

function Group({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ '&:not(:last-of-type)': { mb: 8 } }}>
      <Box sx={{ mb: 3.5 }}>
        <Typography variant="h4" component="h2" id={id}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {description}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 4 } as const;
const span = (columns: number) => ({ gridColumn: { xs: 'span 12', lg: `span ${columns}` }, minWidth: 0 });

function AnalyticsSkeleton() {
  return (
    <Box aria-busy="true" aria-label="Loading analytics">
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 3, mb: 4 }}>
        <CardSkeleton height={104} count={4} />
      </Box>
      <Box sx={grid}>
        <Box sx={span(7)}>
          <CardSkeleton height={330} />
        </Box>
        <Box sx={span(5)}>
          <CardSkeleton height={330} />
        </Box>
        <Box sx={span(6)}>
          <CardSkeleton height={280} />
        </Box>
        <Box sx={span(6)}>
          <CardSkeleton height={280} />
        </Box>
      </Box>
    </Box>
  );
}

function ApiUsage({ data, days, integrationsHref }: { data: AnalyticsData; days: number; integrationsHref: string }) {
  const { totals, usage } = data;

  if (totals.requests === 0) {
    return (
      <Paper sx={{ borderRadius: '10px' }}>
        <EmptyState
          compact
          icon={<InsightsOutlined />}
          title={`No API requests in the last ${days} days`}
          description="Numbers appear once applications call the API. Connect a website or app with an API key and its requests, errors and latency are recorded here."
          action={
            <Button variant="outlined" startIcon={<HubOutlined />} component={RouterLink} to={integrationsHref}>
              Connect an application
            </Button>
          }
        />
      </Paper>
    );
  }

  const slowest = usage.reduce((max, day) => Math.max(max, day.avgLatencyMs), 0);
  const busiest = usage.reduce<AnalyticsData['usage'][number] | null>((top, day) => (!top || day.requests > top.requests ? day : top), null);

  return (
    <>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 3, mb: 4 }}>
        <StatTile label="Requests" value={compactNumber(totals.requests)} icon={<SwapVertOutlined />} hint={`About ${compactNumber(Math.round(totals.requests / Math.max(1, days)))} a day`} />
        <StatTile
          label="Error rate"
          value={percent(totals.errorRate)}
          icon={<PercentOutlined />}
          tone={totals.errorRate >= 0.05 ? 'error' : totals.errorRate >= 0.01 ? 'warning' : 'default'}
          hint={`${compactNumber(totals.errors)} of ${compactNumber(totals.requests)} requests`}
        />
        <StatTile label="Average latency" value={milliseconds(totals.avgLatencyMs)} icon={<SpeedOutlined />} hint={`Slowest day averaged ${milliseconds(slowest)}`} />
        <StatTile label="Errors" value={compactNumber(totals.errors)} icon={<ErrorOutlineOutlined />} tone={totals.errors > 0 ? 'error' : 'default'} hint={totals.errors > 0 ? 'Failed requests in this period' : 'No failed requests'} />
      </Box>

      <Box sx={grid}>
        <Box sx={span(7)}>
          <ChartCard
            title="Requests and errors"
            summary={`${plural(totals.requests, 'request')} and ${plural(totals.errors, 'error')}${busiest ? `; busiest on ${dayText(busiest.date, 'd MMM')}` : ''}`}
            series={USAGE_SERIES}
            data={usage}
          >
            <TimeSeriesChart data={usage} series={USAGE_SERIES} kind="area" height={240} ariaLabel={`Delivery API requests and errors per day over the last ${days} days`} />
          </ChartCard>
        </Box>
        <Box sx={span(5)}>
          <ChartCard title="Average latency" summary={`${milliseconds(totals.avgLatencyMs)} across the period, per day`} series={LATENCY_SERIES} data={usage} formatValue={milliseconds}>
            <TimeSeriesChart data={usage} series={LATENCY_SERIES} kind="line" height={240} formatValue={milliseconds} ariaLabel={`Average response time in milliseconds per day over the last ${days} days`} />
          </ChartCard>
        </Box>
        <Box sx={span(6)}>
          <Section title="Most requested" description="The content types and endpoints called most" sx={{ height: '100%' }}>
            <BarList
              items={distinct(
                data.byResource.map((r) => ({
                  label: r.name || r.resource,
                  value: r.requests,
                  hint: `${r.resource} · ${plural(r.errors, 'error')} · ${milliseconds(r.avgLatencyMs)} on average`,
                })),
              )}
              emptyLabel="No requests in this period"
            />
          </Section>
        </Box>
        <Box sx={span(6)}>
          <Section title="Requests by API key" description="Which applications produce the traffic" sx={{ height: '100%' }}>
            <BarList
              items={distinct(
                data.byToken.map((t) => ({
                  label: t.name,
                  value: t.requests,
                  hint: [t.name, tokenTypeLabel(t.type), plural(t.errors, 'error')].filter(Boolean).join(' · '),
                })),
              )}
              emptyLabel="No key was used in this period"
            />
          </Section>
        </Box>
      </Box>
    </>
  );
}

function ContentAndTeam({ data, days, href }: { data: AnalyticsData; days: number; href: (path: string) => string }) {
  const created = data.content.reduce((n, d) => n + d.created, 0);
  const published = data.content.reduce((n, d) => n + d.published, 0);
  const saved = data.content.reduce((n, d) => n + d.saved, 0);
  const mediaCount = data.media.reduce((n, m) => n + m.count, 0);
  const mediaBytes = data.media.reduce((n, m) => n + m.bytes, 0);

  return (
    <Box sx={grid}>
      <Box sx={span(7)}>
        <ChartCard title="Content activity" summary={`${compactNumber(created)} created, ${compactNumber(published)} published and ${compactNumber(saved)} saved`} series={CONTENT_SERIES} data={data.content}>
          <TimeSeriesChart data={data.content} series={CONTENT_SERIES} kind="bar" height={240} ariaLabel={`Entries created, published and saved per day over the last ${days} days`} />
        </ChartCard>
      </Box>
      <Box sx={span(5)}>
        <Section title="Team activity" description="Actions per person in this period" sx={{ height: '100%' }}>
          <BarList items={distinct(data.userActivity.map((u) => ({ label: u.name, value: u.actions })))} emptyLabel="Nobody has worked on this environment in this period" />
        </Section>
      </Box>

      <Box sx={span(7)}>
        <Section title="Most updated content" description="Entries and pages with the most saved versions" flush sx={{ height: '100%' }}>
          {data.mostUpdated.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 10, px: 5, textAlign: 'center' }}>
              Nothing was edited in this period
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Most updated content">
                <TableHead>
                  <TableRow>
                    <TableCell>Title</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell align="right">Versions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.mostUpdated.map((entry) => {
                    const to = entry.isPage ? href(`pages/${entry.entryId}`) : entry.contentType ? href(`content/${entry.contentType}/${entry.entryId}`) : null;
                    const title = entry.title?.trim() || 'Untitled';
                    return (
                      <TableRow key={entry.entryId} hover>
                        <TableCell sx={{ maxWidth: 0, width: '60%' }}>
                          {to ? (
                            <Link component={RouterLink} to={to} underline="hover" color="text.primary" sx={{ display: 'block', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {title}
                            </Link>
                          ) : (
                            <Typography variant="body2" noWrap>
                              {title}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{entry.isPage ? 'Page' : entry.contentTypeName}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {compactNumber(entry.versions)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Section>
      </Box>
      <Box sx={span(5)}>
        <Section title="Media by kind" description={mediaCount > 0 ? `${plural(mediaCount, 'file')} using ${formatBytes(mediaBytes)}` : 'Files in the media library'} flush sx={{ height: '100%' }}>
          {data.media.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 10, px: 5, textAlign: 'center' }}>
              The media library is empty
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small" aria-label="Media by kind">
                <TableHead>
                  <TableRow>
                    <TableCell>Kind</TableCell>
                    <TableCell align="right">Files</TableCell>
                    <TableCell align="right">Size</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...data.media]
                    .sort((a, b) => b.bytes - a.bytes)
                    .map((kind) => (
                      <TableRow key={kind.kind}>
                        <TableCell>{MEDIA_KIND_LABELS[kind.kind] ?? kind.kind}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {compactNumber(kind.count)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {formatBytes(kind.bytes)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Section>
      </Box>
    </Box>
  );
}

export default function AnalyticsPage() {
  const ws = useProject();
  useCrumbs([]);

  const [days, setDays] = useState<Range>(30);
  const canRead = ws.can('analytics.read');
  const analytics = useQuery({
    queryKey: ['analytics', ws.environment.id, days],
    queryFn: () => api.get<AnalyticsData>(`${ws.envBase}/analytics`, { days }),
    enabled: canRead,
    // Keep the previous range on screen while the next one loads, instead of flashing skeletons.
    placeholderData: keepPreviousData,
  });

  if (!canRead) return <NoAccess title="analytics" what="view analytics and API usage" />;

  const data = analytics.data;

  return (
    <Page>
      <PageHeader
        title="Analytics"
        description="How applications use the delivery API of this environment, and how your team works on its content."
        meta={<Pill label={ws.environment.name} dot />}
        actions={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, next: Range | null) => next && setDays(next)} aria-label="Time range">
              {RANGES.map((range) => (
                <ToggleButton key={range} value={range} aria-label={`Last ${range} days`}>
                  {range} days
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Tooltip title="Refresh">
              <span>
                <IconButton size="small" aria-label="Refresh analytics" onClick={() => void analytics.refetch()} disabled={analytics.isFetching}>
                  <RefreshOutlined />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        }
      />

      {analytics.isPending ? (
        <AnalyticsSkeleton />
      ) : analytics.isError && !data ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={analytics.error} onRetry={() => void analytics.refetch()} />
        </Paper>
      ) : data ? (
        <Box aria-busy={analytics.isPlaceholderData} sx={{ opacity: analytics.isPlaceholderData ? 0.55 : 1, transition: 'opacity 120ms' }}>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0, mb: 4 }}>
            {dayText(data.range.from)} – {dayText(data.range.to)} · {data.range.days} days
          </Typography>

          <Group id="analytics-api" title="Delivery API" description="Requests made by websites and applications with an API key.">
            <ApiUsage data={data} days={data.range.days} integrationsHref={ws.href('dev/integrations')} />
          </Group>

          <Group id="analytics-content" title="Content and team" description="What was created, published and edited in this environment.">
            <ContentAndTeam data={data} days={data.range.days} href={ws.href} />
          </Group>
        </Box>
      ) : null}
    </Page>
  );
}
