import { type ReactNode, lazy } from 'react';
import { Navigate, Outlet, createBrowserRouter, isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import FolderOffOutlined from '@mui/icons-material/FolderOffOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { EmptyState, ErrorState } from '@/components/ui';
import { AcceptInvitePage, LoginPage, RegisterPage, returnPath } from '@/features/auth/AuthPages';
import { useSignOut } from '@/features/auth/useSignOut';
import { useAppSelector } from '@/store';
import { AppShell } from './shell';
import { WorkspaceProvider, useWorkspace } from './workspace';

// Every screen is its own chunk, loaded when first visited.
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const AccountPage = lazy(() => import('@/features/auth/AccountPage'));
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'));
const ContentIndexPage = lazy(() => import('@/features/content/ContentIndexPage'));
const EntriesPage = lazy(() => import('@/features/content/EntriesPage'));
const EntryEditorPage = lazy(() => import('@/features/content/EntryEditorPage'));
const PagesPage = lazy(() => import('@/features/pages/PagesPage'));
const PageEditorPage = lazy(() => import('@/features/pages/PageEditorPage'));
const MediaLibraryPage = lazy(() => import('@/features/media/MediaLibraryPage'));
const ContentTypesPage = lazy(() => import('@/features/model/ContentTypesPage'));
const ContentTypeEditorPage = lazy(() => import('@/features/model/ContentTypeEditorPage'));
const ComponentsPage = lazy(() => import('@/features/model/ComponentsPage'));
const ComponentEditorPage = lazy(() => import('@/features/model/ComponentEditorPage'));
const DynamicZonesPage = lazy(() => import('@/features/model/DynamicZonesPage'));
const WorkflowsPage = lazy(() => import('@/features/publishing/WorkflowsPage'));
const ReleasesPage = lazy(() => import('@/features/publishing/ReleasesPage'));
const ReleaseDetailPage = lazy(() => import('@/features/publishing/ReleaseDetailPage'));
const ScheduledPage = lazy(() => import('@/features/publishing/ScheduledPage'));
const VersionHistoryPage = lazy(() => import('@/features/publishing/VersionHistoryPage'));
const ApiExplorerPage = lazy(() => import('@/features/developers/ApiExplorerPage'));
const ApiKeysPage = lazy(() => import('@/features/developers/ApiKeysPage'));
const IntegrationsPage = lazy(() => import('@/features/developers/IntegrationsPage'));
const WebhooksPage = lazy(() => import('@/features/developers/WebhooksPage'));
const WebhookDetailPage = lazy(() => import('@/features/developers/WebhookDetailPage'));
const SdkDocsPage = lazy(() => import('@/features/developers/SdkDocsPage'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage'));
const UsersPage = lazy(() => import('@/features/admin/UsersPage'));
const RolesPage = lazy(() => import('@/features/admin/RolesPage'));
const AuditLogsPage = lazy(() => import('@/features/admin/AuditLogsPage'));
const SettingsPage = lazy(() => import('@/features/admin/SettingsPage'));

export function Splash() {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }} role="status" aria-label="Loading Meridian">
      <CircularProgress size={22} color="secondary" thickness={5} />
    </Box>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAppSelector((s) => s.auth.status);
  const location = useLocation();
  if (status === 'restoring') return <Splash />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const status = useAppSelector((s) => s.auth.status);
  const location = useLocation();
  if (status === 'restoring') return <Splash />;
  // Signing in flips the status while the sign-in page is still mounted, so this redirect runs
  // alongside the form's own. Both must agree on the destination, or this one wins and the page
  // the visitor originally asked for is lost.
  if (status === 'authenticated') return <Navigate to={returnPath(location.state)} replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const memberships = useAppSelector((s) => s.auth.memberships);
  return <Navigate to={memberships[0] ? `/w/${memberships[0].organization.slug}` : '/no-organization'} replace />;
}

/** /w/:orgSlug → the last project's dashboard, or the project list when there is none yet. */
function OrgIndex() {
  const ws = useWorkspace();
  if (ws.projectsLoading) return <Splash />;
  return <Navigate to={ws.project ? ws.href() : ws.orgHref('projects')} replace />;
}

/** Guards project URLs: the project and environment named in the URL must exist and be accessible. */
function ProjectGuard() {
  const ws = useWorkspace();
  if (ws.projectsLoading) return <Splash />;
  if (ws.projectsError) return <ErrorState error={ws.projectsError} />;
  if (!ws.project || !ws.environment) {
    return (
      <EmptyState
        icon={<FolderOffOutlined />}
        title="Project not found"
        description="This project or environment does not exist, or you no longer have access to it."
        action={
          <Button variant="contained" href={ws.orgHref('projects')}>
            View projects
          </Button>
        }
      />
    );
  }
  return <Outlet />;
}

function NotFound() {
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <EmptyState
        icon={<SearchOffOutlined />}
        title="Page not found"
        description="The address may be mistyped, or the page may have moved."
        action={
          <Button variant="contained" href="/">
            Back to Meridian
          </Button>
        }
      />
    </Box>
  );
}

function NoOrganization() {
  const user = useAppSelector((s) => s.auth.user);
  const memberships = useAppSelector((s) => s.auth.memberships);
  const signOut = useSignOut();
  // Reached with a stale address after being invited again, for example.
  if (memberships[0]) return <Navigate to={`/w/${memberships[0].organization.slug}`} replace />;
  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <EmptyState
        icon={<FolderOffOutlined />}
        title="You are not a member of any organization"
        description={
          <>
            {user && (
              <>
                You are signed in as <b>{user.email}</b>.{' '}
              </>
            )}
            Ask an administrator to invite you, or sign out and create a new organization with a different email.
          </>
        }
        // Without this there would be no way to leave: the account menu lives in the workspace shell.
        action={
          <Button variant="outlined" onClick={() => void signOut()}>
            Sign out
          </Button>
        }
      />
    </Box>
  );
}

function RouteError() {
  const error = useRouteError();
  const chunkFailed = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);
  return (
    <Box sx={{ height: '100%', minHeight: 360, display: 'grid', placeItems: 'center' }}>
      <EmptyState
        icon={<ReportProblemOutlined />}
        title={chunkFailed ? 'A new version is available' : 'Something went wrong on this page'}
        description={
          chunkFailed
            ? 'Meridian was updated while you had it open. Reload to continue.'
            : isRouteErrorResponse(error)
              ? `${error.status} ${error.statusText}`
              : error instanceof Error
                ? error.message
                : 'An unexpected error occurred.'
        }
        action={
          <Button variant="contained" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      />
    </Box>
  );
}

function WorkspaceLayout() {
  return (
    <WorkspaceProvider>
      <AppShell />
    </WorkspaceProvider>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <PublicOnly><LoginPage /></PublicOnly> },
  { path: '/register', element: <PublicOnly><RegisterPage /></PublicOnly> },
  { path: '/accept-invite', element: <AcceptInvitePage /> },
  { path: '/no-organization', element: <RequireAuth><NoOrganization /></RequireAuth> },
  { path: '/', element: <RequireAuth><HomeRedirect /></RequireAuth> },
  {
    path: '/w/:orgSlug',
    element: <RequireAuth><WorkspaceLayout /></RequireAuth>,
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <OrgIndex /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'account', element: <AccountPage /> },
          { path: 'admin/users', element: <UsersPage /> },
          { path: 'admin/roles', element: <RolesPage /> },
          { path: 'admin/audit', element: <AuditLogsPage /> },
          { path: 'admin/settings', element: <SettingsPage /> },
          {
            path: 'p/:projectSlug/:envKey',
            element: <ProjectGuard />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: 'content', element: <ContentIndexPage /> },
              { path: 'content/:typeId', element: <EntriesPage /> },
              { path: 'content/:typeId/new', element: <EntryEditorPage /> },
              { path: 'content/:typeId/:entryId', element: <EntryEditorPage /> },
              { path: 'pages', element: <PagesPage /> },
              { path: 'pages/:entryId', element: <PageEditorPage /> },
              { path: 'media', element: <MediaLibraryPage /> },
              { path: 'model/types', element: <ContentTypesPage /> },
              { path: 'model/types/:typeId', element: <ContentTypeEditorPage /> },
              { path: 'model/components', element: <ComponentsPage /> },
              { path: 'model/components/:componentId', element: <ComponentEditorPage /> },
              { path: 'model/zones', element: <DynamicZonesPage /> },
              { path: 'publishing/workflows', element: <WorkflowsPage /> },
              { path: 'publishing/releases', element: <ReleasesPage /> },
              { path: 'publishing/releases/:releaseId', element: <ReleaseDetailPage /> },
              { path: 'publishing/scheduled', element: <ScheduledPage /> },
              { path: 'publishing/history', element: <VersionHistoryPage /> },
              { path: 'dev/explorer', element: <ApiExplorerPage /> },
              { path: 'dev/keys', element: <ApiKeysPage /> },
              { path: 'dev/integrations', element: <IntegrationsPage /> },
              { path: 'dev/webhooks', element: <WebhooksPage /> },
              { path: 'dev/webhooks/:webhookId', element: <WebhookDetailPage /> },
              { path: 'dev/sdk', element: <SdkDocsPage /> },
              { path: 'analytics', element: <AnalyticsPage /> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
