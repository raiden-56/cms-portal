/**
 * Rich text is stored as a structured document (ProseMirror / TipTap JSON), never as raw HTML.
 *
 * `sanitizeRichText` keeps only known nodes, marks and attributes, so anything saved through
 * the API is safe by construction. `renderRichTextToHtml` is the single renderer used by the
 * delivery API, so every consumer receives identical markup.
 */

export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
}

export interface RichTextDoc extends RichTextNode {
  type: 'doc';
}

const NODE_ATTRS: Record<string, string[]> = {
  doc: [],
  paragraph: ['textAlign'],
  heading: ['level', 'textAlign'],
  text: [],
  bulletList: [],
  orderedList: ['start'],
  listItem: [],
  blockquote: [],
  codeBlock: ['language'],
  horizontalRule: [],
  hardBreak: [],
  image: ['src', 'alt', 'title', 'assetId', 'width', 'height'],
  video: ['src', 'assetId', 'poster'],
  embed: ['src', 'provider'],
  table: [],
  tableRow: [],
  tableHeader: ['colspan', 'rowspan'],
  tableCell: ['colspan', 'rowspan'],
};

const MARK_ATTRS: Record<string, string[]> = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  link: ['href', 'target', 'rel'],
  textStyle: ['color'],
  highlight: ['color'],
  subscript: [],
  superscript: [],
};

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;
const ALIGNMENTS = ['left', 'center', 'right', 'justify'];

export function isSafeUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length < 2048 && SAFE_URL.test(value.trim());
}

function cleanAttrs(allowed: string[], attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attrs || allowed.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = attrs[key];
    if (value === undefined || value === null) continue;
    if (key === 'href' || key === 'src' || key === 'poster') {
      if (isSafeUrl(value)) out[key] = value.trim();
    } else if (key === 'color') {
      if (typeof value === 'string' && SAFE_COLOR.test(value)) out[key] = value;
    } else if (key === 'textAlign') {
      if (typeof value === 'string' && ALIGNMENTS.includes(value)) out[key] = value;
    } else if (key === 'level' || key === 'start' || key === 'colspan' || key === 'rowspan' || key === 'width' || key === 'height') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 10000) out[key] = n;
    } else if (key === 'target') {
      if (value === '_blank' || value === '_self') out[key] = value;
    } else if (typeof value === 'string' && value.length <= 2048) {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeNode(node: unknown, depth: number): RichTextNode | null {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  const n = node as RichTextNode;
  if (typeof n.type !== 'string' || !(n.type in NODE_ATTRS)) return null;
  const out: RichTextNode = { type: n.type };
  const attrs = cleanAttrs(NODE_ATTRS[n.type], n.attrs);
  if (attrs) out.attrs = attrs;
  if (n.type === 'text') {
    if (typeof n.text !== 'string' || n.text.length === 0) return null;
    out.text = n.text;
    if (Array.isArray(n.marks)) {
      const marks: RichTextMark[] = [];
      for (const m of n.marks) {
        if (!m || typeof m.type !== 'string' || !(m.type in MARK_ATTRS)) continue;
        const mark: RichTextMark = { type: m.type };
        const markAttrs = cleanAttrs(MARK_ATTRS[m.type], m.attrs);
        if (m.type === 'link' && !markAttrs?.href) continue;
        if (markAttrs) mark.attrs = markAttrs;
        marks.push(mark);
      }
      if (marks.length) out.marks = marks;
    }
    return out;
  }
  if ((n.type === 'image' || n.type === 'video' || n.type === 'embed') && !out.attrs?.src) return null;
  if (Array.isArray(n.content)) {
    const content = n.content.map((c) => sanitizeNode(c, depth + 1)).filter((c): c is RichTextNode => c !== null);
    if (content.length) out.content = content;
  }
  return out;
}

export function isRichTextDoc(value: unknown): value is RichTextDoc {
  return !!value && typeof value === 'object' && (value as RichTextNode).type === 'doc';
}

export function sanitizeRichText(value: unknown): RichTextDoc | null {
  if (!isRichTextDoc(value)) return null;
  const doc = sanitizeNode(value, 0);
  if (!doc) return null;
  return { ...doc, type: 'doc', content: doc.content ?? [] };
}

export function emptyRichText(): RichTextDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function richTextToPlainText(value: unknown): string {
  if (!isRichTextDoc(value)) return '';
  const parts: string[] = [];
  const walk = (node: RichTextNode) => {
    if (node.type === 'text' && node.text) parts.push(node.text);
    if (node.content) {
      node.content.forEach(walk);
      if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'tableRow'].includes(node.type)) parts.push('\n');
    }
  };
  walk(value);
  return parts.join('').replace(/\n{2,}/g, '\n').trim();
}

export function isRichTextEmpty(value: unknown): boolean {
  if (!isRichTextDoc(value)) return true;
  if (richTextToPlainText(value).length > 0) return false;
  let hasMedia = false;
  const walk = (node: RichTextNode) => {
    if (['image', 'video', 'embed', 'horizontalRule', 'table'].includes(node.type)) hasMedia = true;
    node.content?.forEach(walk);
  };
  walk(value);
  return !hasMedia;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function styleAttr(attrs: Record<string, unknown> | undefined): string {
  const align = attrs?.textAlign;
  return typeof align === 'string' && align !== 'left' ? ` style="text-align:${align}"` : '';
}

function renderMarks(text: string, marks: RichTextMark[] | undefined): string {
  let html = escapeHtml(text);
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'underline':
        html = `<u>${html}</u>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'subscript':
        html = `<sub>${html}</sub>`;
        break;
      case 'superscript':
        html = `<sup>${html}</sup>`;
        break;
      case 'highlight': {
        const color = typeof mark.attrs?.color === 'string' ? ` style="background-color:${escapeHtml(mark.attrs.color)}"` : '';
        html = `<mark${color}>${html}</mark>`;
        break;
      }
      case 'textStyle': {
        if (typeof mark.attrs?.color === 'string') html = `<span style="color:${escapeHtml(mark.attrs.color)}">${html}</span>`;
        break;
      }
      case 'link': {
        const href = escapeHtml(String(mark.attrs?.href ?? '#'));
        const blank = mark.attrs?.target === '_blank';
        html = `<a href="${href}"${blank ? ' target="_blank" rel="noopener noreferrer"' : ''}>${html}</a>`;
        break;
      }
    }
  }
  return html;
}

function renderNode(node: RichTextNode): string {
  const children = () => (node.content ?? []).map(renderNode).join('');
  switch (node.type) {
    case 'doc':
      return children();
    case 'text':
      return renderMarks(node.text ?? '', node.marks);
    case 'paragraph':
      return `<p${styleAttr(node.attrs)}>${children()}</p>`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 2)));
      return `<h${level}${styleAttr(node.attrs)}>${children()}</h${level}>`;
    }
    case 'bulletList':
      return `<ul>${children()}</ul>`;
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return `<ol${start > 1 ? ` start="${start}"` : ''}>${children()}</ol>`;
    }
    case 'listItem':
      return `<li>${children()}</li>`;
    case 'blockquote':
      return `<blockquote>${children()}</blockquote>`;
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? ` class="language-${escapeHtml(node.attrs.language)}"` : '';
      return `<pre><code${lang}>${children()}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr />';
    case 'hardBreak':
      return '<br />';
    case 'image': {
      const src = escapeHtml(String(node.attrs?.src ?? ''));
      const alt = escapeHtml(String(node.attrs?.alt ?? ''));
      const title = node.attrs?.title ? ` title="${escapeHtml(String(node.attrs.title))}"` : '';
      return `<img src="${src}" alt="${alt}"${title} loading="lazy" />`;
    }
    case 'video': {
      const src = escapeHtml(String(node.attrs?.src ?? ''));
      const poster = node.attrs?.poster ? ` poster="${escapeHtml(String(node.attrs.poster))}"` : '';
      return `<video src="${src}"${poster} controls preload="metadata"></video>`;
    }
    case 'embed': {
      const src = escapeHtml(String(node.attrs?.src ?? ''));
      return `<iframe src="${src}" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
    }
    case 'table':
      return `<table><tbody>${children()}</tbody></table>`;
    case 'tableRow':
      return `<tr>${children()}</tr>`;
    case 'tableHeader':
    case 'tableCell': {
      const tag = node.type === 'tableHeader' ? 'th' : 'td';
      const colspan = Number(node.attrs?.colspan ?? 1) > 1 ? ` colspan="${Number(node.attrs?.colspan)}"` : '';
      const rowspan = Number(node.attrs?.rowspan ?? 1) > 1 ? ` rowspan="${Number(node.attrs?.rowspan)}"` : '';
      return `<${tag}${colspan}${rowspan}>${children()}</${tag}>`;
    }
    default:
      return '';
  }
}

/** Renders a stored rich-text document to HTML. Input is re-sanitized first, so the output is always safe to inject. */
export function renderRichTextToHtml(value: unknown): string {
  const doc = sanitizeRichText(value);
  return doc ? renderNode(doc) : '';
}
