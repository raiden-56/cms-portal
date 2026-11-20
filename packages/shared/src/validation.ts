import {
  type FieldDef,
  type FieldType,
  emptyValueFor,
  evaluateCondition,
  isEmptyValue,
} from './fields';
import { isRichTextEmpty, sanitizeRichText } from './richtext';

export interface ValidationIssue {
  /** Dot path into the entry data, e.g. `seo.title` or `gallery.2`. */
  path: string;
  message: string;
  code: string;
}

export interface ValidateOptions {
  /**
   * `draft` accepts incomplete content: values must have the right shape, but required
   * fields and length/range rules are not enforced. `publish` enforces everything.
   */
  mode: 'draft' | 'publish';
  /** Component schemas by apiId, needed to validate component / repeatable / dynamiczone fields. */
  components?: Record<string, FieldDef[]>;
}

export interface ValidationResult {
  /** Normalised data containing only known fields. */
  data: Record<string, unknown>;
  issues: ValidationIssue[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()\-.]{6,24}$/;
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return value.startsWith('/') && !value.startsWith('//');
  }
}

/** Marker object stored in place of a `password` field's plaintext. */
export interface SecretValue {
  $secret: string;
}
export const isSecretValue = (v: unknown): v is SecretValue =>
  !!v && typeof v === 'object' && typeof (v as SecretValue).$secret === 'string';

class Collector {
  issues: ValidationIssue[] = [];
  add(path: string, code: string, message: string) {
    this.issues.push({ path, code, message });
  }
}

function join(base: string, key: string | number): string {
  return base ? `${base}.${key}` : String(key);
}

function validateString(field: FieldDef, value: string, path: string, c: Collector, strict: boolean) {
  const cfg = field.config;
  if (!strict) return;
  if (cfg.minLength !== undefined && value.length < cfg.minLength) {
    c.add(path, 'min_length', `${field.label} must be at least ${cfg.minLength} characters`);
  }
  if (cfg.maxLength !== undefined && value.length > cfg.maxLength) {
    c.add(path, 'max_length', `${field.label} must be at most ${cfg.maxLength} characters`);
  }
  if (cfg.pattern) {
    try {
      if (!new RegExp(cfg.pattern).test(value)) {
        c.add(path, 'pattern', cfg.patternMessage || `${field.label} is not in the expected format`);
      }
    } catch {
      // An invalid pattern is rejected when the schema is saved; never fail content on it.
    }
  }
}

function validateNumber(field: FieldDef, value: number, path: string, c: Collector, strict: boolean) {
  const cfg = field.config;
  if (!strict) return;
  if (cfg.min !== undefined && value < cfg.min) c.add(path, 'min', `${field.label} must be at least ${cfg.min}`);
  if (cfg.max !== undefined && value > cfg.max) c.add(path, 'max', `${field.label} must be at most ${cfg.max}`);
}

function validateItemCount(field: FieldDef, length: number, path: string, c: Collector, strict: boolean) {
  const cfg = field.config;
  if (!strict) return;
  if (cfg.minItems !== undefined && length < cfg.minItems) {
    c.add(path, 'min_items', `${field.label} needs at least ${cfg.minItems} item${cfg.minItems === 1 ? '' : 's'}`);
  }
  if (cfg.maxItems !== undefined && length > cfg.maxItems) {
    c.add(path, 'max_items', `${field.label} allows at most ${cfg.maxItems} item${cfg.maxItems === 1 ? '' : 's'}`);
  }
}

function validateValue(
  field: FieldDef,
  raw: unknown,
  path: string,
  c: Collector,
  opts: ValidateOptions,
  depth: number,
): unknown {
  const strict = opts.mode === 'publish';
  const wrongType = (expected: string) => {
    c.add(path, 'invalid_type', `${field.label} must be ${expected}`);
    return emptyValueFor(field.type);
  };

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'markdown':
    case 'code': {
      if (typeof raw !== 'string') return wrongType('text');
      validateString(field, raw, path, c, strict);
      return raw;
    }
    case 'email': {
      if (typeof raw !== 'string') return wrongType('an email address');
      const v = raw.trim();
      if (!EMAIL.test(v)) c.add(path, 'invalid_email', `${field.label} must be a valid email address`);
      validateString(field, v, path, c, strict);
      return v;
    }
    case 'url': {
      if (typeof raw !== 'string') return wrongType('a URL');
      const v = raw.trim();
      if (!isHttpUrl(v)) c.add(path, 'invalid_url', `${field.label} must be a valid http(s) URL or site-relative path`);
      validateString(field, v, path, c, strict);
      return v;
    }
    case 'phone': {
      if (typeof raw !== 'string') return wrongType('a phone number');
      const v = raw.trim();
      if (!PHONE.test(v)) c.add(path, 'invalid_phone', `${field.label} must be a valid phone number`);
      return v;
    }
    case 'color': {
      if (typeof raw !== 'string') return wrongType('a color');
      if (!COLOR.test(raw)) c.add(path, 'invalid_color', `${field.label} must be a hex color such as #1F6F5C`);
      return raw;
    }
    case 'slug': {
      if (typeof raw !== 'string') return wrongType('a slug');
      if (!SLUG.test(raw)) c.add(path, 'invalid_slug', `${field.label} may only contain lowercase letters, numbers and hyphens`);
      validateString(field, raw, path, c, strict);
      return raw;
    }
    case 'uid': {
      if (typeof raw !== 'string') return wrongType('an identifier');
      if (!UID.test(raw)) c.add(path, 'invalid_uid', `${field.label} may only contain letters, numbers, dots, hyphens and underscores`);
      validateString(field, raw, path, c, strict);
      return raw;
    }
    case 'password': {
      if (isSecretValue(raw)) return raw;
      if (typeof raw !== 'string') return wrongType('text');
      validateString(field, raw, path, c, strict);
      return raw;
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return wrongType('a number');
      if (!Number.isInteger(raw)) c.add(path, 'not_integer', `${field.label} must be a whole number`);
      validateNumber(field, raw, path, c, strict);
      return raw;
    }
    case 'decimal': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return wrongType('a number');
      validateNumber(field, raw, path, c, strict);
      return raw;
    }
    case 'rating': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return wrongType('a number');
      const max = field.config.maxRating ?? 5;
      if (raw < 0 || raw > max) c.add(path, 'out_of_range', `${field.label} must be between 0 and ${max}`);
      return raw;
    }
    case 'boolean':
    case 'checkbox': {
      if (typeof raw !== 'boolean') return wrongType('true or false');
      return raw;
    }
    case 'date': {
      if (typeof raw !== 'string' || !DATE.test(raw) || Number.isNaN(Date.parse(raw))) return wrongType('a date (YYYY-MM-DD)');
      return raw;
    }
    case 'datetime': {
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) return wrongType('an ISO 8601 date-time');
      return new Date(raw).toISOString();
    }
    case 'select':
    case 'radio': {
      if (typeof raw !== 'string') return wrongType('one of the available options');
      const options = field.config.options ?? [];
      if (options.length && !options.some((o) => o.value === raw)) {
        c.add(path, 'invalid_option', `${field.label} must be one of: ${options.map((o) => o.label).join(', ')}`);
      }
      return raw;
    }
    case 'multiselect': {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) return wrongType('a list of options');
      const options = field.config.options ?? [];
      const values = [...new Set(raw as string[])];
      if (options.length) {
        const bad = values.filter((v) => !options.some((o) => o.value === v));
        if (bad.length) c.add(path, 'invalid_option', `${field.label} contains unknown options: ${bad.join(', ')}`);
      }
      validateItemCount(field, values.length, path, c, strict);
      return values;
    }
    case 'json': {
      return raw;
    }
    case 'richtext': {
      const doc = sanitizeRichText(raw);
      if (!doc) return wrongType('a rich-text document');
      return doc;
    }
    case 'image':
    case 'video':
    case 'file':
    case 'relation': {
      if (!isUuid(raw)) return wrongType(field.type === 'relation' ? 'an entry reference' : 'a media asset reference');
      return raw;
    }
    case 'images':
    case 'files':
    case 'relations': {
      if (!Array.isArray(raw) || raw.some((v) => !isUuid(v))) return wrongType('a list of references');
      const values = [...new Set(raw as string[])];
      validateItemCount(field, values.length, path, c, strict);
      return values;
    }
    case 'geolocation': {
      const v = raw as { lat?: unknown; lng?: unknown; address?: unknown };
      if (!v || typeof v !== 'object' || typeof v.lat !== 'number' || typeof v.lng !== 'number') {
        return wrongType('a location with lat and lng');
      }
      if (v.lat < -90 || v.lat > 90) c.add(join(path, 'lat'), 'out_of_range', 'Latitude must be between -90 and 90');
      if (v.lng < -180 || v.lng > 180) c.add(join(path, 'lng'), 'out_of_range', 'Longitude must be between -180 and 180');
      return typeof v.address === 'string' ? { lat: v.lat, lng: v.lng, address: v.address } : { lat: v.lat, lng: v.lng };
    }
    case 'component': {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return wrongType('an object');
      const fields = opts.components?.[field.config.component ?? ''];
      if (!fields) {
        c.add(path, 'unknown_component', `${field.label} references a component that no longer exists`);
        return raw;
      }
      return validateObject(fields, raw as Record<string, unknown>, path, c, opts, depth + 1);
    }
    case 'repeatable': {
      if (!Array.isArray(raw)) return wrongType('a list');
      const fields = opts.components?.[field.config.component ?? ''];
      if (!fields) {
        c.add(path, 'unknown_component', `${field.label} references a component that no longer exists`);
        return raw;
      }
      validateItemCount(field, raw.length, path, c, strict);
      return raw.map((item, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          c.add(join(path, i), 'invalid_type', `${field.label} item ${i + 1} must be an object`);
          return {};
        }
        const obj = item as Record<string, unknown>;
        const cleaned = validateObject(fields, obj, join(path, i), c, opts, depth + 1);
        if (typeof obj._key === 'string') cleaned._key = obj._key;
        return cleaned;
      });
    }
    case 'dynamiczone': {
      if (!Array.isArray(raw)) return wrongType('a list of components');
      validateItemCount(field, raw.length, path, c, strict);
      const allowed = field.config.allowedComponents ?? [];
      return raw.map((item, i) => {
        const itemPath = join(path, i);
        const node = item as { id?: unknown; type?: unknown; props?: unknown };
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
          c.add(itemPath, 'invalid_type', `${field.label} item ${i + 1} must declare a component type`);
          return { id: `item-${i}`, type: 'unknown', props: {} };
        }
        if (allowed.length && !allowed.includes(node.type)) {
          c.add(itemPath, 'component_not_allowed', `Component "${node.type}" is not allowed in ${field.label}`);
        }
        const fields = opts.components?.[node.type];
        if (!fields) {
          c.add(itemPath, 'unknown_component', `Component "${node.type}" does not exist`);
          return { id: String(node.id ?? `item-${i}`), type: node.type, props: {} };
        }
        const props = node.props && typeof node.props === 'object' ? (node.props as Record<string, unknown>) : {};
        return {
          id: typeof node.id === 'string' && node.id ? node.id : `item-${i}`,
          type: node.type,
          props: validateObject(fields, props, join(itemPath, 'props'), c, opts, depth + 1),
        };
      });
    }
    default: {
      const exhaustive: never = field.type;
      return exhaustive;
    }
  }
}

function fieldIsEmpty(type: FieldType, value: unknown): boolean {
  if (type === 'richtext') return isRichTextEmpty(value);
  if (type === 'checkbox' || type === 'boolean') return value === null || value === undefined;
  return isEmptyValue(value);
}

function validateObject(
  fields: FieldDef[],
  input: Record<string, unknown>,
  basePath: string,
  c: Collector,
  opts: ValidateOptions,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (depth > 12) {
    c.add(basePath, 'too_deep', 'Content is nested too deeply');
    return out;
  }
  for (const field of fields) {
    const path = join(basePath, field.apiId);
    const raw = input[field.apiId];
    const visible = evaluateCondition(field.config.visibleWhen, input);
    const empty = raw === undefined || fieldIsEmpty(field.type, raw);

    if (empty) {
      out[field.apiId] = raw === undefined || raw === null || raw === '' ? emptyValueFor(field.type) : raw;
      const required =
        visible && (field.required || (!!field.config.requiredWhen && evaluateCondition(field.config.requiredWhen, input)));
      if (required && opts.mode === 'publish') {
        // A required checkbox must be ticked; a required boolean only needs a value.
        c.add(path, 'required', field.config.requiredMessage || `${field.label} is required`);
      }
      continue;
    }
    if (field.type === 'checkbox' && field.required && raw === false && visible && opts.mode === 'publish') {
      c.add(path, 'required', field.config.requiredMessage || `${field.label} must be checked`);
    }
    out[field.apiId] = validateValue(field, raw, path, c, opts, depth);
  }
  return out;
}

/**
 * Validates and normalises entry data against a field schema.
 * Unknown keys are dropped, so stored content never drifts from its model.
 */
export function validateEntryData(
  fields: FieldDef[],
  input: unknown,
  opts: ValidateOptions,
): ValidationResult {
  const c = new Collector();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    c.add('', 'invalid_type', 'Entry data must be an object');
    return { data: {}, issues: c.issues };
  }
  const data = validateObject(fields, input as Record<string, unknown>, '', c, opts, 0);
  return { data, issues: c.issues };
}

/** Collects every referenced id of the given kinds from entry data, walking into components. */
export function collectReferences(
  fields: FieldDef[],
  data: Record<string, unknown>,
  components: Record<string, FieldDef[]> = {},
): { media: string[]; relations: { field: string; target: string }[] } {
  const media = new Set<string>();
  const relations: { field: string; target: string }[] = [];

  const walk = (defs: FieldDef[], value: Record<string, unknown>, prefix: string) => {
    for (const f of defs) {
      const v = value?.[f.apiId];
      if (v === null || v === undefined) continue;
      const key = prefix ? `${prefix}.${f.apiId}` : f.apiId;
      switch (f.type) {
        case 'image':
        case 'video':
        case 'file':
          if (isUuid(v)) media.add(v);
          break;
        case 'images':
        case 'files':
          if (Array.isArray(v)) v.filter(isUuid).forEach((id) => media.add(id));
          break;
        case 'relation':
          if (isUuid(v)) relations.push({ field: key, target: v });
          break;
        case 'relations':
          if (Array.isArray(v)) v.filter(isUuid).forEach((id) => relations.push({ field: key, target: id }));
          break;
        case 'component': {
          const sub = components[f.config.component ?? ''];
          if (sub && typeof v === 'object') walk(sub, v as Record<string, unknown>, key);
          break;
        }
        case 'repeatable': {
          const sub = components[f.config.component ?? ''];
          if (sub && Array.isArray(v)) v.forEach((item) => walk(sub, item as Record<string, unknown>, key));
          break;
        }
        case 'dynamiczone': {
          if (Array.isArray(v)) {
            v.forEach((item) => {
              const node = item as { type?: string; props?: Record<string, unknown> };
              const sub = node?.type ? components[node.type] : undefined;
              if (sub && node.props) walk(sub, node.props, key);
            });
          }
          break;
        }
      }
    }
  };
  walk(fields, data, '');
  return { media: [...media], relations };
}
