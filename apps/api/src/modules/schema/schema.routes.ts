import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  BUILTIN_BLOCKS,
  BUILTIN_COMPONENTS,
  RESERVED_TYPE_IDS,
  TYPE_API_ID_PATTERN,
} from '@meridian/shared';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { param, parse, toPage } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { envOf, envScope, userOf } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { emitEvent, scopeFromRequest } from '../events/events.service';
import { applyFieldChanges, fieldInputSchema, fieldsBodySchema, planFieldChanges, validateFieldSet } from './schema.fields';
import { promoteSchema } from './schema.promote';
import { bumpSchemaStamp, isPageType, loadSchema, type EnvSchema, type LoadedComponent, type LoadedType } from './schema.service';

export const schemaRouter = Router({ mergeParams: true });

const apiId = z
  .string()
  .regex(TYPE_API_ID_PATTERN, 'Use lowercase letters, numbers and hyphens, starting with a letter')
  .refine((v) => !RESERVED_TYPE_IDS.includes(v), 'That identifier is reserved');

const typeOptions = z
  .object({
    localized: z.boolean(),
    requireApproval: z.boolean(),
    titleField: z.string().max(63),
    previewUrl: z.string().max(500),
  })
  .partial()
  .strict();

const typeMeta = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  singularName: z.string().trim().min(1).max(80),
  pluralName: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  icon: z.string().max(40).default('document'),
  options: typeOptions.default({}),
});

const createTypeSchema = typeMeta.extend({
  apiId,
  kind: z.enum(['COLLECTION', 'SINGLE']).default('COLLECTION'),
  fields: z.array(fieldInputSchema).max(200).default([]),
});

const componentMeta = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  description: z.string().trim().max(500).default(''),
  category: z.string().trim().min(1).max(60).default('General'),
  icon: z.string().max(40).default('component'),
  isBlock: z.boolean().default(false),
});

async function findType(req: Request, schema: EnvSchema): Promise<LoadedType> {
  const key = param(req, 'typeId');
  const type = schema.typeById.get(key) ?? schema.typeByApiId.get(key);
  if (!type) throw notFound('Content type');
  return type;
}

function findComponent(req: Request, schema: EnvSchema): LoadedComponent {
  const key = param(req, 'componentId');
  const component = schema.components.find((c) => c.id === key || c.apiId === key);
  if (!component) throw notFound('Component');
  return component;
}

async function entryCounts(environmentId: string): Promise<Map<string, number>> {
  const rows = await prisma.entry.groupBy({ by: ['contentTypeId'], where: { environmentId, deletedAt: null }, _count: true });
  return new Map(rows.map((r) => [r.contentTypeId, r._count]));
}

async function schemaChanged(req: Request, summary: string, target: { kind: string; id: string; apiId: string; version: number }, diff: unknown) {
  const { environment } = envOf(req);
  await prisma.schemaChange.create({
    data: {
      environmentId: environment.id,
      targetKind: target.kind,
      targetId: target.id,
      targetApiId: target.apiId,
      version: target.version,
      summary,
      diff: diff as Prisma.InputJsonValue,
      userId: userOf(req).id,
    },
  });
  await bumpSchemaStamp(environment.id);
  await emitEvent(scopeFromRequest(req), { event: 'schema.updated', contentType: target.apiId });
}

// ─── Whole schema ────────────────────────────────────────────────────────────

schemaRouter.get('/schema', envScope('schema.read'), async (req, res) => {
  const { environment } = envOf(req);
  const [schema, counts] = await Promise.all([loadSchema(environment.id), entryCounts(environment.id)]);
  res.json({
    types: schema.types.map((t) => ({ ...t, entryCount: counts.get(t.id) ?? 0 })),
    components: schema.components,
    blocks: Object.values(schema.blockRegistry),
    builtinBlocks: BUILTIN_BLOCKS.map((b) => b.type),
    builtinComponents: BUILTIN_COMPONENTS,
  });
});

schemaRouter.get('/schema/changes', envScope('schema.read'), async (req, res) => {
  const q = parse(
    z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30), targetId: z.string().uuid().optional() }),
    req.query,
  );
  const where = { environmentId: envOf(req).environment.id, ...(q.targetId ? { targetId: q.targetId } : {}) };
  const [items, total] = await Promise.all([
    prisma.schemaChange.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.schemaChange.count({ where }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.userId).filter((id): id is string => !!id))] } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json(toPage(items.map((i) => ({ ...i, userName: i.userId ? (names.get(i.userId) ?? null) : null })), total, q.page, q.pageSize));
});

/**
 * Promotes this environment's content model to another environment of the same project.
 * `dryRun` (the default) only returns the plan; nothing changes until it is called with dryRun=false.
 */
schemaRouter.post('/schema/promote', envScope('schema.manage'), async (req, res) => {
  const input = parse(
    z.object({ targetEnvironmentId: z.string().uuid(), dryRun: z.boolean().default(true), confirmDestructive: z.boolean().default(false) }),
    req.body,
  );
  const { environment, project, tenant } = envOf(req);
  if (input.targetEnvironmentId === environment.id) throw badRequest('Choose a different environment to promote to');
  // The target must be an environment of this same project — never another tenant's.
  const target = await prisma.environment.findFirst({ where: { id: input.targetEnvironmentId, projectId: project.id }, select: { id: true, key: true, name: true } });
  if (!target) throw notFound('Target environment');

  const result = await prisma.$transaction(
    (tx) => promoteSchema(tx, environment.id, target.id, { apply: !input.dryRun, confirmDestructive: input.confirmDestructive, userId: userOf(req).id }),
    { timeout: 120_000 },
  );
  if (!input.dryRun && result.plan.blockers.length) throw unprocessable('The content model cannot be promoted safely', result.plan.blockers);
  if (!input.dryRun && result.plan.requiresConfirmation && !input.confirmDestructive) {
    throw conflict('Promoting would discard stored values in the target environment. Review the plan and confirm to continue.', { plan: result.plan });
  }
  if (result.applied) {
    const changed = result.plan.items.filter((i) => i.action !== 'unchanged');
    await prisma.schemaChange.create({
      data: {
        environmentId: target.id,
        targetKind: 'promotion',
        targetId: environment.id,
        targetApiId: environment.key,
        version: 0,
        summary: `Promoted content model from ${environment.name}: ${changed.map((i) => `${i.action} ${i.displayName}`).join(', ')}`.slice(0, 480),
        diff: result.plan as unknown as Prisma.InputJsonValue,
        userId: userOf(req).id,
      },
    });
    await bumpSchemaStamp(target.id);
    await emitEvent(
      { organizationId: tenant.organizationId, organizationSlug: tenant.organizationSlug, project: { id: project.id, slug: project.slug }, environment: { id: target.id, key: target.key } },
      { event: 'schema.updated' },
    );
    await audit(req, {
      environmentId: target.id,
      action: 'schema.promoted',
      resourceType: 'environment',
      resourceId: target.id,
      resourceLabel: `${environment.name} → ${target.name}`,
      metadata: { created: changed.filter((i) => i.action === 'create').map((i) => i.apiId), updated: changed.filter((i) => i.action === 'update').map((i) => i.apiId) },
    });
  }
  res.json({ ...result, source: { id: environment.id, name: environment.name }, target });
});

// ─── Content types ───────────────────────────────────────────────────────────

schemaRouter.get('/content-types/:typeId', envScope('schema.read'), async (req, res) => {
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const type = await findType(req, schema);
  const entryCount = await prisma.entry.count({ where: { contentTypeId: type.id, deletedAt: null } });
  res.json({ ...type, entryCount });
});

schemaRouter.post('/content-types', envScope('schema.manage'), async (req, res) => {
  const input = parse(createTypeSchema, req.body);
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  if (schema.typeByApiId.has(input.apiId)) throw conflict(`A content type with the API identifier "${input.apiId}" already exists`);
  const issues = validateFieldSet(input.fields, { schema, ownerKind: 'type', ownerApiId: input.apiId });
  if (issues.length) throw unprocessable('The field configuration is invalid', issues);
  if (input.options.titleField && !input.fields.some((f) => f.apiId === input.options.titleField)) {
    throw unprocessable('Title field does not exist', [{ path: 'options.titleField', message: 'Choose one of this type\'s fields' }]);
  }

  const created = await prisma.contentType.create({
    data: {
      environmentId: environment.id,
      apiId: input.apiId,
      displayName: input.displayName,
      singularName: input.singularName,
      pluralName: input.pluralName,
      description: input.description,
      kind: input.kind,
      icon: input.icon,
      options: input.options,
      createdById: userOf(req).id,
      fields: {
        create: input.fields.map((f, position) => ({
          apiId: f.apiId,
          label: f.label,
          type: f.type,
          required: f.required,
          unique: f.unique,
          localized: f.localized,
          config: f.config as Prisma.InputJsonValue,
          position,
        })),
      },
    },
  });
  await schemaChanged(req, `Created content type "${input.displayName}"`, { kind: 'type', id: created.id, apiId: created.apiId, version: 1 }, {
    changes: input.fields.map((f) => ({ kind: 'added', apiId: f.apiId, label: f.label })),
  });
  await audit(req, {
    action: 'schema.type.created',
    resourceType: 'content_type',
    resourceId: created.id,
    resourceLabel: created.displayName,
    after: { apiId: created.apiId, kind: created.kind, fields: input.fields.map((f) => `${f.apiId}:${f.type}`) },
  });
  const fresh = await loadSchema(environment.id);
  res.status(201).json({ ...fresh.typeById.get(created.id), entryCount: 0 });
});

schemaRouter.patch('/content-types/:typeId', envScope('schema.manage'), async (req, res) => {
  const input = parse(typeMeta.partial(), req.body);
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const type = await findType(req, schema);
  if (type.isSystem && (input.displayName || input.singularName || input.pluralName)) {
    throw forbidden('The built-in page type cannot be renamed');
  }
  const options = { ...type.options, ...(input.options ?? {}) };
  if (options.titleField && !type.fields.some((f) => f.apiId === options.titleField)) {
    throw unprocessable('Title field does not exist', [{ path: 'options.titleField', message: 'Choose one of this type\'s fields' }]);
  }
  const updated = await prisma.contentType.update({
    where: { id: type.id },
    data: {
      displayName: input.displayName ?? type.displayName,
      singularName: input.singularName ?? type.singularName,
      pluralName: input.pluralName ?? type.pluralName,
      description: input.description ?? type.description,
      icon: input.icon ?? type.icon,
      options,
    },
  });
  await bumpSchemaStamp(environment.id);
  await audit(req, {
    action: 'schema.type.updated',
    resourceType: 'content_type',
    resourceId: type.id,
    resourceLabel: updated.displayName,
    before: { displayName: type.displayName, description: type.description, options: type.options },
    after: { displayName: updated.displayName, description: updated.description, options },
  });
  const fresh = await loadSchema(environment.id);
  res.json(fresh.typeById.get(type.id));
});

/**
 * Replaces a content type's field list. With `?dryRun=true` nothing is written and the
 * response is the migration plan, so the builder can show its impact before saving.
 */
schemaRouter.put('/content-types/:typeId/fields', envScope('schema.manage'), async (req, res) => {
  const input = parse(fieldsBodySchema, req.body);
  const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const type = await findType(req, schema);
  if (isPageType(type)) throw forbidden('The built-in page type has a fixed schema. Add custom components to extend pages.');

  const issues = validateFieldSet(input.fields, { schema, ownerKind: 'type', ownerApiId: type.apiId });
  if (issues.length) throw unprocessable('The field configuration is invalid', issues);

  const result = await prisma.$transaction(
    async (tx) => {
      const plan = await planFieldChanges(tx, type.fields, input.fields, type.id);
      if (plan.blockers.length) throw unprocessable('This change cannot be applied safely', plan.blockers);
      if (dryRun) return { plan, applied: false };
      if (plan.requiresConfirmation && !input.confirmDestructive) {
        throw conflict('This change discards stored values. Review the impact and confirm to continue.', { plan });
      }
      if (plan.changes.length === 0) return { plan, applied: false };
      await applyFieldChanges(tx, { kind: 'type', id: type.id }, type.fields, input.fields, plan);
      const renamedTitle = plan.changes.find((c) => c.kind === 'renamed' && c.from === type.options.titleField);
      const removedTitle = plan.changes.some((c) => c.kind === 'removed' && c.apiId === type.options.titleField);
      await tx.contentType.update({
        where: { id: type.id },
        data: {
          schemaVersion: { increment: 1 },
          ...(renamedTitle ? { options: { ...type.options, titleField: renamedTitle.to } } : {}),
          ...(removedTitle ? { options: { ...type.options, titleField: undefined } } : {}),
        },
      });
      return { plan, applied: true };
    },
    { timeout: 60_000 },
  );

  if (result.applied) {
    const summary = result.plan.changes.map((c) => `${c.kind.replace('_', ' ')} ${c.label}`).join(', ');
    await schemaChanged(req, summary.slice(0, 480), { kind: 'type', id: type.id, apiId: type.apiId, version: type.schemaVersion + 1 }, result.plan);
    await audit(req, {
      action: 'schema.type.fields_changed',
      resourceType: 'content_type',
      resourceId: type.id,
      resourceLabel: type.displayName,
      before: { fields: type.fields.map((f) => `${f.apiId}:${f.type}`) },
      after: { fields: input.fields.map((f) => `${f.apiId}:${f.type}`) },
      metadata: { changes: result.plan.changes },
    });
  }
  const fresh = await loadSchema(environment.id);
  res.json({ ...result, type: fresh.typeById.get(type.id) });
});

schemaRouter.delete('/content-types/:typeId', envScope('schema.manage'), async (req, res) => {
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const type = await findType(req, schema);
  if (type.isSystem) throw forbidden('Built-in content types cannot be deleted');
  const entries = await prisma.entry.count({ where: { contentTypeId: type.id } });
  // Deleting a type with content needs the caller to echo its identifier, mirroring the UI confirmation.
  if (entries > 0 && req.query.confirm !== type.apiId) {
    throw conflict(`"${type.displayName}" still has ${entries} entr${entries === 1 ? 'y' : 'ies'}. Confirm with its API identifier to delete them too.`, {
      entries,
      confirmWith: type.apiId,
    });
  }
  const referencing = schema.types
    .filter((t) => t.id !== type.id)
    .flatMap((t) => t.fields.filter((f) => f.config.targetType === type.apiId).map((f) => `${t.displayName} → ${f.label}`));
  if (referencing.length) throw conflict(`Other content types link to "${type.displayName}": ${referencing.join(', ')}. Remove those relationship fields first.`);

  await prisma.contentType.delete({ where: { id: type.id } });
  await schemaChanged(req, `Deleted content type "${type.displayName}"`, { kind: 'type', id: type.id, apiId: type.apiId, version: type.schemaVersion + 1 }, {
    deletedEntries: entries,
  });
  await audit(req, {
    action: 'schema.type.deleted',
    resourceType: 'content_type',
    resourceId: type.id,
    resourceLabel: type.displayName,
    before: { apiId: type.apiId, fields: type.fields.map((f) => `${f.apiId}:${f.type}`), entries },
  });
  res.status(204).end();
});

// ─── Components ──────────────────────────────────────────────────────────────

function componentUsage(schema: EnvSchema, componentApiId: string): string[] {
  const uses = (fields: LoadedType['fields']) =>
    fields.filter((f) => f.config.component === componentApiId || f.config.allowedComponents?.includes(componentApiId));
  return [
    ...schema.types.flatMap((t) => uses(t.fields).map((f) => `${t.displayName} → ${f.label}`)),
    ...schema.components.filter((c) => c.apiId !== componentApiId).flatMap((c) => uses(c.fields).map((f) => `${c.displayName} → ${f.label}`)),
  ];
}

schemaRouter.get('/components/:componentId', envScope('schema.read'), async (req, res) => {
  const schema = await loadSchema(envOf(req).environment.id);
  const component = findComponent(req, schema);
  res.json({ ...component, usedBy: componentUsage(schema, component.apiId) });
});

schemaRouter.post('/components', envScope('schema.manage'), async (req, res) => {
  const input = parse(componentMeta.extend({ apiId, fields: z.array(fieldInputSchema).max(200).default([]) }), req.body);
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  if (schema.components.some((c) => c.apiId === input.apiId)) throw conflict(`A component with the API identifier "${input.apiId}" already exists`);
  if (input.isBlock && BUILTIN_BLOCKS.some((b) => b.type === input.apiId)) {
    throw conflict(`"${input.apiId}" is the identifier of a built-in page block. Choose another.`);
  }
  const issues = validateFieldSet(input.fields, { schema, ownerKind: 'component', ownerApiId: input.apiId });
  if (issues.length) throw unprocessable('The field configuration is invalid', issues);

  const created = await prisma.component.create({
    data: {
      environmentId: environment.id,
      apiId: input.apiId,
      displayName: input.displayName,
      description: input.description,
      category: input.category,
      icon: input.icon,
      isBlock: input.isBlock,
      fields: {
        create: input.fields.map((f, position) => ({
          apiId: f.apiId,
          label: f.label,
          type: f.type,
          required: f.required,
          unique: false,
          localized: f.localized,
          config: f.config as Prisma.InputJsonValue,
          position,
        })),
      },
    },
  });
  await schemaChanged(req, `Created component "${input.displayName}"`, { kind: 'component', id: created.id, apiId: created.apiId, version: 1 }, {
    changes: input.fields.map((f) => ({ kind: 'added', apiId: f.apiId, label: f.label })),
  });
  await audit(req, {
    action: 'schema.component.created',
    resourceType: 'component',
    resourceId: created.id,
    resourceLabel: created.displayName,
    after: { apiId: created.apiId, fields: input.fields.map((f) => `${f.apiId}:${f.type}`) },
  });
  const fresh = await loadSchema(environment.id);
  res.status(201).json({ ...fresh.components.find((c) => c.id === created.id), usedBy: [] });
});

schemaRouter.patch('/components/:componentId', envScope('schema.manage'), async (req, res) => {
  const input = parse(componentMeta.partial(), req.body);
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const component = findComponent(req, schema);
  if (input.isBlock && !component.isBlock && BUILTIN_BLOCKS.some((b) => b.type === component.apiId)) {
    throw conflict(`"${component.apiId}" is the identifier of a built-in page block and cannot be offered as a custom block.`);
  }
  if (input.isBlock === false && component.isBlock) {
    // jsonb renders as `"type": "<id>"`; identifiers are restricted to [a-z0-9-], so LIKE needs no escaping.
    const needle = `%"type": "${component.apiId}"%`;
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Entry" e JOIN "ContentType" t ON t."id" = e."contentTypeId"
      WHERE e."environmentId" = ${environment.id}::uuid AND t."isSystem" = true AND e."deletedAt" IS NULL
        AND (e."data"::text LIKE ${needle} OR e."publishedData"::text LIKE ${needle})`;
    if ((rows[0]?.n ?? 0) > 0) throw badRequest('This component is still used on pages. Remove it from those pages first.');
  }
  await prisma.component.update({
    where: { id: component.id },
    data: {
      displayName: input.displayName ?? component.displayName,
      description: input.description ?? component.description,
      category: input.category ?? component.category,
      icon: input.icon ?? component.icon,
      isBlock: input.isBlock ?? component.isBlock,
    },
  });
  await bumpSchemaStamp(environment.id);
  await audit(req, {
    action: 'schema.component.updated',
    resourceType: 'component',
    resourceId: component.id,
    resourceLabel: input.displayName ?? component.displayName,
    before: { displayName: component.displayName, isBlock: component.isBlock },
    after: { displayName: input.displayName ?? component.displayName, isBlock: input.isBlock ?? component.isBlock },
  });
  const fresh = await loadSchema(environment.id);
  res.json({ ...fresh.components.find((c) => c.id === component.id), usedBy: componentUsage(fresh, component.apiId) });
});

schemaRouter.put('/components/:componentId/fields', envScope('schema.manage'), async (req, res) => {
  const input = parse(fieldsBodySchema, req.body);
  const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const component = findComponent(req, schema);
  const issues = validateFieldSet(input.fields, { schema, ownerKind: 'component', ownerApiId: component.apiId });
  if (issues.length) throw unprocessable('The field configuration is invalid', issues);

  const result = await prisma.$transaction(async (tx) => {
    const plan = await planFieldChanges(tx, component.fields, input.fields, null);
    if (plan.blockers.length) throw unprocessable('This change cannot be applied safely', plan.blockers);
    if (dryRun || plan.changes.length === 0) return { plan, applied: false };
    await applyFieldChanges(tx, { kind: 'component', id: component.id }, component.fields, input.fields, plan);
    await tx.component.update({ where: { id: component.id }, data: { schemaVersion: { increment: 1 } } });
    return { plan, applied: true };
  });

  if (result.applied) {
    const summary = result.plan.changes.map((c) => `${c.kind.replace('_', ' ')} ${c.label}`).join(', ');
    await schemaChanged(req, summary.slice(0, 480), { kind: 'component', id: component.id, apiId: component.apiId, version: component.schemaVersion + 1 }, result.plan);
    await audit(req, {
      action: 'schema.component.fields_changed',
      resourceType: 'component',
      resourceId: component.id,
      resourceLabel: component.displayName,
      before: { fields: component.fields.map((f) => `${f.apiId}:${f.type}`) },
      after: { fields: input.fields.map((f) => `${f.apiId}:${f.type}`) },
    });
  }
  const fresh = await loadSchema(environment.id);
  res.json({ ...result, component: fresh.components.find((c) => c.id === component.id) });
});

schemaRouter.delete('/components/:componentId', envScope('schema.manage'), async (req, res) => {
  const { environment } = envOf(req);
  const schema = await loadSchema(environment.id);
  const component = findComponent(req, schema);
  const usedBy = componentUsage(schema, component.apiId);
  if (usedBy.length) throw conflict(`This component is used by: ${usedBy.join(', ')}. Remove those fields first.`);
  await prisma.component.delete({ where: { id: component.id } });
  await schemaChanged(req, `Deleted component "${component.displayName}"`, { kind: 'component', id: component.id, apiId: component.apiId, version: component.schemaVersion + 1 }, {});
  await audit(req, {
    action: 'schema.component.deleted',
    resourceType: 'component',
    resourceId: component.id,
    resourceLabel: component.displayName,
    before: { apiId: component.apiId, fields: component.fields.map((f) => `${f.apiId}:${f.type}`) },
  });
  res.status(204).end();
});
