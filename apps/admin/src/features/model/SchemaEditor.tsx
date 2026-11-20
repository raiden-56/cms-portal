import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBlocker, useSearchParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ViewListOutlined from '@mui/icons-material/ViewListOutlined';
import { FIELD_TYPE_META, type FieldDef, type FieldType, buildDefaults } from '@meridian/shared';
import { useConfirm } from '@/components/feedback';
import { IconFor } from '@/components/icons';
import { EmptyState, Mono, Pill } from '@/components/ui';
import { FieldForm, componentIndex } from '@/features/fields/FieldForm';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { FieldChange, SchemaPlan, SchemaResponse } from '@/lib/types';
import { toast } from '@/store';
import { FieldSettings } from './FieldSettings';
import {
  CHOICE_TYPES,
  type DraftField,
  type FieldErrors,
  type OwnerKind,
  blankField,
  firstError,
  fromDefs,
  mapServerErrors,
  signature,
  toDefs,
  toPayload,
  validateDraft,
} from './fieldModel';
import { FieldTypePicker } from './pickers';

/** One-line description of what a field is configured to do, shown under its label. */
function describeField(field: DraftField, schema: SchemaResponse): string {
  const meta = FIELD_TYPE_META[field.type];
  const cfg = field.config;
  if (field.type === 'relation' || field.type === 'relations') {
    const target = schema.types.find((t) => t.apiId === cfg.targetType);
    return `${meta.label} → ${target?.displayName ?? cfg.targetType ?? 'not set'}`;
  }
  if (field.type === 'component' || field.type === 'repeatable') {
    const component = schema.components.find((c) => c.apiId === cfg.component);
    return `${meta.label} · ${component?.displayName ?? cfg.component ?? 'not set'}`;
  }
  if (field.type === 'dynamiczone') {
    const count = cfg.allowedComponents?.length ?? 0;
    return `${meta.label} · ${count ? `${count} component${count === 1 ? '' : 's'} allowed` : 'any component'}`;
  }
  if (CHOICE_TYPES.includes(field.type)) {
    const count = cfg.options?.length ?? 0;
    return `${meta.label} · ${count} option${count === 1 ? '' : 's'}`;
  }
  if (field.type === 'slug' && cfg.sourceField) return `${meta.label} · from ${cfg.sourceField}`;
  return meta.label;
}

function FieldRow({
  field,
  schema,
  errors,
  isTitle,
  canEdit,
  onEdit,
  onRemove,
  onDuplicate,
}: {
  field: DraftField;
  schema: SchemaResponse;
  errors: FieldErrors | undefined;
  isTitle: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.key, disabled: !canEdit });
  const meta = FIELD_TYPE_META[field.type];
  const problem = firstError(errors);
  const cfg = field.config;
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      sx={{
        position: 'relative',
        zIndex: isDragging ? 2 : 'auto',
        display: 'flex',
        alignItems: 'stretch',
        bgcolor: 'background.paper',
        borderBottom: 1,
        borderColor: 'border.subtle',
        boxShadow: isDragging ? '0 10px 28px rgba(17,17,16,0.16)' : 'none',
        borderRadius: isDragging ? '8px' : 0,
        '&:last-of-type': { borderBottom: 0 },
        '&:hover .field-actions, &:focus-within .field-actions': { opacity: 1 },
      }}
    >
      {canEdit && (
        <Tooltip title="Drag to reorder — or focus and press space, then the arrow keys">
          <Box
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${field.label || 'field'}`}
            sx={{ width: 30, display: 'grid', placeItems: 'center', color: 'text.disabled', cursor: isDragging ? 'grabbing' : 'grab', flexShrink: 0, touchAction: 'none', '&:hover': { color: 'text.secondary' }, '&:focus-visible': { outlineOffset: -2 } }}
          >
            <DragIndicatorOutlined sx={{ fontSize: 16 }} />
          </Box>
        </Tooltip>
      )}
      <ButtonBase
        onClick={onEdit}
        aria-label={`${canEdit ? 'Edit' : 'View'} field ${field.label || field.apiId}`}
        sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', textAlign: 'left', gap: 3, py: 2.5, pl: canEdit ? 0.5 : 4, pr: 2, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Box sx={{ width: 30, height: 30, borderRadius: '8px', bgcolor: problem ? 'error.light' : 'surface.sunken', color: problem ? 'error.main' : 'text.secondary', display: 'grid', placeItems: 'center', flexShrink: 0, '& svg': { fontSize: 16 } }}>
          {problem ? <ErrorOutlineOutlined /> : <IconFor name={meta.icon} />}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
              {field.label || 'Untitled field'}
            </Typography>
            <Mono sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{field.apiId || '—'}</Mono>
          </Stack>
          <Typography variant="caption" color={problem ? 'error' : 'text.secondary'} noWrap component="div" role={problem ? 'alert' : undefined}>
            {problem ?? describeField(field, schema)}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: { xs: 120, sm: 360 }, display: { xs: 'none', sm: 'flex' } }}>
          {!field.id && <Pill label="New" fg="success.dark" bg="success.light" />}
          {isTitle && <Pill label="Title" title="Shown as the entry title in lists" />}
          {field.required && <Pill label="Required" />}
          {field.unique && <Pill label="Unique" />}
          {field.localized && <Pill label="Localized" />}
          {(cfg.private || field.type === 'password') && <Pill label="Private" title="Never returned by the delivery API" />}
          {cfg.hidden && <Pill label="Hidden" />}
          {cfg.readOnly && <Pill label="Read-only" />}
          {(cfg.visibleWhen?.field || cfg.requiredWhen?.field) && <Pill label="Conditional" />}
        </Stack>
      </ButtonBase>
      {canEdit && (
        <Stack className="field-actions" direction="row" sx={{ alignItems: 'center', pr: 2, gap: 0.5, opacity: { xs: 1, md: 0 }, transition: 'opacity 120ms' }}>
          <Tooltip title="Duplicate">
            <IconButton size="small" aria-label={`Duplicate ${field.label || 'field'}`} onClick={onDuplicate}>
              <ContentCopyOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove">
            <IconButton size="small" aria-label={`Remove ${field.label || 'field'}`} onClick={onRemove} sx={{ '&:hover': { color: 'error.main' } }}>
              <DeleteOutlineOutlined />
            </IconButton>
          </Tooltip>
        </Stack>
      )}
    </Box>
  );
}

const CHANGE_TONE: Record<FieldChange['kind'], { label: string; fg: string; bg: string }> = {
  added: { label: 'Added', fg: 'success.dark', bg: 'success.light' },
  removed: { label: 'Removed', fg: 'error.dark', bg: 'error.light' },
  renamed: { label: 'Renamed', fg: 'info.dark', bg: 'info.light' },
  type_changed: { label: 'Type changed', fg: 'warning.dark', bg: 'warning.light' },
  updated: { label: 'Settings', fg: 'text.secondary', bg: 'surface.sunken' },
  reordered: { label: 'Order', fg: 'text.secondary', bg: 'surface.sunken' },
};

const typeLabel = (type: string | undefined) => (type && type in FIELD_TYPE_META ? FIELD_TYPE_META[type as FieldType].label : (type ?? ''));

function ChangeLine({ change }: { change: FieldChange }) {
  const tone = CHANGE_TONE[change.kind];
  const affected = change.affectedEntries ?? 0;
  return (
    <Stack direction="row" spacing={3} sx={{ py: 2.5, alignItems: 'flex-start', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <Box sx={{ width: 104, flexShrink: 0, pt: 0.25 }}>
        <Pill label={tone.label} fg={tone.fg} bg={tone.bg} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {change.kind === 'reordered' ? 'Field order changed' : change.label}
        </Typography>
        {change.kind === 'renamed' && (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
            <Mono>{change.from}</Mono>
            <ArrowForwardOutlined sx={{ fontSize: 13 }} />
            <Mono>{change.to}</Mono>
          </Stack>
        )}
        {change.kind === 'type_changed' && (
          <Typography variant="caption" color="text.secondary" component="div">
            {typeLabel(change.from)} → {typeLabel(change.to)}
          </Typography>
        )}
        {(change.note || affected > 0) && (
          <Typography variant="caption" color={change.destructive ? 'error' : 'text.secondary'} component="div">
            {affected > 0 ? `${affected} entr${affected === 1 ? 'y holds' : 'ies hold'} a value. ` : ''}
            {change.note ?? (change.kind === 'renamed' && affected > 0 ? 'Values move to the new identifier.' : '')}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function ReviewDialog({ plan, ownerName, saving, error, onClose, onConfirm }: { plan: SchemaPlan; ownerName: string; saving: boolean; error: string | null; onClose: () => void; onConfirm: () => void }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const destructive = plan.changes.filter((c) => c.destructive);
  return (
    <>
      <DialogTitle id="review-title">Review changes to {ownerName}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {plan.changes.length} change{plan.changes.length === 1 ? '' : 's'} will be applied to the schema and to existing content in one step.
        </Typography>
        <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', px: 3.5, maxHeight: 320, overflowY: 'auto' }}>
          {plan.changes.map((change, index) => (
            <ChangeLine key={`${change.kind}-${change.apiId}-${index}`} change={change} />
          ))}
        </Box>
        {plan.warnings.map((warning) => (
          <Alert key={warning} severity="warning" sx={{ mt: 3 }}>
            {warning}
          </Alert>
        ))}
        {plan.requiresConfirmation && (
          <Alert severity="error" sx={{ mt: 3, alignItems: 'flex-start' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              This discards stored values
            </Typography>
            <Typography variant="body2">
              {destructive.map((c) => c.label).join(', ')} — current content loses these values. Earlier versions of each entry keep them.
            </Typography>
            <FormControlLabel
              sx={{ mt: 1, ml: -2 }}
              control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} color="error" />}
              label={<Typography variant="body2">I understand that these values will be removed from current content</Typography>}
            />
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Keep editing
        </Button>
        <Button variant="contained" color={plan.requiresConfirmation ? 'error' : 'primary'} disabled={plan.requiresConfirmation && !acknowledged} loading={saving} onClick={onConfirm}>
          {plan.requiresConfirmation ? 'Discard values and save' : 'Save schema'}
        </Button>
      </DialogActions>
    </>
  );
}

export interface SchemaEditorTab {
  key: string;
  label: string;
  node: ReactNode;
}

export interface SchemaEditorProps {
  kind: OwnerKind;
  owner: { id: string; apiId: string; displayName: string };
  savedFields: FieldDef[];
  schema: SchemaResponse;
  /** PUT endpoint of the field list, relative to the management API. */
  endpoint: string;
  canManage: boolean;
  /** When set, the schema is fixed and this explains why. */
  lockedReason?: string;
  /** apiId of the field used as the entry title, to mark it in the list. */
  titleField?: string;
  extraTabs?: SchemaEditorTab[];
  /** Called after the schema was stored; should refresh the queries that feed `savedFields`. */
  onSaved: () => Promise<unknown> | void;
}

/**
 * The visual schema builder shared by content types and components: an ordered field list
 * edited locally, a live preview of the resulting form, and a reviewed, migration-aware save.
 */
export function SchemaEditor({ kind, owner, savedFields, schema, endpoint, canManage, lockedReason, titleField, extraTabs = [], onSaved }: SchemaEditorProps) {
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const savedDraft = useMemo(() => fromDefs(savedFields), [savedFields]);
  const savedSignature = useMemo(() => signature(savedDraft), [savedDraft]);
  const [fields, setFields] = useState<DraftField[]>(savedDraft);
  const [editing, setEditing] = useState<{ field: DraftField; isNew: boolean; session: number } | null>(null);
  const sessions = useRef(0);
  const openSettings = (field: DraftField, isNew: boolean) => {
    sessions.current += 1;
    setEditing({ field, isNew, session: sessions.current });
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, FieldErrors>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, FieldErrors>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<SchemaPlan | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewValue, setPreviewValue] = useState<Record<string, unknown>>({});

  const canEdit = canManage && !lockedReason;
  const dirty = canEdit && signature(fields) !== savedSignature;
  const tabs = [{ key: 'fields', label: 'Fields' }, { key: 'preview', label: 'Form preview' }, ...extraTabs];
  const tab = tabs.some((t) => t.key === params.get('tab')) ? (params.get('tab') as string) : 'fields';
  const setTab = (next: string) => {
    const updated = new URLSearchParams(params);
    if (next === 'fields') updated.delete('tab');
    else updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  // Adopt the server's field list whenever it changes (after a save, or someone else's change).
  useEffect(() => {
    setFields(savedDraft);
    setClientErrors({});
    setServerErrors({});
    setGeneral([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSignature]);

  // Leaving with unsaved schema changes asks first — both for in-app navigation and for closing the tab.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname && !(nextLocation.state as { force?: boolean } | null)?.force);
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    void confirm({
      title: 'Leave without saving?',
      message: `Your changes to the fields of ${owner.displayName} have not been saved and will be lost.`,
      confirmLabel: 'Discard changes',
      cancelLabel: 'Stay',
      destructive: true,
    }).then((leave) => {
      asking.current = false;
      if (leave) blocker.proceed?.();
      else blocker.reset?.();
    });
  }, [blocker, confirm, owner.displayName]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setFields((current) => {
      const from = current.findIndex((f) => f.key === active.id);
      const to = current.findIndex((f) => f.key === over.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  };

  const clearErrors = (key: string) => {
    setClientErrors(({ [key]: _removed, ...rest }) => rest);
    setServerErrors(({ [key]: _removed, ...rest }) => rest);
  };

  const applyField = (next: DraftField) => {
    setFields((current) => (current.some((f) => f.key === next.key) ? current.map((f) => (f.key === next.key ? next : f)) : [...current, next]));
    clearErrors(next.key);
    setEditing(null);
  };

  const duplicate = (field: DraftField) => {
    const taken = new Set(fields.map((f) => f.apiId));
    let apiId = `${field.apiId}Copy`;
    for (let i = 2; taken.has(apiId); i += 1) apiId = `${field.apiId}Copy${i}`;
    const copy: DraftField = { ...structuredClone(field), ...blankFieldIdentity(), apiId, label: `${field.label} copy`, unique: false };
    setFields((current) => {
      const index = current.findIndex((f) => f.key === field.key);
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  };

  const handleFailure = (err: unknown, order: string[]) => {
    if (err instanceof ApiError && err.status === 422) {
      const mapped = mapServerErrors(err, order);
      setServerErrors(mapped.byField);
      setGeneral(Object.keys(mapped.byField).length ? mapped.general : mapped.general.length ? mapped.general : [err.message]);
      toast.error(err.message);
      return err.message;
    }
    const message = errorMessage(err);
    toast.error(message);
    return message;
  };

  /** Step one of saving: validate, then ask the API what the change would do to existing content. */
  const startSave = async () => {
    const order = fields.map((f) => f.key);
    const found: Record<string, FieldErrors> = {};
    for (const field of fields) {
      const errors = validateDraft(field, fields, { kind, ownerApiId: owner.apiId, schema });
      if (Object.keys(errors).length) found[field.key] = errors;
    }
    setClientErrors(found);
    if (Object.keys(found).length) {
      setTab('fields');
      toast.error(`${Object.keys(found).length} field${Object.keys(found).length === 1 ? ' needs' : 's need'} attention before saving`);
      return;
    }
    setChecking(true);
    try {
      const result = await api.put<{ plan: SchemaPlan; applied: boolean }>(endpoint, { fields: toPayload(fields), confirmDestructive: false }, { dryRun: 'true' });
      setServerErrors({});
      setGeneral([]);
      if (result.plan.changes.length === 0) {
        toast.info('There is nothing new to save');
        return;
      }
      setSaveError(null);
      setReview(result.plan);
      setReviewOpen(true);
    } catch (err) {
      setTab('fields');
      handleFailure(err, order);
    } finally {
      setChecking(false);
    }
  };

  const confirmSave = async () => {
    if (!review) return;
    const order = fields.map((f) => f.key);
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(endpoint, { fields: toPayload(fields), confirmDestructive: review.requiresConfirmation });
      await onSaved();
      setReviewOpen(false);
      toast.success(`${owner.displayName} schema saved`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details && !Array.isArray(err.details) && err.details.plan) {
        // Content changed between the preview and the save; show the up-to-date impact.
        setReview(err.details.plan as SchemaPlan);
        setSaveError('Content changed since this preview. Review the updated impact and confirm again.');
      } else if (err instanceof ApiError && err.status === 422) {
        setReviewOpen(false);
        setTab('fields');
        handleFailure(err, order);
      } else {
        setSaveError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    const ok = await confirm({ title: 'Discard unsaved changes?', message: 'The field list returns to the last saved schema.', confirmLabel: 'Discard', destructive: true });
    if (!ok) return;
    setFields(savedDraft);
    setClientErrors({});
    setServerErrors({});
    setGeneral([]);
  };

  const errorsFor = (key: string): FieldErrors | undefined => {
    const merged = { ...serverErrors[key], ...clientErrors[key] };
    return Object.keys(merged).length ? merged : undefined;
  };
  const previewDefs = useMemo(() => toDefs(fields), [fields]);
  const components = useMemo(() => componentIndex(schema), [schema]);
  const previewData = useMemo(() => ({ ...buildDefaults(previewDefs), ...previewValue }), [previewDefs, previewValue]);
  const extra = extraTabs.find((t) => t.key === tab);

  return (
    <Box>
      <Stack direction={{ xs: 'column-reverse', md: 'row' }} sx={{ alignItems: { md: 'center' }, borderBottom: 1, borderColor: 'border.subtle', mb: 5, gap: { xs: 2, md: 4 } }}>
        <Tabs value={tab} onChange={(_, next: string) => setTab(next)} variant="scrollable" scrollButtons="auto" sx={{ flex: 1, minWidth: 0, borderBottom: 0 }}>
          {tabs.map((t) => (
            <Tab key={t.key} value={t.key} label={t.label} />
          ))}
        </Tabs>
        {canEdit && (
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', pb: { md: 1 }, flexShrink: 0 }}>
            {dirty && <Pill label="Unsaved changes" fg="warning.dark" bg="warning.light" dot />}
            <Button onClick={() => void discard()} disabled={!dirty || checking}>
              Discard
            </Button>
            <Button variant="contained" onClick={() => void startSave()} disabled={!dirty} loading={checking}>
              Review and save
            </Button>
          </Stack>
        )}
      </Stack>

      {(tab === 'fields' || tab === 'preview') && (
        <>
          {lockedReason && (
            <Alert severity="info" icon={<LockOutlined fontSize="inherit" />} sx={{ mb: 4 }}>
              {lockedReason}
            </Alert>
          )}
          {!lockedReason && !canManage && (
            <Alert severity="info" icon={<LockOutlined fontSize="inherit" />} sx={{ mb: 4 }}>
              You can view this schema. Changing it needs the “Create and change content types and components” permission.
            </Alert>
          )}
          {general.map((message) => (
            <Alert key={message} severity="error" sx={{ mb: 4 }}>
              {message}
            </Alert>
          ))}
        </>
      )}

      {tab === 'fields' && (
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <Stack direction="row" sx={{ px: 4, py: 3, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
            <Typography variant="body2" color="text.secondary">
              {fields.length} field{fields.length === 1 ? '' : 's'}
              {canEdit && fields.length > 1 ? ' · drag to change the order in the form' : ''}
            </Typography>
            {canEdit && (
              <Button size="small" variant="outlined" startIcon={<AddOutlined />} onClick={() => setPickerOpen(true)}>
                Add field
              </Button>
            )}
          </Stack>
          {fields.length === 0 ? (
            <EmptyState
              icon={<ViewListOutlined />}
              title="No fields yet"
              description={
                canEdit
                  ? `Fields describe what ${kind === 'type' ? 'an entry' : 'this component'} holds — a title, an image, a link to other content. Add the first one to start.`
                  : 'This schema has no fields.'
              }
              action={
                canEdit && (
                  <Button variant="contained" startIcon={<AddOutlined />} onClick={() => setPickerOpen(true)}>
                    Add field
                  </Button>
                )
              }
            />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
                <Box role="list" aria-label="Fields">
                  {fields.map((field) => (
                    <Box role="listitem" key={field.key}>
                      <FieldRow
                        field={field}
                        schema={schema}
                        errors={errorsFor(field.key)}
                        isTitle={!!titleField && field.apiId === titleField}
                        canEdit={canEdit}
                        onEdit={() => openSettings(field, false)}
                        onDuplicate={() => duplicate(field)}
                        onRemove={() => {
                          setFields((current) => current.filter((f) => f.key !== field.key));
                          clearErrors(field.key);
                        }}
                      />
                    </Box>
                  ))}
                </Box>
              </SortableContext>
            </DndContext>
          )}
        </Paper>
      )}

      {tab === 'preview' && (
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <Stack direction="row" sx={{ px: 4, py: 3, alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              How editors will see this form{dirty ? ', including your unsaved changes' : ''}. Nothing typed here is stored.
            </Typography>
            <Button size="small" onClick={() => setPreviewValue({})} disabled={Object.keys(previewValue).length === 0}>
              Reset
            </Button>
          </Stack>
          {fields.length === 0 ? (
            <EmptyState compact icon={<ViewListOutlined />} title="Nothing to preview yet" description="Add fields on the Fields tab to see the form take shape." />
          ) : (
            <Box sx={{ p: { xs: 4, md: 6 }, maxWidth: 880 }}>
              <FieldForm fields={previewDefs} value={previewData} onChange={setPreviewValue} components={components} />
            </Box>
          )}
        </Paper>
      )}

      {extra?.node}

      <FieldTypePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(type) => {
          setPickerOpen(false);
          openSettings(blankField(type), true);
        }}
      />
      <FieldSettings
        open={!!editing}
        field={editing?.field ?? null}
        sessionKey={editing?.session ?? 0}
        isNew={editing?.isNew ?? false}
        kind={kind}
        ownerApiId={owner.apiId}
        siblings={fields}
        schema={schema}
        serverErrors={editing ? errorsFor(editing.field.key) : undefined}
        readOnly={!canEdit}
        onApply={applyField}
        onClose={() => setEditing(null)}
      />
      <Dialog open={reviewOpen} onClose={() => !saving && setReviewOpen(false)} maxWidth="sm" aria-labelledby="review-title">
        {review && <ReviewDialog key={JSON.stringify(review.changes)} plan={review} ownerName={owner.displayName} saving={saving} error={saveError} onClose={() => setReviewOpen(false)} onConfirm={() => void confirmSave()} />}
      </Dialog>
    </Box>
  );
}

/** Fresh identity for a copied field: a new local key and no server id. */
function blankFieldIdentity(): Pick<DraftField, 'key' | 'id'> {
  return { key: blankField('text').key, id: undefined };
}
