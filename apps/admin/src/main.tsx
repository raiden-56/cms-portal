import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { StrictMode, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { router } from '@/app/router';
import { ConfirmProvider, Toaster } from '@/components/feedback';
import { refreshSession, setRefreshedHandler, setSessionExpiredHandler } from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { signedIn, signedOut, store } from '@/store';
import { theme } from '@/theme/theme';

setSessionExpiredHandler(() => {
  queryClient.clear();
  store.dispatch(signedOut());
});
// Memberships can change (role updated, added to an organization); a refresh brings the latest.
setRefreshedHandler((payload) => store.dispatch(signedIn(payload)));

function Root() {
  useEffect(() => {
    // Restore the session from the httpOnly cookie, if there is one.
    void refreshSession().then((payload) => {
      if (!payload) store.dispatch(signedOut());
    });
  }, []);
  return <RouterProvider router={router} />;
}

// Reuse the root across hot reloads in development instead of mounting a second one.
const container = document.getElementById('root') as HTMLElement & { __root?: Root };
const root = container.__root ?? (container.__root = createRoot(container));

root.render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme} defaultMode="system" disableTransitionOnChange>
          <CssBaseline enableColorScheme />
          {/* Animations honour the operating system's reduced-motion setting everywhere. */}
          <MotionConfig reducedMotion="user">
            <ConfirmProvider>
              <Root />
              <Toaster onNavigate={(href) => void router.navigate(href)} />
            </ConfirmProvider>
          </MotionConfig>
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
);
