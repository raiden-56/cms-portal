import type { Permission } from './permissions';

export const ENTRY_STATUSES = ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const STATUS_LABELS: Record<EntryStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

export type WorkflowAction =
  | 'submit'
  | 'withdraw'
  | 'approve'
  | 'request_changes'
  | 'publish'
  | 'unpublish'
  | 'schedule'
  | 'unschedule'
  | 'archive'
  | 'unarchive';

interface Transition {
  from: EntryStatus[];
  to: EntryStatus;
  permission: Permission;
  label: string;
}

/**
 * The editorial state machine. The API refuses any transition not listed here, and
 * `publish` additionally requires APPROVED when the content type enforces approval.
 */
export const WORKFLOW_TRANSITIONS: Record<WorkflowAction, Transition> = {
  submit: { from: ['DRAFT', 'CHANGES_REQUESTED'], to: 'IN_REVIEW', permission: 'content.update', label: 'Submit for review' },
  withdraw: { from: ['IN_REVIEW'], to: 'DRAFT', permission: 'content.update', label: 'Withdraw from review' },
  approve: { from: ['IN_REVIEW'], to: 'APPROVED', permission: 'content.review', label: 'Approve' },
  request_changes: { from: ['IN_REVIEW', 'APPROVED'], to: 'CHANGES_REQUESTED', permission: 'content.review', label: 'Request changes' },
  publish: { from: ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED'], to: 'PUBLISHED', permission: 'content.publish', label: 'Publish' },
  unpublish: { from: ['PUBLISHED', 'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED'], to: 'DRAFT', permission: 'content.publish', label: 'Unpublish' },
  schedule: { from: ['DRAFT', 'APPROVED', 'CHANGES_REQUESTED', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED'], to: 'SCHEDULED', permission: 'content.publish', label: 'Schedule' },
  unschedule: { from: ['SCHEDULED'], to: 'DRAFT', permission: 'content.publish', label: 'Cancel schedule' },
  archive: { from: ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PUBLISHED', 'SCHEDULED'], to: 'ARCHIVED', permission: 'content.publish', label: 'Archive' },
  unarchive: { from: ['ARCHIVED'], to: 'DRAFT', permission: 'content.update', label: 'Restore from archive' },
};

export function canTransition(action: WorkflowAction, from: EntryStatus): boolean {
  return WORKFLOW_TRANSITIONS[action].from.includes(from);
}

export const EVENT_TYPES = [
  'content.created',
  'content.updated',
  'content.deleted',
  'content.published',
  'content.unpublished',
  'content.scheduled',
  'page.published',
  'page.unpublished',
  'media.uploaded',
  'media.updated',
  'media.deleted',
  'schema.updated',
  'release.published',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_DESCRIPTIONS: Record<EventType, string> = {
  'content.created': 'An entry was created',
  'content.updated': 'A draft was saved',
  'content.deleted': 'An entry was deleted',
  'content.published': 'An entry went live or its live version changed',
  'content.unpublished': 'An entry was taken offline',
  'content.scheduled': 'An entry was scheduled for publishing',
  'page.published': 'A page went live or its live version changed',
  'page.unpublished': 'A page was taken offline',
  'media.uploaded': 'A media asset was uploaded',
  'media.updated': 'A media asset was changed or replaced',
  'media.deleted': 'A media asset was deleted',
  'schema.updated': 'A content type or component changed',
  'release.published': 'A release was published',
};

/** Payload delivered to webhooks and WebSocket subscribers. */
export interface ContentEvent {
  id: string;
  event: EventType;
  organization: string;
  project: string;
  projectId: string;
  environment: string;
  environmentId: string;
  contentType?: string;
  documentId?: string;
  entryId?: string;
  locale?: string;
  slug?: string | null;
  path?: string | null;
  title?: string | null;
  releaseId?: string;
  documents?: { contentType: string; documentId: string; slug?: string | null; path?: string | null }[];
  timestamp: string;
}

export const PAGE_TYPE_ID = 'pages';
export const TOKEN_TYPES = ['READ_ONLY', 'READ_WRITE', 'PREVIEW'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];
export const ENVIRONMENT_KEYS = ['development', 'staging', 'production'] as const;
