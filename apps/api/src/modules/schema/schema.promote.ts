import type { Prisma } from '@prisma/client';
import { type FieldDef, sameJson } from '@meridian/shared';
import type { ErrorDetail } from '../../lib/errors';
import { type FieldChange, type FieldInput, applyFieldChanges, planFieldChanges } from './schema.fields';
import { type EnvSchema, type LoadedComponent, type LoadedType, loadSchema } from './schema.service';

type Tx = Prisma.TransactionClient;

export interface PromotionItem {
  kind: 'type' | 'component';
  apiId: string;
  displayName: string;
  action: 'create' | 'update' | 'unchanged';
  changes: FieldChange[];
}

export interface PromotionPlan {
  items: PromotionItem[];
  /** Present in the target but not in the source. Promotion never deletes these. */
  onlyInTarget: { kind: 'type' | 'component'; apiId: string; displayName: string }[];
  blockers: ErrorDetail[];
  warnings: string[];
  requiresConfirmation: boolean;
}

/** Fields are matched across environments by API identifier, since row ids differ per environment. */
const asInput = (fields: FieldDef[]): FieldInput[] =>
  fields.map((f) => ({ apiId: f.apiId, label: f.label, type: f.type, required: f.required, unique: f.unique, localized: f.localized, config: f.config }));

const metaDiffers = (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) => keys.some((k) => !sameJson(a[k], b[k]));

/**
 * Copies the content model (components and content types) of one environment onto another
 * in the same project — the usual development → staging → production path.
 *
 * It reuses the ordinary schema-change planner, so the same guarantees hold: nothing that
 * would discard stored content is applied without confirmation, unsafe changes are blocked,
 * and the whole promotion is one transaction. Content itself is not copied.
 */
export async function promoteSchema(
  tx: Tx,
  sourceEnvironmentId: string,
  targetEnvironmentId: string,
  opts: { apply: boolean; confirmDestructive: boolean; userId: string | null },
): Promise<{ plan: PromotionPlan; applied: boolean }> {
  const [source, target] = await Promise.all([loadSchema(sourceEnvironmentId, tx), loadSchema(targetEnvironmentId, tx)]);
  const plan: PromotionPlan = { items: [], onlyInTarget: [], blockers: [], warnings: [], requiresConfirmation: false };
  const targetComponent = new Map(target.components.map((c) => [c.apiId, c]));
  const targetType = new Map(target.types.map((t) => [t.apiId, t]));
  const sourceTypes = source.types.filter((t) => !t.isSystem);

  const consider = async (kind: 'type' | 'component', src: LoadedType | LoadedComponent, existing: LoadedType | LoadedComponent | undefined, metaKeys: string[]) => {
    if (!existing) {
      plan.items.push({ kind, apiId: src.apiId, displayName: src.displayName, action: 'create', changes: src.fields.map((f) => ({ kind: 'added', apiId: f.apiId, label: f.label })) });
      return;
    }
    if (kind === 'type' && (existing as LoadedType).kind !== (src as LoadedType).kind) {
      plan.blockers.push({ path: src.apiId, message: `"${src.displayName}" is a ${(src as LoadedType).kind.toLowerCase()} type in the source but a ${(existing as LoadedType).kind.toLowerCase()} type in the target` });
      return;
    }
    const fieldPlan = await planFieldChanges(tx, existing.fields, asInput(src.fields), kind === 'type' ? existing.id : null);
    for (const blocker of fieldPlan.blockers) plan.blockers.push({ path: `${src.apiId}.${blocker.path ?? ''}`, message: `${src.displayName}: ${blocker.message}` });
    for (const warning of fieldPlan.warnings) plan.warnings.push(`${src.displayName}: ${warning}`);
    if (fieldPlan.requiresConfirmation) plan.requiresConfirmation = true;
    const changed = fieldPlan.changes.length > 0 || metaDiffers(src as never, existing as never, metaKeys);
    plan.items.push({ kind, apiId: src.apiId, displayName: src.displayName, action: changed ? 'update' : 'unchanged', changes: fieldPlan.changes });
  };

  for (const c of source.components) await consider('component', c, targetComponent.get(c.apiId), ['displayName', 'description', 'category', 'icon', 'isBlock']);
  for (const t of sourceTypes) await consider('type', t, targetType.get(t.apiId), ['displayName', 'singularName', 'pluralName', 'description', 'icon', 'options']);
  for (const c of target.components) if (!source.components.some((s) => s.apiId === c.apiId)) plan.onlyInTarget.push({ kind: 'component', apiId: c.apiId, displayName: c.displayName });
  for (const t of target.types) if (!t.isSystem && !sourceTypes.some((s) => s.apiId === t.apiId)) plan.onlyInTarget.push({ kind: 'type', apiId: t.apiId, displayName: t.displayName });

  const nothingToDo = plan.items.every((i) => i.action === 'unchanged');
  if (!opts.apply || plan.blockers.length > 0 || nothingToDo || (plan.requiresConfirmation && !opts.confirmDestructive)) {
    return { plan, applied: false };
  }

  // Pass 1: make sure every component and type exists, so fields can reference them in any order.
  for (const c of source.components) {
    const data = { displayName: c.displayName, description: c.description, category: c.category, icon: c.icon, isBlock: c.isBlock };
    const existing = targetComponent.get(c.apiId);
    if (existing) await tx.component.update({ where: { id: existing.id }, data });
    else await tx.component.create({ data: { ...data, environmentId: targetEnvironmentId, apiId: c.apiId } });
  }
  for (const t of sourceTypes) {
    const data = { displayName: t.displayName, singularName: t.singularName, pluralName: t.pluralName, description: t.description, icon: t.icon, options: t.options as Prisma.InputJsonValue };
    const existing = targetType.get(t.apiId);
    if (existing) await tx.contentType.update({ where: { id: existing.id }, data });
    else await tx.contentType.create({ data: { ...data, environmentId: targetEnvironmentId, apiId: t.apiId, kind: t.kind, createdById: opts.userId } });
  }

  // Pass 2: bring each field list in line, migrating stored entries where a change calls for it.
  const fresh: EnvSchema = await loadSchema(targetEnvironmentId, tx);
  for (const c of source.components) {
    const current = fresh.components.find((x) => x.apiId === c.apiId);
    if (!current) continue;
    const next = asInput(c.fields);
    const fieldPlan = await planFieldChanges(tx, current.fields, next, null);
    if (fieldPlan.changes.length === 0) continue;
    await applyFieldChanges(tx, { kind: 'component', id: current.id }, current.fields, next, fieldPlan);
    await tx.component.update({ where: { id: current.id }, data: { schemaVersion: { increment: 1 } } });
  }
  for (const t of sourceTypes) {
    const current = fresh.typeByApiId.get(t.apiId);
    if (!current) continue;
    const next = asInput(t.fields);
    const fieldPlan = await planFieldChanges(tx, current.fields, next, current.id);
    if (fieldPlan.changes.length === 0) continue;
    await applyFieldChanges(tx, { kind: 'type', id: current.id }, current.fields, next, fieldPlan);
    await tx.contentType.update({ where: { id: current.id }, data: { schemaVersion: { increment: 1 } } });
  }
  return { plan, applied: true };
}
