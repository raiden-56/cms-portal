import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  API_ID_PATTERN,
  FIELD_TYPES,
  FIELD_TYPE_META,
  type FieldDef,
  type FieldType,
  RESERVED_FIELD_IDS,
  isCompatibleTypeChange,
  sameJson,
} from '@meridian/shared';
import type { ErrorDetail } from '../../lib/errors';
import type { EnvSchema } from './schema.service';

type Tx = Prisma.TransactionClient;

const condition = z.object({
  field: z.string().min(1).max(63),
  operator: z.enum(['eq', 'neq', 'empty', 'notEmpty', 'in', 'gt', 'lt']),
  value: z.unknown().optional(),
});

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

export const fieldInputSchema = z.object({
  id: z.string().uuid().optional(),
  apiId: z.string().regex(API_ID_PATTERN, 'Use camelCase: start with a lowercase letter, then letters, numbers or underscores'),
  label: z.string().trim().min(1, 'Label is required').max(80),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  localized: z.boolean().default(false),
  config: fieldConfig.default({}),
});
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const fieldsBodySchema = z.object({
  fields: z.array(fieldInputSchema).max(200, 'A schema can have at most 200 fields'),
  /** Acknowledges changes that discard stored values (field removal, incompatible type change). */
  confirmDestructive: z.boolean().default(false),
});

/** Structural validation of a proposed field list. Returns issues keyed by `fields.<index>.<prop>`. */
export function validateFieldSet(
  fields: FieldInput[],
  ctx: { schema: EnvSchema; ownerKind: 'type' | 'component'; ownerApiId: string },
): ErrorDetail[] {
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
    if (cfg.minLength !== undefined && cfg.maxLength !== undefined && cfg.minLength > cfg.maxLength) {
      add(i, 'config.maxLength', 'Maximum length must not be less than the minimum');
    }
    if (cfg.min !== undefined && cfg.max !== undefined && cfg.min > cfg.max) add(i, 'config.max', 'Maximum must not be less than the minimum');
    if (cfg.minItems !== undefined && cfg.maxItems !== undefined && cfg.minItems > cfg.maxItems) {
      add(i, 'config.maxItems', 'Maximum items must not be less than the minimum');
    }
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
      for (const apiId of cfg.allowedComponents ?? []) {
        if (!ctx.schema.components.some((c) => c.apiId === apiId)) add(i, 'config.allowedComponents', `Component "${apiId}" does not exist`);
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
    const graph = new Map<string, string[]>();
    const edges = (defs: { type: FieldType; config: FieldDef['config'] }[]) =>
      defs.flatMap((d) =>
        d.type === 'component' || d.type === 'repeatable'
          ? d.config.component
            ? [d.config.component]
            : []
          : d.type === 'dynamiczone'
            ? (d.config.allowedComponents ?? [])
            : [],
      );
    for (const c of ctx.schema.components) graph.set(c.apiId, edges(c.fields));
    graph.set(ctx.ownerApiId, edges(fields as never));
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

export interface FieldChange {
  kind: 'added' | 'removed' | 'renamed' | 'type_changed' | 'updated' | 'reordered';
  apiId: string;
  label: string;
  from?: string;
  to?: string;
  /** Entries holding a value that this change touches. */
  affectedEntries?: number;
  destructive?: boolean;
  note?: string;
}

export interface SchemaPlan {
  changes: FieldChange[];
  blockers: ErrorDetail[];
  warnings: string[];
  /** True when applying would discard stored values and needs `confirmDestructive`. */
  requiresConfirmation: boolean;
}

async function countWithValue(tx: Tx, contentTypeId: string, apiId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM "Entry"
    WHERE "contentTypeId" = ${contentTypeId}::uuid
      AND "data"->>${apiId}::text IS NOT NULL
      AND "data"->>${apiId}::text NOT IN ('', '[]', '{}')`);
  return rows[0]?.n ?? 0;
}

async function countMissing(tx: Tx, contentTypeId: string, apiId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM "Entry"
    WHERE "contentTypeId" = ${contentTypeId}::uuid AND "deletedAt" IS NULL
      AND ("data"->>${apiId}::text IS NULL OR "data"->>${apiId}::text IN ('', '[]'))`);
  return rows[0]?.n ?? 0;
}

async function findDuplicates(tx: Tx, contentTypeId: string, apiId: string): Promise<string[]> {
  // The value is projected once in a subquery so GROUP BY can refer to it by name.
  const rows = await tx.$queryRaw<{ value: string }[]>(Prisma.sql`
    SELECT s.value FROM (
      SELECT "locale", "data"->>${apiId}::text AS value FROM "Entry"
      WHERE "contentTypeId" = ${contentTypeId}::uuid AND "deletedAt" IS NULL
    ) s
    WHERE s.value IS NOT NULL AND s.value <> ''
    GROUP BY s."locale", s.value HAVING count(*) > 1 LIMIT 5`);
  return rows.map((r) => r.value);
}

/**
 * Computes what a new field list means for a content type and its stored entries,
 * without changing anything. `contentTypeId` is null for components, which hold no rows of their own.
 */
export async function planFieldChanges(
  tx: Tx,
  current: FieldDef[],
  next: FieldInput[],
  contentTypeId: string | null,
): Promise<SchemaPlan> {
  const plan: SchemaPlan = { changes: [], blockers: [], warnings: [], requiresConfirmation: false };
  const currentById = new Map(current.map((f) => [f.id as string, f]));
  const currentByApiId = new Map(current.map((f) => [f.apiId, f]));
  const matched = new Set<string>();

  for (const [index, field] of next.entries()) {
    // Match by id (allows rename); fall back to apiId for clients that do not send ids.
    const previous = (field.id && currentById.get(field.id)) || (!field.id ? currentByApiId.get(field.apiId) : undefined);
    if (field.id && !previous) {
      plan.blockers.push({ path: `fields.${index}.id`, message: `Field "${field.apiId}" refers to an id that does not belong to this schema` });
      continue;
    }
    if (!previous) {
      plan.changes.push({ kind: 'added', apiId: field.apiId, label: field.label });
      if (field.required && contentTypeId && field.config.defaultValue === undefined) {
        const missing = await countMissing(tx, contentTypeId, field.apiId);
        if (missing > 0) {
          plan.warnings.push(`"${field.label}" is required but ${missing} existing entr${missing === 1 ? 'y has' : 'ies have'} no value. They must be completed before their next publish.`);
        }
      }
      continue;
    }
    matched.add(previous.id as string);
    const affected = contentTypeId ? await countWithValue(tx, contentTypeId, previous.apiId) : 0;

    if (previous.apiId !== field.apiId) {
      if (!contentTypeId) {
        plan.blockers.push({
          path: `fields.${index}.apiId`,
          message: `The API identifier of a component field cannot be changed ("${previous.apiId}"). Add a new field instead.`,
        });
      } else {
        plan.changes.push({ kind: 'renamed', apiId: field.apiId, label: field.label, from: previous.apiId, to: field.apiId, affectedEntries: affected });
      }
    }
    if (previous.type !== field.type) {
      const compatible = isCompatibleTypeChange(previous.type, field.type);
      if (!compatible && !contentTypeId) {
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
    if (!previous.unique && field.unique && contentTypeId) {
      const duplicates = await findDuplicates(tx, contentTypeId, previous.apiId);
      if (duplicates.length) {
        plan.blockers.push({
          path: `fields.${index}.unique`,
          message: `"${field.label}" cannot be made unique: existing entries share the values ${duplicates.map((d) => `"${d}"`).join(', ')}`,
        });
      }
    }
    if (!previous.required && field.required && contentTypeId) {
      const missing = await countMissing(tx, contentTypeId, previous.apiId);
      if (missing > 0) {
        plan.warnings.push(
          field.config.defaultValue !== undefined
            ? `"${field.label}" is now required: ${missing} entr${missing === 1 ? 'y' : 'ies'} without a value will receive the default.`
            : `"${field.label}" is now required but ${missing} entr${missing === 1 ? 'y has' : 'ies have'} no value. They must be completed before their next publish.`,
        );
      }
    }
    const metaChanged =
      previous.label !== field.label ||
      previous.required !== field.required ||
      previous.unique !== field.unique ||
      previous.localized !== field.localized ||
      !sameJson(previous.config, field.config);
    if (metaChanged && previous.apiId === field.apiId && previous.type === field.type) {
      plan.changes.push({ kind: 'updated', apiId: field.apiId, label: field.label });
    }
  }

  for (const previous of current) {
    if (matched.has(previous.id as string)) continue;
    const affected = contentTypeId ? await countWithValue(tx, contentTypeId, previous.apiId) : 0;
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
  if (plan.changes.length === 0 && JSON.stringify(keptOrder) !== JSON.stringify(nextOrder)) {
    plan.changes.push({ kind: 'reordered', apiId: '*', label: 'Field order' });
  }
  return plan;
}

const jsonb = (value: unknown) => Prisma.sql`${JSON.stringify(value)}::jsonb`;

/**
 * Applies a planned field list inside the caller's transaction: migrates stored entry data
 * (renames, removals, type resets, required back-fills) and rewrites the Field rows.
 */
export async function applyFieldChanges(
  tx: Tx,
  owner: { kind: 'type' | 'component'; id: string },
  current: FieldDef[],
  next: FieldInput[],
  plan: SchemaPlan,
): Promise<void> {
  const typeId = owner.kind === 'type' ? owner.id : null;

  if (typeId) {
    const dropKey = (key: string) =>
      tx.$executeRaw(Prisma.sql`
        UPDATE "Entry" SET "data" = "data" - ${key}::text, "publishedData" = "publishedData" - ${key}::text
        WHERE "contentTypeId" = ${typeId}::uuid`);

    // 1. Removed fields, addressed by their old identifier.
    for (const change of plan.changes) {
      if (change.kind === 'removed') await dropKey(change.apiId);
    }
    // 2. Renames, in two passes through temporary keys so swaps (a→b, b→a) cannot collide.
    const renames = plan.changes.filter((c) => c.kind === 'renamed');
    for (const [i, change] of renames.entries()) {
      const temp = `__rename_${i}`;
      for (const column of ['data', 'publishedData'] as const) {
        const col = Prisma.raw(`"${column}"`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Entry" SET ${col} = (${col} - ${change.from}::text) || jsonb_build_object(${temp}::text, ${col}->${change.from}::text)
          WHERE "contentTypeId" = ${typeId}::uuid AND ${col} ? ${change.from}::text`);
      }
    }
    for (const [i, change] of renames.entries()) {
      const temp = `__rename_${i}`;
      for (const column of ['data', 'publishedData'] as const) {
        const col = Prisma.raw(`"${column}"`);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Entry" SET ${col} = (${col} - ${temp}::text) || jsonb_build_object(${change.to}::text, ${col}->${temp}::text)
          WHERE "contentTypeId" = ${typeId}::uuid AND ${col} ? ${temp}::text`);
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE "EntryRelation" SET "field" = ${change.to} WHERE "field" = ${change.from}
          AND "fromEntryId" IN (SELECT "id" FROM "Entry" WHERE "contentTypeId" = ${typeId}::uuid)`);
    }
    // 3. Incompatible type changes clear the value, addressed by the field's final identifier.
    for (const change of plan.changes) {
      if (change.kind === 'type_changed' && change.destructive) await dropKey(change.apiId);
    }
    // 4. Newly required fields with a default: fill the gaps so existing content stays publishable.
    const currentById = new Map(current.map((f) => [f.id as string, f]));
    for (const field of next) {
      const previous = field.id ? currentById.get(field.id) : undefined;
      const becameRequired = field.required && (!previous || !previous.required);
      if (becameRequired && field.config.defaultValue !== undefined && field.config.defaultValue !== null) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Entry" SET "data" = jsonb_set("data", ARRAY[${field.apiId}]::text[], ${jsonb(field.config.defaultValue)}, true)
          WHERE "contentTypeId" = ${typeId}::uuid
            AND ("data"->>${field.apiId}::text IS NULL OR "data"->>${field.apiId}::text IN ('', '[]'))`);
      }
    }
  }

  // Rewrite Field rows. Park kept rows on temporary identifiers first so unique(apiId) never trips mid-update.
  const ownerWhere = owner.kind === 'type' ? { contentTypeId: owner.id } : { componentId: owner.id };
  const currentByApiId = new Map(current.map((f) => [f.apiId, f]));
  const resolved = next.map((f) => ({ input: f, id: f.id ?? currentByApiId.get(f.apiId)?.id }));
  const keepIds = resolved.map((r) => r.id).filter((id): id is string => !!id);
  await tx.field.deleteMany({ where: { ...ownerWhere, id: { notIn: keepIds } } });
  for (const [i, id] of keepIds.entries()) {
    await tx.field.update({ where: { id }, data: { apiId: `__tmp_${i}` } });
  }
  for (const [position, { input, id }] of resolved.entries()) {
    const data = {
      apiId: input.apiId,
      label: input.label,
      type: input.type,
      required: input.required,
      unique: input.unique,
      localized: input.localized,
      config: input.config as Prisma.InputJsonValue,
      position,
    };
    if (id) await tx.field.update({ where: { id }, data });
    else await tx.field.create({ data: { ...data, ...ownerWhere } });
  }
}
