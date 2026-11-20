import type { Request, Response } from 'express';
import {
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  GraphQLBoolean,
  GraphQLError,
  type GraphQLFieldConfigMap,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  type SelectionSetNode,
  execute,
  parse as parseGraphql,
  specifiedRules,
  validate,
  valueFromASTUntyped,
} from 'graphql';
import { z } from 'zod';
import { type FieldDef, PAGE_TYPE_ID, isUuid, toPascalCase } from '@meridian/shared';
import { HttpError, forbidden } from '../../lib/errors';
import { parse } from '../../lib/http';
import { logger, prisma } from '../../lib/infra';
import { type EntryQuery, type FilterOp, type QueryFilter } from '../entries/entries.query';
import { createEntry, deleteEntry, publishEntry, unpublishEntry, updateEntry } from '../entries/entries.service';
import type { TokenContext } from '../../types/express';
import { type EnvSchema, type LoadedType, isPageType, loadSchema } from '../schema/schema.service';
import { deliveryContext, engineOfToken, findResource, listResources, singleResource } from './delivery.service';
import { type DeliveryContext, loadDocuments, serializeEntries } from './serializer';
import { tokenOf } from './token.middleware';

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (value) => value,
  parseValue: (value) => value,
  parseLiteral: (ast, variables) => valueFromASTUntyped(ast, variables),
});

const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO 8601 timestamp',
  serialize: (value) => (value instanceof Date ? value.toISOString() : value),
  parseValue: (value) => value,
  parseLiteral: (ast) => (ast.kind === Kind.STRING ? ast.value : null),
});

const MediaType = new GraphQLObjectType({
  name: 'Media',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID) },
    url: { type: new GraphQLNonNull(GraphQLString) },
    filename: { type: GraphQLString },
    mimeType: { type: GraphQLString },
    kind: { type: GraphQLString },
    size: { type: GraphQLInt },
    width: { type: GraphQLInt },
    height: { type: GraphQLInt },
    alt: { type: GraphQLString },
    caption: { type: GraphQLString },
  },
});

/** Per-request state shared by all resolvers. */
interface Ctx {
  req: Request;
  token: TokenContext;
  delivery: DeliveryContext;
  /** Relation targets requested in the same tick are loaded in one query per type. */
  loaders: Map<string, BatchLoader>;
}

class BatchLoader {
  private queue: { id: string; resolve: (v: Record<string, unknown> | null) => void; reject: (e: unknown) => void }[] = [];
  private scheduled = false;
  constructor(private readonly batch: (ids: string[]) => Promise<Map<string, Record<string, unknown>>>) {}

  load(id: string): Promise<Record<string, unknown> | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id, resolve, reject });
      if (this.scheduled) return;
      this.scheduled = true;
      setImmediate(async () => {
        const pending = this.queue;
        this.queue = [];
        this.scheduled = false;
        try {
          const found = await this.batch([...new Set(pending.map((p) => p.id))]);
          for (const p of pending) p.resolve(found.get(p.id) ?? null);
        } catch (err) {
          for (const p of pending) p.reject(err);
        }
      });
    });
  }
}

function loaderFor(ctx: Ctx, type: LoadedType): BatchLoader {
  let loader = ctx.loaders.get(type.apiId);
  if (!loader) {
    loader = new BatchLoader(async (ids) => {
      const rows = await loadDocuments(ctx.delivery, type, ids);
      const items = await serializeEntries(ctx.delivery, type, rows);
      return new Map(items.map((item) => [item.id as string, item]));
    });
    ctx.loaders.set(type.apiId, loader);
  }
  return loader;
}

const NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
const camel = (value: string) => {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

function toFilters(input: unknown): QueryFilter[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const filters: QueryFilter[] = [];
  for (const [field, spec] of Object.entries(input as Record<string, unknown>)) {
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      for (const [op, value] of Object.entries(spec as Record<string, unknown>)) filters.push({ field, op: op as FilterOp, value });
    } else filters.push({ field, op: Array.isArray(spec) ? 'in' : 'eq', value: spec });
  }
  return filters;
}

function toQuery(args: { limit?: number; offset?: number; sort?: string; filter?: unknown; search?: string }): EntryQuery {
  const limit = Math.min(100, Math.max(1, args.limit ?? 25));
  const sort = (args.sort ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((s) => (s.startsWith('-') ? { field: s.slice(1), dir: 'desc' as const } : { field: s, dir: 'asc' as const }));
  return { filters: toFilters(args.filter), sort, search: args.search?.trim() || undefined, limit, offset: Math.max(0, args.offset ?? 0) };
}

/** Each request may pin a locale per field; resolvers share one delivery context otherwise. */
async function withLocale(ctx: Ctx, locale: string | undefined): Promise<DeliveryContext> {
  if (!locale) return ctx.delivery;
  const scoped = await deliveryContext(ctx.token, { status: ctx.delivery.mode === 'draft' ? 'draft' : undefined, locale });
  scoped.media = ctx.delivery.media;
  return scoped;
}

function scalarFor(field: FieldDef): GraphQLOutputType {
  switch (field.type) {
    case 'integer':
      return GraphQLInt;
    case 'decimal':
    case 'rating':
      return GraphQLFloat;
    case 'boolean':
    case 'checkbox':
      return GraphQLBoolean;
    case 'multiselect':
      return new GraphQLList(new GraphQLNonNull(GraphQLString));
    case 'image':
    case 'video':
    case 'file':
      return MediaType;
    case 'images':
    case 'files':
      return new GraphQLList(new GraphQLNonNull(MediaType));
    case 'json':
    case 'richtext':
    case 'component':
    case 'repeatable':
    case 'dynamiczone':
    case 'geolocation':
      return JSONScalar;
    default:
      return GraphQLString;
  }
}

/**
 * Builds the GraphQL schema for one environment from its content model.
 * Rebuilt only when the model changes (keyed by the schema stamp).
 */
function buildSchema(schema: EnvSchema, writable: boolean): GraphQLSchema {
  const objectTypes = new Map<string, GraphQLObjectType>();
  const usedNames = new Set<string>(['Query', 'Mutation', 'Media', 'JSON', 'DateTime', 'Page']);

  const typeName = (type: LoadedType) => {
    if (isPageType(type)) return 'Page';
    let name = toPascalCase(type.singularName) || toPascalCase(type.apiId);
    if (!NAME.test(name)) name = `Type${toPascalCase(type.apiId)}`;
    for (let i = 2; usedNames.has(name); i += 1) name = `${toPascalCase(type.singularName)}${i}`;
    usedNames.add(name);
    return name;
  };
  const names = new Map(schema.types.map((t) => [t.apiId, typeName(t)]));

  const system: GraphQLFieldConfigMap<Record<string, unknown>, Ctx> = {
    id: { type: new GraphQLNonNull(GraphQLID) },
    locale: { type: new GraphQLNonNull(GraphQLString) },
    status: { type: GraphQLString, description: 'Editorial status. Only present when reading drafts.' },
    createdAt: { type: DateTimeScalar },
    updatedAt: { type: DateTimeScalar },
    publishedAt: { type: DateTimeScalar },
  };

  for (const type of schema.types) {
    const name = names.get(type.apiId) as string;
    if (isPageType(type)) {
      objectTypes.set(
        type.apiId,
        new GraphQLObjectType({
          name,
          description: 'A page composed of blocks. `blocks` is a tree your frontend renders with its own components.',
          fields: {
            ...system,
            title: { type: GraphQLString },
            slug: { type: GraphQLString },
            path: { type: GraphQLString },
            parent: { type: JSONScalar },
            description: { type: GraphQLString },
            template: { type: GraphQLString },
            category: { type: GraphQLString },
            seo: { type: JSONScalar },
            blocks: { type: JSONScalar },
          },
        }),
      );
      continue;
    }
    objectTypes.set(
      type.apiId,
      new GraphQLObjectType({
        name,
        description: type.description || undefined,
        // A thunk, because relation fields can point at types defined later (or at this one).
        fields: () => {
          const fields: GraphQLFieldConfigMap<Record<string, unknown>, Ctx> = { ...system };
          for (const f of type.fields) {
            if (f.config.private || f.type === 'password' || !NAME.test(f.apiId)) continue;
            if (f.type === 'relation' || f.type === 'relations') {
              const target = schema.typeByApiId.get(f.config.targetType ?? '');
              const targetObject = target ? objectTypes.get(target.apiId) : undefined;
              if (!target || !targetObject) continue;
              fields[f.apiId] = {
                type: f.type === 'relation' ? targetObject : new GraphQLList(new GraphQLNonNull(targetObject)),
                description: f.config.helpText,
                resolve: async (parent, _args, ctx) => {
                  const value = parent[f.apiId] as { id?: string } | { id?: string }[] | null;
                  const loader = loaderFor(ctx, target);
                  if (Array.isArray(value)) {
                    const items = await Promise.all(value.map((v) => (v?.id ? loader.load(v.id) : null)));
                    return items.filter(Boolean);
                  }
                  return value?.id ? loader.load(value.id) : null;
                },
              };
              continue;
            }
            fields[f.apiId] = { type: scalarFor(f), description: f.config.helpText };
          }
          return fields;
        },
      }),
    );
  }

  const queryFields: GraphQLFieldConfigMap<unknown, Ctx> = {};
  const mutationFields: GraphQLFieldConfigMap<unknown, Ctx> = {};
  const usedFields = new Set<string>();
  const unique = (candidate: string, fallback: string) => {
    let name = NAME.test(candidate) && !usedFields.has(candidate) ? candidate : fallback;
    for (let i = 2; usedFields.has(name); i += 1) name = `${fallback}${i}`;
    usedFields.add(name);
    return name;
  };

  const listArgs = {
    limit: { type: GraphQLInt, description: 'Page size (1–100, default 25)' },
    offset: { type: GraphQLInt },
    sort: { type: GraphQLString, description: 'Comma-separated fields; prefix with "-" for descending' },
    filter: { type: JSONScalar, description: 'e.g. { "category": "news", "price": { "gte": 10 } }' },
    search: { type: GraphQLString },
    locale: { type: GraphQLString },
  };

  for (const type of schema.types) {
    const object = objectTypes.get(type.apiId) as GraphQLObjectType;
    const pascal = names.get(type.apiId) as string;
    const page = isPageType(type);

    if (type.kind === 'SINGLE') {
      queryFields[unique(camel(type.apiId), `${camel(pascal)}Single`)] = {
        type: object,
        args: { locale: { type: GraphQLString } },
        resolve: async (_root, args: { locale?: string }, ctx) => singleResource(await withLocale(ctx, args.locale), type, {}),
      };
    } else {
      const connection = new GraphQLObjectType({
        name: `${pascal}Connection`,
        fields: {
          items: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(object))) },
          total: { type: new GraphQLNonNull(GraphQLInt) },
          limit: { type: new GraphQLNonNull(GraphQLInt) },
          offset: { type: new GraphQLNonNull(GraphQLInt) },
        },
      });
      const listName = unique(camel(type.apiId), `${camel(pascal)}List`);
      queryFields[listName] = {
        type: new GraphQLNonNull(connection),
        args: listArgs,
        resolve: async (_root, args: { limit?: number; offset?: number; sort?: string; filter?: unknown; search?: string; locale?: string }, ctx) => {
          const query = toQuery(args);
          const result = await listResources(await withLocale(ctx, args.locale), type, query, {});
          return { items: result.data, total: result.meta.total, limit: query.limit, offset: query.offset };
        },
      };
      queryFields[unique(camel(pascal), `${camel(pascal)}Item`)] = {
        type: object,
        args: {
          id: { type: GraphQLID },
          slug: { type: GraphQLString },
          ...(page ? { path: { type: GraphQLString, description: 'URL path, e.g. "/about/team"' } } : {}),
          locale: { type: GraphQLString },
        },
        resolve: async (_root, args: { id?: string; slug?: string; path?: string; locale?: string }, ctx) => {
          if (!args.id && !args.slug && args.path === undefined) throw new GraphQLError('Provide an id, slug or path');
          const key = args.path !== undefined ? { path: args.path === '/' ? '' : args.path } : args.id ? { id: args.id } : { slug: args.slug };
          return findResource(await withLocale(ctx, args.locale), type, key, {});
        },
      };
    }

    if (!writable) continue;
    const draftOf = async (ctx: Ctx, entryId: string) => {
      const row = await prisma.entry.findUniqueOrThrow({ where: { id: entryId } });
      const delivery = await deliveryContext(ctx.token, { status: 'draft' });
      delivery.localeChain = [row.locale];
      return (await serializeEntries(delivery, type, [row]))[0];
    };
    const target = async (ctx: Ctx, id: string, locale?: string) => {
      const row = isUuid(id)
        ? await prisma.entry.findFirst({
            where: { documentId: id, locale: locale ?? ctx.token.defaultLocale, environmentId: ctx.token.environment.id, contentTypeId: type.id, deletedAt: null },
          })
        : null;
      if (!row) throw new GraphQLError(`${type.singularName} not found`, { extensions: { code: 'not_found' } });
      return row;
    };
    const engineFor = (ctx: Ctx) => engineOfToken(ctx.req, ctx.token, schema);

    mutationFields[unique(`create${pascal}`, `create${pascal}Entry`)] = {
      type: object,
      args: { data: { type: new GraphQLNonNull(JSONScalar) }, locale: { type: GraphQLString }, publish: { type: GraphQLBoolean } },
      resolve: async (_root, args: { data: Record<string, unknown>; locale?: string; publish?: boolean }, ctx) => {
        let entry = await createEntry(engineFor(ctx), type, { data: args.data, locale: args.locale });
        if (args.publish) entry = await publishEntry(engineFor(ctx), type, entry.id);
        return draftOf(ctx, entry.id);
      },
    };
    mutationFields[unique(`update${pascal}`, `update${pascal}Entry`)] = {
      type: object,
      description: 'Merges `data` into the current draft.',
      args: { id: { type: new GraphQLNonNull(GraphQLID) }, data: { type: new GraphQLNonNull(JSONScalar) }, locale: { type: GraphQLString }, publish: { type: GraphQLBoolean } },
      resolve: async (_root, args: { id: string; data: Record<string, unknown>; locale?: string; publish?: boolean }, ctx) => {
        const row = await target(ctx, args.id, args.locale);
        let entry = await updateEntry(engineFor(ctx), type, row.id, { data: { ...(row.data as Record<string, unknown>), ...args.data } });
        if (args.publish) entry = await publishEntry(engineFor(ctx), type, entry.id);
        return draftOf(ctx, entry.id);
      },
    };
    mutationFields[unique(`publish${pascal}`, `publish${pascal}Entry`)] = {
      type: object,
      args: { id: { type: new GraphQLNonNull(GraphQLID) }, locale: { type: GraphQLString } },
      resolve: async (_root, args: { id: string; locale?: string }, ctx) => {
        const row = await target(ctx, args.id, args.locale);
        await publishEntry(engineFor(ctx), type, row.id);
        return draftOf(ctx, row.id);
      },
    };
    mutationFields[unique(`unpublish${pascal}`, `unpublish${pascal}Entry`)] = {
      type: object,
      args: { id: { type: new GraphQLNonNull(GraphQLID) }, locale: { type: GraphQLString } },
      resolve: async (_root, args: { id: string; locale?: string }, ctx) => {
        const row = await target(ctx, args.id, args.locale);
        await unpublishEntry(engineFor(ctx), type, row.id);
        return draftOf(ctx, row.id);
      },
    };
    mutationFields[unique(`delete${pascal}`, `delete${pascal}Entry`)] = {
      type: new GraphQLNonNull(GraphQLBoolean),
      args: { id: { type: new GraphQLNonNull(GraphQLID) }, locale: { type: GraphQLString } },
      resolve: async (_root, args: { id: string; locale?: string }, ctx) => {
        const row = await target(ctx, args.id, args.locale);
        await deleteEntry(engineFor(ctx), type, row.id);
        return true;
      },
    };
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
    mutation: writable && Object.keys(mutationFields).length ? new GraphQLObjectType({ name: 'Mutation', fields: mutationFields }) : undefined,
    types: [MediaType, ...objectTypes.values()],
  });
}

const built = new Map<string, GraphQLSchema>();

export async function schemaFor(environmentId: string, writable: boolean): Promise<{ graphql: GraphQLSchema; schema: EnvSchema }> {
  const schema = await loadSchema(environmentId);
  const key = `${environmentId}:${schema.stamp}:${writable ? 'rw' : 'ro'}`;
  let graphql = built.get(key);
  if (!graphql) {
    for (const stale of [...built.keys()].filter((k) => k.startsWith(`${environmentId}:`) && k.endsWith(writable ? 'rw' : 'ro'))) built.delete(stale);
    if (built.size > 300) built.clear();
    graphql = buildSchema(schema, writable);
    built.set(key, graphql);
  }
  return { graphql, schema };
}

const MAX_DEPTH = 10;

function depthOf(selection: SelectionSetNode | undefined, fragments: Map<string, FragmentDefinitionNode>, seen: Set<string>): number {
  if (!selection) return 0;
  let deepest = 0;
  for (const node of selection.selections) {
    if (node.kind === Kind.FIELD) deepest = Math.max(deepest, 1 + depthOf((node as FieldNode).selectionSet, fragments, seen));
    else if (node.kind === Kind.INLINE_FRAGMENT) deepest = Math.max(deepest, depthOf(node.selectionSet, fragments, seen));
    else if (node.kind === Kind.FRAGMENT_SPREAD && !seen.has(node.name.value)) {
      const fragment = fragments.get(node.name.value);
      if (fragment) deepest = Math.max(deepest, depthOf(fragment.selectionSet, fragments, new Set([...seen, node.name.value])));
    }
  }
  return deepest;
}

function tooDeep(document: DocumentNode): boolean {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of document.definitions) if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
  return document.definitions.some((def) => def.kind === Kind.OPERATION_DEFINITION && depthOf(def.selectionSet, fragments, new Set()) > MAX_DEPTH);
}

const bodySchema = z.object({
  query: z.string().min(1, 'query is required').max(20_000, 'Query is too large'),
  variables: z.record(z.string(), z.unknown()).nullish(),
  operationName: z.string().max(200).nullish(),
});

export async function graphqlHandler(req: Request, res: Response) {
  const token = tokenOf(req);
  const body = parse(bodySchema, req.body);
  const writable = token.token.type === 'READ_WRITE';
  const { graphql } = await schemaFor(token.environment.id, writable);

  let document: DocumentNode;
  try {
    document = parseGraphql(body.query);
  } catch (err) {
    res.status(400).json({ errors: [{ message: (err as Error).message }] });
    return;
  }
  const validationErrors = validate(graphql, document, specifiedRules);
  if (validationErrors.length) {
    res.status(400).json({ errors: validationErrors.map((e) => ({ message: e.message, locations: e.locations })) });
    return;
  }
  if (tooDeep(document)) {
    res.status(400).json({ errors: [{ message: `Query is nested more than ${MAX_DEPTH} levels deep` }] });
    return;
  }
  const isMutation = document.definitions.some((d) => d.kind === Kind.OPERATION_DEFINITION && d.operation === 'mutation');
  if (isMutation && !writable) throw forbidden('Mutations need a read/write API token');

  const status = req.query.status ?? req.headers['x-meridian-status'];
  const ctx: Ctx = {
    req,
    token,
    delivery: await deliveryContext(token, { status, locale: req.query.locale }),
    loaders: new Map(),
  };
  const result = await execute({
    schema: graphql,
    document,
    contextValue: ctx,
    variableValues: body.variables ?? undefined,
    operationName: body.operationName ?? undefined,
  });

  res.setHeader('Cache-Control', 'private, no-store');
  res.json({
    data: result.data,
    ...(result.errors?.length
      ? {
          errors: result.errors.map((e) => {
            const original = e.originalError;
            if (original instanceof HttpError) {
              return { message: original.message, path: e.path, extensions: { code: original.code, details: original.details } };
            }
            if (original && !(original instanceof GraphQLError)) {
              // Unexpected failures are logged with detail but never leak internals to API consumers.
              logger.error({ err: original.message, stack: original.stack }, 'graphql resolver error');
              return { message: 'Internal error', path: e.path, extensions: { code: 'internal_error' } };
            }
            return { message: e.message, path: e.path, locations: e.locations, extensions: e.extensions };
          }),
        }
      : {}),
  });
}

export { PAGE_TYPE_ID };
