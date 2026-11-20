import { randomUUID } from 'node:crypto';
import { Prisma, type Entry, type EntryStatus } from '@prisma/client';
import {
  type BlockNode,
  type FieldDef,
  type PageData,
  type ValidationIssue,
  type WorkflowAction,
  WORKFLOW_TRANSITIONS,
  canTransition,
  collectReferences,
  isSecretValue,
  isUuid,
  sameJson,
  slugify,
  validateEntryData,
  validatePageData,
  walkBlocks,
} from '@meridian/shared';
import { hashPassword } from '../../lib/crypto';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { prisma } from '../../lib/infra';
import { writeAudit } from '../audit/audit.service';
import { type EventScope, emitEvent } from '../events/events.service';
import { type EnvSchema, type LoadedType, isPageType } from '../schema/schema.service';

type Tx = Prisma.TransactionClient;

export interface Actor {
  type: 'user' | 'token' | 'system';
  id: string | null;
  label: string;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null, label: 'Scheduler' };

interface Prepared {
  data: Record<string, unknown>;
  issues: ValidationIssue[];
  title: string | null;
  slug: string | null;
}

function pickTitle(type: LoadedType, data: Record<string, unknown>): string | null {
  const preferred = type.options.titleField ? data[type.options.titleField] : undefined;
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim().slice(0, 300);
  for (const f of type.fields) {
    if ((f.type === 'text' || f.type === 'textarea') && typeof data[f.apiId] === 'string' && (data[f.apiId] as string).trim()) {
      return (data[f.apiId] as string).trim().slice(0, 300);
    }
  }
  return null;
}

function pickSlug(type: LoadedType, data: Record<string, unknown>): string | null {
  const field = type.fields.find((f) => f.type === 'slug') ?? type.fields.find((f) => f.type === 'uid');
  const value = field ? data[field.apiId] : undefined;
  return typeof value === 'string' && value ? value.slice(0, 300) : null;
}

/** Validates input against the content model and derives the denormalised title/slug columns. */
export function prepareData(schema: EnvSchema, type: LoadedType, input: unknown, mode: 'draft' | 'publish'): Prepared {
  if (isPageType(type)) {
    const result = validatePageData(input, { mode, registry: schema.blockRegistry, components: schema.componentFields });
    return {
      data: result.data as unknown as Record<string, unknown>,
      issues: result.issues,
      title: result.data.title || null,
      slug: result.data.slug ?? '',
    };
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

/** `password` fields are hashed before they are stored and are never returned in plaintext. */
async function sealSecrets(type: LoadedType, data: Record<string, unknown>, previous?: Record<string, unknown>) {
  for (const f of type.fields) {
    if (f.type !== 'password') continue;
    const value = data[f.apiId];
    if (typeof value === 'string' && value) data[f.apiId] = { $secret: await hashPassword(value) };
    else if (!isSecretValue(value)) data[f.apiId] = isSecretValue(previous?.[f.apiId]) ? previous?.[f.apiId] : null;
  }
}

function shapeErrors(issues: ValidationIssue[]) {
  return issues.map((i) => ({ path: i.path, message: i.message, code: i.code }));
}

async function assertUnique(tx: Tx, type: LoadedType, entry: { documentId: string; locale: string }, data: Record<string, unknown>) {
  const problems: ValidationIssue[] = [];
  for (const f of type.fields) {
    if (!f.unique) continue;
    const value = data[f.apiId];
    if (value === null || value === undefined || value === '') continue;
    const text = typeof value === 'string' ? value : String(value);
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "Entry"
      WHERE "contentTypeId" = ${type.id}::uuid AND "deletedAt" IS NULL AND "locale" = ${entry.locale}
        AND "documentId" <> ${entry.documentId}::uuid AND "data"->>${f.apiId}::text = ${text} LIMIT 1`);
    if (rows.length) problems.push({ path: f.apiId, code: 'not_unique', message: `${f.label} must be unique — "${text}" is already used by another entry` });
  }
  if (problems.length) throw unprocessable('Some values are already in use', shapeErrors(problems));
}

// ─── Pages: paths and tree ───────────────────────────────────────────────────

const joinPath = (parent: string | null | undefined, slug: string | null | undefined): string => {
  const base = !parent || parent === '/' ? '' : parent;
  return slug ? `${base}/${slug}` : base || '/';
};

async function resolvePagePath(tx: Tx, entry: { id?: string; environmentId: string; locale: string; contentTypeId: string }, slug: string, parentId: string | null) {
  let parentPath: string | null = null;
  if (parentId) {
    if (parentId === entry.id) throw badRequest('A page cannot be its own parent');
    const parent = await tx.entry.findFirst({
      where: { id: parentId, environmentId: entry.environmentId, contentTypeId: entry.contentTypeId, deletedAt: null },
      select: { id: true, path: true, parentId: true },
    });
    if (!parent) throw badRequest('Parent page does not exist');
    // Walk up to make sure the new parent is not one of this page's own descendants.
    let cursor: string | null = parent.parentId;
    for (let depth = 0; cursor && depth < 50; depth += 1) {
      if (cursor === entry.id) throw badRequest('A page cannot be moved underneath one of its own child pages');
      const next: { parentId: string | null } | null = await tx.entry.findUnique({ where: { id: cursor }, select: { parentId: true } });
      cursor = next?.parentId ?? null;
    }
    parentPath = parent.path;
  }
  const path = joinPath(parentPath, slug);
  const clash = await tx.entry.findFirst({
    where: {
      environmentId: entry.environmentId,
      contentTypeId: entry.contentTypeId,
      locale: entry.locale,
      path,
      deletedAt: null,
      ...(entry.id ? { id: { not: entry.id } } : {}),
    },
    select: { title: true },
  });
  if (clash) {
    throw unprocessable('Another page already uses this URL', [
      { path: 'slug', message: `"${path}" is already used by "${clash.title ?? 'another page'}"`, code: 'not_unique' },
    ]);
  }
  return path;
}

/** Recomputes draft paths of every descendant after a page's slug or parent changed. */
async function repathDescendants(tx: Tx, parentId: string, parentPath: string, column: 'path' | 'publishedPath') {
  const children = await tx.entry.findMany({
    where: { parentId, deletedAt: null },
    select: { id: true, slug: true, publishedSlug: true, publishedAt: true },
  });
  for (const child of children) {
    if (column === 'publishedPath' && !child.publishedAt) continue;
    const next = joinPath(parentPath, column === 'path' ? child.slug : child.publishedSlug);
    await tx.entry.update({ where: { id: child.id }, data: { [column]: next } });
    await repathDescendants(tx, child.id, next, column);
  }
}

// ─── References ──────────────────────────────────────────────────────────────

function referencesOf(schema: EnvSchema, type: LoadedType, data: Record<string, unknown> | null | undefined) {
  if (!data) return { media: [] as string[], relations: [] as { field: string; target: string }[] };
  if (!isPageType(type)) return collectReferences(type.fields, data, schema.componentFields);
  const page = data as unknown as PageData;
  const media = new Set<string>();
  if (isUuid(page.seo?.ogImage)) media.add(page.seo.ogImage);
  walkBlocks((page.blocks ?? []) as BlockNode[], (node) => {
    const def = schema.blockRegistry[node.type];
    if (def) collectReferences(def.fields, node.props ?? {}, schema.componentFields).media.forEach((id) => media.add(id));
    const bg = node.style?.background?.imageId;
    if (isUuid(bg)) media.add(bg);
  });
  return { media: [...media], relations: [] };
}

/** Keeps the relation and media-usage tables in step with an entry's working copy and live snapshot. */
async function syncReferences(tx: Tx, schema: EnvSchema, type: LoadedType, entry: Pick<Entry, 'id' | 'data' | 'publishedData'>, projectId: string) {
  const draft = referencesOf(schema, type, entry.data as Record<string, unknown>);
  const live = referencesOf(schema, type, entry.publishedData as Record<string, unknown> | null);
  await tx.entryRelation.deleteMany({ where: { fromEntryId: entry.id } });
  if (draft.relations.length) {
    await tx.entryRelation.createMany({
      data: draft.relations.map((r, position) => ({ fromEntryId: entry.id, field: r.field, targetDocumentId: r.target, position })),
    });
  }
  const mediaIds = [...new Set([...draft.media, ...live.media])];
  await tx.mediaUsage.deleteMany({ where: { entryId: entry.id } });
  if (mediaIds.length) {
    // Only assets that really exist in this project are recorded; stray ids are ignored.
    const existing = await tx.mediaAsset.findMany({ where: { id: { in: mediaIds }, projectId }, select: { id: true } });
    if (existing.length) await tx.mediaUsage.createMany({ data: existing.map((a) => ({ assetId: a.id, entryId: entry.id })) });
  }
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface EngineContext {
  scope: EventScope;
  schema: EnvSchema;
  actor: Actor;
  defaultLocale: string;
}

function eventName(type: LoadedType, kind: 'published' | 'unpublished') {
  return isPageType(type) ? (`page.${kind}` as const) : (`content.${kind}` as const);
}

function describe(type: LoadedType, entry: Entry) {
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

async function record(ctx: EngineContext, action: string, type: LoadedType, entry: Entry, extra: { before?: unknown; after?: unknown; metadata?: Record<string, unknown> } = {}) {
  await writeAudit({
    organizationId: ctx.scope.organizationId,
    projectId: ctx.scope.project.id,
    environmentId: ctx.scope.environment.id,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    actorLabel: ctx.actor.label,
    ip: ctx.actor.ip,
    action,
    resourceType: isPageType(type) ? 'page' : 'entry',
    resourceId: entry.id,
    resourceLabel: entry.title ?? `${type.singularName} ${entry.documentId.slice(0, 8)}`,
    metadata: { contentType: type.apiId, documentId: entry.documentId, locale: entry.locale, ...extra.metadata },
    before: extra.before,
    after: extra.after,
  });
}

async function nextVersionNumber(tx: Tx, entryId: string): Promise<number> {
  const last = await tx.entryVersion.findFirst({ where: { entryId }, orderBy: { number: 'desc' }, select: { number: true } });
  return (last?.number ?? 0) + 1;
}

export async function getEntry(environmentId: string, id: string, opts: { includeDeleted?: boolean } = {}): Promise<Entry> {
  if (!isUuid(id)) throw notFound('Entry');
  const entry = await prisma.entry.findFirst({
    where: { id, environmentId, ...(opts.includeDeleted ? {} : { deletedAt: null }) },
  });
  if (!entry) throw notFound('Entry');
  return entry;
}

export interface CreateInput {
  data: unknown;
  locale?: string;
  parentId?: string | null;
  /** Create a new locale variant of an existing document. */
  documentId?: string;
}

export async function createEntry(ctx: EngineContext, type: LoadedType, input: CreateInput): Promise<Entry> {
  const environmentId = ctx.scope.environment.id;
  const locale = input.locale ?? ctx.defaultLocale;
  const isPage = isPageType(type);
  if (locale !== ctx.defaultLocale && !type.options.localized) {
    throw badRequest(`"${type.displayName}" is not localized. Enable localization on the content type to add translations.`);
  }
  const prepared = prepareData(ctx.schema, type, input.data, 'draft');
  if (prepared.issues.length) throw unprocessable('Some fields are invalid', shapeErrors(prepared.issues));
  await sealSecrets(type, prepared.data);

  const entry = await prisma.$transaction(async (tx) => {
    const documentId = input.documentId ?? randomUUID();
    if (input.documentId) {
      const sibling = await tx.entry.findFirst({ where: { documentId, environmentId, contentTypeId: type.id }, select: { locale: true } });
      if (!sibling) throw badRequest('The document to translate does not exist');
      const exists = await tx.entry.findUnique({ where: { documentId_locale: { documentId, locale } }, select: { id: true } });
      if (exists) throw conflict(`This document already has a "${locale}" translation`);
    } else if (type.kind === 'SINGLE') {
      const existing = await tx.entry.findFirst({ where: { contentTypeId: type.id, environmentId, locale, deletedAt: null }, select: { id: true } });
      if (existing) throw conflict(`"${type.displayName}" is a single type and already has its entry`, { entryId: existing.id });
    }
    await assertUnique(tx, type, { documentId, locale }, prepared.data);
    const parentId = isPage ? (input.parentId ?? null) : null;
    const path = isPage
      ? await resolvePagePath(tx, { environmentId, locale, contentTypeId: type.id }, prepared.slug ?? '', parentId)
      : null;
    const position = isPage ? await tx.entry.count({ where: { environmentId, contentTypeId: type.id, parentId, deletedAt: null } }) : 0;
    const created = await tx.entry.create({
      data: {
        environmentId,
        contentTypeId: type.id,
        documentId,
        locale,
        title: prepared.title,
        slug: prepared.slug,
        path,
        parentId,
        position,
        data: prepared.data as Prisma.InputJsonValue,
        status: 'DRAFT',
        createdById: ctx.actor.type === 'user' ? ctx.actor.id : null,
        updatedById: ctx.actor.type === 'user' ? ctx.actor.id : null,
      },
    });
    await tx.entryVersion.create({
      data: {
        entryId: created.id,
        number: 1,
        kind: 'SAVE',
        data: prepared.data as Prisma.InputJsonValue,
        title: prepared.title,
        note: 'Created',
        createdById: ctx.actor.type === 'user' ? ctx.actor.id : null,
      },
    });
    await syncReferences(tx, ctx.schema, type, created, ctx.scope.project.id);
    return created;
  });
  await record(ctx, 'entry.created', type, entry, { after: entry.data });
  await emitEvent(ctx.scope, { event: 'content.created', ...describe(type, entry) });
  return entry;
}

export interface UpdateInput {
  data: unknown;
  /** The lockVersion the client loaded. A mismatch means someone else saved in between. */
  lockVersion?: number;
  autosave?: boolean;
  note?: string;
  parentId?: string | null;
}

const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000;

export async function updateEntry(ctx: EngineContext, type: LoadedType, entryId: string, input: UpdateInput): Promise<Entry> {
  const environmentId = ctx.scope.environment.id;
  const current = await getEntry(environmentId, entryId);
  if (current.contentTypeId !== type.id) throw notFound('Entry');
  if (current.status === 'ARCHIVED') throw conflict('Archived content is read-only. Restore it from the archive to edit.');
  const prepared = prepareData(ctx.schema, type, input.data, 'draft');
  if (prepared.issues.length) throw unprocessable('Some fields are invalid', shapeErrors(prepared.issues));
  await sealSecrets(type, prepared.data, current.data as Record<string, unknown>);

  const isPage = isPageType(type);
  const parentId = isPage ? (input.parentId === undefined ? current.parentId : input.parentId) : null;
  // Compared by content, not by serialisation: JSONB returns keys in its own order.
  const dataChanged = !sameJson(prepared.data, current.data);
  const moved = isPage && parentId !== current.parentId;
  if (!dataChanged && !moved) return current;

  const userId = ctx.actor.type === 'user' ? ctx.actor.id : null;
  const updated = await prisma.$transaction(async (tx) => {
    // Re-read under a row lock so two concurrent saves cannot both pass the version check.
    const locked = await tx.$queryRaw<{ lockVersion: number; updatedById: string | null; updatedAt: Date }[]>(
      Prisma.sql`SELECT "lockVersion", "updatedById", "updatedAt" FROM "Entry" WHERE "id" = ${entryId}::uuid FOR UPDATE`,
    );
    const live = locked[0];
    if (!live) throw notFound('Entry');
    if (input.lockVersion !== undefined && input.lockVersion !== live.lockVersion) {
      const editor = live.updatedById ? await tx.user.findUnique({ where: { id: live.updatedById }, select: { name: true } }) : null;
      throw conflict('This content was changed by someone else since you opened it.', {
        currentLockVersion: live.lockVersion,
        updatedBy: editor?.name ?? null,
        updatedAt: live.updatedAt,
      });
    }
    await assertUnique(tx, type, current, prepared.data);
    const path = isPage ? await resolvePagePath(tx, { ...current, id: current.id }, prepared.slug ?? '', parentId) : null;

    // Editing approved or published content returns it to draft: approval covers exact content.
    let status: EntryStatus = current.status;
    let scheduledPublishAt = current.scheduledPublishAt;
    if (dataChanged && (status === 'PUBLISHED' || status === 'APPROVED')) status = 'DRAFT';
    // Where approval is mandatory, a schedule was granted for the approved content only: editing cancels it.
    if (dataChanged && status === 'SCHEDULED' && type.options.requireApproval) {
      status = 'DRAFT';
      scheduledPublishAt = null;
    }

    const row = await tx.entry.update({
      where: { id: entryId },
      data: {
        data: prepared.data as Prisma.InputJsonValue,
        title: prepared.title,
        slug: prepared.slug,
        path,
        parentId,
        status,
        scheduledPublishAt,
        lockVersion: { increment: 1 },
        updatedById: userId,
      },
    });
    if (dataChanged) {
      const latest = await tx.entryVersion.findFirst({ where: { entryId }, orderBy: { number: 'desc' } });
      const coalesce =
        input.autosave &&
        latest?.kind === 'AUTOSAVE' &&
        latest.createdById === userId &&
        Date.now() - latest.updatedAt.getTime() < AUTOSAVE_WINDOW_MS;
      if (coalesce && latest) {
        // Autosaves by the same editor within the window fold into one version instead of flooding history.
        await tx.entryVersion.update({ where: { id: latest.id }, data: { data: prepared.data as Prisma.InputJsonValue, title: prepared.title } });
      } else {
        await tx.entryVersion.create({
          data: {
            entryId,
            number: (latest?.number ?? 0) + 1,
            kind: input.autosave ? 'AUTOSAVE' : 'SAVE',
            data: prepared.data as Prisma.InputJsonValue,
            title: prepared.title,
            note: input.note?.slice(0, 500) || null,
            createdById: userId,
          },
        });
      }
      await syncReferences(tx, ctx.schema, type, row, ctx.scope.project.id);
    }
    if (isPage && path !== current.path) await repathDescendants(tx, entryId, path ?? '/', 'path');
    return row;
  });

  if (!input.autosave) {
    await record(ctx, 'entry.updated', type, updated, { before: current.data, after: updated.data });
    await emitEvent(ctx.scope, { event: 'content.updated', ...describe(type, updated) });
  }
  return updated;
}

/** Publishes inside an existing transaction. Shared by single publish, bulk publish, scheduling and releases. */
export async function publishInTx(tx: Tx, ctx: EngineContext, type: LoadedType, entry: Entry, opts: { note?: string; skipApproval?: boolean } = {}): Promise<Entry> {
  if (entry.status === 'ARCHIVED') throw conflict('Archived content cannot be published. Restore it first.');
  const prepared = prepareData(ctx.schema, type, entry.data, 'publish');
  if (prepared.issues.length) {
    throw unprocessable(`"${entry.title ?? type.singularName}" is not ready to publish`, shapeErrors(prepared.issues));
  }
  // Secrets are already sealed in the working copy; keep them as stored.
  for (const f of type.fields) if (f.type === 'password') prepared.data[f.apiId] = (entry.data as Record<string, unknown>)[f.apiId] ?? null;

  const unchangedLive = entry.publishedAt && sameJson(entry.publishedData, entry.data);
  if (type.options.requireApproval && !opts.skipApproval && entry.status !== 'APPROVED' && !unchangedLive) {
    throw conflict(`"${type.displayName}" requires approval before publishing. Submit this ${type.singularName.toLowerCase()} for review first.`, {
      status: entry.status,
    });
  }
  await assertUnique(tx, type, entry, prepared.data);
  const userId = ctx.actor.type === 'user' ? ctx.actor.id : null;
  const version = await tx.entryVersion.create({
    data: {
      entryId: entry.id,
      number: await nextVersionNumber(tx, entry.id),
      kind: 'PUBLISH',
      data: entry.data as Prisma.InputJsonValue,
      title: entry.title,
      note: opts.note?.slice(0, 500) || null,
      createdById: userId,
    },
  });
  const now = new Date();
  const published = await tx.entry.update({
    where: { id: entry.id },
    data: {
      status: 'PUBLISHED',
      publishedData: entry.data as Prisma.InputJsonValue,
      publishedTitle: entry.title,
      publishedSlug: entry.slug,
      publishedPath: entry.path,
      publishedVersionId: version.id,
      publishedAt: now,
      firstPublishedAt: entry.firstPublishedAt ?? now,
      scheduledPublishAt: null,
      lockVersion: { increment: 1 },
      updatedById: userId ?? entry.updatedById,
    },
  });
  await syncReferences(tx, ctx.schema, type, published, ctx.scope.project.id);
  if (isPageType(type)) await repathDescendants(tx, entry.id, published.publishedPath ?? '/', 'publishedPath');
  return published;
}

export async function publishEntry(ctx: EngineContext, type: LoadedType, entryId: string, opts: { note?: string; skipApproval?: boolean } = {}): Promise<Entry> {
  const published = await prisma.$transaction(async (tx) => {
    const entry = await tx.entry.findFirst({ where: { id: entryId, environmentId: ctx.scope.environment.id, contentTypeId: type.id, deletedAt: null } });
    if (!entry) throw notFound('Entry');
    return publishInTx(tx, ctx, type, entry, opts);
  });
  await record(ctx, 'entry.published', type, published, { metadata: { versionId: published.publishedVersionId } });
  await emitEvent(ctx.scope, { event: eventName(type, 'published'), ...describe(type, published) });
  return published;
}

export async function unpublishInTx(tx: Tx, ctx: EngineContext, entry: Entry, status: EntryStatus = 'DRAFT'): Promise<Entry> {
  return tx.entry.update({
    where: { id: entry.id },
    data: {
      status,
      publishedData: Prisma.DbNull,
      publishedTitle: null,
      publishedSlug: null,
      publishedPath: null,
      publishedVersionId: null,
      publishedAt: null,
      scheduledUnpublishAt: null,
      lockVersion: { increment: 1 },
      updatedById: ctx.actor.type === 'user' ? ctx.actor.id : entry.updatedById,
    },
  });
}

export async function unpublishEntry(ctx: EngineContext, type: LoadedType, entryId: string): Promise<Entry> {
  const entry = await getEntry(ctx.scope.environment.id, entryId);
  if (entry.contentTypeId !== type.id) throw notFound('Entry');
  if (!entry.publishedAt) throw conflict('This content is not published');
  const before = describe(type, entry);
  const updated = await prisma.$transaction((tx) => unpublishInTx(tx, ctx, entry, entry.status === 'PUBLISHED' ? 'DRAFT' : entry.status));
  await record(ctx, 'entry.unpublished', type, updated);
  await emitEvent(ctx.scope, { event: eventName(type, 'unpublished'), ...before });
  return updated;
}

export async function scheduleEntry(
  ctx: EngineContext,
  type: LoadedType,
  entryId: string,
  input: { publishAt?: Date | null; unpublishAt?: Date | null },
): Promise<Entry> {
  const entry = await getEntry(ctx.scope.environment.id, entryId);
  if (entry.contentTypeId !== type.id) throw notFound('Entry');
  if (entry.status === 'ARCHIVED') throw conflict('Archived content cannot be scheduled');
  const now = Date.now();
  if (input.publishAt && input.publishAt.getTime() <= now) throw badRequest('Publish time must be in the future');
  if (input.unpublishAt && input.unpublishAt.getTime() <= now) throw badRequest('Unpublish time must be in the future');
  const publishAt = input.publishAt === undefined ? entry.scheduledPublishAt : input.publishAt;
  const unpublishAt = input.unpublishAt === undefined ? entry.scheduledUnpublishAt : input.unpublishAt;
  if (publishAt && unpublishAt && unpublishAt <= publishAt) throw badRequest('Unpublish time must be after the publish time');
  if (unpublishAt && !publishAt && !entry.publishedAt) throw badRequest('Only published or scheduled content can be scheduled to unpublish');

  if (input.publishAt) {
    // Surface problems now rather than at 3 a.m. when the schedule fires.
    const check = prepareData(ctx.schema, type, entry.data, 'publish');
    if (check.issues.length) throw unprocessable('This content is not ready to publish, so it cannot be scheduled', shapeErrors(check.issues));
    if (type.options.requireApproval && entry.status !== 'APPROVED') {
      throw conflict(`"${type.displayName}" requires approval before it can be scheduled.`);
    }
  }
  let status: EntryStatus = entry.status;
  if (publishAt) status = 'SCHEDULED';
  else if (entry.status === 'SCHEDULED') status = entry.publishedAt && sameJson(entry.data, entry.publishedData) ? 'PUBLISHED' : 'DRAFT';

  const updated = await prisma.entry.update({
    where: { id: entry.id },
    data: { scheduledPublishAt: publishAt, scheduledUnpublishAt: unpublishAt, status, lockVersion: { increment: 1 } },
  });
  await record(ctx, publishAt || unpublishAt ? 'entry.scheduled' : 'entry.unscheduled', type, updated, {
    metadata: { publishAt: publishAt?.toISOString() ?? null, unpublishAt: unpublishAt?.toISOString() ?? null },
  });
  if (input.publishAt) await emitEvent(ctx.scope, { event: 'content.scheduled', ...describe(type, updated) });
  return updated;
}

/** Moves an entry through the editorial workflow (submit, approve, request changes, archive…). */
export async function transitionEntry(ctx: EngineContext, type: LoadedType, entryId: string, action: WorkflowAction, comment?: string): Promise<Entry> {
  if (action === 'publish' || action === 'unpublish' || action === 'schedule' || action === 'unschedule') {
    throw badRequest(`Use the dedicated endpoint to ${action}`);
  }
  const entry = await getEntry(ctx.scope.environment.id, entryId);
  if (entry.contentTypeId !== type.id) throw notFound('Entry');
  const transition = WORKFLOW_TRANSITIONS[action];
  if (!canTransition(action, entry.status as never)) {
    throw conflict(`Cannot ${transition.label.toLowerCase()} while the status is ${entry.status.replace(/_/g, ' ').toLowerCase()}`);
  }
  if (action === 'request_changes' && !comment?.trim()) throw badRequest('Explain what needs to change');
  if (action === 'submit') {
    const check = prepareData(ctx.schema, type, entry.data, 'publish');
    if (check.issues.length) throw unprocessable('Complete the required fields before submitting for review', shapeErrors(check.issues));
  }
  const wasLive = !!entry.publishedAt;
  const before = describe(type, entry);
  const updated = await prisma.$transaction(async (tx) => {
    let row: Entry;
    if (action === 'archive') {
      // Archiving takes live content offline and cancels anything scheduled for it.
      if (wasLive) await unpublishInTx(tx, ctx, entry, 'ARCHIVED');
      row = await tx.entry.update({
        where: { id: entry.id },
        data: { status: 'ARCHIVED', scheduledPublishAt: null, scheduledUnpublishAt: null, lockVersion: { increment: 1 } },
      });
    } else {
      row = await tx.entry.update({ where: { id: entry.id }, data: { status: transition.to, lockVersion: { increment: 1 } } });
    }
    if (comment?.trim() && ctx.actor.type === 'user' && ctx.actor.id) {
      await tx.comment.create({
        data: { entryId: entry.id, userId: ctx.actor.id, body: comment.trim().slice(0, 4000), kind: action === 'request_changes' ? 'changes_requested' : action === 'approve' ? 'approval' : 'comment' },
      });
    }
    return row;
  });
  await record(ctx, `entry.${action}`, type, updated, { before: { status: entry.status }, after: { status: updated.status }, metadata: comment ? { comment } : undefined });
  if (action === 'archive' && wasLive) await emitEvent(ctx.scope, { event: eventName(type, 'unpublished'), ...before });
  return updated;
}

export async function restoreVersion(ctx: EngineContext, type: LoadedType, entryId: string, versionId: string): Promise<Entry> {
  const entry = await getEntry(ctx.scope.environment.id, entryId);
  if (entry.contentTypeId !== type.id) throw notFound('Entry');
  if (entry.status === 'ARCHIVED') throw conflict('Restore this content from the archive before restoring a version');
  const version = await prisma.entryVersion.findFirst({ where: { id: versionId, entryId } });
  if (!version) throw notFound('Version');
  // Re-validate against today's schema: fields removed since then are dropped, new ones start empty.
  const prepared = prepareData(ctx.schema, type, version.data, 'draft');
  if (isPageType(type)) {
    // The page keeps its current URL; only content is rolled back.
    (prepared.data as unknown as PageData).slug = entry.slug ?? '';
    prepared.slug = entry.slug ?? '';
  }
  const userId = ctx.actor.type === 'user' ? ctx.actor.id : null;
  const restored = await prisma.$transaction(async (tx) => {
    await assertUnique(tx, type, entry, prepared.data);
    const row = await tx.entry.update({
      where: { id: entry.id },
      data: {
        data: prepared.data as Prisma.InputJsonValue,
        title: prepared.title,
        slug: isPageType(type) ? entry.slug : prepared.slug,
        status: entry.status === 'PUBLISHED' || entry.status === 'APPROVED' ? 'DRAFT' : entry.status,
        lockVersion: { increment: 1 },
        updatedById: userId,
      },
    });
    await tx.entryVersion.create({
      data: {
        entryId: entry.id,
        number: await nextVersionNumber(tx, entry.id),
        kind: 'RESTORE',
        data: prepared.data as Prisma.InputJsonValue,
        title: prepared.title,
        note: `Restored from version ${version.number}`,
        createdById: userId,
      },
    });
    await syncReferences(tx, ctx.schema, type, row, ctx.scope.project.id);
    return row;
  });
  await record(ctx, 'entry.version_restored', type, restored, { metadata: { restoredVersion: version.number }, before: entry.data, after: restored.data });
  await emitEvent(ctx.scope, { event: 'content.updated', ...describe(type, restored) });
  return restored;
}

export async function deleteEntry(ctx: EngineContext, type: LoadedType, entryId: string, opts: { permanent?: boolean } = {}): Promise<void> {
  const entry = await getEntry(ctx.scope.environment.id, entryId, { includeDeleted: true });
  if (entry.contentTypeId !== type.id) throw notFound('Entry');
  if (isPageType(type) && !entry.deletedAt) {
    const children = await prisma.entry.count({ where: { parentId: entry.id, deletedAt: null } });
    if (children > 0) throw conflict(`This page has ${children} child page${children === 1 ? '' : 's'}. Move or delete them first.`);
  }
  const wasLive = !!entry.publishedAt;
  const before = describe(type, entry);
  if (opts.permanent) {
    if (!entry.deletedAt) throw conflict('Move content to the trash before deleting it permanently');
    await prisma.entry.delete({ where: { id: entry.id } });
    await record(ctx, 'entry.purged', type, entry, { before: entry.data });
    return;
  }
  if (entry.deletedAt) return;
  await prisma.$transaction(async (tx) => {
    if (wasLive) await unpublishInTx(tx, ctx, entry);
    await tx.entry.update({
      where: { id: entry.id },
      data: { deletedAt: new Date(), status: 'DRAFT', scheduledPublishAt: null, scheduledUnpublishAt: null },
    });
    await tx.releaseItem.deleteMany({ where: { entryId: entry.id, release: { status: { in: ['OPEN', 'SCHEDULED'] } } } });
  });
  await record(ctx, 'entry.deleted', type, entry, { before: entry.data });
  if (wasLive) await emitEvent(ctx.scope, { event: eventName(type, 'unpublished'), ...before });
  await emitEvent(ctx.scope, { event: 'content.deleted', ...before });
}

export async function restoreFromTrash(ctx: EngineContext, type: LoadedType, entryId: string): Promise<Entry> {
  const entry = await getEntry(ctx.scope.environment.id, entryId, { includeDeleted: true });
  if (entry.contentTypeId !== type.id || !entry.deletedAt) throw notFound('Entry');
  const restored = await prisma.$transaction(async (tx) => {
    await assertUnique(tx, type, entry, entry.data as Record<string, unknown>);
    let path = entry.path;
    let parentId = entry.parentId;
    if (isPageType(type)) {
      const parentAlive = parentId ? await tx.entry.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } }) : null;
      if (!parentAlive) parentId = null;
      path = await resolvePagePath(tx, { ...entry, id: entry.id }, entry.slug ?? '', parentId);
    }
    return tx.entry.update({ where: { id: entry.id }, data: { deletedAt: null, path, parentId } });
  });
  await record(ctx, 'entry.restored', type, restored);
  return restored;
}

export async function duplicateEntry(ctx: EngineContext, type: LoadedType, entryId: string): Promise<Entry> {
  const source = await getEntry(ctx.scope.environment.id, entryId);
  if (source.contentTypeId !== type.id) throw notFound('Entry');
  if (type.kind === 'SINGLE') throw conflict('Single types hold exactly one entry and cannot be duplicated');
  const data = structuredClone(source.data) as Record<string, unknown>;
  const suffix = randomUUID().slice(0, 6);
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
      if (f.type === 'password') data[f.apiId] = (source.data as Record<string, unknown>)[f.apiId] ?? null;
    }
  }
  return createEntry(ctx, type, { data, locale: source.locale, parentId: source.parentId });
}

export type BulkAction = 'publish' | 'unpublish' | 'delete' | 'archive' | 'restore';

export async function bulkAction(ctx: EngineContext, type: LoadedType, ids: string[], action: BulkAction) {
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      if (action === 'publish') await publishEntry(ctx, type, id);
      else if (action === 'unpublish') await unpublishEntry(ctx, type, id);
      else if (action === 'delete') await deleteEntry(ctx, type, id);
      else if (action === 'archive') await transitionEntry(ctx, type, id, 'archive');
      else await restoreFromTrash(ctx, type, id);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: (err as Error).message });
    }
  }
  return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
