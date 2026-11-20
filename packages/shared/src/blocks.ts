/**
 * Page builder model.
 *
 * A page is a tree of `BlockNode`s. Each node names a block `type` and carries structured
 * `props` plus presentation hints in `style`. Nothing here is tied to a frontend framework:
 * the delivery API returns this tree as data and every connected application maps `type`
 * to its own component implementation.
 */
import type { FieldConfig, FieldDef, FieldType } from './fields';
import { buildDefaults } from './fields';
import { type ValidationIssue, type ValidateOptions, validateEntryData } from './validation';

export interface BlockStyle {
  background?: { color?: string; imageId?: string; overlay?: number };
  textColor?: string;
  align?: 'left' | 'center' | 'right';
  padding?: { top?: number; bottom?: number; left?: number; right?: number };
  margin?: { top?: number; bottom?: number };
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  border?: { width?: number; color?: string; radius?: number };
  typography?: { headingSize?: 'sm' | 'md' | 'lg' | 'xl'; bodySize?: 'sm' | 'md' | 'lg'; fontWeight?: 'regular' | 'medium' | 'bold' };
  columns?: { desktop?: number; tablet?: number; mobile?: number };
  visibility?: { desktop?: boolean; tablet?: boolean; mobile?: boolean };
  animation?: { type?: 'none' | 'fade' | 'slide-up' | 'slide-left' | 'slide-right' | 'zoom'; delay?: number; duration?: number };
  anchor?: string;
  cssClass?: string;
}

export interface BlockNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  style?: BlockStyle;
  children?: BlockNode[];
}

export type BlockCategory = 'layout' | 'content' | 'media' | 'marketing' | 'data' | 'navigation' | 'advanced' | 'custom';

export const BLOCK_CATEGORY_LABELS: Record<BlockCategory, string> = {
  layout: 'Layout',
  content: 'Content',
  media: 'Media',
  marketing: 'Marketing',
  data: 'Dynamic data',
  navigation: 'Navigation',
  advanced: 'Advanced',
  custom: 'Custom components',
};

export interface BlockDefinition {
  type: string;
  label: string;
  description: string;
  category: BlockCategory;
  icon: string;
  fields: FieldDef[];
  acceptsChildren: boolean;
  builtIn: boolean;
  defaultStyle?: BlockStyle;
}

type FieldExtra = { required?: boolean; config?: FieldConfig };

const fd = (apiId: string, label: string, type: FieldType, extra: FieldExtra = {}): FieldDef => ({
  apiId,
  label,
  type,
  required: extra.required ?? false,
  unique: false,
  localized: false,
  config: extra.config ?? {},
  position: 0,
});

const ordered = (...fields: FieldDef[]): FieldDef[] => fields.map((f, i) => ({ ...f, position: i }));

const cta = (prefix: string, label: string): FieldDef[] => [
  fd(`${prefix}Label`, `${label} label`, 'text', { config: { width: 6, maxLength: 60 } }),
  fd(`${prefix}Url`, `${label} link`, 'url', { config: { width: 6, placeholder: '/contact or https://…' } }),
];

/** Item schemas used by the repeatable fields of built-in blocks. Keys cannot collide with user components (no dots allowed there). */
export const BUILTIN_COMPONENTS: Record<string, FieldDef[]> = {
  'builtin.link': ordered(
    fd('label', 'Label', 'text', { required: true, config: { width: 6 } }),
    fd('url', 'Link', 'url', { required: true, config: { width: 6 } }),
  ),
  'builtin.feature': ordered(
    fd('icon', 'Icon name', 'text', { config: { width: 4, helpText: 'Icon key from your frontend icon set' } }),
    fd('title', 'Title', 'text', { required: true, config: { width: 8 } }),
    fd('description', 'Description', 'textarea'),
  ),
  'builtin.card': ordered(
    fd('image', 'Image', 'image'),
    fd('title', 'Title', 'text', { required: true }),
    fd('description', 'Description', 'textarea'),
    ...cta('link', 'Link'),
  ),
  'builtin.testimonial': ordered(
    fd('quote', 'Quote', 'textarea', { required: true }),
    fd('author', 'Author', 'text', { required: true, config: { width: 6 } }),
    fd('role', 'Role / company', 'text', { config: { width: 6 } }),
    fd('avatar', 'Avatar', 'image', { config: { width: 6 } }),
    fd('rating', 'Rating', 'rating', { config: { width: 6, maxRating: 5 } }),
  ),
  'builtin.faq': ordered(
    fd('question', 'Question', 'text', { required: true }),
    fd('answer', 'Answer', 'textarea', { required: true }),
  ),
  'builtin.plan': ordered(
    fd('name', 'Plan name', 'text', { required: true, config: { width: 6 } }),
    fd('price', 'Price', 'text', { required: true, config: { width: 3, placeholder: '$49' } }),
    fd('period', 'Period', 'text', { config: { width: 3, placeholder: 'per month' } }),
    fd('description', 'Description', 'textarea'),
    fd('features', 'Features', 'textarea', { config: { helpText: 'One feature per line' } }),
    ...cta('cta', 'Button'),
    fd('highlighted', 'Highlight this plan', 'boolean'),
  ),
  'builtin.stat': ordered(
    fd('value', 'Value', 'text', { required: true, config: { width: 4, placeholder: '99.9%' } }),
    fd('label', 'Label', 'text', { required: true, config: { width: 8 } }),
    fd('description', 'Description', 'text'),
  ),
  'builtin.logo': ordered(
    fd('image', 'Logo', 'image', { required: true }),
    fd('name', 'Company name', 'text', { config: { width: 6 } }),
    fd('url', 'Link', 'url', { config: { width: 6 } }),
  ),
  'builtin.member': ordered(
    fd('photo', 'Photo', 'image'),
    fd('name', 'Name', 'text', { required: true, config: { width: 6 } }),
    fd('role', 'Role', 'text', { config: { width: 6 } }),
    fd('bio', 'Bio', 'textarea'),
    fd('profileUrl', 'Profile link', 'url'),
  ),
  'builtin.footer-column': ordered(
    fd('title', 'Column title', 'text', { required: true }),
    fd('links', 'Links', 'repeatable', { config: { component: 'builtin.link' } }),
  ),
};

const repeat = (apiId: string, label: string, component: string, extra: FieldConfig = {}): FieldDef =>
  fd(apiId, label, 'repeatable', { config: { component, ...extra } });

const def = (
  type: string,
  label: string,
  category: BlockCategory,
  icon: string,
  description: string,
  fields: FieldDef[],
  opts: { acceptsChildren?: boolean; defaultStyle?: BlockStyle } = {},
): BlockDefinition => ({
  type,
  label,
  description,
  category,
  icon,
  fields: ordered(...fields),
  acceptsChildren: opts.acceptsChildren ?? false,
  builtIn: true,
  defaultStyle: opts.defaultStyle,
});

const listingFields = (typeHint: string): FieldDef[] => [
  fd('heading', 'Heading', 'text'),
  fd('contentType', 'Content type', 'text', {
    required: true,
    config: { width: 6, placeholder: typeHint, helpText: 'API identifier of the content type to list' },
  }),
  fd('limit', 'Items to show', 'integer', { config: { width: 3, min: 1, max: 100, defaultValue: 6 } }),
  fd('sort', 'Sort', 'select', {
    config: {
      width: 3,
      defaultValue: 'newest',
      options: [
        { label: 'Newest first', value: 'newest' },
        { label: 'Oldest first', value: 'oldest' },
        { label: 'Title A–Z', value: 'title' },
      ],
    },
  }),
  fd('layout', 'Layout', 'select', {
    config: {
      width: 6,
      defaultValue: 'grid',
      options: [
        { label: 'Grid', value: 'grid' },
        { label: 'List', value: 'list' },
      ],
    },
  }),
  fd('showExcerpt', 'Show excerpt', 'boolean', { config: { width: 6, defaultValue: true } }),
];

export const BUILTIN_BLOCKS: BlockDefinition[] = [
  def('section', 'Section', 'layout', 'section', 'A container that groups other blocks', [
    fd('label', 'Section label', 'text', { config: { helpText: 'Shown in the outline only' } }),
  ], { acceptsChildren: true, defaultStyle: { padding: { top: 64, bottom: 64 }, maxWidth: 'lg' } }),
  def('columns', 'Columns', 'layout', 'columns', 'Arrange blocks side by side', [
    fd('gap', 'Gap', 'select', {
      config: {
        defaultValue: 'md',
        options: [
          { label: 'Small', value: 'sm' },
          { label: 'Medium', value: 'md' },
          { label: 'Large', value: 'lg' },
        ],
      },
    }),
  ], { acceptsChildren: true, defaultStyle: { columns: { desktop: 2, tablet: 2, mobile: 1 } } }),
  def('hero', 'Hero', 'marketing', 'hero', 'Large introductory banner with calls to action', [
    fd('eyebrow', 'Eyebrow', 'text', { config: { maxLength: 80 } }),
    fd('heading', 'Heading', 'text', { required: true, config: { maxLength: 160, defaultValue: 'A clear, confident headline' } }),
    fd('subheading', 'Subheading', 'textarea', { config: { maxLength: 400 } }),
    fd('image', 'Image', 'image'),
    fd('layout', 'Layout', 'select', {
      config: {
        defaultValue: 'centered',
        options: [
          { label: 'Centered', value: 'centered' },
          { label: 'Split — image right', value: 'split' },
          { label: 'Image background', value: 'background' },
        ],
      },
    }),
    ...cta('primary', 'Primary button'),
    ...cta('secondary', 'Secondary button'),
  ], { defaultStyle: { padding: { top: 96, bottom: 96 }, align: 'center' } }),
  def('text', 'Text', 'content', 'richtext', 'Formatted text content', [
    fd('content', 'Content', 'richtext', { required: true }),
  ], { defaultStyle: { maxWidth: 'md', padding: { top: 32, bottom: 32 } } }),
  def('image', 'Image', 'media', 'image', 'A single image with optional caption', [
    fd('image', 'Image', 'image', { required: true }),
    fd('alt', 'Alt text', 'text', { config: { helpText: 'Describe the image for screen readers' } }),
    fd('caption', 'Caption', 'text'),
    fd('link', 'Link', 'url'),
    fd('aspect', 'Aspect ratio', 'select', {
      config: {
        defaultValue: 'auto',
        options: [
          { label: 'Original', value: 'auto' },
          { label: '16:9', value: '16:9' },
          { label: '4:3', value: '4:3' },
          { label: '1:1', value: '1:1' },
        ],
      },
    }),
  ]),
  def('video', 'Video', 'media', 'video', 'Uploaded or embedded video', [
    fd('source', 'Source', 'radio', {
      config: {
        defaultValue: 'upload',
        options: [
          { label: 'Media library', value: 'upload' },
          { label: 'Embed URL', value: 'embed' },
        ],
      },
    }),
    fd('video', 'Video', 'video', { config: { visibleWhen: { field: 'source', operator: 'eq', value: 'upload' } } }),
    fd('embedUrl', 'Embed URL', 'url', {
      config: { visibleWhen: { field: 'source', operator: 'eq', value: 'embed' }, placeholder: 'https://www.youtube.com/embed/…' },
    }),
    fd('poster', 'Poster image', 'image'),
    fd('caption', 'Caption', 'text'),
    fd('autoplay', 'Autoplay (muted)', 'boolean', { config: { width: 6 } }),
    fd('loop', 'Loop', 'boolean', { config: { width: 6 } }),
  ]),
  def('split', 'Image and text', 'content', 'split', 'Image beside a block of text', [
    fd('heading', 'Heading', 'text', { required: true }),
    fd('body', 'Body', 'richtext'),
    fd('image', 'Image', 'image'),
    fd('imagePosition', 'Image position', 'radio', {
      config: {
        defaultValue: 'right',
        options: [
          { label: 'Left', value: 'left' },
          { label: 'Right', value: 'right' },
        ],
      },
    }),
    ...cta('cta', 'Button'),
  ]),
  def('feature-grid', 'Feature grid', 'marketing', 'grid', 'Grid of features with icons', [
    fd('heading', 'Heading', 'text'),
    fd('subheading', 'Subheading', 'textarea'),
    repeat('items', 'Features', 'builtin.feature', { maxItems: 24 }),
  ], { defaultStyle: { columns: { desktop: 3, tablet: 2, mobile: 1 } } }),
  def('cards', 'Cards', 'content', 'cards', 'A row of linked cards', [
    fd('heading', 'Heading', 'text'),
    repeat('items', 'Cards', 'builtin.card', { maxItems: 24 }),
  ], { defaultStyle: { columns: { desktop: 3, tablet: 2, mobile: 1 } } }),
  def('testimonials', 'Testimonials', 'marketing', 'quote', 'Customer quotes', [
    fd('heading', 'Heading', 'text'),
    repeat('items', 'Testimonials', 'builtin.testimonial', { maxItems: 24 }),
  ], { defaultStyle: { columns: { desktop: 3, tablet: 2, mobile: 1 } } }),
  def('faq', 'FAQ accordion', 'content', 'faq', 'Expandable questions and answers', [
    fd('heading', 'Heading', 'text'),
    repeat('items', 'Questions', 'builtin.faq', { maxItems: 60 }),
  ], { defaultStyle: { maxWidth: 'md' } }),
  def('pricing', 'Pricing table', 'marketing', 'pricing', 'Plans compared side by side', [
    fd('heading', 'Heading', 'text'),
    fd('subheading', 'Subheading', 'textarea'),
    repeat('plans', 'Plans', 'builtin.plan', { maxItems: 6 }),
  ], { defaultStyle: { columns: { desktop: 3, tablet: 2, mobile: 1 } } }),
  def('stats', 'Statistics', 'marketing', 'stats', 'Key numbers at a glance', [
    fd('heading', 'Heading', 'text'),
    repeat('items', 'Statistics', 'builtin.stat', { maxItems: 12 }),
  ], { defaultStyle: { columns: { desktop: 4, tablet: 2, mobile: 2 } } }),
  def('logos', 'Logo carousel', 'marketing', 'logos', 'A strip of partner or customer logos', [
    fd('heading', 'Heading', 'text'),
    repeat('logos', 'Logos', 'builtin.logo', { maxItems: 40 }),
    fd('autoplay', 'Auto-scroll', 'boolean', { config: { defaultValue: true } }),
  ]),
  def('gallery', 'Gallery', 'media', 'gallery', 'A collection of images', [
    fd('heading', 'Heading', 'text'),
    fd('images', 'Images', 'images', { required: true }),
    fd('layout', 'Layout', 'select', {
      config: {
        defaultValue: 'grid',
        options: [
          { label: 'Grid', value: 'grid' },
          { label: 'Masonry', value: 'masonry' },
          { label: 'Carousel', value: 'carousel' },
        ],
      },
    }),
  ], { defaultStyle: { columns: { desktop: 3, tablet: 2, mobile: 1 } } }),
  def('cta', 'Call to action', 'marketing', 'cta', 'A focused prompt with buttons', [
    fd('heading', 'Heading', 'text', { required: true, config: { defaultValue: 'Ready to get started?' } }),
    fd('body', 'Body', 'textarea'),
    ...cta('primary', 'Primary button'),
    ...cta('secondary', 'Secondary button'),
  ], { defaultStyle: { align: 'center', padding: { top: 72, bottom: 72 } } }),
  def('contact', 'Contact', 'content', 'contact', 'Contact details and an optional form', [
    fd('heading', 'Heading', 'text'),
    fd('body', 'Body', 'textarea'),
    fd('email', 'Email', 'email', { config: { width: 6 } }),
    fd('phone', 'Phone', 'phone', { config: { width: 6 } }),
    fd('address', 'Address', 'textarea'),
    fd('showForm', 'Show contact form', 'boolean'),
    fd('formAction', 'Form endpoint', 'url', {
      config: { visibleWhen: { field: 'showForm', operator: 'notEmpty' }, helpText: 'Where your frontend should submit the form' },
    }),
  ]),
  def('team', 'Team', 'content', 'team', 'People with photos and roles', [
    fd('heading', 'Heading', 'text'),
    fd('subheading', 'Subheading', 'textarea'),
    repeat('members', 'Members', 'builtin.member', { maxItems: 60 }),
  ], { defaultStyle: { columns: { desktop: 4, tablet: 2, mobile: 1 } } }),
  def('blog-listing', 'Blog listing', 'data', 'list', 'Lists entries from a content type', listingFields('articles'), {
    defaultStyle: { columns: { desktop: 3, tablet: 2, mobile: 1 } },
  }),
  def('product-listing', 'Product listing', 'data', 'products', 'Lists products from a content type', listingFields('products'), {
    defaultStyle: { columns: { desktop: 4, tablet: 2, mobile: 1 } },
  }),
  def('breadcrumbs', 'Breadcrumbs', 'navigation', 'breadcrumbs', 'Trail generated from the page hierarchy', [
    fd('showHome', 'Include home', 'boolean', { config: { defaultValue: true, width: 6 } }),
    fd('separator', 'Separator', 'select', {
      config: {
        width: 6,
        defaultValue: 'slash',
        options: [
          { label: '/', value: 'slash' },
          { label: '›', value: 'chevron' },
          { label: '·', value: 'dot' },
        ],
      },
    }),
  ]),
  def('navigation', 'Navigation', 'navigation', 'navigation', 'Site header with links', [
    fd('logo', 'Logo', 'image'),
    fd('brand', 'Brand name', 'text'),
    repeat('links', 'Links', 'builtin.link', { maxItems: 12 }),
    ...cta('cta', 'Button'),
    fd('sticky', 'Stick to top', 'boolean'),
  ]),
  def('footer', 'Footer', 'navigation', 'footer', 'Site footer with link columns', [
    fd('logo', 'Logo', 'image'),
    fd('tagline', 'Tagline', 'textarea'),
    repeat('columns', 'Link columns', 'builtin.footer-column', { maxItems: 6 }),
    fd('copyright', 'Copyright line', 'text'),
  ]),
  def('html', 'Custom HTML', 'advanced', 'code', 'Raw HTML rendered by your frontend', [
    fd('html', 'HTML', 'code', { required: true, config: { language: 'html', maxLength: 100000 } }),
  ]),
  def('json', 'Custom JSON', 'advanced', 'json', 'Arbitrary data for a custom frontend component', [
    fd('component', 'Component key', 'text', { config: { helpText: 'Name your frontend uses to pick a renderer' } }),
    fd('data', 'Data', 'json', { required: true, config: { defaultValue: {} } }),
  ]),
];

export const BUILTIN_BLOCK_MAP: Record<string, BlockDefinition> = Object.fromEntries(BUILTIN_BLOCKS.map((b) => [b.type, b]));

export interface CustomBlockSource {
  apiId: string;
  displayName: string;
  description?: string | null;
  icon?: string | null;
  fields: FieldDef[];
}

/** Merges built-in blocks with the project's own components flagged as page blocks. */
export function buildBlockRegistry(custom: CustomBlockSource[] = []): Record<string, BlockDefinition> {
  const registry: Record<string, BlockDefinition> = { ...BUILTIN_BLOCK_MAP };
  for (const c of custom) {
    if (registry[c.apiId]) continue;
    registry[c.apiId] = {
      type: c.apiId,
      label: c.displayName,
      description: c.description || 'Custom component',
      category: 'custom',
      icon: c.icon || 'component',
      fields: [...c.fields].sort((a, b) => a.position - b.position),
      acceptsChildren: false,
      builtIn: false,
    };
  }
  return registry;
}

export function newId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function createBlockNode(definition: BlockDefinition): BlockNode {
  const node: BlockNode = {
    id: newId(),
    type: definition.type,
    props: buildDefaults(definition.fields),
  };
  if (definition.defaultStyle) node.style = structuredClone(definition.defaultStyle);
  if (definition.acceptsChildren) node.children = [];
  return node;
}

// ---------------------------------------------------------------------------
// Tree operations. All pure: they return a new tree and never mutate the input.
// ---------------------------------------------------------------------------

export function walkBlocks(nodes: BlockNode[], visit: (node: BlockNode, parent: BlockNode | null, depth: number) => void, parent: BlockNode | null = null, depth = 0) {
  for (const node of nodes) {
    visit(node, parent, depth);
    if (node.children?.length) walkBlocks(node.children, visit, node, depth + 1);
  }
}

export function findBlock(nodes: BlockNode[], id: string): BlockNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findBlock(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParentId(nodes: BlockNode[], id: string, parentId: string | null = null): string | null | undefined {
  for (const node of nodes) {
    if (node.id === id) return parentId;
    if (node.children) {
      const found = findParentId(node.children, id, node.id);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function countBlocks(nodes: BlockNode[]): number {
  let n = 0;
  walkBlocks(nodes, () => {
    n += 1;
  });
  return n;
}

export function updateBlock(nodes: BlockNode[], id: string, updater: (node: BlockNode) => BlockNode): BlockNode[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children) return { ...node, children: updateBlock(node.children, id, updater) };
    return node;
  });
}

export function removeBlock(nodes: BlockNode[], id: string): BlockNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children ? { ...node, children: removeBlock(node.children, id) } : node));
}

/** Inserts `block` into the children of `parentId` (or the root when null) at `index`. */
export function insertBlock(nodes: BlockNode[], block: BlockNode, parentId: string | null, index: number): BlockNode[] {
  if (parentId === null) {
    const next = [...nodes];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, block);
    return next;
  }
  return nodes.map((node) => {
    if (node.id === parentId) {
      const children = [...(node.children ?? [])];
      children.splice(Math.max(0, Math.min(index, children.length)), 0, block);
      return { ...node, children };
    }
    if (node.children) return { ...node, children: insertBlock(node.children, block, parentId, index) };
    return node;
  });
}

function isDescendant(root: BlockNode, id: string): boolean {
  return !!root.children?.some((child) => child.id === id || isDescendant(child, id));
}

/** Moves a block to a new parent/index. Refuses to move a block into itself or its own subtree. */
export function moveBlock(nodes: BlockNode[], id: string, parentId: string | null, index: number): BlockNode[] {
  const block = findBlock(nodes, id);
  if (!block) return nodes;
  if (parentId === id || (parentId && isDescendant(block, parentId))) return nodes;
  const currentParent = findParentId(nodes, id) ?? null;
  let targetIndex = index;
  if (currentParent === parentId) {
    const siblings = parentId === null ? nodes : (findBlock(nodes, parentId)?.children ?? []);
    const from = siblings.findIndex((s) => s.id === id);
    if (from !== -1 && from < index) targetIndex = index - 1;
  }
  return insertBlock(removeBlock(nodes, id), block, parentId, targetIndex);
}

function cloneWithNewIds(node: BlockNode): BlockNode {
  // Blocks are plain JSON by definition. A JSON round-trip also copies safely when the
  // node is a state-library proxy, which structuredClone refuses to clone.
  const copy: BlockNode = { id: newId(), type: node.type, props: JSON.parse(JSON.stringify(node.props ?? {})) };
  if (node.style) copy.style = JSON.parse(JSON.stringify(node.style));
  if (node.children) copy.children = node.children.map(cloneWithNewIds);
  return copy;
}

export function duplicateBlock(nodes: BlockNode[], id: string): { blocks: BlockNode[]; newId: string | null } {
  const block = findBlock(nodes, id);
  if (!block) return { blocks: nodes, newId: null };
  const copy = cloneWithNewIds(block);
  const parentId = findParentId(nodes, id) ?? null;
  const siblings = parentId === null ? nodes : (findBlock(nodes, parentId)?.children ?? []);
  const index = siblings.findIndex((s) => s.id === id);
  return { blocks: insertBlock(nodes, copy, parentId, index + 1), newId: copy.id };
}

// ---------------------------------------------------------------------------
// Page documents
// ---------------------------------------------------------------------------

export interface SeoData {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  noIndex?: boolean;
  noFollow?: boolean;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string | null;
  twitterCard?: 'summary' | 'summary_large_image';
  jsonLd?: unknown;
}

export interface PageData {
  title: string;
  slug: string;
  description?: string;
  template?: string;
  category?: string;
  seo: SeoData;
  blocks: BlockNode[];
}

export const PAGE_TEMPLATES = [
  { value: 'default', label: 'Default' },
  { value: 'landing', label: 'Landing page' },
  { value: 'article', label: 'Article' },
  { value: 'full-width', label: 'Full width' },
  { value: 'blank', label: 'Blank (no header / footer)' },
] as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|transparent)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const num = (v: unknown, min: number, max: number): number | undefined => {
  const n = Number(v);
  return typeof v === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
const color = (v: unknown): string | undefined => (typeof v === 'string' && COLOR.test(v) ? v : undefined);
const compact = <T extends object>(obj: T): T | undefined => {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

/** Keeps only recognised, well-typed style properties. */
export function sanitizeBlockStyle(input: unknown): BlockStyle | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const s = input as Record<string, any>;
  return compact<BlockStyle>({
    background: s.background
      ? compact({
          color: color(s.background.color),
          imageId: typeof s.background.imageId === 'string' && UUID.test(s.background.imageId) ? s.background.imageId : undefined,
          overlay: num(s.background.overlay, 0, 1),
        })
      : undefined,
    textColor: color(s.textColor),
    align: oneOf(s.align, ['left', 'center', 'right'] as const),
    padding: s.padding
      ? compact({
          top: num(s.padding.top, 0, 400),
          bottom: num(s.padding.bottom, 0, 400),
          left: num(s.padding.left, 0, 400),
          right: num(s.padding.right, 0, 400),
        })
      : undefined,
    margin: s.margin ? compact({ top: num(s.margin.top, 0, 400), bottom: num(s.margin.bottom, 0, 400) }) : undefined,
    maxWidth: oneOf(s.maxWidth, ['sm', 'md', 'lg', 'xl', 'full'] as const),
    border: s.border
      ? compact({ width: num(s.border.width, 0, 20), color: color(s.border.color), radius: num(s.border.radius, 0, 200) })
      : undefined,
    typography: s.typography
      ? compact({
          headingSize: oneOf(s.typography.headingSize, ['sm', 'md', 'lg', 'xl'] as const),
          bodySize: oneOf(s.typography.bodySize, ['sm', 'md', 'lg'] as const),
          fontWeight: oneOf(s.typography.fontWeight, ['regular', 'medium', 'bold'] as const),
        })
      : undefined,
    columns: s.columns
      ? compact({ desktop: num(s.columns.desktop, 1, 6), tablet: num(s.columns.tablet, 1, 4), mobile: num(s.columns.mobile, 1, 2) })
      : undefined,
    visibility: s.visibility
      ? compact({
          desktop: typeof s.visibility.desktop === 'boolean' ? s.visibility.desktop : undefined,
          tablet: typeof s.visibility.tablet === 'boolean' ? s.visibility.tablet : undefined,
          mobile: typeof s.visibility.mobile === 'boolean' ? s.visibility.mobile : undefined,
        })
      : undefined,
    animation: s.animation
      ? compact({
          type: oneOf(s.animation.type, ['none', 'fade', 'slide-up', 'slide-left', 'slide-right', 'zoom'] as const),
          delay: num(s.animation.delay, 0, 5000),
          duration: num(s.animation.duration, 0, 5000),
        })
      : undefined,
    anchor: typeof s.anchor === 'string' && /^[A-Za-z][\w-]{0,60}$/.test(s.anchor) ? s.anchor : undefined,
    cssClass: typeof s.cssClass === 'string' && /^[\w\- ]{0,120}$/.test(s.cssClass) ? s.cssClass : undefined,
  });
}

function validateBlocks(
  nodes: unknown,
  registry: Record<string, BlockDefinition>,
  opts: ValidateOptions,
  path: string,
  issues: ValidationIssue[],
  seen: Set<string>,
  depth: number,
): BlockNode[] {
  if (!Array.isArray(nodes)) {
    issues.push({ path, code: 'invalid_type', message: 'Blocks must be a list' });
    return [];
  }
  if (depth > 6) {
    issues.push({ path, code: 'too_deep', message: 'Blocks are nested too deeply' });
    return [];
  }
  const out: BlockNode[] = [];
  nodes.forEach((raw, i) => {
    const itemPath = `${path}.${i}`;
    const node = raw as Partial<BlockNode>;
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
      issues.push({ path: itemPath, code: 'invalid_block', message: `Block ${i + 1} is malformed` });
      return;
    }
    const definition = registry[node.type];
    if (!definition) {
      issues.push({ path: itemPath, code: 'unknown_block', message: `Block type "${node.type}" is not available in this environment` });
      return;
    }
    let id = typeof node.id === 'string' && node.id.length <= 64 && node.id ? node.id : newId();
    if (seen.has(id)) id = newId();
    seen.add(id);
    const result = validateEntryData(definition.fields, node.props ?? {}, opts);
    for (const issue of result.issues) {
      issues.push({ ...issue, path: `${itemPath}.props.${issue.path}`, message: `${definition.label}: ${issue.message}` });
    }
    const clean: BlockNode = { id, type: node.type, props: result.data };
    const style = sanitizeBlockStyle(node.style);
    if (style) clean.style = style;
    if (definition.acceptsChildren) {
      clean.children = validateBlocks(node.children ?? [], registry, opts, `${itemPath}.children`, issues, seen, depth + 1);
    }
    out.push(clean);
  });
  return out;
}

const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export function sanitizeSeo(input: unknown): SeoData {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const canonical = str(s.canonicalUrl, 2048);
  return (
    compact<SeoData>({
      title: str(s.title, 200),
      description: str(s.description, 500),
      canonicalUrl: canonical && /^(https?:\/\/|\/)/.test(canonical) ? canonical : undefined,
      noIndex: s.noIndex === true ? true : undefined,
      noFollow: s.noFollow === true ? true : undefined,
      ogTitle: str(s.ogTitle, 200),
      ogDescription: str(s.ogDescription, 500),
      ogImage: typeof s.ogImage === 'string' && UUID.test(s.ogImage) ? s.ogImage : undefined,
      twitterCard: oneOf(s.twitterCard, ['summary', 'summary_large_image'] as const),
      jsonLd: s.jsonLd && typeof s.jsonLd === 'object' ? s.jsonLd : undefined,
    }) ?? {}
  );
}

export interface PageValidateOptions {
  mode: 'draft' | 'publish';
  registry: Record<string, BlockDefinition>;
  components?: Record<string, FieldDef[]>;
}

export function validatePageData(input: unknown, opts: PageValidateOptions): { data: PageData; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 200) : '';
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  if (!title) issues.push({ path: 'title', code: 'required', message: 'Page title is required' });
  if (slug && !SLUG.test(slug)) {
    issues.push({ path: 'slug', code: 'invalid_slug', message: 'Slug may only contain lowercase letters, numbers and hyphens' });
  }
  const components = { ...BUILTIN_COMPONENTS, ...(opts.components ?? {}) };
  const blocks = validateBlocks(raw.blocks ?? [], opts.registry, { mode: opts.mode, components }, 'blocks', issues, new Set(), 0);
  const data: PageData = {
    title,
    slug,
    description: str(raw.description, 500),
    template: str(raw.template, 60) ?? 'default',
    category: str(raw.category, 80),
    seo: sanitizeSeo(raw.seo),
    blocks,
  };
  return { data, issues };
}

export interface SeoCheck {
  id: string;
  level: 'pass' | 'warn' | 'fail';
  message: string;
}

/** Editorial SEO checks shown next to the search preview. */
export function analyzeSeo(page: Pick<PageData, 'title' | 'slug' | 'seo' | 'blocks'>): SeoCheck[] {
  const checks: SeoCheck[] = [];
  const title = page.seo.title || page.title || '';
  const desc = page.seo.description || '';
  if (!title) checks.push({ id: 'title', level: 'fail', message: 'Add an SEO title' });
  else if (title.length < 30) checks.push({ id: 'title', level: 'warn', message: `SEO title is short (${title.length} characters) — aim for 30–60` });
  else if (title.length > 60) checks.push({ id: 'title', level: 'warn', message: `SEO title may be truncated (${title.length} characters) — aim for 30–60` });
  else checks.push({ id: 'title', level: 'pass', message: 'SEO title length is good' });

  if (!desc) checks.push({ id: 'description', level: 'fail', message: 'Add a meta description' });
  else if (desc.length < 70) checks.push({ id: 'description', level: 'warn', message: `Meta description is short (${desc.length} characters) — aim for 70–160` });
  else if (desc.length > 160) checks.push({ id: 'description', level: 'warn', message: `Meta description may be truncated (${desc.length} characters)` });
  else checks.push({ id: 'description', level: 'pass', message: 'Meta description length is good' });

  let h1 = 0;
  let imagesMissingAlt = 0;
  walkBlocks(page.blocks, (node) => {
    if (node.type === 'hero') h1 += 1;
    if (node.type === 'image' && node.props.image && !node.props.alt) imagesMissingAlt += 1;
  });
  if (h1 > 1) checks.push({ id: 'h1', level: 'warn', message: 'More than one hero block — keep a single primary heading' });
  if (imagesMissingAlt > 0) {
    checks.push({ id: 'alt', level: 'warn', message: `${imagesMissingAlt} image block${imagesMissingAlt === 1 ? ' is' : 's are'} missing alt text` });
  }
  if (!page.seo.ogImage) checks.push({ id: 'og', level: 'warn', message: 'No social sharing image set' });
  else checks.push({ id: 'og', level: 'pass', message: 'Social sharing image is set' });
  if (page.seo.noIndex) checks.push({ id: 'robots', level: 'warn', message: 'Search engines are asked not to index this page' });
  return checks;
}
