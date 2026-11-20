import { type ReactNode, useId, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import ShowChartOutlined from '@mui/icons-material/ShowChartOutlined';
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined';
import { compactNumber } from '@/lib/format';

/**
 * Categorical series colors, in fixed order. Both sets were checked for colour-vision
 * separation, lightness band, chroma and contrast against their surface; series beyond
 * the fourth must be grouped rather than given a generated hue.
 */
const SERIES = {
  light: ['#17896B', '#C77A1E', '#4A72C9', '#A8508F'],
  dark: ['#2BA47F', '#C98426', '#5E86DC', '#C268AC'],
};

export function useChartTheme() {
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';
  return useMemo(
    () => ({
      dark,
      series: dark ? SERIES.dark : SERIES.light,
      /** Reserved for error/failure measures; always shown with a text label, never alone. */
      error: dark ? '#DB7A72' : '#B4443C',
      grid: dark ? '#2B2B28' : '#ECEAE5',
      axis: dark ? '#8A887F' : '#7A776F',
      surface: dark ? '#1A1A18' : '#FFFFFF',
    }),
    [dark],
  );
}

export interface ChartSeries {
  key: string;
  label: string;
  /** Slot in the categorical order, or the reserved error tone. Defaults to the series' position. */
  tone?: number | 'error';
}

const dayLabel = (value: string) => {
  try {
    return format(parseISO(value), 'd MMM');
  } catch {
    return value;
  }
};

function ChartTooltip({ active, payload, label, series, colors, formatValue }: { active?: boolean; payload?: { dataKey?: string | number; value?: number }[]; label?: string; series: ChartSeries[]; colors: string[]; formatValue: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'border.strong', borderRadius: '8px', px: 3, py: 2, boxShadow: '0 8px 24px rgba(17,17,16,0.12)', minWidth: 140 }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        {label ? dayLabel(label) : ''}
      </Typography>
      {series.map((s, i) => {
        const point = payload.find((p) => p.dataKey === s.key);
        return (
          <Stack key={s.key} direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.25 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: colors[i] }} />
              <Typography variant="caption" color="text.secondary">
                {s.label}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {formatValue(Number(point?.value ?? 0))}
            </Typography>
          </Stack>
        );
      })}
    </Box>
  );
}

export interface TimeSeriesChartProps {
  data: Record<string, string | number>[];
  series: ChartSeries[];
  xKey?: string;
  kind?: 'area' | 'line' | 'bar';
  height?: number;
  formatValue?: (n: number) => string;
  /** Short description for assistive technology, e.g. "Requests per day over the last 14 days". */
  ariaLabel: string;
}

/** Time series on a single shared axis, with a crosshair tooltip. */
export function TimeSeriesChart({ data, series, xKey = 'date', kind = 'area', height = 220, formatValue = compactNumber, ariaLabel }: TimeSeriesChartProps) {
  const theme = useChartTheme();
  const gradientId = useId().replace(/:/g, '');
  const colors = series.map((s, i) => (s.tone === 'error' ? theme.error : theme.series[(typeof s.tone === 'number' ? s.tone : i) % theme.series.length]));
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke={theme.grid} />
      <XAxis dataKey={xKey} tickFormatter={dayLabel} tickLine={false} axisLine={false} tick={{ fill: theme.axis, fontSize: 11 }} minTickGap={28} dy={6} />
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: theme.axis, fontSize: 11 }} tickFormatter={(v: number) => formatValue(v)} width={44} />
      <RechartsTooltip
        cursor={kind === 'bar' ? { fill: theme.grid, opacity: 0.5 } : { stroke: theme.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
        content={(props) => <ChartTooltip {...(props as object)} series={series} colors={colors} formatValue={formatValue} />}
        isAnimationActive={false}
      />
    </>
  );
  const dot = (color: string) => ({ r: 4, fill: color, stroke: theme.surface, strokeWidth: 2 });

  return (
    <Box role="img" aria-label={ariaLabel} sx={{ width: '100%', height, '& .recharts-surface': { outline: 'none' } }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'bar' ? (
          <BarChart {...common} barCategoryGap="28%" barGap={2}>
            {axes}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={colors[i]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            ))}
          </BarChart>
        ) : kind === 'line' ? (
          <LineChart {...common}>
            {axes}
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i]} strokeWidth={2} dot={false} activeDot={dot(colors[i])} isAnimationActive={false} />
            ))}
          </LineChart>
        ) : (
          <AreaChart {...common}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors[i]} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={colors[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {axes}
            {series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i]} strokeWidth={2} fill={`url(#${gradientId}-${i})`} dot={false} activeDot={dot(colors[i])} isAnimationActive={false} />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </Box>
  );
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  const theme = useChartTheme();
  if (series.length < 2) return null;
  return (
    <Stack direction="row" spacing={3.5} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {series.map((s, i) => (
        <Stack key={s.key} component="li" direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: s.tone === 'error' ? theme.error : theme.series[(typeof s.tone === 'number' ? s.tone : i) % theme.series.length] }} />
          <Typography variant="caption" color="text.secondary">
            {s.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * Card around a chart: title, a one-line reading of the data, a legend when there are
 * several series, and a switch to the same numbers as a table.
 */
export function ChartCard({
  title,
  summary,
  series,
  data,
  xKey = 'date',
  xLabel = 'Date',
  children,
  action,
  formatValue = compactNumber,
}: {
  title: string;
  summary?: ReactNode;
  series: ChartSeries[];
  data: Record<string, string | number>[];
  xKey?: string;
  xLabel?: string;
  children: ReactNode;
  action?: ReactNode;
  formatValue?: (n: number) => string;
}) {
  const [table, setTable] = useState(false);
  return (
    <Paper sx={{ borderRadius: '10px', p: 5, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          {summary && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {summary}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
          {action}
          <Tooltip title={table ? 'Show chart' : 'Show as table'}>
            <IconButton size="small" aria-label={table ? 'Show chart' : 'Show as table'} aria-pressed={table} onClick={() => setTable((t) => !t)}>
              {table ? <ShowChartOutlined /> : <TableRowsOutlined />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
      {!table && series.length > 1 && (
        <Box sx={{ mb: 2 }}>
          <ChartLegend series={series} />
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {table ? (
          <Box sx={{ maxHeight: 260, overflow: 'auto', border: 1, borderColor: 'border.subtle', borderRadius: '8px' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{xLabel}</TableCell>
                  {series.map((s) => (
                    <TableCell key={s.key} align="right">
                      {s.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {[...data].reverse().map((row) => (
                  <TableRow key={String(row[xKey])}>
                    <TableCell>{xKey === 'date' ? dayLabel(String(row[xKey])) : String(row[xKey])}</TableCell>
                    {series.map((s) => (
                      <TableCell key={s.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatValue(Number(row[s.key] ?? 0))}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        ) : (
          children
        )}
      </Box>
    </Paper>
  );
}

/** Ranked horizontal bars: one hue, direct labels and values, so no legend or axis is needed. */
export function BarList({ items, formatValue = compactNumber, max = 8, emptyLabel = 'No data yet' }: { items: { label: string; value: number; hint?: string }[]; formatValue?: (n: number) => string; max?: number; emptyLabel?: string }) {
  const theme = useChartTheme();
  const shown = items.slice(0, max);
  const rest = items.slice(max);
  const rows = rest.length ? [...shown, { label: `${rest.length} more`, value: rest.reduce((n, r) => n + r.value, 0) }] : shown;
  const top = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
        {emptyLabel}
      </Typography>
    );
  }
  return (
    <Stack spacing={2.5} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map((row) => (
        <Box key={row.label} component="li">
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75, gap: 2 }}>
            <Typography variant="body2" noWrap title={row.hint ?? row.label}>
              {row.label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {formatValue(row.value)}
            </Typography>
          </Stack>
          <Box sx={{ height: 6, borderRadius: '3px', bgcolor: 'surface.sunken', overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${Math.max(2, (row.value / top) * 100)}%`, borderRadius: '3px', bgcolor: theme.series[0] }} />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

/** Headline number with a label; the right form when one figure is the whole story. */
export function StatTile({ label, value, hint, icon, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'warning' | 'error'; to?: ReactNode }) {
  return (
    <Paper sx={{ borderRadius: '10px', p: 4, height: '100%', minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="body2" color="text.secondary" noWrap>
          {label}
        </Typography>
        {icon && <Box sx={{ color: 'text.disabled', display: 'flex', '& svg': { fontSize: 16 } }}>{icon}</Box>}
      </Stack>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: tone === 'error' ? 'error.main' : tone === 'warning' ? 'warning.dark' : 'text.primary' }}>
        {value}
      </Typography>
      {(hint || to) && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }} noWrap>
          {hint}
          {to}
        </Typography>
      )}
    </Paper>
  );
}
