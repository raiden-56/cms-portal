import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setAccessToken } from '@/lib/api';
import { DEMO_ONLY, isGuestMode, setGuestMode } from '@/lib/guest';
import { signedOut, useAppDispatch } from '@/store';

/**
 * Ends the session on the server, forgets everything cached for it and returns to sign-in.
 * In guest mode there is no server session: signing out leaves guest mode. The demo data
 * stays in the browser, so entering again continues where the guest left off.
 */
export function useSignOut() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    if (isGuestMode()) {
      // A demo-only build has nothing to sign out to; it simply returns to the workspace.
      if (DEMO_ONLY) {
        navigate('/', { replace: true });
        return;
      }
      setGuestMode(false);
    } else {
      // Signing out locally still happens if the server cannot be reached.
      await api.post('/auth/logout').catch(() => undefined);
    }
    setAccessToken(null);
    queryClient.clear();
    dispatch(signedOut());
    navigate('/login', { replace: true });
  };
}
