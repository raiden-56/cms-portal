import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import { EVENT_DESCRIPTIONS, EVENT_TYPES, type EventType } from '@meridian/shared';
import { useProject } from '@/app/workspace';
import { FormError } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import type { Webhook } from '@/lib/types';
import { toast } from '@/store';
import { FONT_MONO } from '@/theme/theme';
import { CDN_PURGE_RECEIVER, NEXT_REVALIDATE_ROUTE, NODE_VERIFY } from './snippets';
import type { SnippetItem } from './shared';

export interface WebhookPreset {
  id: 'nextjs' | 'cdn';
  title: string;
  summary: string;
  name: string;
  urlPlaceholder: string;
  events: string[];
  receiver: SnippetItem[];
}

export const WEBHOOK_PRESETS: WebhookPreset[] = [
  {
    id: 'nextjs',
    title: 'Next.js on-demand revalidation',
    summary: 'Refresh cached pages and tagged fetches the moment content is published, without rebuilding the site.',
    name: 'Next.js revalidation',
    urlPlaceholder: 'https://www.example.com/api/revalidate',
    events: ['content.published', 'content.unpublished', 'page.published', 'page.unpublished', 'release.published'],
    receiver: [{ label: 'Route handler', caption: 'app/api/revalidate/route.ts', language: 'typescript', code: NEXT_REVALIDATE_ROUTE }],
  },
  {
    id: 'cdn',
    title: 'Generic CDN purge',
    summary: 'Purge the affected URLs from your CDN when content, pages or media change. The example targets Cloudflare; any purge API works.',
    name: 'CDN purge',
    urlPlaceholder: 'https://hooks.example.com/hooks/meridian',
    events: ['content.published', 'content.unpublished', 'content.deleted', 'page.published', 'page.unpublished', 'media.updated', 'media.deleted', 'release.published'],
    receiver: [
      { label: 'Receiver', caption: 'server.js', language: 'javascript', code: CDN_PURGE_RECEIVER },
      { label: 'Signature check', caption: 'verify-meridian-webhook.js', language: 'javascript', code: NODE_VERIFY },
    ],
  },
];

const EVENT_GROUPS: { label: string; events: EventType[] }[] = [
  { label: 'Content', events: EVENT_TYPES.filter((e) => e.startsWith('content.')) },
  { label: 'Pages', events: EVENT_TYPES.filter((e) => e.startsWith('page.')) },
  { label: 'Media', events: EVENT_TYPES.filter((e) => e.startsWith('media.')) },
  { label: 'Model and releases', events: EVENT_TYPES.filter((e) => e.startsWith('schema.') || e.startsWith('release.')) },
];

const MANAGED_HEADERS = ['host', 'content-length', 'content-type', 'user-agent', 'connection', 'transfer-encoding'];

const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the webhook').max(80, 'Keep the name under 80 characters'),
    url: z.string().trim().min(1, 'Enter the endpoint URL').max(1000).url('Enter a full URL, including https://'),
    events: z.array(z.string()).min(1, 'Choose at least one event'),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).max(20, 'At most 20 custom headers'),
    isActive: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.headers.forEach((header, index) => {
      const name = header.name.trim();
      if (!name && !header.value.trim()) return;
      const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['headers', index, 'name'], message });
      if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) issue('Use letters, numbers and hyphens');
      else if (MANAGED_HEADERS.includes(name.toLowerCase()) || name.toLowerCase().startsWith('x-meridian-')) issue('This header is set by Meridian');
      else if (seen.has(name.toLowerCase())) issue('This header is listed twice');
      seen.add(name.toLowerCase());
      if (header.value.length > 1000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['headers', index, 'value'], message: 'Keep the value under 1000 characters' });
    });
  });
type FormValues = z.infer<typeof formSchema>;

const emptyValues = (preset?: WebhookPreset): FormValues => ({ name: preset?.name ?? '', url: '', events: preset?.events ?? [], headers: [], isActive: true });

/** Create or edit a webhook. `onCreated` receives the signing secret, which the API returns exactly once. */
export function WebhookFormDialog({
  open,
  webhook,
  preset,
  onClose,
  onCreated,
}: {
  open: boolean;
  webhook?: Webhook | null;
  preset?: WebhookPreset;
  onClose: () => void;
  onCreated?: (webhook: Webhook, secret: string) => void;
}) {
  const ws = useProject();
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: emptyValues(preset) });
  const headers = useFieldArray({ control: form.control, name: 'headers' });
  const { errors } = form.formState;
  const events = form.watch('events');
  const all = events.includes('*');

  // Load the right values each time the dialog opens: the webhook being edited, a preset, or a blank form.
  useEffect(() => {
    if (!open) return;
    form.reset(
      webhook
        ? { name: webhook.name, url: webhook.url, events: webhook.events, isActive: webhook.isActive, headers: Object.entries(webhook.headers ?? {}).map(([name, value]) => ({ name, value })) }
        : emptyValues(preset),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, webhook?.id, preset?.id]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        name: values.name,
        url: values.url,
        events: values.events.includes('*') ? ['*'] : values.events,
        isActive: values.isActive,
        headers: Object.fromEntries(values.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value])),
      };
      return webhook ? api.patch<Webhook>(`${ws.envBase}/webhooks/${webhook.id}`, body) : api.post<Webhook>(`${ws.envBase}/webhooks`, body);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['webhooks', ws.environment.id] });
      if (!webhook && saved.secret) onCreated?.(saved, saved.secret);
      else toast.success('Webhook updated');
      onClose();
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      for (const [path, message] of Object.entries(err.fieldErrors)) {
        const field = path.split('.')[0];
        if (field === 'name' || field === 'url' || field === 'events') form.setError(field, { message });
      }
    },
  });

  const toggleEvent = (event: string, checked: boolean) => {
    const next = checked ? [...events.filter((e) => e !== '*'), event] : events.filter((e) => e !== event);
    form.setValue('events', next, { shouldValidate: form.formState.isSubmitted, shouldDirty: true });
  };

  return (
    <Dialog open={open} onClose={() => !save.isPending && onClose()} maxWidth="sm" aria-labelledby="webhook-form-title" slotProps={{ transition: { onExited: () => save.reset() } }}>
      <form noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
        <DialogTitle id="webhook-form-title">{webhook ? 'Edit webhook' : preset ? preset.title : 'Create webhook'}</DialogTitle>
        <DialogContent>
          <FormError error={save.error instanceof ApiError && Object.keys(save.error.fieldErrors).length ? null : save.error} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <TextField label="Name" autoFocus error={!!errors.name} helperText={errors.name?.message} {...form.register('name')} />
            <TextField
              label="Endpoint URL"
              type="url"
              placeholder={preset?.urlPlaceholder ?? 'https://www.example.com/api/webhooks/meridian'}
              error={!!errors.url}
              helperText={errors.url?.message ?? 'Must be a public https:// address. Private-network and non-https URLs are only accepted in local development.'}
              slotProps={{ htmlInput: { spellCheck: false } }}
              {...form.register('url')}
            />

            <Box>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2" id="webhook-events-label">
                  Events
                </Typography>
                <FormControlLabel
                  sx={{ mr: 0 }}
                  control={<Checkbox checked={all} onChange={(e) => form.setValue('events', e.target.checked ? ['*'] : [], { shouldValidate: form.formState.isSubmitted, shouldDirty: true })} />}
                  label={<Typography variant="body2">All events</Typography>}
                />
              </Stack>
              {errors.events && (
                <Typography variant="caption" color="error" role="alert" component="div" sx={{ mb: 1 }}>
                  {errors.events.message}
                </Typography>
              )}
              <Box role="group" aria-labelledby="webhook-events-label" sx={{ border: 1, borderColor: errors.events ? 'error.main' : 'border.subtle', borderRadius: '8px', px: 3, py: 1.5, opacity: all ? 0.55 : 1 }}>
                {EVENT_GROUPS.map((group) => (
                  <Box key={group.label} sx={{ py: 1.5, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
                    <Typography variant="overline" color="text.disabled" component="div">
                      {group.label}
                    </Typography>
                    {group.events.map((event) => (
                      <FormControlLabel
                        key={event}
                        sx={{ display: 'flex', ml: -1.5, mr: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { pt: 1.25 } }}
                        control={<Checkbox disabled={all} checked={all || events.includes(event)} onChange={(e) => toggleEvent(event, e.target.checked)} />}
                        label={
                          <Box>
                            <Typography variant="body2" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem' }}>
                              {event}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {EVENT_DESCRIPTIONS[event]}
                            </Typography>
                          </Box>
                        }
                      />
                    ))}
                  </Box>
                ))}
              </Box>
            </Box>

            <Box>
              <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box>
                  <Typography variant="subtitle2">Custom headers</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Sent with every delivery, for example an authorization header your endpoint expects.
                  </Typography>
                </Box>
                <Button size="small" startIcon={<AddOutlined />} onClick={() => headers.append({ name: '', value: '' })} disabled={headers.fields.length >= 20}>
                  Add header
                </Button>
              </Stack>
              <Stack spacing={2}>
                {headers.fields.map((field, index) => (
                  <Stack key={field.id} direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                    <TextField
                      placeholder="X-Custom-Header"
                      error={!!errors.headers?.[index]?.name}
                      helperText={errors.headers?.[index]?.name?.message}
                      slotProps={{ htmlInput: { 'aria-label': `Header ${index + 1} name`, spellCheck: false } }}
                      {...form.register(`headers.${index}.name`)}
                    />
                    <TextField
                      placeholder="Value"
                      error={!!errors.headers?.[index]?.value}
                      helperText={errors.headers?.[index]?.value?.message}
                      slotProps={{ htmlInput: { 'aria-label': `Header ${index + 1} value`, spellCheck: false } }}
                      {...form.register(`headers.${index}.value`)}
                    />
                    <IconButton aria-label={`Remove header ${index + 1}`} onClick={() => headers.remove(index)} sx={{ mt: 0.5 }}>
                      <DeleteOutlineOutlined />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            </Box>

            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormControlLabel
                  sx={{ ml: 0 }}
                  control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                  label={<Typography variant="body2">{field.value ? 'Active — events are delivered' : 'Paused — no events are sent'}</Typography>}
                />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={save.isPending}>
            {webhook ? 'Save changes' : 'Create webhook'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
