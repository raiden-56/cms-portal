/** The management API (/admin/api) of the demo backend: route table, dispatch and the scheduler sweep. */
import { type Actor, type Ctx, SYSTEM_ACTOR, audit, defaultLocaleOf, guestActor, loadSchema } from './context';
import { db, nowIso, replaceState } from './db';
import { type Engine, publishEntry, unpublishEntry } from './engine';
import { type DemoRequest, type DemoResponse, HttpError, Reply, errorReply, notFound, parseQuery } from './http';
import { Router } from './router';
import { analyticsRoutes } from './routes/analytics';
import { developerRoutes } from './routes/developers';
import { entryRoutes } from './routes/entries';
import { mediaRoutes, serializeBody } from './routes/media';
import { orgRoutes } from './routes/org';
import { publishRelease, releaseRoutes } from './routes/releases';
import { schemaRoutes } from './routes/schema';

const router = new Router();
orgRoutes(router);
schemaRoutes(router);
entryRoutes(router);
mediaRoutes(router);
releaseRoutes(router);
developerRoutes(router);
analyticsRoutes(router);

/** Detaches a response from the live database, the way serialising it over HTTP would. */
function toResponse(reply: Reply): DemoResponse {
  return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, headers: { 'content-type': 'application/json; charset=utf-8', ...reply.headers }, body: serializeBody(reply.body) };
}

export interface DispatchOptions {
  /** Who performs the request. Defaults to the guest; the seed uses other members to build history. */
  actor?: Actor;
  /** Skip the rollback snapshot (seeding: the whole database is being built anyway). */
  unguarded?: boolean;
}

/** Runs one management request against the in-memory database. A failed mutation leaves no trace. */
export function dispatch(request: DemoRequest, opts: DispatchOptions = {}): DemoResponse {
  const mutating = request.method !== 'GET';
  const snapshot = mutating && !opts.unguarded ? structuredClone(db) : null;
  try {
    const match = router.match(request.method, request.path);
    if (!match) throw notFound('Route');
    const c: Ctx = { method: request.method, params: match.params, query: parseQuery(request.query), body: request.body, actor: opts.actor ?? guestActor() };
    const result = match.handler(c);
    return toResponse(result instanceof Reply ? result : new Reply(200, result));
  } catch (err) {
    if (snapshot && !(err instanceof HttpError && err.keepChanges)) replaceState(snapshot);
    return toResponse(errorReply(err));
  }
}

function systemEngine(environmentId: string): Engine | null {
  const environment = db.environments.find((e) => e.id === environmentId);
  const project = environment && db.projects.find((p) => p.id === environment.projectId && !p.deletedAt);
  if (!environment || !project) return null;
  return { scope: { project, environment }, schema: loadSchema(environment.id), defaultLocale: defaultLocaleOf(project.id), actor: SYSTEM_ACTOR };
}

/**
 * Executes everything that is due: scheduled publishes, unpublishes and releases. A server
 * runs this on a timer; here it runs before each request, so schedules fire while the
 * demo is open (or the next time it is opened). Returns true when anything changed.
 */
export function runScheduledWork(): boolean {
  const at = nowIso();
  let changed = false;

  for (const due of db.entries.filter((e) => e.scheduledPublishAt && e.scheduledPublishAt <= at && !e.deletedAt)) {
    const ctx = systemEngine(due.environmentId);
    if (!ctx) continue;
    changed = true;
    try {
      const type = ctx.schema.typeById.get(due.contentTypeId);
      if (!type) throw new Error('Content type no longer exists');
      // Approval was verified when the schedule was set, and editing afterwards cancels the schedule.
      publishEntry(ctx, type, due.id, { note: 'Scheduled publish', skipApproval: true });
    } catch (err) {
      // Clear the schedule so a broken entry is not retried forever, and leave a trace for editors.
      due.scheduledPublishAt = null;
      due.status = 'DRAFT';
      audit({ actor: SYSTEM_ACTOR, project: ctx.scope.project, environment: ctx.scope.environment }, { action: 'entry.schedule_failed', resourceType: 'entry', resourceId: due.id, resourceLabel: due.title, metadata: { reason: (err as Error).message } });
    }
  }

  for (const due of db.entries.filter((e) => e.scheduledUnpublishAt && e.scheduledUnpublishAt <= at && !e.deletedAt)) {
    const ctx = systemEngine(due.environmentId);
    const type = ctx?.schema.typeById.get(due.contentTypeId);
    changed = true;
    try {
      if (ctx && type && due.publishedAt) unpublishEntry(ctx, type, due.id);
      else due.scheduledUnpublishAt = null;
    } catch {
      due.scheduledUnpublishAt = null;
    }
  }

  for (const due of db.releases.filter((x) => x.status === 'SCHEDULED' && x.scheduledAt && x.scheduledAt <= at)) {
    const ctx = systemEngine(due.environmentId);
    if (!ctx) continue;
    changed = true;
    try {
      publishRelease(ctx, due.id);
    } catch {
      // publishRelease has already marked the release FAILED with the reason.
    }
  }
  return changed;
}
