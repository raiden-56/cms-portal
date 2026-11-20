import { format, formatDistanceToNowStrict, isThisYear, isToday, isYesterday } from 'date-fns';

export { formatBytes } from '@meridian/shared';

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "3 minutes ago", "in 2 days". */
export function relativeTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  if (Math.abs(Date.now() - d.getTime()) < 45_000) return 'just now';
  return formatDistanceToNowStrict(d, { addSuffix: true });
}

/** "Today 14:05", "Yesterday 09:30", "12 Mar", "12 Mar 2024". */
export function shortDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  if (isToday(d)) return `Today ${format(d, 'HH:mm')}`;
  if (isYesterday(d)) return `Yesterday ${format(d, 'HH:mm')}`;
  return format(d, isThisYear(d) ? 'd MMM' : 'd MMM yyyy');
}

export function fullDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, 'd MMM yyyy, HH:mm') : '—';
}

/** Value for <input type="datetime-local"> in the viewer's timezone. */
export function toLocalInput(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "yyyy-MM-dd'T'HH:mm") : '';
}

export const compactNumber = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);

export const percent = (fraction: number): string => `${(fraction * 100).toFixed(fraction > 0 && fraction < 0.001 ? 2 : 1)}%`;

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Turns "entry.request_changes" into "Request changes". */
export function humanize(value: string): string {
  const last = value.split('.').pop() ?? value;
  const text = last.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const ACTION_VERBS: Record<string, string> = {
  'entry.created': 'created',
  'entry.updated': 'edited',
  'entry.published': 'published',
  'entry.unpublished': 'unpublished',
  'entry.scheduled': 'scheduled',
  'entry.unscheduled': 'cancelled the schedule of',
  'entry.deleted': 'moved to trash',
  'entry.restored': 'restored',
  'entry.purged': 'permanently deleted',
  'entry.submit': 'submitted for review',
  'entry.withdraw': 'withdrew from review',
  'entry.approve': 'approved',
  'entry.request_changes': 'requested changes on',
  'entry.archive': 'archived',
  'entry.unarchive': 'restored from archive',
  'entry.version_restored': 'restored a version of',
  'entry.schedule_failed': 'could not publish (schedule failed)',
  'release.published': 'published release',
  'release.created': 'created release',
  'media.uploaded': 'uploaded',
  'media.deleted': 'deleted file',
  'media.replaced': 'replaced file',
  'schema.type.created': 'created content type',
  'schema.type.fields_changed': 'changed the fields of',
  'schema.type.deleted': 'deleted content type',
  'schema.component.created': 'created component',
  'token.created': 'created API token',
  'token.revoked': 'revoked API token',
  'webhook.created': 'created webhook',
  'member.invited': 'invited',
  'member.joined': 'joined as',
  'project.created': 'created project',
};

/** Past-tense phrase for an audit action, e.g. "published". Falls back to a readable form of the raw action. */
export const actionVerb = (action: string): string => ACTION_VERBS[action] ?? humanize(action).toLowerCase();
