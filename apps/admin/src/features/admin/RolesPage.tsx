import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from '@meridian/shared';
import { useWorkspace } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import type { Role } from '@/lib/types';
import { toast } from '@/store';

interface Draft {
  name: string;
  description: string;
  permissions: string[];
}

const NEW = 'new';
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

function RoleRow({ role, selected, onSelect }: { role: Role; selected: boolean; onSelect: () => void }) {
  return (
    <ButtonBase
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 2.5, px: 2.5, py: 2, borderRadius: '8px', bgcolor: selected ? 'action.selected' : 'transparent', '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' } }}
    >
      {role.isSystem ? <LockOutlined sx={{ fontSize: 15, color: 'text.disabled', flexShrink: 0 }} /> : <TuneOutlined sx={{ fontSize: 15, color: selected ? 'secondary.main' : 'text.secondary', flexShrink: 0 }} />}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: selected ? 600 : 500 }}>
          {role.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}
        </Typography>
      </Box>
      <Tooltip title={`${role.memberCount} member${role.memberCount === 1 ? '' : 's'}`}>
        <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {role.memberCount}
        </Typography>
      </Tooltip>
    </ButtonBase>
  );
}

export default function RolesPage() {
  const ws = useWorkspace();
  const orgId = ws.org.id;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const canEdit = ws.can('org.roles.manage');
  const [params, setParams] = useSearchParams();

  const roles = useQuery({ queryKey: ['roles', orgId], queryFn: () => api.get<{ items: Role[] }>(`${ws.orgBase}/roles`).then((r) => r.items) });
  const list = useMemo(() => roles.data ?? [], [roles.data]);
  const system = list.filter((r) => r.isSystem);
  const custom = list.filter((r) => !r.isSystem);

  const selectedId = params.get('role') ?? list[0]?.id ?? null;
  const creating = selectedId === NEW;
  const role = creating ? null : (list.find((r) => r.id === selectedId) ?? list[0] ?? null);
  const editable = canEdit && (creating || (!!role && !role.isSystem));

  const [draft, setDraft] = useState<Draft>({ name: '', description: '', permissions: [] });
  const [nameError, setNameError] = useState<string | null>(null);
  // Prefill for a new role (blank, or copied from the role being duplicated).
  const [template, setTemplate] = useState<Draft>({ name: '', description: '', permissions: [] });

  useEffect(() => {
    setNameError(null);
    if (creating) setDraft(template);
    else if (role) setDraft({ name: role.name, description: role.description, permissions: role.permissions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, role?.id, role?.name, role?.description, role?.permissions.join('|'), template]);

  const original: Draft = creating ? { name: '', description: '', permissions: [] } : { name: role?.name ?? '', description: role?.description ?? '', permissions: role?.permissions ?? [] };
  const dirty = editable && (creating ? draft.name.trim() !== '' || draft.permissions.length > 0 || draft.description.trim() !== '' : draft.name !== original.name || draft.description !== original.description || !sameSet(draft.permissions, original.permissions));

  const select = async (id: string) => {
    if (id === selectedId) return;
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'Your changes to this role have not been saved.', confirmLabel: 'Discard', destructive: true }))) return;
    setParams({ role: id }, { replace: true });
  };

  const startNew = async (from?: Role) => {
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'Your changes to this role have not been saved.', confirmLabel: 'Discard', destructive: true }))) return;
    // A copy can only carry permissions the current user is allowed to grant.
    setTemplate(from ? { name: `${from.name} (copy)`, description: from.description, permissions: from.permissions.filter((p) => ws.can(p as Permission)) } : { name: '', description: '', permissions: [] });
    setParams({ role: NEW }, { replace: true });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: draft.name.trim(), description: draft.description.trim(), permissions: draft.permissions };
      return creating ? api.post<Role>(`${ws.orgBase}/roles`, body) : api.patch<Role>(`${ws.orgBase}/roles/${role?.id}`, body);
    },
    onSuccess: async (saved) => {
      toast.success(creating ? `Role “${saved.name}” created` : 'Role saved');
      await queryClient.invalidateQueries({ queryKey: ['roles', orgId] });
      setParams({ role: saved.id }, { replace: true });
    },
  });

  const submit = () => {
    const name = draft.name.trim();
    if (name.length < 2) return setNameError('Give the role a name of at least 2 characters');
    if (name.length > 80) return setNameError('Keep the name under 80 characters');
    setNameError(null);
    save.mutate();
  };

  const remove = async () => {
    if (!role) return;
    const ok = await confirm({
      title: `Delete the role “${role.name}”?`,
      message: role.memberCount > 0 ? `${role.memberCount} member${role.memberCount === 1 ? ' has' : 's have'} this role. Give them another role first.` : 'This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete role',
      // The API refuses while members are assigned; its explanation is shown in the dialog.
      onConfirm: () => api.delete(`${ws.orgBase}/roles/${role.id}`),
    });
    if (ok) {
      toast.success('Role deleted');
      await queryClient.invalidateQueries({ queryKey: ['roles', orgId] });
      setParams({}, { replace: true });
    }
  };

  const granted = new Set(draft.permissions);
  /** Nobody can grant a permission they do not hold themselves (already-granted ones can stay). */
  const locked = (permission: Permission) => !ws.can(permission) && !original.permissions.includes(permission);
  const toggle = (permission: Permission) => setDraft((d) => ({ ...d, permissions: d.permissions.includes(permission) ? d.permissions.filter((p) => p !== permission) : [...d.permissions, permission] }));
  const toggleGroup = (permissions: Permission[], on: boolean) =>
    setDraft((d) => {
      const changeable = permissions.filter((p) => !locked(p));
      const rest = d.permissions.filter((p) => !changeable.includes(p as Permission));
      return { ...d, permissions: on ? [...rest, ...changeable] : rest };
    });

  return (
    <Page>
      <PageHeader
        title="Roles & permissions"
        description="A role is a set of permissions. Every request is checked against the member's role on the server."
        actions={
          canEdit ? (
            <Button variant="contained" startIcon={<AddOutlined />} onClick={() => void startNew()}>
              New role
            </Button>
          ) : undefined
        }
      />

      {roles.isLoading ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' }, gap: 5 }} aria-busy="true">
          <Skeleton variant="rounded" height={480} sx={{ borderRadius: '10px' }} />
          <Skeleton variant="rounded" height={480} sx={{ borderRadius: '10px' }} />
        </Box>
      ) : roles.isError ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px minmax(0, 1fr)' }, gap: 5, alignItems: 'start' }}>
          {/* Role list: sidebar on desktop, selector on small screens. */}
          <Paper component="nav" aria-label="Roles" sx={{ display: { xs: 'none', md: 'block' }, borderRadius: '10px', p: 2, position: 'sticky', top: 16 }}>
            <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 2.5, pt: 1.5, pb: 1 }}>
              System roles
            </Typography>
            {system.map((r) => (
              <RoleRow key={r.id} role={r} selected={!creating && role?.id === r.id} onSelect={() => void select(r.id)} />
            ))}
            <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 2.5, pt: 4, pb: 1 }}>
              Custom roles
            </Typography>
            {custom.map((r) => (
              <RoleRow key={r.id} role={r} selected={!creating && role?.id === r.id} onSelect={() => void select(r.id)} />
            ))}
            {creating && (
              <Box sx={{ px: 2.5, py: 2, borderRadius: '8px', bgcolor: 'action.selected' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {draft.name.trim() || 'New role'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Not saved yet
                </Typography>
              </Box>
            )}
            {custom.length === 0 && !creating && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ px: 2.5, py: 1 }}>
                {canEdit ? 'None yet. Create one, or duplicate a system role as a starting point.' : 'None yet.'}
              </Typography>
            )}
          </Paper>
          <TextField select label="Role" value={creating ? NEW : (role?.id ?? '')} onChange={(e) => void select(e.target.value)} sx={{ display: { md: 'none' } }}>
            {list.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
                {r.isSystem ? ' (system)' : ''}
              </MenuItem>
            ))}
            {creating && <MenuItem value={NEW}>New role</MenuItem>}
          </TextField>

          {!role && !creating ? (
            <Paper sx={{ borderRadius: '10px' }}>
              <EmptyState icon={<AdminPanelSettingsOutlined />} title="No roles" description="This organization has no roles yet." />
            </Paper>
          ) : (
            <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
              <Box sx={{ p: 5, borderBottom: 1, borderColor: 'border.subtle' }}>
                {editable ? (
                  <Stack spacing={3.5}>
                    <FormError error={save.error} />
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1.4fr' }, gap: 3.5 }}>
                      <TextField
                        label="Role name"
                        value={draft.name}
                        autoFocus={creating}
                        onChange={(e) => {
                          setDraft((d) => ({ ...d, name: e.target.value }));
                          setNameError(null);
                        }}
                        error={!!nameError}
                        helperText={nameError ?? undefined}
                        slotProps={{ htmlInput: { maxLength: 80 } }}
                      />
                      <TextField label="Description" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} placeholder="What is this role for?" slotProps={{ htmlInput: { maxLength: 300 } }} />
                    </Box>
                    <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Pill label={creating ? 'New custom role' : 'Custom role'} />
                      {!creating && role && <Pill label={`${role.memberCount} member${role.memberCount === 1 ? '' : 's'}`} />}
                      <Pill label={`${draft.permissions.length} of ${Object.keys(PERMISSIONS).length} permissions`} />
                      <Box sx={{ flex: 1 }} />
                      {!creating && role && (
                        <Button startIcon={<DeleteOutlineOutlined />} onClick={() => void remove()} sx={{ color: 'error.main' }}>
                          Delete
                        </Button>
                      )}
                      <Button
                        disabled={save.isPending || (!creating && !dirty)}
                        onClick={() => {
                          if (creating) setParams({}, { replace: true });
                          else setDraft(original);
                          setNameError(null);
                          save.reset();
                        }}
                      >
                        {creating ? 'Cancel' : 'Discard'}
                      </Button>
                      <Button variant="contained" disabled={!dirty} loading={save.isPending} onClick={submit}>
                        {creating ? 'Create role' : 'Save changes'}
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  role && (
                    <>
                      <Stack direction="row" spacing={3} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                            <Typography variant="h3" component="h2">
                              {role.name}
                            </Typography>
                            <Pill label={role.isSystem ? 'System role' : 'Custom role'} />
                            <Pill label={`${role.memberCount} member${role.memberCount === 1 ? '' : 's'}`} />
                          </Stack>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {role.description || 'No description.'}
                          </Typography>
                        </Box>
                        {canEdit && role.isSystem && (
                          <Button variant="outlined" startIcon={<ContentCopyOutlined />} onClick={() => void startNew(role)} sx={{ flexShrink: 0 }}>
                            Duplicate as custom role
                          </Button>
                        )}
                      </Stack>
                      {role.isSystem ? (
                        <Alert severity="info" icon={<LockOutlined fontSize="inherit" />} sx={{ mt: 4 }}>
                          System roles are maintained by Meridian and cannot be changed.{canEdit ? ' Duplicate this role to create an adjusted version.' : ''}
                        </Alert>
                      ) : (
                        <Alert severity="info" sx={{ mt: 4 }}>
                          You can view this role. Changing roles needs the “{PERMISSIONS['org.roles.manage']}” permission.
                        </Alert>
                      )}
                    </>
                  )
                )}
              </Box>

              <Box sx={{ p: 5, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 4 }}>
                {PERMISSION_GROUPS.map((group) => {
                  const on = group.permissions.filter((p) => granted.has(p)).length;
                  const changeable = group.permissions.filter((p) => !locked(p));
                  const groupId = `perm-group-${group.label.replace(/\s+/g, '-').toLowerCase()}`;
                  return (
                    <Box key={group.label} role="group" aria-labelledby={groupId} sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '10px', overflow: 'hidden' }}>
                      <Stack direction="row" sx={{ alignItems: 'center', pl: 1.5, pr: 3.5, minHeight: 42, bgcolor: 'surface.subtle', borderBottom: 1, borderColor: 'border.subtle' }}>
                        <Checkbox
                          checked={on === group.permissions.length}
                          indeterminate={on > 0 && on < group.permissions.length}
                          disabled={!editable || changeable.length === 0}
                          onChange={(e) => toggleGroup(group.permissions, e.target.checked)}
                          slotProps={{ input: { 'aria-label': `All ${group.label} permissions` } }}
                        />
                        <Typography id={groupId} variant="subtitle2" sx={{ flex: 1, fontWeight: 600 }}>
                          {group.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {on} of {group.permissions.length}
                        </Typography>
                      </Stack>
                      {group.permissions.map((permission) => {
                        const isLocked = editable && locked(permission);
                        const id = `perm-${permission}`;
                        const row = (
                          <Stack
                            direction="row"
                            component="label"
                            htmlFor={id}
                            sx={{ alignItems: 'flex-start', pl: 1.5, pr: 3.5, py: 1, cursor: editable && !isLocked ? 'pointer' : 'default', opacity: isLocked ? 0.55 : 1, '&:hover': { bgcolor: editable && !isLocked ? 'action.hover' : 'transparent' } }}
                          >
                            <Checkbox id={id} checked={granted.has(permission)} disabled={!editable || isLocked} onChange={() => toggle(permission)} />
                            <Box sx={{ pt: 1.5, minWidth: 0 }}>
                              <Typography variant="body2">{PERMISSIONS[permission]}</Typography>
                              <Mono sx={{ color: 'text.disabled' }}>{permission}</Mono>
                            </Box>
                          </Stack>
                        );
                        return (
                          <Box key={permission} sx={{ '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
                            {isLocked ? (
                              <Tooltip title="You cannot grant a permission you do not hold yourself" placement="top-start">
                                {row}
                              </Tooltip>
                            ) : (
                              row
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  );
                })}
              </Box>
            </Paper>
          )}
        </Box>
      )}
    </Page>
  );
}
