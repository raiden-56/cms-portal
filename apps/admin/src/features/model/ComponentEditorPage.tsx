import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import LinkOffOutlined from '@mui/icons-material/LinkOffOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CardSkeleton, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, Section, SettingRow } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type { ComponentDef, SchemaResponse } from '@/lib/types';
import { toast } from '@/store';
import { SchemaEditor } from './SchemaEditor';
import { componentUsage } from './fieldModel';
import { DangerZone, SchemaHistory } from './panels';
import { IconPicker, IconTile } from './pickers';

const settingsSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a display name').max(80),
  description: z.string().trim().max(500, 'Keep the description under 500 characters'),
  category: z.string().trim().min(1, 'Enter a category').max(60),
  icon: z.string(),
  isBlock: z.boolean(),
});
type SettingsValues = z.infer<typeof settingsSchema>;

function ComponentSettings({ component, schema, canManage, usedBy }: { component: ComponentDef; schema: SchemaResponse; canManage: boolean; usedBy: string[] }) {
  const ws = useProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const defaults: SettingsValues = { displayName: component.displayName, description: component.description, category: component.category, icon: component.icon, isBlock: component.isBlock };
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: defaults });
  const { errors, isDirty } = form.formState;
  const categories = useMemo(() => [...new Set(['General', ...schema.components.map((c) => c.category)])].sort(), [schema]);
  const clashesWithBuiltin = schema.builtinBlocks.includes(component.apiId);

  useEffect(() => {
    if (!form.formState.isDirty) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [component.updatedAt]);

  const save = useMutation({
    mutationFn: (values: SettingsValues) => api.patch<ComponentDef>(`${ws.envBase}/components/${component.id}`, values),
    onSuccess: async (_, values) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      form.reset(values);
      toast.success('Settings saved');
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      for (const [path, message] of Object.entries(err.fieldErrors)) if (path in defaults) form.setError(path as keyof SettingsValues, { message });
    },
  });

  const remove = () =>
    confirm({
      title: `Delete ${component.displayName}?`,
      message: 'The component and its fields are removed from the content model. This cannot be undone.',
      confirmLabel: 'Delete component',
      destructive: true,
      onConfirm: () => api.delete(`${ws.envBase}/components/${component.id}`),
    }).then(async (deleted) => {
      if (!deleted) return;
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      toast.success(`${component.displayName} deleted`);
      navigate(ws.href('model/components'), { state: { force: true } });
    });

  const fieldError = save.error instanceof ApiError && Object.keys(save.error.fieldErrors).length > 0;
  const off = !canManage;

  return (
    <Stack spacing={4} sx={{ maxWidth: 880 }}>
      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <Stack spacing={4}>
          <Section title="General">
            <FormError error={fieldError ? null : save.error} />
            <Stack spacing={4}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Display name" disabled={off} error={!!errors.displayName} helperText={errors.displayName?.message} {...form.register('displayName')} />
                <Controller
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <Autocomplete
                      freeSolo
                      fullWidth
                      disabled={off}
                      options={categories}
                      value={field.value}
                      onInputChange={(_, next) => field.onChange(next)}
                      renderInput={(params) => <TextField {...params} label="Category" error={!!errors.category} helperText={errors.category?.message} />}
                    />
                  )}
                />
              </Stack>
              <TextField label="Description" multiline minRows={2} disabled={off} error={!!errors.description} helperText={errors.description?.message} {...form.register('description')} />
              <Controller control={form.control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} disabled={off} />} />
            </Stack>
          </Section>

          <Section title="Page builder">
            <SettingRow
              label="Offer as a page builder block"
              description={
                clashesWithBuiltin && !component.isBlock
                  ? `“${component.apiId}” is also the identifier of a built-in block, so this component cannot be offered as a block.`
                  : 'Editors can add this component to pages. Your frontend renders it by its identifier, like any built-in block.'
              }
            >
              <Controller
                control={form.control}
                name="isBlock"
                render={({ field }) => (
                  <Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={off || (clashesWithBuiltin && !component.isBlock)} slotProps={{ input: { 'aria-label': 'Offer as a page builder block' } }} />
                )}
              />
            </SettingRow>
          </Section>

          {canManage && (
            <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
              <Button onClick={() => form.reset(defaults)} disabled={!isDirty || save.isPending}>
                Reset
              </Button>
              <Button type="submit" variant="contained" disabled={!isDirty} loading={save.isPending}>
                Save settings
              </Button>
            </Stack>
          )}
        </Stack>
      </form>

      <Section title="Used by" description="Fields that include this component. It can only be deleted once nothing uses it." flush>
        {usedBy.length === 0 ? (
          <EmptyState compact icon={<LinkOffOutlined />} title="Not used yet" description="Add a component, repeatable or dynamic zone field to a content type and choose this component." />
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {usedBy.map((use) => (
              <Typography component="li" variant="body2" key={use} sx={{ px: 5, py: 2.5, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
                {use}
              </Typography>
            ))}
          </Box>
        )}
      </Section>

      {canManage && (
        <DangerZone
          title="Delete this component"
          description={usedBy.length > 0 ? 'Remove the fields listed above first — a component in use cannot be deleted.' : 'Removes the component from the content model. This cannot be undone.'}
          action={
            <Tooltip title={usedBy.length > 0 ? 'Still used by fields' : ''}>
              <span>
                <Button variant="outlined" color="error" startIcon={<DeleteOutlineOutlined />} disabled={usedBy.length > 0} onClick={() => void remove()}>
                  Delete component
                </Button>
              </span>
            </Tooltip>
          }
        />
      )}
    </Stack>
  );
}

export default function ComponentEditorPage() {
  const { componentId = '' } = useParams();
  const ws = useProject();
  const schema = useSchema();
  const queryClient = useQueryClient();
  const component = schema.data?.components.find((c) => c.id === componentId || c.apiId === componentId);
  useCrumbs(component ? [{ label: component.displayName }] : []);
  const canManage = ws.can('schema.manage');
  const usedBy = useMemo(() => (component ? componentUsage(schema.data, component.apiId) : []), [schema.data, component]);

  if (schema.isLoading) {
    return (
      <Page>
        <Box sx={{ display: 'grid', gap: 4 }} aria-busy="true">
          <CardSkeleton height={64} />
          <CardSkeleton height={360} />
        </Box>
      </Page>
    );
  }
  if (schema.isError || !schema.data) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      </Page>
    );
  }
  if (!component) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<SearchOffOutlined />}
            title="Component not found"
            description={`There is no component “${componentId}” in ${ws.environment.name}. It may have been deleted, or it may exist in another environment.`}
            action={
              <Button variant="contained" component={RouterLink} to={ws.href('model/components')}>
                All components
              </Button>
            }
          />
        </Paper>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={
          <Stack component="span" direction="row" spacing={3} sx={{ alignItems: 'center' }}>
            <IconTile name={component.icon} size={36} />
            <span>{component.displayName}</span>
          </Stack>
        }
        meta={
          <>
            <Pill label={component.category} />
            {component.isBlock && <Pill label="Page block" fg="success.dark" bg="success.light" />}
            <Tooltip title="Schema version — increases with every saved change">
              <span>
                <Pill label={`v${component.schemaVersion}`} />
              </span>
            </Tooltip>
          </>
        }
        description={
          <>
            <Mono sx={{ color: 'text.secondary' }}>{component.apiId}</Mono>
            {component.description ? ` · ${component.description}` : ''}
            <Typography component="span" variant="body2" color="text.secondary">
              {' '}
              · used by {usedBy.length} field{usedBy.length === 1 ? '' : 's'}
            </Typography>
          </>
        }
      />
      <SchemaEditor
        key={component.id}
        kind="component"
        owner={{ id: component.id, apiId: component.apiId, displayName: component.displayName }}
        savedFields={component.fields}
        schema={schema.data}
        endpoint={`${ws.envBase}/components/${component.id}/fields`}
        canManage={canManage}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['schema-changes', ws.environment.id, component.id] }))}
        extraTabs={[
          { key: 'settings', label: 'Settings', node: <ComponentSettings key={component.id} component={component} schema={schema.data} canManage={canManage} usedBy={usedBy} /> },
          { key: 'history', label: 'History', node: <SchemaHistory targetId={component.id} /> },
        ]}
      />
    </Page>
  );
}
