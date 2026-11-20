import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { type FieldDef, isRichTextDoc, isSecretValue, richTextToPlainText, sameJson } from '@meridian/shared';
import { Pill } from '@/components/ui';
import { humanize } from '@/lib/format';
import { FONT_MONO } from '@/theme/theme';

/** Plain-text rendering of a stored value, good enough to read and to compare. */
export function formatFieldValue(field: FieldDef | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value) && value.length === 0) return '';
  if (isSecretValue(value)) return '•••••••• (secret)';
  if (isRichTextDoc(value)) return richTextToPlainText(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (field?.config.options) return field.config.options.find((o) => o.value === value)?.label ?? value;
    return value;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    const labels = (value as string[]).map((v) => field?.config.options?.find((o) => o.value === v)?.label ?? v);
    return labels.join(', ');
  }
  // Page blocks read better as an outline than as raw JSON.
  if (Array.isArray(value) && value.every((v) => v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string' && 'props' in (v as object))) {
    const outline = (nodes: { type: string; children?: unknown[] }[], depth: number): string[] =>
      nodes.flatMap((n) => [`${'  '.repeat(depth)}• ${n.type}`, ...(Array.isArray(n.children) ? outline(n.children as { type: string }[], depth + 1) : [])]);
    return `${outline(value as { type: string }[], 0).join('\n')}\n\n${JSON.stringify(value, null, 2)}`;
  }
  return JSON.stringify(value, null, 2);
}

export interface DiffRow {
  key: string;
  label: string;
  kind: 'added' | 'removed' | 'changed';
  before: string;
  after: string;
}

/** Field-by-field comparison of two data snapshots. Unknown keys (fields since removed) are included. */
export function diffData(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, fields: FieldDef[]): DiffRow[] {
  const a = before ?? {};
  const b = after ?? {};
  const byKey = new Map(fields.map((f) => [f.apiId, f]));
  const keys = [...fields.map((f) => f.apiId), ...[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !byKey.has(k))];
  const rows: DiffRow[] = [];
  for (const key of keys) {
    if (sameJson(a[key], b[key])) continue;
    const field = byKey.get(key);
    const from = formatFieldValue(field, a[key]);
    const to = formatFieldValue(field, b[key]);
    if (from === to) continue;
    rows.push({ key, label: field?.label ?? humanize(key), kind: !from ? 'added' : !to ? 'removed' : 'changed', before: from, after: to });
  }
  return rows;
}

const TONE = {
  added: { label: 'Added', fg: 'success.dark', bg: 'success.light' },
  removed: { label: 'Removed', fg: 'error.dark', bg: 'error.light' },
  changed: { label: 'Changed', fg: 'warning.dark', bg: 'warning.light' },
} as const;

function ValueBox({ text, tone }: { text: string; tone: 'before' | 'after' }) {
  const long = text.length > 160 || text.includes('\n');
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 2.5,
        py: 2,
        borderRadius: '7px',
        border: 1,
        borderColor: 'border.subtle',
        bgcolor: text ? (tone === 'before' ? 'error.light' : 'success.light') : 'surface.subtle',
        color: text ? 'text.primary' : 'text.disabled',
        fontSize: '0.8125rem',
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        maxHeight: 220,
        overflowY: 'auto',
        fontFamily: long && /^[\s[{•]/.test(text) ? FONT_MONO : 'inherit',
        textDecoration: tone === 'before' && text ? 'none' : 'none',
      }}
      tabIndex={long ? 0 : undefined}
    >
      {text || 'Empty'}
    </Box>
  );
}

/** Shows what differs between two snapshots, oldest on the left. */
export function VersionDiff({ before, after, fields, beforeLabel, afterLabel }: { before: Record<string, unknown> | null | undefined; after: Record<string, unknown> | null | undefined; fields: FieldDef[]; beforeLabel: string; afterLabel: string }) {
  const rows = useMemo(() => diffData(before, after, fields), [before, after, fields]);
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
        These two versions have identical content.
      </Typography>
    );
  }
  return (
    <Box>
      <Stack direction="row" spacing={3} sx={{ mb: 2, display: { xs: 'none', sm: 'flex' } }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
          {beforeLabel}
        </Typography>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
          {afterLabel}
        </Typography>
      </Stack>
      <Stack spacing={4}>
        {rows.map((row) => (
          <Box key={row.key}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1.5 }}>
              <Typography variant="subtitle2">{row.label}</Typography>
              <Pill label={TONE[row.kind].label} fg={TONE[row.kind].fg} bg={TONE[row.kind].bg} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
              <ValueBox text={row.before} tone="before" />
              <ValueBox text={row.after} tone="after" />
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

/** Read-only listing of every value in a snapshot. */
export function DataPreview({ data, fields }: { data: Record<string, unknown> | null | undefined; fields: FieldDef[] }) {
  const source = data ?? {};
  const byKey = new Map(fields.map((f) => [f.apiId, f]));
  const keys = [...fields.map((f) => f.apiId), ...Object.keys(source).filter((k) => !byKey.has(k))];
  return (
    <Stack spacing={3.5}>
      {keys.map((key) => {
        const field = byKey.get(key);
        const text = formatFieldValue(field, source[key]);
        return (
          <Box key={key}>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
              {field?.label ?? humanize(key)}
              {!field && ' (field no longer in the model)'}
            </Typography>
            <Box
              sx={{ fontSize: '0.8125rem', lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 200, overflowY: 'auto', color: text ? 'text.primary' : 'text.disabled', fontFamily: text.startsWith('{') || text.startsWith('[') || text.startsWith('•') ? FONT_MONO : 'inherit' }}
              tabIndex={text.length > 400 ? 0 : undefined}
            >
              {text || 'Empty'}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
