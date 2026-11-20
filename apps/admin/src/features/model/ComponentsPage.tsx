import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
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
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { RESERVED_TYPE_IDS, TYPE_API_ID_PATTERN, slugify } from '@meridian/shared';
import { useProject, useSchema } from '@/app/workspace';
import { EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput, SettingRow, TableSkeleton } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type { ComponentDef, SchemaResponse } from '@/lib/types';
import { toast } from '@/store';
import { componentUsage } from './fieldModel';
import { IconPicker, IconTile } from './pickers';

const createSchema = (taken: string[], builtinBlocks: string[]) =>
  z
    .object({
      displayName: z.string().trim().min(1, 'Give the component a name').max(80),
      apiId: z
        .string()
        .trim()
        .regex(TYPE_API_ID_PATTERN, 'Use lowercase letters, numbers and hyphens, starting with a letter')
        .refine((v) => !RESERVED_TYPE_IDS.includes(v), 'That identifier is reserved')
        .refine((v) => !taken.includes(v), 'Another component already uses this identifier'),
      category: z.string().trim().min(1, 'Enter a category').max(60),
      icon: z.string(),
      description: z.string().trim().max(500, 'Keep the description under 500 characters'),
      isBlock: z.boolean(),
    })
    .refine((v) => !(v.isBlock && builtinBlocks.includes(v.apiId)), { path: ['apiId'], message: 'A built-in page block already uses this identifier. Choose another.' });
type CreateValues = z.infer<ReturnType<typeof createSchema>>;

function CreateComponentDialog({ open, onClose, schema }: { open: boolean; onClose: () => void; schema: SchemaResponse | undefined }) {
  const ws = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const taken = useMemo(() => (schema?.components ?? []).map((c) => c.apiId), [schema]);
  const categories = useMemo(() => [...new Set(['General', ...(schema?.components ?? []).map((c) => c.category)])].sort(), [schema]);
  const validation = useMemo(() => createSchema(taken, schema?.builtinBlocks ?? []), [taken, schema]);
  const form = useForm<CreateValues>({ resolver: zodResolver(validation), defaultValues: { displayName: '', apiId: '', category: 'General', icon: 'component', description: '', isBlock: false } });
  const { errors, dirtyFields } = form.formState;

  const create = useMutation({
    mutationFn: (values: CreateValues) => api.post<ComponentDef>(`${ws.envBase}/components`, { ...values, fields: [] }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      toast.success(`${created.displayName} created — now add its fields`);
      onClose();
      navigate(ws.href(`model/components/${created.apiId}`));
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      for (const [path, message] of Object.entries(err.fieldErrors)) if (path in form.getValues()) form.setError(path as keyof CreateValues, { message });
      if (err.status === 409) form.setError('apiId', { message: err.message });
    },
  });
  const unmapped = create.error instanceof ApiError && (create.error.status === 409 || Object.keys(create.error.fieldErrors).length > 0) ? null : create.error;

  return (
    <Dialog open={open} onClose={() => !create.isPending && onClose()} aria-labelledby="create-component-title" slotProps={{ transition: { onExited: () => { form.reset(); create.reset(); } } }}>
      <form noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <DialogTitle id="create-component-title">New component</DialogTitle>
        <DialogContent>
          <FormError error={unmapped} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <TextField
              label="Display name"
              autoFocus
              placeholder="Call to action"
              error={!!errors.displayName}
              helperText={errors.displayName?.message}
              {...form.register('displayName', {
                onChange: (e) => {
                  if (!dirtyFields.apiId) form.setValue('apiId', slugify(e.target.value, 62), { shouldValidate: form.formState.isSubmitted });
                },
              })}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="API identifier"
                error={!!errors.apiId}
                helperText={errors.apiId?.message ?? 'Stored with content. Cannot be changed later.'}
                slotProps={{ htmlInput: { spellCheck: false }, input: { sx: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }, inputLabel: { shrink: true } }}
                {...form.register('apiId')}
              />
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Autocomplete
                    freeSolo
                    fullWidth
                    options={categories}
                    value={field.value}
                    onInputChange={(_, next) => field.onChange(next)}
                    renderInput={(params) => <TextField {...params} label="Category" error={!!errors.category} helperText={errors.category?.message ?? 'Groups components in pickers'} />}
                  />
                )}
              />
            </Stack>
            <Controller control={form.control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} />} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message ?? 'Optional. Tells editors when to use it.'} {...form.register('description')} />
            <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', px: 3.5 }}>
              <SettingRow label="Offer as a page builder block" description="Editors can add this component to pages, next to the built-in blocks.">
                <Controller control={form.control} name="isBlock" render={({ field }) => <Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} slotProps={{ input: { 'aria-label': 'Offer as a page builder block' } }} />} />
              </SettingRow>
            </Box>
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

export default function ComponentsPage() {
  const ws = useProject();
  const schema = useSchema();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const canManage = ws.can('schema.manage');

  const components = schema.data?.components ?? [];
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? components.filter((c) => `${c.displayName} ${c.apiId} ${c.category} ${c.description}`.toLowerCase().includes(q)) : components;
  }, [components, search]);

  const newButton = canManage ? (
    <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
      New component
    </Button>
  ) : (
    <Tooltip title="You need permission to change the content model">
      <span>
        <Button variant="contained" startIcon={<AddOutlined />} disabled>
          New component
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Page>
      <PageHeader
        title="Components"
        description="Reusable groups of fields. Use them inside content types — once, repeated, or mixed in a dynamic zone — or offer them as blocks in the page builder."
        actions={newButton}
      />

      {schema.isLoading ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <TableSkeleton rows={5} columns={5} />
        </Paper>
      ) : schema.isError ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      ) : components.length === 0 ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<ExtensionOutlined />}
            title="No components yet"
            description="Define a group of fields once — an SEO block, a call to action, an address — and reuse it across content types and pages. Changing the component updates every place it is used."
            action={canManage ? newButton : undefined}
          />
        </Paper>
      ) : (
        <>
          <Stack direction="row" sx={{ mb: 3, alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search components…" />
            <Typography variant="caption" color="text.secondary">
              {components.length} component{components.length === 1 ? '' : 's'} · {components.filter((c) => c.isBlock).length} offered as page blocks
            </Typography>
          </Stack>
          <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
            {visible.length === 0 ? (
              <EmptyState compact icon={<SearchOffOutlined />} title="No component matches" description={`Nothing matches “${search.trim()}”.`} />
            ) : (
              <TableContainer>
                <Table aria-label="Components">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>API identifier</TableCell>
                      <TableCell>Category</TableCell>
                      <TableCell align="right">Fields</TableCell>
                      <TableCell align="right">Used in</TableCell>
                      <TableCell>Updated</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map((component) => {
                      const to = ws.href(`model/components/${component.apiId}`);
                      const usage = componentUsage(schema.data, component.apiId);
                      return (
                        <TableRow
                          key={component.id}
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
                              <IconTile name={component.icon} />
                              <Box sx={{ minWidth: 0 }}>
                                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                                  <Typography variant="subtitle2" component={RouterLink} to={to} onClick={(e) => e.stopPropagation()} sx={{ fontWeight: 600, color: 'text.primary' }}>
                                    {component.displayName}
                                  </Typography>
                                  {component.isBlock && <Pill label="Page block" fg="success.dark" bg="success.light" title="Available in the page builder" />}
                                </Stack>
                                {component.description && (
                                  <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ maxWidth: 420 }}>
                                    {component.description}
                                  </Typography>
                                )}
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Mono sx={{ color: 'text.secondary' }}>{component.apiId}</Mono>
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>{component.category}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            {component.fields.length}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                            <Tooltip title={usage.length ? usage.join(' · ') : 'Not used by any field yet'}>
                              <span>{usage.length}</span>
                            </Tooltip>
                          </TableCell>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            <RelativeTime value={component.updatedAt} />
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

      <CreateComponentDialog open={creating} onClose={() => setCreating(false)} schema={schema.data} />
    </Page>
  );
}
