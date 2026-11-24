/**
 * Guest mode in the interface: entering and leaving it, the banner that marks it, and the
 * notes that say plainly what cannot work without a server.
 */
import { type ReactNode, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import ScienceOutlined from '@mui/icons-material/ScienceOutlined';
import { useConfirm } from '@/components/feedback';
import { EmptyState } from '@/components/ui';
import { useSignOut } from '@/features/auth/useSignOut';
import { refreshSession } from '@/lib/api';
import { DEMO_ONLY, isGuestMode, loadDemo, setGuestMode } from '@/lib/guest';
import { toast, useAppSelector } from '@/store';

/** Starts a guest session — no credentials — and opens the demo workspace. */
export function useEnterGuestMode() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    setGuestMode(true);
    queryClient.clear();
    // In guest mode this resolves from the in-browser demo backend and signs the guest in.
    const payload = await refreshSession();
    if (!payload) {
      setGuestMode(false);
      throw new Error('The demo could not be started in this browser. Reload the page and try again.');
    }
    navigate('/', { replace: true });
  };
}

/** Asks first, then throws the guest's changes away and reopens the freshly seeded workspace. */
export function useResetDemo() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    const done = await confirm({
      title: 'Reset demo data?',
      message: 'Everything you created or changed in guest mode is deleted from this browser, and the original demo content is restored. This cannot be undone.',
      confirmLabel: 'Reset demo data',
      destructive: true,
      onConfirm: async () => (await loadDemo()).resetDemo(),
    });
    if (!done) return;
    queryClient.clear();
    await refreshSession();
    navigate('/', { replace: true });
    toast.success('Demo data restored');
  };
}

/** The slim bar above the workspace that says where the data lives and offers the way out. */
export function GuestBanner() {
  const reset = useResetDemo();
  // Signing out of a guest session is leaving guest mode; the demo data stays in this browser.
  const exit = useSignOut();
  const [inMemory, setInMemory] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDemo().then((demo) => active && setInMemory(demo.persistence() === 'memory'));
    return () => {
      active = false;
    };
  }, []);

  if (!isGuestMode()) return null;
  const link = { minWidth: 0, px: 1.5, py: 0, height: 22, fontSize: '0.75rem', fontWeight: 600, color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', '&:hover': { textDecoration: 'underline', bgcolor: 'action.hover' } } as const;
  return (
    <Box
      role="status"
      aria-label="Guest mode"
      sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 30, px: { xs: 2, md: 4 }, py: 0.5, borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle', color: 'text.secondary' }}
    >
      <ScienceOutlined sx={{ fontSize: 15, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ flex: 1, minWidth: 0, color: 'inherit' }} noWrap>
        Guest mode — demo data, {inMemory ? 'kept only until this tab closes (browser storage is unavailable)' : 'saved only in this browser'}
      </Typography>
      <Button size="small" sx={link} onClick={() => void reset()}>
        Reset demo data
      </Button>
      {!DEMO_ONLY && (
        <Button size="small" sx={link} onClick={() => void exit()}>
          Exit guest mode
        </Button>
      )}
    </Box>
  );
}

/** An inline note, shown only in guest mode, for things that behave differently without a server. */
export function GuestNote({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  if (!isGuestMode()) return null;
  return (
    <Alert severity="info" icon={<ScienceOutlined fontSize="inherit" />} sx={sx}>
      {children}
    </Alert>
  );
}

/**
 * Demo-only builds have no server, so the sign-in, sign-up and invitation addresses lead
 * straight into the guest workspace instead of showing forms that cannot work.
 */
export function GuestEntry() {
  const status = useAppSelector((s) => s.auth.status);
  const [retrying, setRetrying] = useState(false);
  if (status === 'authenticated') return <Navigate to="/" replace />;
  if (status === 'restoring' || retrying) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }} role="status" aria-label="Starting the demo">
        <CircularProgress size={22} color="secondary" thickness={5} />
      </Box>
    );
  }
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <EmptyState
        icon={<ScienceOutlined />}
        title="The demo could not be started"
        description="The demo runs entirely in your browser and could not load its data. Check that the page finished loading, then try again."
        action={
          <Button
            variant="contained"
            onClick={() => {
              setRetrying(true);
              void refreshSession().finally(() => setRetrying(false));
            }}
          >
            Try again
          </Button>
        }
      />
    </Box>
  );
}
