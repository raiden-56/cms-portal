/**
 * The content engine: create, save, publish, schedule, workflow, versions, trash.
 * It enforces the same rules as the API's entries service — validation on publish, unique
 * fields, optimistic locking, approval before publish — so the screens behave the same.
 */
import {
  type BlockNode,
  type EntryStatus,
  type FieldDef,
  type PageData,
  type ValidationIssue,
  type WorkflowAction,
  WORKFLOW_TRANSITIONS,
  canTransition,
  collectReferences,
  isSecretValue,
  isUuid,
  newId,
  sameJson,
  slugify,
  validateEntryData,
  validatePageData,
  walkBlocks,
} from '@meridian/shared';
import { type Actor, type EnvSchema, type EventScope, audit, emitEvent, isPageType } from './context';
import { type DbEntry, type DbType, type DbVersion, type Json, db, now, nowIso } from './db';
import { badRequest, conflict, notFound, unprocessable } from './http';

export interface Engine {
  scope: EventScope;
  schema: EnvSchema;
  actor: Actor;
  defaultLocale: string;
}

interface Prepared {
  data: Json;
  issues: ValidationIssue[];
  title: string | null;
  slug: string | null;
}

function pickTitle(type: DbType, data: Json): string | null {
  const preferred = type.options.titleField ? data[type.options.titleField] : undefined;
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim().slice(0, 300);
  for (const f of type.fields) {
    const value = data[f.apiId];
    if ((f.type === 'text' || f.type === 'textarea') && typeof value === 'string' && value.trim()) return value.trim().slice(0, 300);
  }
  return null;
}

function pickSlug(type: DbType, data: Json): string | null {
  const field = type.fields.find((f) => f.type === 'slug') ?? type.fields.find((f) => f.type === 'uid');
  const value = field ? data[field.apiId] : undefined;
  return typeof value === 'string' && value ? value.slice(0, 300) : null;
}

/** Validates input against the content model and derives the denormalised title and slug. */
export function prepareData(schema: EnvSchema, type: DbType, input: unknown, mode: 'draft' | 'publish'): Prepared {
  if (isPageType(type)) {
    const result = validatePageData(input, { mode, registry: schema.blockRegistry, components: schema.componentFields });
    return { data: result.data as unknown as Json, issues: result.issues, title: result.data.title || null, slug: result.data.slug ?? '' };
  }
  const result = validateEntryData(type.fields, input, { mode, components: schema.componentFields });
  // Slug fields left empty are generated from their source field.
  for (const f of type.fields) {
    if (f.type !== 'slug' || result.data[f.apiId]) continue;
    const source = f.config.sourceField ? result.data[f.config.sourceField] : undefined;
    if (typeof source === 'string' && source.trim()) result.data[f.apiId] = slugify(source);
  }
  return { data: result.data, issues: result.issues, title: pickTitle(type, result.data), slug: pickSlug(type, result.data) };
}

/** `password` fields are never kept in plaintext: the demo stores only a marker that a secret was set. */
function sealSecrets(type: DbType, data: Json, previous?: Json) {
  for (const f of type.fields) {
    if (f.type !== 'password') continue;
    const value = data[f.apiId];
    if (typeof value === 'string' && value) data[f.apiId] = { $secret: 'sealed-in-guest-mode' };
    else if (!isSecretValue(value)) data[f.apiId] = isSecretValue(previous?.[f.apiId]) ? previous?.[f.apiId] : null;
  }
}

const shapeErrors = (issues: ValidationIssue[]) => issues.map((i) => ({ path: i.path, message: i.message, code: i.code }));

function assertUnique(type: DbType, entry: { documentId: string; locale: string }, data: Json) {
  const problems: ValidationIssue[] = [];
  for (const f of type.fields) {
    if (!f.unique) continue;
    const value = data[f.apiId];
    if (value === null || value === undefined || value === '') continue;
    const text = typeof value === 'string' ? value : String(value);
    const taken = db.entries.some(
      (e) => e.contentTypeId === type.id && !e.deletedAt && e.locale === entry.locale && e.documentId !== entry.documentId && e.data[f.apiId] !== null && e.data[f.apiId] !== undefined && String(e.data[f.apiId]) === text,
    );
    if (taken) problems.push({ path: f.apiId, code: 'not_unique', message: `${f.label} must be unique — "${text}" is already used by another entry` });
  }
  if (problems.length) throw unprocessable('Some values are already in use', shapeErrors(problems));
}

// ─── Pages: paths and tree ───────────────────────────────────────────────────

const joinPath = (parent: string | null | undefined, slug: string | null | undefined): string => {
  const base = !parent || parent === '/' ? '' : parent;
  return slug ? `${base}/${slug}` : base || '/';
};

function resolvePagePath(entry: { id?: string; environmentId: string; locale: string; contentTypeId: string }, slug: string, parentId: string | null): string {
  let parentPath: string | null = null;
  if (parentId) {
    if (parentId === entry.id) throw badRequest('A page cannot be its own parent');
    const parent = db.entries.find((e) => e.id === parentId && e.environmentId === entry.environmentId && e.contentTypeId === entry.contentTypeId && !e.deletedAt);
    if (!parent) throw badRequest('Parent page does not exist');
    // Walk up to make sure the new parent is not one of this page's own descendants.
    let cursor = parent.parentId;
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      if (cursor === entry.id) throw badRequest('A page cannot be moved underneath one of its own child pages');
      const at: string = cursor;
      cursor = db.entries.find((e) => e.id === at)?.parentId ?? null;
    }
    parentPath = parent.path;
  }
  const path = joinPath(parentPath, slug);
  const clash = db.entries.find(
    (e) => e.environmentId === entry.environmentId && e.contentTypeId === entry.contentTypeId && e.locale === entry.locale && e.path === path && !e.deletedAt && e.id !== entry.id,
  );
  if (clash) {
    throw unprocessable('Another page already uses this URL', [{ path: 'slug', message: `"${path}" is already used by "${clash.title ?? 'another page'}"`, code: 'not_unique' }]);
  }
  return path;
}

/** Recomputes the paths of every descendant after a page's slug or parent changed. */
function repathDescendants(parentId: string, parentPath: string, column: 'path' | 'publishedPath') {
  for (const child of db.entries.filter((e) => e.parentId === parentId && !e.deletedAt)) {
    if (column === 'publishedPath' && !child.publishedAt) continue;
    const next = joinPath(parentPath, column === 'path' ? child.slug : child.publishedSlug);
    child[column] = next;
    repathDescendants(child.id, next, column);
  }
}

// ─── References ──────────────────────────────────────────────────────────────

function mediaOf(schema: EnvSchema, type: DbType, data: Json | null | undefined): string[] {
  if (!data) return [];
  if (!isPageType(type)) return collectReferences(type.fields, data, schema.componentFields).media;
  const page = data as unknown as PageData;
  const media = new Set<string>();
  if (isUuid(page.seo?.ogImage)) media.add(page.seo.ogImage);
  walkBlocks((page.blocks ?? []) as BlockNode[], (node) => {
    const def = schema.blockRegistry[node.type];
    if (def) collectReferences(def.fields, node.props ?? {}, schema.componentFields).media.forEach((id) => media.add(id));
    const bg = node.style?.background?.imageId;
    if (isUuid(bg)) media.add(bg);
  });
  return [...media];
}

/** Media ids an entry refers to, in its working copy or its live snapshot. */
export function entryMedia(schema: EnvSchema, type: DbType, entry: DbEntry): string[] {
  return [...new Set([...mediaOf(schema, type, entry.data), ...mediaOf(schema, type, entry.publishedData)])];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const actorUserId = (ctx: Engine) => (ctx.actor.type === 'user' ? ctx.actor.id : null);

const eventName = (type: DbType, kind: 'published' | 'unpublished') => (isPageType(type) ? (`page.${kind}` as const) : (`content.${kind}` as const));

function describe(type: DbType, entry: DbEntry) {
  return {
    contentType: type.apiId,
    documentId: entry.documentId,
    entryId: entry.id,
    locale: entry.locale,
    slug: entry.publishedSlug ?? entry.slug,
    path: entry.publishedPath ?? entry.path,
    title: entry.publishedTitle ?? entry.title,
  };
}

function record(ctx: Engine, action: string, type: DbType, entry: DbEntry, extra: { before?: unknown; after?: unknown; metadata?: Json } = {}) {
  audit(
    { actor: ctx.actor, project: ctx.scope.project, environment: ctx.scope.environment },
    {
      action,
      resourceType: isPageType(type) ? 'page' : 'entry',
      resourceId: entry.id,
      resourceLabel: entry.title ?? `${type.singularName} ${entry.documentId.slice(0, 8)}`,
      metadata: { contentType: type.apiId, documentId: entry.documentId, locale: entry.locale, ...extra.metadata },
      before: extra.before,
      after: extra.after,
    },
  );
}

const versionsOf = (entryId: string) => db.versions.filter((v) => v.entryId === entryId);
const nextVersionNumber = (entryId: string) => versionsOf(entryId).reduce((max, v) => Math.max(max, v.number), 0) + 1;

function addVersion(entry: DbEntry, kind: DbVersion['kind'], note: string | null, createdById: string | null): DbVersion {
  const at = nowIso();
  const version: DbVersion = { id: newId(), entryId: entry.id, number: nextVersionNumber(entry.id), kind, data: structuredClone(entry.data), title: entry.title, note, createdById, createdAt: at, updatedAt: at };
  db.versions.push(version);
  return version;
}

function touch(entry: DbEntry) {
  entry.lockVersion += 1;
  entry.updatedAt = nowIso();
}

export function getEntry(environmentId: string, id: string, opts: { includeDeleted?: boolean } = {}): DbEntry {
  const entry = isUuid(id) ? db.entries.find((e) => e.id === id && e.environmentId === environmentId && (opts.includeDeleted || !e.deletedAt)) : undefined;
  if (!entry) throw notFound('Entry');
  return entry;
}

function ownEntry(ctx: Engine, type: DbType, entryId: string, opts: { includeDeleted?: boolean } = {}): DbEntry {
  const entry = getEntry(ctx.scope.environment.id, entryId, opts);
  if (entry.contentTypeId !== type.id) throw notFound('Entry');
  return entry;
}

// ─── Create and save ─────────────────────────────────────────────────────────

export interface CreateInput {
  data: unknown;
  locale?: string;
  parentId?: string | null;
  /** Create a new locale variant of an existing document. */
  documentId?: string;
}

export function createEntry(ctx: Engine, type: DbType, input: CreateInput): DbEntry {
  const environmentId = ctx.scope.environment.id;
  const locale = input.locale ?? ctx.defaultLocale;
  const isPage = isPageType(type);
  if (locale !== ctx.defaultLocale && !type.options.localized) {
    throw badRequest(`"${type.displayName}" is not localized. Enable localization on the content type to add translations.`);
  }
  const prepared = prepareData(ctx.schema, type, input.data, 'draft');
  if (prepared.issues.length) throw unprocessable('Some fields are invalid', shapeErrors(prepared.issues));
  sealSecrets(type, prepared.data);

  const documentId = input.documentId ?? newId();
  const ofType = db.entries.filter((e) => e.environmentId === environmentId && e.contentTypeId === type.id);
  if (input.documentId) {
    if (!ofType.some((e) => e.documentId === documentId)) throw badRequest('The document to translate does not exist');
    if (db.entries.some((e) => e.documentId === documentId && e.locale === locale)) throw conflict(`This document already has a "${locale}" translation`);
  } else if (type.kind === 'SINGLE') {
    const existing = ofType.find((e) => e.locale === locale && !e.deletedAt);
    if (existing) throw conflict(`"${type.displayName}" is a single type and already has its entry`, { entryId: existing.id });
  }
  assertUnique(type, { documentId, locale }, prepared.data);
  const parentId = isPage ? (input.parentId ?? null) : null;
  const path = isPage ? resolvePagePath({ environmentId, locale, contentTypeId: type.id }, prepared.slug ?? '', parentId) : null;
  const position = isPage ? ofType.filter((e) => e.parentId === parentId && !e.deletedAt).length : 0;
  const at = nowIso();
  const author = actorUserId(ctx);
  const entry: DbEntry = {
    id: newId(),
    environmentId,
    contentTypeId: type.id,
    documentId,
    locale,
    title: prepared.title,
    slug: prepared.slug,
    path,
    parentId,
    position,
    data: prepared.data,
    status: 'DRAFT',
    publishedData: null,
    publishedTitle: null,
    publishedSlug: null,
    publishedPath: null,
    publishedVersionId: null,
    publishedAt: null,
    firstPublishedAt: null,
    scheduledPublishAt: null,
    scheduledUnpublishAt: null,
    lockVersion: 0,
    assigneeId: null,
    createdById: author,
    updatedById: author,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  db.entries.push(entry);
  addVersion(entry, 'SAVE', 'Created', author);
  record(ctx, 'entry.created', type, entry, { after: entry.data });
  emitEvent(ctx.scope, { event: 'content.created', ...describe(type, entry) });
  return entry;
}

export interface UpdateInput {
  data: unknown;
  /** The lockVersion the client loaded. A mismatch means the content changed since it was opened. */
  lockVersion?: number;
  autosave?: boolean;
  note?: string;
  parentId?: string | null;
}

const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000;

export function updateEntry(ctx: Engine, type: DbType, entryId: string, input: UpdateInput): DbEntry {
  const current = ownEntry(ctx, type, entryId);
  if (current.status === 'ARCHIVED') throw conflict('Archived content is read-only. Restore it from the archive to edit.');
  const prepared = prepareData(ctx.schema, type, input.data, 'draft');
  if (prepared.issues.length) throw unprocessable('Some fields are invalid', shapeErrors(prepared.issues));
  sealSecrets(type, prepared.data, current.data);

  const isPage = isPageType(type);
  const parentId = isPage ? (input.parentId === undefined ? current.parentId : input.parentId) : null;
  const dataChanged = !sameJson(prepared.data, current.data);
  const moved = isPage && parentId !== current.parentId;
  if (!dataChanged && !moved) return current;

  if (input.lockVersion !== undefined && input.lockVersion !== current.lockVersion) {
    const editor = current.updatedById ? db.users.find((u) => u.id === current.updatedById) : null;
    throw conflict('This content was changed by someone else since you opened it.', {
      currentLockVersion: current.lockVersion,
      updatedBy: editor?.name ?? null,
      updatedAt: current.updatedAt,
    });
  }
  assertUnique(type, current, prepared.data);
  const path = isPage ? resolvePagePath(current, prepared.slug ?? '', parentId) : null;
  const before = current.data;
  const previousPath = current.path;

  // Editing approved or published content returns it to draft: approval covers exact content.
  if (dataChanged && (current.status === 'PUBLISHED' || current.status === 'APPROVED')) current.status = 'DRAFT';
  // Where approval is mandatory, a schedule was granted for the approved content only: editing cancels it.
  if (dataChanged && current.status === 'SCHEDULED' && type.options.requireApproval) {
    current.status = 'DRAFT';
    current.scheduledPublishAt = null;
  }
  const author = actorUserId(ctx);
  current.data = prepared.data;
  current.title = prepared.title;
  current.slug = prepared.slug;
  current.path = path;
  current.parentId = parentId;
  current.updatedById = author;
  touch(current);

  if (dataChanged) {
    const latest = versionsOf(entryId).sort((a, b) => b.number - a.number)[0];
    const coalesce = input.autosave && latest?.kind === 'AUTOSAVE' && latest.createdById === author && now().getTime() - Date.parse(latest.updatedAt) < AUTOSAVE_WINDOW_MS;
    if (coalesce && latest) {
      // Autosaves by the same editor within the window fold into one version instead of flooding history.
      latest.data = structuredClone(prepared.data);
      latest.title = prepared.title;
      latest.updatedAt = nowIso();
    } else {
      addVersion(current, input.autosave ? 'AUTOSAVE' : 'SAVE', input.note?.slice(0, 500) || null, author);
    }
  }
  if (isPage && path !== previousPath) repathDescendants(entryId, path ?? '/', 'path');

  if (!input.autosave) {
    record(ctx, 'entry.updated', type, current, { before, after: current.data });
    emitEvent(ctx.scope, { event: 'content.updated', ...describe(type, current) });
  }
  return current;
}

// ─── Publishing ──────────────────────────────────────────────────────────────

/** The publish step itself, without audit or events. Shared by single publish, bulk publish, scheduling and releases. */
export function publishCore(ctx: Engine, type: DbType, entry: DbEntry, opts: { note?: string; skipApproval?: boolean } = {}): DbEntry {
  if (entry.status === 'ARCHIVED') throw conflict('Archived content cannot be published. Restore it first.');
  const prepared = prepareData(ctx.schema, type, entry.data, 'publish');
  if (prepared.issues.length) throw unprocessable(`"${entry.title ?? type.singularName}" is not ready to publish`, shapeErrors(prepared.issues));

  const unchangedLive = entry.publishedAt && sameJson(entry.publishedData, entry.data);
  if (type.options.requireApproval && !opts.skipApproval && entry.status !== 'APPROVED' && !unchangedLive) {
    throw conflict(`"${type.displayName}" requires approval before publishing. Submit this ${type.singularName.toLowerCase()} for review first.`, { status: entry.status });
  }
  assertUnique(type, entry, prepared.data);
  const author = actorUserId(ctx);
  const version = addVersion(entry, 'PUBLISH', opts.note?.slice(0, 500) || null, author);
  const at = nowIso();
  entry.status = 'PUBLISHED';
  entry.publishedData = structuredClone(entry.data);
  entry.publishedTitle = entry.title;
  entry.publishedSlug = entry.slug;
  entry.publishedPath = entry.path;
  entry.publishedVersionId = version.id;
  entry.publishedAt = at;
  entry.firstPublishedAt = entry.firstPublishedAt ?? at;
  entry.scheduledPublishAt = null;
  entry.updatedById = author ?? entry.updatedById;
  touch(entry);
  if (isPageType(type)) repathDescendants(entry.id, entry.publishedPath ?? '/', 'publishedPath');
  return entry;
}

export function publishEntry(ctx: Engine, type: DbType, entryId: string, opts: { note?: string; skipApproval?: boolean } = {}): DbEntry {
  const published = publishCore(ctx, type, ownEntry(ctx, type, entryId), opts);
  record(ctx, 'entry.published', type, published, { metadata: { versionId: published.publishedVersionId } });
  emitEvent(ctx.scope, { event: eventName(type, 'published'), ...describe(type, published) });
  return published;
}

export function unpublishCore(ctx: Engine, entry: DbEntry, status: EntryStatus = 'DRAFT'): DbEntry {
  entry.status = status;
  entry.publishedData = null;
  entry.publishedTitle = null;
  entry.publishedSlug = null;
  entry.publishedPath = null;
  entry.publishedVersionId = null;
  entry.publishedAt = null;
  entry.scheduledUnpublishAt = null;
  entry.updatedById = actorUserId(ctx) ?? entry.updatedById;
  touch(entry);
  return entry;
}

export function unpublishEntry(ctx: Engine, type: DbType, entryId: string): DbEntry {
  const entry = ownEntry(ctx, type, entryId);
  if (!entry.publishedAt) throw conflict('This content is not published');
  const before = describe(type, entry);
  unpublishCore(ctx, entry, entry.status === 'PUBLISHED' ? 'DRAFT' : entry.status);
  record(ctx, 'entry.unpublished', type, entry);
  emitEvent(ctx.scope, { event: eventName(type, 'unpublished'), ...before });
  return entry;
}

export function scheduleEntry(ctx: Engine, type: DbType, entryId: string, input: { publishAt?: Date | null; unpublishAt?: Date | null }): DbEntry {
  const entry = ownEntry(ctx, type, entryId);
  if (entry.status === 'ARCHIVED') throw conflict('Archived content cannot be scheduled');
  const at = now().getTime();
  if (input.publishAt && input.publishAt.getTime() <= at) throw badRequest('Publish time must be in the future');
  if (input.unpublishAt && input.unpublishAt.getTime() <= at) throw badRequest('Unpublish time must be in the future');
  const publishAt = input.publishAt === undefined ? entry.scheduledPublishAt : (input.publishAt?.toISOString() ?? null);
  const unpublishAt = input.unpublishAt === undefined ? entry.scheduledUnpublishAt : (input.unpublishAt?.toISOString() ?? null);
  if (publishAt && unpublishAt && unpublishAt <= publishAt) throw badRequest('Unpublish time must be after the publish time');
  if (unpublishAt && !publishAt && !entry.publishedAt) throw badRequest('Only published or scheduled content can be scheduled to unpublish');

  if (input.publishAt) {
    // Surface problems now rather than when the schedule fires.
    const check = prepareData(ctx.schema, type, entry.data, 'publish');
    if (check.issues.length) throw unprocessable('This content is not ready to publish, so it cannot be scheduled', shapeErrors(check.issues));
    if (type.options.requireApproval && entry.status !== 'APPROVED') throw conflict(`"${type.displayName}" requires approval before it can be scheduled.`);
  }
  if (publishAt) entry.status = 'SCHEDULED';
  else if (entry.status === 'SCHEDULED') entry.status = entry.publishedAt && sameJson(entry.data, entry.publishedData) ? 'PUBLISHED' : 'DRAFT';
  entry.scheduledPublishAt = publishAt;
  entry.scheduledUnpublishAt = unpublishAt;
  touch(entry);
  record(ctx, publishAt || unpublishAt ? 'entry.scheduled' : 'entry.unscheduled', type, entry, { metadata: { publishAt, unpublishAt } });
  if (input.publishAt) emitEvent(ctx.scope, { event: 'content.scheduled', ...describe(type, entry) });
  return entry;
}

// ─── Workflow ────────────────────────────────────────────────────────────────

/** Moves an entry through the editorial workflow (submit, approve, request changes, archive…). */
export function transitionEntry(ctx: Engine, type: DbType, entryId: string, action: WorkflowAction, comment?: string): DbEntry {
  if (action === 'publish' || action === 'unpublish' || action === 'schedule' || action === 'unschedule') throw badRequest(`Use the dedicated endpoint to ${action}`);
  const entry = ownEntry(ctx, type, entryId);
  const transition = WORKFLOW_TRANSITIONS[action];
  if (!canTransition(action, entry.status)) {
    throw conflict(`Cannot ${transition.label.toLowerCase()} while the status is ${entry.status.replace(/_/g, ' ').toLowerCase()}`);
  }
  if (action === 'request_changes' && !comment?.trim()) throw badRequest('Explain what needs to change');
  if (action === 'submit') {
    const check = prepareData(ctx.schema, type, entry.data, 'publish');
    if (check.issues.length) throw unprocessable('Complete the required fields before submitting for review', shapeErrors(check.issues));
  }
  const wasLive = !!entry.publishedAt;
  const before = describe(type, entry);
  const previousStatus = entry.status;
  if (action === 'archive') {
    // Archiving takes live content offline and cancels anything scheduled for it.
    if (wasLive) unpublishCore(ctx, entry, 'ARCHIVED');
    entry.status = 'ARCHIVED';
    entry.scheduledPublishAt = null;
    entry.scheduledUnpublishAt = null;
  } else {
    entry.status = transition.to;
  }
  touch(entry);
  const author = actorUserId(ctx);
  if (comment?.trim() && author) {
    db.comments.push({
      id: newId(),
      entryId: entry.id,
      userId: author,
      body: comment.trim().slice(0, 4000),
      kind: action === 'request_changes' ? 'changes_requested' : action === 'approve' ? 'approval' : 'comment',
      resolvedAt: null,
      createdAt: nowIso(),
    });
  }
  record(ctx, `entry.${action}`, type, entry, { before: { status: previousStatus }, after: { status: entry.status }, metadata: comment ? { comment } : undefined });
  if (action === 'archive' && wasLive) emitEvent(ctx.scope, { event: eventName(type, 'unpublished'), ...before });
  return entry;
}

// ─── Versions, trash, duplicate ──────────────────────────────────────────────

export function restoreVersion(ctx: Engine, type: DbType, entryId: string, versionId: string): DbEntry {
  const entry = ownEntry(ctx, type, entryId);
  if (entry.status === 'ARCHIVED') throw conflict('Restore this content from the archive before restoring a version');
  const version = db.versions.find((v) => v.id === versionId && v.entryId === entryId);
  if (!version) throw notFound('Version');
  // Re-validate against today's schema: fields removed since then are dropped, new ones start empty.
  const prepared = prepareData(ctx.schema, type, version.data, 'draft');
  if (isPageType(type)) {
    // The page keeps its current URL; only content is rolled back.
    (prepared.data as unknown as PageData).slug = entry.slug ?? '';
    prepared.slug = entry.slug ?? '';
  }
  assertUnique(type, entry, prepared.data);
  const before = entry.data;
  const author = actorUserId(ctx);
  entry.data = prepared.data;
  entry.title = prepared.title;
  entry.slug = isPageType(type) ? entry.slug : prepared.slug;
  if (entry.status === 'PUBLISHED' || entry.status === 'APPROVED') entry.status = 'DRAFT';
  entry.updatedById = author;
  touch(entry);
  addVersion(entry, 'RESTORE', `Restored from version ${version.number}`, author);
  record(ctx, 'entry.version_restored', type, entry, { metadata: { restoredVersion: version.number }, before, after: entry.data });
  emitEvent(ctx.scope, { event: 'content.updated', ...describe(type, entry) });
  return entry;
}

export function deleteEntry(ctx: Engine, type: DbType, entryId: string, opts: { permanent?: boolean } = {}): void {
  const entry = ownEntry(ctx, type, entryId, { includeDeleted: true });
  if (isPageType(type) && !entry.deletedAt) {
    const children = db.entries.filter((e) => e.parentId === entry.id && !e.deletedAt).length;
    if (children > 0) throw conflict(`This page has ${children} child page${children === 1 ? '' : 's'}. Move or delete them first.`);
  }
  const wasLive = !!entry.publishedAt;
  const before = describe(type, entry);
  if (opts.permanent) {
    if (!entry.deletedAt) throw conflict('Move content to the trash before deleting it permanently');
    db.entries = db.entries.filter((e) => e.id !== entry.id);
    db.versions = db.versions.filter((v) => v.entryId !== entry.id);
    db.comments = db.comments.filter((c) => c.entryId !== entry.id);
    db.releaseItems = db.releaseItems.filter((i) => i.entryId !== entry.id);
    record(ctx, 'entry.purged', type, entry, { before: entry.data });
    return;
  }
  if (entry.deletedAt) return;
  const snapshot = entry.data;
  if (wasLive) unpublishCore(ctx, entry);
  entry.deletedAt = nowIso();
  entry.status = 'DRAFT';
  entry.scheduledPublishAt = null;
  entry.scheduledUnpublishAt = null;
  const open = new Set(db.releases.filter((r) => r.status === 'OPEN' || r.status === 'SCHEDULED').map((r) => r.id));
  db.releaseItems = db.releaseItems.filter((i) => !(i.entryId === entry.id && open.has(i.releaseId)));
  record(ctx, 'entry.deleted', type, entry, { before: snapshot });
  if (wasLive) emitEvent(ctx.scope, { event: eventName(type, 'unpublished'), ...before });
  emitEvent(ctx.scope, { event: 'content.deleted', ...before });
}

export function restoreFromTrash(ctx: Engine, type: DbType, entryId: string): DbEntry {
  const entry = ownEntry(ctx, type, entryId, { includeDeleted: true });
  if (!entry.deletedAt) throw notFound('Entry');
  assertUnique(type, entry, entry.data);
  if (isPageType(type)) {
    const parentAlive = entry.parentId ? db.entries.some((e) => e.id === entry.parentId && !e.deletedAt) : false;
    const parentId = parentAlive ? entry.parentId : null;
    entry.path = resolvePagePath(entry, entry.slug ?? '', parentId);
    entry.parentId = parentId;
  }
  entry.deletedAt = null;
  entry.updatedAt = nowIso();
  record(ctx, 'entry.restored', type, entry);
  return entry;
}

export function duplicateEntry(ctx: Engine, type: DbType, entryId: string): DbEntry {
  const source = ownEntry(ctx, type, entryId);
  if (type.kind === 'SINGLE') throw conflict('Single types hold exactly one entry and cannot be duplicated');
  const data = structuredClone(source.data);
  const suffix = newId().slice(0, 6);
  if (isPageType(type)) {
    data.title = `${data.title ?? 'Page'} (copy)`;
    data.slug = `${data.slug || 'page'}-copy-${suffix}`;
  } else {
    const titleField = type.options.titleField ?? type.fields.find((f) => f.type === 'text')?.apiId;
    if (titleField && typeof data[titleField] === 'string') data[titleField] = `${data[titleField]} (copy)`;
    for (const f of type.fields as FieldDef[]) {
      const value = data[f.apiId];
      if (f.type === 'slug' && typeof value === 'string' && value) data[f.apiId] = `${value}-copy-${suffix}`;
      else if (f.unique && typeof value === 'string' && value) data[f.apiId] = f.type === 'email' ? null : `${value}-copy-${suffix}`;
      else if (f.unique) data[f.apiId] = null;
      if (f.type === 'password') data[f.apiId] = source.data[f.apiId] ?? null;
    }
  }
  return createEntry(ctx, type, { data, locale: source.locale, parentId: source.parentId });
}

export type BulkAction = 'publish' | 'unpublish' | 'delete' | 'archive' | 'restore';

export function bulkAction(ctx: Engine, type: DbType, ids: string[], action: BulkAction) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      if (action === 'publish') publishEntry(ctx, type, id);
      else if (action === 'unpublish') unpublishEntry(ctx, type, id);
      else if (action === 'delete') deleteEntry(ctx, type, id);
      else if (action === 'archive') transitionEntry(ctx, type, id, 'archive');
      else restoreFromTrash(ctx, type, id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: (err as Error).message });
    }
  }
  return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
