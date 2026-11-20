import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import AutorenewOutlined from '@mui/icons-material/AutorenewOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import RadioButtonCheckedOutlined from '@mui/icons-material/RadioButtonCheckedOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import { TOKEN_TYPES, type TokenType } from '@meridian/shared';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CodeBlock, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput, TableSkeleton } from '@/components/ui';
import { API_URL, ApiError, api } from '@/lib/api';
import { compactNumber, shortDate } from '@/lib/format';
import type { ApiToken } from '@/lib/types';
import { toast } from '@/store';
import { EnvironmentLabel, NoAccess, OriginsEditor, SecretRevealDialog, TOKEN_TYPE_INFO, TokenTypePill, useTokens } from './shared';
import { snippetContext } from './snippets';

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Never' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
];

const metaSchema = z.object({
  name: z.string().trim().min(1, 'Give the key a name').max(80, 'Keep the name under 80 characters'),
  description: z.string().trim().max(300, 'Keep the description under 300 characters'),
  rateLimitPerMinute: z
    .number({ invalid_type_error: 'Enter a number of requests per minute' })
    .int('Use a whole number')
    .min(1, 'Allow at least 1 request per minute')
    .max(100_000, 'The maximum is 100,000 per minute'),
  allowedOrigins: z.array(z.string()).max(30),
});
const createSchema = metaSchema.extend({
  type: z.enum(TOKEN_TYPES),
  environmentId: z.string().uuid('Choose an environment'),
  expiresInDays: z.number().int(),
});
type CreateValues = z.infer<typeof createSchema>;
type MetaValues = z.infer<typeof metaSchema>;

const STATUS_TONE: Record<ApiToken['status'], { fg: string; bg: string; label: string }> = {
  active: { fg: 'success.dark', bg: 'success.light', label: 'Active' },
  expired: { fg: 'warning.dark', bg: 'warning.light', label: 'Expired' },
  revoked: { fg: 'text.disabled', bg: 'surface.sunken', label: 'Revoked' },
};

const ORIGIN_HELP =
  'Allowed origins limit which websites may call the API with this key from a browser. Requests without an Origin header — servers, build scripts, mobile apps — are not affected. Read/write and preview keys are refused from every browser origin that is not listed here.';

function applyServerErrors(err: unknown, setError: (name: never, error: { message: string }) => void, fields: string[]) {
  if (!(err instanceof ApiError)) return false;
  let applied = false;
  for (const [path, message] of Object.entries(err.fieldErrors)) {
    const field = path.split('.')[0];
    if (fields.includes(field)) {
      setError(field as never, { message });
      applied = true;
    }
  }
  return applied;
}

function TypeChoice({ value, onChange }: { value: TokenType; onChange: (type: TokenType) => void }) {
  const order: TokenType[] = ['READ_ONLY', 'PREVIEW', 'READ_WRITE'];
  return (
    <Stack spacing={2} role="radiogroup" aria-label="Access level">
      {order.map((type) => {
        const info = TOKEN_TYPE_INFO[type];
        const selected = value === type;
        return (
          <ButtonBase
            key={type}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(type)}
            sx={{ p: 3, gap: 2.5, borderRadius: '8px', border: 1, borderColor: selected ? 'secondary.main' : 'border.strong', bgcolor: selected ? 'action.selected' : 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left' }}
          >
            {selected ? <RadioButtonCheckedOutlined sx={{ fontSize: 18, color: 'secondary.main', mt: 0.25 }} /> : <RadioButtonUncheckedOutlined sx={{ fontSize: 18, color: 'text.disabled', mt: 0.25 }} />}
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {info.label}
                </Typography>
                {info.secret ? <Pill label="Server-side secret" fg="warning.dark" bg="warning.light" /> : <Pill label="Browser-safe" fg="success.dark" bg="success.light" />}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {info.detail}
              </Typography>
            </Box>
          </ButtonBase>
        );
      })}
    </Stack>
  );
}

function CreateKeyDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (token: ApiToken) => void }) {
  const ws = useProject();
  const queryClient = useQueryClient();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', description: '', type: 'READ_ONLY', environmentId: ws.environment.id, expiresInDays: 0, rateLimitPerMinute: 600, allowedOrigins: [] },
  });
  const { errors } = form.formState;
  const create = useMutation({
    mutationFn: (values: CreateValues) => api.post<ApiToken>(`${ws.projectBase}/tokens`, { ...values, expiresInDays: values.expiresInDays > 0 ? values.expiresInDays : null }),
    onSuccess: async (token) => {
      await queryClient.invalidateQueries({ queryKey: ['tokens', ws.project.id] });
      onCreated(token);
      onClose();
    },
    onError: (err) => applyServerErrors(err, form.setError, ['name', 'description', 'rateLimitPerMinute', 'allowedOrigins', 'environmentId']),
  });
  const type = form.watch('type');

  return (
    <Dialog
      open={open}
      onClose={() => !create.isPending && onClose()}
      maxWidth="sm"
      aria-labelledby="create-key-title"
      slotProps={{ transition: { onExited: () => { form.reset({ name: '', description: '', type: 'READ_ONLY', environmentId: ws.environment.id, expiresInDays: 0, rateLimitPerMinute: 600, allowedOrigins: [] }); create.reset(); } } }}
    >
      <form noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <DialogTitle id="create-key-title">Create API key</DialogTitle>
        <DialogContent>
          <FormError error={create.error instanceof ApiError && Object.keys(create.error.fieldErrors).length ? null : create.error} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <TextField label="Name" placeholder="Website (production)" autoFocus error={!!errors.name} helperText={errors.name?.message ?? 'Name it after the application that will use it.'} {...form.register('name')} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message} {...form.register('description')} />
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 2 }}>
                Access level
              </Typography>
              <Controller control={form.control} name="type" render={({ field }) => <TypeChoice value={field.value} onChange={field.onChange} />} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 4 }}>
              <Controller
                control={form.control}
                name="environmentId"
                render={({ field }) => (
                  <TextField select label="Environment" error={!!errors.environmentId} helperText={errors.environmentId?.message ?? 'A key only ever sees one environment.'} {...field}>
                    {ws.project.environments.map((env) => (
                      <MenuItem key={env.id} value={env.id}>
                        {env.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                control={form.control}
                name="expiresInDays"
                render={({ field }) => (
                  <TextField select label="Expires" helperText="Expired keys stop working automatically." value={field.value} onChange={(e) => field.onChange(Number(e.target.value))}>
                    {EXPIRY_OPTIONS.map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Box>
            <TextField
              label="Rate limit (requests per minute)"
              type="number"
              error={!!errors.rateLimitPerMinute}
              helperText={errors.rateLimitPerMinute?.message ?? 'Requests over the limit receive 429 with a Retry-After header.'}
              slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
              {...form.register('rateLimitPerMinute', { valueAsNumber: true })}
            />
            <Box>
              <Controller control={form.control} name="allowedOrigins" render={({ field }) => <OriginsEditor value={field.value} onChange={field.onChange} />} />
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0 }}>
                {ORIGIN_HELP}
              </Typography>
            </Box>
            {TOKEN_TYPE_INFO[type].secret && (
              <Alert severity="warning">
                This key is a secret. Store it in your server’s environment variables or secret manager — never in browser or mobile app code.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={create.isPending}>
            Create key
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function EditKeyDialog({ token, onClose }: { token: ApiToken | null; onClose: () => void }) {
  const ws = useProject();
  const queryClient = useQueryClient();
  const form = useForm<MetaValues>({
    resolver: zodResolver(metaSchema),
    values: token ? { name: token.name, description: token.description, rateLimitPerMinute: token.rateLimitPerMinute, allowedOrigins: token.allowedOrigins } : undefined,
  });
  const { errors } = form.formState;
  const save = useMutation({
    mutationFn: (values: MetaValues) => api.patch<ApiToken>(`${ws.projectBase}/tokens/${token?.id}`, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tokens', ws.project.id] });
      toast.success('API key updated');
      onClose();
    },
    onError: (err) => applyServerErrors(err, form.setError, ['name', 'description', 'rateLimitPerMinute', 'allowedOrigins']),
  });

  return (
    <Dialog open={!!token} onClose={() => !save.isPending && onClose()} maxWidth="sm" aria-labelledby="edit-key-title" slotProps={{ transition: { onExited: () => save.reset() } }}>
      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <DialogTitle id="edit-key-title">Edit API key</DialogTitle>
        <DialogContent>
          <FormError error={save.error instanceof ApiError && Object.keys(save.error.fieldErrors).length ? null : save.error} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <TextField label="Name" autoFocus error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message} {...form.register('description')} />
            <TextField
              label="Rate limit (requests per minute)"
              type="number"
              error={!!errors.rateLimitPerMinute}
              helperText={errors.rateLimitPerMinute?.message}
              slotProps={{ htmlInput: { min: 1, max: 100000, step: 1 } }}
              {...form.register('rateLimitPerMinute', { valueAsNumber: true })}
            />
            <Box>
              <Controller control={form.control} name="allowedOrigins" render={({ field }) => <OriginsEditor value={field.value ?? []} onChange={field.onChange} />} />
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0 }}>
                {ORIGIN_HELP}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              The access level and environment of a key cannot be changed. Create a new key instead.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            Save changes
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const ws = useProject();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const schema = useSchema();
  const tokens = useTokens();
  useCrumbs([]);

  const [search, setSearch] = useState('');
  const [environment, setEnvironment] = useState('all');
  const [status, setStatus] = useState<'all' | ApiToken['status']>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ApiToken | null>(null);
  const [revealed, setRevealed] = useState<{ token: ApiToken; secret: string; rotated: boolean } | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; token: ApiToken } | null>(null);

  const ctx = useMemo(() => snippetContext(API_URL, schema.data), [schema.data]);
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tokens.data ?? []).filter(
      (t) =>
        (environment === 'all' || t.environmentId === environment) &&
        (status === 'all' || t.status === status) &&
        (!term || `${t.name} ${t.description} ${t.prefix}`.toLowerCase().includes(term)),
    );
  }, [tokens.data, search, environment, status]);

  if (!ws.can('token.manage')) return <NoAccess title="API keys" what="manage API keys" />;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['tokens', ws.project.id] });

  const rotate = async (token: ApiToken) => {
    const issued: { value: ApiToken | null } = { value: null };
    const ok = await confirm({
      title: `Rotate “${token.name}”?`,
      message: 'A new secret is issued and the current one stops working immediately. Every application using this key must be updated with the new value.',
      confirmLabel: 'Rotate key',
      onConfirm: async () => {
        issued.value = await api.post<ApiToken>(`${ws.projectBase}/tokens/${token.id}/rotate`);
      },
    });
    const next = issued.value;
    if (!ok || !next?.token) return;
    await refresh();
    setRevealed({ token: { ...token, ...next }, secret: next.token, rotated: true });
  };

  const revoke = async (token: ApiToken) => {
    const ok = await confirm({
      title: `Revoke “${token.name}”?`,
      message: 'Applications using this key lose access straight away. Revoking cannot be undone — you would need to create a new key.',
      confirmLabel: 'Revoke key',
      destructive: true,
      onConfirm: () => api.delete(`${ws.projectBase}/tokens/${token.id}`),
    });
    if (!ok) return;
    await refresh();
    toast.success('API key revoked');
  };

  const all = tokens.data ?? [];
  const filtered = search.trim() !== '' || environment !== 'all' || status !== 'all';

  return (
    <Page>
      <PageHeader
        title="API keys"
        description="Keys authenticate applications against the content delivery API. Each key belongs to one environment and is shown only once, when it is created."
        actions={
          <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
            Create API key
          </Button>
        }
      />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 4, alignItems: { md: 'center' } }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search keys…" />
        <TextField select value={environment} onChange={(e) => setEnvironment(e.target.value)} sx={{ width: { xs: '100%', md: 190 } }} slotProps={{ htmlInput: { 'aria-label': 'Filter by environment' } }}>
          <MenuItem value="all">All environments</MenuItem>
          {ws.project.environments.map((env) => (
            <MenuItem key={env.id} value={env.id}>
              {env.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} sx={{ width: { xs: '100%', md: 160 } }} slotProps={{ htmlInput: { 'aria-label': 'Filter by status' } }}>
          <MenuItem value="all">Any status</MenuItem>
          <MenuItem value="active">Active</MenuItem>
          <MenuItem value="expired">Expired</MenuItem>
          <MenuItem value="revoked">Revoked</MenuItem>
        </TextField>
        <Box sx={{ flex: 1 }} />
        {tokens.data && (
          <Typography variant="caption" color="text.secondary">
            {visible.length} of {all.length} key{all.length === 1 ? '' : 's'}
          </Typography>
        )}
      </Stack>

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        {tokens.isLoading ? (
          <TableSkeleton rows={5} columns={6} />
        ) : tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<KeyOutlined />}
            title="No API keys yet"
            description="Create a key to let a website or app read this project’s published content."
            action={
              <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
                Create API key
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState compact icon={<KeyOutlined />} title="No keys match these filters" description={filtered ? 'Try a different search, environment or status.' : undefined} />
        ) : (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Access</TableCell>
                  <TableCell>Environment</TableCell>
                  <TableCell>Key</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Last used</TableCell>
                  <TableCell align="right">Requests · 7d</TableCell>
                  <TableCell align="right">Rate limit</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell align="right" sx={{ width: 48 }}>
                    <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Actions</Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((token) => {
                  const tone = STATUS_TONE[token.status];
                  const inactive = token.status !== 'active';
                  return (
                    <TableRow key={token.id} hover sx={inactive ? { '& td': { color: 'text.disabled' } } : undefined}>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 500, color: inactive ? 'text.disabled' : 'text.primary' }}>
                          {token.name}
                        </Typography>
                        {token.description && (
                          <Typography variant="caption" color="text.secondary" noWrap component="div" title={token.description}>
                            {token.description}
                          </Typography>
                        )}
                        {token.allowedOrigins.length > 0 && (
                          <Typography variant="caption" color="text.disabled" noWrap component="div" title={token.allowedOrigins.join(', ')}>
                            Restricted to {token.allowedOrigins.length} origin{token.allowedOrigins.length === 1 ? '' : 's'}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <TokenTypePill type={token.type} />
                      </TableCell>
                      <TableCell>
                        <EnvironmentLabel environmentId={token.environmentId} />
                      </TableCell>
                      <TableCell>
                        <Mono>{token.prefix}…</Mono>
                      </TableCell>
                      <TableCell>
                        <Pill label={tone.label} fg={tone.fg} bg={tone.bg} dot />
                      </TableCell>
                      <TableCell>{token.lastUsedAt ? <RelativeTime value={token.lastUsedAt} /> : 'Never'}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {compactNumber(token.requests7d)}
                        {token.errors7d > 0 && (
                          <Typography variant="caption" color="error" component="span" sx={{ ml: 1.5 }}>
                            {compactNumber(token.errors7d)} failed
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {compactNumber(token.rateLimitPerMinute)}/min
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{token.expiresAt ? shortDate(token.expiresAt) : 'Never'}</TableCell>
                      <TableCell align="right">
                        <IconButton aria-label={`Actions for ${token.name}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchor: e.currentTarget, token })}>
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

      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 3, maxWidth: 760 }}>
        Keys are stored as a one-way hash, so nobody — including administrators — can read a key back after it is created. Access is limited by environment, allowed
        origins, rate limit and expiry; network-level IP allow-lists belong in your own gateway or firewall.
      </Typography>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem
          disabled={menu?.token.status === 'revoked'}
          onClick={() => {
            if (menu) setEditing(menu.token);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <EditOutlined />
          </ListItemIcon>
          Edit
        </MenuItem>
        <MenuItem
          disabled={menu?.token.status === 'revoked'}
          onClick={() => {
            const token = menu?.token;
            setMenu(null);
            if (token) void rotate(token);
          }}
        >
          <ListItemIcon>
            <AutorenewOutlined />
          </ListItemIcon>
          Rotate secret
        </MenuItem>
        <MenuItem
          disabled={menu?.token.status === 'revoked'}
          onClick={() => {
            const token = menu?.token;
            setMenu(null);
            if (token) void revoke(token);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <BlockOutlined />
          </ListItemIcon>
          Revoke
        </MenuItem>
      </Menu>

      <CreateKeyDialog open={creating} onClose={() => setCreating(false)} onCreated={(token) => token.token && setRevealed({ token, secret: token.token, rotated: false })} />
      <EditKeyDialog token={editing} onClose={() => setEditing(null)} />

      <SecretRevealDialog
        open={!!revealed}
        title={revealed?.rotated ? 'New secret issued' : 'API key created'}
        secret={revealed?.secret ?? ''}
        label="API key"
        warning={
          <>
            Copy this key now. For your security it is <b>shown only once</b> and cannot be retrieved later — if you lose it, rotate the key to get a new one.
          </>
        }
        onClose={() => setRevealed(null)}
      >
        {revealed && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
              Try it
            </Typography>
            <CodeBlock language="bash" code={`curl -H "Authorization: Bearer ${revealed.secret}" \\\n  "${API_URL}/api/v1/${ctx.type}?limit=5"`} />
            {TOKEN_TYPE_INFO[revealed.token.type].secret && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, mb: 0 }}>
                This is a server-side secret. Keep it out of browser bundles, mobile apps and source control.
              </Typography>
            )}
          </>
        )}
      </SecretRevealDialog>
    </Page>
  );
}
