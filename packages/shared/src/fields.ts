/**
 * Field type catalogue.
 *
 * Every content type, component and page block is described with the same `FieldDef`
 * shape. The API validates and stores against it, the admin renders forms from it,
 * and the delivery layer (REST, GraphQL, OpenAPI) derives its contracts from it.
 */

export const FIELD_TYPES = [
  'text',
  'textarea',
  'richtext',
  'markdown',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'select',
  'multiselect',
  'radio',
  'checkbox',
  'email',
  'url',
  'phone',
  'password',
  'color',
  'json',
  'code',
  'image',
  'images',
  'video',
  'file',
  'files',
  'relation',
  'relations',
  'component',
  'repeatable',
  'dynamiczone',
  'geolocation',
  'slug',
  'uid',
  'rating',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type ConditionOperator = 'eq' | 'neq' | 'empty' | 'notEmpty' | 'in' | 'gt' | 'lt';

export interface FieldCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldConfig {
  // Presentation
  placeholder?: string;
  helpText?: string;
  /** Column span on a 12-column form grid. */
  width?: 3 | 4 | 6 | 8 | 9 | 12;
  group?: string;
  tab?: string;
  readOnly?: boolean;
  hidden?: boolean;
  /** Excluded from delivery API responses (always true for `password`). */
  private?: boolean;

  // Behaviour
  defaultValue?: unknown;
  searchable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  /** Field is only shown (and only validated) when the condition holds. */
  visibleWhen?: FieldCondition;
  /** Field becomes required when the condition holds. */
  requiredWhen?: FieldCondition;

  // Text
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
  requiredMessage?: string;

  // Numbers
  min?: number;
  max?: number;
  step?: number;

  // Choice
  options?: FieldOption[];

  // Media
  allowedExtensions?: string[];
  maxFileSize?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;

  // Relations
  /** apiId of the content type this relation points at. */
  targetType?: string;

  // Composition
  /** apiId of the component used by `component` / `repeatable`. */
  component?: string;
  /** apiIds permitted inside a `dynamiczone`. Empty = any component. */
  allowedComponents?: string[];
  minItems?: number;
  maxItems?: number;

  // Slug / UID
  sourceField?: string;

  // Code
  language?: string;

  // Rating
  maxRating?: number;
}

export interface FieldDef {
  id?: string;
  apiId: string;
  label: string;
  type: FieldType;
  required: boolean;
  unique: boolean;
  localized: boolean;
  config: FieldConfig;
  position: number;
}

export type FieldCategory = 'text' | 'number' | 'choice' | 'date' | 'media' | 'relation' | 'structure' | 'special';

/** How a field's value behaves in queries. Drives SQL casts, GraphQL types and filter operators. */
export type FieldScalar = 'string' | 'number' | 'boolean' | 'date' | 'stringArray' | 'object' | 'none';

export interface FieldTypeMeta {
  type: FieldType;
  label: string;
  description: string;
  category: FieldCategory;
  /** Icon key resolved by the admin UI. */
  icon: string;
  scalar: FieldScalar;
  canBeUnique: boolean;
  canBeLocalized: boolean;
  defaultConfig?: FieldConfig;
}

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  text: { type: 'text', label: 'Short text', description: 'Titles, names, single-line values', category: 'text', icon: 'text', scalar: 'string', canBeUnique: true, canBeLocalized: true, defaultConfig: { maxLength: 255 } },
  textarea: { type: 'textarea', label: 'Long text', description: 'Multi-line plain text', category: 'text', icon: 'textarea', scalar: 'string', canBeUnique: false, canBeLocalized: true },
  richtext: { type: 'richtext', label: 'Rich text', description: 'Structured formatted content', category: 'text', icon: 'richtext', scalar: 'object', canBeUnique: false, canBeLocalized: true },
  markdown: { type: 'markdown', label: 'Markdown', description: 'Markdown with live preview', category: 'text', icon: 'markdown', scalar: 'string', canBeUnique: false, canBeLocalized: true },
  integer: { type: 'integer', label: 'Number', description: 'Whole numbers', category: 'number', icon: 'number', scalar: 'number', canBeUnique: true, canBeLocalized: false },
  decimal: { type: 'decimal', label: 'Decimal', description: 'Prices, measurements, ratios', category: 'number', icon: 'decimal', scalar: 'number', canBeUnique: true, canBeLocalized: false },
  boolean: { type: 'boolean', label: 'Boolean', description: 'On / off switch', category: 'choice', icon: 'boolean', scalar: 'boolean', canBeUnique: false, canBeLocalized: false },
  date: { type: 'date', label: 'Date', description: 'Calendar date', category: 'date', icon: 'date', scalar: 'date', canBeUnique: false, canBeLocalized: false },
  datetime: { type: 'datetime', label: 'Date and time', description: 'Timestamp with timezone', category: 'date', icon: 'datetime', scalar: 'date', canBeUnique: false, canBeLocalized: false },
  select: { type: 'select', label: 'Single select', description: 'One value from a list', category: 'choice', icon: 'select', scalar: 'string', canBeUnique: false, canBeLocalized: false, defaultConfig: { options: [] } },
  multiselect: { type: 'multiselect', label: 'Multi-select', description: 'Several values from a list', category: 'choice', icon: 'multiselect', scalar: 'stringArray', canBeUnique: false, canBeLocalized: false, defaultConfig: { options: [] } },
  radio: { type: 'radio', label: 'Radio', description: 'One value, shown as radio buttons', category: 'choice', icon: 'radio', scalar: 'string', canBeUnique: false, canBeLocalized: false, defaultConfig: { options: [] } },
  checkbox: { type: 'checkbox', label: 'Checkbox', description: 'Single confirmation checkbox', category: 'choice', icon: 'checkbox', scalar: 'boolean', canBeUnique: false, canBeLocalized: false },
  email: { type: 'email', label: 'Email', description: 'Validated email address', category: 'special', icon: 'email', scalar: 'string', canBeUnique: true, canBeLocalized: false },
  url: { type: 'url', label: 'URL', description: 'Validated web address', category: 'special', icon: 'url', scalar: 'string', canBeUnique: true, canBeLocalized: true },
  phone: { type: 'phone', label: 'Phone number', description: 'International phone number', category: 'special', icon: 'phone', scalar: 'string', canBeUnique: true, canBeLocalized: false },
  password: { type: 'password', label: 'Password / secret', description: 'Hashed at rest, never delivered', category: 'special', icon: 'password', scalar: 'none', canBeUnique: false, canBeLocalized: false, defaultConfig: { private: true } },
  color: { type: 'color', label: 'Color', description: 'Hex color value', category: 'special', icon: 'color', scalar: 'string', canBeUnique: false, canBeLocalized: false },
  json: { type: 'json', label: 'JSON', description: 'Arbitrary structured data', category: 'structure', icon: 'json', scalar: 'object', canBeUnique: false, canBeLocalized: true },
  code: { type: 'code', label: 'Code', description: 'Source code with syntax highlighting', category: 'structure', icon: 'code', scalar: 'string', canBeUnique: false, canBeLocalized: false, defaultConfig: { language: 'javascript' } },
  image: { type: 'image', label: 'Image', description: 'One image from the media library', category: 'media', icon: 'image', scalar: 'string', canBeUnique: false, canBeLocalized: true },
  images: { type: 'images', label: 'Multiple images', description: 'An ordered image gallery', category: 'media', icon: 'images', scalar: 'stringArray', canBeUnique: false, canBeLocalized: true },
  video: { type: 'video', label: 'Video', description: 'One video from the media library', category: 'media', icon: 'video', scalar: 'string', canBeUnique: false, canBeLocalized: true },
  file: { type: 'file', label: 'File', description: 'One document or download', category: 'media', icon: 'file', scalar: 'string', canBeUnique: false, canBeLocalized: true },
  files: { type: 'files', label: 'Multiple files', description: 'Several documents', category: 'media', icon: 'files', scalar: 'stringArray', canBeUnique: false, canBeLocalized: true },
  relation: { type: 'relation', label: 'Single relationship', description: 'Link to one entry', category: 'relation', icon: 'relation', scalar: 'string', canBeUnique: false, canBeLocalized: false },
  relations: { type: 'relations', label: 'Multiple relationships', description: 'Link to many entries', category: 'relation', icon: 'relations', scalar: 'stringArray', canBeUnique: false, canBeLocalized: false },
  component: { type: 'component', label: 'Component', description: 'A reusable group of fields', category: 'structure', icon: 'component', scalar: 'object', canBeUnique: false, canBeLocalized: true },
  repeatable: { type: 'repeatable', label: 'Repeatable component', description: 'A list of the same component', category: 'structure', icon: 'repeatable', scalar: 'object', canBeUnique: false, canBeLocalized: true },
  dynamiczone: { type: 'dynamiczone', label: 'Dynamic zone', description: 'A flexible list of mixed components', category: 'structure', icon: 'dynamiczone', scalar: 'object', canBeUnique: false, canBeLocalized: true },
  geolocation: { type: 'geolocation', label: 'Geolocation', description: 'Latitude and longitude', category: 'special', icon: 'geolocation', scalar: 'object', canBeUnique: false, canBeLocalized: false },
  slug: { type: 'slug', label: 'Slug', description: 'URL-safe identifier generated from another field', category: 'special', icon: 'slug', scalar: 'string', canBeUnique: true, canBeLocalized: true },
  uid: { type: 'uid', label: 'UID', description: 'Unique machine identifier', category: 'special', icon: 'uid', scalar: 'string', canBeUnique: true, canBeLocalized: false },
  rating: { type: 'rating', label: 'Rating', description: 'Star rating', category: 'number', icon: 'rating', scalar: 'number', canBeUnique: false, canBeLocalized: false, defaultConfig: { maxRating: 5 } },
};

export const FIELD_CATEGORY_LABELS: Record<FieldCategory, string> = {
  text: 'Text',
  number: 'Numbers',
  choice: 'Choice',
  date: 'Date & time',
  media: 'Media',
  relation: 'Relationships',
  structure: 'Structure',
  special: 'Specialised',
};

export const MEDIA_FIELD_TYPES: FieldType[] = ['image', 'images', 'video', 'file', 'files'];
export const RELATION_FIELD_TYPES: FieldType[] = ['relation', 'relations'];
export const TEXT_SEARCH_FIELD_TYPES: FieldType[] = ['text', 'textarea', 'markdown', 'email', 'url', 'slug', 'uid', 'phone'];

export const isMediaField = (t: FieldType) => MEDIA_FIELD_TYPES.includes(t);
export const isRelationField = (t: FieldType) => RELATION_FIELD_TYPES.includes(t);
export const isMultiValueField = (t: FieldType) => ['images', 'files', 'relations', 'multiselect'].includes(t);

/** Identifiers reserved for system attributes on every entry. */
export const RESERVED_FIELD_IDS = [
  'id',
  'documentId',
  'locale',
  'status',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'type',
  'data',
  'meta',
];

export const API_ID_PATTERN = /^[a-z][a-zA-Z0-9_]{0,62}$/;
export const TYPE_API_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

/** Route segments under /api/v1 that a content type may not shadow. */
export const RESERVED_TYPE_IDS = ['graphql', 'media', 'openapi.json', 'content-types', 'preview', 'events', 'health', 'navigation-menu'];

/**
 * Whether changing a field from one type to another can keep the stored values.
 * Anything not listed is treated as destructive and requires the field to be empty or an explicit reset.
 */
const COMPATIBLE_CHANGES: Partial<Record<FieldType, FieldType[]>> = {
  text: ['textarea', 'markdown', 'slug', 'uid', 'email', 'url', 'phone', 'select', 'radio', 'code'],
  textarea: ['markdown', 'code'],
  markdown: ['textarea', 'code'],
  integer: ['decimal', 'rating'],
  rating: ['integer', 'decimal'],
  select: ['radio', 'text'],
  radio: ['select', 'text'],
  boolean: ['checkbox'],
  checkbox: ['boolean'],
  slug: ['text', 'uid'],
  uid: ['text'],
  email: ['text'],
  url: ['text'],
  phone: ['text'],
  image: ['file'],
  images: ['files'],
  video: ['file'],
  code: ['textarea', 'markdown'],
  date: ['datetime'],
};

export function isCompatibleTypeChange(from: FieldType, to: FieldType): boolean {
  if (from === to) return true;
  return COMPATIBLE_CHANGES[from]?.includes(to) ?? false;
}

export function emptyValueFor(type: FieldType): unknown {
  switch (type) {
    case 'boolean':
    case 'checkbox':
      return false;
    case 'multiselect':
    case 'images':
    case 'files':
    case 'relations':
    case 'repeatable':
    case 'dynamiczone':
      return [];
    default:
      return null;
  }
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function evaluateCondition(condition: FieldCondition | undefined, data: Record<string, unknown>): boolean {
  if (!condition || !condition.field) return true;
  const actual = data[condition.field];
  switch (condition.operator) {
    case 'eq':
      return String(actual ?? '') === String(condition.value ?? '');
    case 'neq':
      return String(actual ?? '') !== String(condition.value ?? '');
    case 'empty':
      return isEmptyValue(actual) || actual === false;
    case 'notEmpty':
      return !(isEmptyValue(actual) || actual === false);
    case 'in':
      return Array.isArray(condition.value) ? condition.value.map(String).includes(String(actual)) : false;
    case 'gt':
      return Number(actual) > Number(condition.value);
    case 'lt':
      return Number(actual) < Number(condition.value);
    default:
      return true;
  }
}

/** Builds the initial value object for a new entry or component instance. */
export function buildDefaults(fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.apiId] = f.config.defaultValue !== undefined ? structuredClone(f.config.defaultValue) : emptyValueFor(f.type);
  }
  return out;
}
