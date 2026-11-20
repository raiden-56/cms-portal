import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import { useProject } from '@/app/workspace';
import { CodeBlock, EmptyState, ErrorState, FormError, Pill, RelativeTime, TableSkeleton, UserAvatar } from '@/components/ui';
import { API_URL, api } from '@/lib/api';
import { fullDateTime, toLocalInput } from '@/lib/format';
import type { EntryDetail, EntryVersion } from '@/lib/types';

// ─── Schedule ────────────────────────────────────────────────────────────────

export function ScheduleDialog({ open, onClose, entry, onSchedule }: { open: boolean; onClose: () => void; entry: EntryDetail; onSchedule: (input: { publishAt: string | null; unpublishAt: string | null }) => Promise<unknown> }) {
  const [publishAt, setPublishAt] = useState('');
  const [unpublishAt, setUnpublishAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setPublishAt(toLocalInput(entry.scheduledPublishAt));
    setUnpublishAt(toLocalInput(entry.scheduledUnpublishAt));
    setError(null);
  }, [open, entry.scheduledPublishAt, entry.scheduledUnpublishAt]);

  const hasSchedule = !!entry.scheduledPublishAt || !!entry.scheduledUnpublishAt;
  const now = Date.now();
  const publishPast = !!publishAt && new Date(publishAt).getTime() <= now;
  const unpublishPast = !!unpublishAt && new Date(unpublishAt).getTime() <= now;
  const wrongOrder = !!publishAt && !!unpublishAt && new Date(unpublishAt) <= new Date(publishAt);
  const invalid = publishPast || unpublishPast || wrongOrder || (!publishAt && !unpublishAt && !hasSchedule);

  const submit = async (input: { publishAt: string | null; unpublishAt: string | null }) => {
    setBusy(true);
    setError(null);
    try {
      await onSchedule(input);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" aria-labelledby="schedule-title">
      <DialogTitle id="schedule-title">Schedule page</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          The page goes live, or comes down, automatically at the times you set. Times use your local timezone.
        </Typography>
        <FormError error={error} />
        <Stack spacing={4}>
          <TextField
            label="Publish at"
            type="datetime-local"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
            error={publishPast}
            helperText={publishPast ? 'Choose a time in the future' : 'Publishes the page as it is at that moment'}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Unpublish at (optional)"
            type="datetime-local"
            value={unpublishAt}
            onChange={(e) => setUnpublishAt(e.target.value)}
            error={unpublishPast || wrongOrder}
            helperText={wrongOrder ? 'Must be after the publish time' : unpublishPast ? 'Choose a time in the future' : 'Takes the page offline again'}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        {hasSchedule && (
          <Button color="error" disabled={busy} onClick={() => void submit({ publishAt: null, unpublishAt: null })} sx={{ mr: 'auto' }}>
            Clear schedule
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" loading={busy} disabled={invalid} onClick={() => void submit({ publishAt: publishAt ? new Date(publishAt).toISOString() : null, unpublishAt: unpublishAt ? new Date(unpublishAt).toISOString() : null })}>
          Save schedule
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Review comment ──────────────────────────────────────────────────────────

export function CommentDialog({ open, onClose, title, description, confirmLabel, required, onSubmit }: { open: boolean; onClose: () => void; title: string; description: string; confirmLabel: string; required?: boolean; onSubmit: (comment: string) => Promise<unknown> }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (open) {
      setComment('');
      setError(null);
    }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(comment.trim());
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" aria-labelledby="comment-title">
      <DialogTitle id="comment-title">{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {description}
        </Typography>
        <FormError error={error} />
        <TextField autoFocus multiline minRows={3} maxRows={8} label={required ? 'What needs to change?' : 'Comment (optional)'} value={comment} onChange={(e) => setComment(e.target.value)} slotProps={{ htmlInput: { maxLength: 4000 } }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" loading={busy} disabled={required && !comment.trim()} onClick={() => void submit()}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Save conflict ───────────────────────────────────────────────────────────

export interface ConflictInfo {
  updatedBy: string | null;
  updatedAt: string | null;
}

export function ConflictDialog({ conflict, busy, onReload, onOverwrite, onClose }: { conflict: ConflictInfo | null; busy: boolean; onReload: () => void; onOverwrite: () => void; onClose: () => void }) {
  return (
    <Dialog open={!!conflict} onClose={busy ? undefined : onClose} maxWidth="xs" aria-labelledby="conflict-title">
      <DialogTitle id="conflict-title">Someone else changed this page</DialogTitle>
      <DialogContent>
        <Typography variant="body1" color="text.secondary">
          {conflict?.updatedBy ? <b>{conflict.updatedBy}</b> : 'Another editor'} saved a newer version{conflict?.updatedAt ? ` (${fullDateTime(conflict.updatedAt)})` : ''} while you were editing. Your changes have not been saved.
        </Typography>
        <Alert severity="info" sx={{ mt: 4 }}>
          Loading their version discards your unsaved changes. Keeping yours replaces theirs — their version stays in the version history.
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy} sx={{ mr: 'auto' }}>
          Decide later
        </Button>
        <Button onClick={onReload} disabled={busy}>
          Load their version
        </Button>
        <Button variant="contained" loading={busy} onClick={onOverwrite}>
          Keep mine
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Leaving with unsaved changes ────────────────────────────────────────────

export function LeaveDialog({ open, busy, onStay, onDiscard, onSave }: { open: boolean; busy: boolean; onStay: () => void; onDiscard: () => void; onSave: () => void }) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onStay} maxWidth="xs" aria-labelledby="leave-title">
      <DialogTitle id="leave-title">Save changes before leaving?</DialogTitle>
      <DialogContent>
        <Typography variant="body1" color="text.secondary">
          This page has changes that are not saved yet.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={onDiscard} disabled={busy} sx={{ mr: 'auto' }}>
          Discard
        </Button>
        <Button onClick={onStay} disabled={busy}>
          Stay
        </Button>
        <Button variant="contained" loading={busy} onClick={onSave} autoFocus>
          Save and leave
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Delivery API details ────────────────────────────────────────────────────

export function DeliveryDialog({ open, onClose, path, isPublished, hasChanges }: { open: boolean; onClose: () => void; path: string; isPublished: boolean; hasChanges: boolean }) {
  const url = `${API_URL}/api/v1/pages?path=${encodeURIComponent(path)}`;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" aria-labelledby="delivery-title">
      <DialogTitle id="delivery-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        Published page in the delivery API
        <IconButton aria-label="Close" onClick={onClose} edge="end">
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {!isPublished ? (
          <Alert severity="warning" sx={{ mb: 4 }}>
            This page is not published yet, so the request below returns 404 until it is.
          </Alert>
        ) : hasChanges ? (
          <Alert severity="info" sx={{ mb: 4 }}>
            The API serves the last published version. Your newer edits go live when you publish again.
          </Alert>
        ) : null}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Connected applications fetch this page by its URL path and render each block with their own components. Use an API key from Developers → API Keys.
        </Typography>
        <Stack spacing={3}>
          <CodeBlock language="http" code={`GET ${url}`} />
          <CodeBlock language="bash" code={`curl -H "Authorization: Bearer $MERIDIAN_API_KEY" \\\n  "${url}"`} />
          <CodeBlock language="graphql" code={`{\n  page(path: "${path}") {\n    title\n    path\n    seo\n    blocks\n  }\n}`} />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

// ─── Version history ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<EntryVersion['kind'], string> = { SAVE: 'Saved', AUTOSAVE: 'Autosaved', PUBLISH: 'Published', RESTORE: 'Restored' };

export function VersionsDrawer({ open, onClose, entryId, canRestore, onRestore }: { open: boolean; onClose: () => void; entryId: string; canRestore: boolean; onRestore: (version: EntryVersion) => void }) {
  const ws = useProject();
  const versions = useQuery({
    queryKey: ['entry-versions', ws.environment.id, entryId],
    queryFn: () => api.get<{ items: EntryVersion[] }>(`${ws.envBase}/entry/${entryId}/versions`).then((r) => r.items),
    enabled: open,
    staleTime: 0,
  });
  const items = versions.data ?? [];
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 380 } } } }}>
      <Stack direction="row" sx={{ px: 4, height: 52, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle', flexShrink: 0 }}>
        <Typography variant="h5" component="h2">
          Version history
        </Typography>
        <IconButton aria-label="Close version history" onClick={onClose} edge="end">
          <CloseOutlined />
        </IconButton>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {versions.isLoading ? (
          <TableSkeleton rows={6} columns={2} />
        ) : versions.isError ? (
          <ErrorState compact error={versions.error} onRetry={() => void versions.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState compact icon={<HistoryOutlined />} title="No versions yet" description="Each save and publish is recorded here." />
        ) : (
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 2 }}>
            {items.map((version, index) => (
              <Box component="li" key={version.id} sx={{ px: 2.5, py: 3, borderRadius: '8px', '&:hover': { bgcolor: 'action.hover' }, '&:hover .restore, &:focus-within .restore': { opacity: 1 } }}>
                <Stack direction="row" spacing={2.5} sx={{ alignItems: 'flex-start' }}>
                  <UserAvatar name={version.createdBy ?? 'System'} size={24} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Version {version.number}
                      </Typography>
                      <Pill label={KIND_LABEL[version.kind]} fg={version.kind === 'PUBLISH' ? 'success.dark' : 'text.secondary'} bg={version.kind === 'PUBLISH' ? 'success.light' : 'surface.sunken'} />
                      {version.isPublished && <Pill label="Live" fg="success.dark" bg="success.light" dot />}
                      {index === 0 && <Pill label="Latest" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                      {version.createdBy ?? 'System'} · <RelativeTime value={version.updatedAt ?? version.createdAt} />
                    </Typography>
                    {version.note && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {version.note}
                      </Typography>
                    )}
                  </Box>
                  {canRestore && index !== 0 && (
                    <Button className="restore" size="small" variant="outlined" onClick={() => onRestore(version)} sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 100ms', flexShrink: 0 }}>
                      Restore
                    </Button>
                  )}
                </Stack>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Typography variant="caption" color="text.disabled" sx={{ px: 4, py: 3, borderTop: 1, borderColor: 'border.subtle' }}>
        Restoring brings back a version’s content as a new draft. The page’s address and the live version do not change until you publish.
      </Typography>
    </Drawer>
  );
}
