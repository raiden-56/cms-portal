import type { FieldDef } from '@meridian/shared';
import type { ContentType } from '@/lib/types';

export interface OpenApiSchema {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  format?: string;
  $ref?: string;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  description?: string;
}

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: OpenApiSchema }> }>;
  security?: unknown[];
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  parameters: OpenApiParameter[];
  hasBody: boolean;
  /** True when the endpoint is authorised by something other than an API key (the preview endpoint). */
  public: boolean;
  raw: OpenApiOperation;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function listOperations(doc: OpenApiDocument): Operation[] {
  const operations: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        tag: op.tags?.[0] ?? 'Other',
        summary: op.summary ?? '',
        parameters: op.parameters ?? [],
        hasBody: !!op.requestBody,
        public: Array.isArray(op.security) && op.security.length === 0,
        raw: op,
      });
    }
  }
  return operations;
}

/** Tag order as declared by the document, with any undeclared tags appended. */
export function groupOperations(doc: OpenApiDocument, operations: Operation[]): { tag: string; operations: Operation[] }[] {
  const order = [...(doc.tags ?? []).map((t) => t.name)];
  for (const op of operations) if (!order.includes(op.tag)) order.push(op.tag);
  return order.map((tag) => ({ tag, operations: operations.filter((op) => op.tag === tag) })).filter((g) => g.operations.length > 0);
}

export const schemaName = (schema: OpenApiSchema | undefined): string => {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '';
  if (schema.type === 'array' && schema.items) return `${schemaName(schema.items) || 'item'}[]`;
  if (schema.properties?.data) {
    const inner = schemaName(schema.properties.data);
    return inner ? `{ data: ${inner}${schema.properties.meta ? ', meta' : ''} }` : 'object';
  }
  return Array.isArray(schema.type) ? schema.type.filter((t) => t !== 'null').join(' | ') : (schema.type ?? '');
};

export const paramType = (param: OpenApiParameter): string => {
  const s = param.schema;
  if (!s) return 'string';
  if (s.enum) return s.enum.filter((v) => v !== null).join(' | ');
  return Array.isArray(s.type) ? s.type.filter((t) => t !== 'null').join(' | ') : (s.type ?? 'string');
};

function exampleValue(field: FieldDef): unknown {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'markdown':
      return `Example ${field.label.toLowerCase()}`;
    case 'integer':
    case 'rating':
      return field.config.min ?? 1;
    case 'decimal':
      return field.config.min ?? 9.5;
    case 'boolean':
    case 'checkbox':
      return false;
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'datetime':
      return new Date().toISOString();
    case 'select':
    case 'radio':
      return field.config.options?.[0]?.value ?? null;
    case 'multiselect':
      return field.config.options?.[0] ? [field.config.options[0].value] : [];
    case 'email':
      return 'name@example.com';
    case 'url':
      return 'https://example.com';
    case 'phone':
      return '+1 555 010 2030';
    case 'color':
      return '#1F6F5C';
    case 'json':
      return {};
    case 'richtext':
      return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello from the API.' }] }] };
    default:
      return undefined;
  }
}

/** A starting request body for create/update calls, built from the content type's own fields. */
export function sampleBody(type: ContentType | undefined, method: string): unknown {
  if (!type) return { data: {}, publish: false };
  const data: Record<string, unknown> = {};
  const writable = [...type.fields].sort((a, b) => a.position - b.position).filter((f) => !f.config.readOnly && f.type !== 'password');
  // PATCH changes only what is sent, so one field is enough to show the shape.
  const chosen = method === 'PATCH' ? writable.slice(0, 1) : [...writable.filter((f) => f.required), ...writable.filter((f) => !f.required).slice(0, 3)];
  for (const field of chosen) {
    const value = exampleValue(field);
    if (value !== undefined) data[field.apiId] = value;
  }
  return { data, publish: false };
}
