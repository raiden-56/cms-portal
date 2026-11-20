import { type ReactNode, useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useProject } from '@/app/workspace';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fullDateTime, toLocalInput } from '@/lib/format';
import type { EntryDetail } from '@/lib/types';

/** An API error with its per-field problems listed underneath, for publish and schedule failures. */
export function ProblemAlert({ error, title, onClose }: { error: unknown; title?: string; onClose?: () => void }) {
  if (!error) return null;
  const details = error instanceof ApiError && Array.isArray(error.details) ? error.details : [];
  return (
    <Alert severity="error" onClose={onClose} sx={{ alignItems: 'flex-start', '& .MuiAlert-message': { py: 1.5, minWidth: 0 } }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {title ?? errorMessage(error)}
      </Typography>
      {details.length > 0 && (
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 4.5 }}>
          {details.slice(0, 8).map((d, i) => (
            <li key={i}>
              <Typography variant="body2">{d.message}</Typography>
            </li>
          ))}
          {details.length > 8 && (
            <li>
              <Typography variant="body2">and {details.length - 8} more</Typography>
            </li>
          )}
        </Box>
      )}
    </Alert>
  );
}

const scheduleSchema = z
  .object({ publishAt: z.string(), unpublishAt: z.string() })
  .superRefine((value, ctx) => {
    const now = Date.now();
    const publish = value.publishAt ? new Date(value.publishAt).getTime() : null;
    const unpublish = value.unpublishAt ? new Date(value.unpublishAt).getTime() : null;
    if (publish !== null && (Number.isNaN(publish) || publish <= now)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['publishAt'], message: 'Choose a time in the future' });
    if (unpublish !== null && (Number.isNaN(unpublish) || unpublish <= now)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unpublishAt'], message: 'Choose a time in the future' });
    if (publish !== null && unpublish !== null && unpublish <= publish) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['unpublishAt'], message: 'Must be after the publish time' });
  });
type ScheduleValues = z.infer<typeof scheduleSchema>;

export interface Schedulable {
  id: string;
  title: string | null;
  isPublished: boolean;
  scheduledPublishAt: string | null;
  scheduledUnpublishAt: string | null;
}

/** Sets, changes or clears the publish / unpublish schedule of one entry. */
export function ScheduleDialog({ entry, onClose, onDone }: { entry: Schedulable | null; onClose: () => void; onDone: (detail: EntryDetail) => void }) {
  const { envBase } = useProject();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<ScheduleValues>({ resolver: zodResolver(scheduleSchema), defaultValues: { publishAt: '', unpublishAt: '' } });
  const { errors, isSubmitting } = form.formState;
  // MUI forwards `ref` to the wrapper element; react-hook-form needs the <input> itself to apply reset values.
  const field = (name: keyof ScheduleValues) => {
    const { ref, ...rest } = form.register(name);
    return { ...rest, inputRef: ref };
  };

  useEffect(() => {
    if (!entry) return;
    setError(null);
    form.reset({ publishAt: toLocalInput(entry.scheduledPublishAt), unpublishAt: toLocalInput(entry.scheduledUnpublishAt) });
  }, [entry, form]);

  const send = async (values: ScheduleValues) => {
    if (!entry) return;
    setError(null);
    try {
      const detail = await api.post<EntryDetail>(`${envBase}/entry/${entry.id}/schedule`, {
        publishAt: values.publishAt ? new Date(values.publishAt).toISOString() : null,
        unpublishAt: values.unpublishAt ? new Date(values.unpublishAt).toISOString() : null,
      });
      onDone(detail);
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  const hasSchedule = !!entry?.scheduledPublishAt || !!entry?.scheduledUnpublishAt;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Dialog open={!!entry} onClose={isSubmitting ? undefined : onClose} maxWidth="xs" aria-labelledby="schedule-title">
      <form noValidate onSubmit={form.handleSubmit(send)}>
        <DialogTitle id="schedule-title">Schedule “{entry?.title ?? 'Untitled'}”</DialogTitle>
        <DialogContent>
          <Stack spacing={4} sx={{ pt: 1 }}>
            <ProblemAlert error={error} />
            <TextField
              label="Publish at"
              type="datetime-local"
              error={!!errors.publishAt}
              helperText={errors.publishAt?.message ?? 'The current draft goes live at this time. Leave empty for no scheduled publish.'}
              slotProps={{ inputLabel: { shrink: true } }}
              {...field('publishAt')}
            />
            <TextField
              label="Unpublish at"
              type="datetime-local"
              error={!!errors.unpublishAt}
              helperText={errors.unpublishAt?.message ?? (entry?.isPublished ? 'Takes the content offline at this time.' : 'Optional. Only applies once the content is live.')}
              slotProps={{ inputLabel: { shrink: true } }}
              {...field('unpublishAt')}
            />
            <Typography variant="caption" color="text.secondary">
              Times are in your timezone ({timezone}).
              {entry?.scheduledPublishAt ? ` Currently scheduled to publish ${fullDateTime(entry.scheduledPublishAt)}.` : ''}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          <Box>
            {hasSchedule && (
              <Button color="error" disabled={isSubmitting} onClick={() => void send({ publishAt: '', unpublishAt: '' })}>
                Clear schedule
              </Button>
            )}
          </Box>
          <Stack direction="row" spacing={2}>
            <Button onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" loading={isSubmitting}>
              Save schedule
            </Button>
          </Stack>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Asks for a short piece of text (a review comment, a revision note) before running an action. */
export function NoteDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  required,
  destructive,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  label: string;
  confirmLabel: string;
  required?: boolean;
  destructive?: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<unknown>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setError(null);
      setTouched(false);
    }
  }, [open]);

  const missing = !!required && !text.trim();
  const submit = async () => {
    setTouched(true);
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" aria-labelledby="note-title">
      <DialogTitle id="note-title">{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
          <ProblemAlert error={error} />
          <TextField
            autoFocus
            multiline
            minRows={3}
            maxRows={8}
            label={label}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={touched && missing}
            helperText={touched && missing ? 'This is required' : undefined}
            slotProps={{ htmlInput: { maxLength: 4000 } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                void submit();
              }
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color={destructive ? 'error' : 'primary'} loading={busy} onClick={() => void submit()}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
