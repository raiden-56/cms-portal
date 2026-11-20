import { Prisma, type Entry } from '@prisma/client';
import { ENTRY_STATUSES, FIELD_TYPE_META, type EntryStatus, type FieldDef, TEXT_SEARCH_FIELD_TYPES } from '@meridian/shared';
import { badRequest } from '../../lib/errors';
import { prisma } from '../../lib/infra';
import type { LoadedType } from '../schema/schema.service';

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'in' | 'nin' | 'null';
const OPS: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'in', 'nin', 'null'];

export interface QueryFilter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface EntryQuery {
  filters: QueryFilter[];
  sort: { field: string; dir: 'asc' | 'desc' }[];
  search?: string;
  limit: number;
  offset: number;
  locale?: string;
  statuses?: EntryStatus[];
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? first(v[0]) : typeof v === 'string' ? v : undefined);

/**
 * Parses list parameters shared by the management and delivery APIs.
 *
 *   ?page=2&pageSize=20            or  ?limit=20&offset=20
 *   ?sort=-publishedAt,title       (leading "-" = descending)
 *   ?filter[category]=news         (equals)
 *   ?filter[price][gte]=10&filter[tags][in]=a,b
 *   ?search=term
 */
export function parseEntryQuery(q: Record<string, unknown>, opts: { maxLimit?: number; defaultLimit?: number } = {}): EntryQuery {
  const maxLimit = opts.maxLimit ?? 100;
  const num = (value: unknown, name: string, min: number, max: number): number | undefined => {
    const raw = first(value);
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw badRequest(`"${name}" must be an integer of at least ${min}`);
    return Math.min(n, max);
  };
  const pageSize = num(q.pageSize ?? q.limit, 'limit', 1, maxLimit) ?? opts.defaultLimit ?? 25;
  const page = num(q.page, 'page', 1, 1_000_000);
  const offset = page ? (page - 1) * pageSize : (num(q.offset, 'offset', 0, 10_000_000) ?? 0);

  const sort: EntryQuery['sort'] = [];
  for (const part of (first(q.sort) ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4)) {
    if (part.startsWith('-')) sort.push({ field: part.slice(1), dir: 'desc' });
    else if (part.includes(':')) {
      const [field, dir] = part.split(':');
      sort.push({ field, dir: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' });
    } else sort.push({ field: part, dir: 'asc' });
  }

  const filters: QueryFilter[] = [];
  const rawFilters = q.filter ?? q.filters;
  if (rawFilters && typeof rawFilters === 'object' && !Array.isArray(rawFilters)) {
    for (const [field, spec] of Object.entries(rawFilters as Record<string, unknown>)) {
      if (filters.length >= 20) throw badRequest('Too many filters (maximum 20)');
      if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
        for (const [op, value] of Object.entries(spec as Record<string, unknown>)) {
          if (!OPS.includes(op as FilterOp)) throw badRequest(`Unknown filter operator "${op}". Use one of: ${OPS.join(', ')}`);
          filters.push({ field, op: op as FilterOp, value });
        }
      } else {
        filters.push({ field, op: Array.isArray(spec) ? 'in' : 'eq', value: spec });
      }
    }
  }

  let statuses: EntryStatus[] | undefined;
  const statusRaw = first(q.status);
  if (statusRaw && statusRaw !== 'all') {
    statuses = statusRaw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is EntryStatus => (ENTRY_STATUSES as readonly string[]).includes(s));
  }

  const search = first(q.search)?.trim().slice(0, 200) || undefined;
  return { filters, sort, search, limit: pageSize, offset, locale: first(q.locale), statuses };
}

type Kind = 'text' | 'number' | 'boolean' | 'timestamp' | 'array' | 'uuid';
interface Expr {
  sql: Prisma.Sql;
  kind: Kind;
}

const like = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RunQueryArgs {
  environmentId: string;
  type: LoadedType;
  query: EntryQuery;
  /** `draft` reads the working copy (management API, previews); `live` reads the published snapshot only. */
  mode: 'draft' | 'live';
  trash?: boolean;
  /** Restrict to these document ids. */
  documentIds?: string[];
}

export type EntryRow = Entry & { hasChanges?: boolean };

/**
 * Lists entries with filtering, sorting and search over JSONB field values.
 *
 * Every identifier that reaches SQL comes from a fixed map or from the content type's own
 * schema, and every value is a bound parameter — user input never becomes SQL text.
 */
export async function runEntryQuery(args: RunQueryArgs): Promise<{ rows: EntryRow[]; total: number }> {
  const { type, query, mode } = args;
  const dataCol = Prisma.raw(mode === 'live' ? 'e."publishedData"' : 'e."data"');
  const live = mode === 'live';

  const system: Record<string, Expr> = {
    id: { sql: Prisma.raw('e."documentId"'), kind: 'uuid' },
    documentId: { sql: Prisma.raw('e."documentId"'), kind: 'uuid' },
    createdAt: { sql: Prisma.raw('e."createdAt"'), kind: 'timestamp' },
    updatedAt: { sql: Prisma.raw('e."updatedAt"'), kind: 'timestamp' },
    publishedAt: { sql: Prisma.raw('e."publishedAt"'), kind: 'timestamp' },
    status: { sql: Prisma.raw('e."status"::text'), kind: 'text' },
    locale: { sql: Prisma.raw('e."locale"'), kind: 'text' },
    title: { sql: Prisma.raw(live ? 'e."publishedTitle"' : 'e."title"'), kind: 'text' },
    slug: { sql: Prisma.raw(live ? 'e."publishedSlug"' : 'e."slug"'), kind: 'text' },
    path: { sql: Prisma.raw(live ? 'e."publishedPath"' : 'e."path"'), kind: 'text' },
    position: { sql: Prisma.raw('e."position"'), kind: 'number' },
    parentId: { sql: Prisma.raw('e."parentId"'), kind: 'uuid' },
  };
  const fieldMap = new Map(type.fields.map((f) => [f.apiId, f]));

  const resolve = (name: string, purpose: 'filter' | 'sort'): Expr => {
    const field = fieldMap.get(name);
    // System columns win for the built-in page type, whose title/slug live in real columns.
    if (system[name] && (!field || type.isSystem)) return system[name];
    if (!field) throw badRequest(`Unknown field "${name}" for ${purpose}`);
    if (purpose === 'filter' && field.config.filterable === false) throw badRequest(`Field "${name}" is not filterable`);
    if (purpose === 'sort' && field.config.sortable === false) throw badRequest(`Field "${name}" is not sortable`);
    if (field.config.private || field.type === 'password') throw badRequest(`Field "${name}" cannot be used for ${purpose}`);
    const key = Prisma.sql`${field.apiId}::text`;
    switch (FIELD_TYPE_META[field.type].scalar) {
      case 'number':
        return { sql: Prisma.sql`(CASE WHEN jsonb_typeof(${dataCol}->${key}) = 'number' THEN (${dataCol}->>${key})::numeric END)`, kind: 'number' };
      case 'boolean':
        return { sql: Prisma.sql`(CASE WHEN jsonb_typeof(${dataCol}->${key}) = 'boolean' THEN (${dataCol}->>${key})::boolean END)`, kind: 'boolean' };
      case 'stringArray':
        if (purpose === 'sort') throw badRequest(`Field "${name}" holds multiple values and cannot be sorted`);
        return { sql: Prisma.sql`(${dataCol}->${key})`, kind: 'array' };
      case 'string':
      case 'date':
        // Dates are stored as ISO strings, which sort and compare correctly as text.
        return { sql: Prisma.sql`(${dataCol}->>${key})`, kind: 'text' };
      default:
        throw badRequest(`Field "${name}" cannot be used for ${purpose}`);
    }
  };

  const bind = (expr: Expr, value: unknown, name: string): Prisma.Sql => {
    switch (expr.kind) {
      case 'number': {
        const n = Number(value);
        if (value === '' || value === null || !Number.isFinite(n)) throw badRequest(`Filter on "${name}" needs a number`);
        return Prisma.sql`${n}::numeric`;
      }
      case 'boolean': {
        const s = String(value).toLowerCase();
        if (s !== 'true' && s !== 'false') throw badRequest(`Filter on "${name}" needs true or false`);
        return Prisma.sql`${s === 'true'}::boolean`;
      }
      case 'timestamp': {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) throw badRequest(`Filter on "${name}" needs a date`);
        // Columns are UTC timestamps without zone; normalise the bound value the same way.
        return Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
      }
      case 'uuid': {
        const s = String(value);
        if (!/^[0-9a-f-]{36}$/i.test(s)) throw badRequest(`Filter on "${name}" needs an id`);
        return Prisma.sql`${s}::uuid`;
      }
      default:
        return Prisma.sql`${String(value)}`;
    }
  };

  const where: Prisma.Sql[] = [
    Prisma.sql`e."environmentId" = ${args.environmentId}::uuid`,
    Prisma.sql`e."contentTypeId" = ${type.id}::uuid`,
    args.trash ? Prisma.sql`e."deletedAt" IS NOT NULL` : Prisma.sql`e."deletedAt" IS NULL`,
  ];
  if (live) where.push(Prisma.sql`e."publishedAt" IS NOT NULL`);
  if (query.locale) where.push(Prisma.sql`e."locale" = ${query.locale}`);
  if (query.statuses?.length && !live) {
    where.push(Prisma.sql`e."status"::text IN (${Prisma.join(query.statuses)})`);
  }
  if (args.documentIds) {
    if (args.documentIds.length === 0) return { rows: [], total: 0 };
    where.push(Prisma.sql`e."documentId" IN (${Prisma.join(args.documentIds.map((id) => Prisma.sql`${id}::uuid`))})`);
  }

  for (const filter of query.filters) {
    const expr = resolve(filter.field, 'filter');
    const { op, value } = filter;
    if (op === 'null') {
      const wantNull = String(value).toLowerCase() !== 'false';
      where.push(wantNull ? Prisma.sql`${expr.sql} IS NULL` : Prisma.sql`${expr.sql} IS NOT NULL`);
      continue;
    }
    if (expr.kind === 'array') {
      const values = list(value);
      if (values.length === 0) continue;
      const any = Prisma.sql`${expr.sql} ?| ARRAY[${Prisma.join(values)}]::text[]`;
      if (op === 'eq' || op === 'contains' || op === 'in') where.push(any);
      else if (op === 'ne' || op === 'nin') where.push(Prisma.sql`NOT COALESCE(${any}, false)`);
      else throw badRequest(`Operator "${op}" is not supported on multi-value field "${filter.field}"`);
      continue;
    }
    switch (op) {
      case 'eq':
        where.push(Prisma.sql`${expr.sql} = ${bind(expr, value, filter.field)}`);
        break;
      case 'ne':
        where.push(Prisma.sql`${expr.sql} IS DISTINCT FROM ${bind(expr, value, filter.field)}`);
        break;
      case 'gt':
        where.push(Prisma.sql`${expr.sql} > ${bind(expr, value, filter.field)}`);
        break;
      case 'gte':
        where.push(Prisma.sql`${expr.sql} >= ${bind(expr, value, filter.field)}`);
        break;
      case 'lt':
        where.push(Prisma.sql`${expr.sql} < ${bind(expr, value, filter.field)}`);
        break;
      case 'lte':
        where.push(Prisma.sql`${expr.sql} <= ${bind(expr, value, filter.field)}`);
        break;
      case 'contains':
      case 'startsWith': {
        if (expr.kind !== 'text') throw badRequest(`Operator "${op}" only works on text fields ("${filter.field}")`);
        const pattern = op === 'contains' ? `%${like(String(value))}%` : `${like(String(value))}%`;
        where.push(Prisma.sql`${expr.sql} ILIKE ${pattern}`);
        break;
      }
      case 'in':
      case 'nin': {
        const values = list(value);
        if (values.length === 0) break;
        if (values.length > 200) throw badRequest('Too many values in list filter (maximum 200)');
        const inList = Prisma.sql`${expr.sql} IN (${Prisma.join(values.map((v) => bind(expr, v, filter.field)))})`;
        where.push(op === 'in' ? inList : Prisma.sql`(${expr.sql} IS NULL OR NOT ${inList})`);
        break;
      }
    }
  }

  if (query.search) {
    const pattern = `%${like(query.search)}%`;
    const searchable: FieldDef[] = type.fields
      .filter((f) => TEXT_SEARCH_FIELD_TYPES.includes(f.type) && f.config.searchable !== false && !f.config.private)
      .slice(0, 12);
    const clauses: Prisma.Sql[] = [Prisma.sql`${system.title.sql} ILIKE ${pattern}`, Prisma.sql`${system.slug.sql} ILIKE ${pattern}`];
    for (const f of searchable) clauses.push(Prisma.sql`(${dataCol}->>${f.apiId}::text) ILIKE ${pattern}`);
    where.push(Prisma.sql`(${Prisma.join(clauses, ' OR ')})`);
  }

  const order: Prisma.Sql[] = query.sort.map((s) => {
    const expr = resolve(s.field, 'sort');
    return Prisma.sql`${expr.sql} ${Prisma.raw(s.dir === 'desc' ? 'DESC NULLS LAST' : 'ASC NULLS LAST')}`;
  });
  if (order.length === 0) order.push(Prisma.raw(live ? 'e."publishedAt" DESC' : 'e."updatedAt" DESC'));
  // Deterministic tiebreaker so pagination never repeats or skips rows.
  order.push(Prisma.raw('e."id" ASC'));

  const whereSql = Prisma.join(where, ' AND ');
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<EntryRow[]>(Prisma.sql`
      SELECT e.*, (e."publishedAt" IS NOT NULL AND e."data" IS DISTINCT FROM e."publishedData") AS "hasChanges"
      FROM "Entry" e WHERE ${whereSql}
      ORDER BY ${Prisma.join(order, ', ')}
      LIMIT ${query.limit} OFFSET ${query.offset}`),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "Entry" e WHERE ${whereSql}`),
  ]);
  return { rows, total: count[0]?.n ?? 0 };
}
