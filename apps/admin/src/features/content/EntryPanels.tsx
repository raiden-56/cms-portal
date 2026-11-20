import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CodeBlock, CopyButton, ErrorState, Mono, Pill, RelativeTime, UserAvatar } from '@/components/ui';
import { API_URL, api, errorMessage } from '@/lib/api';
import { actionVerb, fullDateTime } from '@/lib/format';
import type { ActivityItem, Comment, ContentType, EntryDetail, EntryVersion } from '@/lib/types';
import { toast, useAppSelector } from '@/store';
import { DataPreview, VersionDiff } from './VersionDiff';

const KIND: Record<EntryVersion['kind'], { label: string; fg: string; bg: string }> = {
  PUBLISH: { label: 'Published', fg: 'success.dark', bg: 'success.light' },
  SAVE: { label: 'Saved', fg: 'text.secondary', bg: 'surface.sunken' },
  AUTOSAVE: { label: 'Autosaved', fg: 'text.secondary', bg: 'surface.sunken' },
  RESTORE: { label: 'Restored', fg: 'info.dark', bg: 'info.light' },
};

export function VersionKindPill({ kind }: { kind: EntryVersion['kind'] }) {
  const tone = KIND[kind];
  return <Pill label={tone.label} fg={tone.fg} bg={tone.bg} />;
}

const PanelLoading = () => (
  <Stack spacing={3} sx={{ p: 4 }} aria-busy="true">
    {[0, 1, 2, 3].map((i) => (
      <Skeleton key={i} variant="rounded" height={38} />
    ))}
  </Stack>
);

const PanelEmpty = ({ children }: { children: string }) => (
  <Typography variant="body2" color="text.secondary" sx={{ px: 4, py: 8, textAlign: 'center' }}>
    {children}
  </Typography>
);

// ─── Versions ────────────────────────────────────────────────────────────────

type Compare = { kind: 'pair'; older: EntryVersion; newer: EntryVersion } | { kind: 'current'; version: EntryVersion } | { kind: 'view'; version: EntryVersion };

export function VersionsPanel({
  entry,
  type,
  currentData,
  hasUnsavedChanges,
  canRestore,
  onRestored,
}: {
  entry: EntryDetail;
  type: ContentType;
  /** The working copy as it is in the form right now. */
  currentData: Record<string, unknown>;
  hasUnsavedChanges: boolean;
  canRestore: boolean;
  onRestored: (detail: EntryDetail) => void;
}) {
  const { environment, envBase } = useProject();
  const confirm = useConfirm();
  const [picked, setPicked] = useState<string[]>([]);
  const [compare, setCompare] = useState<Compare | null>(null);
  const base = `${envBase}/entry/${entry.id}`;

  const versions = useQuery({
    queryKey: ['entry-versions', environment.id, entry.id],
    queryFn: () => api.get<{ items: EntryVersion[] }>(`${base}/versions`).then((r) => r.items),
  });
  const items = versions.data ?? [];
  const chosen = picked.map((id) => items.find((v) => v.id === id)).filter((v): v is EntryVersion => !!v);

  const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current.slice(-1), id]));

  const restore = (version: EntryVersion) =>
    confirm({
      title: `Restore version ${version.number}?`,
      message: (
        <>
          The working copy will be replaced with the content of version {version.number}
          {hasUnsavedChanges ? ', and your unsaved changes will be lost' : ''}. Nothing changes on the live site until you publish.
        </>
      ),
      confirmLabel: 'Restore version',
      onConfirm: async () => {
        const detail = await api.post<EntryDetail>(`${base}/versions/${version.id}/restore`);
        setPicked([]);
        setCompare(null);
        onRestored(detail);
        toast.success(`Restored version ${version.number}`);
      },
    });

  if (versions.isLoading) return <PanelLoading />;
  if (versions.isError) return <ErrorState compact error={versions.error} onRetry={() => void versions.refetch()} />;
  if (items.length === 0) return <PanelEmpty>No versions have been saved yet.</PanelEmpty>;

  return (
    <Box>
      <Box sx={{ px: 4, py: 2.5, borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
        {chosen.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            Select one version to view or restore it, or two to compare them.
          </Typography>
        )}
        {chosen.length === 1 && (
          <Stack direction="row" sx={{ gap: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => setCompare({ kind: 'view', version: chosen[0] })}>
              View
            </Button>
            <Button size="small" variant="outlined" onClick={() => setCompare({ kind: 'current', version: chosen[0] })}>
              Compare with current
            </Button>
            {canRestore && (
              <Button size="small" variant="outlined" onClick={() => void restore(chosen[0])}>
                Restore
              </Button>
            )}
          </Stack>
        )}
        {chosen.length === 2 && (
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              const [a, b] = [...chosen].sort((x, y) => x.number - y.number);
              setCompare({ kind: 'pair', older: a, newer: b });
            }}
          >
            Compare versions {Math.min(chosen[0].number, chosen[1].number)} and {Math.max(chosen[0].number, chosen[1].number)}
          </Button>
        )}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {items.map((version) => (
          <Box
            component="li"
            key={version.id}
            sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, pl: 1.5, pr: 4, py: 2, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' }, bgcolor: picked.includes(version.id) ? 'action.selected' : 'transparent' }}
          >
            <Checkbox checked={picked.includes(version.id)} onChange={() => toggle(version.id)} slotProps={{ input: { 'aria-label': `Select version ${version.number}` } }} sx={{ mt: -0.5 }} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  Version {version.number}
                </Typography>
                <VersionKindPill kind={version.kind} />
                {version.isPublished && <Pill label="Live" fg="success.dark" bg="success.light" dot title="This is the version currently served by the API" />}
              </Stack>
              <Typography variant="caption" color="text.secondary" component="div" noWrap>
                {version.createdBy ?? 'System'} · <RelativeTime value={version.updatedAt ?? version.createdAt} />
              </Typography>
              {version.note && (
                <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                  {version.note}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>

      <CompareDialog
        compare={compare}
        base={base}
        envId={environment.id}
        entryId={entry.id}
        type={type}
        currentData={currentData}
        onClose={() => setCompare(null)}
        onRestore={canRestore ? restore : undefined}
      />
    </Box>
  );
}

function CompareDialog({
  compare,
  base,
  envId,
  entryId,
  type,
  currentData,
  onClose,
  onRestore,
}: {
  compare: Compare | null;
  base: string;
  envId: string;
  entryId: string;
  type: ContentType;
  currentData: Record<string, unknown>;
  onClose: () => void;
  onRestore?: (version: EntryVersion) => void;
}) {
  const ids = compare ? (compare.kind === 'pair' ? [compare.older.id, compare.newer.id] : [compare.version.id]) : [];
  const loaded = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['entry-version', envId, entryId, id],
      queryFn: () => api.get<EntryVersion>(`${base}/versions/${id}`),
      staleTime: Infinity,
    })),
  });
  const loading = loaded.some((q) => q.isLoading);
  const failed = loaded.find((q) => q.isError);
  const fields = useMemo(() => [...type.fields].sort((a, b) => a.position - b.position), [type.fields]);
  const single = compare && compare.kind !== 'pair' ? compare.version : null;

  const title = !compare
    ? ''
    : compare.kind === 'pair'
      ? `Version ${compare.older.number} compared with version ${compare.newer.number}`
      : compare.kind === 'current'
        ? `Version ${compare.version.number} compared with the current draft`
        : `Version ${compare.version.number}`;

  return (
    <Dialog open={!!compare} onClose={onClose} maxWidth="md" aria-labelledby="compare-title" scroll="paper">
      <DialogTitle id="compare-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        {title}
        <IconButton aria-label="Close" edge="end" onClick={onClose}>
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ minHeight: 240 }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 200 }}>
            <CircularProgress size={22} color="secondary" aria-label="Loading versions" />
          </Box>
        ) : failed ? (
          <ErrorState compact error={failed.error} onRetry={() => void failed.refetch()} />
        ) : compare?.kind === 'pair' ? (
          <VersionDiff before={loaded[0]?.data?.data} after={loaded[1]?.data?.data} fields={fields} beforeLabel={`Version ${compare.older.number}`} afterLabel={`Version ${compare.newer.number}`} />
        ) : compare?.kind === 'current' ? (
          <VersionDiff before={loaded[0]?.data?.data} after={currentData} fields={fields} beforeLabel={`Version ${compare.version.number}`} afterLabel="Current draft" />
        ) : compare ? (
          <DataPreview data={loaded[0]?.data?.data} fields={fields} />
        ) : null}
      </DialogContent>
      <DialogActions>
        {single && onRestore && <Button onClick={() => onRestore(single)}>Restore version {single.number}</Button>}
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Comments ────────────────────────────────────────────────────────────────

export function CommentsPanel({ entry, readOnly, canModerate }: { entry: EntryDetail; readOnly: boolean; canModerate: boolean }) {
  const { environment, envBase } = useProject();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const me = useAppSelector((s) => s.auth.user);
  const [text, setText] = useState('');
  const base = `${envBase}/entry/${entry.id}/comments`;
  const key = ['entry-comments', environment.id, entry.id];

  const comments = useQuery({ queryKey: key, queryFn: () => api.get<{ items: Comment[] }>(base).then((r) => r.items) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    // The open-comment count on the entry itself changes too.
    void queryClient.invalidateQueries({ queryKey: ['entry', environment.id, entry.id] });
  };
  const add = useMutation({
    mutationFn: (body: string) => api.post<Comment>(base, { body }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const resolve = useMutation({
    mutationFn: (comment: Comment) => api.patch<Comment>(`${base}/${comment.id}`, { resolved: !comment.resolvedAt }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = (comment: Comment) =>
    confirm({
      title: 'Delete this comment?',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: async () => {
        await api.delete(`${base}/${comment.id}`);
        refresh();
      },
    });
  const send = () => {
    if (text.trim() && !add.isPending) add.mutate(text.trim());
  };
  const items = comments.data ?? [];

  return (
    <Box>
      {comments.isLoading ? (
        <PanelLoading />
      ) : comments.isError ? (
        <ErrorState compact error={comments.error} onRetry={() => void comments.refetch()} />
      ) : items.length === 0 ? (
        <PanelEmpty>No comments yet. Use comments to ask questions and leave review feedback.</PanelEmpty>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {items.map((comment) => (
            <Box component="li" key={comment.id} sx={{ px: 4, py: 3, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' }, opacity: comment.resolvedAt ? 0.6 : 1 }}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <UserAvatar name={comment.author} size={22} />
                <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                  {comment.author}
                </Typography>
                {!readOnly && (
                  <Tooltip title={comment.resolvedAt ? 'Reopen' : 'Mark as resolved'}>
                    <IconButton size="small" aria-label={comment.resolvedAt ? 'Reopen comment' : 'Mark comment as resolved'} aria-pressed={!!comment.resolvedAt} onClick={() => resolve.mutate(comment)}>
                      {comment.resolvedAt ? <CheckCircleOutlined sx={{ color: 'success.main' }} /> : <RadioButtonUncheckedOutlined />}
                    </IconButton>
                  </Tooltip>
                )}
                {!readOnly && (comment.userId === me?.id || canModerate) && (
                  <Tooltip title="Delete">
                    <IconButton size="small" aria-label="Delete comment" onClick={() => void remove(comment)}>
                      <DeleteOutlineOutlined />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mt: 0.5, mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  <RelativeTime value={comment.createdAt} />
                </Typography>
                {comment.kind === 'changes_requested' && <Pill label="Changes requested" fg="warning.dark" bg="warning.light" />}
                {comment.kind === 'approval' && <Pill label="Approval" fg="success.dark" bg="success.light" />}
                {comment.resolvedAt && <Pill label="Resolved" />}
              </Stack>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {comment.body}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      {!readOnly && (
        <Box sx={{ p: 4, borderTop: 1, borderColor: 'border.subtle' }}>
          <TextField
            multiline
            minRows={2}
            maxRows={8}
            placeholder="Write a comment…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'New comment', maxLength: 4000 } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                // Keep the editor's own Ctrl+Enter (publish) from firing as well.
                e.preventDefault();
                e.stopPropagation();
                send();
              }
            }}
          />
          <Stack direction="row" sx={{ mt: 2, alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.disabled">
              Ctrl+Enter to send
            </Typography>
            <Button size="small" variant="contained" disabled={!text.trim()} loading={add.isPending} onClick={send}>
              Comment
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

// ─── Activity ────────────────────────────────────────────────────────────────

export function ActivityPanel({ entry }: { entry: EntryDetail }) {
  const { environment, envBase } = useProject();
  const activity = useQuery({
    queryKey: ['entry-activity', environment.id, entry.id],
    queryFn: () => api.get<{ items: ActivityItem[] }>(`${envBase}/entry/${entry.id}/activity`).then((r) => r.items),
  });
  if (activity.isLoading) return <PanelLoading />;
  if (activity.isError) return <ErrorState compact error={activity.error} onRetry={() => void activity.refetch()} />;
  const items = activity.data ?? [];
  if (items.length === 0) return <PanelEmpty>Nothing has happened to this entry yet.</PanelEmpty>;
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, px: 4, py: 3 }}>
      {items.map((item, index) => {
        const detail =
          typeof item.metadata?.comment === 'string'
            ? `“${item.metadata.comment}”`
            : typeof item.metadata?.restoredVersion === 'number'
              ? `Version ${item.metadata.restoredVersion}`
              : typeof item.metadata?.publishAt === 'string'
                ? `Publishes ${fullDateTime(item.metadata.publishAt)}`
                : typeof item.metadata?.reason === 'string'
                  ? item.metadata.reason
                  : null;
        return (
          <Box component="li" key={item.id} sx={{ display: 'flex', gap: 3, position: 'relative', pb: index === items.length - 1 ? 0 : 3.5 }}>
            {index !== items.length - 1 && <Box aria-hidden sx={{ position: 'absolute', left: 3, top: 14, bottom: 0, width: '1px', bgcolor: 'border.strong' }} />}
            <Box aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: index === 0 ? 'secondary.main' : 'border.strong', mt: 1.5, flexShrink: 0, position: 'relative' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2">
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {item.actorLabel ?? 'System'}
                </Box>{' '}
                {actionVerb(item.action)} this
              </Typography>
              {detail && (
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  {detail}
                </Typography>
              )}
              <Typography variant="caption" color="text.disabled">
                <RelativeTime value={item.createdAt} />
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// ─── Info ────────────────────────────────────────────────────────────────────

function InfoRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: 'center', py: 1.5, minHeight: 34 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 92, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{copy ? <Mono>{value}</Mono> : <Typography variant="body2" noWrap>{value}</Typography>}</Box>
      {copy && <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />}
    </Stack>
  );
}

export function InfoPanel({ entry, type }: { entry: EntryDetail; type: ContentType }) {
  const root = `${API_URL}/api/v1/${type.apiId}`;
  const single = type.kind === 'SINGLE';
  const locale = entry.locale !== entry.defaultLocale ? `?locale=${entry.locale}` : '';
  const rest = single ? `${root}${locale}` : `${root}/${entry.documentId}${locale}`;
  const curl = `curl "${rest}" \\\n  -H "Authorization: Bearer $MERIDIAN_API_KEY"`;
  return (
    <Box sx={{ px: 4, py: 3 }}>
      <InfoRow label="Document id" value={entry.documentId} copy />
      <InfoRow label="Entry id" value={entry.id} copy />
      {entry.slug && <InfoRow label="Slug" value={entry.slug} copy />}
      <InfoRow label="Locale" value={entry.locale} />
      <InfoRow label="Created" value={`${fullDateTime(entry.createdAt)}${entry.createdBy ? ` by ${entry.createdBy}` : ''}`} />
      <InfoRow label="Last saved" value={`${fullDateTime(entry.updatedAt)}${entry.updatedBy ? ` by ${entry.updatedBy}` : ''}`} />
      <InfoRow label="First published" value={entry.firstPublishedAt ? fullDateTime(entry.firstPublishedAt) : 'Never'} />
      <InfoRow label="Live since" value={entry.publishedAt ? fullDateTime(entry.publishedAt) : 'Not published'} />
      <InfoRow label="Versions" value={String(entry.versionCount)} />
      <Typography variant="overline" color="text.secondary" component="div" sx={{ mt: 4, mb: 1.5 }}>
        Delivery API
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
        {entry.isPublished ? 'The published version is available at:' : 'Once published, this entry will be available at:'}
      </Typography>
      <CodeBlock code={curl} language="bash" maxHeight={140} />
      {!single && entry.slug && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2, overflowWrap: 'anywhere' }}>
          Also reachable by slug: <Mono>{`/api/v1/${type.apiId}/${entry.slug}`}</Mono>
        </Typography>
      )}
    </Box>
  );
}
