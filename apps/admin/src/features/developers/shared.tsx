import { type ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import type { TokenType } from '@meridian/shared';
import { ENVIRONMENT_TONES } from '@/app/nav';
import { useProject } from '@/app/workspace';
import { CodeBlock, CopyButton, EmptyState, Page, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { ApiToken, Webhook } from '@/lib/types';
import { FONT_MONO } from '@/theme/theme';

// ─── Queries ─────────────────────────────────────────────────────────────────

/** API tokens of the current project. The plaintext secret is never part of this list. */
export function useTokens() {
  const ws = useProject();
  return useQuery({
    queryKey: ['tokens', ws.project.id],
    queryFn: () => api.get<{ items: ApiToken[] }>(`${ws.projectBase}/tokens`).then((r) => r.items),
    enabled: ws.can('token.manage'),
  });
}

export function useWebhooks() {
  const ws = useProject();
  return useQuery({
    queryKey: ['webhooks', ws.environment.id],
    queryFn: () => api.get<{ items: Webhook[] }>(`${ws.envBase}/webhooks`).then((r) => r.items),
    enabled: ws.can('webhook.manage'),
  });
}

// ─── Token presentation ──────────────────────────────────────────────────────

export const TOKEN_TYPE_INFO: Record<TokenType, { label: string; summary: string; detail: string; secret: boolean }> = {
  READ_ONLY: {
    label: 'Read-only',
    summary: 'Published content only. Safe to use in browsers and apps.',
    detail: 'Can only read content that has been published. It can never return drafts or change anything, so it may ship in client-side code.',
    secret: false,
  },
  PREVIEW: {
    label: 'Preview',
    summary: 'Reads drafts as well as published content. Server-side secret.',
    detail: 'Reads unpublished drafts for preview environments. Treat it as a secret: keep it on a server and never bundle it into browser code.',
    secret: true,
  },
  READ_WRITE: {
    label: 'Read/write',
    summary: 'Creates, updates, publishes and deletes content. Server-side secret.',
    detail: 'Full access to this environment’s content through the API. Treat it as a secret: keep it on a server and never bundle it into browser code.',
    secret: true,
  },
};

export function TokenTypePill({ type }: { type: TokenType }) {
  const info = TOKEN_TYPE_INFO[type];
  return info.secret ? (
    <Pill label={info.label} fg="warning.dark" bg="warning.light" title={info.summary} />
  ) : (
    <Pill label={info.label} title={info.summary} />
  );
}

/** Which kind of key a pasted token is, read from its public prefix. */
export function tokenTypeOf(token: string): TokenType | null {
  if (token.startsWith('mrd_ro_')) return 'READ_ONLY';
  if (token.startsWith('mrd_rw_')) return 'READ_WRITE';
  if (token.startsWith('mrd_pv_')) return 'PREVIEW';
  return null;
}

export function EnvironmentLabel({ environmentId }: { environmentId: string }) {
  const ws = useProject();
  const env = ws.project.environments.find((e) => e.id === environmentId);
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ENVIRONMENT_TONES[env?.key ?? ''] ?? 'text.disabled', flexShrink: 0 }} />
      <span>{env?.name ?? 'Unknown'}</span>
    </Stack>
  );
}

// ─── Small building blocks ───────────────────────────────────────────────────

export function NoAccess({ title, what }: { title: string; what: string }) {
  return (
    <Page>
      <Paper sx={{ borderRadius: '10px' }}>
        <EmptyState icon={<LockOutlined />} title={`You don’t have access to ${title}`} description={`Your role does not include permission to ${what}. Ask an administrator of this organization if you need it.`} />
      </Paper>
    </Page>
  );
}

const METHOD_TONE: Record<string, { fg: string; bg: string }> = {
  GET: { fg: 'success.dark', bg: 'success.light' },
  POST: { fg: 'warning.dark', bg: 'warning.light' },
  PUT: { fg: 'warning.dark', bg: 'warning.light' },
  PATCH: { fg: 'warning.dark', bg: 'warning.light' },
  DELETE: { fg: 'error.dark', bg: 'error.light' },
};

export function MethodBadge({ method, width = 52 }: { method: string; width?: number }) {
  const tone = METHOD_TONE[method.toUpperCase()] ?? { fg: 'text.secondary', bg: 'surface.sunken' };
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', width, height: 20, flexShrink: 0, borderRadius: '5px', bgcolor: tone.bg, color: tone.fg, fontFamily: FONT_MONO, fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.02em' }}
    >
      {method.toUpperCase()}
    </Box>
  );
}

/** A secret shown in full with a copy button, and a control to mask it again on shared screens. */
export function SecretBox({ value, label }: { value: string; label: string }) {
  const [visible, setVisible] = useState(true);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', border: 1, borderColor: 'border.strong', borderRadius: '8px', bgcolor: 'surface.subtle', pl: 3, pr: 1, py: 1 }}>
      <Box component="code" aria-label={label} sx={{ flex: 1, minWidth: 0, fontFamily: FONT_MONO, fontSize: '0.8125rem', overflowWrap: 'anywhere', userSelect: 'all' }}>
        {visible ? value : '•'.repeat(Math.min(48, value.length))}
      </Box>
      <Tooltip title={visible ? 'Hide' : 'Show'}>
        <IconButton size="small" aria-label={visible ? `Hide ${label}` : `Show ${label}`} onClick={() => setVisible((v) => !v)}>
          {visible ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
        </IconButton>
      </Tooltip>
      <CopyButton value={value} label={`Copy ${label}`} />
    </Stack>
  );
}

/**
 * Shows a newly issued secret exactly once. It cannot be dismissed by clicking outside,
 * so nobody loses a key they have not copied yet.
 */
export function SecretRevealDialog({
  open,
  title,
  secret,
  label,
  warning,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  secret: string;
  label: string;
  warning: ReactNode;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} maxWidth="sm" aria-labelledby="secret-reveal-title" onClose={(_, reason) => reason !== 'backdropClick' && onClose()}>
      <DialogTitle id="secret-reveal-title">{title}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 4 }}>
          {warning}
        </Alert>
        <SecretBox value={secret} label={label} />
        {children && <Box sx={{ mt: 4 }}>{children}</Box>}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          I have saved it
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export interface SnippetItem {
  label: string;
  code: string;
  language?: string;
  /** File name or short context shown above the code. */
  caption?: string;
}

/** One or more code samples behind tabs, each with a copy button. */
export function Snippets({ items, maxHeight = 420 }: { items: SnippetItem[]; maxHeight?: number }) {
  const [index, setIndex] = useState(0);
  const active = items[Math.min(index, items.length - 1)];
  if (!active) return null;
  return (
    <Box>
      {items.length > 1 && (
        <Tabs value={Math.min(index, items.length - 1)} onChange={(_, next) => setIndex(next)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, minHeight: 34, '& .MuiTab-root': { minHeight: 34, py: 1 } }}>
          {items.map((item) => (
            <Tab key={item.label} label={item.label} />
          ))}
        </Tabs>
      )}
      {active.caption && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1, fontFamily: FONT_MONO }}>
          {active.caption}
        </Typography>
      )}
      <CodeBlock code={active.code} language={active.language} maxHeight={maxHeight} />
    </Box>
  );
}

// ─── Allowed origins ─────────────────────────────────────────────────────────

/** Normalises user input to a bare origin (scheme + host + port), or explains why it is not one. */
export function parseOrigin(raw: string): { origin: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { error: 'Enter an origin such as https://example.com' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: 'Origins look like https://example.com' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Origins must start with https:// or http://' };
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return { error: 'Leave out the path — an origin is only scheme, host and port' };
  return { origin: url.origin };
}

export function OriginsEditor({ value, onChange, disabled }: { value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const parsed = parseOrigin(draft);
    if ('error' in parsed) return setError(parsed.error);
    if (value.includes(parsed.origin)) return setError('That origin is already listed');
    if (value.length >= 30) return setError('A key can list at most 30 origins');
    onChange([...value, parsed.origin]);
    setDraft('');
    setError('');
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <TextField
          label="Allowed origin"
          placeholder="https://www.example.com"
          value={draft}
          disabled={disabled}
          error={!!error}
          helperText={error || 'Optional. Leave empty to allow any website.'}
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outlined" startIcon={<AddOutlined />} onClick={add} disabled={disabled || !draft.trim()} sx={{ flexShrink: 0, mt: 0.25 }}>
          Add
        </Button>
      </Stack>
      {value.length > 0 && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mt: 2 }} component="ul" aria-label="Allowed origins" style={{ listStyle: 'none', padding: 0, marginBottom: 0 }}>
          {value.map((origin) => (
            <Box component="li" key={origin}>
              <Chip label={origin} variant="outlined" onDelete={disabled ? undefined : () => onChange(value.filter((o) => o !== origin))} sx={{ fontFamily: FONT_MONO, fontSize: '0.6875rem' }} />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}

// ─── Webhook deliveries ──────────────────────────────────────────────────────

const DELIVERY_TONE: Record<string, { fg: string; bg: string; label: string }> = {
  SUCCESS: { fg: 'success.dark', bg: 'success.light', label: 'Delivered' },
  FAILED: { fg: 'error.dark', bg: 'error.light', label: 'Failed' },
  RETRYING: { fg: 'warning.dark', bg: 'warning.light', label: 'Retrying' },
  PENDING: { fg: 'text.secondary', bg: 'surface.sunken', label: 'Queued' },
};

export function DeliveryStatusPill({ status, simulated }: { status: string; simulated?: boolean }) {
  // Guest mode records the delivery a server would have attempted; nothing was sent, so it is never shown as delivered.
  if (simulated) return <Pill label="Simulated" dot title="Recorded in guest mode. No request was sent to the endpoint." />;
  const tone = DELIVERY_TONE[status] ?? DELIVERY_TONE.PENDING;
  return <Pill label={tone.label} fg={tone.fg} bg={tone.bg} dot />;
}

export const isInFlight = (status: string) => status === 'PENDING' || status === 'RETRYING';

export const CONNECTED_WINDOW_MS = 30 * 86400 * 1000;

/** A key counts as a connected application when it has been used in the last 30 days. */
export const isConnected = (token: Pick<ApiToken, 'lastUsedAt' | 'status'>) =>
  token.status === 'active' && !!token.lastUsedAt && Date.now() - new Date(token.lastUsedAt).getTime() < CONNECTED_WINDOW_MS;
