import { type ReactNode, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper, { type PaperProps } from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TablePagination from '@mui/material/TablePagination';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { type SxProps, type Theme, keyframes } from '@mui/material/styles';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { type EntryStatus, STATUS_LABELS } from '@meridian/shared';
import { errorMessage } from '@/lib/api';
import { fullDateTime, initials, relativeTime } from '@/lib/format';
import { FONT_MONO } from '@/theme/theme';

// ─── Layout ──────────────────────────────────────────────────────────────────

const pageIn = keyframes({ from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } });

/**
 * Standard page container with a short entrance transition. It is a CSS animation, so it
 * always reaches its end state even when the browser throttles script-driven frames, and
 * the global reduced-motion rule switches it off.
 */
export function Page({ children, width = 1280, sx }: { children: ReactNode; width?: number | 'full'; sx?: SxProps<Theme> }) {
  return (
    <Box
      sx={{ width: '100%', maxWidth: width === 'full' ? 'none' : width, mx: 'auto', px: { xs: 4, md: 8 }, py: { xs: 5, md: 7 }, animation: `${pageIn} 180ms ease-out both`, ...sx }}
    >
      {children}
    </Box>
  );
}

export function PageHeader({ title, description, actions, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 6, alignItems: { sm: 'flex-start' }, justifyContent: 'space-between' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="h2" component="h1" sx={{ overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          {meta}
        </Stack>
        {description && (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack direction="row" spacing={2} sx={{ flexShrink: 0, flexWrap: 'wrap', rowGap: 2 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}

/** Titled card used to group related settings or data. */
export function Section({
  title,
  description,
  action,
  children,
  flush,
  ...paper
}: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; flush?: boolean } & Omit<PaperProps, 'title'>) {
  return (
    <Paper {...paper} sx={{ borderRadius: '10px', overflow: 'hidden', ...paper.sx }}>
      {(title || action) && (
        <Stack direction="row" spacing={2} sx={{ px: 5, py: 3.5, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h2">
              {title}
            </Typography>
            {description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {description}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
      )}
      <Box sx={flush ? undefined : { p: 5 }}>{children}</Box>
    </Paper>
  );
}

// ─── States ──────────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: compact ? 8 : 16, px: 6 }}>
      {icon && (
        <Box sx={{ width: 44, height: 44, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: 'surface.sunken', color: 'text.secondary', '& svg': { fontSize: 22 } }}>
          {icon}
        </Box>
      )}
      <Typography variant="h4" component="p">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ pt: 2 }}>{action}</Box>}
    </Stack>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  return (
    <EmptyState
      compact={compact}
      icon={<ErrorOutlineOutlined />}
      title="This could not be loaded"
      description={errorMessage(error)}
      action={
        onRetry && (
          <Button variant="outlined" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

/** Inline error for forms and dialogs. Renders nothing when there is no error. */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert severity="error" sx={{ mb: 3 }}>
      {errorMessage(error)}
    </Alert>
  );
}

export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <Box sx={{ p: 3 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <Stack key={r} direction="row" spacing={4} sx={{ py: 2.5, alignItems: 'center' }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} variant="rounded" height={14} sx={{ flex: c === 0 ? 2.2 : 1, opacity: 1 - r * 0.1 }} />
          ))}
        </Stack>
      ))}
    </Box>
  );
}

export function CardSkeleton({ height = 120, count = 1 }: { height?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={height} sx={{ borderRadius: '10px' }} />
      ))}
    </>
  );
}

// ─── Data display ────────────────────────────────────────────────────────────

const STATUS_TONE: Record<EntryStatus, { fg: string; bg: string }> = {
  DRAFT: { fg: 'text.secondary', bg: 'surface.sunken' },
  IN_REVIEW: { fg: 'info.dark', bg: 'info.light' },
  CHANGES_REQUESTED: { fg: 'warning.dark', bg: 'warning.light' },
  APPROVED: { fg: 'success.dark', bg: 'success.light' },
  SCHEDULED: { fg: 'info.dark', bg: 'info.light' },
  PUBLISHED: { fg: 'success.dark', bg: 'success.light' },
  ARCHIVED: { fg: 'text.disabled', bg: 'surface.sunken' },
};

export function Pill({ label, fg = 'text.secondary', bg = 'surface.sunken', dot, title }: { label: ReactNode; fg?: string; bg?: string; dot?: boolean; title?: string }) {
  const pill = (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, height: 22, px: 2, borderRadius: '6px', bgcolor: bg, color: fg, fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap', lineHeight: 1 }}
    >
      {dot && <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor', flexShrink: 0 }} />}
      {label}
    </Box>
  );
  return title ? <Tooltip title={title}>{pill}</Tooltip> : pill;
}

/** Editorial status. Live content with newer unpublished edits reads as "Modified". */
export function StatusChip({ status, isPublished, hasChanges }: { status: EntryStatus; isPublished?: boolean; hasChanges?: boolean }) {
  if (isPublished && hasChanges && status === 'DRAFT') {
    return <Pill label="Modified" fg="warning.dark" bg="warning.light" dot title="Published, with newer changes that are not live yet" />;
  }
  const tone = STATUS_TONE[status];
  const live = isPublished && status !== 'PUBLISHED';
  return <Pill label={STATUS_LABELS[status]} fg={tone.fg} bg={tone.bg} dot title={live ? 'An earlier version is live' : undefined} />;
}

export function RelativeTime({ value }: { value: string | Date | null | undefined }) {
  if (!value) return <>—</>;
  return (
    <Tooltip title={fullDateTime(value)}>
      <Box component="time" dateTime={new Date(value).toISOString()} sx={{ whiteSpace: 'nowrap' }}>
        {relativeTime(value)}
      </Box>
    </Tooltip>
  );
}

const AVATAR_TONES = ['#1F6F5C', '#4A6B85', '#8A5A2B', '#6B5B7B', '#3F6B4F', '#7A4B4B', '#4F5D75'];

export function UserAvatar({ name, size = 24 }: { name: string | null | undefined; size?: number }) {
  const seed = [...(name ?? '?')].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return (
    <Avatar sx={{ width: size, height: size, fontSize: size * 0.42, fontWeight: 600, bgcolor: AVATAR_TONES[seed % AVATAR_TONES.length], color: '#fff' }} alt={name ?? ''}>
      {initials(name)}
    </Avatar>
  );
}

export function Mono({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', ...sx }}>
      {children}
    </Box>
  );
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', width = 260, autoFocus }: { value: string; onChange: (value: string) => void; placeholder?: string; width?: number | string; autoFocus?: boolean }) {
  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      sx={{ width: { xs: '100%', sm: width } }}
      slotProps={{
        htmlInput: { 'aria-label': placeholder },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlined sx={{ fontSize: 17, color: 'text.disabled' }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label="Clear search" onClick={() => onChange('')} edge="end">
                <CloseOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    });
  };
  return [copied, copy];
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, copy] = useCopy();
  return (
    <Tooltip title={copied ? 'Copied' : label}>
      <IconButton size="small" aria-label={label} onClick={() => copy(value)}>
        {copied ? <CheckOutlined sx={{ color: 'success.main' }} /> : <ContentCopyOutlined />}
      </IconButton>
    </Tooltip>
  );
}

export function CodeBlock({ code, maxHeight = 420, language }: { code: string; maxHeight?: number; language?: string }) {
  return (
    <Box sx={{ position: 'relative', borderRadius: '8px', border: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ position: 'absolute', top: 6, right: 6, alignItems: 'center', gap: 1 }}>
        {language && (
          <Typography variant="caption" color="text.disabled" sx={{ fontFamily: FONT_MONO }}>
            {language}
          </Typography>
        )}
        <CopyButton value={code} />
      </Stack>
      <Box component="pre" tabIndex={0} sx={{ m: 0, p: 3.5, pr: 12, maxHeight, overflow: 'auto', fontSize: '0.75rem', lineHeight: 1.65, whiteSpace: 'pre', color: 'text.primary' }}>
        <code>{code}</code>
      </Box>
    </Box>
  );
}

export function TableFooter({ page, pageSize, total, onPage, onPageSize }: { page: number; pageSize: number; total: number; onPage: (page: number) => void; onPageSize?: (size: number) => void }) {
  return (
    <TablePagination
      component="div"
      count={total}
      page={Math.max(0, page - 1)}
      rowsPerPage={pageSize}
      onPageChange={(_, next) => onPage(next + 1)}
      onRowsPerPageChange={onPageSize ? (e) => onPageSize(Number(e.target.value)) : undefined}
      rowsPerPageOptions={onPageSize ? [10, 25, 50, 100] : []}
      sx={{ borderTop: 1, borderColor: 'border.subtle', '& .MuiTablePagination-toolbar': { minHeight: 44 }, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.75rem', color: 'text.secondary' } }}
    />
  );
}

/** Label + supporting text + control laid out on one row; used for settings lists. */
export function SettingRow({ label, description, children }: { label: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 6 }} sx={{ py: 3.5, alignItems: { sm: 'center' }, justifyContent: 'space-between', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2">{label}</Typography>
        {description && (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        )}
      </Box>
      <Box sx={{ flexShrink: 0 }}>{children}</Box>
    </Stack>
  );
}
