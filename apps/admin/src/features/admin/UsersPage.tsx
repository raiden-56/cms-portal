import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import BlockOutlined from '@mui/icons-material/BlockOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import MailOutlined from '@mui/icons-material/MailOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined';
import PersonAddAltOutlined from '@mui/icons-material/PersonAddAltOutlined';
import PersonRemoveOutlined from '@mui/icons-material/PersonRemoveOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { useWorkspace } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CopyButton, EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput, Section, TableSkeleton, UserAvatar } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { GuestNote } from '@/features/guest/guest';
import { shortDate } from '@/lib/format';
import type { Invitation, Member, Role } from '@/lib/types';
import { toast, useAppSelector } from '@/store';

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Enter an email address').email('Enter a valid email address').max(254),
  roleId: z.string().min(1, 'Choose a role'),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteDialog({ open, onClose, roles, orgBase, orgName, onInvited }: { open: boolean; onClose: () => void; roles: Role[]; orgBase: string; orgName: string; onInvited: () => void }) {
  const defaultRole = roles.find((r) => r.key === 'editor')?.id ?? roles[0]?.id ?? '';
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', roleId: defaultRole } });
  const { errors } = form.formState;
  const [created, setCreated] = useState<Invitation | null>(null);
  const roleId = form.watch('roleId');
  const role = roles.find((r) => r.id === roleId);

  const invite = useMutation({
    mutationFn: (values: InviteValues) => api.post<Invitation>(`${orgBase}/invitations`, values),
    onSuccess: (invitation) => {
      setCreated(invitation);
      onInvited();
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const [path, message] of Object.entries(err.fieldErrors)) if (path === 'email' || path === 'roleId') form.setError(path, { message });
    },
  });

  const reset = () => {
    setCreated(null);
    invite.reset();
    form.reset({ email: '', roleId: defaultRole });
  };
  // Roles load after this dialog mounts, so the default role is applied each time it opens.
  useEffect(() => {
    if (open) form.reset({ email: '', roleId: defaultRole });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultRole]);

  return (
    <Dialog open={open} onClose={invite.isPending ? undefined : onClose} aria-labelledby="invite-title" slotProps={{ transition: { onExited: reset } }}>
      {created ? (
        <>
          <DialogTitle id="invite-title">Invitation ready</DialogTitle>
          <DialogContent>
            <Typography variant="body1" color="text.secondary">
              Send this link to <b>{created.email}</b>. Meridian does not email invitations yet, so share it yourself — by email or chat.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 4, alignItems: 'center', border: 1, borderColor: 'border.strong', borderRadius: '8px', bgcolor: 'surface.subtle', pl: 3, pr: 1, py: 1.5 }}>
              <Mono sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{created.inviteUrl}</Mono>
              <CopyButton value={created.inviteUrl ?? ''} label="Copy invitation link" />
            </Stack>
            <Alert severity="info" sx={{ mt: 4 }}>
              The link works once, expires on {shortDate(created.expiresAt)} (7 days), and is shown only now. They will join as {created.role.name}.
            </Alert>
            <GuestNote sx={{ mt: 3 }}>
              Guest mode: this invitation exists only in your browser. Nobody else can open the link, and no account can be created without a server.
            </GuestNote>
          </DialogContent>
          <DialogActions>
            <Button onClick={reset}>Invite someone else</Button>
            <Button variant="contained" onClick={onClose}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <form noValidate onSubmit={form.handleSubmit((values) => invite.mutate(values))}>
          <DialogTitle id="invite-title">Invite a member to {orgName}</DialogTitle>
          <DialogContent>
            <FormError error={invite.error instanceof ApiError && Object.keys(invite.error.fieldErrors).length ? null : invite.error} />
            <Stack spacing={4} sx={{ mt: 2 }}>
              <TextField label="Email address" type="email" autoFocus autoComplete="off" error={!!errors.email} helperText={errors.email?.message} {...form.register('email')} />
              <Controller
                control={form.control}
                name="roleId"
                render={({ field }) => (
                  <TextField select label="Role" error={!!errors.roleId} helperText={errors.roleId?.message ?? role?.description} {...field}>
                    {roles.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={invite.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" loading={invite.isPending}>
              Create invitation
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}

export default function UsersPage() {
  const ws = useWorkspace();
  const orgId = ws.org.id;
  const me = useAppSelector((s) => s.auth.user);
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const canManage = ws.can('org.members.manage');

  const members = useQuery({ queryKey: ['members', orgId], queryFn: () => api.get<{ items: Member[] }>(`${ws.orgBase}/members`).then((r) => r.items) });
  const roles = useQuery({ queryKey: ['roles', orgId], queryFn: () => api.get<{ items: Role[] }>(`${ws.orgBase}/roles`).then((r) => r.items) });
  const invitations = useQuery({
    queryKey: ['invitations', orgId],
    queryFn: () => api.get<{ items: Invitation[] }>(`${ws.orgBase}/invitations`).then((r) => r.items),
    enabled: canManage,
  });

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; member: Member } | null>(null);
  // Kept separately so the menu keeps its content while it animates closed.
  const [menuOpen, setMenuOpen] = useState(false);

  const refreshMembers = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['members', orgId] }), queryClient.invalidateQueries({ queryKey: ['roles', orgId] })]);

  const change = useMutation({
    mutationFn: ({ member, patch }: { member: Member; patch: { roleId?: string; status?: 'ACTIVE' | 'SUSPENDED' }; message: string }) => api.patch(`${ws.orgBase}/members/${member.id}`, patch),
    onSuccess: async (_, variables) => {
      toast.success(variables.message);
      await refreshMembers();
    },
    // The API explains itself here, e.g. "An organization must keep at least one active administrator".
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = async (member: Member) => {
    const ok = await confirm({
      title: `Remove ${member.user.name}?`,
      message: (
        <>
          <b>{member.user.email}</b> loses access to {ws.org.name} and all of its projects immediately. Content they created stays.
        </>
      ),
      destructive: true,
      confirmLabel: 'Remove member',
      onConfirm: () => api.delete(`${ws.orgBase}/members/${member.id}`),
    });
    if (ok) {
      toast.success(`${member.user.name} was removed`);
      await refreshMembers();
    }
  };

  const revoke = async (invitation: Invitation) => {
    const ok = await confirm({
      title: 'Revoke this invitation?',
      message: (
        <>
          The link sent to <b>{invitation.email}</b> stops working.
        </>
      ),
      destructive: true,
      confirmLabel: 'Revoke',
      onConfirm: () => api.delete(`${ws.orgBase}/invitations/${invitation.id}`),
    });
    if (ok) {
      toast.success('Invitation revoked');
      await queryClient.invalidateQueries({ queryKey: ['invitations', orgId] });
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (members.data ?? []).filter((m) => (!roleFilter || m.role.id === roleFilter) && (!term || m.user.name.toLowerCase().includes(term) || m.user.email.toLowerCase().includes(term)));
  }, [members.data, search, roleFilter]);
  const roleList = roles.data ?? [];
  const pending = invitations.data ?? [];
  const activeCount = (members.data ?? []).filter((m) => m.status === 'ACTIVE').length;

  return (
    <Page>
      <PageHeader
        title="Users"
        description={`People who can work in ${ws.org.name}. A member's role applies to every project in the organization.`}
        actions={
          canManage ? (
            <Button variant="contained" startIcon={<PersonAddAltOutlined />} onClick={() => setInviteOpen(true)} disabled={roleList.length === 0}>
              Invite member
            </Button>
          ) : undefined
        }
      />

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        <Stack direction="row" sx={{ p: 3, gap: 2, flexWrap: 'wrap', alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email…" width={280} />
          <TextField select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} sx={{ width: 220 }} slotProps={{ select: { displayEmpty: true }, htmlInput: { 'aria-label': 'Filter by role' } }}>
            <MenuItem value="">All roles</MenuItem>
            {roleList.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.name}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ flex: 1 }} />
          {members.data && (
            <Typography variant="caption" color="text.secondary">
              {members.data.length} member{members.data.length === 1 ? '' : 's'} · {activeCount} active
            </Typography>
          )}
        </Stack>

        {members.isLoading ? (
          <TableSkeleton rows={5} columns={5} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState compact icon={<SearchOffOutlined />} title="No members match" description="Try a different name, email or role." />
        ) : (
          <TableContainer>
            <Table aria-label="Members">
              <TableHead>
                <TableRow>
                  <TableCell>Member</TableCell>
                  <TableCell sx={{ width: 260 }}>Role</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Last sign-in</TableCell>
                  <TableCell>Joined</TableCell>
                  {canManage && <TableCell align="right" sx={{ width: 56 }} />}
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((member) => {
                  const self = member.user.id === me?.id;
                  const suspended = member.status === 'SUSPENDED' || !member.user.isActive;
                  return (
                    <TableRow key={member.id} hover>
                      <TableCell>
                        <Stack direction="row" spacing={3} sx={{ alignItems: 'center', opacity: suspended ? 0.6 : 1 }}>
                          <UserAvatar name={member.user.name} size={30} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                              {member.user.name}
                              {self && (
                                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                                  You
                                </Typography>
                              )}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {member.user.email}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <TextField
                            select
                            value={member.role.id}
                            disabled={change.isPending}
                            onChange={(e) => {
                              const next = roleList.find((r) => r.id === e.target.value);
                              if (next && next.id !== member.role.id) change.mutate({ member, patch: { roleId: next.id }, message: `${member.user.name} is now ${next.name}` });
                            }}
                            slotProps={{ htmlInput: { 'aria-label': `Role of ${member.user.name}` } }}
                          >
                            {/* Keeps the current role selectable even while the role list is still loading. */}
                            {!roleList.some((r) => r.id === member.role.id) && <MenuItem value={member.role.id}>{member.role.name}</MenuItem>}
                            {roleList.map((r) => (
                              <MenuItem key={r.id} value={r.id}>
                                {r.name}
                              </MenuItem>
                            ))}
                          </TextField>
                        ) : (
                          member.role.name
                        )}
                      </TableCell>
                      <TableCell>{suspended ? <Pill label="Suspended" fg="warning.dark" bg="warning.light" dot /> : <Pill label="Active" fg="success.dark" bg="success.light" dot />}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{member.user.lastLoginAt ? <RelativeTime value={member.user.lastLoginAt} /> : 'Never'}</TableCell>
                      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{shortDate(member.createdAt)}</TableCell>
                      {canManage && (
                        <TableCell align="right">
                          <Tooltip title={self ? 'You cannot suspend or remove yourself' : ''}>
                            <span>
                              <IconButton aria-label={`Actions for ${member.user.name}`} aria-haspopup="menu" disabled={self} onClick={(e) => {
                                  setMenu({ anchor: e.currentTarget, member });
                                  setMenuOpen(true);
                                }}>
                                <MoreHorizOutlined />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {canManage && (
        <Section title="Pending invitations" description="People who have been invited but have not joined yet." flush sx={{ mt: 6 }}>
          {invitations.isLoading ? (
            <TableSkeleton rows={2} columns={4} />
          ) : invitations.isError ? (
            <ErrorState compact error={invitations.error} onRetry={() => void invitations.refetch()} />
          ) : pending.length === 0 ? (
            <EmptyState
              compact
              icon={<MailOutlined />}
              title="No pending invitations"
              description="Invite a colleague and their invitation will appear here until they accept it."
              action={
                <Button variant="outlined" startIcon={<PersonAddAltOutlined />} onClick={() => setInviteOpen(true)} disabled={roleList.length === 0}>
                  Invite member
                </Button>
              }
            />
          ) : (
            <TableContainer>
              <Table aria-label="Pending invitations">
                <TableHead>
                  <TableRow>
                    <TableCell>Email</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Invited</TableCell>
                    <TableCell>Expires</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pending.map((invitation) => (
                    <TableRow key={invitation.id} hover>
                      <TableCell sx={{ fontWeight: 500 }}>{invitation.email}</TableCell>
                      <TableCell>{invitation.role.name}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        <RelativeTime value={invitation.createdAt} />
                      </TableCell>
                      <TableCell>{invitation.expired ? <Pill label="Expired" fg="error.dark" bg="error.light" dot /> : <Typography variant="body2" color="text.secondary">{shortDate(invitation.expiresAt)}</Typography>}</TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => void revoke(invitation)} sx={{ color: 'error.main' }}>
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Section>
      )}

      {!canManage && members.data && (
        <Stack direction="row" spacing={2} sx={{ mt: 4, alignItems: 'center', color: 'text.secondary' }}>
          <PeopleAltOutlined sx={{ fontSize: 16 }} />
          <Typography variant="caption">Only organization administrators can invite people or change roles.</Typography>
        </Stack>
      )}

      <Menu anchorEl={menu?.anchor} open={menuOpen} onClose={() => setMenuOpen(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {menu?.member.status === 'ACTIVE' ? (
          <MenuItem
            onClick={() => {
              const member = menu.member;
              setMenuOpen(false);
              change.mutate({ member, patch: { status: 'SUSPENDED' }, message: `${member.user.name} was suspended` });
            }}
          >
            <ListItemIcon>
              <BlockOutlined />
            </ListItemIcon>
            Suspend access
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              const member = menu?.member;
              setMenuOpen(false);
              if (member) change.mutate({ member, patch: { status: 'ACTIVE' }, message: `${member.user.name} was reactivated` });
            }}
          >
            <ListItemIcon>
              <CheckCircleOutlined />
            </ListItemIcon>
            Reactivate
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            const member = menu?.member;
            setMenuOpen(false);
            if (member) void remove(member);
          }}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <PersonRemoveOutlined />
          </ListItemIcon>
          Remove from organization
        </MenuItem>
      </Menu>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} roles={roleList} orgBase={ws.orgBase} orgName={ws.org.name} onInvited={() => void queryClient.invalidateQueries({ queryKey: ['invitations', orgId] })} />
    </Page>
  );
}
