import type { ReactNode } from 'react';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import ApiOutlined from '@mui/icons-material/ApiOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import DynamicFeedOutlined from '@mui/icons-material/DynamicFeedOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import InsightsOutlined from '@mui/icons-material/InsightsOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import PeopleAltOutlined from '@mui/icons-material/PeopleAltOutlined';
import PhotoLibraryOutlined from '@mui/icons-material/PhotoLibraryOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import SchemaOutlined from '@mui/icons-material/SchemaOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SpaceDashboardOutlined from '@mui/icons-material/SpaceDashboardOutlined';
import WebhookOutlined from '@mui/icons-material/WebhookOutlined';
import WebOutlined from '@mui/icons-material/WebOutlined';
import type { Permission } from '@meridian/shared';

export interface NavItem {
  label: string;
  /** Route path relative to the project (`scope: 'project'`) or the organization (`scope: 'org'`). */
  path: string;
  scope: 'project' | 'org';
  icon: ReactNode;
  permission?: Permission;
  /** Match only this exact path (used by the dashboard, whose path is the project root). */
  exact?: boolean;
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Dashboard', path: '', scope: 'project', icon: <SpaceDashboardOutlined />, exact: true, keywords: 'home overview' },
      { label: 'Projects', path: 'projects', scope: 'org', icon: <FolderOutlined />, permission: 'project.read' },
      { label: 'Content', path: 'content', scope: 'project', icon: <ArticleOutlined />, permission: 'content.read', keywords: 'entries articles' },
      { label: 'Pages', path: 'pages', scope: 'project', icon: <WebOutlined />, permission: 'content.read', keywords: 'page builder website' },
      { label: 'Media Library', path: 'media', scope: 'project', icon: <PhotoLibraryOutlined />, permission: 'media.read', keywords: 'images files assets upload' },
    ],
  },
  {
    label: 'Content modeling',
    items: [
      { label: 'Content Types', path: 'model/types', scope: 'project', icon: <SchemaOutlined />, permission: 'schema.read', keywords: 'schema fields model builder' },
      { label: 'Components', path: 'model/components', scope: 'project', icon: <ExtensionOutlined />, permission: 'schema.read', keywords: 'reusable blocks' },
      { label: 'Dynamic Zones', path: 'model/zones', scope: 'project', icon: <DynamicFeedOutlined />, permission: 'schema.read' },
    ],
  },
  {
    label: 'Publishing',
    items: [
      { label: 'Workflows', path: 'publishing/workflows', scope: 'project', icon: <FactCheckOutlined />, permission: 'content.read', keywords: 'review approval' },
      { label: 'Releases', path: 'publishing/releases', scope: 'project', icon: <RocketLaunchOutlined />, permission: 'content.read' },
      { label: 'Scheduled Content', path: 'publishing/scheduled', scope: 'project', icon: <EventOutlined />, permission: 'content.read', keywords: 'schedule calendar' },
      { label: 'Version History', path: 'publishing/history', scope: 'project', icon: <HistoryOutlined />, permission: 'content.read', keywords: 'versions rollback' },
    ],
  },
  {
    label: 'Developers',
    items: [
      { label: 'API Explorer', path: 'dev/explorer', scope: 'project', icon: <ApiOutlined />, permission: 'schema.read', keywords: 'rest graphql playground' },
      { label: 'API Keys', path: 'dev/keys', scope: 'project', icon: <KeyOutlined />, permission: 'token.manage', keywords: 'tokens credentials' },
      { label: 'Integrations', path: 'dev/integrations', scope: 'project', icon: <HubOutlined />, permission: 'token.manage', keywords: 'connect nextjs react vue' },
      { label: 'Webhooks', path: 'dev/webhooks', scope: 'project', icon: <WebhookOutlined />, permission: 'webhook.manage', keywords: 'events revalidate' },
      { label: 'SDK Documentation', path: 'dev/sdk', scope: 'project', icon: <MenuBookOutlined />, keywords: 'docs guide' },
      { label: 'Analytics', path: 'analytics', scope: 'project', icon: <InsightsOutlined />, permission: 'analytics.read', keywords: 'usage requests latency' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', path: 'admin/users', scope: 'org', icon: <PeopleAltOutlined />, keywords: 'members invite team' },
      { label: 'Roles & Permissions', path: 'admin/roles', scope: 'org', icon: <AdminPanelSettingsOutlined />, keywords: 'rbac access' },
      { label: 'Audit Logs', path: 'admin/audit', scope: 'org', icon: <ReceiptLongOutlined />, permission: 'org.audit.read', keywords: 'activity history' },
      { label: 'Settings', path: 'admin/settings', scope: 'org', icon: <SettingsOutlined />, keywords: 'organization project locales environments' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export const ENVIRONMENT_TONES: Record<string, string> = {
  production: 'success.main',
  staging: 'warning.main',
  development: 'info.main',
};

export const SchemaIcon = AccountTreeOutlined;
