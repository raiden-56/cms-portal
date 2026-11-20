import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { format, isThisYear, isToday, isTomorrow } from 'date-fns';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EventOutlined from '@mui/icons-material/EventOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, Page, PageHeader, Pill, RelativeTime, Section, StatusChip, TableSkeleton } from '@/components/ui';
import { ScheduleDialog } from '@/features/content/dialogs';
import { entryHref, useInvalidateContent } from '@/features/content/hooks';
import { api } from '@/lib/api';
import { fullDateTime, relativeTime } from '@/lib/format';
import type { EntryDetail, EntryListItem, Release, ReleaseItem } from '@/lib/types';
import { toast } from '@/store';
import { ActionPill, entryCount, plural, titleLinkSx } from './parts';

/** One scheduled action. An entry with both a publish and an unpublish time appears twice. */
interface Slot {
  key: string;
  entry: EntryListItem;
  kind: ReleaseItem['action'];
  at: Date;
}

interface Day {
  key: string;
  label: string;
  hint: string;
  overdue: boolean;
  slots: Slot[];
}

/** The scheduler runs about once a minute, so a time that has only just passed is not late yet. */
const GRACE_MS = 90_000;

function dayLabel(date: Date): { label: string; hint: string } {
  const full = format(date, isThisYear(date) ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy');
  if (isToday(date)) return { label: 'Today', hint: full };
  if (isTomorrow(date)) return { label: 'Tomorrow', hint: full };
  return { label: full, hint: relativeTime(date) };
}

function buildAgenda(entries: EntryListItem[], now: number): Day[] {
  const slots: Slot[] = [];
  for (const entry of entries) {
    if (entry.scheduledPublishAt) slots.push({ key: `${entry.id}:publish`, entry, kind: 'PUBLISH', at: new Date(entry.scheduledPublishAt) });
    if (entry.scheduledUnpublishAt) slots.push({ key: `${entry.id}:unpublish`, entry, kind: 'UNPUBLISH', at: new Date(entry.scheduledUnpublishAt) });
  }
  slots.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Sorted by time, so late items come first and each day's items are already next to each other.
  const days: Day[] = [];
  for (const slot of slots) {
    const overdue = slot.at.getTime() < now - GRACE_MS;
    const key = overdue ? 'overdue' : format(slot.at, 'yyyy-MM-dd');
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = overdue ? { key, label: 'Overdue', hint: 'Due, but not processed yet. These run as soon as the scheduler picks them up.', overdue, slots: [] } : { key, ...dayLabel(slot.at), overdue, slots: [] };
      days.push(day);
    }
    day.slots.push(slot);
  }
  return days;
}

const untitled = (title: string | null | undefined) => title ?? 'Untitled';

export default function ScheduledPage() {
  const ws = useProject();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const invalidate = useInvalidateContent();
  const envId = ws.environment.id;
  const [rescheduling, setRescheduling] = useState<EntryListItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const canPublish = ws.can('content.publish');
  const multiLocale = ws.project.locales.length > 1;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const scheduled = useQuery({
    queryKey: ['scheduled', envId],
    queryFn: () => api.get<{ items: EntryListItem[] }>(`${ws.envBase}/scheduled`).then((r) => r.items),
    refetchInterval: 60_000,
  });
  const releases = useQuery({
    queryKey: ['releases', envId],
    queryFn: () => api.get<{ items: Release[] }>(`${ws.envBase}/releases`).then((r) => r.items),
    refetchInterval: 60_000,
  });

  // Recomputed on every refetch so "Today", "Tomorrow" and "Overdue" stay true while the page is open.
  const days = useMemo(() => buildAgenda(scheduled.data ?? [], scheduled.dataUpdatedAt || Date.now()), [scheduled.data, scheduled.dataUpdatedAt]);
  const total = days.reduce((sum, day) => sum + day.slots.length, 0);
  const scheduledReleases = useMemo(
    () => (releases.data ?? []).filter((r) => r.status === 'SCHEDULED').sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime()),
    [releases.data],
  );

  const refresh = (entryId: string) => {
    invalidate(entryId);
    void queryClient.invalidateQueries({ queryKey: ['entry', envId, entryId] });
  };

  const cancel = (slot: Slot) => {
    const { entry } = slot;
    // An unpublish time only makes sense for content that is live or about to be, so it cannot outlive a cancelled publish.
    const alsoUnpublish = slot.kind === 'PUBLISH' && !!entry.scheduledUnpublishAt && !entry.isPublished;
    const body = slot.kind === 'PUBLISH' ? { publishAt: null, ...(alsoUnpublish ? { unpublishAt: null } : {}) } : { unpublishAt: null };
    void confirm({
      title: slot.kind === 'PUBLISH' ? 'Cancel this scheduled publish?' : 'Cancel this scheduled unpublish?',
      message: (
        <>
          “{untitled(entry.title)}” will no longer be {slot.kind === 'PUBLISH' ? 'published' : 'taken offline'} on {fullDateTime(slot.at)}.
          {slot.kind === 'PUBLISH' ? ' It stays exactly as it is now until someone publishes or schedules it again.' : ' It stays live until someone unpublishes it.'}
          {alsoUnpublish ? ' Its scheduled unpublish is cancelled too, because that only applies once the content is live.' : ''}
        </>
      ),
      confirmLabel: 'Cancel schedule',
      cancelLabel: 'Keep schedule',
      destructive: true,
      onConfirm: async () => {
        setBusy(slot.key);
        try {
          await api.post<EntryDetail>(`${ws.envBase}/entry/${entry.id}/schedule`, body);
          refresh(entry.id);
          toast.success(slot.kind === 'PUBLISH' ? `Cancelled the scheduled publish of “${untitled(entry.title)}”` : `Cancelled the scheduled unpublish of “${untitled(entry.title)}”`);
        } finally {
          setBusy(null);
        }
      },
    });
  };

  return (
    <Page>
      <PageHeader
        title="Scheduled content"
        meta={total > 0 ? <Pill label={`${total} upcoming`} /> : undefined}
        description={`Everything set to go live or come offline automatically, in the order it will happen. Times are in your timezone (${timezone}).`}
      />

      {scheduled.isLoading ? (
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <TableSkeleton rows={6} columns={4} />
        </Paper>
      ) : scheduled.isError ? (
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <ErrorState error={scheduled.error} onRetry={() => void scheduled.refetch()} />
        </Paper>
      ) : days.length === 0 ? (
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <EmptyState
            icon={<EventOutlined />}
            title="Nothing is scheduled"
            description="Open an entry or page and choose Schedule to have it published, or taken offline, at a set time. Everything that is queued up appears here."
            action={
              <Button variant="outlined" component={RouterLink} to={ws.href('content')}>
                Browse content
              </Button>
            }
          />
        </Paper>
      ) : (
        <Stack spacing={5}>
          {days.map((day) => (
            <Section
              key={day.key}
              flush
              title={day.label}
              description={day.hint}
              action={
                <Typography variant="caption" color={day.overdue ? 'warning.dark' : 'text.secondary'} sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {plural(day.slots.length, 'change')}
                </Typography>
              }
            >
              <Box component="ul" aria-label={`Scheduled for ${day.label.toLowerCase()}`} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {day.slots.map((slot) => {
                  const { entry } = slot;
                  const linkable = entry.isPage || !!entry.contentType;
                  return (
                    <Stack
                      component="li"
                      key={slot.key}
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={{ xs: 2, md: 4 }}
                      sx={{ px: 5, py: 3, alignItems: { md: 'center' }, opacity: busy === slot.key ? 0.55 : 1, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}
                    >
                      <Stack direction="row" spacing={4} sx={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
                        <Box sx={{ width: day.overdue ? 92 : 44, flexShrink: 0 }}>
                          <Typography component="time" dateTime={slot.at.toISOString()} variant="body2" sx={{ display: 'block', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: day.overdue ? 'warning.dark' : 'text.primary' }}>
                            {format(slot.at, 'HH:mm')}
                          </Typography>
                          {day.overdue && (
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {format(slot.at, isThisYear(slot.at) ? 'd MMM' : 'd MMM yyyy')}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          {linkable ? (
                            <Typography component={RouterLink} to={entryHref(ws, entry)} variant="body2" noWrap sx={titleLinkSx}>
                              {untitled(entry.title)}
                            </Typography>
                          ) : (
                            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                              {untitled(entry.title)}
                            </Typography>
                          )}
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {entry.contentTypeName}
                            {multiLocale && entry.locale ? ` · ${entry.locale}` : ''}
                            {' · '}
                            <RelativeTime value={slot.at} />
                          </Typography>
                        </Box>
                        <Box sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0 }}>
                          <StatusChip status={entry.status} isPublished={entry.isPublished} hasChanges={entry.hasChanges} />
                        </Box>
                        <Box sx={{ flexShrink: 0 }}>
                          <ActionPill action={slot.kind} />
                        </Box>
                      </Stack>
                      {canPublish && (
                        <Stack direction="row" spacing={1.5} sx={{ flexShrink: 0, pl: { xs: day.overdue ? '108px' : '60px', md: 0 } }}>
                          <Button size="small" variant="outlined" disabled={busy === slot.key} onClick={() => setRescheduling(entry)} aria-label={`Reschedule ${untitled(entry.title)}`}>
                            Reschedule
                          </Button>
                          <Button size="small" disabled={busy === slot.key} onClick={() => cancel(slot)} aria-label={`Cancel the scheduled ${slot.kind === 'PUBLISH' ? 'publish' : 'unpublish'} of ${untitled(entry.title)}`}>
                            Cancel schedule
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                  );
                })}
              </Box>
            </Section>
          ))}
          {!canPublish && (
            <Typography variant="caption" color="text.secondary">
              Changing or cancelling a schedule needs publishing rights.
            </Typography>
          )}
        </Stack>
      )}

      <Section title="Scheduled releases" description="Releases publish every entry in them at the same moment, or none at all." flush sx={{ mt: 6 }}>
        {releases.isLoading ? (
          <TableSkeleton rows={2} columns={3} />
        ) : releases.isError ? (
          <ErrorState compact error={releases.error} onRetry={() => void releases.refetch()} />
        ) : scheduledReleases.length === 0 ? (
          <EmptyState
            compact
            icon={<RocketLaunchOutlined />}
            title="No releases are scheduled"
            description="Schedule a release to put a group of changes live together at a set time."
            action={
              <Button variant="outlined" component={RouterLink} to={ws.href('publishing/releases')}>
                View releases
              </Button>
            }
          />
        ) : (
          <Box component="ul" aria-label="Scheduled releases" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {scheduledReleases.map((release) => (
              <Stack
                component="li"
                key={release.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 1, sm: 4 }}
                sx={{ px: 5, py: 3, alignItems: { sm: 'center' }, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography component={RouterLink} to={ws.href(`publishing/releases/${release.id}`)} variant="body2" noWrap sx={titleLinkSx}>
                    {release.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {entryCount(release.itemCount ?? 0)}
                    {release.description ? ` · ${release.description}` : ''}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {fullDateTime(release.scheduledAt)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, minWidth: { sm: 96 }, textAlign: { sm: 'right' } }}>
                  <RelativeTime value={release.scheduledAt} />
                </Typography>
              </Stack>
            ))}
          </Box>
        )}
      </Section>

      <ScheduleDialog
        entry={rescheduling}
        onClose={() => setRescheduling(null)}
        onDone={(detail) => {
          refresh(detail.id);
          toast.success(detail.scheduledPublishAt || detail.scheduledUnpublishAt ? `Schedule updated for “${untitled(detail.title)}”` : `Schedule cleared for “${untitled(detail.title)}”`);
        }}
      />
    </Page>
  );
}
