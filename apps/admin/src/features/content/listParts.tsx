import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import BookmarkBorderOutlined from '@mui/icons-material/BookmarkBorderOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import FilterListOutlined from '@mui/icons-material/FilterListOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined';
import { FIELD_TYPE_META, type EntryStatus, type FieldDef } from '@meridian/shared';
import { useProject } from '@/app/workspace';
import { IconFor } from '@/components/icons';
import { FormError } from '@/components/ui';
import { api } from '@/lib/api';
import type { ContentType } from '@/lib/types';
import { FONT_MONO } from '@/theme/theme';
import { type FilterOp, type ListFilter, operatorsFor } from './cells';

// ─── Filter builder ──────────────────────────────────────────────────────────

/** Popover that composes one field filter: field → operator → value. */
export function FilterBuilder({ fields, onAdd, disabled }: { fields: FieldDef[]; onAdd: (filter: ListFilter) => void; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [fieldId, setFieldId] = useState('');
  const [op, setOp] = useState<FilterOp>('eq');
  const [value, setValue] = useState('');
  const field = fields.find((f) => f.apiId === fieldId);
  const operators = useMemo(() => (field ? operatorsFor(field) : []), [field]);
  const scalar = field ? FIELD_TYPE_META[field.type].scalar : 'string';

  const pickField = (id: string) => {
    const next = fields.find((f) => f.apiId === id);
    setFieldId(id);
    setOp(next ? operatorsFor(next)[0].value : 'eq');
    setValue('');
  };
  const open = (el: HTMLElement) => {
    setAnchor(el);
    if (!fieldId && fields[0]) pickField(fields[0].apiId);
  };
  const ready = !!field && (op === 'null' ? value !== '' : value.trim() !== '');
  const apply = () => {
    if (!field || !ready) return;
    const sent = field.type === 'datetime' && op !== 'null' ? new Date(value).toISOString() : value.trim();
    onAdd({ field: field.apiId, op, value: sent });
    setValue('');
    setAnchor(null);
  };

  const valueInput = () => {
    if (!field) return null;
    if (op === 'null') {
      return (
        <TextField select label="Condition" value={value} onChange={(e) => setValue(e.target.value)}>
          <MenuItem value="true">Is empty</MenuItem>
          <MenuItem value="false">Is not empty</MenuItem>
        </TextField>
      );
    }
    if (field.config.options?.length) {
      return (
        <TextField select label="Value" value={value} onChange={(e) => setValue(e.target.value)}>
          {field.config.options.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      );
    }
    if (scalar === 'boolean') {
      return (
        <TextField select label="Value" value={value} onChange={(e) => setValue(e.target.value)}>
          <MenuItem value="true">Yes</MenuItem>
          <MenuItem value="false">No</MenuItem>
        </TextField>
      );
    }
    const type = scalar === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
    return (
      <TextField
        label="Value"
        type={type}
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
        slotProps={{ inputLabel: type === 'date' || type === 'datetime-local' ? { shrink: true } : undefined, htmlInput: { step: scalar === 'number' ? 'any' : undefined } }}
      />
    );
  };

  return (
    <>
      <Tooltip title={fields.length === 0 ? 'This content type has no filterable fields' : ''}>
        <span>
          <Button variant="outlined" startIcon={<FilterListOutlined />} onClick={(e) => open(e.currentTarget)} disabled={disabled || fields.length === 0} aria-haspopup="dialog">
            Filter
          </Button>
        </span>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { mt: 1, p: 4, width: 320, borderRadius: '10px' } } }}>
        <Typography variant="h5" component="h2" sx={{ mb: 3 }}>
          Add a filter
        </Typography>
        <Stack spacing={3}>
          <TextField select label="Field" value={fieldId} onChange={(e) => pickField(e.target.value)}>
            {fields.map((f) => (
              <MenuItem key={f.apiId} value={f.apiId}>
                <IconFor name={FIELD_TYPE_META[f.type].icon} sx={{ fontSize: 15, color: 'text.secondary' }} />
                {f.label}
              </MenuItem>
            ))}
          </TextField>
          {operators.length > 1 && (
            <TextField
              select
              label="Operator"
              value={op}
              onChange={(e) => {
                setOp(e.target.value as FilterOp);
                setValue('');
              }}
            >
              {operators.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          {valueInput()}
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setAnchor(null)}>Cancel</Button>
            <Button variant="contained" disabled={!ready} onClick={apply}>
              Apply filter
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}

// ─── Columns ─────────────────────────────────────────────────────────────────

export interface ColumnOption {
  id: string;
  label: string;
  group: 'Fields' | 'System';
}

export function ColumnsMenu({ options, visible, onChange, onReset }: { options: ColumnOption[]; visible: string[]; onChange: (ids: string[]) => void; onReset: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toggle = (id: string) => {
    // Keep the order in which columns are defined, not the order they were ticked.
    const next = new Set(visible.includes(id) ? visible.filter((v) => v !== id) : [...visible, id]);
    onChange(options.filter((o) => next.has(o.id)).map((o) => o.id));
  };
  return (
    <>
      <Tooltip title="Choose columns">
        <IconButton aria-label="Choose columns" aria-haspopup="dialog" onClick={(e) => setAnchor(e.currentTarget)}>
          <ViewColumnOutlined />
        </IconButton>
      </Tooltip>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { mt: 1, width: 260, maxHeight: 440, borderRadius: '10px', display: 'flex', flexDirection: 'column' } } }}>
        <Stack direction="row" sx={{ px: 3.5, py: 2.5, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle' }}>
          <Typography variant="h5" component="h2">
            Columns
          </Typography>
          <Button size="small" onClick={onReset}>
            Reset
          </Button>
        </Stack>
        <Box sx={{ overflowY: 'auto', py: 1.5 }}>
          {(['Fields', 'System'] as const).map((group) => {
            const items = options.filter((o) => o.group === group);
            if (items.length === 0) return null;
            return (
              <Box key={group} role="group" aria-label={group}>
                <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 3.5, pt: 1.5, pb: 0.5 }}>
                  {group}
                </Typography>
                {items.map((option) => (
                  <FormControlLabel
                    key={option.id}
                    sx={{ display: 'flex', mx: 0, px: 2, py: 0.25, '&:hover': { bgcolor: 'action.hover' } }}
                    control={<Checkbox checked={visible.includes(option.id)} onChange={() => toggle(option.id)} />}
                    label={<Typography variant="body2">{option.label}</Typography>}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      </Popover>
    </>
  );
}

// ─── Saved views ─────────────────────────────────────────────────────────────

export interface ViewParams {
  q: string;
  statuses: EntryStatus[];
  locale: string;
  sort: string;
  filters: ListFilter[];
}

export interface SavedView {
  id: string;
  name: string;
  params: ViewParams;
}

export function SavedViewsMenu({ views, current, canSave, onApply, onSave, onDelete }: { views: SavedView[]; current: ViewParams; canSave: boolean; onApply: (view: SavedView) => void; onSave: (name: string) => void; onDelete: (id: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const currentKey = JSON.stringify(current);
  const clash = views.some((v) => v.name.toLowerCase() === name.trim().toLowerCase());

  const save = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setNaming(false);
    setName('');
  };

  return (
    <>
      <Button variant="outlined" startIcon={<BookmarkBorderOutlined />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">
        Views{views.length ? ` (${views.length})` : ''}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 280 } } }}>
        {views.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 2 }}>
            Save the current search, filters and sorting as a view to return to it in one click.
          </Typography>
        )}
        {views.map((view) => (
          <MenuItem
            key={view.id}
            selected={JSON.stringify(view.params) === currentKey}
            onClick={() => {
              onApply(view);
              setAnchor(null);
            }}
          >
            <ListItemText primary={view.name} slotProps={{ primary: { variant: 'body2', noWrap: true } }} />
            <IconButton
              size="small"
              edge="end"
              aria-label={`Delete view ${view.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(view.id);
              }}
            >
              <DeleteOutlineOutlined sx={{ fontSize: '16px !important' }} />
            </IconButton>
          </MenuItem>
        ))}
        <Divider sx={{ my: 1 }} />
        <MenuItem
          disabled={!canSave}
          onClick={() => {
            setAnchor(null);
            setNaming(true);
          }}
        >
          <AddOutlined sx={{ fontSize: 16 }} />
          Save current view…
        </MenuItem>
      </Menu>
      <Dialog open={naming} onClose={() => setNaming(false)} maxWidth="xs" aria-labelledby="save-view-title">
        <DialogTitle id="save-view-title">Save view</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            sx={{ mt: 1 }}
            label="Name"
            placeholder="e.g. Drafts awaiting images"
            value={name}
            onChange={(e) => setName(e.target.value)}
            helperText={clash ? 'A view with this name exists and will be replaced' : 'Saves the current search, status, filters and sorting.'}
            slotProps={{ htmlInput: { maxLength: 60 } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNaming(false)}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim()} onClick={save}>
            Save view
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── Import ──────────────────────────────────────────────────────────────────

interface ImportItem {
  data: Record<string, unknown>;
  locale?: string;
}

interface ImportResult {
  results: { index: number; ok: boolean; id?: string; error?: string; details?: { path?: string; message: string }[] }[];
  imported: number;
  failed: number;
}

/** Accepts `{ items: [{ data, locale? }] }`, a Meridian export file, or a bare array of data objects. */
function parseImport(text: string): { items: ImportItem[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `This is not valid JSON — ${(err as Error).message}` };
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown })?.items;
  if (!Array.isArray(list)) return { error: 'Expected an object with an "items" array, or an array of entries.' };
  if (list.length === 0) return { error: 'The file contains no entries.' };
  if (list.length > 500) return { error: `The file contains ${list.length} entries. Import at most 500 at a time.` };
  const items: ImportItem[] = [];
  for (const [i, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `Entry ${i + 1} is not an object.` };
    const row = raw as { data?: unknown; locale?: unknown };
    const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : (raw as Record<string, unknown>);
    items.push({ data, ...(typeof row.locale === 'string' && row.data ? { locale: row.locale } : {}) });
  }
  return { items };
}

export function ImportDialog({ type, open, onClose, onImported }: { type: ContentType; open: boolean; onClose: () => void; onImported: () => void }) {
  const { envBase } = useProject();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseImport(text) : null), [text]);
  const items = parsed && 'items' in parsed ? parsed.items : null;

  const run = useMutation({
    mutationFn: (rows: ImportItem[]) =>
      api.post<ImportResult>(`${envBase}/entries/${type.apiId}/import`, {
        // A locale only means something on localized types; everything else is created in the default locale.
        items: rows.map((r) => ({ data: r.data, ...(r.locale && type.options.localized ? { locale: r.locale } : {}) })),
      }),
    onSuccess: (result) => {
      if (result.imported > 0) onImported();
    },
  });

  useEffect(() => {
    if (open) {
      setText('');
      setFileName('');
      run.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const readFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setFileName('');
      setText('');
      return;
    }
    setFileName(file.name);
    void file.text().then(setText);
  };
  const result = run.data;
  const failures = result?.results.filter((r) => !r.ok) ?? [];

  return (
    <Dialog open={open} onClose={run.isPending ? undefined : onClose} maxWidth="sm" aria-labelledby="import-title">
      <DialogTitle id="import-title">Import {type.pluralName.toLowerCase()}</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={3} sx={{ pt: 1 }}>
            <Alert severity={result.failed === 0 ? 'success' : result.imported === 0 ? 'error' : 'warning'}>
              {result.imported} imported as drafts{result.failed ? `, ${result.failed} skipped` : ''}.
            </Alert>
            {failures.length > 0 && (
              <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', maxHeight: 280, overflowY: 'auto' }} tabIndex={0}>
                {failures.map((f) => (
                  <Box key={f.index} sx={{ px: 3.5, py: 2.5, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
                    <Typography variant="subtitle2">
                      Entry {f.index + 1}: {f.error}
                    </Typography>
                    {Array.isArray(f.details) &&
                      f.details.slice(0, 5).map((d, i) => (
                        <Typography key={i} variant="body2" color="text.secondary">
                          {d.path ? `${d.path} — ` : ''}
                          {d.message}
                        </Typography>
                      ))}
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        ) : (
          <Stack spacing={3} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Upload a JSON export from Meridian, or paste <code>{'{ "items": [{ "data": { … } }] }'}</code>. Every entry is validated against the{' '}
              {type.displayName} model and created as a draft. Up to 500 entries at a time.
            </Typography>
            <FormError error={run.error} />
            <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center' }}>
              <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
              <Button variant="outlined" startIcon={<UploadFileOutlined />} onClick={() => input.current?.click()}>
                Choose a JSON file
              </Button>
              {fileName && (
                <Typography variant="body2" color="text.secondary" noWrap>
                  {fileName}
                </Typography>
              )}
            </Stack>
            <TextField
              multiline
              minRows={8}
              maxRows={14}
              label="JSON"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName('');
              }}
              placeholder={'{\n  "items": [\n    { "data": { "title": "Hello" } }\n  ]\n}'}
              error={!!parsed && 'error' in parsed}
              helperText={parsed && 'error' in parsed ? parsed.error : items ? `${items.length} entr${items.length === 1 ? 'y' : 'ies'} ready to import` : undefined}
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: FONT_MONO, fontSize: 12.5, lineHeight: 1.6 } } }}
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={run.isPending}>
              Cancel
            </Button>
            <Button variant="contained" disabled={!items} loading={run.isPending} onClick={() => items && run.mutate(items)}>
              Import{items ? ` ${items.length}` : ''}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

// ─── Bulk results ────────────────────────────────────────────────────────────

export interface BulkOutcome {
  action: string;
  failures: { title: string; error: string }[];
  succeeded: number;
}

export function BulkOutcomeDialog({ outcome, onClose }: { outcome: BulkOutcome | null; onClose: () => void }) {
  return (
    <Dialog open={!!outcome} onClose={onClose} maxWidth="sm" aria-labelledby="bulk-outcome-title">
      <DialogTitle id="bulk-outcome-title">
        {outcome?.failures.length} {outcome?.failures.length === 1 ? 'entry' : 'entries'} could not be {outcome?.action}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {outcome?.succeeded ? `${outcome.succeeded} succeeded. ` : ''}The following were left unchanged:
        </Typography>
        <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', maxHeight: 320, overflowY: 'auto' }} tabIndex={0}>
          {outcome?.failures.map((f, i) => (
            <Box key={i} sx={{ px: 3.5, py: 2.5, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
              <Typography variant="subtitle2">{f.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {f.error}
              </Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
