import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CodeBlock, Mono, Pill } from '@/components/ui';
import { api, type deliveryFetch, errorMessage } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import type { ApiToken } from '@/lib/types';
import { toast } from '@/store';
import { FONT_MONO } from '@/theme/theme';
import { TOKEN_TYPE_INFO, TokenTypePill, tokenTypeOf } from '../shared';

export type Probe = Awaited<ReturnType<typeof deliveryFetch>>;

const storageKey = (environmentId: string) => `meridian.explorer.key.${environmentId}`;

/**
 * The key used by the explorer, kept for this browser tab only (sessionStorage) and
 * separately per environment, so switching environments never sends the wrong key.
 */
export function useExplorerKey(environmentId: string): [string, (key: string) => void] {
  const read = useCallback(() => {
    try {
      return sessionStorage.getItem(storageKey(environmentId)) ?? '';
    } catch {
      return '';
    }
  }, [environmentId]);
  const [key, setKey] = useState(read);
  useEffect(() => setKey(read()), [read]);
  const update = useCallback(
    (next: string) => {
      setKey(next);
      try {
        if (next) sessionStorage.setItem(storageKey(environmentId), next);
        else sessionStorage.removeItem(storageKey(environmentId));
      } catch {
        // Storage can be unavailable; the key then lives only in memory for this visit.
      }
    },
    [environmentId],
  );
  return [key, update];
}

export function CredentialBar({ apiKey, onChange }: { apiKey: string; onChange: (key: string) => void }) {
  const ws = useProject();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const type = tokenTypeOf(apiKey.trim());
  const canCreate = ws.can('token.manage');

  const create = useMutation({
    mutationFn: (kind: 'READ_ONLY' | 'READ_WRITE') =>
      api.post<ApiToken>(`${ws.projectBase}/tokens`, {
        name: kind === 'READ_WRITE' ? 'API Explorer (temporary, read/write)' : 'API Explorer (temporary)',
        description: 'Created from the API explorer. Expires automatically after one day.',
        type: kind,
        environmentId: ws.environment.id,
        expiresInDays: 1,
        // Bound to this admin origin, so the key is of no use from any other website.
        allowedOrigins: [window.location.origin],
      }),
    onSuccess: async (token) => {
      if (token.token) onChange(token.token);
      await queryClient.invalidateQueries({ queryKey: ['tokens', ws.project.id] });
      toast.success(`Temporary ${TOKEN_TYPE_INFO[token.type].label.toLowerCase()} key created — it expires in 24 hours`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createWriteKey = async () => {
    const ok = await confirm({
      title: 'Create a temporary read/write key?',
      message: `Requests sent with it really create, change, publish and delete content in ${ws.environment.name}. The key works only from this admin and expires after 24 hours.`,
      confirmLabel: 'Create read/write key',
    });
    if (ok) create.mutate('READ_WRITE');
  };

  return (
    <Paper sx={{ borderRadius: '10px', p: 3.5, mb: 4 }}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2.5} sx={{ alignItems: { lg: 'center' } }}>
        <TextField
          value={apiKey}
          onChange={(e) => onChange(e.target.value.trim())}
          type={visible ? 'text' : 'password'}
          placeholder="Paste an API key (mrd_…) or create a temporary one"
          autoComplete="off"
          sx={{ flex: 1 }}
          slotProps={{
            htmlInput: { 'aria-label': 'API key used for requests', spellCheck: false, style: { fontFamily: FONT_MONO } },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <KeyOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
                </InputAdornment>
              ),
              endAdornment: apiKey ? (
                <InputAdornment position="end">
                  <Tooltip title={visible ? 'Hide key' : 'Show key'}>
                    <IconButton size="small" aria-label={visible ? 'Hide key' : 'Show key'} onClick={() => setVisible((v) => !v)}>
                      {visible ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Forget this key">
                    <IconButton size="small" edge="end" aria-label="Forget this key" onClick={() => onChange('')}>
                      <CloseOutlined />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1.5 }}>
          {type ? <TokenTypePill type={type} /> : apiKey ? <Pill label="Unrecognised key" fg="warning.dark" bg="warning.light" /> : null}
          {canCreate && (
            <>
              <Button variant="outlined" onClick={() => create.mutate('READ_ONLY')} loading={create.isPending && create.variables === 'READ_ONLY'} disabled={create.isPending}>
                Create a temporary key
              </Button>
              <Button onClick={() => void createWriteKey()} loading={create.isPending && create.variables === 'READ_WRITE'} disabled={create.isPending}>
                Temporary read/write key
              </Button>
            </>
          )}
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0 }}>
        Requests go to the live delivery API for <b>{ws.environment.name}</b>. The key is kept in this browser tab only.
        {type && TOKEN_TYPE_INFO[type].secret && !canCreate ? ' Read/write and preview keys are refused from browsers unless this admin’s origin is on their allow-list.' : ''}
      </Typography>
    </Paper>
  );
}

function statusTone(status: number): { fg: string; bg: string } {
  if (status >= 500) return { fg: 'error.dark', bg: 'error.light' };
  if (status >= 400) return { fg: 'warning.dark', bg: 'warning.light' };
  if (status >= 300) return { fg: 'text.secondary', bg: 'surface.sunken' };
  return { fg: 'success.dark', bg: 'success.light' };
}

export function ResponseSummary({ probe }: { probe: Probe }) {
  const tone = statusTone(probe.status);
  const cache = probe.headers['x-cache'];
  const remaining = probe.headers['x-ratelimit-remaining'];
  return (
    <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
      <Pill label={`HTTP ${probe.status}`} fg={tone.fg} bg={tone.bg} dot />
      <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {probe.durationMs} ms · {formatBytes(probe.size)}
      </Typography>
      {cache && <Pill label={`Cache ${cache}`} title={cache === 'HIT' ? 'Served from the delivery cache' : 'Read from the database and cached'} />}
      {remaining !== undefined && <Pill label={`${remaining} requests left this minute`} />}
    </Stack>
  );
}

const NOTABLE = ['x-cache', 'etag', 'cache-control', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after', 'x-request-id'];

export function ResponseHeaders({ probe }: { probe: Probe }) {
  const entries = Object.entries(probe.headers).sort(([a], [b]) => {
    const ia = NOTABLE.indexOf(a);
    const ib = NOTABLE.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
        No readable headers on this response.
      </Typography>
    );
  }
  return (
    <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'hidden' }}>
      <Table size="small">
        <TableBody>
          {entries.map(([name, value]) => (
            <TableRow key={name}>
              <TableCell sx={{ width: 220, verticalAlign: 'top' }}>
                <Mono sx={{ fontWeight: NOTABLE.includes(name) ? 600 : 400 }}>{name}</Mono>
              </TableCell>
              <TableCell>
                <Mono sx={{ overflowWrap: 'anywhere' }}>{value}</Mono>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

export function ResponseBody({ probe, maxHeight = 520 }: { probe: Probe; maxHeight?: number }) {
  if (probe.body === null || probe.body === '') {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
        {probe.status === 304 ? 'Not modified — the copy you already have is still current.' : 'The response has no body.'}
      </Typography>
    );
  }
  const text = typeof probe.body === 'string' ? probe.body : JSON.stringify(probe.body, null, 2);
  return <CodeBlock code={text} language={typeof probe.body === 'string' ? undefined : 'json'} maxHeight={maxHeight} />;
}
