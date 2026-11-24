/**
 * The in-browser backend behind guest mode.
 *
 * `lib/api.ts` hands every request here instead of the network when guest mode is on:
 * the management API, uploads, downloads and the public delivery API. Nothing in this
 * folder talks to a server, and no guest data ever leaves the browser.
 *
 * Loaded with a dynamic import, so signed-in users never download it.
 */
import { clearStorage, db, emptyState, loadState, persistenceKind, replaceState, saveState } from './db';
import { deliver } from './delivery';
import { type DemoRequest, type DemoResponse, HttpError, Reply, errorReply, parseQuery } from './http';
import { MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES, type UploadBody, type UploadedFile, assetIdForUrl, forgetMediaUrls, serializeBody, storeMediaRefs } from './routes/media';
import { session } from './routes/org';
import { checksum, toBase64 } from './samples';
import { seed } from './seed';
import { dispatch, runScheduledWork } from './server';

export type { DemoRequest, DemoResponse } from './http';
export { MAX_UPLOAD_BYTES } from './routes/media';

let starting: Promise<void> | null = null;

/** Opens storage and loads the saved demo, or builds a fresh one on the first visit. */
function ready(): Promise<void> {
  if (!starting) {
    starting = (async () => {
      if (await loadState()) return;
      replaceState(emptyState());
      seed();
      await saveState();
    })();
  }
  return starting;
}

/** Where the demo data lives: browser storage, or memory only when storage is unavailable. */
export const persistence = (): 'indexeddb' | 'memory' => persistenceKind();

/** Starts (or resumes) the guest session and returns it in the shape of the API's sign-in response. */
export async function startSession() {
  await ready();
  return session();
}

/** Throws everything the guest changed away and restores the original demo data. */
export async function resetDemo(): Promise<void> {
  await ready();
  await clearStorage();
  forgetMediaUrls();
  replaceState(emptyState());
  seed();
  await saveState();
}

/** One management API request (`/admin/api/...`). */
export async function request(req: DemoRequest): Promise<DemoResponse> {
  await ready();
  const swept = runScheduledWork();
  const res = dispatch({ ...req, body: storeMediaRefs(req.body) });
  if (req.method !== 'GET' || swept) await saveState();
  return res;
}

// ─── Uploads ─────────────────────────────────────────────────────────────────

function readBytes(file: Blob, onProgress: (loaded: number) => void): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => onProgress(e.loaded);
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

/** Pixel size of formats whose headers are not parsed by hand (WebP, AVIF), measured by the browser. */
async function measure(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function' || !/\.(webp|avif)$/i.test((file as File).name ?? '')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

/**
 * A multipart upload, handled without any network: the browser reads each file, and it is
 * stored as a data URL. `onProgress` reports the reading, which is the only real work here.
 */
export async function upload(path: string, form: FormData, query: DemoRequest['query'], onProgress?: (fraction: number) => void): Promise<DemoResponse> {
  await ready();
  const picked = [...form.getAll('files'), ...form.getAll('file')].filter((v): v is File => typeof v !== 'string');
  // Checked before reading, so an oversized file costs nothing.
  if (picked.length > MAX_FILES_PER_UPLOAD || picked.some((f) => f.size > MAX_UPLOAD_BYTES)) {
    const tooMany = picked.length > MAX_FILES_PER_UPLOAD;
    const error = tooMany ? new HttpError(400, 'upload_error', 'Too many files') : new HttpError(413, 'file_too_large', 'File exceeds the maximum upload size');
    const reply = errorReply(error);
    return { status: reply.status, ok: false, headers: {}, body: reply.body };
  }
  const total = picked.reduce((n, f) => n + f.size, 0) || 1;
  const loaded = picked.map(() => 0);
  const prepared: UploadedFile[] = [];
  for (const [i, file] of picked.entries()) {
    const bytes = await readBytes(file, (n) => {
      loaded[i] = n;
      onProgress?.(Math.min(0.99, loaded.reduce((a, b) => a + b, 0) / total));
    });
    loaded[i] = file.size;
    prepared.push({ name: file.name, size: bytes.length, bytes, dataUrl: `data:${file.type || 'application/octet-stream'};base64,${toBase64(bytes)}`, checksum: checksum(bytes), measured: await measure(file) });
  }
  const folderId = form.get('folderId');
  const body: UploadBody = { files: prepared, folderId: typeof folderId === 'string' ? folderId : null };
  const res = dispatch({ method: 'POST', path, query, body });
  await saveState();
  onProgress?.(1);
  return res;
}

// ─── Delivery API ────────────────────────────────────────────────────────────

/** One public delivery API request (`/api/v1/...`), authorised by a demo key. */
export async function delivery(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<DemoResponse> {
  await ready();
  runScheduledWork();
  const [pathname, search = ''] = path.split('?');
  let reply: Reply;
  try {
    reply = deliver({ method: (init.method ?? 'GET').toUpperCase(), path: pathname || '/', query: parseQuery(search), body: storeMediaRefs(init.body), token });
  } catch (err) {
    reply = errorReply(err);
  }
  // Every call counts towards the key's usage, so it is always saved.
  await saveState();
  return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, headers: reply.headers, body: serializeBody(reply.body) };
}

// ─── Images ──────────────────────────────────────────────────────────────────

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be decoded in this browser.'));
    image.src = src;
  });

/**
 * Renders an image variant (`<asset url>?w=…&h=…&fit=…&format=…&q=…`) with a canvas. On a
 * server the media service does this; here the browser does, so smart cropping falls back
 * to the centre and only the formats this browser can encode are available.
 */
export async function transformImage(variantUrl: string): Promise<{ url: string; size: number; width: number; height: number }> {
  await ready();
  const [source, fragment = ''] = variantUrl.split('#');
  const params = new URLSearchParams(fragment.replace(/^\?/, ''));
  const original = db.assets.find((a) => a.id === assetIdForUrl(`${source}#`));
  const image = await loadImage(source);
  const natural = { w: image.naturalWidth || 1, h: image.naturalHeight || 1 };
  const w = Number(params.get('w')) || 0;
  const h = Number(params.get('h')) || 0;
  const fit = params.get('fit') ?? 'cover';
  const ratio = natural.w / natural.h;

  // Target box, never enlarging the original (as the media service does).
  let boxW = w || Math.round(h * ratio) || natural.w;
  let boxH = h || Math.round(w / ratio) || natural.h;
  const shrink = Math.min(1, natural.w / boxW, natural.h / boxH);
  if (fit !== 'fill') {
    boxW = Math.max(1, Math.round(boxW * shrink));
    boxH = Math.max(1, Math.round(boxH * shrink));
  }
  let canvasW = boxW;
  let canvasH = boxH;
  let sx = 0;
  let sy = 0;
  let sw = natural.w;
  let sh = natural.h;
  let dx = 0;
  let dy = 0;
  let dw = boxW;
  let dh = boxH;
  if (fit === 'inside' || fit === 'outside') {
    const scale = fit === 'inside' ? Math.min(boxW / natural.w, boxH / natural.h) : Math.max(boxW / natural.w, boxH / natural.h);
    canvasW = dw = Math.max(1, Math.round(natural.w * Math.min(1, scale)));
    canvasH = dh = Math.max(1, Math.round(natural.h * Math.min(1, scale)));
  } else if (fit === 'cover') {
    const position = params.get('position') ?? 'center';
    const boxRatio = boxW / boxH;
    if (ratio > boxRatio) {
      sw = Math.round(natural.h * boxRatio);
      sx = position === 'left' ? 0 : position === 'right' ? natural.w - sw : Math.round((natural.w - sw) / 2);
    } else {
      sh = Math.round(natural.w / boxRatio);
      sy = position === 'top' ? 0 : position === 'bottom' ? natural.h - sh : Math.round((natural.h - sh) / 2);
    }
  } else if (fit === 'contain') {
    const scale = Math.min(boxW / natural.w, boxH / natural.h);
    dw = Math.round(natural.w * scale);
    dh = Math.round(natural.h * scale);
    dx = Math.round((boxW - dw) / 2);
    dy = Math.round((boxH - dh) / 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the variant.');
  if (fit === 'contain') {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvasW, canvasH);
  }
  context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);

  const requested = params.get('format');
  const format = requested === 'jpg' ? 'jpeg' : requested || original?.mimeType.replace('image/', '') || 'png';
  const mime = `image/${format}`;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, (Number(params.get('q')) || 80) / 100));
  if (!blob || blob.type !== mime) throw new Error(`This browser cannot encode ${format.toUpperCase()}, so guest mode cannot preview that format. A Meridian server can.`);
  return { url: URL.createObjectURL(blob), size: blob.size, width: canvasW, height: canvasH };
}
