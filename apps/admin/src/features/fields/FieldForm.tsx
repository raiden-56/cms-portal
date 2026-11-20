import { type ReactNode, memo, useMemo, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Rating from '@mui/material/Rating';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import AutorenewOutlined from '@mui/icons-material/AutorenewOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import KeyboardArrowDownOutlined from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlined from '@mui/icons-material/KeyboardArrowUpOutlined';
import { type FieldDef, buildDefaults, evaluateCondition, isSecretValue, newId, slugify } from '@meridian/shared';
import { IconFor } from '@/components/icons';
import { toLocalInput } from '@/lib/format';
import { CodeEditor, JsonEditor, MarkdownEditor } from './CodeEditor';
import { MediaField } from './MediaField';
import { RelationField } from './RelationField';
import { RichTextEditor } from './RichTextEditor';

export interface ComponentInfo {
  displayName: string;
  icon?: string;
  fields: FieldDef[];
}

export interface FieldFormProps {
  fields: FieldDef[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Validation messages keyed by dot path relative to `value` (e.g. `seo.title`, `items.0.name`). */
  errors?: Record<string, string>;
  disabled?: boolean;
  /** Component schemas by apiId (built-in and custom), for component, repeatable and dynamic-zone fields. */
  components: Record<string, ComponentInfo>;
  /** Single-column layout for narrow panels such as the page builder inspector. */
  dense?: boolean;
  /** Show fields flagged hidden (used by previews of the form itself). */
  showHidden?: boolean;
}

const subErrors = (errors: Record<string, string> | undefined, prefix: string): Record<string, string> => {
  if (!errors) return {};
  const out: Record<string, string> = {};
  const start = `${prefix}.`;
  for (const [path, message] of Object.entries(errors)) if (path.startsWith(start)) out[path.slice(start.length)] = message;
  return out;
};
const hasErrorUnder = (errors: Record<string, string> | undefined, prefix: string) =>
  !!errors && Object.keys(errors).some((path) => path === prefix || path.startsWith(`${prefix}.`));

function itemTitle(fields: FieldDef[], item: Record<string, unknown>, fallback: string): string {
  for (const f of fields) {
    const v = item?.[f.apiId];
    if (['text', 'textarea', 'email', 'url', 'slug'].includes(f.type) && typeof v === 'string' && v.trim()) return v.trim().slice(0, 80);
  }
  return fallback;
}

function FieldLabel({ field, htmlFor, extra }: { field: FieldDef; htmlFor?: string; extra?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 1, gap: 2 }}>
      <Typography component="label" htmlFor={htmlFor} variant="subtitle2" sx={{ fontWeight: 500, fontSize: '0.8125rem' }}>
        {field.label}
        {field.required && (
          <Box component="span" aria-hidden sx={{ color: 'error.main', ml: 0.5 }}>
            *
          </Box>
        )}
        {field.localized && (
          <Tooltip title="Translated per locale">
            <Box component="span" sx={{ ml: 1.5, fontSize: '0.6875rem', color: 'text.disabled', fontWeight: 400 }}>
              localized
            </Box>
          </Tooltip>
        )}
      </Typography>
      {extra}
    </Stack>
  );
}

interface InputProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  errors?: Record<string, string>;
  disabled?: boolean;
  components: Record<string, ComponentInfo>;
  siblings: Record<string, unknown>;
  id: string;
  dense?: boolean;
}

/** Collapsible card for one item of a repeatable field or dynamic zone. */
function ItemCard({
  title,
  badge,
  icon,
  index,
  count,
  invalid,
  disabled,
  onMove,
  onRemove,
  children,
  defaultOpen,
}: {
  title: string;
  badge?: string;
  icon?: string;
  index: number;
  count: number;
  invalid?: boolean;
  disabled?: boolean;
  onMove: (delta: number) => void;
  onRemove: () => void;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Box sx={{ border: 1, borderColor: invalid ? 'error.main' : 'border.subtle', borderRadius: '8px', bgcolor: 'background.paper', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ alignItems: 'center', pl: 1, pr: 1, minHeight: 38, gap: 0.5, bgcolor: 'surface.subtle' }}>
        <IconButton size="small" aria-expanded={open} aria-label={open ? 'Collapse item' : 'Expand item'} onClick={() => setOpen((o) => !o)}>
          <ExpandMoreOutlined sx={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 140ms' }} />
        </IconButton>
        {icon && <IconFor name={icon} sx={{ fontSize: 16, color: 'text.secondary' }} />}
        <Typography variant="body2" noWrap onClick={() => setOpen((o) => !o)} sx={{ flex: 1, fontWeight: 500, cursor: 'pointer', color: invalid ? 'error.main' : 'text.primary' }}>
          {title}
        </Typography>
        {badge && <Chip label={badge} variant="outlined" sx={{ mr: 1 }} />}
        {!disabled && (
          <>
            <IconButton size="small" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
              <KeyboardArrowUpOutlined />
            </IconButton>
            <IconButton size="small" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <KeyboardArrowDownOutlined />
            </IconButton>
            <IconButton size="small" aria-label="Remove item" onClick={onRemove} sx={{ '&:hover': { color: 'error.main' } }}>
              <DeleteOutlineOutlined />
            </IconButton>
          </>
        )}
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ p: 3.5, borderTop: 1, borderColor: 'border.subtle' }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

const moveItem = <T,>(list: T[], index: number, delta: number): T[] => {
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(index + delta, 0, item);
  return next;
};

function FieldInput({ field, value, onChange, error, errors, disabled, components, siblings, id, dense }: InputProps) {
  const cfg = field.config;
  const off = disabled || cfg.readOnly;
  const describedBy = error ? `${id}-error` : cfg.helpText ? `${id}-help` : undefined;
  const text = typeof value === 'string' ? value : '';
  const textProps = { id, disabled: off, error: !!error, placeholder: cfg.placeholder, slotProps: { htmlInput: { 'aria-describedby': describedBy, maxLength: cfg.maxLength } } };
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);

  switch (field.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'phone':
      return (
        <TextField
          {...textProps}
          type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : field.type === 'phone' ? 'tel' : 'text'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          slotProps={{
            ...textProps.slotProps,
            input: cfg.maxLength && cfg.maxLength <= 300 ? { endAdornment: <InputAdornment position="end"><Typography variant="caption" color={text.length > cfg.maxLength ? 'error' : 'text.disabled'}>{text.length}/{cfg.maxLength}</Typography></InputAdornment> } : undefined,
          }}
        />
      );
    case 'textarea':
      return <TextField {...textProps} multiline minRows={3} maxRows={14} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'markdown':
      return <MarkdownEditor value={text} onChange={onChange} readOnly={off} invalid={!!error} />;
    case 'richtext':
      return <RichTextEditor value={value} onChange={onChange} disabled={off} invalid={!!error} ariaLabel={field.label} config={{ placeholder: cfg.placeholder }} />;
    case 'code':
      return <CodeEditor value={text} onChange={off ? undefined : onChange} language={cfg.language ?? 'text'} readOnly={off} invalid={!!error} ariaLabel={field.label} />;
    case 'json':
      return <JsonEditor value={value} onChange={off ? undefined : onChange} readOnly={off} ariaLabel={field.label} />;
    case 'integer':
    case 'decimal':
      return (
        <TextField
          {...textProps}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }}
          slotProps={{ htmlInput: { 'aria-describedby': describedBy, min: cfg.min, max: cfg.max, step: cfg.step ?? (field.type === 'integer' ? 1 : 'any'), inputMode: field.type === 'integer' ? 'numeric' : 'decimal' } }}
        />
      );
    case 'boolean':
      return <FormControlLabel sx={{ ml: 0 }} control={<Switch id={id} checked={value === true} disabled={off} onChange={(e) => onChange(e.target.checked)} />} label={<Typography variant="body2">{value === true ? 'Yes' : 'No'}</Typography>} />;
    case 'checkbox':
      return <FormControlLabel sx={{ ml: -1.5 }} control={<Checkbox id={id} checked={value === true} disabled={off} onChange={(e) => onChange(e.target.checked)} />} label={<Typography variant="body2">{cfg.placeholder || field.label}</Typography>} />;
    case 'date':
      return <TextField {...textProps} type="date" value={text} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return <TextField {...textProps} type="datetime-local" value={toLocalInput(text)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} />;
    case 'select':
      return (
        <TextField {...textProps} select value={text} onChange={(e) => onChange(e.target.value || null)} slotProps={{ select: { displayEmpty: true, labelId: `${id}-label` }, htmlInput: { 'aria-describedby': describedBy } }}>
          <MenuItem value="">
            <Typography variant="body2" color="text.disabled">
              {cfg.placeholder || 'Select…'}
            </Typography>
          </MenuItem>
          {(cfg.options ?? []).map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      );
    case 'radio':
      return (
        <RadioGroup row={!dense} value={text} onChange={(e) => onChange(e.target.value)} aria-labelledby={`${id}-label`}>
          {(cfg.options ?? []).map((o) => (
            <FormControlLabel key={o.value} value={o.value} disabled={off} control={<Radio />} label={<Typography variant="body2">{o.label}</Typography>} />
          ))}
        </RadioGroup>
      );
    case 'multiselect': {
      const options = cfg.options ?? [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Autocomplete
          multiple
          disableCloseOnSelect
          id={id}
          disabled={off}
          options={options.map((o) => o.value)}
          value={selected}
          getOptionLabel={(v) => options.find((o) => o.value === v)?.label ?? v}
          onChange={(_, next) => onChange(next)}
          renderInput={(params) => <TextField {...params} error={!!error} placeholder={selected.length ? undefined : cfg.placeholder || 'Select…'} />}
        />
      );
    }
    case 'password': {
      const isSet = isSecretValue(value);
      if (isSet && !revealSecret) {
        return (
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <TextField disabled value="••••••••••••" slotProps={{ htmlInput: { 'aria-label': `${field.label} (a value is set)` } }} />
            {!off && (
              <Button variant="outlined" onClick={() => { setRevealSecret(true); onChange(''); }} sx={{ flexShrink: 0 }}>
                Change
              </Button>
            )}
          </Stack>
        );
      }
      return <TextField {...textProps} type="password" autoComplete="new-password" value={text} onChange={(e) => onChange(e.target.value)} />;
    }
    case 'color':
      return (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Box
            component="input"
            type="color"
            aria-label={`${field.label} picker`}
            disabled={off}
            value={/^#[0-9a-fA-F]{6}$/.test(text) ? text : '#000000'}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.toUpperCase())}
            sx={{ width: 34, height: 34, p: 0.5, border: 1, borderColor: 'border.strong', borderRadius: '7px', bgcolor: 'background.paper', cursor: 'pointer', flexShrink: 0 }}
          />
          <TextField {...textProps} value={text} placeholder={cfg.placeholder ?? '#1F6F5C'} onChange={(e) => onChange(e.target.value || null)} />
        </Stack>
      );
    case 'slug': {
      const source = cfg.sourceField ? siblings[cfg.sourceField] : undefined;
      return (
        <TextField
          {...textProps}
          value={text}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-/, ''))}
          placeholder={cfg.placeholder ?? (cfg.sourceField ? 'Generated when you save' : 'url-friendly-name')}
          slotProps={{
            htmlInput: { 'aria-describedby': describedBy, spellCheck: false },
            input: {
              sx: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
              endAdornment:
                cfg.sourceField && !off ? (
                  <InputAdornment position="end">
                    <Tooltip title="Generate from the source field">
                      <span>
                        <IconButton size="small" edge="end" aria-label="Generate slug" disabled={typeof source !== 'string' || !source.trim()} onClick={() => onChange(slugify(String(source)))}>
                          <AutorenewOutlined />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </InputAdornment>
                ) : undefined,
            },
          }}
        />
      );
    }
    case 'uid':
      return (
        <TextField
          {...textProps}
          value={text}
          onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9_.-]+/g, ''))}
          slotProps={{
            htmlInput: { 'aria-describedby': describedBy, spellCheck: false },
            input: {
              endAdornment: !off ? (
                <InputAdornment position="end">
                  <Tooltip title="Generate">
                    <IconButton size="small" edge="end" aria-label="Generate identifier" onClick={() => onChange(newId().replace(/-/g, '').slice(0, 16))}>
                      <AutorenewOutlined />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
      );
    case 'rating':
      return <Rating value={typeof value === 'number' ? value : null} max={cfg.maxRating ?? 5} disabled={off} onChange={(_, next) => onChange(next)} aria-labelledby={`${id}-label`} />;
    case 'geolocation': {
      const geo = (value && typeof value === 'object' ? value : {}) as { lat?: number; lng?: number; address?: string };
      const set = (patch: Partial<typeof geo>) => {
        const next = { ...geo, ...patch };
        // A location is only meaningful with both coordinates; until then nothing is stored.
        onChange(typeof next.lat === 'number' && typeof next.lng === 'number' ? next : next.lat === undefined && next.lng === undefined && !next.address ? null : next);
      };
      const num = (raw: string) => (raw === '' ? undefined : Number(raw));
      return (
        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <TextField label="Latitude" type="number" disabled={off} error={hasErrorUnder(errors, 'lat')} helperText={errors?.lat} value={geo.lat ?? ''} onChange={(e) => set({ lat: num(e.target.value) })} slotProps={{ htmlInput: { min: -90, max: 90, step: 'any' } }} />
            <TextField label="Longitude" type="number" disabled={off} error={hasErrorUnder(errors, 'lng')} helperText={errors?.lng} value={geo.lng ?? ''} onChange={(e) => set({ lng: num(e.target.value) })} slotProps={{ htmlInput: { min: -180, max: 180, step: 'any' } }} />
          </Stack>
          <TextField label="Address (optional)" disabled={off} value={geo.address ?? ''} onChange={(e) => set({ address: e.target.value || undefined })} />
        </Stack>
      );
    }
    case 'image':
    case 'images':
    case 'video':
    case 'file':
    case 'files':
      return <MediaField type={field.type} value={value} onChange={onChange} disabled={off} invalid={!!error} />;
    case 'relation':
    case 'relations':
      return <RelationField targetType={cfg.targetType} multiple={field.type === 'relations'} value={value} onChange={onChange} disabled={off} invalid={!!error} placeholder={cfg.placeholder} />;
    case 'component': {
      const component = components[cfg.component ?? ''];
      if (!component) return <Typography variant="body2" color="error">The component “{cfg.component}” no longer exists.</Typography>;
      const current = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null;
      if (!current) {
        return (
          <Button variant="outlined" startIcon={<AddOutlined />} disabled={off} onClick={() => onChange(buildDefaults(component.fields))}>
            Add {component.displayName.toLowerCase()}
          </Button>
        );
      }
      return (
        <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', p: 3.5, bgcolor: 'surface.subtle' }}>
          <FieldForm fields={component.fields} value={current} onChange={onChange} errors={errors} disabled={off} components={components} dense={dense} />
          {!off && !field.required && (
            <Button size="small" color="error" onClick={() => onChange(null)} sx={{ mt: 2 }}>
              Remove {component.displayName.toLowerCase()}
            </Button>
          )}
        </Box>
      );
    }
    case 'repeatable': {
      const component = components[cfg.component ?? ''];
      if (!component) return <Typography variant="body2" color="error">The component “{cfg.component}” no longer exists.</Typography>;
      const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
      const full = cfg.maxItems !== undefined && items.length >= cfg.maxItems;
      return (
        <Stack spacing={2}>
          {items.map((item, index) => (
            <ItemCard
              key={(item?._key as string) ?? index}
              index={index}
              count={items.length}
              title={itemTitle(component.fields, item, `${component.displayName} ${index + 1}`)}
              invalid={hasErrorUnder(errors, String(index))}
              disabled={off}
              defaultOpen={hasErrorUnder(errors, String(index)) || item?._fresh === true}
              onMove={(delta) => onChange(moveItem(items, index, delta))}
              onRemove={() => onChange(items.filter((_, i) => i !== index))}
            >
              <FieldForm
                fields={component.fields}
                value={item ?? {}}
                onChange={(next) => onChange(items.map((it, i) => (i === index ? { ...next, _key: it._key } : it)))}
                errors={subErrors(errors, String(index))}
                disabled={off}
                components={components}
                dense={dense}
              />
            </ItemCard>
          ))}
          {!off && (
            <Box>
              <Tooltip title={full ? `At most ${cfg.maxItems} items` : ''}>
                <span>
                  <Button variant="outlined" size="small" startIcon={<AddOutlined />} disabled={full} onClick={() => onChange([...items, { ...buildDefaults(component.fields), _key: newId(), _fresh: true }])}>
                    Add {component.displayName.toLowerCase()}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          )}
        </Stack>
      );
    }
    case 'dynamiczone': {
      const items = Array.isArray(value) ? (value as { id: string; type: string; props: Record<string, unknown> }[]) : [];
      const allowed = (cfg.allowedComponents?.length ? cfg.allowedComponents : Object.keys(components).filter((k) => !k.startsWith('builtin.'))).filter((k) => components[k]);
      const full = cfg.maxItems !== undefined && items.length >= cfg.maxItems;
      return (
        <Stack spacing={2}>
          {items.map((item, index) => {
            const component = components[item.type];
            return (
              <ItemCard
                key={item.id ?? index}
                index={index}
                count={items.length}
                icon={component?.icon ?? 'component'}
                badge={component?.displayName ?? item.type}
                title={component ? itemTitle(component.fields, item.props ?? {}, component.displayName) : `Unknown component “${item.type}”`}
                invalid={!component || hasErrorUnder(errors, String(index))}
                disabled={off}
                defaultOpen={hasErrorUnder(errors, String(index))}
                onMove={(delta) => onChange(moveItem(items, index, delta))}
                onRemove={() => onChange(items.filter((_, i) => i !== index))}
              >
                {component ? (
                  <FieldForm
                    fields={component.fields}
                    value={item.props ?? {}}
                    onChange={(props) => onChange(items.map((it, i) => (i === index ? { ...it, props } : it)))}
                    errors={subErrors(errors, `${index}.props`)}
                    disabled={off}
                    components={components}
                    dense={dense}
                  />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    This component was deleted from the content model. Remove the item to continue.
                  </Typography>
                )}
              </ItemCard>
            );
          })}
          {!off && (
            <Box>
              <Button variant="outlined" size="small" startIcon={<AddOutlined />} disabled={full || allowed.length === 0} onClick={(e) => setAddAnchor(e.currentTarget)} aria-haspopup="menu">
                Add component
              </Button>
              {allowed.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                  No components are available for this zone yet.
                </Typography>
              )}
              <Menu anchorEl={addAnchor} open={!!addAnchor} onClose={() => setAddAnchor(null)}>
                {allowed.map((key) => (
                  <MenuItem
                    key={key}
                    onClick={() => {
                      onChange([...items, { id: newId(), type: key, props: buildDefaults(components[key].fields) }]);
                      setAddAnchor(null);
                    }}
                  >
                    <IconFor name={components[key].icon ?? 'component'} sx={{ fontSize: 16, color: 'text.secondary' }} />
                    {components[key].displayName}
                  </MenuItem>
                ))}
              </Menu>
            </Box>
          )}
        </Stack>
      );
    }
    default:
      return null;
  }
}

/** Field types that render their own visible label (or none), so the row label must not be a <label for>. */
const SELF_LABELLED = new Set(['checkbox']);
const GROUP_LABELLED = new Set(['radio', 'rating', 'richtext', 'markdown', 'code', 'json', 'image', 'images', 'video', 'file', 'files', 'component', 'repeatable', 'dynamiczone', 'geolocation', 'boolean']);

let formCounter = 0;

function FieldFormInner({ fields, value, onChange, errors, disabled, components, dense, showHidden }: FieldFormProps) {
  const [formId] = useState(() => `ff${(formCounter += 1)}`);
  const visible = useMemo(
    () => [...fields].sort((a, b) => a.position - b.position).filter((f) => (showHidden || !f.config.hidden) && evaluateCondition(f.config.visibleWhen, value)),
    [fields, value, showHidden],
  );
  const tabs = useMemo(() => [...new Set(visible.map((f) => f.config.tab || ''))], [visible]);
  const useTabs = !dense && tabs.some((t) => t !== '');
  const [tab, setTab] = useState(0);
  const activeTab = Math.min(tab, tabs.length - 1);
  const shown = useTabs ? visible.filter((f) => (f.config.tab || '') === tabs[activeTab]) : visible;

  let lastGroup: string | undefined;
  return (
    <Box>
      {useTabs && (
        <Tabs value={activeTab} onChange={(_, next) => setTab(next)} sx={{ mb: 4 }} variant="scrollable" scrollButtons="auto">
          {tabs.map((name, index) => {
            const invalid = visible.some((f) => (f.config.tab || '') === name && hasErrorUnder(errors, f.apiId));
            return <Tab key={name || 'general'} value={index} label={name || 'General'} sx={invalid ? { color: 'error.main !important' } : undefined} />;
          })}
        </Tabs>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', columnGap: 4, rowGap: 4.5 }}>
        {shown.map((field) => {
          const id = `${formId}-${field.apiId}`;
          const error = errors?.[field.apiId];
          const nested = subErrors(errors, field.apiId);
          const group = field.config.group;
          const heading = group && group !== lastGroup ? group : null;
          lastGroup = group;
          const required = field.required || (!!field.config.requiredWhen && evaluateCondition(field.config.requiredWhen, value));
          const shownField = required === field.required ? field : { ...field, required };
          return (
            <Box key={field.apiId} sx={{ gridColumn: { xs: 'span 12', md: dense ? 'span 12' : `span ${field.config.width ?? 12}` }, minWidth: 0 }}>
              {heading && (
                <Typography variant="overline" color="text.secondary" component="div" sx={{ mb: 2, pt: 1, borderTop: 1, borderColor: 'border.subtle' }}>
                  {heading}
                </Typography>
              )}
              {!SELF_LABELLED.has(field.type) && (
                <Box id={`${id}-label`}>
                  <FieldLabel field={shownField} htmlFor={GROUP_LABELLED.has(field.type) ? undefined : id} />
                </Box>
              )}
              <FieldInput
                field={field}
                id={id}
                value={value[field.apiId]}
                onChange={(next) => onChange({ ...value, [field.apiId]: next })}
                error={error}
                errors={nested}
                disabled={disabled}
                components={components}
                siblings={value}
                dense={dense}
              />
              {error ? (
                <Typography id={`${id}-error`} variant="caption" color="error" role="alert" component="div" sx={{ mt: 1 }}>
                  {error}
                </Typography>
              ) : field.config.helpText ? (
                <Typography id={`${id}-help`} variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                  {field.config.helpText}
                </Typography>
              ) : null}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Renders an editing form for any field schema — content types, components and page blocks
 * all use this one renderer, so every field type behaves the same everywhere.
 */
export const FieldForm = memo(FieldFormInner);

/** Builds the component lookup the form needs from a schema response. */
export function componentIndex(schema: { components: { apiId: string; displayName: string; icon: string; fields: FieldDef[] }[]; builtinComponents: Record<string, FieldDef[]> } | undefined): Record<string, ComponentInfo> {
  const index: Record<string, ComponentInfo> = {};
  if (!schema) return index;
  for (const [key, fields] of Object.entries(schema.builtinComponents)) {
    index[key] = { displayName: key.replace('builtin.', '').replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), fields };
  }
  for (const c of schema.components) index[c.apiId] = { displayName: c.displayName, icon: c.icon, fields: c.fields };
  return index;
}

/** Converts API validation details into the path → message map the form expects. */
export function toFieldErrors(details: unknown, stripPrefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(details)) return out;
  for (const d of details as { path?: string; message: string }[]) {
    if (typeof d.path !== 'string') continue;
    const path = stripPrefix && d.path.startsWith(stripPrefix) ? d.path.slice(stripPrefix.length) : d.path;
    if (!(path in out)) out[path] = d.message;
  }
  return out;
}
