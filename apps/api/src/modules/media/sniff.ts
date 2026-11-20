/**
 * File type detection from content, not from the name or the browser-supplied MIME type.
 * An upload is accepted only when its bytes match one of the formats below AND its
 * extension belongs to that format.
 */

export type MediaKind = 'image' | 'video' | 'document' | 'archive' | 'other';

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

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');
const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => buf[offset + i] === b);

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  return !sample.includes(0);
}

export interface Sniffed {
  mime: string;
  kind: MediaKind;
  format: string;
}

export function sniff(buf: Buffer, extension: string): Sniffed | { error: string } {
  const ext = extension.toLowerCase();
  const accept = (format: string): Sniffed | { error: string } => {
    const f = FORMATS[format];
    if (!f.extensions.includes(ext)) {
      return { error: `File content is ${format.toUpperCase()} but the extension is .${ext || '(none)'}. Rename the file or upload the correct format.` };
    }
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
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])) {
    // Office Open XML documents are ZIP containers; the extension picks the specific type.
    return accept(ext === 'docx' ? 'docx' : ext === 'xlsx' ? 'xlsx' : 'zip');
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return accept(ext === 'xls' ? 'xls' : 'doc');

  if (looksLikeText(buf)) {
    const head = buf.subarray(0, 4096).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || (head.startsWith('<!--') && head.includes('<svg'))) return accept('svg');
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

/**
 * SVG is active content. Files containing anything executable are rejected outright
 * (and SVGs are additionally served with a sandboxing Content-Security-Policy).
 */
export function inspectSvg(buf: Buffer): string | null {
  const text = buf.toString('utf8');
  for (const [pattern, label] of SVG_DANGERS) {
    if (pattern.test(text)) return `This SVG contains ${label}, which is not allowed. Export a plain SVG and try again.`;
  }
  return null;
}

export function safeFilename(original: string): { name: string; extension: string } {
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
