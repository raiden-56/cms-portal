import { type ReactNode, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ComputerOutlined from '@mui/icons-material/ComputerOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import PhoneIphoneOutlined from '@mui/icons-material/PhoneIphoneOutlined';
import TerminalOutlined from '@mui/icons-material/TerminalOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { useCrumbs } from '@/app/shell';
import { useWorkspace } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, FormError, Mono, Page, PageHeader, Pill, RelativeTime, Section, TableSkeleton, UserAvatar } from '@/components/ui';
import { ApiError, type AuthPayload, api } from '@/lib/api';
import { fullDateTime, shortDate } from '@/lib/format';
import type { SessionInfo } from '@/lib/types';
import { signedIn, store, toast, useAppSelector } from '@/store';

interface LoginEvent {
  id: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** A loose, human-friendly reading of a User-Agent string. */
function describeAgent(userAgent: string | null): { label: string; kind: 'desktop' | 'mobile' | 'client' } {
  const ua = userAgent ?? '';
  if (!ua) return { label: 'Unknown device', kind: 'desktop' };
  if (/curl|node|undici|axios|okhttp|python|postman|insomnia|go-http/i.test(ua) && !/Mozilla/i.test(ua)) return { label: 'API client or script', kind: 'client' };
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows NT/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: os ? `${browser} on ${os}` : browser, kind: /Android|iPhone|iPad|iPod|Mobile/.test(ua) ? 'mobile' : 'desktop' };
}

const REASONS: Record<string, string> = { invalid_credentials: 'Wrong password', deactivated: 'Account deactivated' };

function PasswordInput({ label, error, helperText, autoComplete, registration }: { label: string; error?: boolean; helperText?: ReactNode; autoComplete: string; registration: object }) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      error={error}
      helperText={helperText}
      autoComplete={autoComplete}
      slotProps={{
        htmlInput: registration,
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" edge="end" aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} onClick={() => setVisible((v) => !v)}>
                {visible ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const profileSchema = z.object({ name: z.string().trim().min(1, 'Enter your name').max(120, 'Keep it under 120 characters') });
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileSection() {
  const user = useAppSelector((s) => s.auth.user);
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? '' } });
  const { errors, isDirty } = form.formState;
  const name = form.watch('name');

  const save = useMutation({
    mutationFn: (values: ProfileValues) => api.patch<Pick<AuthPayload, 'user' | 'memberships'>>('/auth/me', values),
    onSuccess: (payload) => {
      store.dispatch(signedIn(payload));
      form.reset({ name: payload.user.name });
      toast.success('Profile updated');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fieldErrors.name) form.setError('name', { message: err.fieldErrors.name });
    },
  });

  return (
    <Section title="Profile" description="Your name is shown on content you edit, in comments and in the audit log.">
      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <FormError error={save.error instanceof ApiError && save.error.fieldErrors.name ? null : save.error} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={5} sx={{ alignItems: { sm: 'flex-start' } }}>
          <UserAvatar name={name || user?.name} size={56} />
          <Stack spacing={4} sx={{ flex: 1, maxWidth: 480 }}>
            <TextField label="Name" autoComplete="name" error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
            <TextField label="Email" value={user?.email ?? ''} disabled helperText="Your email identifies your account and cannot be changed here." />
            <Typography variant="caption" color="text.secondary">
              Member since {shortDate(user?.createdAt)}
              {user?.lastLoginAt ? ` · last sign-in ${fullDateTime(user.lastLoginAt)}` : ''}
            </Typography>
            <Stack direction="row" spacing={2}>
              <Button type="submit" variant="contained" disabled={!isDirty} loading={save.isPending}>
                Save profile
              </Button>
              <Button disabled={!isDirty || save.isPending} onClick={() => form.reset()}>
                Discard
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </form>
    </Section>
  );
}

// ─── Password ────────────────────────────────────────────────────────────────

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(200)
      .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include both letters and numbers'),
    confirmPassword: z.string().min(1, 'Repeat the new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ['confirmPassword'], message: 'The passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password you are not using now' });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const queryClient = useQueryClient();
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });
  const { errors } = form.formState;
  // Remounting the inputs after a successful change returns them to a truly empty state.
  const [formKey, setFormKey] = useState(0);

  const change = useMutation({
    mutationFn: (values: PasswordValues) => api.post('/auth/me/password', { currentPassword: values.currentPassword, newPassword: values.newPassword }),
    onSuccess: async () => {
      form.reset();
      setFormKey((k) => k + 1);
      toast.success('Password changed. Your other devices were signed out.');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      if (err.fieldErrors.newPassword) form.setError('newPassword', { message: err.fieldErrors.newPassword });
      else if (err.status === 400) form.setError('currentPassword', { message: err.message });
    },
  });
  const inline = change.error instanceof ApiError && (change.error.status === 400 || !!change.error.fieldErrors.newPassword);

  return (
    <Section title="Password" description="Changing your password signs you out everywhere except this device.">
      <form noValidate onSubmit={form.handleSubmit((values) => change.mutate(values))}>
        <FormError error={inline ? null : change.error} />
        <Stack key={formKey} spacing={4} sx={{ maxWidth: 420 }}>
          <PasswordInput label="Current password" autoComplete="current-password" error={!!errors.currentPassword} helperText={errors.currentPassword?.message} registration={form.register('currentPassword')} />
          <PasswordInput label="New password" autoComplete="new-password" error={!!errors.newPassword} helperText={errors.newPassword?.message ?? 'At least 10 characters, with letters and numbers'} registration={form.register('newPassword')} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" error={!!errors.confirmPassword} helperText={errors.confirmPassword?.message} registration={form.register('confirmPassword')} />
          <Box>
            <Button type="submit" variant="contained" loading={change.isPending}>
              Change password
            </Button>
          </Box>
        </Stack>
      </form>
    </Section>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────────────

function DeviceIcon({ kind }: { kind: 'desktop' | 'mobile' | 'client' }) {
  const Icon = kind === 'mobile' ? PhoneIphoneOutlined : kind === 'client' ? TerminalOutlined : ComputerOutlined;
  return (
    <Box sx={{ width: 32, height: 32, borderRadius: '8px', bgcolor: 'surface.sunken', color: 'text.secondary', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <Icon sx={{ fontSize: 17 }} />
    </Box>
  );
}

function SessionsSection() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ items: SessionInfo[] }>('/auth/me/sessions').then((r) => r.items) });
  const items = sessions.data ?? [];
  const others = items.filter((s) => !s.current);

  const revoke = async (session: SessionInfo) => {
    const ok = await confirm({
      title: 'Sign out this device?',
      message: `${describeAgent(session.userAgent).label}${session.ip ? ` (${session.ip})` : ''} will need to sign in again.`,
      destructive: true,
      confirmLabel: 'Sign out device',
      onConfirm: () => api.delete(`/auth/me/sessions/${session.id}`),
    });
    if (ok) {
      toast.success('Device signed out');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  };

  const revokeOthers = async () => {
    const ok = await confirm({
      title: `Sign out ${others.length} other device${others.length === 1 ? '' : 's'}?`,
      message: 'Only this device stays signed in.',
      destructive: true,
      confirmLabel: 'Sign out others',
      onConfirm: async () => {
        for (const session of others) await api.delete(`/auth/me/sessions/${session.id}`);
      },
    });
    if (ok) {
      toast.success('Other devices signed out');
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  };

  return (
    <Section
      flush
      title="Active sessions"
      description="Devices currently signed in to your account. Sign out any you do not recognise, then change your password."
      action={
        others.length > 0 ? (
          <Button variant="outlined" onClick={() => void revokeOthers()}>
            Sign out other devices
          </Button>
        ) : undefined
      }
    >
      {sessions.isLoading ? (
        <TableSkeleton rows={2} columns={4} />
      ) : sessions.isError ? (
        <ErrorState compact error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <TableContainer>
          <Table aria-label="Active sessions">
            <TableHead>
              <TableRow>
                <TableCell>Device</TableCell>
                <TableCell>IP address</TableCell>
                <TableCell>Last active</TableCell>
                <TableCell>Signed in</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((session) => {
                const device = describeAgent(session.userAgent);
                return (
                  <TableRow key={session.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
                        <DeviceIcon kind={device.kind} />
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {device.label}
                        </Typography>
                        {session.current && <Pill label="This device" fg="success.dark" bg="success.light" dot />}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Mono sx={{ color: 'text.secondary' }}>{session.ip ?? '—'}</Mono>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{session.current ? 'Now' : <RelativeTime value={session.lastUsedAt} />}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{shortDate(session.createdAt)}</TableCell>
                    <TableCell align="right">
                      {!session.current && (
                        <Button size="small" onClick={() => void revoke(session)} sx={{ color: 'error.main' }}>
                          Sign out
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

// ─── Sign-in history ─────────────────────────────────────────────────────────

function HistorySection() {
  const history = useQuery({ queryKey: ['login-history'], queryFn: () => api.get<{ items: LoginEvent[] }>('/auth/me/login-history').then((r) => r.items) });
  const items = history.data ?? [];
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, 8);

  return (
    <Section flush title="Sign-in history" description="The most recent attempts to sign in to your account, including failed ones.">
      {history.isLoading ? (
        <TableSkeleton rows={4} columns={4} />
      ) : history.isError ? (
        <ErrorState compact error={history.error} onRetry={() => void history.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState compact icon={<HistoryOutlined />} title="No sign-ins recorded yet" description="Sign-ins from now on appear here." />
      ) : (
        <>
          <TableContainer>
            <Table size="small" aria-label="Sign-in history">
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>Device</TableCell>
                  <TableCell>IP address</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((event) => (
                  <TableRow key={event.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fullDateTime(event.createdAt)}</TableCell>
                    <TableCell>
                      {event.success ? <Pill label="Signed in" fg="success.dark" bg="success.light" dot /> : <Pill label={`Failed · ${REASONS[event.reason ?? ''] ?? 'Rejected'}`} fg="error.dark" bg="error.light" dot />}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{describeAgent(event.userAgent).label}</TableCell>
                    <TableCell>
                      <Mono sx={{ color: 'text.secondary' }}>{event.ip ?? '—'}</Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {items.length > 8 && (
            <Box sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'border.subtle' }}>
              <Button size="small" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} sx={{ color: 'text.secondary' }}>
                {expanded ? 'Show fewer' : `Show all ${items.length}`}
              </Button>
            </Box>
          )}
        </>
      )}
    </Section>
  );
}

// ─── Organizations ───────────────────────────────────────────────────────────

function OrganizationsSection() {
  const ws = useWorkspace();
  const memberships = useAppSelector((s) => s.auth.memberships);
  return (
    <Section flush title="Organizations" description="Organizations you belong to and your role in each.">
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {memberships.map((membership) => {
          const current = membership.organization.id === ws.org.id;
          return (
            <Stack key={membership.membershipId} component="li" direction="row" spacing={3} sx={{ px: 5, py: 3, alignItems: 'center', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
              <Box sx={{ width: 32, height: 32, borderRadius: '8px', bgcolor: 'surface.sunken', display: 'grid', placeItems: 'center', fontWeight: 600, fontSize: '0.8125rem', color: 'text.secondary', flexShrink: 0 }}>
                {membership.organization.name.charAt(0).toUpperCase()}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                  {membership.organization.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {membership.role.name} · {membership.permissions.length} permission{membership.permissions.length === 1 ? '' : 's'}
                </Typography>
              </Box>
              {current ? (
                <Pill label="Current" />
              ) : (
                <Button size="small" variant="outlined" component={RouterLink} to={`/w/${membership.organization.slug}`}>
                  Switch
                </Button>
              )}
            </Stack>
          );
        })}
      </Box>
    </Section>
  );
}

export default function AccountPage() {
  useCrumbs([{ label: 'Account & security' }]);
  return (
    <Page width={920}>
      <PageHeader title="Account & security" description="Your profile, password and the devices signed in to your account." />
      <Stack spacing={5}>
        <ProfileSection />
        <PasswordSection />
        <SessionsSection />
        <HistorySection />
        <OrganizationsSection />
      </Stack>
    </Page>
  );
}
