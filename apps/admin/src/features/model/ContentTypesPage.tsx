import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import SchemaOutlined from '@mui/icons-material/SchemaOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { RESERVED_TYPE_IDS, TYPE_API_ID_PATTERN, pluralize, slugify } from '@meridian/shared';
import { useProject, useSchema } from '@/app/workspace';
import { EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput, TableSkeleton } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { compactNumber } from '@/lib/format';
import type { ContentType } from '@/lib/types';
import { toast } from '@/store';
import { singularize } from './fieldModel';
import { IconPicker, IconTile } from './pickers';

const createSchema = (taken: string[]) =>
  z.object({
    displayName: z.string().trim().min(1, 'Give the content type a name').max(80),
    apiId: z
      .string()
      .trim()
      .regex(TYPE_API_ID_PATTERN, 'Use lowercase letters, numbers and hyphens, starting with a letter')
      .refine((v) => !RESERVED_TYPE_IDS.includes(v), 'That identifier is reserved by the API')
      .refine((v) => !taken.includes(v), 'Another content type already uses this identifier'),
    singularName: z.string().trim().min(1, 'Enter the singular name').max(80),
    pluralName: z.string().trim().min(1, 'Enter the plural name').max(80),
    kind: z.enum(['COLLECTION', 'SINGLE']),
    icon: z.string(),
    description: z.string().trim().max(500, 'Keep the description under 500 characters'),
  });
type CreateValues = z.infer<ReturnType<typeof createSchema>>;

const KINDS = [
  { value: 'COLLECTION', title: 'Collection', body: 'Many entries of the same shape — articles, products, authors.' },
  { value: 'SINGLE', title: 'Single', body: 'Exactly one entry — site settings, a homepage, a footer.' },
] as const;

function CreateTypeDialog({ open, onClose, taken }: { open: boolean; onClose: () => void; taken: string[] }) {
  const ws = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const schema = useMemo(() => createSchema(taken), [taken]);
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', apiId: '', singularName: '', pluralName: '', kind: 'COLLECTION', icon: 'document', description: '' },
  });
  const { errors, dirtyFields } = form.formState;
  const kind = form.watch('kind');

  /** Names and the identifier follow the display name until they are edited by hand. */
  const derive = (name: string, nextKind: CreateValues['kind']) => {
    const trimmed = name.trim();
    const singular = nextKind === 'SINGLE' ? trimmed : singularize(trimmed);
    const plural = nextKind === 'SINGLE' ? trimmed : singular === trimmed ? pluralize(trimmed) : trimmed;
    if (!dirtyFields.singularName) form.setValue('singularName', singular);
    if (!dirtyFields.pluralName) form.setValue('pluralName', plural);
    if (!dirtyFields.apiId) form.setValue('apiId', slugify(nextKind === 'SINGLE' ? trimmed : plural, 62), { shouldValidate: form.formState.isSubmitted });
  };

  const create = useMutation({
    mutationFn: (values: CreateValues) => api.post<ContentType>(`${ws.envBase}/content-types`, { ...values, options: {}, fields: [] }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      toast.success(`${created.displayName} created — now add its fields`);
      onClose();
      navigate(ws.href(`model/types/${created.apiId}`));
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      for (const [path, message] of Object.entries(err.fieldErrors)) {
        if (path in form.getValues()) form.setError(path as keyof CreateValues, { message });
      }
      if (err.status === 409) form.setError('apiId', { message: err.message });
    },
  });
  const unmapped = create.error instanceof ApiError && (create.error.status === 409 || Object.keys(create.error.fieldErrors).length > 0) ? null : create.error;

  return (
    <Dialog
      open={open}
      onClose={() => !create.isPending && onClose()}
      aria-labelledby="create-type-title"
      slotProps={{ transition: { onExited: () => { form.reset(); create.reset(); } } }}
    >
      <form noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <DialogTitle id="create-type-title">New content type</DialogTitle>
        <DialogContent>
          <FormError error={unmapped} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <Box role="radiogroup" aria-label="Kind" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              {KINDS.map((option) => {
                const selected = kind === option.value;
                return (
                  <ButtonBase
                    key={option.value}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      form.setValue('kind', option.value);
                      derive(form.getValues('displayName'), option.value);
                    }}
                    sx={{ p: 3, borderRadius: '8px', border: 1, borderColor: selected ? 'secondary.main' : 'border.strong', bgcolor: selected ? 'action.selected' : 'transparent', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', gap: 0.5, transition: 'border-color 120ms, background-color 120ms' }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {option.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.body}
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Box>
            <TextField
              label="Display name"
              autoFocus
              placeholder={kind === 'SINGLE' ? 'Site settings' : 'Articles'}
              error={!!errors.displayName}
              helperText={errors.displayName?.message ?? 'Shown in the navigation and in lists'}
              {...form.register('displayName', { onChange: (e) => derive(e.target.value, form.getValues('kind')) })}
            />
            <TextField
              label="API identifier"
              error={!!errors.apiId}
              helperText={errors.apiId?.message ?? `Content is served at /api/v1/${form.watch('apiId') || '…'}. This cannot be changed later.`}
              slotProps={{ htmlInput: { spellCheck: false }, input: { sx: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }, inputLabel: { shrink: true } }}
              {...form.register('apiId')}
            />
            {kind === 'COLLECTION' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Singular name" placeholder="Article" error={!!errors.singularName} helperText={errors.singularName?.message} slotProps={{ inputLabel: { shrink: true } }} {...form.register('singularName')} />
                <TextField label="Plural name" placeholder="Articles" error={!!errors.pluralName} helperText={errors.pluralName?.message} slotProps={{ inputLabel: { shrink: true } }} {...form.register('pluralName')} />
              </Stack>
            )}
            <Controller control={form.control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} />} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message ?? 'Optional. Helps editors know what belongs here.'} {...form.register('description')} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={create.isPending}>
            Create and add fields
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function ContentTypesPage() {
  const ws = useProject();
  const schema = useSchema();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const canManage = ws.can('schema.manage');

  // Deep link from the dashboard and the command palette: …/model/types?new=1
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canManage) setCreating(true);
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, canManage]);

  const types = schema.data?.types ?? [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? types.filter((t) => `${t.displayName} ${t.apiId} ${t.description}`.toLowerCase().includes(q)) : types;
  }, [types, search]);
  const custom = types.filter((t) => !t.isSystem);

  const newButton = canManage ? (
    <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
      New content type
    </Button>
  ) : (
    <Tooltip title="You need permission to change the content model">
      <span>
        <Button variant="contained" startIcon={<AddOutlined />} disabled>
          New content type
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Page>
      <PageHeader
        title="Content types"
        description={`The shapes of content in ${ws.project.name} · ${ws.environment.name}. Each type gets its own form, list and API endpoints.`}
        actions={newButton}
      />

      {schema.isLoading ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <TableSkeleton rows={6} columns={5} />
        </Paper>
      ) : schema.isError ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      ) : (
        <>
          {custom.length === 0 && (
            <Paper sx={{ borderRadius: '10px', mb: 4 }}>
              <EmptyState
                icon={<SchemaOutlined />}
                title="Model your first content type"
                description="A content type describes one kind of content — its fields, validation and relationships. Create one and Meridian generates the editing form and the REST and GraphQL endpoints for it."
                action={canManage ? newButton : undefined}
              />
            </Paper>
          )}
          <Stack direction="row" sx={{ mb: 3, alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search content types…" />
            <Typography variant="caption" color="text.secondary">
              {custom.length} custom type{custom.length === 1 ? '' : 's'} · 1 built-in
            </Typography>
          </Stack>
          <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
            {visible.length === 0 ? (
              <EmptyState compact icon={<SearchOffOutlined />} title="No content type matches" description={`Nothing matches “${search.trim()}”.`} />
            ) : (
              <TableContainer>
                <Table aria-label="Content types">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>API identifier</TableCell>
                      <TableCell>Kind</TableCell>
                      <TableCell align="right">Fields</TableCell>
                      <TableCell align="right">Entries</TableCell>
                      <TableCell>Updated</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((type) => {
                      const to = type.isSystem ? ws.href('pages') : ws.href(`model/types/${type.apiId}`);
                      return (
                        <TableRow
                          key={type.id}
                          hover
                          tabIndex={0}
                          onClick={() => navigate(to)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') navigate(to);
                          }}
                          sx={{ cursor: 'pointer' }}
                        >
                          <TableCell sx={{ minWidth: 260 }}>
                            <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
                              <IconTile name={type.icon} />
                              <Box sx={{ minWidth: 0 }}>
                                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                                  <Typography variant="subtitle2" component={RouterLink} to={to} onClick={(e) => e.stopPropagation()} sx={{ fontWeight: 600, color: 'text.primary' }}>
                                    {type.displayName}
                                  </Typography>
                                  {type.isSystem && <Pill label="Built-in" title="Managed by the page builder. Its schema is fixed." />}
                                  {type.options.localized && <Pill label="Localized" />}
                                  {type.options.requireApproval && <Pill label="Approval" fg="info.dark" bg="info.light" title="Entries must be approved before publishing" />}
                                </Stack>
                                <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ maxWidth: 420 }}>
                                  {type.isSystem ? 'Website pages composed in the page builder' : type.description || `${type.singularName} entries`}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Mono sx={{ color: 'text.secondary' }}>{type.apiId}</Mono>
                          </TableCell>
                          <TableCell>
                            <Pill label={type.kind === 'SINGLE' ? 'Single' : 'Collection'} />
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {type.fields.length}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {compactNumber(type.entryCount)}
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            <RelativeTime value={type.updatedAt} />
                          </TableCell>
                          <TableCell padding="checkbox" sx={{ pr: 3 }}>
                            <ChevronRightOutlined sx={{ fontSize: 18, color: 'text.disabled', display: 'block' }} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </>
      )}

      <CreateTypeDialog open={creating} onClose={() => setCreating(false)} taken={types.map((t) => t.apiId)} />
    </Page>
  );
}
