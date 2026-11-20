import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FolderOffOutlined from '@mui/icons-material/FolderOffOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import TranslateOutlined from '@mui/icons-material/TranslateOutlined';
import { formatBytes } from '@meridian/shared';
import { ENVIRONMENT_TONES } from '@/app/nav';
import { useWorkspace } from '@/app/workspace';
import { StatTile } from '@/components/charts';
import { useConfirm } from '@/components/feedback';
import { IconFor, SELECTABLE_ICONS } from '@/components/icons';
import { CopyButton, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, Section, SettingRow, TableSkeleton } from '@/components/ui';
import { ApiError, type AuthPayload, api } from '@/lib/api';
import { compactNumber } from '@/lib/format';
import type { Locale, Project } from '@/lib/types';
import { setTableDensity, signedIn, toast, toggleSidebar, useAppDispatch, useAppSelector } from '@/store';

const TABS = ['organization', 'project', 'environments', 'locales', 'appearance'] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABELS: Record<TabKey, string> = { organization: 'Organization', project: 'Project', environments: 'Environments', locales: 'Locales', appearance: 'Appearance' };

const HEX = /^#[0-9a-fA-F]{6}$/;
const SWATCHES = ['#1F6F5C', '#2F7D5B', '#4A6B85', '#35506A', '#8A5A2B', '#B4721A', '#B4443C', '#6B5B7B', '#3A3A37', '#1F1F1D'];
const DATE_FORMATS = ['d MMM yyyy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd'];

/** Applies server-side field errors to a form; returns true when every error was placed on a field. */
function placeErrors(err: unknown, setError: (name: never, error: { message: string }) => void, fields: string[]): boolean {
  if (!(err instanceof ApiError)) return false;
  const entries = Object.entries(err.fieldErrors);
  for (const [path, message] of entries) if (fields.includes(path)) setError(path as never, { message });
  return entries.length > 0 && entries.every(([path]) => fields.includes(path));
}

function ColorField({ value, onChange, disabled, error, helperText, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; error?: boolean; helperText?: string; label: string }) {
  return (
    <Box>
      <TextField
        label={label}
        value={value}
        disabled={disabled}
        error={error}
        helperText={helperText}
        onChange={(e) => onChange(e.target.value)}
        sx={{ maxWidth: 220 }}
        slotProps={{
          htmlInput: { maxLength: 7, spellCheck: false },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Box sx={{ width: 16, height: 16, borderRadius: '4px', bgcolor: HEX.test(value) ? value : 'transparent', border: 1, borderColor: 'border.strong' }} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Stack direction="row" role="radiogroup" aria-label={`${label} presets`} sx={{ flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
        {SWATCHES.map((color) => {
          const selected = value.toLowerCase() === color.toLowerCase();
          return (
            <ButtonBase
              key={color}
              role="radio"
              aria-checked={selected}
              aria-label={color}
              disabled={disabled}
              onClick={() => onChange(color)}
              sx={{ width: 24, height: 24, borderRadius: '7px', bgcolor: color, outline: selected ? '2px solid' : 'none', outlineColor: 'secondary.main', outlineOffset: 2, opacity: disabled ? 0.5 : 1 }}
            />
          );
        })}
      </Stack>
    </Box>
  );
}

// ─── Organization ────────────────────────────────────────────────────────────

interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  settings: { dateFormat?: string; timeFormat?: '12h' | '24h'; brandColor?: string; maxProjects?: number };
  createdAt: string;
  usage: { members: number; projects: number; entries: number; mediaAssets: number; storageBytes: number };
}

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
  slug: z
    .string()
    .trim()
    .min(2, 'Enter at least 2 characters')
    .max(48, 'Keep it under 48 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens'),
  dateFormat: z.string().min(1),
  timeFormat: z.enum(['24h', '12h']),
  brandColor: z.string().regex(HEX, 'Use a hex color such as #1F6F5C'),
});
type OrgValues = z.infer<typeof orgSchema>;

function OrganizationTab() {
  const ws = useWorkspace();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const canManage = ws.can('org.manage');
  const now = new Date();

  const org = useQuery({ queryKey: ['organization', ws.org.id], queryFn: () => api.get<OrganizationDetail>(ws.orgBase) });
  const form = useForm<OrgValues>({ resolver: zodResolver(orgSchema), defaultValues: { name: ws.org.name, slug: ws.org.slug, dateFormat: DATE_FORMATS[0], timeFormat: '24h', brandColor: '#1F6F5C' } });
  const { errors, isDirty } = form.formState;

  useEffect(() => {
    if (!org.data) return;
    form.reset({
      name: org.data.name,
      slug: org.data.slug,
      dateFormat: org.data.settings.dateFormat ?? DATE_FORMATS[0],
      timeFormat: org.data.settings.timeFormat ?? '24h',
      brandColor: org.data.settings.brandColor ?? '#1F6F5C',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.data]);

  const save = useMutation({
    mutationFn: (values: OrgValues) =>
      api.patch<OrganizationDetail>(ws.orgBase, {
        name: values.name,
        ...(values.slug !== org.data?.slug ? { slug: values.slug } : {}),
        settings: { dateFormat: values.dateFormat, timeFormat: values.timeFormat, brandColor: values.brandColor },
      }),
    onSuccess: async (updated) => {
      if (updated.slug !== ws.org.slug) {
        // Every in-app address contains the organization URL, so start again from the new one.
        window.location.assign(`/w/${updated.slug}/admin/settings?tab=organization`);
        return;
      }
      toast.success('Organization settings saved');
      const profile = await api.get<Pick<AuthPayload, 'user' | 'memberships'>>('/auth/me');
      dispatch(signedIn(profile));
      await queryClient.invalidateQueries({ queryKey: ['organization', ws.org.id] });
    },
    onError: (err) => placeErrors(err, form.setError as never, ['name', 'slug']),
  });
  const unplaced = save.error && !(save.error instanceof ApiError && Object.keys(save.error.fieldErrors).some((p) => ['name', 'slug'].includes(p))) ? save.error : null;
  const slug = form.watch('slug');
  const slugChanged = !!org.data && slug !== org.data.slug;

  if (org.isLoading) {
    return (
      <Stack spacing={5} aria-busy="true">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 3 }}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={84} sx={{ borderRadius: '10px' }} />
          ))}
        </Box>
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: '10px' }} />
      </Stack>
    );
  }
  if (org.isError || !org.data) {
    return (
      <Paper sx={{ borderRadius: '10px' }}>
        <ErrorState error={org.error} onRetry={() => void org.refetch()} />
      </Paper>
    );
  }
  const usage = org.data.usage;
  const limit = org.data.settings.maxProjects;

  return (
    <Stack spacing={5}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 3 }}>
        <StatTile label="Members" value={compactNumber(usage.members)} />
        <StatTile label="Projects" value={compactNumber(usage.projects)} hint={limit ? `Limit of ${limit}` : undefined} />
        <StatTile label="Entries and pages" value={compactNumber(usage.entries)} />
        <StatTile label="Media assets" value={compactNumber(usage.mediaAssets)} />
        <StatTile label="Storage used" value={formatBytes(usage.storageBytes)} />
      </Box>

      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <Section title="Profile" description={canManage ? 'How this organization is named and addressed.' : 'Only organization administrators can change these settings.'}>
          <FormError error={unplaced} />
          <Stack spacing={4} sx={{ maxWidth: 560 }}>
            <TextField label="Organization name" disabled={!canManage} error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
            <TextField
              label="URL"
              disabled={!canManage}
              error={!!errors.slug}
              helperText={errors.slug?.message ?? (slugChanged ? 'Changing the URL breaks existing links and bookmarks to this organization. The page reloads after saving.' : 'Appears in every address inside this organization.')}
              slotProps={{ htmlInput: { spellCheck: false }, input: { startAdornment: <InputAdornment position="start">{window.location.host}/w/</InputAdornment> } }}
              {...form.register('slug')}
            />
          </Stack>
        </Section>

        <Section title="Regional and brand preferences" description="The organization's preferred formats and brand color." sx={{ mt: 5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, maxWidth: 720 }}>
            <Controller
              control={form.control}
              name="dateFormat"
              render={({ field }) => (
                <TextField select label="Date format" disabled={!canManage} {...field}>
                  {DATE_FORMATS.map((pattern) => (
                    <MenuItem key={pattern} value={pattern}>
                      {format(now, pattern)}
                      <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', pl: 4, fontFamily: 'monospace' }}>
                        {pattern}
                      </Typography>
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <Controller
              control={form.control}
              name="timeFormat"
              render={({ field }) => (
                <TextField select label="Time format" disabled={!canManage} {...field}>
                  <MenuItem value="24h">24-hour · {format(now, 'HH:mm')}</MenuItem>
                  <MenuItem value="12h">12-hour · {format(now, 'h:mm a')}</MenuItem>
                </TextField>
              )}
            />
            <Controller control={form.control} name="brandColor" render={({ field }) => <ColorField label="Brand color" value={field.value} onChange={field.onChange} disabled={!canManage} error={!!errors.brandColor} helperText={errors.brandColor?.message} />} />
          </Box>
        </Section>

        {canManage && (
          <Stack direction="row" spacing={2} sx={{ mt: 4, justifyContent: 'flex-end' }}>
            <Button disabled={!isDirty || save.isPending} onClick={() => form.reset()}>
              Discard
            </Button>
            <Button type="submit" variant="contained" disabled={!isDirty} loading={save.isPending}>
              Save changes
            </Button>
          </Stack>
        )}
      </form>
    </Stack>
  );
}

// ─── Project ─────────────────────────────────────────────────────────────────

function ProjectPicker({ project, onChange }: { project: Project; onChange: (id: string) => void }) {
  const ws = useWorkspace();
  return (
    <TextField select label="Project" value={project.id} onChange={(e) => onChange(e.target.value)} sx={{ width: { xs: '100%', sm: 320 }, mb: 5 }}>
      {ws.projects.map((p) => (
        <MenuItem key={p.id} value={p.id}>
          <Box sx={{ width: 18, height: 18, borderRadius: '5px', bgcolor: p.color, color: '#fff', display: 'grid', placeItems: 'center', '& svg': { fontSize: 12 } }}>
            <IconFor name={p.icon} />
          </Box>
          {p.name}
          {p.id === ws.project?.id && (
            <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', pl: 3 }}>
              Current
            </Typography>
          )}
        </MenuItem>
      ))}
    </TextField>
  );
}

const optionalUrl = z
  .string()
  .trim()
  .max(500, 'Keep it under 500 characters')
  .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'Enter a full address starting with http:// or https://');

const projectSchema = z.object({
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(80),
  description: z.string().trim().max(400, 'Keep it under 400 characters'),
  icon: z.string().min(1),
  color: z.string().regex(HEX, 'Use a hex color such as #1F6F5C'),
  siteUrl: optionalUrl,
  previewUrl: optionalUrl,
});
type ProjectValues = z.infer<typeof projectSchema>;

const PLACEHOLDERS: [string, string][] = [
  ['{token}', 'Short-lived preview token'],
  ['{path}', 'Page path, e.g. /about/team'],
  ['{slug}', 'Entry or page slug'],
  ['{id}', 'Document id'],
  ['{locale}', 'Locale code'],
  ['{type}', 'Content type identifier'],
];

const projectDefaults = (project: Project): ProjectValues => ({
  name: project.name,
  description: project.description,
  icon: project.icon,
  color: project.color,
  siteUrl: project.settings.siteUrl ?? '',
  previewUrl: project.settings.previewUrl ?? '',
});

function ProjectTab({ project }: { project: Project }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const canEdit = ws.can('project.update');
  const form = useForm<ProjectValues>({ resolver: zodResolver(projectSchema), defaultValues: projectDefaults(project) });
  const { errors, isDirty } = form.formState;
  const fields = ['name', 'description', 'icon', 'color'];
  // Discarding remounts the inputs so cleared fields return to their resting state.
  const [formKey, setFormKey] = useState(0);

  const save = useMutation({
    mutationFn: (values: ProjectValues) =>
      api.patch<Project>(`/projects/${project.id}`, { name: values.name, description: values.description, icon: values.icon, color: values.color, settings: { siteUrl: values.siteUrl, previewUrl: values.previewUrl } }),
    onSuccess: async (updated) => {
      toast.success('Project settings saved');
      form.reset(projectDefaults(updated));
      await queryClient.invalidateQueries({ queryKey: ['projects', ws.org.id] });
    },
    onError: (err) => placeErrors(err, form.setError as never, fields),
  });
  const unplaced = save.error && !(save.error instanceof ApiError && Object.keys(save.error.fieldErrors).some((p) => fields.includes(p))) ? save.error : null;

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${project.name}”?`,
      message: (
        <>
          The project, its environments, content and media become unavailable to everyone, and its API keys stop working immediately. Type the project identifier to confirm.
        </>
      ),
      destructive: true,
      confirmLabel: 'Delete project',
      typeToConfirm: project.slug,
      onConfirm: () => api.delete(`/projects/${project.id}`, { confirm: project.slug }),
    });
    if (ok) {
      toast.success(`“${project.name}” was deleted`);
      await queryClient.invalidateQueries({ queryKey: ['projects', ws.org.id] });
      navigate(ws.orgHref('projects'));
    }
  };

  const previewUrl = form.watch('previewUrl');
  const example = previewUrl
    ? previewUrl.replaceAll('{token}', 'eyJhbGciOi…').replaceAll('{path}', '/about/team').replaceAll('{slug}', 'team').replaceAll('{id}', '3f6c1c1e-…').replaceAll('{locale}', project.locales.find((l) => l.isDefault)?.code ?? 'en').replaceAll('{type}', 'pages')
    : '';

  return (
    <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
     <Box key={formKey}>
      <Section title="General" description={canEdit ? 'Name and appearance of this project across Meridian.' : 'You can view these settings. Changing them needs the project settings permission.'}>
        <FormError error={unplaced} />
        <Stack spacing={4} sx={{ maxWidth: 640 }}>
          <TextField label="Project name" disabled={!canEdit} error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
          <TextField label="Description" multiline minRows={2} disabled={!canEdit} error={!!errors.description} helperText={errors.description?.message} {...form.register('description')} />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Identifier
            </Typography>
            <Mono>{project.slug}</Mono>
            <CopyButton value={project.slug} label="Copy project identifier" />
            <Typography variant="caption" color="text.disabled">
              Used in URLs and webhook payloads. It never changes.
            </Typography>
          </Stack>
          <Controller
            control={form.control}
            name="icon"
            render={({ field }) => (
              <Box>
                <Typography variant="subtitle2" id="project-icon-label" sx={{ mb: 1.5 }}>
                  Icon
                </Typography>
                <Box role="radiogroup" aria-labelledby="project-icon-label" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 34px)', gap: 1.5 }}>
                  {SELECTABLE_ICONS.map((name) => {
                    const selected = field.value === name;
                    return (
                      <Tooltip key={name} title={name}>
                        <span>
                          <ButtonBase
                            role="radio"
                            aria-checked={selected}
                            aria-label={`${name} icon`}
                            disabled={!canEdit}
                            onClick={() => field.onChange(name)}
                            sx={{ width: 34, height: 34, borderRadius: '8px', border: 1, borderColor: selected ? 'secondary.main' : 'border.subtle', bgcolor: selected ? 'action.selected' : 'transparent', color: selected ? 'secondary.main' : 'text.secondary', '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' }, '& svg': { fontSize: 17 } }}
                          >
                            <IconFor name={name} />
                          </ButtonBase>
                        </span>
                      </Tooltip>
                    );
                  })}
                </Box>
              </Box>
            )}
          />
          <Controller control={form.control} name="color" render={({ field }) => <ColorField label="Color" value={field.value} onChange={field.onChange} disabled={!canEdit} error={!!errors.color} helperText={errors.color?.message} />} />
        </Stack>
      </Section>

      <Section title="Website and preview" description="Where this project's content is shown, and how editors preview drafts in your frontend." sx={{ mt: 5 }}>
        <Stack spacing={4} sx={{ maxWidth: 720 }}>
          <TextField label="Site URL" placeholder="https://www.example.com" disabled={!canEdit} error={!!errors.siteUrl} helperText={errors.siteUrl?.message ?? 'The public address of the site this project feeds.'} {...form.register('siteUrl')} />
          <Box>
            <TextField
              label="Preview URL template"
              placeholder="https://www.example.com/api/preview?token={token}&path={path}"
              disabled={!canEdit}
              error={!!errors.previewUrl}
              helperText={errors.previewUrl?.message ?? 'Opened when an editor chooses Preview. Your frontend exchanges the token for the draft through the delivery API.'}
              slotProps={{ htmlInput: { spellCheck: false } }}
              {...form.register('previewUrl')}
            />
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5, mt: 2 }}>
              {PLACEHOLDERS.map(([token, meaning]) => (
                <Tooltip key={token} title={`${meaning} — click to add`}>
                  <Chip
                    label={token}
                    variant="outlined"
                    disabled={!canEdit}
                    onClick={() => form.setValue('previewUrl', `${form.getValues('previewUrl')}${token}`, { shouldDirty: true, shouldValidate: true })}
                    sx={{ fontFamily: 'monospace' }}
                  />
                </Tooltip>
              ))}
            </Stack>
            {example && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2, overflowWrap: 'anywhere' }}>
                Example: <Mono>{example}</Mono>
              </Typography>
            )}
          </Box>
        </Stack>
      </Section>
     </Box>

      {canEdit && (
        <Stack direction="row" spacing={2} sx={{ mt: 4, justifyContent: 'flex-end' }}>
          <Button
            disabled={!isDirty || save.isPending}
            onClick={() => {
              form.reset();
              setFormKey((k) => k + 1);
            }}
          >
            Discard
          </Button>
          <Button type="submit" variant="contained" disabled={!isDirty} loading={save.isPending}>
            Save changes
          </Button>
        </Stack>
      )}

      {ws.can('project.delete') && (
        <Paper sx={{ mt: 8, borderRadius: '10px', borderColor: 'error.main', overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ p: 5, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h5" component="h2">
                Delete this project
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
                Removes the project from Meridian and revokes all of its API keys. Connected applications stop receiving content.
              </Typography>
            </Box>
            <Button variant="outlined" color="error" startIcon={<DeleteOutlineOutlined />} onClick={() => void remove()} sx={{ color: 'error.main', borderColor: 'error.main', flexShrink: 0 }}>
              Delete project
            </Button>
          </Stack>
        </Paper>
      )}
    </form>
  );
}

// ─── Environments ────────────────────────────────────────────────────────────

function EnvironmentsTab({ project }: { project: Project }) {
  const ws = useWorkspace();
  return (
    <Stack spacing={4}>
      <Alert severity="info">
        Each environment is fully separate: it has its own content model, entries and pages, releases, webhooks and API keys. Media and locales are shared by the whole project. Build and test in Development or Staging, then recreate approved changes in Production.
      </Alert>
      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        <TableContainer>
          <Table aria-label="Environments">
            <TableHead>
              <TableRow>
                <TableCell>Environment</TableCell>
                <TableCell>Key</TableCell>
                <TableCell align="right">Entries and pages</TableCell>
                <TableCell>Environment ID</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {project.environments.map((env) => (
                <TableRow key={env.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center' }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ENVIRONMENT_TONES[env.key] ?? 'text.disabled' }} />
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {env.name}
                      </Typography>
                      {ws.project?.id === project.id && ws.environment?.id === env.id && <Pill label="Current" />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Mono>{env.key}</Mono>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {env.entryCount}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <Mono sx={{ color: 'text.secondary' }}>{env.id}</Mono>
                      <CopyButton value={env.id} label={`Copy ${env.name} environment ID`} />
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" component={RouterLink} to={ws.hrefFor(project, env.key)} endIcon={<ArrowForwardOutlined />} sx={{ color: 'text.secondary' }}>
                      Open
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Typography variant="caption" color="text.secondary">
        Switch environment at any time from the selector in the top bar. API keys are bound to one environment, so a key created for Staging can never read Production content.
      </Typography>
    </Stack>
  );
}

// ─── Locales ─────────────────────────────────────────────────────────────────

const LOCALE_CODE = /^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,3})?$/;
const COMMON_LOCALES: [string, string][] = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['fr', 'French'],
  ['de', 'German'],
  ['es', 'Spanish'],
  ['it', 'Italian'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['nl', 'Dutch'],
  ['sv', 'Swedish'],
  ['ja', 'Japanese'],
  ['zh-CN', 'Chinese (Simplified)'],
  ['hi', 'Hindi'],
  ['ar', 'Arabic'],
];

const localeSchema = z.object({
  code: z.string().trim().regex(LOCALE_CODE, 'Use a code such as “en”, “fr” or “pt-BR”'),
  name: z.string().trim().min(1, 'Enter a name').max(60),
  fallbackCode: z.string(),
});
type LocaleValues = z.infer<typeof localeSchema>;

function LocaleDialog({ open, onClose, locales, editing, projectId, onSaved }: { open: boolean; onClose: () => void; locales: Locale[]; editing: Locale | null; projectId: string; onSaved: () => Promise<unknown> }) {
  const defaultCode = locales.find((l) => l.isDefault)?.code ?? '';
  const form = useForm<LocaleValues>({ resolver: zodResolver(localeSchema), defaultValues: { code: '', name: '', fallbackCode: defaultCode } });
  const { errors } = form.formState;

  useEffect(() => {
    if (open) form.reset(editing ? { code: editing.code, name: editing.name, fallbackCode: editing.fallbackCode ?? '' } : { code: '', name: '', fallbackCode: defaultCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const save = useMutation({
    mutationFn: (values: LocaleValues) =>
      editing
        ? api.patch<Locale>(`/projects/${projectId}/locales/${editing.id}`, { name: values.name, ...(editing.isDefault ? {} : { fallbackCode: values.fallbackCode || null }) })
        : api.post<Locale>(`/projects/${projectId}/locales`, { code: values.code, name: values.name, fallbackCode: values.fallbackCode || null }),
    onSuccess: async (locale) => {
      toast.success(editing ? 'Locale updated' : `Locale “${locale.code}” added`);
      await onSaved();
      onClose();
    },
    onError: (err) => placeErrors(err, form.setError as never, ['code', 'name', 'fallbackCode']),
  });
  const unplaced = save.error && !(save.error instanceof ApiError && Object.keys(save.error.fieldErrors).some((p) => ['code', 'name', 'fallbackCode'].includes(p))) ? save.error : null;
  const taken = new Set(locales.map((l) => l.code));
  const code = form.watch('code');

  return (
    <Dialog open={open} onClose={save.isPending ? undefined : onClose} maxWidth="xs" aria-labelledby="locale-dialog-title" slotProps={{ transition: { onExited: () => save.reset() } }}>
      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <DialogTitle id="locale-dialog-title">{editing ? `Edit ${editing.code}` : 'Add a locale'}</DialogTitle>
        <DialogContent>
          <FormError error={unplaced} />
          <Stack spacing={4} sx={{ mt: 2 }}>
            {!editing && (
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
                  Common locales
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                  {COMMON_LOCALES.filter(([c]) => !taken.has(c)).map(([c, label]) => (
                    <Chip
                      key={c}
                      label={c}
                      title={label}
                      variant={code === c ? 'filled' : 'outlined'}
                      onClick={() => {
                        form.setValue('code', c, { shouldValidate: true });
                        form.setValue('name', label, { shouldValidate: true });
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            )}
            <TextField label="Code" placeholder="pt-BR" disabled={!!editing} autoFocus={!editing} error={!!errors.code} helperText={errors.code?.message ?? (editing ? 'The code cannot be changed once content uses it.' : 'Language, optionally with a region. Used in API requests as ?locale=')} slotProps={{ htmlInput: { spellCheck: false, maxLength: 10 } }} {...form.register('code')} />
            <TextField label="Name" placeholder="Portuguese (Brazil)" autoFocus={!!editing} error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
            {!editing?.isDefault && (
              <Controller
                control={form.control}
                name="fallbackCode"
                render={({ field }) => (
                  <TextField select label="Fallback" helperText="Served when an entry has no translation in this locale." slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} {...field}>
                    <MenuItem value="">Default locale only</MenuItem>
                    {locales
                      .filter((l) => l.id !== editing?.id)
                      .map((l) => (
                        <MenuItem key={l.id} value={l.code}>
                          {l.name} ({l.code})
                        </MenuItem>
                      ))}
                  </TextField>
                )}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            {editing ? 'Save' : 'Add locale'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function LocalesTab({ project }: { project: Project }) {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const canEdit = ws.can('project.update');
  const [dialog, setDialog] = useState<{ editing: Locale | null } | null>(null);

  const locales = useQuery({ queryKey: ['locales', project.id], queryFn: () => api.get<{ items: Locale[] }>(`/projects/${project.id}/locales`).then((r) => r.items) });
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['locales', project.id] }), queryClient.invalidateQueries({ queryKey: ['projects', ws.org.id] })]);

  const makeDefault = async (locale: Locale) => {
    const ok = await confirm({
      title: `Make ${locale.name} the default locale?`,
      message: 'API requests without a locale, and every content type that is not localized, will use it from now on. Existing content keeps the locale it was written in.',
      confirmLabel: 'Make default',
      onConfirm: () => api.patch(`/projects/${project.id}/locales/${locale.id}`, { isDefault: true }),
    });
    if (ok) {
      toast.success(`${locale.name} is now the default locale`);
      await refresh();
    }
  };

  const remove = async (locale: Locale) => {
    const ok = await confirm({
      title: `Delete the locale “${locale.code}”?`,
      message: 'A locale can only be deleted when no entry uses it.',
      destructive: true,
      confirmLabel: 'Delete locale',
      // The API explains when translations still exist; the dialog shows that message.
      onConfirm: () => api.delete(`/projects/${project.id}/locales/${locale.id}`),
    });
    if (ok) {
      toast.success('Locale deleted');
      await refresh();
    }
  };

  const items = locales.data ?? [];
  return (
    <Section
      flush
      title="Locales"
      description="Languages content can be translated into. Enable localization on a content type to translate its entries."
      action={
        canEdit ? (
          <Button variant="outlined" startIcon={<AddOutlined />} onClick={() => setDialog({ editing: null })}>
            Add locale
          </Button>
        ) : undefined
      }
    >
      {locales.isLoading ? (
        <TableSkeleton rows={3} columns={4} />
      ) : locales.isError ? (
        <ErrorState compact error={locales.error} onRetry={() => void locales.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState compact icon={<TranslateOutlined />} title="No locales" description="Add a locale to start writing content." />
      ) : (
        <TableContainer>
          <Table aria-label="Locales">
            <TableHead>
              <TableRow>
                <TableCell>Locale</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Falls back to</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((locale) => {
                const fallback = locale.fallbackCode ? items.find((l) => l.code === locale.fallbackCode) : null;
                const defaultLocale = items.find((l) => l.isDefault);
                return (
                  <TableRow key={locale.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {locale.name}
                        </Typography>
                        {locale.isDefault && <Pill label="Default" fg="success.dark" bg="success.light" />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Mono>{locale.code}</Mono>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{locale.isDefault ? '—' : fallback ? `${fallback.name} (${fallback.code})` : defaultLocale ? `${defaultLocale.name} (default)` : '—'}</TableCell>
                    <TableCell align="right">
                      {canEdit && (
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                          {!locale.isDefault && (
                            <Button size="small" onClick={() => void makeDefault(locale)} sx={{ color: 'text.secondary' }}>
                              Make default
                            </Button>
                          )}
                          <Tooltip title="Edit">
                            <IconButton aria-label={`Edit ${locale.name}`} onClick={() => setDialog({ editing: locale })}>
                              <EditOutlined />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={locale.isDefault ? 'Make another locale the default before deleting this one' : 'Delete'}>
                            <span>
                              <IconButton aria-label={`Delete ${locale.name}`} disabled={locale.isDefault} onClick={() => void remove(locale)}>
                                <DeleteOutlineOutlined />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <LocaleDialog open={!!dialog} editing={dialog?.editing ?? null} onClose={() => setDialog(null)} locales={items} projectId={project.id} onSaved={refresh} />
    </Section>
  );
}

// ─── Appearance ──────────────────────────────────────────────────────────────

function AppearanceTab() {
  const dispatch = useAppDispatch();
  const { mode, setMode } = useColorScheme();
  const { tableDensity, sidebarCollapsed } = useAppSelector((s) => s.ui);
  return (
    <Section title="Appearance" description="Personal preferences, saved in this browser. They do not affect other members.">
      <SettingRow label="Theme" description="System follows your operating system and switches automatically.">
        <ToggleButtonGroup size="small" exclusive value={mode ?? 'system'} onChange={(_, next) => next && setMode(next)} aria-label="Theme">
          <ToggleButton value="light">
            <LightModeOutlined sx={{ fontSize: 15, mr: 1.5 }} />
            Light
          </ToggleButton>
          <ToggleButton value="dark">
            <DarkModeOutlined sx={{ fontSize: 15, mr: 1.5 }} />
            Dark
          </ToggleButton>
          <ToggleButton value="system">
            <SettingsBrightnessOutlined sx={{ fontSize: 15, mr: 1.5 }} />
            System
          </ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>
      <SettingRow label="Table density" description="Compact fits more rows on screen; comfortable gives each row more room.">
        <ToggleButtonGroup size="small" exclusive value={tableDensity} onChange={(_, next) => next && dispatch(setTableDensity(next))} aria-label="Table density">
          <ToggleButton value="comfortable">Comfortable</ToggleButton>
          <ToggleButton value="compact">Compact</ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>
      <SettingRow label="Collapse the sidebar" description="Show only icons in the navigation to give content more space.">
        <Switch checked={sidebarCollapsed} onChange={() => dispatch(toggleSidebar())} slotProps={{ input: { 'aria-label': 'Collapse the sidebar' } }} />
      </SettingRow>
    </Section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const ws = useWorkspace();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = requested && TABS.includes(requested) ? requested : 'organization';
  const project = ws.projects.find((p) => p.id === params.get('project')) ?? ws.project ?? ws.projects[0] ?? null;

  const setParam = (patch: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const projectScoped = tab === 'project' || tab === 'environments' || tab === 'locales';

  return (
    <Page width={1120}>
      <PageHeader title="Settings" description={`Organization, project and personal settings for ${ws.org.name}.`} />
      <Tabs value={tab} onChange={(_, next: TabKey) => setParam({ tab: next })} variant="scrollable" scrollButtons="auto" aria-label="Settings sections" sx={{ mb: 6 }}>
        {TABS.map((key) => (
          <Tab key={key} value={key} label={TAB_LABELS[key]} id={`settings-tab-${key}`} aria-controls={`settings-panel-${key}`} />
        ))}
      </Tabs>

      <Box role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'organization' && <OrganizationTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {projectScoped &&
          (ws.projectsLoading ? (
            <Skeleton variant="rounded" height={360} sx={{ borderRadius: '10px' }} />
          ) : ws.projectsError ? (
            <Paper sx={{ borderRadius: '10px' }}>
              <ErrorState error={ws.projectsError} />
            </Paper>
          ) : !project ? (
            <Paper sx={{ borderRadius: '10px' }}>
              <EmptyState
                icon={<FolderOffOutlined />}
                title="No project yet"
                description="Create a project first; its settings, environments and locales appear here."
                action={
                  <Button variant="contained" component={RouterLink} to={ws.orgHref('projects')}>
                    Go to projects
                  </Button>
                }
              />
            </Paper>
          ) : (
            <>
              <ProjectPicker project={project} onChange={(id) => setParam({ project: id })} />
              {tab === 'project' && <ProjectTab key={project.id} project={project} />}
              {tab === 'environments' && <EnvironmentsTab project={project} />}
              {tab === 'locales' && <LocalesTab key={project.id} project={project} />}
            </>
          ))}
      </Box>
    </Page>
  );
}
