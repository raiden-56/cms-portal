/** Media library. Files are kept as data URLs in the browser; nothing is uploaded anywhere. */
import { z } from 'zod';
import { isUuid, newId } from '@meridian/shared';
import { type Ctx, type EventScope, audit, emitEvent, guest, isPageType, loadSchema, projectScope } from '../context';
import { type DbAsset, type MediaKind, db, dropFile, files, nowIso, putFile } from '../db';
import { entryMedia } from '../engine';
import { HttpError, Reply, badRequest, conflict, created, noContent, notFound, paginate, parse, toPage } from '../http';
import type { Router } from '../router';

/** Per-file limit in guest mode. Files live in browser storage, so the cap is far below a server's. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Everything a guest uploads stays in memory, so the whole library is capped too. */
export const MAX_LIBRARY_BYTES = 60 * 1024 * 1024;
export const MAX_FILES_PER_UPLOAD = 10;

interface Format {
  mime: string;
  kind: MediaKind;
  extensions: string[];
}

const FORMATS: Record<string, Format> = {
  jpeg: { mime: 'image/jpeg', kind: 'image', extensions: ['jpg', 'jpeg'] },
  png: { mime: 'image/png', kind: 'image', extensions: ['png'] },
  gif: { mime: 'image/gif', kind: 'image', extensions: ['gif'] },
  webp: { mime: 'image/webp', kind: 'image', extensions: ['webp'] },
  avif: { mime: 'image/avif', kind: 'image', extensions: ['avif'] },
  svg: { mime: 'image/svg+xml', kind: 'image', extensions: ['svg'] },
  mp4: { mime: 'video/mp4', kind: 'video', extensions: ['mp4', 'm4v'] },
  mov: { mime: 'video/quicktime', kind: 'video', extensions: ['mov'] },
  webm: { mime: 'video/webm', kind: 'video', extensions: ['webm'] },
  pdf: { mime: 'application/pdf', kind: 'document', extensions: ['pdf'] },
  zip: { mime: 'application/zip', kind: 'archive', extensions: ['zip'] },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', extensions: ['docx'] },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document', extensions: ['xlsx'] },
  doc: { mime: 'application/msword', kind: 'document', extensions: ['doc'] },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document', extensions: ['xls'] },
  csv: { mime: 'text/csv', kind: 'document', extensions: ['csv'] },
  txt: { mime: 'text/plain', kind: 'document', extensions: ['txt'] },
};

export const ALLOWED_EXTENSIONS = [...new Set(Object.values(FORMATS).flatMap((f) => f.extensions))].sort();

/** A file after the browser has read it: what the upload handlers receive instead of multipart bytes. */
export interface UploadedFile {
  name: string;
  size: number;
  bytes: Uint8Array;
  dataUrl: string;
  checksum: string;
  /** Dimensions the browser measured for formats this module cannot parse itself. */
  measured?: { width: number; height: number } | null;
}

export interface UploadBody {
  files: UploadedFile[];
  folderId?: string | null;
}

function safeFilename(original: string): { name: string; extension: string } {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const stem =
    (dot > 0 ? base.slice(0, dot) : base)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 120) || 'file';
  return { name: extension ? `${stem}.${extension}` : stem, extension };
}

const ascii = (buf: Uint8Array, start: number, end: number) => String.fromCharCode(...buf.subarray(start, end));
const startsWith = (buf: Uint8Array, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);
const textOf = (buf: Uint8Array, limit = buf.length) => new TextDecoder().decode(buf.subarray(0, limit));

/** File type detection from content, not from the name: the same checks the API's upload endpoint makes. */
function sniff(buf: Uint8Array, extension: string): { mime: string; kind: MediaKind; format: string } | { error: string } {
  const ext = extension.toLowerCase();
  const accept = (format: string) => {
    const f = FORMATS[format];
    if (!f.extensions.includes(ext)) return { error: `File content is ${format.toUpperCase()} but the extension is .${ext || '(none)'}. Rename the file or upload the correct format.` };
    return { mime: f.mime, kind: f.kind, format };
  };
  if (buf.length < 4) return { error: 'File is empty or too small to identify' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return accept('jpeg');
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return accept('png');
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return accept('gif');
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return accept('webp');
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    if (brand === 'avif' || brand === 'avis') return accept('avif');
    if (brand === 'qt  ') return accept('mov');
    return accept(ext === 'mov' ? 'mov' : 'mp4');
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return accept('webm');
  if (ascii(buf, 0, 5) === '%PDF-') return accept('pdf');
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) return accept(ext === 'docx' ? 'docx' : ext === 'xlsx' ? 'xlsx' : 'zip');
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return accept(ext === 'xls' ? 'xls' : 'doc');
  if (!buf.subarray(0, 8192).includes(0)) {
    const head = textOf(buf, 4096).replace(/^﻿/, '').trimStart().toLowerCase();
    if (head.startsWith('<svg') || ((head.startsWith('<?xml') || head.startsWith('<!--')) && head.includes('<svg'))) return accept('svg');
    if (/^(<!doctype|<html|<script|<\?php)/.test(head)) return { error: 'HTML and script files cannot be uploaded' };
    if (ext === 'csv') return accept('csv');
    if (ext === 'txt') return accept('txt');
  }
  return { error: `Unsupported or unrecognised file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
}

const SVG_DANGERS: [RegExp, string][] = [
  [/<\s*script/i, 'script elements'],
  [/<\s*foreignObject/i, 'foreignObject elements'],
  [/<\s*(iframe|embed|object|audio|video|animate[^>]*\battributeName\s*=\s*["']?(?:xlink:)?href)/i, 'embedded or animated external content'],
  [/\son[a-z]+\s*=/i, 'event handler attributes'],
  [/(?:xlink:)?href\s*=\s*["']?\s*(?:javascript|data:text\/html|vbscript):/i, 'script URLs'],
  [/<!ENTITY/i, 'XML entities'],
];

/** Pixel size read from the file header, for the formats where that is a few bytes of parsing. */
function dimensions(buf: Uint8Array, format: string): { width: number; height: number } | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (format === 'png' && buf.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (format === 'gif' && buf.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (format === 'jpeg') {
    let at = 2;
    while (at + 9 < buf.length && buf[at] === 0xff) {
      const marker = buf[at + 1];
      // Start-of-frame markers carry the size; C4, C8 and CC are other segment kinds in the same range.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      at += 2 + view.getUint16(at + 2);
    }
  }
  if (format === 'svg') {
    const tag = /<svg[^>]*>/i.exec(textOf(buf, 8192))?.[0] ?? '';
    const attr = (name: string) => Number.parseFloat(new RegExp(`\\s${name}\\s*=\\s*["']([0-9.]+)`, 'i').exec(tag)?.[1] ?? '');
    const box = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(tag);
    const width = attr('width') || Number.parseFloat(box?.[1] ?? '');
    const height = attr('height') || Number.parseFloat(box?.[2] ?? '');
    if (width > 0 && height > 0) return { width: Math.round(width), height: Math.round(height) };
  }
  return null;
}

function inspect(file: UploadedFile) {
  const { name, extension } = safeFilename(file.name);
  const detected = sniff(file.bytes, extension);
  if ('error' in detected) throw badRequest(`${file.name}: ${detected.error}`);
  if (detected.format === 'svg') {
    const text = textOf(file.bytes);
    for (const [pattern, label] of SVG_DANGERS) {
      if (pattern.test(text)) throw badRequest(`${file.name}: This SVG contains ${label}, which is not allowed. Export a plain SVG and try again.`);
    }
  }
  const size = detected.kind === 'image' ? (dimensions(file.bytes, detected.format) ?? file.measured ?? null) : null;
  return { filename: name, mimeType: detected.mime, kind: detected.kind, width: size?.width ?? null, height: size?.height ?? null, checksum: file.checksum };
}

// ─── URLs ────────────────────────────────────────────────────────────────────

const urls = new Map<string, { revision: number; url: string }>();

/**
 * Address of a stored file: an object URL (or the data URL itself where those do not exist).
 * It ends in `#` so the `?w=…&format=…` image parameters the screens append land in the
 * fragment, which a local URL ignores, instead of corrupting it.
 */
export function mediaUrl(asset: Pick<DbAsset, 'id' | 'revision' | 'mimeType'>): string {
  const cached = urls.get(asset.id);
  if (cached && cached.revision === asset.revision) return cached.url;
  const dataUrl = files.get(asset.id) ?? 'data:application/octet-stream;base64,';
  let url = `${dataUrl}#`;
  if (typeof URL.createObjectURL === 'function') {
    try {
      url = `${URL.createObjectURL(dataUrlToBlob(dataUrl, asset.mimeType))}#`;
      if (cached) URL.revokeObjectURL(cached.url.slice(0, -1));
    } catch {
      // Fall back to the data URL.
    }
  }
  urls.set(asset.id, { revision: asset.revision, url });
  return url;
}

export function assetIdForUrl(url: string): string | null {
  for (const [id, entry] of urls) if (entry.url === url) return id;
  return null;
}

/**
 * A local file address stops working when the tab reloads, and content may embed one (an image
 * placed in rich text). Stored content therefore keeps a stable reference instead —
 * `#media/<asset id>` — which is swapped back for a working address whenever a response is sent.
 */
const MEDIA_REF = /#media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** Request body → what is stored: every address of a library file becomes a reference to the asset. */
export function storeMediaRefs<T>(value: T): T {
  if (typeof value === 'string') {
    if (!value.startsWith('blob:') && !value.startsWith('data:')) return value;
    const id = assetIdForUrl(`${value.split('#')[0]}#`);
    return (id ? `#media/${id}` : value) as T;
  }
  if (Array.isArray(value)) return value.map(storeMediaRefs) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, storeMediaRefs(v)])) as T;
  return value;
}

/** Response body → plain JSON, detached from the database, with media references made addressable again. */
export function serializeBody(body: unknown): unknown {
  if (body === null || body === undefined || typeof body === 'string') return body ?? null;
  const json = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== 'string' || !value.includes('#media/')) return value;
    return value.replace(MEDIA_REF, (ref, id: string) => {
      const asset = db.assets.find((a) => a.id === id.toLowerCase());
      return asset ? mediaUrl(asset) : ref;
    });
  });
  return JSON.parse(json) as unknown;
}

export function forgetMediaUrls(): void {
  if (typeof URL.revokeObjectURL === 'function') for (const { url } of urls.values()) if (url.startsWith('blob:')) URL.revokeObjectURL(url.slice(0, -1));
  urls.clear();
}

export function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes(';base64')) return new Blob([decodeURIComponent(payload)], { type: mimeType });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ─── Usage ───────────────────────────────────────────────────────────────────

/** Asset id → ids of the entries that reference it, across every environment of the project. */
function usageIndex(projectId: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const environment of db.environments.filter((e) => e.projectId === projectId)) {
    const schema = loadSchema(environment.id);
    for (const entry of db.entries) {
      if (entry.environmentId !== environment.id) continue;
      const type = schema.typeById.get(entry.contentTypeId);
      if (!type) continue;
      for (const assetId of entryMedia(schema, type, entry)) index.set(assetId, [...(index.get(assetId) ?? []), entry.id]);
    }
  }
  return index;
}

function usagesOf(asset: DbAsset) {
  const ids = new Set(usageIndex(asset.projectId).get(asset.id) ?? []);
  return db.entries
    .filter((e) => ids.has(e.id) && !e.deletedAt)
    .flatMap((e) => {
      const type = db.contentTypes.find((t) => t.id === e.contentTypeId);
      const environment = db.environments.find((x) => x.id === e.environmentId);
      if (!type || !environment) return [];
      return [{ entryId: e.id, title: e.title, status: e.status, environmentId: e.environmentId, environment: environment.name, contentType: type.apiId, contentTypeName: type.displayName, isPage: isPageType(type) }];
    });
}

export const toMediaOut = (asset: DbAsset) => ({
  id: asset.id,
  url: mediaUrl(asset),
  filename: asset.filename,
  mimeType: asset.mimeType,
  kind: asset.kind,
  size: asset.size,
  width: asset.width,
  height: asset.height,
  alt: asset.alt,
  caption: asset.caption,
});

const present = (asset: DbAsset, index: Map<string, string[]>) => ({ ...asset, url: mediaUrl(asset), usageCount: index.get(asset.id)?.length ?? 0 });

function projectEvent(c: Ctx, event: 'media.uploaded' | 'media.updated' | 'media.deleted', asset: DbAsset) {
  if (!c.project) return;
  // Media is shared by a project's environments, so each one hears about the change.
  for (const environment of db.environments.filter((e) => e.projectId === asset.projectId)) {
    const scope: EventScope = { project: c.project, environment };
    emitEvent(scope, { event, documentId: asset.id, title: asset.filename });
  }
}

function findAsset(c: Ctx, opts: { includeDeleted?: boolean } = {}): DbAsset {
  const project = projectScope(c);
  const asset = db.assets.find((a) => a.id === c.params.assetId && a.projectId === project.id && (opts.includeDeleted || !a.deletedAt));
  if (!asset) throw notFound('Media asset');
  return asset;
}

const tooLarge = () => new HttpError(413, 'file_too_large', 'File exceeds the maximum upload size');

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(48),
  search: z.string().trim().max(120).optional(),
  kind: z.enum(['image', 'video', 'document', 'archive', 'other']).optional(),
  folderId: z.string().optional(),
  tag: z.string().trim().max(60).optional(),
  unused: z.enum(['true', 'false']).optional(),
  trash: z.enum(['true', 'false']).optional(),
  ids: z.string().max(8000).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'largest']).default('newest'),
});

const tag = z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9][a-z0-9 _-]*$/, 'Tags use letters, numbers, spaces, hyphens and underscores');
const folderName = z.string().trim().min(1, 'Folder name is required').max(80);

export function mediaRoutes(r: Router): void {
  const base = '/projects/:projectId';

  r.get(`${base}/media`, (c) => {
    const q = parse(listQuery, c.query);
    const project = projectScope(c);
    const index = usageIndex(project.id);
    const all = db.assets.filter((a) => a.projectId === project.id);
    if (q.ids !== undefined) {
      const ids = q.ids.split(',').filter(isUuid).slice(0, 200);
      const found = all.filter((a) => ids.includes(a.id));
      return toPage(found.map((a) => present(a, index)), found.length, 1, Math.max(1, found.length));
    }
    const needle = q.search?.toLowerCase();
    const has = (v: string) => v.toLowerCase().includes(needle as string);
    const rows = all.filter(
      (a) =>
        (q.trash === 'true' ? !!a.deletedAt : !a.deletedAt) &&
        (!q.kind || a.kind === q.kind) &&
        (q.folderId === 'root' ? a.folderId === null : !q.folderId || !isUuid(q.folderId) || a.folderId === q.folderId) &&
        (!q.tag || a.tags.includes(q.tag)) &&
        (q.unused !== 'true' || !index.get(a.id)?.length) &&
        (!needle || has(a.filename) || has(a.alt) || has(a.caption) || a.tags.includes(needle)),
    );
    rows.sort((a, b) =>
      q.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : q.sort === 'name' ? a.filename.localeCompare(b.filename) : q.sort === 'largest' ? b.size - a.size : b.createdAt.localeCompare(a.createdAt),
    );
    const page = paginate(rows, q.page, q.pageSize);
    return { ...page, items: page.items.map((a) => present(a, index)) };
  });

  r.get(`${base}/media-stats`, (c) => {
    const project = projectScope(c);
    const live = db.assets.filter((a) => a.projectId === project.id && !a.deletedAt);
    const index = usageIndex(project.id);
    const kinds = [...new Set(live.map((a) => a.kind))];
    const tags = new Map<string, number>();
    for (const a of live) for (const t of a.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    return {
      totalAssets: live.length,
      totalBytes: live.reduce((n, a) => n + a.size, 0),
      byKind: kinds.map((kind) => ({ kind, count: live.filter((a) => a.kind === kind).length, bytes: live.filter((a) => a.kind === kind).reduce((n, a) => n + a.size, 0) })),
      unusedAssets: live.filter((a) => !index.get(a.id)?.length).length,
      tags: [...tags.entries()].map(([t, n]) => ({ tag: t, n })).sort((a, b) => b.n - a.n).slice(0, 40),
      allowedExtensions: ALLOWED_EXTENSIONS,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      storageDriver: 'browser',
    };
  });

  r.post(`${base}/media`, (c) => {
    const body = c.body as UploadBody;
    const project = projectScope(c);
    const incoming = body.files ?? [];
    if (incoming.length === 0) throw badRequest('Attach at least one file in the "files" field');
    if (incoming.length > MAX_FILES_PER_UPLOAD) throw badRequest('Too many files');
    if (incoming.some((f) => f.size > MAX_UPLOAD_BYTES)) throw tooLarge();
    const folderId = typeof body.folderId === 'string' && isUuid(body.folderId) ? body.folderId : null;
    if (folderId && !db.folders.some((f) => f.id === folderId && f.projectId === project.id)) throw badRequest('Folder does not exist');
    const allowDuplicates = c.query.allowDuplicates === 'true';
    const index = usageIndex(project.id);
    const uploaded: unknown[] = [];
    const errors: { filename: string; message: string }[] = [];
    let stored = db.assets.reduce((n, a) => n + a.size, 0);

    for (const file of incoming) {
      try {
        const info = inspect(file);
        const existing = allowDuplicates ? undefined : db.assets.find((a) => a.projectId === project.id && a.checksum === info.checksum && !a.deletedAt);
        if (existing) {
          // Identical bytes are already in the library: reuse them instead of storing a second copy.
          uploaded.push({ ...present(existing, index), duplicate: true });
          continue;
        }
        if (stored + file.size > MAX_LIBRARY_BYTES) throw badRequest(`${file.name}: the guest-mode library is full. Delete some files permanently or reset the demo data.`);
        stored += file.size;
        const at = nowIso();
        const asset: DbAsset = { id: newId(), projectId: project.id, folderId, ...info, size: file.size, alt: '', caption: '', tags: [], revision: 1, createdById: guest().id, createdAt: at, updatedAt: at, deletedAt: null };
        db.assets.push(asset);
        putFile(asset.id, file.dataUrl);
        audit(c, { action: 'media.uploaded', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename, after: { size: asset.size, mimeType: asset.mimeType } });
        projectEvent(c, 'media.uploaded', asset);
        uploaded.push({ ...present(asset, index), duplicate: false });
      } catch (err) {
        errors.push({ filename: file.name, message: err instanceof HttpError ? err.message : 'Upload failed. Try again.' });
      }
    }
    return new Reply(uploaded.length ? 201 : 400, { items: uploaded, errors });
  });

  r.get(`${base}/media/:assetId`, (c) => {
    const asset = findAsset(c, { includeDeleted: true });
    return { ...present(asset, usageIndex(asset.projectId)), usages: usagesOf(asset) };
  });

  r.patch(`${base}/media/:assetId`, (c) => {
    const input = parse(
      z.object({ filename: z.string().trim().min(1).max(160).optional(), alt: z.string().trim().max(500).optional(), caption: z.string().trim().max(1000).optional(), tags: z.array(tag).max(30).optional(), folderId: z.string().uuid().nullable().optional() }),
      c.body,
    );
    const asset = findAsset(c);
    const before = { filename: asset.filename, alt: asset.alt, tags: asset.tags };
    if (input.filename) {
      const current = safeFilename(asset.filename);
      const next = safeFilename(input.filename);
      // Renaming keeps the original extension so the name can never misrepresent the content.
      const stem = next.extension ? next.name.slice(0, -(next.extension.length + 1)) : next.name;
      asset.filename = current.extension ? `${stem}.${current.extension}` : stem;
    }
    if (input.alt !== undefined) asset.alt = input.alt;
    if (input.caption !== undefined) asset.caption = input.caption;
    if (input.tags) asset.tags = [...new Set(input.tags)];
    if (input.folderId !== undefined) {
      if (input.folderId && !db.folders.some((f) => f.id === input.folderId && f.projectId === asset.projectId)) throw badRequest('Folder does not exist');
      asset.folderId = input.folderId;
    }
    asset.updatedAt = nowIso();
    audit(c, { action: 'media.updated', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename, before, after: { filename: asset.filename, alt: asset.alt, tags: asset.tags } });
    projectEvent(c, 'media.updated', asset);
    return { ...present(asset, usageIndex(asset.projectId)), usages: usagesOf(asset) };
  });

  /** Swaps the file behind an asset. Its id — and so every reference to it — stays valid. */
  r.post(`${base}/media/:assetId/replace`, (c) => {
    const asset = findAsset(c);
    const file = (c.body as UploadBody).files?.[0];
    if (!file) throw badRequest('Attach the replacement in the "file" field');
    if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
    const info = inspect(file);
    if (info.kind !== asset.kind) throw badRequest(`Replace this ${asset.kind} with another ${asset.kind}, not a ${info.kind}`);
    const before = { filename: asset.filename, size: asset.size, checksum: asset.checksum };
    Object.assign(asset, info, { size: file.size, revision: asset.revision + 1, updatedAt: nowIso() });
    putFile(asset.id, file.dataUrl);
    audit(c, { action: 'media.replaced', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename, before, after: { filename: asset.filename, size: asset.size, checksum: asset.checksum } });
    projectEvent(c, 'media.updated', asset);
    return { ...present(asset, usageIndex(asset.projectId)), usages: usagesOf(asset) };
  });

  r.delete(`${base}/media/:assetId`, (c) => {
    const asset = findAsset(c, { includeDeleted: true });
    const permanent = c.query.permanent === 'true';
    if (!asset.deletedAt) {
      const usages = usagesOf(asset);
      if (usages.length > 0 && c.query.force !== 'true') {
        throw conflict(`This file is used by ${usages.length} entr${usages.length === 1 ? 'y' : 'ies'}. Remove it from that content first, or confirm to delete it anyway.`, { usages });
      }
    }
    if (permanent) {
      if (!asset.deletedAt) throw conflict('Move the file to the trash before deleting it permanently');
      db.assets = db.assets.filter((a) => a.id !== asset.id);
      dropFile(asset.id);
      audit(c, { action: 'media.purged', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename });
    } else if (!asset.deletedAt) {
      asset.deletedAt = nowIso();
      audit(c, { action: 'media.deleted', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename });
      projectEvent(c, 'media.deleted', asset);
    }
    return noContent();
  });

  r.post(`${base}/media/:assetId/restore`, (c) => {
    const asset = findAsset(c, { includeDeleted: true });
    asset.deletedAt = null;
    audit(c, { action: 'media.restored', resourceType: 'media', resourceId: asset.id, resourceLabel: asset.filename });
    return present(asset, usageIndex(asset.projectId));
  });

  // ─── Folders ───────────────────────────────────────────────────────────────

  r.get(`${base}/media-folders`, (c) => {
    const project = projectScope(c);
    return {
      items: db.folders
        .filter((f) => f.projectId === project.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ ...f, assetCount: db.assets.filter((a) => a.folderId === f.id && !a.deletedAt).length })),
    };
  });

  r.post(`${base}/media-folders`, (c) => {
    const input = parse(z.object({ name: folderName, parentId: z.string().uuid().nullable().optional() }), c.body);
    const project = projectScope(c);
    const inProject = db.folders.filter((f) => f.projectId === project.id);
    if (input.parentId && !inProject.some((f) => f.id === input.parentId)) throw badRequest('Parent folder does not exist');
    if (inProject.some((f) => f.parentId === (input.parentId ?? null) && f.name.toLowerCase() === input.name.toLowerCase())) throw conflict('A folder with that name already exists here');
    const folder = { id: newId(), projectId: project.id, name: input.name, parentId: input.parentId ?? null, createdAt: nowIso() };
    db.folders.push(folder);
    return created({ ...folder, assetCount: 0 });
  });

  const findFolder = (c: Ctx) => {
    const project = projectScope(c);
    const folder = db.folders.find((f) => f.id === c.params.folderId && f.projectId === project.id);
    if (!folder) throw notFound('Folder');
    return folder;
  };

  r.patch(`${base}/media-folders/:folderId`, (c) => {
    const input = parse(z.object({ name: folderName }), c.body);
    const folder = findFolder(c);
    folder.name = input.name;
    return folder;
  });

  r.delete(`${base}/media-folders/:folderId`, (c) => {
    const folder = findFolder(c);
    // Files are not deleted with their folder; they move back to the library root.
    for (const asset of db.assets) if (asset.folderId === folder.id) asset.folderId = null;
    for (const child of db.folders) if (child.parentId === folder.id) child.parentId = null;
    db.folders = db.folders.filter((f) => f.id !== folder.id);
    return noContent();
  });
}
