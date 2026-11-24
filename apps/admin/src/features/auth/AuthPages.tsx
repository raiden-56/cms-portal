import { type ReactNode, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { FormError } from '@/components/ui';
import { useEnterGuestMode } from '@/features/guest/guest';
import { ApiError, type AuthPayload, api, setAccessToken } from '@/lib/api';
import { signedIn, useAppDispatch } from '@/store';

export function Wordmark({ inverse }: { inverse?: boolean }) {
  return (
    <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 28, height: 28, borderRadius: '8px', bgcolor: inverse ? '#F7F7F5' : '#1F1F1D', display: 'grid', placeItems: 'center' }}>
        <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M6 24V8l10 11L26 8v16" fill="none" stroke={inverse ? '#1F6F5C' : '#52B89E'} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Box>
      <Typography sx={{ fontSize: '1.0625rem', fontWeight: 600, letterSpacing: '-0.02em', color: inverse ? '#F7F7F5' : 'text.primary' }}>Meridian</Typography>
    </Stack>
  );
}

const POINTS = [
  ['Model anything', 'Content types, components and dynamic zones — no code, no migrations to write.'],
  ['Build pages visually', 'Compose pages from blocks. Your frontend renders them with its own components.'],
  ['Publish everywhere at once', 'One publish reaches every connected app through REST, GraphQL, webhooks and WebSockets.'],
];

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100%', display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(380px, 5fr) 7fr' }, bgcolor: 'background.paper' }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 10,
          color: '#EDEDEA',
          bgcolor: '#1B1B19',
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(237,237,234,0.07) 1px, transparent 0)',
          backgroundSize: '22px 22px',
        }}
      >
        <Wordmark inverse />
        <Box>
          <Typography sx={{ fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.2, maxWidth: 380 }}>
            One source of truth for every website, app and screen.
          </Typography>
          <Stack spacing={5} sx={{ mt: 9, maxWidth: 380 }}>
            {POINTS.map(([heading, body]) => (
              <Box key={heading} sx={{ pl: 4, borderLeft: '2px solid #2E8A73' }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>{heading}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: '#A7A59E', mt: 0.5, lineHeight: 1.55 }}>{body}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
        <Typography sx={{ fontSize: '0.75rem', color: '#6B6963' }}>Headless content platform</Typography>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 6, sm: 10 } }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Box sx={{ display: { md: 'none' }, mb: 10 }}>
            <Wordmark />
          </Box>
          <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
            {title}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, mb: 7 }}>
            {subtitle}
          </Typography>
          {children}
          {footer && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 6 }}>
              {footer}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function PasswordField({ label, error, helperText, autoComplete, inputProps }: { label: string; error?: boolean; helperText?: ReactNode; autoComplete: string; inputProps: object }) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      label={label}
      type={visible ? 'text' : 'password'}
      error={error}
      helperText={helperText}
      autoComplete={autoComplete}
      slotProps={{
        htmlInput: inputProps,
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" edge="end" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible((v) => !v)}>
                {visible ? <VisibilityOffOutlined /> : <VisibilityOutlined />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

/**
 * Where to go after signing in: the workspace page that sent the visitor to sign-in, or home.
 * Only in-app workspace paths are honoured, so a crafted link cannot redirect anywhere else.
 */
export function returnPath(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/w/') ? from : '/';
}

function useSignIn() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  return (payload: AuthPayload) => {
    setAccessToken(payload.accessToken);
    dispatch(signedIn(payload));
    navigate(returnPath(location.state), { replace: true });
  };
}

/** Maps server-side field errors onto the matching form fields. */
function applyServerErrors(err: unknown, setError: (name: any, error: { message: string }) => void, fields: string[]) {
  if (!(err instanceof ApiError)) return;
  for (const [path, message] of Object.entries(err.fieldErrors)) if (fields.includes(path)) setError(path, { message });
}

const email = z.string().trim().min(1, 'Enter your email address').email('Enter a valid email address');
const newPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Include both letters and numbers');

const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password') });
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const signIn = useSignIn();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<{ allowRegistration: boolean }>('/auth/config'), staleTime: Infinity });
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const login = useMutation({ mutationFn: (values: LoginValues) => api.post<AuthPayload>('/auth/login', values), onSuccess: signIn });
  const enterGuestMode = useEnterGuestMode();
  const guest = useMutation({ mutationFn: enterGuestMode });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Enter your details to continue."
      footer={
        config.data?.allowRegistration !== false && (
          <>
            New to Meridian?{' '}
            <Link component={RouterLink} to="/register">
              Create an organization
            </Link>
          </>
        )
      }
    >
      <form noValidate onSubmit={form.handleSubmit((values) => login.mutate(values))}>
        <FormError error={login.error} />
        <Stack spacing={4}>
          <TextField label="Email" type="email" autoComplete="email" autoFocus error={!!form.formState.errors.email} helperText={form.formState.errors.email?.message} {...form.register('email')} />
          <PasswordField label="Password" autoComplete="current-password" error={!!form.formState.errors.password} helperText={form.formState.errors.password?.message} inputProps={form.register('password')} />
          <Button type="submit" variant="contained" size="large" loading={login.isPending}>
            Sign in
          </Button>
        </Stack>
      </form>
      <Divider sx={{ my: 5, color: 'text.disabled', fontSize: '0.75rem' }}>or</Divider>
      <FormError error={guest.error} />
      <Button fullWidth variant="outlined" size="large" loading={guest.isPending} onClick={() => guest.mutate()}>
        Explore as guest
      </Button>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2, textAlign: 'center' }}>
        No account needed. A demo workspace opens in this browser — nothing you do in it is sent to a server.
      </Typography>
    </AuthLayout>
  );
}

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  organizationName: z.string().trim().min(2, 'Enter your organization’s name').max(120),
  email,
  password: newPassword,
});
type RegisterValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const signIn = useSignIn();
  const form = useForm<RegisterValues>({ resolver: zodResolver(registerSchema), defaultValues: { name: '', organizationName: '', email: '', password: '' } });
  const { errors } = form.formState;
  const signUp = useMutation({
    mutationFn: (values: RegisterValues) => api.post<AuthPayload>('/auth/register', values),
    onSuccess: signIn,
    onError: (err) => applyServerErrors(err, form.setError, ['name', 'organizationName', 'email', 'password']),
  });

  return (
    <AuthLayout
      title="Create your organization"
      subtitle="You will be its administrator and can invite your team afterwards."
      footer={
        <>
          Already have an account?{' '}
          <Link component={RouterLink} to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={form.handleSubmit((values) => signUp.mutate(values))}>
        <FormError error={signUp.error instanceof ApiError && Object.keys(signUp.error.fieldErrors).length ? null : signUp.error} />
        <Stack spacing={4}>
          <TextField label="Your name" autoComplete="name" autoFocus error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
          <TextField label="Organization name" autoComplete="organization" error={!!errors.organizationName} helperText={errors.organizationName?.message} {...form.register('organizationName')} />
          <TextField label="Work email" type="email" autoComplete="email" error={!!errors.email} helperText={errors.email?.message} {...form.register('email')} />
          <PasswordField label="Password" autoComplete="new-password" error={!!errors.password} helperText={errors.password?.message ?? 'At least 10 characters, with letters and numbers'} inputProps={form.register('password')} />
          <Button type="submit" variant="contained" size="large" loading={signUp.isPending}>
            Create organization
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}

interface InvitationInfo {
  email: string;
  organization: string;
  role: string;
  accountExists: boolean;
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const signIn = useSignIn();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationInfo>(`/auth/invitations/${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  const exists = invitation.data?.accountExists ?? false;
  const schema = z.object({
    name: exists ? z.string().optional() : z.string().trim().min(1, 'Enter your name').max(120),
    password: exists ? z.string().min(1, 'Enter your password') : newPassword,
  });
  const form = useForm<{ name?: string; password: string }>({ resolver: zodResolver(schema), defaultValues: { name: '', password: '' } });
  const { errors } = form.formState;
  const accept = useMutation({
    mutationFn: (values: { name?: string; password: string }) =>
      api.post<AuthPayload>(`/auth/invitations/${encodeURIComponent(token)}/accept`, exists ? { password: values.password } : values),
    onSuccess: signIn,
  });

  if (!token || invitation.isError) {
    return (
      <AuthLayout title="This invitation is no longer valid" subtitle="It may have expired or already been used. Ask an administrator of the organization to send a new one.">
        <Button component={RouterLink} to="/login" variant="outlined">
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }
  if (invitation.isLoading || !invitation.data) {
    return (
      <AuthLayout title="Checking your invitation" subtitle="One moment…">
        <CircularProgress size={22} color="secondary" />
      </AuthLayout>
    );
  }
  const info = invitation.data;
  return (
    <AuthLayout
      title={`Join ${info.organization}`}
      subtitle={
        <>
          You have been invited as <b>{info.role}</b> using <b>{info.email}</b>.{' '}
          {exists ? 'Enter your existing password to accept.' : 'Set up your account to accept.'}
        </>
      }
    >
      <form noValidate onSubmit={form.handleSubmit((values) => accept.mutate(values))}>
        <FormError error={accept.error} />
        <Stack spacing={4}>
          {!exists && <TextField label="Your name" autoComplete="name" autoFocus error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />}
          <PasswordField
            label={exists ? 'Password' : 'Choose a password'}
            autoComplete={exists ? 'current-password' : 'new-password'}
            error={!!errors.password}
            helperText={errors.password?.message ?? (exists ? undefined : 'At least 10 characters, with letters and numbers')}
            inputProps={form.register('password')}
          />
          <Button type="submit" variant="contained" size="large" loading={accept.isPending}>
            Accept invitation
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
