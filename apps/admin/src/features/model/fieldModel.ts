import {
  API_ID_PATTERN,
  FIELD_TYPE_META,
  type FieldCondition,
  type FieldConfig,
  type FieldDef,
  type FieldType,
  RESERVED_FIELD_IDS,
  TEXT_SEARCH_FIELD_TYPES,
  newId,
} from '@meridian/shared';
import type { ApiError } from '@/lib/api';
import type { SchemaResponse } from '@/lib/types';

/** A field as it is being edited in the builder. `key` is stable for the lifetime of the editing session. */
export interface DraftField {
  key: string;
  /** Present once the field exists on the server. */
  id?: string;
  apiId: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  localized: boolean;
  config: FieldConfig;
}

export interface FieldPayload {
  id?: string;
  apiId: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  localized: boolean;
  config: FieldConfig;
}

export type OwnerKind = 'type' | 'component';

/** Errors for one field, keyed by property path such as `apiId` or `config.pattern`. */
export type FieldErrors = Record<string, string>;

export const fromDefs = (defs: FieldDef[]): DraftField[] =>
  [...defs]
    .sort((a, b) => a.position - b.position)
    .map((d) => ({
      key: d.id ?? newId(),
      id: d.id,
      apiId: d.apiId,
      label: d.label,
      type: d.type,
      required: d.required,
      unique: d.unique,
      localized: d.localized,
      config: structuredClone(d.config ?? {}),
    }));

export const toDefs = (fields: DraftField[]): FieldDef[] =>
  fields.map((f, position) => ({
    id: f.id,
    apiId: f.apiId || `field${position + 1}`,
    label: f.label || 'Untitled field',
    type: f.type,
    required: f.required,
    unique: f.unique,
    localized: f.localized,
    config: cleanConfig(f.type, f.config),
    position,
  }));

export function blankField(type: FieldType): DraftField {
  return {
    key: newId(),
    apiId: '',
    label: '',
    type,
    required: false,
    unique: false,
    localized: false,
    config: structuredClone(FIELD_TYPE_META[type].defaultConfig ?? {}),
  };
}

const STRING_RULE_TYPES: FieldType[] = ['text', 'textarea', 'markdown', 'code', 'email', 'url', 'slug', 'uid', 'password'];
const PLACEHOLDER_TYPES: FieldType[] = ['text', 'textarea', 'email', 'url', 'phone', 'integer', 'decimal', 'select', 'multiselect', 'color', 'slug', 'uid', 'password', 'richtext', 'date', 'datetime', 'relation', 'relations', 'checkbox'];
export const CHOICE_TYPES: FieldType[] = ['select', 'radio', 'multiselect'];
const LIST_TYPES: FieldType[] = ['multiselect', 'images', 'files', 'relations', 'repeatable', 'dynamiczone'];
const MEDIA_TYPES: FieldType[] = ['image', 'images', 'video', 'file', 'files'];
/** Types for which a default value can be set in the builder. */
export const DEFAULTABLE_TYPES: FieldType[] = ['text', 'textarea', 'markdown', 'integer', 'decimal', 'boolean', 'checkbox', 'date', 'datetime', 'select', 'radio', 'multiselect', 'email', 'url', 'phone', 'color', 'json', 'code', 'rating'];
/** Types whose essential configuration lives on the Structure tab. */
export const STRUCTURE_TYPES: FieldType[] = ['relation', 'relations', 'component', 'repeatable', 'dynamiczone', 'slug', 'code'];

/** Fixed order, so a cleaned config always serializes the same way regardless of how it was built. */
const CONFIG_ORDER: (keyof FieldConfig)[] = [
  'placeholder', 'helpText', 'width', 'group', 'tab', 'readOnly', 'hidden', 'private',
  'defaultValue', 'searchable', 'sortable', 'filterable', 'visibleWhen', 'requiredWhen',
  'minLength', 'maxLength', 'pattern', 'patternMessage', 'requiredMessage',
  'min', 'max', 'step', 'options',
  'allowedExtensions', 'maxFileSize', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'targetType', 'component', 'allowedComponents', 'minItems', 'maxItems',
  'sourceField', 'language', 'maxRating',
];

/** The configuration keys that mean something for a given field type. */
export function configKeysFor(type: FieldType): Set<keyof FieldConfig> {
  const keys = new Set<keyof FieldConfig>(['helpText', 'width', 'group', 'tab', 'readOnly', 'hidden', 'visibleWhen', 'requiredWhen', 'requiredMessage']);
  const add = (...names: (keyof FieldConfig)[]) => names.forEach((n) => keys.add(n));
  if (type !== 'password') add('private');
  if (STRING_RULE_TYPES.includes(type)) add('minLength', 'maxLength', 'pattern', 'patternMessage');
  if (PLACEHOLDER_TYPES.includes(type)) add('placeholder');
  if (type === 'integer' || type === 'decimal') add('min', 'max', 'step');
  if (type === 'rating') add('maxRating');
  if (CHOICE_TYPES.includes(type)) add('options');
  if (LIST_TYPES.includes(type)) add('minItems', 'maxItems');
  if (MEDIA_TYPES.includes(type)) add('allowedExtensions', 'maxFileSize');
  if (type === 'image' || type === 'images') add('minWidth', 'minHeight', 'maxWidth', 'maxHeight');
  if (type === 'relation' || type === 'relations') add('targetType');
  if (type === 'component' || type === 'repeatable') add('component');
  if (type === 'dynamiczone') add('allowedComponents');
  if (type === 'slug') add('sourceField');
  if (type === 'code') add('language');
  if (DEFAULTABLE_TYPES.includes(type)) add('defaultValue');
  if (TEXT_SEARCH_FIELD_TYPES.includes(type)) add('searchable');
  const scalar = FIELD_TYPE_META[type].scalar;
  if (scalar === 'string' || scalar === 'number' || scalar === 'boolean' || scalar === 'date') add('sortable', 'filterable');
  if (scalar === 'stringArray') add('filterable');
  return keys;
}

const cleanCondition = (c: FieldCondition | undefined): FieldCondition | undefined => {
  if (!c || !c.field) return undefined;
  if (c.operator === 'empty' || c.operator === 'notEmpty') return { field: c.field, operator: c.operator };
  return { field: c.field, operator: c.operator, value: c.value ?? '' };
};

/**
 * Normalises a config for saving and comparing: keeps only the keys that apply to the type,
 * drops empty values and writes keys in a fixed order.
 */
export function cleanConfig(type: FieldType, config: FieldConfig): FieldConfig {
  const relevant = configKeysFor(type);
  const out: Record<string, unknown> = {};
  for (const key of CONFIG_ORDER) {
    if (!relevant.has(key)) continue;
    let value: unknown = config[key];
    if (key === 'visibleWhen' || key === 'requiredWhen') value = cleanCondition(value as FieldCondition | undefined);
    if (key === 'options') {
      value = ((value as FieldConfig['options']) ?? []).map((o) => ({ label: o.label.trim(), value: o.value.trim() }));
    } else if (Array.isArray(value)) {
      value = value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '');
      if ((value as unknown[]).length === 0) value = undefined;
    }
    if (typeof value === 'string') {
      value = key === 'pattern' ? value : value.trim();
      if (value === '') value = undefined;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) value = undefined;
    // Presentation flags are only stored when they are on; query flags only when switched off.
    if ((key === 'readOnly' || key === 'hidden' || key === 'private') && value !== true) value = undefined;
    if ((key === 'searchable' || key === 'sortable' || key === 'filterable') && value !== false) value = undefined;
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out as FieldConfig;
}

export const toPayload = (fields: DraftField[]): FieldPayload[] =>
  fields.map((f) => ({
    ...(f.id ? { id: f.id } : {}),
    apiId: f.apiId.trim(),
    label: f.label.trim(),
    type: f.type,
    required: f.required,
    unique: FIELD_TYPE_META[f.type].canBeUnique ? f.unique : false,
    localized: FIELD_TYPE_META[f.type].canBeLocalized ? f.localized : false,
    config: cleanConfig(f.type, f.config),
  }));

export const signature = (fields: DraftField[]): string => JSON.stringify(toPayload(fields));

export interface ValidationContext {
  kind: OwnerKind;
  ownerApiId: string;
  schema: SchemaResponse | undefined;
}

/** Checks one field against the same structural rules the API enforces, so most mistakes are caught before saving. */
export function validateDraft(field: DraftField, siblings: DraftField[], ctx: ValidationContext): FieldErrors {
  const errors: FieldErrors = {};
  const cfg = field.config;
  const relevant = configKeysFor(field.type);
  const apiId = field.apiId.trim();
  const others = siblings.filter((s) => s.key !== field.key);

  if (!field.label.trim()) errors.label = 'Give the field a label';
  if (!apiId) errors.apiId = 'An API identifier is required';
  else if (!API_ID_PATTERN.test(apiId)) errors.apiId = 'Use camelCase: start with a lowercase letter, then letters, numbers or underscores';
  else if (RESERVED_FIELD_IDS.includes(apiId)) errors.apiId = `“${apiId}” is reserved for system attributes`;
  else if (others.some((o) => o.apiId.trim() === apiId)) errors.apiId = `“${apiId}” is already used by another field`;

  if (relevant.has('minLength') && cfg.minLength !== undefined && cfg.maxLength !== undefined && cfg.minLength > cfg.maxLength) {
    errors['config.maxLength'] = 'Maximum length must not be less than the minimum';
  }
  if (relevant.has('min') && cfg.min !== undefined && cfg.max !== undefined && cfg.min > cfg.max) errors['config.max'] = 'Maximum must not be less than the minimum';
  if (relevant.has('minItems') && cfg.minItems !== undefined && cfg.maxItems !== undefined && cfg.minItems > cfg.maxItems) {
    errors['config.maxItems'] = 'Maximum items must not be less than the minimum';
  }
  if (relevant.has('pattern') && cfg.pattern) {
    try {
      new RegExp(cfg.pattern);
    } catch {
      errors['config.pattern'] = 'This is not a valid regular expression';
    }
  }
  if (relevant.has('options')) {
    const options = cfg.options ?? [];
    if (options.length === 0) errors['config.options'] = 'Add at least one option';
    else if (options.some((o) => !o.label.trim() || !o.value.trim())) errors['config.options'] = 'Every option needs a label and a value';
    else if (new Set(options.map((o) => o.value.trim())).size !== options.length) errors['config.options'] = 'Option values must be unique';
  }
  if (relevant.has('targetType')) {
    const known = ctx.schema?.types.some((t) => t.apiId === cfg.targetType) || (ctx.kind === 'type' && cfg.targetType === ctx.ownerApiId);
    if (!cfg.targetType) errors['config.targetType'] = 'Choose the content type this field links to';
    else if (ctx.schema && !known) errors['config.targetType'] = `Content type “${cfg.targetType}” no longer exists`;
  }
  if (relevant.has('component')) {
    if (!cfg.component) errors['config.component'] = 'Choose a component';
    else if (ctx.schema && !ctx.schema.components.some((c) => c.apiId === cfg.component)) errors['config.component'] = `Component “${cfg.component}” no longer exists`;
    else if (ctx.kind === 'component' && cfg.component === ctx.ownerApiId) errors['config.component'] = 'A component cannot contain itself';
  }
  if (relevant.has('sourceField') && cfg.sourceField && !others.some((o) => o.apiId.trim() === cfg.sourceField)) {
    errors['config.sourceField'] = `Source field “${cfg.sourceField}” does not exist`;
  }
  for (const key of ['visibleWhen', 'requiredWhen'] as const) {
    const cond = cleanCondition(cfg[key]);
    if (cond && !others.some((o) => o.apiId.trim() === cond.field)) errors[`config.${key}`] = `The condition refers to “${cond.field}”, which is not a field of this schema`;
  }
  return errors;
}

/**
 * Splits API validation details (`fields.3.config.pattern`) into per-field errors,
 * using the order the fields were sent in. Anything not tied to a field is returned as `general`.
 */
export function mapServerErrors(error: ApiError, order: string[]): { byField: Record<string, FieldErrors>; general: string[] } {
  const byField: Record<string, FieldErrors> = {};
  const general: string[] = [];
  const details = Array.isArray(error.details) ? error.details : [];
  for (const detail of details) {
    const match = /^fields\.(\d+)(?:\.(.+))?$/.exec(detail.path ?? '');
    const key = match ? order[Number(match[1])] : undefined;
    if (!match || !key) {
      general.push(detail.message);
      continue;
    }
    const prop = match[2] ?? '_';
    byField[key] = byField[key] ?? {};
    if (!(prop in byField[key])) byField[key][prop] = detail.message;
  }
  if (details.length === 0) general.push(error.message);
  return { byField, general };
}

/** First error stored at `prop` or below it (`config.options` also matches `config.options.0.label`). */
export function errorAt(errors: FieldErrors | undefined, prop: string): string | undefined {
  if (!errors) return undefined;
  if (errors[prop]) return errors[prop];
  const nested = Object.keys(errors).find((k) => k.startsWith(`${prop}.`));
  return nested ? errors[nested] : undefined;
}

export const firstError = (errors: FieldErrors | undefined): string | undefined => (errors ? Object.values(errors)[0] : undefined);

/** Where a component is referenced by fields of content types and other components. */
export function componentUsage(schema: SchemaResponse | undefined, apiId: string): string[] {
  if (!schema) return [];
  const uses = (owner: string, fields: FieldDef[]) =>
    fields.filter((f) => f.config.component === apiId || f.config.allowedComponents?.includes(apiId)).map((f) => `${owner} → ${f.label}`);
  return [...schema.types.flatMap((t) => uses(t.displayName, t.fields)), ...schema.components.filter((c) => c.apiId !== apiId).flatMap((c) => uses(c.displayName, c.fields))];
}

export function singularize(word: string): string {
  if (/ies$/i.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

export const CONDITION_OPERATORS: { value: FieldCondition['operator']; label: string; needsValue: boolean }[] = [
  { value: 'eq', label: 'is', needsValue: true },
  { value: 'neq', label: 'is not', needsValue: true },
  { value: 'notEmpty', label: 'has a value', needsValue: false },
  { value: 'empty', label: 'is empty', needsValue: false },
  { value: 'in', label: 'is one of', needsValue: true },
  { value: 'gt', label: 'is greater than', needsValue: true },
  { value: 'lt', label: 'is less than', needsValue: true },
];

export const WIDTH_OPTIONS: { value: NonNullable<FieldConfig['width']>; label: string }[] = [
  { value: 3, label: '¼' },
  { value: 4, label: '⅓' },
  { value: 6, label: '½' },
  { value: 8, label: '⅔' },
  { value: 9, label: '¾' },
  { value: 12, label: 'Full' },
];

export const CODE_LANGUAGES = ['text', 'javascript', 'typescript', 'jsx', 'tsx', 'json', 'html', 'markdown'];
