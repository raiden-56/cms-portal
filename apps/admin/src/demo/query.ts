/** Entry lists: the API's filter / sort / search grammar, evaluated over the in-memory rows. */
import { ENTRY_STATUSES, type EntryStatus, FIELD_TYPE_META, TEXT_SEARCH_FIELD_TYPES, sameJson } from '@meridian/shared';
import { type DbEntry, type DbType, db } from './db';
import { badRequest } from './http';

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startsWith' | 'in' | 'nin' | 'null';
const OPS: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'in', 'nin', 'null'];

export interface EntryQuery {
  filters: { field: string; op: FilterOp; value: unknown }[];
  sort: { field: string; dir: 'asc' | 'desc' }[];
  search?: string;
  limit: number;
  offset: number;
  locale?: string;
  statuses?: EntryStatus[];
}

const first = (v: unknown): string | undefined => (Array.isArray(v) ? first(v[0]) : typeof v === 'string' ? v : undefined);

/**
 *   ?page=2&pageSize=20            or  ?limit=20&offset=20
 *   ?sort=-publishedAt,title       (leading "-" = descending)
 *   ?filter[category]=news  ·  ?filter[price][gte]=10&filter[tags][in]=a,b
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

  const filters: EntryQuery['filters'] = [];
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
type Scalar = string | number | boolean | null;
interface Expr {
  kind: Kind;
  read: (e: DbEntry) => unknown;
}

const list = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : String(value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

export interface RunQueryArgs {
  environmentId: string;
  type: DbType;
  query: EntryQuery;
  /** `draft` reads the working copy; `live` reads the published snapshot only. */
  mode: 'draft' | 'live';
  trash?: boolean;
}

export const hasChanges = (e: DbEntry): boolean => !!e.publishedAt && !sameJson(e.data, e.publishedData);

export function runEntryQuery(args: RunQueryArgs): { rows: DbEntry[]; total: number } {
  const { type, query, mode } = args;
  const live = mode === 'live';
  const dataOf = (e: DbEntry) => (live ? e.publishedData : e.data) ?? {};
  const time = (iso: string | null) => (iso ? Date.parse(iso) : null);

  const system: Record<string, Expr> = {
    id: { kind: 'uuid', read: (e) => e.documentId },
    documentId: { kind: 'uuid', read: (e) => e.documentId },
    createdAt: { kind: 'timestamp', read: (e) => time(e.createdAt) },
    updatedAt: { kind: 'timestamp', read: (e) => time(e.updatedAt) },
    publishedAt: { kind: 'timestamp', read: (e) => time(e.publishedAt) },
    status: { kind: 'text', read: (e) => e.status },
    locale: { kind: 'text', read: (e) => e.locale },
    title: { kind: 'text', read: (e) => (live ? e.publishedTitle : e.title) },
    slug: { kind: 'text', read: (e) => (live ? e.publishedSlug : e.slug) },
    path: { kind: 'text', read: (e) => (live ? e.publishedPath : e.path) },
    position: { kind: 'number', read: (e) => e.position },
    parentId: { kind: 'uuid', read: (e) => e.parentId },
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
    const raw = (e: DbEntry) => dataOf(e)[field.apiId];
    switch (FIELD_TYPE_META[field.type].scalar) {
      case 'number':
        return { kind: 'number', read: (e) => (typeof raw(e) === 'number' ? raw(e) : null) };
      case 'boolean':
        return { kind: 'boolean', read: (e) => (typeof raw(e) === 'boolean' ? raw(e) : null) };
      case 'stringArray':
        if (purpose === 'sort') throw badRequest(`Field "${name}" holds multiple values and cannot be sorted`);
        return { kind: 'array', read: (e) => (Array.isArray(raw(e)) ? raw(e) : null) };
      case 'string':
      case 'date':
        return { kind: 'text', read: (e) => (raw(e) === null || raw(e) === undefined ? null : String(raw(e))) };
      default:
        throw badRequest(`Field "${name}" cannot be used for ${purpose}`);
    }
  };

  const bind = (expr: Expr, value: unknown, name: string): Scalar => {
    switch (expr.kind) {
      case 'number': {
        const n = Number(value);
        if (value === '' || value === null || !Number.isFinite(n)) throw badRequest(`Filter on "${name}" needs a number`);
        return n;
      }
      case 'boolean': {
        const s = String(value).toLowerCase();
        if (s !== 'true' && s !== 'false') throw badRequest(`Filter on "${name}" needs true or false`);
        return s === 'true';
      }
      case 'timestamp': {
        const t = new Date(String(value)).getTime();
        if (Number.isNaN(t)) throw badRequest(`Filter on "${name}" needs a date`);
        return t;
      }
      case 'uuid': {
        const s = String(value);
        if (!/^[0-9a-f-]{36}$/i.test(s)) throw badRequest(`Filter on "${name}" needs an id`);
        return s.toLowerCase();
      }
      default:
        return String(value);
    }
  };

  const tests: ((e: DbEntry) => boolean)[] = [
    (e) => e.environmentId === args.environmentId && e.contentTypeId === type.id,
    (e) => (args.trash ? !!e.deletedAt : !e.deletedAt),
  ];
  if (live) tests.push((e) => !!e.publishedAt);
  if (query.locale) tests.push((e) => e.locale === query.locale);
  if (query.statuses?.length && !live) tests.push((e) => (query.statuses as EntryStatus[]).includes(e.status));

  for (const filter of query.filters) {
    const expr = resolve(filter.field, 'filter');
    const { op, value } = filter;
    const read = (e: DbEntry) => {
      const v = expr.read(e);
      return expr.kind === 'uuid' && typeof v === 'string' ? v.toLowerCase() : (v as Scalar);
    };
    if (op === 'null') {
      const wantNull = String(value).toLowerCase() !== 'false';
      tests.push((e) => (expr.read(e) === null || expr.read(e) === undefined) === wantNull);
      continue;
    }
    if (expr.kind === 'array') {
      const values = list(value);
      if (values.length === 0) continue;
      const any = (e: DbEntry) => ((expr.read(e) as unknown[] | null) ?? []).some((v) => values.includes(String(v)));
      if (op === 'eq' || op === 'contains' || op === 'in') tests.push(any);
      else if (op === 'ne' || op === 'nin') tests.push((e) => !any(e));
      else throw badRequest(`Operator "${op}" is not supported on multi-value field "${filter.field}"`);
      continue;
    }
    switch (op) {
      case 'eq': {
        const want = bind(expr, value, filter.field);
        tests.push((e) => read(e) === want);
        break;
      }
      case 'ne': {
        const want = bind(expr, value, filter.field);
        tests.push((e) => read(e) !== want);
        break;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const want = bind(expr, value, filter.field) as string | number;
        tests.push((e) => {
          const got = read(e) as string | number | null;
          if (got === null || got === undefined) return false;
          return op === 'gt' ? got > want : op === 'gte' ? got >= want : op === 'lt' ? got < want : got <= want;
        });
        break;
      }
      case 'contains':
      case 'startsWith': {
        if (expr.kind !== 'text') throw badRequest(`Operator "${op}" only works on text fields ("${filter.field}")`);
        const needle = String(value).toLowerCase();
        tests.push((e) => {
          const got = String(read(e) ?? '').toLowerCase();
          return read(e) !== null && (op === 'contains' ? got.includes(needle) : got.startsWith(needle));
        });
        break;
      }
      case 'in':
      case 'nin': {
        const values = list(value);
        if (values.length === 0) break;
        if (values.length > 200) throw badRequest('Too many values in list filter (maximum 200)');
        const wanted = values.map((v) => bind(expr, v, filter.field));
        tests.push((e) => (op === 'in' ? wanted.includes(read(e)) : read(e) === null || !wanted.includes(read(e))));
        break;
      }
    }
  }

  if (query.search) {
    const needle = query.search.toLowerCase();
    const searchable = type.fields.filter((f) => TEXT_SEARCH_FIELD_TYPES.includes(f.type) && f.config.searchable !== false && !f.config.private).slice(0, 12);
    const hit = (v: unknown) => typeof v === 'string' && v.toLowerCase().includes(needle);
    tests.push((e) => hit(system.title.read(e)) || hit(system.slug.read(e)) || searchable.some((f) => hit(dataOf(e)[f.apiId])));
  }

  const order = query.sort.map((s) => ({ expr: resolve(s.field, 'sort'), dir: s.dir }));
  if (order.length === 0) order.push({ expr: live ? system.publishedAt : system.updatedAt, dir: 'desc' });

  const compare = (a: DbEntry, b: DbEntry): number => {
    for (const { expr, dir } of order) {
      const x = expr.read(a) as Scalar;
      const y = expr.read(b) as Scalar;
      if (x === y) continue;
      // Empty values sort last in either direction.
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const result = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y, undefined, { sensitivity: 'base' }) : x < y ? -1 : 1;
      if (result !== 0) return dir === 'desc' ? -result : result;
    }
    // Deterministic tiebreaker so pagination never repeats or skips rows.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const matched = db.entries.filter((e) => tests.every((test) => test(e))).sort(compare);
  return { rows: matched.slice(query.offset, query.offset + query.limit), total: matched.length };
}
