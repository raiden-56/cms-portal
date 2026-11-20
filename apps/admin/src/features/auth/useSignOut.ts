import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setAccessToken } from '@/lib/api';
import { signedOut, useAppDispatch } from '@/store';

/** Ends the session on the server, forgets everything cached for it and returns to sign-in. */
export function useSignOut() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async () => {
    // Signing out locally still happens if the server cannot be reached.
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    queryClient.clear();
    dispatch(signedOut());
    navigate('/login', { replace: true });
  };
}
