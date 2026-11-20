/** Shapes returned by the management API. Kept in one place so every feature shares the same contract. */
import type { BlockDefinition, EntryStatus, FieldDef, TokenType } from '@meridian/shared';

export interface Page<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; pageCount: number };
}

export interface User {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Membership {
  membershipId: string;
  organization: { id: string; name: string; slug: string; settings: Record<string, unknown> };
  role: { id: string; key: string; name: string };
  permissions: string[];
}

export interface Environment {
  id: string;
  key: string;
  name: string;
  position: number;
  entryCount: number;
}

export interface Locale {
  id: string;
  projectId: string;
  code: string;
  name: string;
  isDefault: boolean;
  fallbackCode: string | null;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  settings: { previewUrl?: string; siteUrl?: string; corsOrigins?: string[] };
  createdAt: string;
  updatedAt: string;
  environments: Environment[];
  locales: Locale[];
}

export interface TypeOptions {
  localized?: boolean;
  requireApproval?: boolean;
  titleField?: string;
  previewUrl?: string;
}

export interface ContentType {
  id: string;
  apiId: string;
  displayName: string;
  singularName: string;
  pluralName: string;
  description: string;
  kind: 'COLLECTION' | 'SINGLE';
  icon: string;
  isSystem: boolean;
  options: TypeOptions;
  schemaVersion: number;
  fields: FieldDef[];
  entryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentDef {
  id: string;
  apiId: string;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  isBlock: boolean;
  schemaVersion: number;
  fields: FieldDef[];
  usedBy?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SchemaResponse {
  types: ContentType[];
  components: ComponentDef[];
  blocks: BlockDefinition[];
  builtinBlocks: string[];
  builtinComponents: Record<string, FieldDef[]>;
}

export interface FieldChange {
  kind: 'added' | 'removed' | 'renamed' | 'type_changed' | 'updated' | 'reordered';
  apiId: string;
  label: string;
  from?: string;
  to?: string;
  affectedEntries?: number;
  destructive?: boolean;
  note?: string;
}

export interface SchemaPlan {
  changes: FieldChange[];
  blockers: { path?: string; message: string }[];
  warnings: string[];
  requiresConfirmation: boolean;
}

export interface EntrySummary {
  id: string;
  documentId: string;
  contentType: string;
  locale: string;
  title: string | null;
  slug: string | null;
  path: string | null;
  parentId: string | null;
  position: number;
  status: EntryStatus;
  isPublished: boolean;
  hasChanges: boolean;
  publishedAt: string | null;
  scheduledPublishAt: string | null;
  scheduledUnpublishAt: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  updatedBy: string | null;
  createdBy: string | null;
  data?: Record<string, unknown>;
}

export interface EntryDetail extends EntrySummary {
  data: Record<string, any>;
  assigneeId: string | null;
  assignee: string | null;
  firstPublishedAt: string | null;
  publishedVersionId: string | null;
  variants: { id: string; locale: string; status: EntryStatus; isPublished: boolean }[];
  versionCount: number;
  openComments: number;
  requiresApproval: boolean;
  defaultLocale: string;
}

/** Entry row in cross-type lists (scheduled, reviews, recent). */
export interface EntryListItem extends EntrySummary {
  contentTypeName: string;
  isPage: boolean;
  assignee?: string | null;
}

export interface PageTreeItem extends EntrySummary {
  template: string;
  category: string | null;
  blockCount: number;
}

export interface EntryVersion {
  id: string;
  number: number;
  kind: 'SAVE' | 'AUTOSAVE' | 'PUBLISH' | 'RESTORE';
  title: string | null;
  note: string | null;
  createdAt: string;
  updatedAt?: string;
  createdBy: string | null;
  isPublished: boolean;
  data?: Record<string, any>;
}

export interface Comment {
  id: string;
  entryId: string;
  userId: string;
  author: string;
  body: string;
  kind: 'comment' | 'changes_requested' | 'approval';
  resolvedAt: string | null;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  actorLabel: string | null;
  actorType: string;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  projectId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  kind: 'image' | 'video' | 'document' | 'archive' | 'other';
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  alt: string;
  caption: string;
  tags: string[];
  revision: number;
  url: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  duplicate?: boolean;
  usages?: MediaUsage[];
}

export interface MediaUsage {
  entryId: string;
  title: string | null;
  status: EntryStatus;
  environmentId: string;
  environment: string;
  contentType: string;
  contentTypeName: string;
  isPage: boolean;
}

export interface MediaFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  assetCount: number;
}

export interface MediaStats {
  totalAssets: number;
  totalBytes: number;
  byKind: { kind: string; count: number; bytes: number }[];
  unusedAssets: number;
  tags: { tag: string; n: number }[];
  allowedExtensions: string[];
  maxUploadBytes: number;
  storageDriver: string;
}

export interface ApiToken {
  id: string;
  name: string;
  description: string;
  type: TokenType;
  prefix: string;
  environmentId: string;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: 'active' | 'revoked' | 'expired';
  requests7d: number;
  errors7d: number;
  /** Present only in the response that creates or rotates the token. */
  token?: string;
}

export interface Webhook {
  id: string;
  environmentId: string;
  name: string;
  url: string;
  events: string[];
  headers: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  deliveries7d?: { success: number; failed: number; pending: number };
  lastDelivery?: { status: string; createdAt: string; responseStatus: number | null } | null;
  secret?: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  event: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ReleaseItem {
  id: string;
  action: 'PUBLISH' | 'UNPUBLISH';
  entryId: string;
  title: string | null;
  status: EntryStatus;
  locale: string;
  path: string | null;
  isPublished: boolean;
  hasChanges: boolean;
  deleted: boolean;
  contentType: string | null;
  contentTypeName: string;
  isPage: boolean;
}

export interface Release {
  id: string;
  environmentId: string;
  name: string;
  description: string;
  status: 'OPEN' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';
  scheduledAt: string | null;
  publishedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
  items?: ReleaseItem[];
}

export interface Role {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  memberCount: number;
}

export interface Member {
  id: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  user: { id: string; name: string; email: string; isActive: boolean; lastLoginAt: string | null };
  role: { id: string; key: string; name: string };
}

export interface Invitation {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
  role: { id: string; name: string };
  inviteUrl?: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  projectId: string | null;
  environmentId: string | null;
  actorType: 'user' | 'token' | 'system';
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface DashboardEntry {
  id: string;
  title: string | null;
  status: EntryStatus;
  updatedAt: string;
  publishedAt?: string | null;
  path?: string | null;
  contentType: string | null;
  contentTypeName: string;
  isPage: boolean;
  updatedBy: string | null;
}

export interface HealthCheck {
  ok: boolean;
  latencyMs: number;
}

export interface DashboardData {
  counts: {
    entries: number;
    pages: number;
    published: number;
    drafts: number;
    scheduled: number;
    pendingApprovals: number;
    mediaAssets: number;
    storageBytes: number;
    connectedApps: number;
    activeWebhooks: number;
    contentTypes: number;
    apiRequests24h: number | null;
    apiErrors24h: number | null;
  };
  publishingActivity: { date: string; published: number; saved: number }[];
  apiUsage: { date: string; requests: number; errors: number }[] | null;
  typeDistribution: { apiId: string; name: string; count: number }[];
  recentUpdates: DashboardEntry[];
  recentPages: DashboardEntry[];
  pendingReviews: DashboardEntry[];
  recentPublishing: { id: string; action: string; actorLabel: string | null; resourceLabel: string | null; resourceId: string | null; resourceType: string; createdAt: string }[];
  userActivity: { id: string; action: string; actorLabel: string | null; actorType: string; resourceLabel: string | null; resourceType: string; createdAt: string }[];
  health: {
    database: HealthCheck;
    cache: HealthCheck;
    storage: HealthCheck & { driver: string };
    queue: { waiting: number; active: number; delayed: number; failed: number };
    realtimeClients: number;
  };
}

export interface AnalyticsData {
  range: { days: number; from: string; to: string };
  totals: { requests: number; errors: number; errorRate: number; avgLatencyMs: number };
  usage: { date: string; requests: number; errors: number; avgLatencyMs: number }[];
  byResource: { resource: string; name: string; requests: number; errors: number; avgLatencyMs: number }[];
  byToken: { tokenId: string; name: string; type: string | null; requests: number; errors: number }[];
  content: { date: string; created: number; published: number; saved: number }[];
  mostUpdated: { entryId: string; title: string | null; versions: number; contentType: string | null; contentTypeName: string; isPage: boolean }[];
  userActivity: { name: string; actions: number }[];
  media: { kind: string; count: number; bytes: number }[];
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface RelationOption {
  id: string;
  entryId: string;
  title: string;
  status: EntryStatus;
  isPublished: boolean;
}

export interface SearchHit {
  id: string;
  title: string | null;
  slug: string | null;
  path: string | null;
  status: EntryStatus;
  locale: string;
  contentType: string;
  contentTypeName: string;
  isPage: boolean;
}
