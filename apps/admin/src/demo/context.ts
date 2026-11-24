/** Request context and the helpers every handler shares: scoping, schema, audit trail, events. */
import { BUILTIN_COMPONENTS, type BlockDefinition, type ContentEvent, type EventType, type FieldDef, PAGE_TYPE_ID, buildBlockRegistry, newId } from '@meridian/shared';
import { type DbAudit, type DbComponent, type DbEnvironment, type DbProject, type DbType, type DbUser, type Json, db, nowIso } from './db';
import { notFound } from './http';

export interface Actor {
  type: 'user' | 'token' | 'system';
  id: string | null;
  label: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null, label: 'Scheduler' };

export interface Ctx {
  method: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  actor: Actor;
  /** Filled in by the scope helpers below, so the audit trail knows where an action happened. */
  project?: DbProject;
  environment?: DbEnvironment;
}

export const guest = (): DbUser => {
  const user = db.users.find((u) => u.id === db.userId);
  if (!user) throw notFound('User');
  return user;
};

export const guestActor = (): Actor => ({ type: 'user', id: db.userId, label: guest().name });

export const userId = (c: Ctx): string | null => (c.actor.type === 'user' ? c.actor.id : null);

export const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

// ─── Scope ───────────────────────────────────────────────────────────────────

export function orgScope(c: Ctx): void {
  if (c.params.orgId !== db.organization.id) throw notFound('Organization');
}

export function projectScope(c: Ctx): DbProject {
  const project = db.projects.find((p) => p.id === c.params.projectId && !p.deletedAt);
  if (!project) throw notFound('Project');
  c.project = project;
  return project;
}

export function envScope(c: Ctx): { environment: DbEnvironment; project: DbProject } {
  const environment = db.environments.find((e) => e.id === c.params.envId);
  const project = environment && db.projects.find((p) => p.id === environment.projectId && !p.deletedAt);
  if (!environment || !project) throw notFound('Environment');
  c.environment = environment;
  c.project = project;
  return { environment, project };
}

export function defaultLocaleOf(projectId: string): string {
  return db.locales.find((l) => l.projectId === projectId && l.isDefault)?.code ?? 'en';
}

export function userNames(): Map<string, string> {
  return new Map(db.users.map((u) => [u.id, u.name]));
}

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface EnvSchema {
  environmentId: string;
  types: DbType[];
  typeByApiId: Map<string, DbType>;
  typeById: Map<string, DbType>;
  components: DbComponent[];
  /** Field lists by component apiId, including the built-in block item components. */
  componentFields: Record<string, FieldDef[]>;
  blockRegistry: Record<string, BlockDefinition>;
}

const byPosition = (fields: FieldDef[]) => [...fields].sort((a, b) => a.position - b.position);

export function loadSchema(environmentId: string): EnvSchema {
  const types = db.contentTypes
    .filter((t) => t.environmentId === environmentId)
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.displayName.localeCompare(b.displayName));
  const components = db.components
    .filter((c) => c.environmentId === environmentId)
    .sort((a, b) => a.category.localeCompare(b.category) || a.displayName.localeCompare(b.displayName));
  for (const owner of [...types, ...components]) owner.fields = byPosition(owner.fields);
  const componentFields: Record<string, FieldDef[]> = { ...BUILTIN_COMPONENTS };
  for (const c of components) componentFields[c.apiId] = c.fields;
  return {
    environmentId,
    types,
    typeByApiId: new Map(types.map((t) => [t.apiId, t])),
    typeById: new Map(types.map((t) => [t.id, t])),
    components,
    componentFields,
    blockRegistry: buildBlockRegistry(components.filter((c) => c.isBlock)),
  };
}

export const isPageType = (type: Pick<DbType, 'apiId' | 'isSystem'>): boolean => type.isSystem && type.apiId === PAGE_TYPE_ID;

// ─── Audit trail ─────────────────────────────────────────────────────────────

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Json;
  projectId?: string | null;
  environmentId?: string | null;
  actor?: Actor;
}

/** Every mutating action in guest mode is recorded, exactly as the API records it. */
export function audit(c: Pick<Ctx, 'actor' | 'project' | 'environment'>, input: AuditInput): DbAudit {
  const actor = input.actor ?? c.actor;
  const row: DbAudit = {
    id: newId(),
    organizationId: db.organization.id,
    projectId: input.projectId ?? c.project?.id ?? null,
    environmentId: input.environmentId ?? c.environment?.id ?? null,
    actorType: actor.type,
    actorId: actor.id,
    actorLabel: actor.label,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    resourceLabel: input.resourceLabel ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    metadata: input.metadata ?? null,
    // There is no network hop in guest mode, so there is no address to record.
    ip: null,
    createdAt: nowIso(),
  };
  db.audit.push(row);
  return row;
}

// ─── Events and webhooks ─────────────────────────────────────────────────────

export const SIMULATED_NOTE = 'Simulated in guest mode: no HTTP request left this browser. A Meridian server would POST this payload to the endpoint and record its real answer here.';

export interface EventScope {
  project: DbProject;
  environment: DbEnvironment;
}

/** Records, for each subscribed webhook, the delivery a server would have attempted — labelled as simulated. */
export function simulateDelivery(webhookId: string, event: string, payload: Json): string {
  const at = nowIso();
  const id = newId();
  db.deliveries.push({
    id,
    webhookId,
    eventId: String(payload.id ?? newId()),
    event,
    payload: { ...payload, simulated: true },
    status: 'SUCCESS',
    attempts: 1,
    responseStatus: null,
    responseBody: SIMULATED_NOTE,
    error: null,
    durationMs: 0,
    nextRetryAt: null,
    createdAt: at,
    completedAt: at,
  });
  return id;
}

export function emitEvent(scope: EventScope, event: Omit<Partial<ContentEvent>, 'event'> & { event: EventType }): void {
  const payload: ContentEvent = {
    ...event,
    id: newId(),
    event: event.event,
    organization: db.organization.slug,
    project: scope.project.slug,
    projectId: scope.project.id,
    environment: scope.environment.key,
    environmentId: scope.environment.id,
    timestamp: nowIso(),
  };
  for (const hook of db.webhooks) {
    if (hook.environmentId !== scope.environment.id || !hook.isActive) continue;
    if (!hook.events.includes('*') && !hook.events.includes(event.event)) continue;
    simulateDelivery(hook.id, event.event, payload as unknown as Json);
  }
}
