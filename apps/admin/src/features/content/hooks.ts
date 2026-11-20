import { useCallback, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FieldDef, canonicalJson, isSecretValue } from '@meridian/shared';
import { useProject, useSchema, type Workspace } from '@/app/workspace';
import { api } from '@/lib/api';
import type { ContentType, Member, RelationOption } from '@/lib/types';
import { toast } from '@/store';

/** In-app link to wherever an entry is edited: the page builder for pages, the entry editor otherwise. */
export function entryHref(ws: Pick<Workspace, 'href'>, item: { id: string; contentType: string | null; isPage?: boolean }): string {
  return ws.href(item.isPage ? `pages/${item.id}` : `content/${item.contentType}/${item.id}`);
}

/** Resolves the content type named in the URL (API identifier or id) from the cached schema. */
export function useContentType(typeId: string | undefined) {
  const schema = useSchema();
  const type = useMemo<ContentType | undefined>(() => schema.data?.types.find((t) => t.apiId === typeId || t.id === typeId), [schema.data, typeId]);
  return { schema, type };
}

/**
 * A per-user preference stored on the server (table columns, saved views…).
 * Updates are optimistic; a failed write rolls back by refetching.
 */
export function usePreference<T>(key: string, fallback: T) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['preference', key], [key]);
  const query = useQuery({
    queryKey,
    queryFn: () => api.get<{ value: T | null }>(`/auth/me/preferences/${key}`).then((r) => r.value),
    staleTime: Infinity,
  });
  const mutation = useMutation({
    mutationFn: (value: T) => api.put(`/auth/me/preferences/${key}`, { value }),
    onMutate: async (value) => {
      // A load still in flight would land after this write and put the old value back on screen.
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, value);
    },
    onError: () => {
      toast.error('Your preference could not be saved');
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  return { value: (query.data ?? fallback) as T, loaded: !query.isLoading, set: mutation.mutate };
}

/** Invalidates every list and summary that reflects entry state in the current environment. */
export function useInvalidateContent() {
  const { environment } = useProject();
  const queryClient = useQueryClient();
  return useCallback(
    (entryId?: string) => {
      const envId = environment.id;
      for (const scope of ['entries', 'dashboard', 'reviews', 'scheduled', 'versions', 'releases', 'release', 'schema', 'search']) {
        void queryClient.invalidateQueries({ queryKey: [scope, envId] });
      }
      if (entryId) {
        void queryClient.invalidateQueries({ queryKey: ['entry-versions', envId, entryId] });
        void queryClient.invalidateQueries({ queryKey: ['entry-activity', envId, entryId] });
        void queryClient.invalidateQueries({ queryKey: ['entry-comments', envId, entryId] });
      }
    },
    [environment.id, queryClient],
  );
}

export function useMembers(enabled = true) {
  const { org, orgBase } = useProject();
  return useQuery({
    queryKey: ['members', org.id],
    queryFn: () => api.get<{ items: Member[] }>(`${orgBase}/members`).then((r) => r.items),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Titles of related entries shown in list cells, fetched with one request per target type
 * (never one per row).
 */
export function useRelationTitles(fields: FieldDef[], rows: { data?: Record<string, unknown> }[]): Map<string, string> {
  const { environment, envBase } = useProject();
  const groups = useMemo(() => {
    const byType = new Map<string, Set<string>>();
    for (const field of fields) {
      if ((field.type !== 'relation' && field.type !== 'relations') || !field.config.targetType) continue;
      const ids = byType.get(field.config.targetType) ?? new Set<string>();
      for (const row of rows) {
        const value = row.data?.[field.apiId];
        if (typeof value === 'string' && value) ids.add(value);
        else if (Array.isArray(value)) value.slice(0, 3).forEach((id) => typeof id === 'string' && ids.add(id));
      }
      byType.set(field.config.targetType, ids);
    }
    return [...byType.entries()].filter(([, ids]) => ids.size > 0).map(([target, ids]) => ({ target, ids: [...ids].sort() }));
  }, [fields, rows]);

  return useQueries({
    queries: groups.map((group) => ({
      queryKey: ['relation-selected', environment.id, group.target, group.ids.join(',')],
      queryFn: () => api.get<{ items: RelationOption[] }>(`${envBase}/relation-options/${group.target}`, { ids: group.ids.join(',') }).then((r) => r.items),
      staleTime: 60_000,
    })),
    combine: (results) => {
      const titles = new Map<string, string>();
      for (const result of results) for (const option of result.data ?? []) titles.set(option.id, option.title);
      return titles;
    },
  });
}

/**
 * Data as it should be sent to the API. Masked secrets (`{ $secret: 'set' }`) are sent as
 * null, which the server reads as "keep the stored secret"; editor-only keys are dropped.
 */
export function toPayload(fields: FieldDef[], data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = data[field.apiId];
    if (field.type === 'password') out[field.apiId] = isSecretValue(value) ? null : (value ?? null);
    else if (field.type === 'repeatable' && Array.isArray(value)) {
      out[field.apiId] = value.map((item) => {
        if (!item || typeof item !== 'object') return item;
        const { _fresh: _dropped, ...rest } = item as Record<string, unknown>;
        return rest;
      });
    } else out[field.apiId] = value === undefined ? null : value;
  }
  return out;
}

/** Key-order independent, so content that only differs in serialisation is not reported as edited. */
export const snapshotOf = (fields: FieldDef[], data: Record<string, unknown>) => canonicalJson(toPayload(fields, data));
