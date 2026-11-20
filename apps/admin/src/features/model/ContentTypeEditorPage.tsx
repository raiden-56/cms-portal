import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ApiOutlined from '@mui/icons-material/ApiOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CardSkeleton, CodeBlock, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, Section, SettingRow } from '@/components/ui';
import { API_URL, ApiError, api } from '@/lib/api';
import type { ContentType } from '@/lib/types';
import { toast } from '@/store';
import { SchemaEditor } from './SchemaEditor';
import { DangerZone, type Endpoint, EndpointList, SchemaHistory } from './panels';
import { IconPicker, IconTile } from './pickers';

const settingsSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a display name').max(80),
  singularName: z.string().trim().min(1, 'Enter the singular name').max(80),
  pluralName: z.string().trim().min(1, 'Enter the plural name').max(80),
  description: z.string().trim().max(500, 'Keep the description under 500 characters'),
  icon: z.string(),
  localized: z.boolean(),
  requireApproval: z.boolean(),
  titleField: z.string(),
  previewUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => !v || /^(https?:\/\/|\/)/.test(v), 'Start with https:// or /'),
});
type SettingsValues = z.infer<typeof settingsSchema>;

const TITLE_TYPES = ['text', 'textarea', 'slug', 'uid', 'email'];

function TypeSettings({ type, canManage }: { type: ContentType; canManage: boolean }) {
  const ws = useProject();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const defaults: SettingsValues = {
    displayName: type.displayName,
    singularName: type.singularName,
    pluralName: type.pluralName,
    description: type.description,
    icon: type.icon,
    localized: !!type.options.localized,
    requireApproval: !!type.options.requireApproval,
    titleField: type.options.titleField ?? '',
    previewUrl: type.options.previewUrl ?? '',
  };
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: defaults });
  const { errors, isDirty } = form.formState;

  // Reflect what the server stored (e.g. a renamed title field) without wiping edits in progress.
  const stamp = `${type.updatedAt}:${type.schemaVersion}`;
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const save = useMutation({
    mutationFn: (values: SettingsValues) =>
      api.patch<ContentType>(`${ws.envBase}/content-types/${type.id}`, {
        ...(type.isSystem ? {} : { displayName: values.displayName, singularName: values.singularName, pluralName: values.pluralName }),
        description: values.description,
        icon: values.icon,
        options: { localized: values.localized, requireApproval: values.requireApproval, titleField: values.titleField, previewUrl: values.previewUrl },
      }),
    onSuccess: async (_, values) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      form.reset(values);
      toast.success('Settings saved');
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      for (const [path, message] of Object.entries(err.fieldErrors)) {
        const key = path.replace(/^options\./, '');
        if (key in defaults) form.setError(key as keyof SettingsValues, { message });
      }
    },
  });

  const remove = () =>
    confirm({
      title: `Delete ${type.displayName}?`,
      message:
        type.entryCount > 0
          ? `This permanently deletes the content type and its ${type.entryCount} entr${type.entryCount === 1 ? 'y' : 'ies'}, including their version history. Connected applications will receive “not found” for /api/v1/${type.apiId}.`
          : `This permanently deletes the content type and its API endpoints (/api/v1/${type.apiId}).`,
      typeToConfirm: type.apiId,
      confirmLabel: 'Delete content type',
      destructive: true,
      onConfirm: () => api.delete(`${ws.envBase}/content-types/${type.id}`, { confirm: type.apiId }),
    }).then(async (deleted) => {
      if (!deleted) return;
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      toast.success(`${type.displayName} deleted`);
      navigate(ws.href('model/types'), { state: { force: true } });
    });

  const titleCandidates = type.fields.filter((f) => TITLE_TYPES.includes(f.type));
  const fieldError = save.error instanceof ApiError && Object.keys(save.error.fieldErrors).length > 0;
  const off = !canManage;

  return (
    <Stack spacing={4} sx={{ maxWidth: 880 }}>
      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <Stack spacing={4}>
          <Section title="General" description={type.isSystem ? 'The built-in page type keeps its name; its description, icon and options can be changed.' : undefined}>
            <FormError error={fieldError ? null : save.error} />
            <Stack spacing={4}>
              <TextField label="Display name" disabled={off || type.isSystem} error={!!errors.displayName} helperText={errors.displayName?.message} {...form.register('displayName')} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Singular name" disabled={off || type.isSystem} error={!!errors.singularName} helperText={errors.singularName?.message ?? 'Used for “New …” and GraphQL type names'} {...form.register('singularName')} />
                <TextField label="Plural name" disabled={off || type.isSystem} error={!!errors.pluralName} helperText={errors.pluralName?.message} {...form.register('pluralName')} />
              </Stack>
              <TextField label="Description" multiline minRows={2} disabled={off} error={!!errors.description} helperText={errors.description?.message} {...form.register('description')} />
              <Controller control={form.control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} disabled={off} />} />
            </Stack>
          </Section>

          <Section title="Behaviour">
            <SettingRow label="Localization" description="Allow one variant of each entry per locale. Fields marked Localized are translated; the rest are shared.">
              <Controller control={form.control} name="localized" render={({ field }) => <Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={off} slotProps={{ input: { 'aria-label': 'Localization' } }} />} />
            </SettingRow>
            <SettingRow label="Require approval" description="Entries must be submitted and approved by a reviewer before they can be published or scheduled.">
              <Controller control={form.control} name="requireApproval" render={({ field }) => <Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={off} slotProps={{ input: { 'aria-label': 'Require approval' } }} />} />
            </SettingRow>
            <SettingRow label="Title field" description="The value shown as the entry title in lists, search and relationship pickers.">
              <Controller
                control={form.control}
                name="titleField"
                render={({ field }) => (
                  <TextField select value={field.value} onChange={field.onChange} disabled={off} error={!!errors.titleField} helperText={errors.titleField?.message} sx={{ width: { xs: '100%', sm: 240 } }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Title field' } }}>
                    <MenuItem value="">
                      <Typography variant="body2" color="text.secondary">
                        Automatic — first text field
                      </Typography>
                    </MenuItem>
                    {titleCandidates.map((f) => (
                      <MenuItem key={f.apiId} value={f.apiId}>
                        {f.label}
                      </MenuItem>
                    ))}
                    {field.value && !titleCandidates.some((f) => f.apiId === field.value) && <MenuItem value={field.value}>{field.value} (missing)</MenuItem>}
                  </TextField>
                )}
              />
            </SettingRow>
          </Section>

          <Section title="Preview" description="Where editors are sent when they preview an unpublished entry in your frontend.">
            <TextField
              label="Preview URL template"
              disabled={off}
              placeholder="https://www.example.com/api/preview?token={token}&slug={slug}"
              error={!!errors.previewUrl}
              helperText={errors.previewUrl?.message ?? 'Placeholders: {token} (signed, expires in an hour), {id}, {slug}, {path}, {locale}, {type}. Leave empty to use the project default.'}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { spellCheck: false } }}
              {...form.register('previewUrl')}
            />
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

      {canManage && !type.isSystem && (
        <DangerZone
          title="Delete this content type"
          description={
            type.entryCount > 0
              ? `Removes the type, its ${type.entryCount} entr${type.entryCount === 1 ? 'y' : 'ies'} and their history. This cannot be undone.`
              : 'Removes the type and its API endpoints. This cannot be undone.'
          }
          action={
            <Button variant="outlined" color="error" startIcon={<DeleteOutlineOutlined />} onClick={() => void remove()}>
              Delete content type
            </Button>
          }
        />
      )}
    </Stack>
  );
}

function ApiPanel({ type }: { type: ContentType }) {
  const ws = useProject();
  const base = `${API_URL}/api/v1`;
  const read = 'any API key';
  const write = 'read/write key';
  const endpoints: Endpoint[] =
    type.kind === 'SINGLE'
      ? [
          { method: 'GET', path: `/${type.apiId}`, description: `Read ${type.displayName}`, access: read },
          { method: 'POST', path: `/${type.apiId}`, description: 'Create the entry', access: write },
          { method: 'PATCH', path: `/${type.apiId}/{id}`, description: 'Change some fields', access: write },
          { method: 'POST', path: `/${type.apiId}/{id}/publish`, description: 'Publish', access: write },
        ]
      : [
          { method: 'GET', path: `/${type.apiId}`, description: `List ${type.pluralName.toLowerCase()} with filters, sorting and pagination`, access: read },
          { method: 'GET', path: `/${type.apiId}/{id-or-slug}`, description: `Read one ${type.singularName.toLowerCase()}`, access: read },
          ...(type.isSystem
            ? [{ method: 'GET' as const, path: `/${type.apiId}?path=/about`, description: 'Resolve a page by its URL path', access: read }]
            : [
                { method: 'POST' as const, path: `/${type.apiId}`, description: `Create a ${type.singularName.toLowerCase()}`, access: write },
                { method: 'PUT' as const, path: `/${type.apiId}/{id}`, description: 'Replace all fields', access: write },
                { method: 'PATCH' as const, path: `/${type.apiId}/{id}`, description: 'Change some fields', access: write },
                { method: 'DELETE' as const, path: `/${type.apiId}/{id}`, description: 'Move to trash', access: write },
                { method: 'POST' as const, path: `/${type.apiId}/{id}/publish`, description: 'Publish', access: write },
                { method: 'POST' as const, path: `/${type.apiId}/{id}/unpublish`, description: 'Unpublish', access: write },
              ]),
        ];
  const sortable = type.fields.find((f) => ['text', 'integer', 'decimal', 'date', 'datetime'].includes(f.type) && !f.config.private);
  const relation = type.fields.find((f) => f.type === 'relation' || f.type === 'relations');
  const query = type.kind === 'SINGLE' ? '' : `?limit=10${sortable ? `&sort=${sortable.apiId}` : ''}${relation ? `&populate=${relation.apiId}` : ''}`;
  const curl = `curl "${base}/${type.apiId}${query}" \\\n  -H "Authorization: Bearer $MERIDIAN_API_KEY"`;

  return (
    <Stack spacing={4} sx={{ maxWidth: 980 }}>
      <Section
        flush
        title="REST endpoints"
        description="Generated from this content type. Responses contain published content only, unless a preview or read/write key asks for drafts."
        action={
          <Button size="small" variant="outlined" startIcon={<ApiOutlined />} component={RouterLink} to={`${ws.href('dev/explorer')}?type=${type.apiId}`}>
            Open in API Explorer
          </Button>
        }
      >
        <EndpointList endpoints={endpoints} baseUrl={base} />
      </Section>
      <Section title="Try it" description="Create a key under Developers → API Keys, then:">
        <CodeBlock code={curl} language="bash" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          The same content is available through GraphQL at <Mono>POST {base}/graphql</Mono>. Private fields and secrets are never part of either API.
        </Typography>
      </Section>
    </Stack>
  );
}

export default function ContentTypeEditorPage() {
  const { typeId = '' } = useParams();
  const ws = useProject();
  const schema = useSchema();
  const queryClient = useQueryClient();
  const type = schema.data?.types.find((t) => t.id === typeId || t.apiId === typeId);
  useCrumbs(type ? [{ label: type.displayName }] : []);
  const canManage = ws.can('schema.manage');

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
  if (!type) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<SearchOffOutlined />}
            title="Content type not found"
            description={`There is no content type “${typeId}” in ${ws.environment.name}. It may have been deleted, or it may exist in another environment.`}
            action={
              <Button variant="contained" component={RouterLink} to={ws.href('model/types')}>
                All content types
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
            <IconTile name={type.icon} size={36} />
            <span>{type.displayName}</span>
          </Stack>
        }
        meta={
          <>
            <Pill label={type.kind === 'SINGLE' ? 'Single' : 'Collection'} />
            {type.isSystem && <Pill label="Built-in" />}
            <Tooltip title="Schema version — increases with every saved change">
              <span>
                <Pill label={`v${type.schemaVersion}`} />
              </span>
            </Tooltip>
          </>
        }
        description={
          <>
            <Mono sx={{ color: 'text.secondary' }}>{type.apiId}</Mono>
            {type.description ? ` · ${type.description}` : ''}
          </>
        }
        actions={
          ws.can('content.read') && (
            <Button variant="outlined" startIcon={<ArticleOutlined />} component={RouterLink} to={type.isSystem ? ws.href('pages') : ws.href(`content/${type.apiId}`)}>
              {type.isSystem ? 'Open pages' : `View ${type.entryCount} entr${type.entryCount === 1 ? 'y' : 'ies'}`}
            </Button>
          )
        }
      />
      <SchemaEditor
        key={type.id}
        kind="type"
        owner={{ id: type.id, apiId: type.apiId, displayName: type.displayName }}
        savedFields={type.fields}
        schema={schema.data}
        endpoint={`${ws.envBase}/content-types/${type.id}/fields`}
        canManage={canManage}
        lockedReason={type.isSystem ? 'Pages have a fixed schema: title, URL, SEO and a tree of blocks. To extend what pages can contain, create a component and offer it as a page builder block.' : undefined}
        titleField={type.options.titleField}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['schema-changes', ws.environment.id, type.id] }))}
        extraTabs={[
          { key: 'settings', label: 'Settings', node: <TypeSettings key={type.id} type={type} canManage={canManage} /> },
          { key: 'api', label: 'API', node: <ApiPanel type={type} /> },
          { key: 'history', label: 'History', node: <SchemaHistory targetId={type.id} /> },
        ]}
      />
    </Page>
  );
}
