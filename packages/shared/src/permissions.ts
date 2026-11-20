/**
 * Permission catalogue and default roles.
 *
 * Permissions are plain strings checked on the server for every request. Roles are stored
 * per organization; the system roles below are created with each organization and custom
 * roles can be added beside them.
 */

export const PERMISSIONS = {
  'org.manage': 'Edit organization profile and settings',
  'org.members.manage': 'Invite, remove and change roles of members',
  'org.roles.manage': 'Create and edit custom roles',
  'org.audit.read': 'View and export audit logs',
  'project.create': 'Create projects',
  'project.read': 'View projects',
  'project.update': 'Edit project settings and environments',
  'project.delete': 'Delete projects',
  'schema.read': 'View content types and components',
  'schema.manage': 'Create and change content types and components',
  'content.read': 'View entries and pages',
  'content.create': 'Create entries and pages',
  'content.update': 'Edit entries and pages',
  'content.delete': 'Delete entries and pages',
  'content.review': 'Approve content or request changes',
  'content.publish': 'Publish, unpublish and schedule content',
  'release.manage': 'Create and publish releases',
  'media.read': 'View the media library',
  'media.upload': 'Upload media',
  'media.manage': 'Edit, replace and delete media',
  'token.manage': 'Create and revoke API tokens',
  'webhook.manage': 'Configure webhooks and view deliveries',
  'analytics.read': 'View analytics and API usage',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  { label: 'Organization', permissions: ['org.manage', 'org.members.manage', 'org.roles.manage', 'org.audit.read'] },
  { label: 'Projects', permissions: ['project.create', 'project.read', 'project.update', 'project.delete'] },
  { label: 'Content model', permissions: ['schema.read', 'schema.manage'] },
  {
    label: 'Content',
    permissions: ['content.read', 'content.create', 'content.update', 'content.delete', 'content.review', 'content.publish', 'release.manage'],
  },
  { label: 'Media', permissions: ['media.read', 'media.upload', 'media.manage'] },
  { label: 'Developers', permissions: ['token.manage', 'webhook.manage', 'analytics.read'] },
];

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

const READ: Permission[] = ['project.read', 'schema.read', 'content.read', 'media.read'];
const AUTHORING: Permission[] = [...READ, 'content.create', 'content.update', 'media.upload'];

export const SYSTEM_ROLES: RoleTemplate[] = [
  {
    key: 'org_admin',
    name: 'Organization Administrator',
    description: 'Full control of the organization, its members and every project',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'project_admin',
    name: 'Project Administrator',
    description: 'Manages projects, environments, schema, content and integrations',
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith('org.') || p === 'org.audit.read'),
  },
  {
    key: 'developer',
    name: 'Developer',
    description: 'Models content and manages API tokens, webhooks and integrations',
    permissions: [...AUTHORING, 'schema.manage', 'project.update', 'token.manage', 'webhook.manage', 'analytics.read', 'media.manage'],
  },
  {
    key: 'content_manager',
    name: 'Content Manager',
    description: 'Runs the editorial process end to end, including publishing and releases',
    permissions: [...AUTHORING, 'content.delete', 'content.review', 'content.publish', 'release.manage', 'media.manage', 'analytics.read'],
  },
  {
    key: 'publisher',
    name: 'Publisher',
    description: 'Publishes, schedules and unpublishes approved content',
    permissions: [...AUTHORING, 'content.publish', 'release.manage'],
  },
  {
    key: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews submissions, approves them or requests changes',
    permissions: [...READ, 'content.review'],
  },
  {
    key: 'editor',
    name: 'Editor',
    description: 'Creates and edits any content and reviews the work of authors',
    permissions: [...AUTHORING, 'content.delete', 'content.review', 'media.manage'],
  },
  {
    key: 'author',
    name: 'Author',
    description: 'Creates and edits content and submits it for review',
    permissions: AUTHORING,
  },
  {
    key: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to content, media and the content model',
    permissions: READ,
  },
];

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}
