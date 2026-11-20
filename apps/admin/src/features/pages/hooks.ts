import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PAGE_TYPE_ID } from '@meridian/shared';
import { useProject } from '@/app/workspace';
import { api } from '@/lib/api';
import type { EntryDetail, PageTreeItem } from '@/lib/types';

export const PAGES_TYPE = PAGE_TYPE_ID;

export interface PageTreeNode extends PageTreeItem {
  depth: number;
  children: PageTreeNode[];
}

/** Turns the flat page list into a tree ordered by sibling position. Orphans (parent missing) surface at the root. */
export function buildPageTree(items: PageTreeItem[]): PageTreeNode[] {
  const byId = new Map<string, PageTreeNode>(items.map((item) => [item.id, { ...item, depth: 0, children: [] }]));
  const roots: PageTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (nodes: PageTreeNode[], depth: number) => {
    nodes.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    for (const node of nodes) {
      node.depth = depth;
      order(node.children, depth + 1);
    }
  };
  order(roots, 0);
  return roots;
}

export function collectDescendantIds(node: PageTreeNode, into: Set<string> = new Set()): Set<string> {
  for (const child of node.children) {
    into.add(child.id);
    collectDescendantIds(child, into);
  }
  return into;
}

export function usePageTree(locale: string) {
  const ws = useProject();
  return useQuery({
    queryKey: ['pages', ws.environment.id, 'tree', locale],
    queryFn: () => api.get<{ items: PageTreeItem[] }>(`${ws.envBase}/pages/tree`, { locale }).then((r) => r.items),
  });
}

export function usePageEntry(entryId: string | undefined) {
  const ws = useProject();
  return useQuery({
    queryKey: ['entry', ws.environment.id, entryId],
    queryFn: () => api.get<EntryDetail>(`${ws.envBase}/entry/${entryId}`),
    enabled: !!entryId,
    // The editor owns the working copy; a background refetch must not race the user's edits.
    staleTime: Infinity,
    gcTime: 0,
  });
}

/** Everything that shows page state elsewhere in the app, refreshed after a page changes. */
export function useInvalidatePages() {
  const ws = useProject();
  const queryClient = useQueryClient();
  const envId = ws.environment.id;
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['pages', envId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard', envId] });
    void queryClient.invalidateQueries({ queryKey: ['reviews', envId] });
    void queryClient.invalidateQueries({ queryKey: ['entries', envId, PAGES_TYPE] });
  }, [queryClient, envId]);
}

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Full URL path a page will get from its parent's path and its own slug. */
export function joinPagePath(parentPath: string | null | undefined, slug: string): string {
  const base = !parentPath || parentPath === '/' ? '' : parentPath;
  return slug ? `${base}/${slug}` : base || '/';
}
