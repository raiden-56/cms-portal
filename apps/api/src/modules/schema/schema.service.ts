import type { Field, Prisma } from '@prisma/client';
import {
  BUILTIN_COMPONENTS,
  type BlockDefinition,
  type FieldConfig,
  type FieldDef,
  type FieldType,
  PAGE_TYPE_ID,
  buildBlockRegistry,
} from '@meridian/shared';
import { prisma, redis } from '../../lib/infra';

export interface TypeOptions {
  /** Entries can have one variant per locale. */
  localized?: boolean;
  /** Publishing requires the APPROVED status. */
  requireApproval?: boolean;
  /** Field whose value is shown as the entry title. */
  titleField?: string;
  /** Frontend preview URL template. Supports {token}, {id}, {slug}, {path}, {locale}. */
  previewUrl?: string;
}

export interface LoadedType {
  id: string;
  apiId: string;
  displayName: string;
  singularName: string;
  pluralName: string;
  description: string;
  kind: 'COLLECTION' | 'SINGLE';
  icon: string;
  isSystem: boolean;
  options: TypeOptions;
  schemaVersion: number;
  fields: FieldDef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LoadedComponent {
  id: string;
  apiId: string;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  isBlock: boolean;
  schemaVersion: number;
  fields: FieldDef[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EnvSchema {
  environmentId: string;
  stamp: string;
  types: LoadedType[];
  typeByApiId: Map<string, LoadedType>;
  typeById: Map<string, LoadedType>;
  components: LoadedComponent[];
  /** Field lists by component apiId, including the built-in block item components. */
  componentFields: Record<string, FieldDef[]>;
  blockRegistry: Record<string, BlockDefinition>;
}

export function toFieldDef(row: Field): FieldDef {
  return {
    id: row.id,
    apiId: row.apiId,
    label: row.label,
    type: row.type as FieldType,
    required: row.required,
    unique: row.unique,
    localized: row.localized,
    config: (row.config ?? {}) as FieldConfig,
    position: row.position,
  };
}

const stampKey = (environmentId: string) => `schema:${environmentId}`;

/** Monotonic marker that changes whenever the environment's schema changes. */
export async function getSchemaStamp(environmentId: string): Promise<string> {
  return (await redis.get(stampKey(environmentId))) ?? '0';
}

export async function bumpSchemaStamp(environmentId: string): Promise<void> {
  await redis.incr(stampKey(environmentId));
  cache.delete(environmentId);
}

// Per-process cache, validated against the shared stamp so every API instance sees changes.
const cache = new Map<string, EnvSchema>();
const MAX_CACHED = 200;

export async function loadSchema(environmentId: string, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<EnvSchema> {
  const useCache = client === prisma;
  const stamp = await getSchemaStamp(environmentId);
  if (useCache) {
    const hit = cache.get(environmentId);
    if (hit && hit.stamp === stamp) return hit;
  }
  const [types, components] = await Promise.all([
    client.contentType.findMany({
      where: { environmentId },
      orderBy: [{ isSystem: 'desc' }, { displayName: 'asc' }],
      include: { fields: { orderBy: { position: 'asc' } } },
    }),
    client.component.findMany({
      where: { environmentId },
      orderBy: [{ category: 'asc' }, { displayName: 'asc' }],
      include: { fields: { orderBy: { position: 'asc' } } },
    }),
  ]);

  const loadedTypes: LoadedType[] = types.map((t) => ({
    id: t.id,
    apiId: t.apiId,
    displayName: t.displayName,
    singularName: t.singularName,
    pluralName: t.pluralName,
    description: t.description,
    kind: t.kind,
    icon: t.icon,
    isSystem: t.isSystem,
    options: (t.options ?? {}) as TypeOptions,
    schemaVersion: t.schemaVersion,
    fields: t.fields.map(toFieldDef),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  }));
  const loadedComponents: LoadedComponent[] = components.map((c) => ({
    id: c.id,
    apiId: c.apiId,
    displayName: c.displayName,
    description: c.description,
    category: c.category,
    icon: c.icon,
    isBlock: c.isBlock,
    schemaVersion: c.schemaVersion,
    fields: c.fields.map(toFieldDef),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));

  const componentFields: Record<string, FieldDef[]> = { ...BUILTIN_COMPONENTS };
  for (const c of loadedComponents) componentFields[c.apiId] = c.fields;

  const schema: EnvSchema = {
    environmentId,
    stamp,
    types: loadedTypes,
    typeByApiId: new Map(loadedTypes.map((t) => [t.apiId, t])),
    typeById: new Map(loadedTypes.map((t) => [t.id, t])),
    components: loadedComponents,
    componentFields,
    blockRegistry: buildBlockRegistry(loadedComponents.filter((c) => c.isBlock)),
  };
  if (useCache) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
    cache.set(environmentId, schema);
  }
  return schema;
}

export const isPageType = (type: Pick<LoadedType, 'apiId' | 'isSystem'>) => type.isSystem && type.apiId === PAGE_TYPE_ID;

/** The documented shape of the built-in page type. Pages are validated by `validatePageData`. */
const PAGE_FIELDS: { apiId: string; label: string; type: FieldType; required?: boolean; config?: FieldConfig }[] = [
  { apiId: 'title', label: 'Title', type: 'text', required: true, config: { maxLength: 200 } },
  { apiId: 'slug', label: 'Slug', type: 'slug', config: { sourceField: 'title', helpText: 'Leave empty for the home page' } },
  { apiId: 'description', label: 'Description', type: 'textarea', config: { maxLength: 500 } },
  { apiId: 'template', label: 'Template', type: 'text' },
  { apiId: 'category', label: 'Category', type: 'text' },
  { apiId: 'seo', label: 'SEO', type: 'json' },
  { apiId: 'blocks', label: 'Blocks', type: 'json' },
];

/** Every environment owns a system `pages` content type that backs the page builder. */
export async function ensurePageType(tx: Prisma.TransactionClient, environmentId: string): Promise<void> {
  const existing = await tx.contentType.findUnique({
    where: { environmentId_apiId: { environmentId, apiId: PAGE_TYPE_ID } },
    select: { id: true },
  });
  if (existing) return;
  await tx.contentType.create({
    data: {
      environmentId,
      apiId: PAGE_TYPE_ID,
      displayName: 'Pages',
      singularName: 'Page',
      pluralName: 'Pages',
      description: 'Website pages composed in the page builder',
      kind: 'COLLECTION',
      icon: 'page',
      isSystem: true,
      options: { localized: true, titleField: 'title' },
      fields: {
        create: PAGE_FIELDS.map((f, position) => ({
          apiId: f.apiId,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          config: (f.config ?? {}) as Prisma.InputJsonValue,
          position,
        })),
      },
    },
  });
}
