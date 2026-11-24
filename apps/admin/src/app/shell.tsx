import { type ReactNode, Suspense, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useColorScheme, useTheme } from '@mui/material/styles';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import KeyboardDoubleArrowLeftOutlined from '@mui/icons-material/KeyboardDoubleArrowLeftOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import NavigateNextOutlined from '@mui/icons-material/NavigateNextOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SettingsBrightnessOutlined from '@mui/icons-material/SettingsBrightnessOutlined';
import UnfoldMoreOutlined from '@mui/icons-material/UnfoldMoreOutlined';
import { IconFor } from '@/components/icons';
import { EmptyState, RelativeTime, StatusChip, UserAvatar } from '@/components/ui';
import { useSignOut } from '@/features/auth/useSignOut';
import { GuestBanner } from '@/features/guest/guest';
import { DEMO_ONLY, isGuestMode } from '@/lib/guest';
import { api } from '@/lib/api';
import { actionVerb } from '@/lib/format';
import type { DashboardData, EntryListItem } from '@/lib/types';
import { setCommandOpen, setMobileNav, toggleSidebar, useAppDispatch, useAppSelector } from '@/store';
import { CommandPalette } from './CommandPalette';
import { ALL_NAV_ITEMS, ENVIRONMENT_TONES, NAV_GROUPS, type NavItem } from './nav';
import { useWorkspace } from './workspace';

// ─── Breadcrumbs ─────────────────────────────────────────────────────────────

export interface Crumb {
  label: string;
  to?: string;
}

const CrumbsContext = createContext<(crumbs: Crumb[]) => void>(() => undefined);

/** Lets a page append its own trail after the section name, e.g. Content › Articles › "Launch day". */
export function useCrumbs(crumbs: Crumb[]) {
  const set = useContext(CrumbsContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key) as Crumb[]);
    return () => set([]);
  }, [key, set]);
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

const SIDEBAR_WIDTH = 244;
const SIDEBAR_COLLAPSED = 56;
const TOPBAR_HEIGHT = 52;

function useNavTarget() {
  const ws = useWorkspace();
  return useCallback((item: NavItem) => (item.scope === 'org' ? ws.orgHref(item.path) : ws.href(item.path)), [ws]);
}

function isActive(pathname: string, target: string, exact?: boolean) {
  return exact ? pathname === target || pathname === `${target}/` : pathname === target || pathname.startsWith(`${target}/`);
}

function ProjectSwitcher({ collapsed }: { collapsed: boolean }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const project = ws.project;

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-label="Switch project"
        sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 2.5, p: 1.5, borderRadius: '8px', textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Box sx={{ width: 28, height: 28, borderRadius: '7px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: project?.color ?? 'surface.sunken', color: project ? '#fff' : 'text.secondary', '& svg': { fontSize: 16 } }}>
          <IconFor name={project?.icon ?? 'layers'} />
        </Box>
        {!collapsed && (
          <>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, lineHeight: 1.25 }}>
                {project?.name ?? 'No project'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ lineHeight: 1.25 }}>
                {ws.org.name}
              </Typography>
            </Box>
            <UnfoldMoreOutlined sx={{ fontSize: 16, color: 'text.disabled' }} />
          </>
        )}
      </ButtonBase>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 260 } } }}>
        <ListSubheader sx={{ lineHeight: '28px', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', bgcolor: 'transparent' }}>Projects</ListSubheader>
        {ws.projects.map((p) => (
          <MenuItem
            key={p.id}
            selected={p.id === project?.id}
            onClick={() => {
              setAnchor(null);
              navigate(ws.hrefFor(p, ws.environment && p.environments.some((e) => e.key === ws.environment?.key) ? ws.environment.key : 'production'));
            }}
          >
            <Box sx={{ width: 20, height: 20, borderRadius: '5px', bgcolor: p.color, color: '#fff', display: 'grid', placeItems: 'center', '& svg': { fontSize: 13 } }}>
              <IconFor name={p.icon} />
            </Box>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {p.name}
            </Typography>
            {p.id === project?.id && <CheckOutlined sx={{ fontSize: 15, color: 'secondary.main' }} />}
          </MenuItem>
        ))}
        {ws.projects.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 2 }}>
            No projects yet
          </Typography>
        )}
        <Divider sx={{ my: 1 }} />
        <MenuItem component={RouterLink} to={ws.orgHref('projects')} onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <AddOutlined />
          </ListItemIcon>
          All projects
        </MenuItem>
      </Menu>
    </>
  );
}

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const ws = useWorkspace();
  const { pathname } = useLocation();
  const target = useNavTarget();
  const dispatch = useAppDispatch();

  return (
    <Stack sx={{ height: '100%' }}>
      <Box sx={{ p: 2, height: TOPBAR_HEIGHT, display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle' }}>
        <ProjectSwitcher collapsed={collapsed} />
      </Box>
      <Box component="nav" aria-label="Main" sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', px: 2, py: 2 }}>
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => (!item.permission || ws.can(item.permission)) && (item.scope === 'org' || !!ws.project));
          if (items.length === 0) return null;
          return (
            <Box key={group.label} sx={{ mb: 3 }}>
              {collapsed ? (
                <Divider sx={{ my: 2, mx: 1 }} />
              ) : (
                <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 2, pt: 2, pb: 1 }}>
                  {group.label}
                </Typography>
              )}
              {items.map((item) => {
                const to = target(item);
                const active = isActive(pathname, to, item.exact);
                const link = (
                  <ButtonBase
                    key={item.label}
                    component={RouterLink}
                    to={to}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    sx={{
                      width: '100%',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      gap: 2.5,
                      px: collapsed ? 0 : 2,
                      height: 30,
                      mb: 0.25,
                      borderRadius: '7px',
                      fontSize: '0.8125rem',
                      fontWeight: active ? 600 : 450,
                      color: active ? 'text.primary' : 'text.secondary',
                      bgcolor: active ? 'action.selected' : 'transparent',
                      textDecoration: 'none !important',
                      transition: 'background-color 120ms, color 120ms',
                      '& svg': { fontSize: 17, color: active ? 'secondary.main' : 'inherit', flexShrink: 0 },
                      '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover', color: 'text.primary' },
                    }}
                  >
                    {item.icon}
                    {!collapsed && (
                      <Box component="span" sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.label}
                      </Box>
                    )}
                  </ButtonBase>
                );
                return collapsed ? (
                  <Tooltip key={item.label} title={item.label} placement="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </Box>
          );
        })}
      </Box>
      {!onNavigate && (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'border.subtle', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <IconButton aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => dispatch(toggleSidebar())}>
              <KeyboardDoubleArrowLeftOutlined sx={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Stack>
  );
}

// ─── Topbar ──────────────────────────────────────────────────────────────────

function EnvironmentSwitcher() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!ws.project || !ws.environment) return null;
  const current = ws.environment;
  const prefix = ws.href();

  return (
    <>
      <Tooltip title="Environment — each has its own content model and content">
        <ButtonBase
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-label={`Environment: ${current.name}`}
          sx={{ height: 30, px: 2.5, gap: 2, borderRadius: '7px', border: 1, borderColor: 'border.strong', fontSize: '0.8125rem', fontWeight: 500, bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' } }}
        >
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ENVIRONMENT_TONES[current.key] ?? 'text.disabled' }} />
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
            {current.name}
          </Box>
          <UnfoldMoreOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />
        </ButtonBase>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {ws.project.environments.map((env) => (
          <MenuItem
            key={env.id}
            selected={env.id === current.id}
            onClick={() => {
              setAnchor(null);
              // Stay on the same section when switching, but leave pages tied to one specific entry.
              const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length).split('/').filter(Boolean).slice(0, 2).join('/') : '';
              navigate(ws.hrefFor(ws.project as never, env.key, rest));
            }}
          >
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: ENVIRONMENT_TONES[env.key] ?? 'text.disabled' }} />
            <Box sx={{ flex: 1 }}>{env.name}</Box>
            <Typography variant="caption" color="text.disabled">
              {env.entryCount} {env.entryCount === 1 ? 'entry' : 'entries'}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function Notifications() {
  const ws = useWorkspace();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const enabled = !!ws.environment && ws.can('content.read');
  const reviews = useQuery({
    queryKey: ['reviews', ws.environment?.id],
    queryFn: () => api.get<{ items: EntryListItem[] }>(`${ws.envBase}/reviews`).then((r) => r.items),
    enabled,
    refetchInterval: 60_000,
  });
  const dashboard = useQuery({
    queryKey: ['dashboard', ws.environment?.id],
    queryFn: () => api.get<DashboardData>(`${ws.envBase}/dashboard`),
    enabled: enabled && !!anchor,
    staleTime: 30_000,
  });
  const pending = (reviews.data ?? []).filter((r) => r.status === 'IN_REVIEW');
  const canReview = ws.can('content.review');
  const activity = dashboard.data?.recentPublishing ?? [];

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton aria-label={`Notifications${pending.length ? `, ${pending.length} awaiting review` : ''}`} onClick={(e) => setAnchor(e.currentTarget)}>
          <Badge color="secondary" variant="dot" invisible={pending.length === 0 || !canReview}>
            <NotificationsNoneOutlined />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxHeight: 480, mt: 1, borderRadius: '10px', display: 'flex', flexDirection: 'column' } } }}
      >
        <Typography variant="h5" sx={{ px: 4, py: 3, borderBottom: 1, borderColor: 'border.subtle' }}>
          Notifications
        </Typography>
        <Box sx={{ overflowY: 'auto' }}>
          {pending.length > 0 && (
            <Box sx={{ py: 1 }}>
              <Typography variant="overline" color="text.disabled" sx={{ px: 4, py: 1, display: 'block' }}>
                Awaiting review
              </Typography>
              {pending.slice(0, 6).map((entry) => (
                <ButtonBase
                  key={entry.id}
                  component={RouterLink}
                  to={ws.href(entry.isPage ? `pages/${entry.id}` : `content/${entry.contentType}/${entry.id}`)}
                  onClick={() => setAnchor(null)}
                  sx={{ width: '100%', px: 4, py: 2, gap: 3, justifyContent: 'flex-start', textAlign: 'left', textDecoration: 'none !important', color: 'text.primary', '&:hover': { bgcolor: 'action.hover' } }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                      {entry.title ?? 'Untitled'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {entry.contentTypeName} · submitted <RelativeTime value={entry.updatedAt} />
                    </Typography>
                  </Box>
                  <StatusChip status={entry.status} />
                </ButtonBase>
              ))}
            </Box>
          )}
          {activity.length > 0 && (
            <Box sx={{ py: 1, borderTop: pending.length ? 1 : 0, borderColor: 'border.subtle' }}>
              <Typography variant="overline" color="text.disabled" sx={{ px: 4, py: 1, display: 'block' }}>
                Recent publishing
              </Typography>
              {activity.map((a) => (
                <Stack key={a.id} direction="row" spacing={2.5} sx={{ px: 4, py: 2, alignItems: 'center' }}>
                  <UserAvatar name={a.actorLabel} size={22} />
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                    <b>{a.actorLabel ?? 'System'}</b> {actionVerb(a.action)} <span>{a.resourceLabel}</span>
                    <Typography variant="caption" color="text.disabled" component="span" sx={{ ml: 1.5 }}>
                      <RelativeTime value={a.createdAt} />
                    </Typography>
                  </Typography>
                </Stack>
              ))}
            </Box>
          )}
          {pending.length === 0 && activity.length === 0 && !dashboard.isLoading && (
            <EmptyState compact icon={<NotificationsNoneOutlined />} title="You are all caught up" description="Reviews waiting for you and recent publishing activity appear here." />
          )}
          {dashboard.isLoading && <LinearProgress />}
        </Box>
      </Popover>
    </>
  );
}

function UserMenu() {
  const ws = useWorkspace();
  const user = useAppSelector((s) => s.auth.user);
  const memberships = useAppSelector((s) => s.auth.memberships);
  const endSession = useSignOut();
  const { mode, setMode } = useColorScheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const signOut = async () => {
    setAnchor(null);
    await endSession();
  };
  const themes = [
    { value: 'light', label: 'Light', icon: <LightModeOutlined /> },
    { value: 'dark', label: 'Dark', icon: <DarkModeOutlined /> },
    { value: 'system', label: 'System', icon: <SettingsBrightnessOutlined /> },
  ] as const;

  return (
    <>
      <Tooltip title="Account">
        <IconButton aria-label="Account menu" aria-haspopup="menu" onClick={(e) => setAnchor(e.currentTarget)} sx={{ p: 0.5 }}>
          <UserAvatar name={user?.name} size={28} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { width: 260 } } }}>
        <Box sx={{ px: 2.5, py: 2 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {user?.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {user?.email} · {ws.role.name}
          </Typography>
        </Box>
        <Divider sx={{ my: 1 }} />
        {memberships.length > 1 && <ListSubheader sx={{ lineHeight: '26px', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', bgcolor: 'transparent' }}>Organizations</ListSubheader>}
        {memberships.length > 1 &&
          memberships.map((m) => (
            <MenuItem key={m.organization.id} selected={m.organization.id === ws.org.id} component={RouterLink} to={`/w/${m.organization.slug}`} onClick={() => setAnchor(null)}>
              <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                {m.organization.name}
              </Typography>
              {m.organization.id === ws.org.id && <CheckOutlined sx={{ fontSize: 15, color: 'secondary.main' }} />}
            </MenuItem>
          ))}
        {memberships.length > 1 && <Divider sx={{ my: 1 }} />}
        <MenuItem component={RouterLink} to={ws.orgHref('account')} onClick={() => setAnchor(null)}>
          <ListItemIcon>
            <ManageAccountsOutlined />
          </ListItemIcon>
          Account & security
        </MenuItem>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            Theme
          </Typography>
          <Stack direction="row" spacing={1} role="radiogroup" aria-label="Theme">
            {themes.map((t) => (
              <ButtonBase
                key={t.value}
                role="radio"
                aria-checked={mode === t.value}
                onClick={() => setMode(t.value)}
                sx={{ flex: 1, height: 30, gap: 1.5, borderRadius: '7px', border: 1, fontSize: '0.75rem', fontWeight: 500, borderColor: mode === t.value ? 'secondary.main' : 'border.strong', bgcolor: mode === t.value ? 'action.selected' : 'transparent', '& svg': { fontSize: 14 } }}
              >
                {t.icon}
                {t.label}
              </ButtonBase>
            ))}
          </Stack>
        </Box>
        {/* A demo-only build has nothing to sign out to; resetting lives in the guest banner. */}
        {!DEMO_ONLY && <Divider sx={{ my: 1 }} />}
        {!DEMO_ONLY && (
          <MenuItem onClick={() => void signOut()}>
            <ListItemIcon>
              <LogoutOutlined />
            </ListItemIcon>
            {isGuestMode() ? 'Exit guest mode' : 'Sign out'}
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

function Topbar({ crumbs }: { crumbs: Crumb[] }) {
  const ws = useWorkspace();
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();
  const target = useNavTarget();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  const section = useMemo(() => {
    // The dashboard matches every project URL as a prefix, so prefer the longest matching item.
    const matches = ALL_NAV_ITEMS.filter((item) => isActive(pathname, target(item), item.exact));
    return matches.sort((a, b) => target(b).length - target(a).length)[0];
  }, [pathname, target]);

  const trail: Crumb[] = [
    ...(ws.project ? [{ label: ws.project.name, to: ws.href() }] : [{ label: ws.org.name, to: ws.orgHref('projects') }]),
    ...(section && !section.exact ? [{ label: section.label, to: target(section) }] : []),
    ...crumbs,
  ];

  return (
    <Box
      component="header"
      sx={{ height: TOPBAR_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, px: { xs: 2, md: 4 }, borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'background.paper' }}
    >
      <IconButton aria-label="Open navigation" onClick={() => dispatch(setMobileNav(true))} sx={{ display: { md: 'none' } }}>
        <MenuOutlined />
      </IconButton>
      <Breadcrumbs aria-label="Breadcrumb" separator={<NavigateNextOutlined sx={{ fontSize: 14, color: 'text.disabled' }} />} sx={{ flex: 1, minWidth: 0, '& ol': { flexWrap: 'nowrap' }, '& li': { minWidth: 0 } }}>
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return last || !crumb.to ? (
            <Typography key={i} variant="body2" noWrap sx={{ fontWeight: last ? 600 : 400, color: last ? 'text.primary' : 'text.secondary', maxWidth: { xs: 140, sm: 320 } }} aria-current={last ? 'page' : undefined}>
              {crumb.label}
            </Typography>
          ) : (
            <Typography key={i} variant="body2" noWrap component={RouterLink} to={crumb.to} sx={{ color: 'text.secondary', maxWidth: 200, display: { xs: i === 0 ? 'none' : 'block', sm: 'block' }, '&:hover': { color: 'text.primary', textDecoration: 'none' } }}>
              {crumb.label}
            </Typography>
          );
        })}
      </Breadcrumbs>

      <ButtonBase
        onClick={() => dispatch(setCommandOpen(true))}
        aria-label="Search and commands"
        sx={{ height: 30, px: 2.5, gap: 2, borderRadius: '7px', border: 1, borderColor: 'border.strong', color: 'text.secondary', fontSize: '0.8125rem', bgcolor: 'surface.subtle', minWidth: { md: 220 }, justifyContent: 'flex-start', '&:hover': { borderColor: 'text.disabled' } }}
      >
        <SearchOutlined sx={{ fontSize: 16 }} />
        <Box component="span" sx={{ flex: 1, textAlign: 'left', display: { xs: 'none', md: 'inline' } }}>
          Search…
        </Box>
        <Box component="kbd" sx={{ display: { xs: 'none', md: 'inline' }, fontSize: '0.6875rem', px: 1.25, py: 0.25, borderRadius: '4px', border: 1, borderColor: 'border.strong', bgcolor: 'background.paper', color: 'text.disabled' }}>
          {isMac ? '⌘K' : 'Ctrl K'}
        </Box>
      </ButtonBase>
      <EnvironmentSwitcher />
      <Notifications />
      <UserMenu />
    </Box>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────────

function ContentFallback() {
  return <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} aria-label="Loading page" />;
}

export function AppShell({ children }: { children?: ReactNode }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const dispatch = useAppDispatch();
  const { sidebarCollapsed, mobileNavOpen } = useAppSelector((s) => s.ui);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const { pathname } = useLocation();
  const collapsed = sidebarCollapsed && desktop;

  useEffect(() => {
    dispatch(setMobileNav(false));
  }, [pathname, dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        dispatch(setCommandOpen(true));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  return (
    <CrumbsContext.Provider value={setCrumbs}>
      <Box sx={{ display: 'flex', height: '100%', bgcolor: 'background.default' }}>
        {desktop ? (
          <Box
            component="aside"
            sx={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH, flexShrink: 0, borderRight: 1, borderColor: 'border.subtle', bgcolor: 'background.paper', transition: 'width 180ms cubic-bezier(0.2, 0, 0, 1)', overflow: 'hidden' }}
          >
            <SidebarContent collapsed={collapsed} />
          </Box>
        ) : (
          <Drawer open={mobileNavOpen} onClose={() => dispatch(setMobileNav(false))} slotProps={{ paper: { sx: { width: 272 } } }}>
            <SidebarContent collapsed={false} onNavigate={() => dispatch(setMobileNav(false))} />
          </Drawer>
        )}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <GuestBanner />
          <Topbar crumbs={crumbs} />
          <Box component="main" id="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
            <Suspense fallback={<ContentFallback />}>{children ?? <Outlet />}</Suspense>
          </Box>
        </Box>
      </Box>
      <CommandPalette />
    </CrumbsContext.Provider>
  );
}
