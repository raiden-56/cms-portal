/** Content model: content types, components, field changes with their migration plan. */
import { z } from 'zod';
import {
  API_ID_PATTERN,
  BUILTIN_BLOCKS,
  BUILTIN_COMPONENTS,
  FIELD_TYPES,
  FIELD_TYPE_META,
  type FieldDef,
  type FieldType,
  RESERVED_FIELD_IDS,
  RESERVED_TYPE_IDS,
  TYPE_API_ID_PATTERN,
  isCompatibleTypeChange,
  newId,
  sameJson,
} from '@meridian/shared';
import { type Ctx, type EnvSchema, audit, emitEvent, envScope, guest, isPageType, loadSchema, userNames } from '../context';
import { type DbComponent, type DbEntry, type DbType, type Json, db, nowIso } from '../db';
import { type ErrorDetail, badRequest, conflict, created, forbidden, noContent, notFound, paginate, parse, unprocessable } from '../http';
import type { Router } from '../router';

// ─── Input shapes (same rules as the API) ────────────────────────────────────

const condition = z.object({ field: z.string().min(1).max(63), operator: z.enum(['eq', 'neq', 'empty', 'notEmpty', 'in', 'gt', 'lt']), value: z.unknown().optional() });

const fieldConfig = z
  .object({
    placeholder: z.string().max(200),
    helpText: z.string().max(500),
    width: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(9), z.literal(12)]),
    group: z.string().max(60),
    tab: z.string().max(60),
    readOnly: z.boolean(),
    hidden: z.boolean(),
    private: z.boolean(),
    defaultValue: z.unknown(),
    searchable: z.boolean(),
    sortable: z.boolean(),
    filterable: z.boolean(),
    visibleWhen: condition,
    requiredWhen: condition,
    minLength: z.number().int().min(0).max(1_000_000),
    maxLength: z.number().int().min(1).max(1_000_000),
    pattern: z.string().max(500),
    patternMessage: z.string().max(200),
    requiredMessage: z.string().max(200),
    min: z.number(),
    max: z.number(),
    step: z.number().positive(),
    options: z.array(z.object({ label: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(120) })).max(300),
    allowedExtensions: z.array(z.string().regex(/^[a-z0-9]{1,10}$/)).max(40),
    maxFileSize: z.number().int().positive(),
    minWidth: z.number().int().positive(),
    minHeight: z.number().int().positive(),
    maxWidth: z.number().int().positive(),
    maxHeight: z.number().int().positive(),
    targetType: z.string().max(63),
    component: z.string().max(63),
    allowedComponents: z.array(z.string().max(63)).max(100),
    minItems: z.number().int().min(0),
    maxItems: z.number().int().min(1),
    sourceField: z.string().max(63),
    language: z.string().max(30),
    maxRating: z.number().int().min(1).max(10),
  })
  .partial()
  .strict();

const fieldInput = z.object({
  id: z.string().uuid().optional(),
  apiId: z.string().regex(API_ID_PATTERN, 'Use camelCase: start with a lowercase letter, then letters, numbers or underscores'),
  label: z.string().trim().min(1, 'Label is required').max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  localized: z.boolean().default(false),
  config: fieldConfig.default({}),
});
type FieldInput = z.infer<typeof fieldInput>;

const fieldsBody = z.object({
  fields: z.array(fieldInput).max(200, 'A schema can have at most 200 fields'),
  /** Acknowledges changes that discard stored values (field removal, incompatible type change). */
  confirmDestructive: z.boolean().default(false),
});

const apiId = z
  .string()
  .regex(TYPE_API_ID_PATTERN, 'Use lowercase letters, numbers and hyphens, starting with a letter')
  .refine((v) => !RESERVED_TYPE_IDS.includes(v), 'That identifier is reserved');

const typeOptions = z.object({ localized: z.boolean(), requireApproval: z.boolean(), titleField: z.string().max(63), previewUrl: z.string().max(500) }).partial().strict();

const typeMeta = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  singularName: z.string().trim().min(1).max(80),
  pluralName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  icon: z.string().max(40).default('document'),
  options: typeOptions.default({}),
});

const componentMeta = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().min(1).max(60).default('General'),
  icon: z.string().max(40).default('component'),
  isBlock: z.boolean().default(false),
});

// ─── Field validation and planning ───────────────────────────────────────────

/** Structural validation of a proposed field list. Issues are keyed by `fields.<index>.<prop>`. */
function validateFieldSet(fields: FieldInput[], ctx: { schema: EnvSchema; ownerKind: 'type' | 'component'; ownerApiId: string }): ErrorDetail[] {
  const issues: ErrorDetail[] = [];
  const seen = new Map<string, number>();
  const add = (i: number, prop: string, message: string) => issues.push({ path: `fields.${i}.${prop}`, message });

  fields.forEach((f, i) => {
    const meta = FIELD_TYPE_META[f.type];
    const cfg = f.config;
    if (RESERVED_FIELD_IDS.includes(f.apiId)) add(i, 'apiId', `"${f.apiId}" is reserved for system attributes`);
    if (seen.has(f.apiId)) add(i, 'apiId', `"${f.apiId}" is used by more than one field`);
    seen.set(f.apiId, i);
    if (f.unique && !meta.canBeUnique) add(i, 'unique', `${meta.label} fields cannot be unique`);
    if (f.unique && ctx.ownerKind === 'component') add(i, 'unique', 'Fields inside components cannot be unique');
    if (cfg.minLength !== undefined && cfg.maxLength !== undefined && cfg.minLength > cfg.maxLength) add(i, 'config.maxLength', 'Maximum length must not be less than the minimum');
    if (cfg.min !== undefined && cfg.max !== undefined && cfg.min > cfg.max) add(i, 'config.max', 'Maximum must not be less than the minimum');
    if (cfg.minItems !== undefined && cfg.maxItems !== undefined && cfg.minItems > cfg.maxItems) add(i, 'config.maxItems', 'Maximum items must not be less than the minimum');
    if (cfg.pattern) {
      try {
        new RegExp(cfg.pattern);
      } catch {
        add(i, 'config.pattern', 'Pattern is not a valid regular expression');
      }
    }
    if (['select', 'radio', 'multiselect'].includes(f.type)) {
      const options = cfg.options ?? [];
      if (options.length === 0) add(i, 'config.options', 'Add at least one option');
      if (new Set(options.map((o) => o.value)).size !== options.length) add(i, 'config.options', 'Option values must be unique');
    }
    if (f.type === 'relation' || f.type === 'relations') {
      if (!cfg.targetType) add(i, 'config.targetType', 'Choose the content type this field links to');
      else if (!ctx.schema.typeByApiId.has(cfg.targetType) && !(ctx.ownerKind === 'type' && cfg.targetType === ctx.ownerApiId)) {
        add(i, 'config.targetType', `Content type "${cfg.targetType}" does not exist`);
      }
    }
    if (f.type === 'component' || f.type === 'repeatable') {
      if (!cfg.component) add(i, 'config.component', 'Choose a component');
      else if (!ctx.schema.components.some((c) => c.apiId === cfg.component)) add(i, 'config.component', `Component "${cfg.component}" does not exist`);
    }
    if (f.type === 'dynamiczone') {
      for (const id of cfg.allowedComponents ?? []) {
        if (!ctx.schema.components.some((c) => c.apiId === id)) add(i, 'config.allowedComponents', `Component "${id}" does not exist`);
      }
    }
  });

  fields.forEach((f, i) => {
    const source = f.config.sourceField;
    if (f.type === 'slug' && source && !seen.has(source)) add(i, 'config.sourceField', `Source field "${source}" does not exist`);
    for (const key of ['visibleWhen', 'requiredWhen'] as const) {
      const cond = f.config[key];
      if (cond && (!seen.has(cond.field) || cond.field === f.apiId)) add(i, `config.${key}`, `Condition refers to unknown field "${cond.field}"`);
    }
  });

  // A component must not (transitively) contain itself, or content could nest forever.
  if (ctx.ownerKind === 'component') {
    const edges = (defs: { type: FieldType; config: FieldDef['config'] }[]) =>
      defs.flatMap((d) => (d.type === 'component' || d.type === 'repeatable' ? (d.config.component ? [d.config.component] : []) : d.type === 'dynamiczone' ? (d.config.allowedComponents ?? []) : []));
    const graph = new Map<string, string[]>(ctx.schema.components.map((c) => [c.apiId, edges(c.fields)]));
    graph.set(ctx.ownerApiId, edges(fields as FieldDef[]));
    const stack = [...(graph.get(ctx.ownerApiId) ?? [])];
    const visited = new Set<string>();
    while (stack.length) {
      const next = stack.pop() as string;
      if (next === ctx.ownerApiId) {
        issues.push({ path: 'fields', message: 'A component cannot contain itself, directly or through other components' });
        break;
      }
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(...(graph.get(next) ?? []));
    }
  }
  return issues;
}

interface FieldChange {
  kind: 'added' | 'removed' | 'renamed' | 'type_changed' | 'updated' | 'reordered';
  apiId: string;
  label: string;
  from?: string;
  to?: string;
  affectedEntries?: number;
  destructive?: boolean;
  note?: string;
}

interface SchemaPlan {
  changes: FieldChange[];
  blockers: ErrorDetail[];
  warnings: string[];
  /** True when applying would discard stored values and needs `confirmDestructive`. */
  requiresConfirmation: boolean;
}

/** A value as PostgreSQL's `data->>'key'` would render it: null for a missing key, text otherwise. */
const asText = (value: unknown): string | null => (value === null || value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value));
const entriesOf = (typeId: string) => db.entries.filter((e) => e.contentTypeId === typeId);
const countWithValue = (typeId: string, key: string) => entriesOf(typeId).filter((e) => !['', '[]', '{}'].includes(asText(e.data[key]) ?? '')).length;
const countMissing = (typeId: string, key: string) => entriesOf(typeId).filter((e) => !e.deletedAt && ['', '[]'].includes(asText(e.data[key]) ?? '')).length;

function findDuplicates(typeId: string, key: string): string[] {
  const seen = new Map<string, number>();
  for (const e of entriesOf(typeId)) {
    const value = asText(e.data[key]);
    if (e.deletedAt || !value) continue;
    seen.set(`${e.locale}\u0000${value}`, (seen.get(`${e.locale}\u0000${value}`) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k.split('\u0000')[1]).slice(0, 5);
}

/** What a new field list means for a content type and its stored entries, without changing anything. */
function planFieldChanges(current: FieldDef[], next: FieldInput[], typeId: string | null): SchemaPlan {
  const plan: SchemaPlan = { changes: [], blockers: [], warnings: [], requiresConfirmation: false };
  const currentById = new Map(current.map((f) => [f.id as string, f]));
  const currentByApiId = new Map(current.map((f) => [f.apiId, f]));
  const matched = new Set<string>();
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

  next.forEach((field, index) => {
    // Match by id (allows rename); fall back to apiId for clients that do not send ids.
    const previous = (field.id && currentById.get(field.id)) || (!field.id ? currentByApiId.get(field.apiId) : undefined);
    if (field.id && !previous) {
      plan.blockers.push({ path: `fields.${index}.id`, message: `Field "${field.apiId}" refers to an id that does not belong to this schema` });
      return;
    }
    if (!previous) {
      plan.changes.push({ kind: 'added', apiId: field.apiId, label: field.label });
      if (field.required && typeId && field.config.defaultValue === undefined) {
        const missing = countMissing(typeId, field.apiId);
        if (missing > 0) plan.warnings.push(`"${field.label}" is required but ${missing} existing entr${plural(missing, 'y has', 'ies have')} no value. They must be completed before their next publish.`);
      }
      return;
    }
    matched.add(previous.id as string);
    const affected = typeId ? countWithValue(typeId, previous.apiId) : 0;

    if (previous.apiId !== field.apiId) {
      if (!typeId) {
        plan.blockers.push({ path: `fields.${index}.apiId`, message: `The API identifier of a component field cannot be changed ("${previous.apiId}"). Add a new field instead.` });
      } else {
        plan.changes.push({ kind: 'renamed', apiId: field.apiId, label: field.label, from: previous.apiId, to: field.apiId, affectedEntries: affected });
      }
    }
    if (previous.type !== field.type) {
      const compatible = isCompatibleTypeChange(previous.type, field.type);
      if (!compatible && !typeId) {
        plan.blockers.push({
          path: `fields.${index}.type`,
          message: `"${previous.label}" cannot change from ${FIELD_TYPE_META[previous.type].label} to ${FIELD_TYPE_META[field.type].label} inside a component. Add a new field instead.`,
        });
      } else {
        const destructive = !compatible && affected > 0;
        plan.changes.push({
          kind: 'type_changed',
          apiId: field.apiId,
          label: field.label,
          from: previous.type,
          to: field.type,
          affectedEntries: affected,
          destructive,
          note: compatible ? 'Existing values are kept' : 'Existing values cannot be converted and will be cleared',
        });
        if (destructive) plan.requiresConfirmation = true;
      }
    }
    if (!previous.unique && field.unique && typeId) {
      const duplicates = findDuplicates(typeId, previous.apiId);
      if (duplicates.length) {
        plan.blockers.push({ path: `fields.${index}.unique`, message: `"${field.label}" cannot be made unique: existing entries share the values ${duplicates.map((d) => `"${d}"`).join(', ')}` });
      }
    }
    if (!previous.required && field.required && typeId) {
      const missing = countMissing(typeId, previous.apiId);
      if (missing > 0) {
        plan.warnings.push(
          field.config.defaultValue !== undefined
            ? `"${field.label}" is now required: ${missing} entr${plural(missing, 'y', 'ies')} without a value will receive the default.`
            : `"${field.label}" is now required but ${missing} entr${plural(missing, 'y has', 'ies have')} no value. They must be completed before their next publish.`,
        );
      }
    }
    const metaChanged = previous.label !== field.label || previous.required !== field.required || previous.unique !== field.unique || previous.localized !== field.localized || !sameJson(previous.config, field.config);
    if (metaChanged && previous.apiId === field.apiId && previous.type === field.type) plan.changes.push({ kind: 'updated', apiId: field.apiId, label: field.label });
  });

  for (const previous of current) {
    if (matched.has(previous.id as string)) continue;
    const affected = typeId ? countWithValue(typeId, previous.apiId) : 0;
    plan.changes.push({
      kind: 'removed',
      apiId: previous.apiId,
      label: previous.label,
      affectedEntries: affected,
      destructive: affected > 0,
      note: affected > 0 ? 'Values are removed from current content; earlier versions keep them' : undefined,
    });
    if (affected > 0) plan.requiresConfirmation = true;
  }

  const keptOrder = current.filter((f) => matched.has(f.id as string)).map((f) => f.id);
  const nextOrder = next.map((f) => f.id ?? currentByApiId.get(f.apiId)?.id).filter((id) => id && matched.has(id));
  if (plan.changes.length === 0 && JSON.stringify(keptOrder) !== JSON.stringify(nextOrder)) plan.changes.push({ kind: 'reordered', apiId: '*', label: 'Field order' });
  return plan;
}

/** Applies a planned field list: migrates stored entry data (renames, removals, type resets, back-fills) and rewrites the fields. */
function applyFieldChanges(owner: DbType | DbComponent, isType: boolean, next: FieldInput[], plan: SchemaPlan): void {
  const current = owner.fields;
  if (isType) {
    const rows = entriesOf(owner.id);
    const each = (work: (data: Json) => void) => {
      for (const row of rows) {
        work(row.data);
        if (row.publishedData) work(row.publishedData);
      }
    };
    for (const change of plan.changes) if (change.kind === 'removed') each((data) => delete data[change.apiId]);
    // Renames go through a snapshot of the old values so swaps (a→b, b→a) cannot collide.
    const renames = plan.changes.filter((c) => c.kind === 'renamed') as (FieldChange & { from: string; to: string })[];
    if (renames.length) {
      each((data) => {
        const moved = renames.filter((r) => r.from in data).map((r) => ({ to: r.to, value: data[r.from], from: r.from }));
        for (const m of moved) delete data[m.from];
        for (const m of moved) data[m.to] = m.value;
      });
    }
    for (const change of plan.changes) if (change.kind === 'type_changed' && change.destructive) each((data) => delete data[change.apiId]);
    // Newly required fields with a default: fill the gaps so existing content stays publishable.
    const currentById = new Map(current.map((f) => [f.id as string, f]));
    for (const field of next) {
      const previous = field.id ? currentById.get(field.id) : undefined;
      const becameRequired = field.required && (!previous || !previous.required);
      if (!becameRequired || field.config.defaultValue === undefined || field.config.defaultValue === null) continue;
      for (const row of rows) if (['', '[]'].includes(asText(row.data[field.apiId]) ?? '')) row.data[field.apiId] = structuredClone(field.config.defaultValue);
    }
  }
  const currentByApiId = new Map(current.map((f) => [f.apiId, f]));
  owner.fields = next.map((input, position) => ({
    id: input.id ?? currentByApiId.get(input.apiId)?.id ?? newId(),
    apiId: input.apiId,
    label: input.label,
    type: input.type,
    required: input.required,
    unique: isType ? input.unique : false,
    localized: input.localized,
    config: input.config as FieldDef['config'],
    position,
  }));
  owner.schemaVersion += 1;
  owner.updatedAt = nowIso();
}

const toFields = (inputs: FieldInput[], allowUnique: boolean): FieldDef[] =>
  inputs.map((f, position) => ({ id: newId(), apiId: f.apiId, label: f.label, type: f.type, required: f.required, unique: allowUnique ? f.unique : false, localized: f.localized, config: f.config as FieldDef['config'], position }));

const fieldList = (fields: { apiId: string; type: string }[]) => fields.map((f) => `${f.apiId}:${f.type}`);

// ─── Routes ──────────────────────────────────────────────────────────────────

function findType(c: Ctx, schema: EnvSchema): DbType {
  const type = schema.typeById.get(c.params.typeId) ?? schema.typeByApiId.get(c.params.typeId);
  if (!type) throw notFound('Content type');
  return type;
}

function findComponent(c: Ctx, schema: EnvSchema): DbComponent {
  const component = schema.components.find((x) => x.id === c.params.componentId || x.apiId === c.params.componentId);
  if (!component) throw notFound('Component');
  return component;
}

function componentUsage(schema: EnvSchema, componentApiId: string): string[] {
  const uses = (fields: FieldDef[]) => fields.filter((f) => f.config.component === componentApiId || f.config.allowedComponents?.includes(componentApiId));
  return [
    ...schema.types.flatMap((t) => uses(t.fields).map((f) => `${t.displayName} → ${f.label}`)),
    ...schema.components.filter((x) => x.apiId !== componentApiId).flatMap((x) => uses(x.fields).map((f) => `${x.displayName} → ${f.label}`)),
  ];
}

const liveCount = (typeId: string) => db.entries.filter((e) => e.contentTypeId === typeId && !e.deletedAt).length;
const withCount = (type: DbType) => ({ ...type, entryCount: liveCount(type.id) });

function schemaChanged(c: Ctx, summary: string, target: { kind: string; id: string; apiId: string; version: number }, diff: unknown) {
  const { environment, project } = envScope(c);
  db.schemaChanges.push({ id: newId(), environmentId: environment.id, targetKind: target.kind, targetId: target.id, targetApiId: target.apiId, version: target.version, summary, diff, userId: guest().id, createdAt: nowIso() });
  emitEvent({ environment, project }, { event: 'schema.updated', contentType: target.apiId });
}

/** Every environment owns a system `pages` content type that backs the page builder. */
export function createPageType(environmentId: string): DbType {
  const fields: Pick<FieldDef, 'apiId' | 'label' | 'type' | 'required' | 'config'>[] = [
    { apiId: 'title', label: 'Title', type: 'text', required: true, config: { maxLength: 200 } },
    { apiId: 'slug', label: 'Slug', type: 'slug', required: false, config: { sourceField: 'title', helpText: 'Leave empty for the home page' } },
    { apiId: 'description', label: 'Description', type: 'textarea', required: false, config: { maxLength: 500 } },
    { apiId: 'template', label: 'Template', type: 'text', required: false, config: {} },
    { apiId: 'category', label: 'Category', type: 'text', required: false, config: {} },
    { apiId: 'seo', label: 'SEO', type: 'json', required: false, config: {} },
    { apiId: 'blocks', label: 'Blocks', type: 'json', required: false, config: {} },
  ];
  const at = nowIso();
  const type: DbType = {
    id: newId(),
    environmentId,
    apiId: 'pages',
    displayName: 'Pages',
    singularName: 'Page',
    pluralName: 'Pages',
    description: 'Website pages composed in the page builder',
    kind: 'COLLECTION',
    icon: 'page',
    isSystem: true,
    options: { localized: true, titleField: 'title' },
    schemaVersion: 1,
    fields: fields.map((f, position) => ({ ...f, id: newId(), unique: false, localized: false, position })),
    createdAt: at,
    updatedAt: at,
  };
  db.contentTypes.push(type);
  return type;
}

export function schemaRoutes(r: Router): void {
  const env = '/envs/:envId';

  r.get(`${env}/schema`, (c) => {
    const schema = loadSchema(envScope(c).environment.id);
    return {
      types: schema.types.map(withCount),
      components: schema.components,
      blocks: Object.values(schema.blockRegistry),
      builtinBlocks: BUILTIN_BLOCKS.map((b) => b.type),
      builtinComponents: BUILTIN_COMPONENTS,
    };
  });

  r.get(`${env}/schema/changes`, (c) => {
    const q = parse(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30), targetId: z.string().uuid().optional() }), c.query);
    const { environment } = envScope(c);
    const names = userNames();
    const rows = db.schemaChanges.filter((x) => x.environmentId === environment.id && (!q.targetId || x.targetId === q.targetId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(rows, q.page, q.pageSize);
    return { ...page, items: page.items.map((x) => ({ ...x, userName: x.userId ? (names.get(x.userId) ?? null) : null })) };
  });

  // ─── Content types ─────────────────────────────────────────────────────────

  r.get(`${env}/content-types/:typeId`, (c) => withCount(findType(c, loadSchema(envScope(c).environment.id))));

  r.post(`${env}/content-types`, (c) => {
    const input = parse(typeMeta.extend({ apiId, kind: z.enum(['COLLECTION', 'SINGLE']).default('COLLECTION'), fields: z.array(fieldInput).max(200).default([]) }), c.body);
    const { environment } = envScope(c);
    const schema = loadSchema(environment.id);
    if (schema.typeByApiId.has(input.apiId)) throw conflict(`A content type with the API identifier "${input.apiId}" already exists`);
    const issues = validateFieldSet(input.fields, { schema, ownerKind: 'type', ownerApiId: input.apiId });
    if (issues.length) throw unprocessable('The field configuration is invalid', issues);
    if (input.options.titleField && !input.fields.some((f) => f.apiId === input.options.titleField)) {
      throw unprocessable('Title field does not exist', [{ path: 'options.titleField', message: "Choose one of this type's fields" }]);
    }
    const at = nowIso();
    const type: DbType = {
      id: newId(),
      environmentId: environment.id,
      apiId: input.apiId,
      displayName: input.displayName,
      singularName: input.singularName,
      pluralName: input.pluralName,
      description: input.description,
      kind: input.kind,
      icon: input.icon,
      isSystem: false,
      options: input.options,
      schemaVersion: 1,
      fields: toFields(input.fields, true),
      createdAt: at,
      updatedAt: at,
    };
    db.contentTypes.push(type);
    schemaChanged(c, `Created content type "${input.displayName}"`, { kind: 'type', id: type.id, apiId: type.apiId, version: 1 }, { changes: input.fields.map((f) => ({ kind: 'added', apiId: f.apiId, label: f.label })) });
    audit(c, { action: 'schema.type.created', resourceType: 'content_type', resourceId: type.id, resourceLabel: type.displayName, after: { apiId: type.apiId, kind: type.kind, fields: fieldList(input.fields) } });
    return created({ ...type, entryCount: 0 });
  });

  r.patch(`${env}/content-types/:typeId`, (c) => {
    const input = parse(typeMeta.partial(), c.body);
    const type = findType(c, loadSchema(envScope(c).environment.id));
    if (type.isSystem && (input.displayName || input.singularName || input.pluralName)) throw forbidden('The built-in page type cannot be renamed');
    const options = { ...type.options, ...(input.options ?? {}) };
    if (options.titleField && !type.fields.some((f) => f.apiId === options.titleField)) {
      throw unprocessable('Title field does not exist', [{ path: 'options.titleField', message: "Choose one of this type's fields" }]);
    }
    const before = { displayName: type.displayName, description: type.description, options: type.options };
    type.displayName = input.displayName ?? type.displayName;
    type.singularName = input.singularName ?? type.singularName;
    type.pluralName = input.pluralName ?? type.pluralName;
    type.description = input.description ?? type.description;
    type.icon = input.icon ?? type.icon;
    type.options = options;
    type.updatedAt = nowIso();
    audit(c, { action: 'schema.type.updated', resourceType: 'content_type', resourceId: type.id, resourceLabel: type.displayName, before, after: { displayName: type.displayName, description: type.description, options } });
    return type;
  });

  /** Replaces a content type's field list. With `?dryRun=true` nothing is written and the response is the migration plan. */
  r.put(`${env}/content-types/:typeId/fields`, (c) => {
    const input = parse(fieldsBody, c.body);
    const dryRun = c.query.dryRun === 'true' || c.query.dryRun === '1';
    const schema = loadSchema(envScope(c).environment.id);
    const type = findType(c, schema);
    if (isPageType(type)) throw forbidden('The built-in page type has a fixed schema. Add custom components to extend pages.');
    const issues = validateFieldSet(input.fields, { schema, ownerKind: 'type', ownerApiId: type.apiId });
    if (issues.length) throw unprocessable('The field configuration is invalid', issues);

    const plan = planFieldChanges(type.fields, input.fields, type.id);
    if (plan.blockers.length) throw unprocessable('This change cannot be applied safely', plan.blockers);
    if (dryRun) return { plan, applied: false, type };
    if (plan.requiresConfirmation && !input.confirmDestructive) throw conflict('This change discards stored values. Review the impact and confirm to continue.', { plan });
    if (plan.changes.length === 0) return { plan, applied: false, type };

    const before = { fields: fieldList(type.fields) };
    const titleField = type.options.titleField;
    applyFieldChanges(type, true, input.fields, plan);
    const renamedTitle = plan.changes.find((x) => x.kind === 'renamed' && x.from === titleField);
    if (renamedTitle) type.options = { ...type.options, titleField: renamedTitle.to };
    if (plan.changes.some((x) => x.kind === 'removed' && x.apiId === titleField)) type.options = { ...type.options, titleField: undefined };
    retitle(type);

    const summary = plan.changes.map((x) => `${x.kind.replace('_', ' ')} ${x.label}`).join(', ');
    schemaChanged(c, summary.slice(0, 480), { kind: 'type', id: type.id, apiId: type.apiId, version: type.schemaVersion }, plan);
    audit(c, { action: 'schema.type.fields_changed', resourceType: 'content_type', resourceId: type.id, resourceLabel: type.displayName, before, after: { fields: fieldList(input.fields) }, metadata: { changes: plan.changes } });
    return { plan, applied: true, type };
  });

  r.delete(`${env}/content-types/:typeId`, (c) => {
    const schema = loadSchema(envScope(c).environment.id);
    const type = findType(c, schema);
    if (type.isSystem) throw forbidden('Built-in content types cannot be deleted');
    const rows = db.entries.filter((e) => e.contentTypeId === type.id);
    // Deleting a type with content needs the caller to echo its identifier, mirroring the UI confirmation.
    if (rows.length > 0 && c.query.confirm !== type.apiId) {
      throw conflict(`"${type.displayName}" still has ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}. Confirm with its API identifier to delete them too.`, { entries: rows.length, confirmWith: type.apiId });
    }
    const referencing = schema.types.filter((t) => t.id !== type.id).flatMap((t) => t.fields.filter((f) => f.config.targetType === type.apiId).map((f) => `${t.displayName} → ${f.label}`));
    if (referencing.length) throw conflict(`Other content types link to "${type.displayName}": ${referencing.join(', ')}. Remove those relationship fields first.`);

    const gone = new Set(rows.map((e) => e.id));
    db.contentTypes = db.contentTypes.filter((t) => t.id !== type.id);
    db.entries = db.entries.filter((e) => !gone.has(e.id));
    db.versions = db.versions.filter((v) => !gone.has(v.entryId));
    db.comments = db.comments.filter((x) => !gone.has(x.entryId));
    db.releaseItems = db.releaseItems.filter((i) => !gone.has(i.entryId));
    schemaChanged(c, `Deleted content type "${type.displayName}"`, { kind: 'type', id: type.id, apiId: type.apiId, version: type.schemaVersion + 1 }, { deletedEntries: rows.length });
    audit(c, { action: 'schema.type.deleted', resourceType: 'content_type', resourceId: type.id, resourceLabel: type.displayName, before: { apiId: type.apiId, fields: fieldList(type.fields), entries: rows.length } });
    return noContent();
  });

  // ─── Components ────────────────────────────────────────────────────────────

  r.get(`${env}/components/:componentId`, (c) => {
    const schema = loadSchema(envScope(c).environment.id);
    const component = findComponent(c, schema);
    return { ...component, usedBy: componentUsage(schema, component.apiId) };
  });

  r.post(`${env}/components`, (c) => {
    const input = parse(componentMeta.extend({ apiId, fields: z.array(fieldInput).max(200).default([]) }), c.body);
    const { environment } = envScope(c);
    const schema = loadSchema(environment.id);
    if (schema.components.some((x) => x.apiId === input.apiId)) throw conflict(`A component with the API identifier "${input.apiId}" already exists`);
    if (input.isBlock && BUILTIN_BLOCKS.some((b) => b.type === input.apiId)) throw conflict(`"${input.apiId}" is the identifier of a built-in page block. Choose another.`);
    const issues = validateFieldSet(input.fields, { schema, ownerKind: 'component', ownerApiId: input.apiId });
    if (issues.length) throw unprocessable('The field configuration is invalid', issues);
    const at = nowIso();
    const component: DbComponent = {
      id: newId(),
      environmentId: environment.id,
      apiId: input.apiId,
      displayName: input.displayName,
      description: input.description,
      category: input.category,
      icon: input.icon,
      isBlock: input.isBlock,
      schemaVersion: 1,
      fields: toFields(input.fields, false),
      createdAt: at,
      updatedAt: at,
    };
    db.components.push(component);
    schemaChanged(c, `Created component "${input.displayName}"`, { kind: 'component', id: component.id, apiId: component.apiId, version: 1 }, { changes: input.fields.map((f) => ({ kind: 'added', apiId: f.apiId, label: f.label })) });
    audit(c, { action: 'schema.component.created', resourceType: 'component', resourceId: component.id, resourceLabel: component.displayName, after: { apiId: component.apiId, fields: fieldList(input.fields) } });
    return created({ ...component, usedBy: [] });
  });

  r.patch(`${env}/components/:componentId`, (c) => {
    const input = parse(componentMeta.partial(), c.body);
    const { environment } = envScope(c);
    const schema = loadSchema(environment.id);
    const component = findComponent(c, schema);
    if (input.isBlock && !component.isBlock && BUILTIN_BLOCKS.some((b) => b.type === component.apiId)) {
      throw conflict(`"${component.apiId}" is the identifier of a built-in page block and cannot be offered as a custom block.`);
    }
    if (input.isBlock === false && component.isBlock) {
      const pages = schema.typeByApiId.get('pages');
      const uses = (data: Json | null) => !!data && JSON.stringify(data).includes(`"type":"${component.apiId}"`);
      const used = db.entries.some((e: DbEntry) => e.environmentId === environment.id && e.contentTypeId === pages?.id && !e.deletedAt && (uses(e.data) || uses(e.publishedData)));
      if (used) throw badRequest('This component is still used on pages. Remove it from those pages first.');
    }
    const before = { displayName: component.displayName, isBlock: component.isBlock };
    component.displayName = input.displayName ?? component.displayName;
    component.description = input.description ?? component.description;
    component.category = input.category ?? component.category;
    component.icon = input.icon ?? component.icon;
    component.isBlock = input.isBlock ?? component.isBlock;
    component.updatedAt = nowIso();
    audit(c, { action: 'schema.component.updated', resourceType: 'component', resourceId: component.id, resourceLabel: component.displayName, before, after: { displayName: component.displayName, isBlock: component.isBlock } });
    return { ...component, usedBy: componentUsage(schema, component.apiId) };
  });

  r.put(`${env}/components/:componentId/fields`, (c) => {
    const input = parse(fieldsBody, c.body);
    const dryRun = c.query.dryRun === 'true' || c.query.dryRun === '1';
    const schema = loadSchema(envScope(c).environment.id);
    const component = findComponent(c, schema);
    const issues = validateFieldSet(input.fields, { schema, ownerKind: 'component', ownerApiId: component.apiId });
    if (issues.length) throw unprocessable('The field configuration is invalid', issues);
    const plan = planFieldChanges(component.fields, input.fields, null);
    if (plan.blockers.length) throw unprocessable('This change cannot be applied safely', plan.blockers);
    if (dryRun || plan.changes.length === 0) return { plan, applied: false, component };

    const before = { fields: fieldList(component.fields) };
    applyFieldChanges(component, false, input.fields, plan);
    const summary = plan.changes.map((x) => `${x.kind.replace('_', ' ')} ${x.label}`).join(', ');
    schemaChanged(c, summary.slice(0, 480), { kind: 'component', id: component.id, apiId: component.apiId, version: component.schemaVersion }, plan);
    audit(c, { action: 'schema.component.fields_changed', resourceType: 'component', resourceId: component.id, resourceLabel: component.displayName, before, after: { fields: fieldList(input.fields) } });
    return { plan, applied: true, component };
  });

  r.delete(`${env}/components/:componentId`, (c) => {
    const schema = loadSchema(envScope(c).environment.id);
    const component = findComponent(c, schema);
    const usedBy = componentUsage(schema, component.apiId);
    if (usedBy.length) throw conflict(`This component is used by: ${usedBy.join(', ')}. Remove those fields first.`);
    db.components = db.components.filter((x) => x.id !== component.id);
    schemaChanged(c, `Deleted component "${component.displayName}"`, { kind: 'component', id: component.id, apiId: component.apiId, version: component.schemaVersion + 1 }, {});
    audit(c, { action: 'schema.component.deleted', resourceType: 'component', resourceId: component.id, resourceLabel: component.displayName, before: { apiId: component.apiId, fields: fieldList(component.fields) } });
    return noContent();
  });
}

/** Title and slug columns are derived from field values, so a renamed or removed title field changes them. */
function retitle(type: DbType): void {
  const preferred = type.options.titleField;
  for (const entry of db.entries.filter((e) => e.contentTypeId === type.id)) {
    const pick = (data: Json | null): string | null => {
      if (!data) return null;
      const value = preferred ? data[preferred] : undefined;
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
      const text = type.fields.find((f) => (f.type === 'text' || f.type === 'textarea') && typeof data[f.apiId] === 'string' && (data[f.apiId] as string).trim());
      return text ? (data[text.apiId] as string).trim().slice(0, 300) : null;
    };
    entry.title = pick(entry.data);
    if (entry.publishedAt) entry.publishedTitle = pick(entry.publishedData);
  }
}
