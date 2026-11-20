import { type ReactNode, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import KeyboardArrowDownOutlined from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlined from '@mui/icons-material/KeyboardArrowUpOutlined';
import {
  FIELD_CATEGORY_LABELS,
  FIELD_TYPES,
  FIELD_TYPE_META,
  type FieldCategory,
  type FieldCondition,
  type FieldConfig,
  type FieldDef,
  type FieldOption,
  type FieldType,
  isCompatibleTypeChange,
  slugify,
  toFieldApiId,
} from '@meridian/shared';
import { IconFor } from '@/components/icons';
import { Mono } from '@/components/ui';
import { FieldForm, componentIndex } from '@/features/fields/FieldForm';
import type { SchemaResponse } from '@/lib/types';
import {
  CHOICE_TYPES,
  CODE_LANGUAGES,
  CONDITION_OPERATORS,
  type DraftField,
  type FieldErrors,
  type OwnerKind,
  STRUCTURE_TYPES,
  WIDTH_OPTIONS,
  configKeysFor,
  errorAt,
  validateDraft,
} from './fieldModel';

type TabKey = 'basics' | 'structure' | 'validation' | 'display' | 'conditions';

const TAB_PROPS: Record<TabKey, string[]> = {
  basics: ['label', 'apiId', 'type', 'unique', 'required', 'localized', 'id', '_', 'config.helpText', 'config.placeholder'],
  structure: ['config.targetType', 'config.component', 'config.allowedComponents', 'config.sourceField', 'config.language'],
  validation: ['config.minLength', 'config.maxLength', 'config.pattern', 'config.patternMessage', 'config.requiredMessage', 'config.min', 'config.max', 'config.step', 'config.options', 'config.minItems', 'config.maxItems', 'config.allowedExtensions', 'config.maxFileSize', 'config.minWidth', 'config.minHeight', 'config.maxWidth', 'config.maxHeight', 'config.maxRating'],
  display: ['config.width', 'config.group', 'config.tab', 'config.readOnly', 'config.hidden', 'config.private', 'config.defaultValue', 'config.searchable', 'config.sortable', 'config.filterable'],
  conditions: ['config.visibleWhen', 'config.requiredWhen'],
};

const tabOf = (prop: string): TabKey => (Object.keys(TAB_PROPS) as TabKey[]).find((tab) => TAB_PROPS[tab].some((p) => prop === p || prop.startsWith(`${p}.`))) ?? 'basics';

const CATEGORY_ORDER: FieldCategory[] = ['text', 'number', 'choice', 'date', 'media', 'relation', 'structure', 'special'];
const COMMON_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'svg', 'mp4', 'webm', 'mov', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip'];

function NumberInput({
  label,
  value,
  onChange,
  error,
  helperText,
  disabled,
  integer = true,
  min,
  suffix,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  integer?: boolean;
  min?: number;
  suffix?: string;
}) {
  return (
    <TextField
      label={label}
      type="number"
      disabled={disabled}
      value={value ?? ''}
      error={!!error}
      helperText={error ?? helperText}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(undefined);
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(integer ? Math.trunc(n) : n);
      }}
      slotProps={{
        htmlInput: { min, step: integer ? 1 : 'any', inputMode: integer ? 'numeric' : 'decimal' },
        input: suffix ? { endAdornment: <InputAdornment position="end">{suffix}</InputAdornment> } : undefined,
      }}
    />
  );
}

function ToggleRow({ label, description, checked, onChange, disabled }: { label: string; description?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = `toggle-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Stack direction="row" spacing={3} sx={{ alignItems: 'center', justifyContent: 'space-between', py: 2.5, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" component="label" htmlFor={id} sx={{ fontWeight: 500, display: 'block' }}>
          {label}
        </Typography>
        {description && (
          <Typography variant="caption" color="text.secondary" component="div">
            {description}
          </Typography>
        )}
      </Box>
      <Switch id={id} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </Stack>
  );
}

function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" color="text.disabled" component="h3" sx={{ mt: 2 }}>
      {children}
    </Typography>
  );
}

function OptionsEditor({ options, onChange, error, disabled }: { options: FieldOption[]; onChange: (options: FieldOption[]) => void; error?: string; disabled?: boolean }) {
  const update = (index: number, patch: Partial<FieldOption>) => onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const move = (index: number, delta: number) => {
    const next = [...options];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <Box>
      <Stack spacing={2}>
        {options.map((option, index) => (
          <Stack key={index} direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <TextField
              placeholder="Label"
              value={option.label}
              disabled={disabled}
              onChange={(e) => {
                const label = e.target.value;
                // The stored value follows the label until someone edits it by hand.
                const follows = !option.value || option.value === slugify(option.label, 60);
                update(index, { label, ...(follows ? { value: slugify(label, 60) } : {}) });
              }}
              slotProps={{ htmlInput: { 'aria-label': `Option ${index + 1} label`, maxLength: 120 } }}
            />
            <TextField
              placeholder="value"
              value={option.value}
              disabled={disabled}
              onChange={(e) => update(index, { value: e.target.value })}
              slotProps={{ htmlInput: { 'aria-label': `Option ${index + 1} value`, maxLength: 120, spellCheck: false }, input: { sx: { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.75rem' } } }}
            />
            <IconButton size="small" aria-label={`Move option ${index + 1} up`} disabled={disabled || index === 0} onClick={() => move(index, -1)}>
              <KeyboardArrowUpOutlined />
            </IconButton>
            <IconButton size="small" aria-label={`Move option ${index + 1} down`} disabled={disabled || index === options.length - 1} onClick={() => move(index, 1)}>
              <KeyboardArrowDownOutlined />
            </IconButton>
            <IconButton size="small" aria-label={`Remove option ${index + 1}`} disabled={disabled} onClick={() => onChange(options.filter((_, i) => i !== index))} sx={{ '&:hover': { color: 'error.main' } }}>
              <DeleteOutlineOutlined />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      {options.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          No options yet. Editors choose from the options you add here.
        </Typography>
      )}
      {error && (
        <Typography variant="caption" color="error" role="alert" component="div" sx={{ mt: 1.5 }}>
          {error}
        </Typography>
      )}
      <Button size="small" variant="outlined" startIcon={<AddOutlined />} disabled={disabled} onClick={() => onChange([...options, { label: '', value: '' }])} sx={{ mt: 2.5 }}>
        Add option
      </Button>
    </Box>
  );
}

function ConditionEditor({
  title,
  description,
  value,
  onChange,
  fields,
  error,
  disabled,
}: {
  title: string;
  description: string;
  value: FieldCondition | undefined;
  onChange: (value: FieldCondition | undefined) => void;
  fields: DraftField[];
  error?: string;
  disabled?: boolean;
}) {
  const enabled = !!value;
  const source = fields.find((f) => f.apiId === value?.field);
  const operator = CONDITION_OPERATORS.find((o) => o.value === value?.operator) ?? CONDITION_OPERATORS[0];
  const choices: FieldOption[] | null =
    source && (source.type === 'boolean' || source.type === 'checkbox')
      ? [
          { label: 'Yes', value: 'true' },
          { label: 'No', value: 'false' },
        ]
      : source && CHOICE_TYPES.includes(source.type)
        ? (source.config.options ?? [])
        : null;
  const usable = fields.filter((f) => f.apiId);

  return (
    <Box sx={{ border: 1, borderColor: error ? 'error.main' : 'border.subtle', borderRadius: '8px', p: 3.5 }}>
      <ToggleRow
        label={title}
        description={description}
        checked={enabled}
        disabled={disabled || (!enabled && usable.length === 0)}
        onChange={(on) => onChange(on ? { field: usable[0]?.apiId ?? '', operator: 'notEmpty' } : undefined)}
      />
      {!enabled && usable.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          Add another field first — conditions depend on the value of a different field.
        </Typography>
      )}
      {value && (
        <Stack spacing={2.5} sx={{ mt: 3 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="When this field" value={value.field} disabled={disabled} onChange={(e) => onChange({ ...value, field: e.target.value, value: undefined })}>
              {usable.map((f) => (
                <MenuItem key={f.key} value={f.apiId}>
                  {f.label || f.apiId}
                </MenuItem>
              ))}
              {!source && value.field && <MenuItem value={value.field}>{value.field} (missing)</MenuItem>}
            </TextField>
            <TextField
              select
              label="Condition"
              value={operator.value}
              disabled={disabled}
              onChange={(e) => {
                const next = CONDITION_OPERATORS.find((o) => o.value === e.target.value) ?? CONDITION_OPERATORS[0];
                onChange({ field: value.field, operator: next.value, ...(next.needsValue ? { value: next.value === 'in' ? [] : (value.value ?? '') } : {}) });
              }}
              sx={{ maxWidth: { sm: 190 } }}
            >
              {CONDITION_OPERATORS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {operator.needsValue &&
            (operator.value === 'in' ? (
              <Autocomplete
                multiple
                freeSolo={!choices}
                disabled={disabled}
                options={choices ? choices.map((c) => c.value) : []}
                getOptionLabel={(v) => choices?.find((c) => c.value === v)?.label ?? String(v)}
                value={Array.isArray(value.value) ? (value.value as string[]) : []}
                onChange={(_, next) => onChange({ ...value, value: next })}
                renderInput={(params) => <TextField {...params} label="Values" placeholder={choices ? undefined : 'Type a value and press Enter'} />}
              />
            ) : choices && (operator.value === 'eq' || operator.value === 'neq') ? (
              <TextField select label="Value" value={String(value.value ?? '')} disabled={disabled} onChange={(e) => onChange({ ...value, value: e.target.value })}>
                {choices.map((c) => (
                  <MenuItem key={c.value} value={c.value}>
                    {c.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                label="Value"
                value={String(value.value ?? '')}
                disabled={disabled}
                type={operator.value === 'gt' || operator.value === 'lt' ? 'number' : 'text'}
                onChange={(e) => onChange({ ...value, value: e.target.value })}
              />
            ))}
        </Stack>
      )}
      {error && (
        <Typography variant="caption" color="error" role="alert" component="div" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}

export interface FieldSettingsProps {
  open: boolean;
  field: DraftField | null;
  /** Changes every time the panel is opened, so each editing session starts from a clean copy. */
  sessionKey: number;
  isNew: boolean;
  kind: OwnerKind;
  ownerApiId: string;
  /** Every field currently in the schema (the edited one included when it already exists). */
  siblings: DraftField[];
  schema: SchemaResponse | undefined;
  serverErrors?: FieldErrors;
  readOnly: boolean;
  onApply: (field: DraftField) => void;
  onClose: () => void;
}

function SettingsBody({ field, isNew, kind, ownerApiId, siblings, schema, serverErrors, readOnly, onApply, onClose }: Omit<FieldSettingsProps, 'open' | 'field' | 'sessionKey'> & { field: DraftField }) {
  const [draft, setDraft] = useState<DraftField>(() => structuredClone(field));
  // Problems found when the schema was last checked; each one disappears as soon as its input is edited.
  const [errors, setErrors] = useState<FieldErrors>(() => ({ ...serverErrors }));
  // New fields derive their identifier from the label until the identifier is edited directly.
  const [apiIdAuto, setApiIdAuto] = useState(isNew && !field.apiId);
  const firstServerTab = serverErrors && Object.keys(serverErrors)[0] ? tabOf(Object.keys(serverErrors)[0]) : null;
  const [tab, setTab] = useState<TabKey>(firstServerTab ?? 'basics');

  const meta = FIELD_TYPE_META[draft.type];
  const cfg = draft.config;
  const relevant = useMemo(() => configKeysFor(draft.type), [draft.type]);
  const others = useMemo(() => siblings.filter((s) => s.key !== field.key), [siblings, field.key]);
  const components = useMemo(() => componentIndex(schema), [schema]);
  const err = (prop: string) => errorAt(errors, prop);
  const off = readOnly;
  const saved = !!field.id;
  const typeChanged = saved && draft.type !== field.type;
  const compatible = !typeChanged || isCompatibleTypeChange(field.type, draft.type);

  const clearErrors = (props: string[]) =>
    setErrors((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([key]) => !props.some((p) => key === p || key.startsWith(`${p}.`))));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  const set = (patch: Partial<DraftField>) => {
    setDraft((d) => ({ ...d, ...patch }));
    clearErrors([...Object.keys(patch), '_', 'id']);
  };
  const setConfig = (patch: Partial<FieldConfig>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
    clearErrors(Object.keys(patch).map((key) => `config.${key}`));
  };

  const changeType = (type: FieldType) => {
    clearErrors(['type', '_']);
    const next = FIELD_TYPE_META[type];
    const keep = configKeysFor(type);
    setDraft((d) => {
      const config: Record<string, unknown> = { ...structuredClone(next.defaultConfig ?? {}) };
      for (const [key, value] of Object.entries(d.config)) {
        // A default written for one type rarely makes sense for another.
        if (keep.has(key as keyof FieldConfig) && key !== 'defaultValue') config[key] = value;
      }
      return { ...d, type, unique: next.canBeUnique ? d.unique : false, localized: next.canBeLocalized ? d.localized : false, config: config as FieldConfig };
    });
    if (!STRUCTURE_TYPES.includes(type) && tab === 'structure') setTab('basics');
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'basics', label: 'Basics' },
    ...(STRUCTURE_TYPES.includes(draft.type) ? [{ key: 'structure' as const, label: 'Structure' }] : []),
    { key: 'validation', label: 'Validation' },
    { key: 'display', label: 'Display' },
    { key: 'conditions', label: 'Conditions' },
  ];
  const tabHasError = (key: TabKey) => Object.keys(errors).some((prop) => tabOf(prop) === key);

  const apply = () => {
    const found = validateDraft(draft, siblings, { kind, ownerApiId, schema });
    if (typeChanged && !compatible && kind === 'component') {
      found.type = `Inside a component, ${FIELD_TYPE_META[field.type].label} cannot become ${meta.label}. Add a new field instead.`;
    }
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      setTab(tabOf(first));
      return;
    }
    onApply({ ...draft, apiId: draft.apiId.trim(), label: draft.label.trim() });
  };

  const defaultField: FieldDef = {
    apiId: 'value',
    label: 'Default value',
    type: draft.type,
    required: false,
    unique: false,
    localized: false,
    position: 0,
    config: { options: cfg.options, maxRating: cfg.maxRating, language: cfg.language, min: cfg.min, max: cfg.max, step: cfg.step, helpText: 'New entries start with this value.' },
  };

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!off) apply();
      }}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <Stack direction="row" spacing={3} sx={{ px: 5, py: 3.5, alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle' }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '8px', bgcolor: 'surface.sunken', color: 'text.secondary', display: 'grid', placeItems: 'center', flexShrink: 0, '& svg': { fontSize: 18 } }}>
          <IconFor name={meta.icon} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h4" component="h2" id="field-settings-title" noWrap>
            {isNew ? `New ${meta.label.toLowerCase()} field` : draft.label || 'Field settings'}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {meta.label} · {meta.description}
          </Typography>
        </Box>
        <IconButton aria-label="Close field settings" onClick={onClose} edge="end">
          <CloseOutlined />
        </IconButton>
      </Stack>

      <Tabs value={tab} onChange={(_, next: TabKey) => setTab(next)} variant="scrollable" scrollButtons="auto" sx={{ px: 3 }}>
        {tabs.map((t) => (
          <Tab
            key={t.key}
            value={t.key}
            label={
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <span>{t.label}</span>
                {tabHasError(t.key) && <Box component="span" aria-label="has errors" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'error.main' }} />}
              </Stack>
            }
          />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 5, py: 5 }}>
        {err('_') && (
          <Alert severity="error" sx={{ mb: 4 }}>
            {err('_')}
          </Alert>
        )}

        {tab === 'basics' && (
          <Stack spacing={4}>
            <TextField
              label="Label"
              autoFocus={isNew}
              value={draft.label}
              disabled={off}
              error={!!err('label')}
              helperText={err('label') ?? 'What editors see above the field'}
              onChange={(e) => {
                const label = e.target.value;
                set({ label, ...(apiIdAuto ? { apiId: toFieldApiId(label) } : {}) });
              }}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <TextField
              label="API identifier"
              value={draft.apiId}
              disabled={off || (saved && kind === 'component')}
              error={!!err('apiId') || !!err('id')}
              helperText={
                err('apiId') ??
                err('id') ??
                (saved && kind === 'component'
                  ? 'Identifiers of saved component fields cannot change, because stored content refers to them.'
                  : saved
                    ? 'Renaming migrates existing content to the new identifier when you save.'
                    : 'The key used in API responses. camelCase.')
              }
              onChange={(e) => {
                setApiIdAuto(false);
                set({ apiId: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') });
              }}
              slotProps={{ htmlInput: { maxLength: 63, spellCheck: false }, input: { sx: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } } }}
            />
            <TextField
              select
              label="Type"
              value={draft.type}
              disabled={off}
              error={!!err('type')}
              helperText={err('type')}
              onChange={(e) => changeType(e.target.value as FieldType)}
              slotProps={{ select: { renderValue: (value) => FIELD_TYPE_META[value as FieldType]?.label ?? String(value) } }}
            >
              {CATEGORY_ORDER.flatMap((category) => [
                <ListSubheader key={category} sx={{ lineHeight: '30px', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {FIELD_CATEGORY_LABELS[category]}
                </ListSubheader>,
                ...FIELD_TYPES.filter((t) => FIELD_TYPE_META[t].category === category).map((t) => (
                  <MenuItem key={t} value={t}>
                    <IconFor name={FIELD_TYPE_META[t].icon} sx={{ fontSize: 16, color: 'text.secondary' }} />
                    {FIELD_TYPE_META[t].label}
                  </MenuItem>
                )),
              ])}
            </TextField>
            {typeChanged &&
              (compatible ? (
                <Alert severity="info">Existing values are kept when {FIELD_TYPE_META[field.type].label.toLowerCase()} becomes {meta.label.toLowerCase()}.</Alert>
              ) : kind === 'component' ? (
                <Alert severity="error">Inside a component, {FIELD_TYPE_META[field.type].label.toLowerCase()} cannot become {meta.label.toLowerCase()}. Add a new field instead.</Alert>
              ) : (
                <Alert severity="warning">
                  Existing {FIELD_TYPE_META[field.type].label.toLowerCase()} values cannot be converted to {meta.label.toLowerCase()} and will be cleared when the schema is saved. You will be asked to confirm.
                </Alert>
              ))}

            <Box>
              <ToggleRow label="Required" description="Entries cannot be published without a value. Drafts can still be saved." checked={draft.required} disabled={off} onChange={(required) => set({ required })} />
              {meta.canBeUnique && kind === 'type' && (
                <ToggleRow label="Unique" description="No two entries may share the same value." checked={draft.unique} disabled={off} onChange={(unique) => set({ unique })} />
              )}
              {meta.canBeLocalized && (
                <ToggleRow label="Localized" description="Each locale holds its own value for this field." checked={draft.localized} disabled={off} onChange={(localized) => set({ localized })} />
              )}
              {err('unique') && (
                <Typography variant="caption" color="error" role="alert" component="div" sx={{ mt: 1 }}>
                  {err('unique')}
                </Typography>
              )}
            </Box>

            <TextField
              label="Help text"
              multiline
              minRows={2}
              value={cfg.helpText ?? ''}
              disabled={off}
              helperText="Guidance shown below the field"
              onChange={(e) => setConfig({ helpText: e.target.value })}
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {relevant.has('placeholder') && (
              <TextField label="Placeholder" value={cfg.placeholder ?? ''} disabled={off} onChange={(e) => setConfig({ placeholder: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
            )}
          </Stack>
        )}

        {tab === 'structure' && (
          <Stack spacing={4}>
            {relevant.has('targetType') && (
              <TextField
                select
                label="Links to"
                value={cfg.targetType ?? ''}
                disabled={off}
                error={!!err('config.targetType')}
                helperText={err('config.targetType') ?? (draft.type === 'relations' ? 'Editors can link several entries of this content type.' : 'Editors can link one entry of this content type.')}
                onChange={(e) => setConfig({ targetType: e.target.value })}
                slotProps={{ select: { renderValue: (value) => schema?.types.find((t) => t.apiId === value)?.displayName ?? String(value) } }}
              >
                {(schema?.types ?? []).map((t) => (
                  <MenuItem key={t.id} value={t.apiId}>
                    <IconFor name={t.icon} sx={{ fontSize: 16, color: 'text.secondary' }} />
                    {t.displayName}
                    {kind === 'type' && t.apiId === ownerApiId ? ' (this type)' : ''}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {relevant.has('component') && (
              <TextField
                select
                label="Component"
                value={cfg.component ?? ''}
                disabled={off || (schema?.components.length ?? 0) === 0}
                error={!!err('config.component')}
                helperText={
                  err('config.component') ??
                  ((schema?.components.length ?? 0) === 0
                    ? 'There are no components yet. Create one under Components, then come back.'
                    : draft.type === 'repeatable'
                      ? 'Editors can add this group of fields as many times as needed.'
                      : 'This group of fields appears once inside the entry.')
                }
                onChange={(e) => setConfig({ component: e.target.value })}
                slotProps={{ select: { renderValue: (value) => schema?.components.find((c) => c.apiId === value)?.displayName ?? String(value) } }}
              >
                {(schema?.components ?? [])
                  .filter((c) => !(kind === 'component' && c.apiId === ownerApiId))
                  .map((c) => (
                    <MenuItem key={c.id} value={c.apiId}>
                      <IconFor name={c.icon} sx={{ fontSize: 16, color: 'text.secondary' }} />
                      {c.displayName}
                      <Mono sx={{ ml: 'auto', pl: 3, color: 'text.disabled' }}>{c.apiId}</Mono>
                    </MenuItem>
                  ))}
              </TextField>
            )}
            {relevant.has('allowedComponents') && (
              <Autocomplete
                multiple
                disableCloseOnSelect
                disabled={off}
                options={(schema?.components ?? []).filter((c) => !(kind === 'component' && c.apiId === ownerApiId)).map((c) => c.apiId)}
                getOptionLabel={(apiId) => schema?.components.find((c) => c.apiId === apiId)?.displayName ?? apiId}
                value={cfg.allowedComponents ?? []}
                onChange={(_, next) => setConfig({ allowedComponents: next })}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Allowed components"
                    error={!!err('config.allowedComponents')}
                    helperText={err('config.allowedComponents') ?? 'Editors mix and reorder these inside the zone. Leave empty to allow every component.'}
                  />
                )}
              />
            )}
            {relevant.has('sourceField') && (
              <TextField
                select
                label="Generate from"
                value={cfg.sourceField ?? ''}
                disabled={off}
                error={!!err('config.sourceField')}
                helperText={err('config.sourceField') ?? 'An empty slug is generated from this field when the entry is saved.'}
                onChange={(e) => setConfig({ sourceField: e.target.value || undefined })}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              >
                <MenuItem value="">
                  <Typography variant="body2" color="text.secondary">
                    None — typed by hand
                  </Typography>
                </MenuItem>
                {others
                  .filter((f) => f.apiId && (f.type === 'text' || f.type === 'textarea'))
                  .map((f) => (
                    <MenuItem key={f.key} value={f.apiId}>
                      {f.label || f.apiId}
                    </MenuItem>
                  ))}
              </TextField>
            )}
            {relevant.has('language') && (
              <TextField select label="Language" value={cfg.language ?? 'text'} disabled={off} helperText="Used for syntax highlighting in the editor" onChange={(e) => setConfig({ language: e.target.value })}>
                {CODE_LANGUAGES.map((language) => (
                  <MenuItem key={language} value={language}>
                    {language}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        )}

        {tab === 'validation' && (
          <Stack spacing={4}>
            {relevant.has('options') && (
              <Box>
                <GroupTitle>Options</GroupTitle>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2.5 }}>
                  The label is shown to editors; the value is stored and returned by the API.
                </Typography>
                <OptionsEditor options={cfg.options ?? []} onChange={(options) => setConfig({ options })} error={err('config.options')} disabled={off} />
              </Box>
            )}
            {relevant.has('minLength') && (
              <Box>
                <GroupTitle>Length</GroupTitle>
                <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                  <NumberInput label="Minimum length" value={cfg.minLength} min={0} disabled={off} error={err('config.minLength')} onChange={(minLength) => setConfig({ minLength })} />
                  <NumberInput label="Maximum length" value={cfg.maxLength} min={1} disabled={off} error={err('config.maxLength')} onChange={(maxLength) => setConfig({ maxLength })} />
                </Stack>
              </Box>
            )}
            {relevant.has('pattern') && (
              <Box>
                <GroupTitle>Pattern</GroupTitle>
                <Stack spacing={2.5} sx={{ mt: 2 }}>
                  <TextField
                    label="Regular expression"
                    value={cfg.pattern ?? ''}
                    disabled={off}
                    error={!!err('config.pattern')}
                    helperText={err('config.pattern') ?? 'For example ^[A-Z]{2}-\\d{4}$'}
                    onChange={(e) => setConfig({ pattern: e.target.value })}
                    slotProps={{ htmlInput: { maxLength: 500, spellCheck: false }, input: { sx: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' } } }}
                  />
                  <TextField
                    label="Message when the pattern does not match"
                    value={cfg.patternMessage ?? ''}
                    disabled={off || !cfg.pattern}
                    onChange={(e) => setConfig({ patternMessage: e.target.value })}
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                </Stack>
              </Box>
            )}
            {relevant.has('min') && (
              <Box>
                <GroupTitle>Range</GroupTitle>
                <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                  <NumberInput label="Minimum" value={cfg.min} integer={false} disabled={off} error={err('config.min')} onChange={(min) => setConfig({ min })} />
                  <NumberInput label="Maximum" value={cfg.max} integer={false} disabled={off} error={err('config.max')} onChange={(max) => setConfig({ max })} />
                  <NumberInput label="Step" value={cfg.step} integer={false} min={0} disabled={off} error={err('config.step')} onChange={(step) => setConfig({ step: step && step > 0 ? step : undefined })} />
                </Stack>
              </Box>
            )}
            {relevant.has('maxRating') && <NumberInput label="Highest rating" value={cfg.maxRating} min={1} disabled={off} error={err('config.maxRating')} helperText="Between 1 and 10 stars" onChange={(maxRating) => setConfig({ maxRating: maxRating ? Math.min(10, Math.max(1, maxRating)) : undefined })} />}
            {relevant.has('minItems') && (
              <Box>
                <GroupTitle>Number of items</GroupTitle>
                <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                  <NumberInput label="At least" value={cfg.minItems} min={0} disabled={off} error={err('config.minItems')} onChange={(minItems) => setConfig({ minItems })} />
                  <NumberInput label="At most" value={cfg.maxItems} min={1} disabled={off} error={err('config.maxItems')} onChange={(maxItems) => setConfig({ maxItems })} />
                </Stack>
              </Box>
            )}
            {relevant.has('allowedExtensions') && (
              <Box>
                <GroupTitle>Files</GroupTitle>
                <Stack spacing={2.5} sx={{ mt: 2 }}>
                  <Autocomplete
                    multiple
                    freeSolo
                    disabled={off}
                    options={COMMON_EXTENSIONS}
                    value={cfg.allowedExtensions ?? []}
                    onChange={(_, next) => setConfig({ allowedExtensions: [...new Set(next.map((v) => v.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean))] })}
                    renderInput={(params) => (
                      <TextField {...params} label="Allowed extensions" error={!!err('config.allowedExtensions')} helperText={err('config.allowedExtensions') ?? 'Leave empty to accept every supported file type.'} />
                    )}
                  />
                  <NumberInput
                    label="Maximum file size"
                    suffix="MB"
                    integer={false}
                    min={0}
                    disabled={off}
                    value={cfg.maxFileSize ? Math.round((cfg.maxFileSize / 1048576) * 100) / 100 : undefined}
                    error={err('config.maxFileSize')}
                    onChange={(mb) => setConfig({ maxFileSize: mb && mb > 0 ? Math.round(mb * 1048576) : undefined })}
                  />
                </Stack>
              </Box>
            )}
            {relevant.has('minWidth') && (
              <Box>
                <GroupTitle>Image dimensions (pixels)</GroupTitle>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, mt: 2 }}>
                  <NumberInput label="Minimum width" value={cfg.minWidth} min={1} disabled={off} error={err('config.minWidth')} onChange={(minWidth) => setConfig({ minWidth: minWidth && minWidth > 0 ? minWidth : undefined })} />
                  <NumberInput label="Minimum height" value={cfg.minHeight} min={1} disabled={off} error={err('config.minHeight')} onChange={(minHeight) => setConfig({ minHeight: minHeight && minHeight > 0 ? minHeight : undefined })} />
                  <NumberInput label="Maximum width" value={cfg.maxWidth} min={1} disabled={off} error={err('config.maxWidth')} onChange={(maxWidth) => setConfig({ maxWidth: maxWidth && maxWidth > 0 ? maxWidth : undefined })} />
                  <NumberInput label="Maximum height" value={cfg.maxHeight} min={1} disabled={off} error={err('config.maxHeight')} onChange={(maxHeight) => setConfig({ maxHeight: maxHeight && maxHeight > 0 ? maxHeight : undefined })} />
                </Box>
              </Box>
            )}
            <Box>
              <GroupTitle>Messages</GroupTitle>
              <TextField
                sx={{ mt: 2 }}
                label="Message when the field is required but empty"
                value={cfg.requiredMessage ?? ''}
                disabled={off}
                placeholder={`${draft.label || 'This field'} is required`}
                onChange={(e) => setConfig({ requiredMessage: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 200 }, inputLabel: { shrink: true } }}
              />
            </Box>
          </Stack>
        )}

        {tab === 'display' && (
          <Stack spacing={4}>
            <Box>
              <Typography variant="subtitle2" component="div" id="field-width-label" sx={{ fontWeight: 500, mb: 1.5 }}>
                Width in the entry form
              </Typography>
              <ToggleButtonGroup exclusive size="small" aria-labelledby="field-width-label" value={cfg.width ?? 12} disabled={off} onChange={(_, width) => width && setConfig({ width })}>
                {WIDTH_OPTIONS.map((w) => (
                  <ToggleButton key={w.value} value={w.value} sx={{ minWidth: 48 }}>
                    {w.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Tab" value={cfg.tab ?? ''} disabled={off} helperText="Fields with the same tab name share a tab" onChange={(e) => setConfig({ tab: e.target.value })} slotProps={{ htmlInput: { maxLength: 60 } }} />
              <TextField label="Group" value={cfg.group ?? ''} disabled={off} helperText="Adds a heading above consecutive fields" onChange={(e) => setConfig({ group: e.target.value })} slotProps={{ htmlInput: { maxLength: 60 } }} />
            </Stack>
            <Box>
              <ToggleRow label="Read-only" description="Shown in the form but cannot be edited there." checked={cfg.readOnly === true} disabled={off} onChange={(readOnly) => setConfig({ readOnly })} />
              <ToggleRow label="Hidden in the form" description="Kept out of the entry form; still writable through the API." checked={cfg.hidden === true} disabled={off} onChange={(hidden) => setConfig({ hidden })} />
              {relevant.has('private') ? (
                <ToggleRow label="Private" description="Never returned by the delivery API." checked={cfg.private === true} disabled={off} onChange={(isPrivate) => setConfig({ private: isPrivate })} />
              ) : (
                <ToggleRow label="Private" description="Secrets are hashed at rest and never returned by the delivery API." checked disabled onChange={() => undefined} />
              )}
            </Box>
            {(relevant.has('searchable') || relevant.has('sortable') || relevant.has('filterable')) && (
              <Box>
                <GroupTitle>In lists and the API</GroupTitle>
                {relevant.has('searchable') && <ToggleRow label="Searchable" description="Included when searching entries." checked={cfg.searchable !== false} disabled={off} onChange={(on) => setConfig({ searchable: on ? undefined : false })} />}
                {relevant.has('sortable') && <ToggleRow label="Sortable" description="Entries can be ordered by this field." checked={cfg.sortable !== false} disabled={off} onChange={(on) => setConfig({ sortable: on ? undefined : false })} />}
                {relevant.has('filterable') && <ToggleRow label="Filterable" description="Entries can be filtered by this field." checked={cfg.filterable !== false} disabled={off} onChange={(on) => setConfig({ filterable: on ? undefined : false })} />}
              </Box>
            )}
            {relevant.has('defaultValue') && (
              <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', p: 3.5 }}>
                <FieldForm
                  fields={[defaultField]}
                  value={{ value: cfg.defaultValue ?? null }}
                  onChange={(next) => setConfig({ defaultValue: next.value === '' || next.value === null ? undefined : next.value })}
                  components={components}
                  disabled={off}
                  dense
                />
                {cfg.defaultValue !== undefined && !off && (
                  <Button size="small" onClick={() => setConfig({ defaultValue: undefined })} sx={{ mt: 2 }}>
                    Clear default
                  </Button>
                )}
              </Box>
            )}
          </Stack>
        )}

        {tab === 'conditions' && (
          <Stack spacing={3}>
            <Typography variant="body2" color="text.secondary">
              Show or require this field depending on the value of another field in the same form.
            </Typography>
            <ConditionEditor
              title="Show only when…"
              description="The field is hidden, and not validated, unless the condition holds."
              value={cfg.visibleWhen}
              onChange={(visibleWhen) => setConfig({ visibleWhen })}
              fields={others}
              error={err('config.visibleWhen')}
              disabled={off}
            />
            <ConditionEditor
              title="Required when…"
              description="The field becomes required only while the condition holds."
              value={cfg.requiredWhen}
              onChange={(requiredWhen) => setConfig({ requiredWhen })}
              fields={others}
              error={err('config.requiredWhen')}
              disabled={off}
            />
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={2} sx={{ px: 5, py: 3, alignItems: 'center', justifyContent: 'space-between', borderTop: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
          {off ? 'You can view this field but not change it.' : 'Applied to the draft schema. Nothing is stored until you save.'}
        </Typography>
        <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
          <Button onClick={onClose}>{off ? 'Close' : 'Cancel'}</Button>
          {!off && (
            <Tooltip title={typeChanged && !compatible && kind === 'component' ? 'This type change is not allowed inside a component' : ''}>
              <span>
                <Button type="submit" variant="contained" disabled={typeChanged && !compatible && kind === 'component'}>
                  {isNew ? 'Add field' : 'Apply'}
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

/** Side panel for one field's settings. Works on a copy; nothing changes until Apply. */
export function FieldSettings({ open, field, sessionKey, isNew, ...rest }: FieldSettingsProps) {
  // The panel keeps showing the field while it slides out, after the parent has cleared it.
  const last = useRef<{ field: DraftField; sessionKey: number; isNew: boolean } | null>(null);
  if (field) last.current = { field, sessionKey, isNew };
  const shown = last.current;
  return (
    <Drawer anchor="right" open={open && !!field} onClose={rest.onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 } }, 'aria-labelledby': 'field-settings-title' } as object }}>
      {shown && <SettingsBody key={shown.sessionKey} field={shown.field} isNew={shown.isNew} {...rest} />}
    </Drawer>
  );
}
