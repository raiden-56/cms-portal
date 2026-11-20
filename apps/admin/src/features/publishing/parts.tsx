import { type ReactElement, useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { useProject } from '@/app/workspace';
import { FormError, Pill } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type { Release, ReleaseItem } from '@/lib/types';

/** Pieces shared by the release, schedule and version history screens. */

export const NO_RELEASE_ACCESS = 'Your role cannot manage releases';

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const entryCount = (count: number) => plural(count, 'entry', 'entries');

/** Title of an entry that links to its editor. Use with `<Typography component={RouterLink}>`. */
export const titleLinkSx = { display: 'block', fontWeight: 500, color: 'text.primary', '&:hover': { color: 'secondary.main', textDecoration: 'none' } } as const;

/** Explains a disabled control on hover or focus. An empty title shows nothing. */
export function Hint({ title, children }: { title: string; children: ReactElement }) {
  return (
    <Tooltip title={title}>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
  );
}

const RELEASE_STATUS: Record<Release['status'], { label: string; fg: string; bg: string }> = {
  OPEN: { label: 'Open', fg: 'text.secondary', bg: 'surface.sunken' },
  SCHEDULED: { label: 'Scheduled', fg: 'info.dark', bg: 'info.light' },
  PUBLISHED: { label: 'Published', fg: 'success.dark', bg: 'success.light' },
  FAILED: { label: 'Failed', fg: 'error.dark', bg: 'error.light' },
};

export const releaseStatusLabel = (status: Release['status']) => RELEASE_STATUS[status].label;

export function ReleaseStatusPill({ status }: { status: Release['status'] }) {
  const tone = RELEASE_STATUS[status];
  return <Pill label={tone.label} fg={tone.fg} bg={tone.bg} dot />;
}

/** What happens to an entry when its release or schedule runs. */
export function ActionPill({ action }: { action: ReleaseItem['action'] }) {
  return action === 'PUBLISH' ? <Pill label="Publish" fg="success.dark" bg="success.light" /> : <Pill label="Unpublish" fg="warning.dark" bg="warning.light" />;
}

const releaseSchema = z.object({
  name: z.string().trim().min(1, 'Give the release a name').max(120, 'Use 120 characters or fewer'),
  description: z.string().trim().max(1000, 'Use 1,000 characters or fewer'),
});
type ReleaseValues = z.infer<typeof releaseSchema>;

/** Creates a release, or edits the name and description of an existing one. */
export function ReleaseFormDialog({ open, release, onClose, onSaved }: { open: boolean; release?: Release | null; onClose: () => void; onSaved: (release: Release) => void }) {
  const { envBase } = useProject();
  const [error, setError] = useState<unknown>(null);
  const form = useForm<ReleaseValues>({ resolver: zodResolver(releaseSchema), defaultValues: { name: '', description: '' } });
  const { errors, isSubmitting } = form.formState;
  // MUI forwards `ref` to the wrapper element; react-hook-form needs the <input> itself to apply reset values.
  const field = (name: keyof ReleaseValues) => {
    const { ref, ...rest } = form.register(name);
    return { ...rest, inputRef: ref };
  };

  const initialName = release?.name ?? '';
  const initialDescription = release?.description ?? '';
  useEffect(() => {
    if (!open) return;
    setError(null);
    form.reset({ name: initialName, description: initialDescription });
  }, [open, initialName, initialDescription, form]);

  const submit = async (values: ReleaseValues) => {
    setError(null);
    try {
      const saved = release ? await api.patch<Release>(`${envBase}/releases/${release.id}`, values) : await api.post<Release>(`${envBase}/releases`, values);
      onSaved(saved);
      onClose();
    } catch (err) {
      const problems = err instanceof ApiError ? err.fieldErrors : {};
      let placed = false;
      for (const name of ['name', 'description'] as const) {
        if (problems[name]) {
          form.setError(name, { message: problems[name] });
          placed = true;
        }
      }
      if (!placed) setError(err);
    }
  };

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} maxWidth="xs" aria-labelledby="release-form-title">
      <form noValidate onSubmit={form.handleSubmit(submit)}>
        <DialogTitle id="release-form-title">{release ? 'Edit release details' : 'New release'}</DialogTitle>
        <DialogContent>
          <Stack spacing={4} sx={{ pt: 1 }}>
            <FormError error={error} />
            <TextField
              label="Name"
              autoFocus
              required
              error={!!errors.name}
              helperText={errors.name?.message ?? 'For example “Spring launch” or “Pricing update”.'}
              slotProps={{ htmlInput: { maxLength: 120 } }}
              {...field('name')}
            />
            <TextField
              label="Description"
              multiline
              minRows={3}
              maxRows={8}
              error={!!errors.description}
              helperText={errors.description?.message ?? 'Optional. What this release changes and why.'}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
              {...field('description')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={isSubmitting}>
            {release ? 'Save changes' : 'Create release'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
