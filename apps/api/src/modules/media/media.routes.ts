import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import type { MediaAsset, Prisma } from '@prisma/client';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { isUuid } from '@meridian/shared';
import { env } from '../../config/env';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { param, parse, toPage } from '../../lib/http';
import { logger, prisma } from '../../lib/infra';
import { projectScope, tenantOf, userOf } from '../../middleware/auth';
import { ipKey, rateLimit } from '../../middleware/common';
import { audit } from '../audit/audit.service';
import { emitEvent } from '../events/events.service';
import { toMediaOut } from '../delivery/serializer';
import { ALLOWED_EXTENSIONS, inspectSvg, safeFilename, sniff } from './sniff';
import { storage } from './storage';

export const mediaRouter = Router({ mergeParams: true });
export const mediaDeliveryRouter = Router();

/** Files per request. Uploads are buffered for content inspection, so the batch size bounds memory per request. */
export const MAX_FILES_PER_UPLOAD = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: MAX_FILES_PER_UPLOAD },
});

const MAX_PIXELS = 100_000_000;

interface Inspected {
  filename: string;
  mimeType: string;
  kind: string;
  width: number | null;
  height: number | null;
  checksum: string;
}

/** Validates an uploaded file by content and extracts its metadata. Throws a 400 with a precise reason. */
async function inspect(file: Express.Multer.File): Promise<Inspected> {
  // Browsers send the name as latin1 bytes; recover UTF-8 names.
  const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const { name, extension } = safeFilename(original);
  const detected = sniff(file.buffer, extension);
  if ('error' in detected) throw badRequest(`${original}: ${detected.error}`);
  let width: number | null = null;
  let height: number | null = null;
  if (detected.format === 'svg') {
    const problem = inspectSvg(file.buffer);
    if (problem) throw badRequest(`${original}: ${problem}`);
  }
  if (detected.kind === 'image') {
    try {
      const meta = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      throw badRequest(`${original}: the image is corrupt or larger than the supported dimensions`);
    }
  }
  return { filename: name, mimeType: detected.mime, kind: detected.kind, width, height, checksum: createHash('sha256').update(file.buffer).digest('hex') };
}

const storageKey = (projectId: string, assetId: string, revision: number, filename: string) => `projects/${projectId}/${assetId}/${revision}/${filename}`;

async function projectEvent(req: Request, event: 'media.uploaded' | 'media.updated' | 'media.deleted', asset: MediaAsset) {
  const tenant = tenantOf(req);
  if (!tenant.project) return;
  // Media is shared by a project's environments, so each one hears about the change.
  const environments = await prisma.environment.findMany({ where: { projectId: tenant.project.id }, select: { id: true, key: true } });
  for (const environment of environments) {
    await emitEvent(
      { organizationId: tenant.organizationId, organizationSlug: tenant.organizationSlug, project: { id: tenant.project.id, slug: tenant.project.slug }, environment },
      { event, documentId: asset.id, title: asset.filename },
    );
  }
}

const present = (asset: MediaAsset & { _count?: { usages: number } }) => {
  const { _count, storageKey: _key, ...rest } = asset;
  return { ...rest, url: toMediaOut(asset).url, usageCount: _count?.usages ?? 0 };
};

// ─── Library ─────────────────────────────────────────────────────────────────

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48),
  search: z.string().trim().max(120).optional(),
  kind: z.enum(['image', 'video', 'document', 'archive', 'other']).optional(),
  folderId: z.string().optional(),
  tag: z.string().trim().max(60).optional(),
  unused: z.enum(['true', 'false']).optional(),
  trash: z.enum(['true', 'false']).optional(),
  /** Comma-separated asset ids: resolves references in one request (deleted assets included, flagged by deletedAt). */
  ids: z.string().max(8000).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'largest']).default('newest'),
});

mediaRouter.get('/media', projectScope('media.read'), async (req, res) => {
  const q = parse(listQuery, req.query);
  const projectId = param(req, 'projectId');
  if (q.ids !== undefined) {
    const ids = q.ids.split(',').filter(isUuid).slice(0, 200);
    const found = await prisma.mediaAsset.findMany({ where: { projectId, id: { in: ids } }, include: { _count: { select: { usages: true } } } });
    res.json(toPage(found.map(present), found.length, 1, Math.max(1, found.length)));
    return;
  }
  const where: Prisma.MediaAssetWhereInput = {
    projectId,
    deletedAt: q.trash === 'true' ? { not: null } : null,
    ...(q.kind ? { kind: q.kind } : {}),
    ...(q.folderId === 'root' ? { folderId: null } : q.folderId && isUuid(q.folderId) ? { folderId: q.folderId } : {}),
    ...(q.tag ? { tags: { has: q.tag } } : {}),
    ...(q.unused === 'true' ? { usages: { none: {} } } : {}),
    ...(q.search
      ? {
          OR: [
            { filename: { contains: q.search, mode: 'insensitive' } },
            { alt: { contains: q.search, mode: 'insensitive' } },
            { caption: { contains: q.search, mode: 'insensitive' } },
            { tags: { has: q.search.toLowerCase() } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.MediaAssetOrderByWithRelationInput =
    q.sort === 'oldest' ? { createdAt: 'asc' } : q.sort === 'name' ? { filename: 'asc' } : q.sort === 'largest' ? { size: 'desc' } : { createdAt: 'desc' };
  const [items, total] = await Promise.all([
    prisma.mediaAsset.findMany({ where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { _count: { select: { usages: true } } } }),
    prisma.mediaAsset.count({ where }),
  ]);
  res.json(toPage(items.map(present), total, q.page, q.pageSize));
});

mediaRouter.get('/media-stats', projectScope('media.read'), async (req, res) => {
  const projectId = param(req, 'projectId');
  const [byKind, unused, tags] = await Promise.all([
    prisma.mediaAsset.groupBy({ by: ['kind'], where: { projectId, deletedAt: null }, _count: true, _sum: { size: true } }),
    prisma.mediaAsset.count({ where: { projectId, deletedAt: null, usages: { none: {} } } }),
    prisma.$queryRaw<{ tag: string; n: number }[]>`
      SELECT tag, count(*)::int AS n FROM "MediaAsset", unnest("tags") AS tag
      WHERE "projectId" = ${projectId}::uuid AND "deletedAt" IS NULL GROUP BY tag ORDER BY n DESC LIMIT 40`,
  ]);
  res.json({
    totalAssets: byKind.reduce((n, k) => n + k._count, 0),
    totalBytes: byKind.reduce((n, k) => n + (k._sum.size ?? 0), 0),
    byKind: byKind.map((k) => ({ kind: k.kind, count: k._count, bytes: k._sum.size ?? 0 })),
    unusedAssets: unused,
    tags,
    allowedExtensions: ALLOWED_EXTENSIONS,
    maxUploadBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
    storageDriver: storage().name,
  });
});

mediaRouter.post('/media', projectScope('media.upload'), upload.array('files', MAX_FILES_PER_UPLOAD), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw badRequest('Attach at least one file in the "files" field');
  const projectId = param(req, 'projectId');
  const folderId = typeof req.body?.folderId === 'string' && isUuid(req.body.folderId) ? req.body.folderId : null;
  if (folderId && !(await prisma.mediaFolder.findFirst({ where: { id: folderId, projectId }, select: { id: true } }))) {
    throw badRequest('Folder does not exist');
  }
  const allowDuplicates = req.query.allowDuplicates === 'true';
  const uploaded: unknown[] = [];
  const errors: { filename: string; message: string }[] = [];

  for (const file of files) {
    try {
      const info = await inspect(file);
      if (!allowDuplicates) {
        const existing = await prisma.mediaAsset.findFirst({
          where: { projectId, checksum: info.checksum, deletedAt: null },
          include: { _count: { select: { usages: true } } },
        });
        if (existing) {
          // Identical bytes are already in the library: reuse them instead of storing a second copy.
          uploaded.push({ ...present(existing), duplicate: true });
          continue;
        }
      }
      const id = crypto.randomUUID();
      const key = storageKey(projectId, id, 1, info.filename);
      await storage().put(key, file.buffer, info.mimeType);
      const asset = await prisma.mediaAsset.create({
        data: { id, projectId, folderId, ...info, size: file.size, storageKey: key, createdById: userOf(req).id },
      });
      await audit(req, { action: 'media.uploaded', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename, after: { size: asset.size, mimeType: asset.mimeType } });
      await projectEvent(req, 'media.uploaded', asset);
      uploaded.push({ ...present(asset), duplicate: false });
    } catch (err) {
      const e = err as { status?: number; message: string };
      if (!e.status || e.status >= 500) logger.error({ err: e.message }, 'media upload failed');
      errors.push({ filename: Buffer.from(file.originalname, 'latin1').toString('utf8'), message: e.status && e.status < 500 ? e.message : 'Upload failed. Try again.' });
    }
  }
  res.status(uploaded.length ? 201 : 400).json({ items: uploaded, errors });
});

async function findAsset(req: Request, opts: { includeDeleted?: boolean } = {}) {
  const id = param(req, 'assetId');
  const asset = isUuid(id)
    ? await prisma.mediaAsset.findFirst({
        where: { id, projectId: param(req, 'projectId'), ...(opts.includeDeleted ? {} : { deletedAt: null }) },
        include: { _count: { select: { usages: true } } },
      })
    : null;
  if (!asset) throw notFound('Media asset');
  return asset;
}

async function usagesOf(assetId: string) {
  const usages = await prisma.mediaUsage.findMany({ where: { assetId }, select: { entryId: true }, take: 200 });
  if (usages.length === 0) return [];
  const entries = await prisma.entry.findMany({
    where: { id: { in: usages.map((u) => u.entryId) }, deletedAt: null },
    select: { id: true, title: true, status: true, environmentId: true, contentType: { select: { apiId: true, displayName: true, isSystem: true } }, environment: { select: { key: true, name: true } } },
  });
  return entries.map((e) => ({
    entryId: e.id,
    title: e.title,
    status: e.status,
    environmentId: e.environmentId,
    environment: e.environment.name,
    contentType: e.contentType.apiId,
    contentTypeName: e.contentType.displayName,
    isPage: e.contentType.isSystem && e.contentType.apiId === 'pages',
  }));
}

mediaRouter.get('/media/:assetId', projectScope('media.read'), async (req, res) => {
  const asset = await findAsset(req, { includeDeleted: true });
  res.json({ ...present(asset), usages: await usagesOf(asset.id) });
});

const tag = z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9][a-z0-9 _-]*$/, 'Tags use letters, numbers, spaces, hyphens and underscores');

mediaRouter.patch('/media/:assetId', projectScope('media.manage'), async (req, res) => {
  const input = parse(
    z.object({
      filename: z.string().trim().min(1).max(160).optional(),
      alt: z.string().trim().max(500).optional(),
      caption: z.string().trim().max(1000).optional(),
      tags: z.array(tag).max(30).optional(),
      folderId: z.string().uuid().nullable().optional(),
    }),
    req.body,
  );
  const asset = await findAsset(req);
  const data: Prisma.MediaAssetUncheckedUpdateInput = {};
  if (input.filename) {
    const current = safeFilename(asset.filename);
    const next = safeFilename(input.filename);
    // Renaming keeps the original extension so the name can never misrepresent the content.
    const stem = next.extension ? next.name.slice(0, -(next.extension.length + 1)) : next.name;
    data.filename = current.extension ? `${stem}.${current.extension}` : stem;
  }
  if (input.alt !== undefined) data.alt = input.alt;
  if (input.caption !== undefined) data.caption = input.caption;
  if (input.tags) data.tags = [...new Set(input.tags)];
  if (input.folderId !== undefined) {
    if (input.folderId && !(await prisma.mediaFolder.findFirst({ where: { id: input.folderId, projectId: asset.projectId }, select: { id: true } }))) {
      throw badRequest('Folder does not exist');
    }
    data.folderId = input.folderId;
  }
  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data, include: { _count: { select: { usages: true } } } });
  await audit(req, {
    action: 'media.updated',
    resourceType: 'media',
    resourceId: asset.id,
    resourceLabel: updated.filename,
    before: { filename: asset.filename, alt: asset.alt, tags: asset.tags },
    after: { filename: updated.filename, alt: updated.alt, tags: updated.tags },
  });
  await projectEvent(req, 'media.updated', updated);
  res.json({ ...present(updated), usages: await usagesOf(asset.id) });
});

/** Swaps the file behind an asset. Its id — and so every reference to it — stays valid. */
mediaRouter.post('/media/:assetId/replace', projectScope('media.manage'), upload.single('file'), async (req, res) => {
  const asset = await findAsset(req);
  if (!req.file) throw badRequest('Attach the replacement in the "file" field');
  const info = await inspect(req.file);
  if (info.kind !== asset.kind) throw badRequest(`Replace this ${asset.kind} with another ${asset.kind}, not a ${info.kind}`);
  const revision = asset.revision + 1;
  const key = storageKey(asset.projectId, asset.id, revision, info.filename);
  await storage().put(key, req.file.buffer, info.mimeType);
  const updated = await prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { ...info, size: req.file.size, storageKey: key, revision },
    include: { _count: { select: { usages: true } } },
  });
  await storage().delete(asset.storageKey).catch((err) => logger.warn({ err: err.message }, 'could not remove replaced file'));
  await audit(req, {
    action: 'media.replaced',
    resourceType: 'media',
    resourceId: asset.id,
    resourceLabel: updated.filename,
    before: { filename: asset.filename, size: asset.size, checksum: asset.checksum },
    after: { filename: updated.filename, size: updated.size, checksum: updated.checksum },
  });
  await projectEvent(req, 'media.updated', updated);
  res.json({ ...present(updated), usages: await usagesOf(asset.id) });
});

mediaRouter.delete('/media/:assetId', projectScope('media.manage'), async (req, res) => {
  const asset = await findAsset(req, { includeDeleted: true });
  const permanent = req.query.permanent === 'true';
  if (!asset.deletedAt) {
    const usages = await usagesOf(asset.id);
    if (usages.length > 0 && req.query.force !== 'true') {
      throw conflict(`This file is used by ${usages.length} entr${usages.length === 1 ? 'y' : 'ies'}. Remove it from that content first, or confirm to delete it anyway.`, { usages });
    }
  }
  if (permanent) {
    if (!asset.deletedAt) throw conflict('Move the file to the trash before deleting it permanently');
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    await storage().delete(asset.storageKey).catch((err) => logger.warn({ err: err.message }, 'could not remove file from storage'));
    await audit(req, { action: 'media.purged', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename });
  } else if (!asset.deletedAt) {
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
    await audit(req, { action: 'media.deleted', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename });
    await projectEvent(req, 'media.deleted', asset);
  }
  res.status(204).end();
});

mediaRouter.post('/media/:assetId/restore', projectScope('media.manage'), async (req, res) => {
  const asset = await findAsset(req, { includeDeleted: true });
  const updated = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: null }, include: { _count: { select: { usages: true } } } });
  await audit(req, { action: 'media.restored', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename });
  res.json(present(updated));
});

// ─── Folders ─────────────────────────────────────────────────────────────────

const folderName = z.string().trim().min(1, 'Folder name is required').max(80);

mediaRouter.get('/media-folders', projectScope('media.read'), async (req, res) => {
  const folders = await prisma.mediaFolder.findMany({
    where: { projectId: param(req, 'projectId') },
    orderBy: { name: 'asc' },
    include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
  });
  res.json({ items: folders.map(({ _count, ...f }) => ({ ...f, assetCount: _count.assets })) });
});

mediaRouter.post('/media-folders', projectScope('media.manage'), async (req, res) => {
  const input = parse(z.object({ name: folderName, parentId: z.string().uuid().nullable().optional() }), req.body);
  const projectId = param(req, 'projectId');
  if (input.parentId && !(await prisma.mediaFolder.findFirst({ where: { id: input.parentId, projectId }, select: { id: true } }))) {
    throw badRequest('Parent folder does not exist');
  }
  if (await prisma.mediaFolder.findFirst({ where: { projectId, parentId: input.parentId ?? null, name: { equals: input.name, mode: 'insensitive' } }, select: { id: true } })) {
    throw conflict('A folder with that name already exists here');
  }
  const folder = await prisma.mediaFolder.create({ data: { projectId, name: input.name, parentId: input.parentId ?? null } });
  res.status(201).json({ ...folder, assetCount: 0 });
});

mediaRouter.patch('/media-folders/:folderId', projectScope('media.manage'), async (req, res) => {
  const input = parse(z.object({ name: folderName }), req.body);
  const folder = await prisma.mediaFolder.findFirst({ where: { id: param(req, 'folderId'), projectId: param(req, 'projectId') } });
  if (!folder) throw notFound('Folder');
  res.json(await prisma.mediaFolder.update({ where: { id: folder.id }, data: { name: input.name } }));
});

mediaRouter.delete('/media-folders/:folderId', projectScope('media.manage'), async (req, res) => {
  const folder = await prisma.mediaFolder.findFirst({ where: { id: param(req, 'folderId'), projectId: param(req, 'projectId') } });
  if (!folder) throw notFound('Folder');
  // Files are not deleted with their folder; they move back to the library root.
  await prisma.mediaFolder.delete({ where: { id: folder.id } });
  res.status(204).end();
});

// ─── Public delivery with on-the-fly image transformations ───────────────────

const transformQuery = z.object({
  w: z.coerce.number().int().min(1).max(4096).optional(),
  h: z.coerce.number().int().min(1).max(4096).optional(),
  fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).default('cover'),
  position: z.enum(['center', 'top', 'right', 'bottom', 'left', 'entropy', 'attention']).default('center'),
  format: z.enum(['webp', 'avif', 'jpeg', 'jpg', 'png']).optional(),
  q: z.coerce.number().int().min(1).max(100).default(80),
  download: z.enum(['true', '1']).optional(),
});

const TRANSFORMABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const mediaLimiter = rateLimit({ name: 'media', limit: 1200, windowSeconds: 60, key: ipKey });

mediaDeliveryRouter.get('/:assetId/:revision/:filename', mediaLimiter, async (req, res) => {
  const id = param(req, 'assetId');
  const asset = isUuid(id) ? await prisma.mediaAsset.findFirst({ where: { id, deletedAt: null } }) : null;
  if (!asset) throw notFound('File');
  const current = toMediaOut(asset).url;
  if (String(asset.revision) !== param(req, 'revision')) {
    // An older URL of a replaced file: send the client to the current revision.
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.redirect(302, `${current}${query}`);
    return;
  }
  const q = parse(transformQuery, req.query);
  const wantsTransform = (q.w || q.h || q.format) && TRANSFORMABLE.includes(asset.mimeType);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // The revision is in the URL, so each URL always returns the same bytes and can be cached forever.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (!wantsTransform) {
    const body = await storage().get(asset.storageKey);
    if (!body) throw notFound('File');
    const inline = !q.download && ['image', 'video'].includes(asset.kind) || (!q.download && asset.mimeType === 'application/pdf');
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`);
    // SVG can carry script; even after upload checks it is served so that nothing in it can run.
    if (asset.mimeType === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.send(body);
    return;
  }

  const format = q.format === 'jpg' ? 'jpeg' : (q.format ?? (asset.mimeType.split('/')[1] as 'jpeg' | 'png' | 'webp' | 'avif'));
  const signature = createHash('sha256').update(JSON.stringify([q.w ?? 0, q.h ?? 0, q.fit, q.position, format, q.q])).digest('hex').slice(0, 24);
  const derivedKey = `derived/${asset.projectId}/${asset.id}/${asset.revision}/${signature}.${format}`;
  let output = await storage().get(derivedKey);
  if (!output) {
    const source = await storage().get(asset.storageKey);
    if (!source) throw notFound('File');
    const pipeline = sharp(source, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: q.w, height: q.h, fit: q.fit, position: q.position, withoutEnlargement: true });
    output = await (format === 'webp'
      ? pipeline.webp({ quality: q.q })
      : format === 'avif'
        ? pipeline.avif({ quality: q.q })
        : format === 'png'
          ? pipeline.png({ compressionLevel: 9 })
          : pipeline.jpeg({ quality: q.q, mozjpeg: true })
    ).toBuffer();
    // Stored once, then every later request for the same variant is a plain read.
    await storage().put(derivedKey, output, `image/${format}`).catch((err) => logger.warn({ err: err.message }, 'could not cache derived image'));
  }
  res.setHeader('Content-Type', `image/${format}`);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(asset.filename.replace(/\.[^.]+$/, '') + '.' + format)}`);
  res.send(output);
});
