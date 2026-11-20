import { type BlockDefinition, type BlockNode, type FieldDef, type PageData, collectReferences, findBlock, findParentId, isUuid, walkBlocks } from '@meridian/shared';

/** Where a dragged block would land: among the children of `parentId` (null = page root) at `index`. */
export interface DropTarget {
  parentId: string | null;
  index: number;
}

export type DragSource = { kind: 'block'; id: string } | { kind: 'palette'; type: string };

export const sameTarget = (a: DropTarget | null, b: DropTarget | null) => a === b || (!!a && !!b && a.parentId === b.parentId && a.index === b.index);

/** True when `id` is `rootId` itself or sits anywhere underneath it. */
export function isInSubtree(blocks: BlockNode[], rootId: string, id: string): boolean {
  if (rootId === id) return true;
  const root = findBlock(blocks, rootId);
  return !!root && !!findBlock(root.children ?? [], id);
}

export function siblingsOf(blocks: BlockNode[], id: string): { parentId: string | null; siblings: BlockNode[]; index: number } | null {
  const parent = findParentId(blocks, id);
  if (parent === undefined) return null;
  const siblings = parent === null ? blocks : (findBlock(blocks, parent)?.children ?? []);
  return { parentId: parent, siblings, index: siblings.findIndex((s) => s.id === id) };
}

/** Insertion index among `childIds` for a pointer position, in reading order (works for stacks and grids). */
function indexAmong(childIds: string[], scope: Element, x: number, y: number): number {
  for (let i = 0; i < childIds.length; i += 1) {
    const el = scope.querySelector(`[data-drop-kind="block"][data-block-id="${childIds[i]}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (y < rect.top) return i;
    if (y <= rect.bottom && x < rect.left) return i;
  }
  return childIds.length;
}

/**
 * Resolves the drop position under the pointer from the DOM: the innermost element marked
 * with `data-drop-kind` decides. Reading real geometry keeps this correct while the canvas
 * is zoomed or scrolled.
 */
export function computeDropTarget(x: number, y: number, blocks: BlockNode[], registry: Record<string, BlockDefinition>, source: DragSource): DropTarget | null {
  const el = document.elementsFromPoint(x, y).find((e): e is HTMLElement => e instanceof HTMLElement && !!e.dataset.dropKind);
  if (!el) return null;
  const kind = el.dataset.dropKind;
  let target: DropTarget | null = null;

  if (kind === 'canvas') {
    target = { parentId: null, index: indexAmong(blocks.map((b) => b.id), el, x, y) };
  } else {
    const id = el.dataset.blockId ?? '';
    const node = findBlock(blocks, id);
    const place = siblingsOf(blocks, id);
    if (!node || !place) return null;
    const { parentId, index } = place;
    const rect = el.getBoundingClientRect();
    const container = !!registry[node.type]?.acceptsChildren;
    const children = node.children ?? [];

    if (kind === 'outline') {
      const ratio = rect.height ? (y - rect.top) / rect.height : 0.5;
      if (!container) target = { parentId, index: ratio < 0.5 ? index : index + 1 };
      else if (ratio < 0.3) target = { parentId, index };
      else if (ratio > 0.7 && children.length === 0) target = { parentId, index: index + 1 };
      // Just below an open container row means "first child"; the middle of the row means "last child".
      else target = { parentId: id, index: ratio > 0.7 ? 0 : children.length };
    } else if (container) {
      const edge = Math.min(14, rect.height / 4);
      if (y < rect.top + edge) target = { parentId, index };
      else if (y > rect.bottom - edge) target = { parentId, index: index + 1 };
      else target = { parentId: id, index: indexAmong(children.map((c) => c.id), el, x, y) };
    } else {
      const horizontal = el.dataset.horizontal === 'true';
      const before = horizontal ? x < rect.left + rect.width / 2 : y < rect.top + rect.height / 2;
      target = { parentId, index: before ? index : index + 1 };
    }
  }

  // A block can never be dropped into itself or its own descendants.
  if (target && source.kind === 'block' && target.parentId && isInSubtree(blocks, source.id, target.parentId)) return null;
  return target;
}

/** Blocks in document order, for keyboard navigation between them. */
export function flattenBlocks(blocks: BlockNode[]): BlockNode[] {
  const out: BlockNode[] = [];
  walkBlocks(blocks, (node) => {
    out.push(node);
  });
  return out;
}

/** Every media asset a page refers to: block fields, block backgrounds and the social image. */
export function collectPageMedia(page: PageData, registry: Record<string, BlockDefinition>, componentFields: Record<string, FieldDef[]>): string[] {
  const ids = new Set<string>();
  if (isUuid(page.seo?.ogImage)) ids.add(page.seo.ogImage);
  walkBlocks(page.blocks ?? [], (node) => {
    const def = registry[node.type];
    if (def) for (const id of collectReferences(def.fields, node.props ?? {}, componentFields).media) ids.add(id);
    const background = node.style?.background?.imageId;
    if (isUuid(background)) ids.add(background);
  });
  return [...ids];
}

export interface PublishIssue {
  blockId: string | null;
  label: string;
  message: string;
}

export interface IssueMap {
  /** Page-level problems by field (title, slug). */
  page: Record<string, string>;
  /** Block problems: block id → path inside the block's props → message. */
  blocks: Record<string, Record<string, string>>;
  list: PublishIssue[];
}

export const NO_ISSUES: IssueMap = { page: {}, blocks: {}, list: [] };

/**
 * Maps validation paths from the API (`blocks.1.children.0.props.heading`) onto the blocks
 * they belong to, so each problem can be shown on its block and selected with a click.
 */
export function mapIssues(details: unknown, page: PageData, registry: Record<string, BlockDefinition>): IssueMap {
  const out: IssueMap = { page: {}, blocks: {}, list: [] };
  if (!Array.isArray(details)) return out;
  for (const detail of details as { path?: string; message?: string }[]) {
    const message = detail.message ?? 'Invalid value';
    const tokens = (detail.path ?? '').split('.').filter(Boolean);
    if (tokens[0] !== 'blocks' || tokens.length < 2) {
      const key = tokens.join('.') || 'page';
      if (!(key in out.page)) out.page[key] = message;
      out.list.push({ blockId: null, label: 'Page', message });
      continue;
    }
    let nodes: BlockNode[] = page.blocks ?? [];
    let node: BlockNode | undefined;
    let i = 1;
    while (i < tokens.length) {
      node = nodes[Number(tokens[i])];
      i += 1;
      if (!node || tokens[i] !== 'children') break;
      nodes = node.children ?? [];
      i += 1;
    }
    if (!node) {
      out.list.push({ blockId: null, label: 'Page', message });
      continue;
    }
    const label = registry[node.type]?.label ?? node.type;
    if (tokens[i] === 'props' && tokens.length > i + 1) {
      const fieldPath = tokens.slice(i + 1).join('.');
      // The API prefixes block messages with the block label; the field itself only needs the reason.
      const plain = message.startsWith(`${label}: `) ? message.slice(label.length + 2) : message;
      out.blocks[node.id] = { ...(out.blocks[node.id] ?? {}), [fieldPath]: out.blocks[node.id]?.[fieldPath] ?? plain };
    } else if (!out.blocks[node.id]) {
      out.blocks[node.id] = {};
    }
    out.list.push({ blockId: node.id, label, message: message.startsWith(`${label}: `) ? message.slice(label.length + 2) : message });
  }
  return out;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .tiptap, [role="textbox"], [role="combobox"], [role="slider"], [role="dialog"], [role="menu"], [role="listbox"]');
}
