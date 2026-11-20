import { type FieldDef, toPascalCase } from '@meridian/shared';
import { env } from '../../config/env';
import { type EnvSchema, type LoadedType, isPageType } from '../schema/schema.service';

type Json = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function fieldSchema(schema: EnvSchema, f: FieldDef, names: Map<string, string>): Json {
  const described = (s: Json): Json => ({ ...s, ...(f.config.helpText ? { description: f.config.helpText } : {}) });
  const nullable = (s: Json): Json => ({ oneOf: [s, { type: 'null' }] });
  switch (f.type) {
    case 'integer':
      return described({ type: ['integer', 'null'], ...(f.config.min !== undefined ? { minimum: f.config.min } : {}), ...(f.config.max !== undefined ? { maximum: f.config.max } : {}) });
    case 'decimal':
    case 'rating':
      return described({ type: ['number', 'null'] });
    case 'boolean':
    case 'checkbox':
      return described({ type: 'boolean' });
    case 'date':
      return described({ type: ['string', 'null'], format: 'date' });
    case 'datetime':
      return described({ type: ['string', 'null'], format: 'date-time' });
    case 'email':
      return described({ type: ['string', 'null'], format: 'email' });
    case 'url':
      return described({ type: ['string', 'null'], format: 'uri-reference' });
    case 'select':
    case 'radio':
      return described({ type: ['string', 'null'], ...(f.config.options?.length ? { enum: [...f.config.options.map((o) => o.value), null] } : {}) });
    case 'multiselect':
      return described({ type: 'array', items: { type: 'string', ...(f.config.options?.length ? { enum: f.config.options.map((o) => o.value) } : {}) } });
    case 'image':
    case 'video':
    case 'file':
      return described(nullable(ref('Media')));
    case 'images':
    case 'files':
      return described({ type: 'array', items: ref('Media') });
    case 'relation': {
      const target = names.get(f.config.targetType ?? '');
      return described(nullable(target ? { oneOf: [ref(target), ref('Reference')] } : ref('Reference')));
    }
    case 'relations': {
      const target = names.get(f.config.targetType ?? '');
      return described({ type: 'array', items: target ? { oneOf: [ref(target), ref('Reference')] } : ref('Reference') });
    }
    case 'richtext':
      return described({ description: 'Structured rich-text document, or an HTML string when requested with ?richtext=html', oneOf: [{ type: 'object' }, { type: 'string' }] });
    case 'component': {
      const fields = schema.componentFields[f.config.component ?? ''];
      return described(nullable(fields ? objectSchema(schema, fields, names) : { type: 'object' }));
    }
    case 'repeatable': {
      const fields = schema.componentFields[f.config.component ?? ''];
      return described({ type: 'array', items: fields ? objectSchema(schema, fields, names) : { type: 'object' } });
    }
    case 'dynamiczone':
      return described({
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, props: { type: 'object' } }, required: ['type', 'props'] },
      });
    case 'geolocation':
      return described(nullable({ type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' }, address: { type: 'string' } }, required: ['lat', 'lng'] }));
    case 'json':
      return described({});
    default:
      return described({ type: ['string', 'null'], ...(f.config.maxLength ? { maxLength: f.config.maxLength } : {}) });
  }
}

function objectSchema(schema: EnvSchema, fields: FieldDef[], names: Map<string, string>, depth = 0): Json {
  const visible = fields.filter((f) => !f.config.private && f.type !== 'password');
  return {
    type: 'object',
    properties: Object.fromEntries(visible.map((f) => [f.apiId, depth > 3 ? {} : fieldSchema(schema, f, names)])),
  };
}

const SYSTEM_PROPS: Json = {
  id: { type: 'string', format: 'uuid', description: 'Stable document identifier, shared by all locale variants' },
  type: { type: 'string' },
  locale: { type: 'string' },
  createdAt: { type: 'string', format: 'date-time' },
  updatedAt: { type: 'string', format: 'date-time' },
  publishedAt: { type: ['string', 'null'], format: 'date-time' },
};

const listParameters = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
  { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 }, description: 'Alternative to offset' },
  { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Comma-separated fields; prefix with "-" for descending. Example: -publishedAt,title' },
  { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Case-insensitive search across text fields' },
  {
    name: 'filter',
    in: 'query',
    style: 'deepObject',
    explode: true,
    schema: { type: 'object', additionalProperties: true },
    description: 'filter[field]=value or filter[field][op]=value. Operators: eq, ne, gt, gte, lt, lte, contains, startsWith, in, nin, null',
  },
];

const commonParameters = [
  { name: 'locale', in: 'query', schema: { type: 'string' }, description: 'Locale code. Falls back to the configured fallback and then the default locale.' },
  { name: 'populate', in: 'query', schema: { type: 'string' }, description: 'Relations to expand, e.g. author,category.parent — or * for all first-level relations' },
  { name: 'fields', in: 'query', schema: { type: 'string' }, description: 'Comma-separated field ids to return' },
  { name: 'richtext', in: 'query', schema: { type: 'string', enum: ['json', 'html'], default: 'json' } },
  { name: 'status', in: 'query', schema: { type: 'string', enum: ['published', 'draft'], default: 'published' }, description: 'draft requires a preview or read/write token' },
];

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });

/** Generates the OpenAPI 3.1 description of an environment's delivery API from its content model. */
export function buildOpenApi(schema: EnvSchema, info: { project: string; environment: string; writable: boolean }): Json {
  const names = new Map<string, string>();
  const used = new Set(['Media', 'Reference', 'Error', 'ListMeta', 'Block']);
  for (const type of schema.types) {
    let name = isPageType(type) ? 'Page' : toPascalCase(type.singularName) || toPascalCase(type.apiId);
    for (let i = 2; used.has(name); i += 1) name = `${toPascalCase(type.singularName)}${i}`;
    used.add(name);
    names.set(type.apiId, name);
  }

  const schemas: Json = {
    Media: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        url: { type: 'string', format: 'uri', description: 'Append ?w=&h=&fit=&format=&q= to transform images' },
        filename: { type: 'string' },
        mimeType: { type: 'string' },
        kind: { type: 'string', enum: ['image', 'video', 'audio', 'document', 'archive', 'other'] },
        size: { type: 'integer' },
        width: { type: ['integer', 'null'] },
        height: { type: ['integer', 'null'] },
        alt: { type: 'string' },
        caption: { type: 'string' },
      },
    },
    Reference: { type: 'object', description: 'An unexpanded relation', properties: { id: { type: 'string', format: 'uuid' }, type: { type: 'string' } } },
    Block: {
      type: 'object',
      description: 'A page builder block. Map `type` to a component in your frontend.',
      properties: {
        id: { type: 'string' },
        type: { type: 'string', enum: Object.keys(schema.blockRegistry) },
        props: { type: 'object' },
        style: { type: 'object' },
        children: { type: 'array', items: ref('Block') },
      },
      required: ['id', 'type', 'props'],
    },
    ListMeta: {
      type: 'object',
      properties: { total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' }, page: { type: 'integer' }, pageCount: { type: 'integer' } },
    },
    Error: {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } },
          required: ['code', 'message'],
        },
      },
    },
  };

  const paths: Json = {};
  const tag = (type: LoadedType) => type.displayName;

  for (const type of schema.types) {
    const name = names.get(type.apiId) as string;
    schemas[name] = isPageType(type)
      ? {
          type: 'object',
          properties: {
            ...SYSTEM_PROPS,
            title: { type: 'string' },
            slug: { type: 'string' },
            path: { type: 'string', description: 'Full URL path including parent pages' },
            parent: { type: ['object', 'null'] },
            description: { type: ['string', 'null'] },
            template: { type: 'string' },
            category: { type: ['string', 'null'] },
            seo: { type: 'object' },
            blocks: { type: 'array', items: ref('Block') },
          },
        }
      : { type: 'object', description: type.description || undefined, properties: { ...SYSTEM_PROPS, ...(objectSchema(schema, type.fields, names).properties as Json) } };

    const one = { 'application/json': { schema: { type: 'object', properties: { data: ref(name) } } } };
    const many = { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: ref(name) }, meta: ref('ListMeta') } } } };
    const writeBody = {
      required: true,
      content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: { type: 'object' }, locale: { type: 'string' }, publish: { type: 'boolean', default: false } } } } },
    };
    const collection: Json = {};
    const item: Json = {};

    if (type.kind === 'SINGLE') {
      collection.get = {
        tags: [tag(type)],
        summary: `Get ${type.displayName}`,
        operationId: `get_${type.apiId}`,
        parameters: commonParameters,
        responses: { 200: { description: 'OK', content: one }, 404: errorResponse('Not published yet') },
      };
    } else {
      collection.get = {
        tags: [tag(type)],
        summary: `List ${type.pluralName}`,
        operationId: `list_${type.apiId}`,
        parameters: [
          ...listParameters,
          ...commonParameters,
          ...(isPageType(type) ? [{ name: 'path', in: 'query', schema: { type: 'string' }, description: 'Return the single page at this URL path, e.g. /about/team' }] : []),
        ],
        responses: { 200: { description: 'OK', content: many }, 400: errorResponse('Invalid query'), 401: errorResponse('Missing or invalid API token'), 429: errorResponse('Rate limit exceeded') },
      };
      item.get = {
        tags: [tag(type)],
        summary: `Get one ${type.singularName} by id or slug`,
        operationId: `get_${type.apiId}`,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Document id or slug' }, ...commonParameters],
        responses: { 200: { description: 'OK', content: one }, 404: errorResponse('Not found or not published') },
      };
    }
    if (info.writable && !isPageType(type)) {
      const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
      collection.post = {
        tags: [tag(type)],
        summary: `Create a ${type.singularName}`,
        operationId: `create_${type.apiId}`,
        requestBody: writeBody,
        responses: { 201: { description: 'Created', content: one }, 403: errorResponse('Read/write token required'), 422: errorResponse('Validation failed') },
      };
      item.put = { tags: [tag(type)], summary: `Replace a ${type.singularName}`, operationId: `replace_${type.apiId}`, parameters: [idParam], requestBody: writeBody, responses: { 200: { description: 'OK', content: one }, 422: errorResponse('Validation failed') } };
      item.patch = { tags: [tag(type)], summary: `Update fields of a ${type.singularName}`, operationId: `update_${type.apiId}`, parameters: [idParam], requestBody: writeBody, responses: { 200: { description: 'OK', content: one }, 422: errorResponse('Validation failed') } };
      item.delete = { tags: [tag(type)], summary: `Delete a ${type.singularName}`, operationId: `delete_${type.apiId}`, parameters: [idParam], responses: { 204: { description: 'Deleted' } } };
      paths[`/${type.apiId}/{id}/publish`] = {
        post: { tags: [tag(type)], summary: `Publish a ${type.singularName}`, operationId: `publish_${type.apiId}`, parameters: [idParam], responses: { 200: { description: 'OK', content: one }, 422: errorResponse('Not ready to publish') } },
      };
      paths[`/${type.apiId}/{id}/unpublish`] = {
        post: { tags: [tag(type)], summary: `Unpublish a ${type.singularName}`, operationId: `unpublish_${type.apiId}`, parameters: [idParam], responses: { 200: { description: 'OK', content: one } } },
      };
    }
    paths[`/${type.apiId}`] = collection;
    if (Object.keys(item).length) paths[`/${type.apiId}/{id}`] = item;
  }

  paths['/media/{id}'] = {
    get: {
      tags: ['Media'],
      summary: 'Get media asset metadata',
      operationId: 'get_media',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { data: ref('Media') } } } } }, 404: errorResponse('Not found') },
    },
  };
  paths['/graphql'] = {
    post: {
      tags: ['GraphQL'],
      summary: 'Execute a GraphQL operation',
      operationId: 'graphql',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, variables: { type: 'object' }, operationName: { type: 'string' } } } } },
      },
      responses: { 200: { description: 'GraphQL response' } },
    },
  };
  paths['/preview'] = {
    get: {
      tags: ['Preview'],
      summary: 'Read one draft using a signed preview token',
      operationId: 'preview',
      security: [],
      parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'Draft content' }, 401: errorResponse('Preview token invalid or expired') },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: `${info.project} — Content Delivery API`,
      version: 'v1',
      description: `Generated from the content model of the **${info.environment}** environment. Responses contain published content only, unless a preview or read/write token requests drafts.`,
    },
    servers: [{ url: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/v1` }],
    security: [{ bearer: [] }],
    tags: [...schema.types.map((t) => ({ name: t.displayName, description: t.description || undefined })), { name: 'Media' }, { name: 'GraphQL' }, { name: 'Preview' }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API token created under Developers → API Keys' } },
      schemas,
    },
  };
}
