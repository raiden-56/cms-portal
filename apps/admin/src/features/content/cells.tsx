import { format, parseISO } from 'date-fns';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import StarOutlined from '@mui/icons-material/StarOutlined';
import { FIELD_TYPE_META, type FieldDef, type FieldScalar, isSecretValue, richTextToPlainText } from '@meridian/shared';
import { Mono, Pill } from '@/components/ui';
import { AssetThumb } from '@/features/fields/MediaField';
import { shortDate } from '@/lib/format';
import type { MediaAsset } from '@/lib/types';

export interface CellContext {
  assets?: Map<string, MediaAsset>;
  /** Related entry titles by document id. */
  relations: Map<string, string>;
}

const Dash = () => (
  <Box component="span" sx={{ color: 'text.disabled' }} aria-label="Empty">
    —
  </Box>
);

const truncate = (text: string, max = 72) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function Text({ value, mono }: { value: string; mono?: boolean }) {
  const short = truncate(value.replace(/\s+/g, ' ').trim());
  const node = mono ? <Mono>{short}</Mono> : short;
  return (
    <Box component="span" title={value.length > short.length ? value.slice(0, 600) : undefined} sx={{ display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {node}
    </Box>
  );
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function formatDate(value: string): string {
  try {
    return format(parseISO(value), 'd MMM yyyy');
  } catch {
    return value;
  }
}

/** Compact, read-only rendering of one field value for list tables. */
export function FieldCell({ field, value, ctx }: { field: FieldDef; value: unknown; ctx: CellContext }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return <Dash />;
  switch (field.type) {
    case 'boolean':
    case 'checkbox':
      return value === true ? <CheckOutlined sx={{ fontSize: 16, color: 'success.main', verticalAlign: 'middle' }} aria-label="Yes" /> : <Dash />;
    case 'integer':
    case 'decimal':
      return <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? new Intl.NumberFormat('en').format(value) : String(value)}</Box>;
    case 'rating':
      return (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', display: 'inline-flex' }}>
          <StarOutlined sx={{ fontSize: 14, color: 'warning.main' }} />
          <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {String(value)}
            <Box component="span" sx={{ color: 'text.disabled' }}>/{field.config.maxRating ?? 5}</Box>
          </Box>
        </Stack>
      );
    case 'date':
      return <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{formatDate(String(value))}</Box>;
    case 'datetime':
      return <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{shortDate(String(value))}</Box>;
    case 'select':
    case 'radio': {
      const option = field.config.options?.find((o) => o.value === value);
      return <Pill label={option?.label ?? String(value)} />;
    }
    case 'multiselect': {
      const values = (value as string[]).map((v) => field.config.options?.find((o) => o.value === v)?.label ?? v);
      return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          {values.slice(0, 2).map((label) => (
            <Pill key={label} label={label} />
          ))}
          {values.length > 2 && (
            <Tooltip title={values.slice(2).join(', ')}>
              <Typography variant="caption" color="text.secondary" component="span">
                +{values.length - 2}
              </Typography>
            </Tooltip>
          )}
        </Stack>
      );
    }
    case 'color':
      return (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', display: 'inline-flex' }}>
          <Box sx={{ width: 14, height: 14, borderRadius: '4px', bgcolor: String(value), border: 1, borderColor: 'border.strong' }} />
          <Mono>{String(value)}</Mono>
        </Stack>
      );
    case 'image':
    case 'video':
    case 'file': {
      const asset = ctx.assets?.get(String(value));
      if (!asset) return <Typography variant="caption" color="text.secondary">1 file</Typography>;
      return (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <AssetThumb asset={asset} size={28} radius={6} />
          <Text value={asset.filename} />
        </Stack>
      );
    }
    case 'images':
    case 'files': {
      const ids = value as string[];
      const first = ctx.assets?.get(ids[0]);
      return (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {first && <AssetThumb asset={first} size={28} radius={6} />}
          <Typography variant="body2" color="text.secondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
            {count(ids.length, field.type === 'images' ? 'image' : 'file')}
          </Typography>
        </Stack>
      );
    }
    case 'relation': {
      const title = ctx.relations.get(String(value));
      return title ? <Text value={title} /> : <Typography variant="caption" color="text.secondary">1 linked</Typography>;
    }
    case 'relations': {
      const ids = value as string[];
      const titles = ids.map((id) => ctx.relations.get(id)).filter((t): t is string => !!t);
      return (
        <Tooltip title={titles.length ? titles.join(', ') + (ids.length > titles.length ? '…' : '') : ''}>
          <Typography variant="body2" color="text.secondary" component="span" sx={{ whiteSpace: 'nowrap' }}>
            {ids.length} linked
          </Typography>
        </Tooltip>
      );
    }
    case 'richtext': {
      const text = richTextToPlainText(value);
      return text ? <Text value={text} /> : <Dash />;
    }
    case 'component':
      return <Typography variant="caption" color="text.secondary">Filled in</Typography>;
    case 'repeatable':
    case 'dynamiczone':
      return <Typography variant="body2" color="text.secondary" component="span">{count((value as unknown[]).length, 'item')}</Typography>;
    case 'json':
      return <Mono sx={{ color: 'text.secondary' }}>{truncate(JSON.stringify(value), 40)}</Mono>;
    case 'geolocation': {
      const geo = value as { lat?: number; lng?: number };
      return typeof geo.lat === 'number' && typeof geo.lng === 'number' ? <Mono>{`${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`}</Mono> : <Dash />;
    }
    case 'password':
      return isSecretValue(value) ? <Typography variant="caption" color="text.secondary">Set</Typography> : <Dash />;
    case 'slug':
    case 'uid':
    case 'code':
      return <Text value={String(value)} mono />;
    default:
      return <Text value={String(value)} />;
  }
}

/** Media ids referenced by the given columns across the visible rows. */
export function collectAssetIds(fields: FieldDef[], rows: { data?: Record<string, unknown> }[]): string[] {
  const ids = new Set<string>();
  for (const field of fields) {
    if (!['image', 'video', 'file', 'images', 'files'].includes(field.type)) continue;
    for (const row of rows) {
      const value = row.data?.[field.apiId];
      if (typeof value === 'string' && value) ids.add(value);
      else if (Array.isArray(value) && typeof value[0] === 'string') ids.add(value[0]);
    }
  }
  return [...ids];
}

const scalarOf = (field: FieldDef): FieldScalar => FIELD_TYPE_META[field.type].scalar;
const usable = (field: FieldDef) => !field.config.private && field.type !== 'password';

/** Fields the API can sort by: single scalar values that are not opted out. */
export const isSortableField = (field: FieldDef) => usable(field) && field.config.sortable !== false && ['string', 'number', 'boolean', 'date'].includes(scalarOf(field));

/** Reference fields hold ids, which nobody types by hand; they can only be filtered on being set or not. */
const REFERENCE_TYPES = ['relation', 'image', 'video', 'file'];

/** Fields offered in the filter builder. Lists of references are left out: the API cannot test them for emptiness. */
export const isFilterableField = (field: FieldDef) =>
  usable(field) && field.config.filterable !== false && (['string', 'number', 'boolean', 'date'].includes(scalarOf(field)) || field.type === 'multiselect');

/** Fields that make sense as a table column by default (short, scannable values). */
export const isCompactField = (field: FieldDef) => !['richtext', 'markdown', 'json', 'code', 'component', 'repeatable', 'dynamiczone', 'password', 'textarea', 'geolocation'].includes(field.type);

export type FilterOp = 'eq' | 'ne' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'null';

export interface ListFilter {
  field: string;
  op: FilterOp;
  value: string;
}

const OP_LABELS: Record<FilterOp, string> = {
  eq: 'is',
  ne: 'is not',
  contains: 'contains',
  gt: 'greater than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
  null: 'is empty',
};

/** Operators the delivery/management API supports for a field, in the order they are offered. */
export function operatorsFor(field: FieldDef): { value: FilterOp; label: string }[] {
  const scalar = scalarOf(field);
  let ops: FilterOp[];
  if (scalar === 'number') ops = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'null'];
  else if (scalar === 'date') ops = ['eq', 'gt', 'gte', 'lt', 'lte', 'null'];
  else if (scalar === 'boolean') ops = ['eq', 'null'];
  else if (scalar === 'stringArray') ops = ['contains'];
  else if (REFERENCE_TYPES.includes(field.type)) ops = ['null'];
  else if (field.type === 'select' || field.type === 'radio') ops = ['eq', 'ne', 'null'];
  else ops = ['contains', 'eq', 'ne', 'null'];
  return ops.map((value) => ({
    value,
    label: scalar === 'date' && value !== 'eq' && value !== 'null' ? { gt: 'after', gte: 'on or after', lt: 'before', lte: 'on or before' }[value as 'gt' | 'gte' | 'lt' | 'lte'] : scalar === 'stringArray' && value === 'contains' ? 'includes' : OP_LABELS[value],
  }));
}

/** Human-readable summary of a filter, for chips. */
export function describeFilter(filter: ListFilter, field: FieldDef | undefined): string {
  const label = field?.label ?? filter.field;
  if (filter.op === 'null') return `${label} ${filter.value === 'false' ? 'is not empty' : 'is empty'}`;
  const op = field ? (operatorsFor(field).find((o) => o.value === filter.op)?.label ?? filter.op) : filter.op;
  let value = filter.value;
  if (field?.config.options) value = field.config.options.find((o) => o.value === filter.value)?.label ?? value;
  else if (field && scalarOf(field) === 'boolean') value = filter.value === 'true' ? 'yes' : 'no';
  else if (field?.type === 'datetime') value = shortDate(filter.value);
  return `${label} ${op} ${value}`;
}
