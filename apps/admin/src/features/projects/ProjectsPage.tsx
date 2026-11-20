import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { z } from 'zod';
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
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import { ENVIRONMENT_TONES } from '@/app/nav';
import { useWorkspace } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { IconFor } from '@/components/icons';
import { CardSkeleton, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { compactNumber } from '@/lib/format';
import type { Project } from '@/lib/types';
import { toast } from '@/store';
import { IconPicker } from '@/features/model/pickers';

/** Restrained project colors that sit well beside the neutral interface in both themes. */
const PROJECT_COLORS = [
  { value: '#1F6F5C', name: 'Emerald' },
  { value: '#2F7D5B', name: 'Green' },
  { value: '#4A6B85', name: 'Slate' },
  { value: '#3F5D6B', name: 'Petrol' },
  { value: '#8A5A2B', name: 'Umber' },
  { value: '#B4721A', name: 'Amber' },
  { value: '#A14B3F', name: 'Clay' },
  { value: '#6B5B7B', name: 'Plum' },
  { value: '#5E5C56', name: 'Stone' },
  { value: '#2B2B28', name: 'Graphite' },
];

const projectSchema = z.object({
  name: z.string().trim().min(2, 'Enter a project name of at least 2 characters').max(80, 'Keep the name under 80 characters'),
  description: z.string().trim().max(400, 'Keep the description under 400 characters'),
  icon: z.string(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Choose a color'),
});
type ProjectValues = z.infer<typeof projectSchema>;

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<ProjectValues>({ resolver: zodResolver(projectSchema), defaultValues: { name: '', description: '', icon: 'layers', color: PROJECT_COLORS[0].value } });
  const { errors } = form.formState;
  const color = form.watch('color');
  const icon = form.watch('icon');
  const name = form.watch('name');

  const create = useMutation({
    mutationFn: (values: ProjectValues) => api.post<Project>(`${ws.orgBase}/projects`, values),
    onSuccess: async (project) => {
      // Put the project in the cache right away so its dashboard can open without waiting for a refetch.
      queryClient.setQueryData<Project[]>(['projects', ws.org.id], (current) => [project, ...(current ?? []).filter((p) => p.id !== project.id)]);
      void queryClient.invalidateQueries({ queryKey: ['projects', ws.org.id] });
      toast.success(`${project.name} is ready`);
      onClose();
      navigate(ws.hrefFor(project, 'production'));
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      for (const [path, message] of Object.entries(err.fieldErrors)) if (path in form.getValues()) form.setError(path as keyof ProjectValues, { message });
    },
  });
  const unmapped = create.error instanceof ApiError && Object.keys(create.error.fieldErrors).length > 0 ? null : create.error;

  return (
    <Dialog open={open} onClose={() => !create.isPending && onClose()} aria-labelledby="new-project-title" slotProps={{ transition: { onExited: () => { form.reset(); create.reset(); } } }}>
      <form noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <DialogTitle id="new-project-title">New project</DialogTitle>
        <DialogContent>
          <FormError error={unmapped} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={3} sx={{ alignItems: 'center', p: 3, borderRadius: '8px', bgcolor: 'surface.subtle', border: 1, borderColor: 'border.subtle' }}>
              <Box sx={{ width: 40, height: 40, borderRadius: '10px', bgcolor: color, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, transition: 'background-color 160ms', '& svg': { fontSize: 22 } }}>
                <IconFor name={icon} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                  {name.trim() || 'Project name'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Starts with development, staging and production environments
                </Typography>
              </Box>
            </Stack>
            <TextField label="Name" autoFocus placeholder="Marketing website" error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
            <TextField label="Description" multiline minRows={2} error={!!errors.description} helperText={errors.description?.message ?? 'Optional. What this project is for.'} {...form.register('description')} />
            <Controller
              control={form.control}
              name="color"
              render={({ field }) => (
                <Box>
                  <Typography variant="subtitle2" component="div" id="project-color-label" sx={{ fontWeight: 500, mb: 1.5 }}>
                    Color
                  </Typography>
                  <Stack direction="row" role="radiogroup" aria-labelledby="project-color-label" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
                    {PROJECT_COLORS.map((option) => {
                      const selected = field.value === option.value;
                      return (
                        <Tooltip key={option.value} title={option.name}>
                          <ButtonBase
                            role="radio"
                            aria-checked={selected}
                            aria-label={option.name}
                            onClick={() => field.onChange(option.value)}
                            sx={{ width: 28, height: 28, borderRadius: '8px', bgcolor: option.value, color: '#fff', outline: selected ? '2px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2 }}
                          >
                            {selected && <CheckOutlined sx={{ fontSize: 15 }} />}
                          </ButtonBase>
                        </Tooltip>
                      );
                    })}
                  </Stack>
                  {errors.color && (
                    <Typography variant="caption" color="error" role="alert" component="div" sx={{ mt: 1 }}>
                      {errors.color.message}
                    </Typography>
                  )}
                </Box>
              )}
            />
            <Controller control={form.control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} />} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={create.isPending}>
            Create project
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function ProjectCard({ project, current, onDelete }: { project: Project; current: boolean; onDelete: () => void }) {
  const ws = useWorkspace();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entries = project.environments.reduce((n, e) => n + e.entryCount, 0);
  const canUpdate = ws.can('project.update');
  const canDelete = ws.can('project.delete');
  const defaultLocale = project.locales.find((l) => l.isDefault)?.code ?? 'en';

  return (
    <Paper
      sx={{
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transition: 'border-color 140ms, box-shadow 140ms',
        '&:hover, &:focus-within': { borderColor: 'border.strong', boxShadow: '0 4px 14px rgba(17,17,16,0.06)' },
      }}
    >
      <ButtonBase
        component={RouterLink}
        to={ws.hrefFor(project, 'production')}
        aria-label={`Open ${project.name}`}
        sx={{ p: 4, pr: 11, gap: 3, alignItems: 'flex-start', justifyContent: 'flex-start', textAlign: 'left', borderRadius: '10px 10px 0 0', color: 'text.primary', textDecoration: 'none !important' }}
      >
        <Box sx={{ width: 40, height: 40, borderRadius: '10px', bgcolor: project.color, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, '& svg': { fontSize: 22 } }}>
          <IconFor name={project.icon} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="h4" component="h2" noWrap>
              {project.name}
            </Typography>
            {current && <Pill label="Current" title="The project you last worked in" />}
          </Stack>
          <Mono sx={{ color: 'text.disabled' }}>{project.slug}</Mono>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {project.description || 'No description yet.'}
          </Typography>
        </Box>
      </ButtonBase>

      {(canUpdate || canDelete) && (
        <>
          <Tooltip title="Project actions">
            <IconButton aria-label={`Actions for ${project.name}`} aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)} sx={{ position: 'absolute', top: 12, right: 12 }}>
              <MoreHorizOutlined />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            {canUpdate && (
              <MenuItem component={RouterLink} to={`${ws.orgHref('admin/settings')}?project=${project.id}`} onClick={() => setAnchor(null)}>
                <ListItemIcon>
                  <SettingsOutlined />
                </ListItemIcon>
                Settings
              </MenuItem>
            )}
            {canDelete && (
              <MenuItem
                onClick={() => {
                  setAnchor(null);
                  onDelete();
                }}
                sx={{ color: 'error.main' }}
              >
                <ListItemIcon>
                  <DeleteOutlineOutlined />
                </ListItemIcon>
                Delete project
              </MenuItem>
            )}
          </Menu>
        </>
      )}

      <Stack direction="row" sx={{ px: 4, pb: 3, gap: 1.5, flexWrap: 'wrap' }}>
        {project.environments.map((env) => (
          <ButtonBase
            key={env.id}
            component={RouterLink}
            to={ws.hrefFor(project, env.key)}
            aria-label={`Open ${project.name} — ${env.name}, ${env.entryCount} entries`}
            sx={{ px: 2, height: 26, gap: 1.5, borderRadius: '6px', border: 1, borderColor: 'border.subtle', fontSize: '0.75rem', color: 'text.secondary', textDecoration: 'none !important', '&:hover': { bgcolor: 'action.hover', color: 'text.primary', borderColor: 'border.strong' } }}
          >
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ENVIRONMENT_TONES[env.key] ?? 'text.disabled' }} />
            {env.name}
            <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.disabled' }}>
              {compactNumber(env.entryCount)}
            </Box>
          </ButtonBase>
        ))}
      </Stack>

      <Stack direction="row" sx={{ mt: 'auto', px: 4, py: 2.5, borderTop: 1, borderColor: 'border.subtle', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {compactNumber(entries)} entr{entries === 1 ? 'y' : 'ies'} · {project.locales.length} locale{project.locales.length === 1 ? '' : 's'} ({defaultLocale} default)
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
          Updated <RelativeTime value={project.updatedAt} />
        </Typography>
      </Stack>
    </Paper>
  );
}

export default function ProjectsPage() {
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const canRead = ws.can('project.read');
  const canCreate = ws.can('project.create');

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ws.projects.filter((p) => `${p.name} ${p.slug} ${p.description}`.toLowerCase().includes(q)) : ws.projects;
  }, [ws.projects, search]);

  const remove = (project: Project) =>
    confirm({
      title: `Delete ${project.name}?`,
      message: (
        <>
          The project and everything in it — content model, content and media across all {project.environments.length} environments — disappears for everyone. Its API keys are revoked immediately, so connected applications lose access. This cannot be undone from the app.
        </>
      ),
      typeToConfirm: project.slug,
      confirmLabel: 'Delete project',
      destructive: true,
      onConfirm: () => api.delete(`/projects/${project.id}`, { confirm: project.slug }),
    }).then(async (deleted) => {
      if (!deleted) return;
      queryClient.setQueryData<Project[]>(['projects', ws.org.id], (current) => (current ?? []).filter((p) => p.id !== project.id));
      await queryClient.invalidateQueries({ queryKey: ['projects', ws.org.id] });
      toast.success(`${project.name} deleted`);
    });

  const newButton = canCreate ? (
    <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setCreating(true)}>
      New project
    </Button>
  ) : (
    <Tooltip title="Your role cannot create projects">
      <span>
        <Button variant="contained" startIcon={<AddOutlined />} disabled>
          New project
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Page>
      <PageHeader
        title="Projects"
        description={`Each project in ${ws.org.name} has its own content model, content, media, API keys and environments.`}
        actions={canRead ? newButton : undefined}
      />

      {!canRead ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState icon={<LockOutlined />} title="You do not have access to projects" description="Ask an administrator of this organization to give your role the “View projects” permission." />
        </Paper>
      ) : ws.projectsLoading ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 4 }} aria-busy="true">
          <CardSkeleton count={3} height={212} />
        </Box>
      ) : ws.projectsError ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={ws.projectsError} onRetry={() => void queryClient.invalidateQueries({ queryKey: ['projects', ws.org.id] })} />
        </Paper>
      ) : ws.projects.length === 0 ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<FolderOutlined />}
            title="Create your first project"
            description={
              canCreate
                ? 'A project holds everything for one website or application: its content model, entries, pages, media and API keys. It starts with development, staging and production environments, so you can model safely before going live.'
                : 'There are no projects in this organization yet. Ask an administrator to create one.'
            }
            action={canCreate ? newButton : undefined}
          />
        </Paper>
      ) : (
        <>
          <Stack direction="row" sx={{ mb: 4, alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
            <Typography variant="caption" color="text.secondary">
              {ws.projects.length} project{ws.projects.length === 1 ? '' : 's'}
            </Typography>
          </Stack>
          {visible.length === 0 ? (
            <Paper sx={{ borderRadius: '10px' }}>
              <EmptyState compact icon={<SearchOffOutlined />} title="No project matches" description={`Nothing matches “${search.trim()}”.`} />
            </Paper>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 4 }}>
              {visible.map((project) => (
                <ProjectCard key={project.id} project={project} current={project.id === ws.project?.id} onDelete={() => void remove(project)} />
              ))}
            </Box>
          )}
        </>
      )}

      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}
