import { type ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import type { Permission } from '@meridian/shared';
import { api } from '@/lib/api';
import type { Environment, Membership, Project, SchemaResponse } from '@/lib/types';
import { persist, useAppSelector } from '@/store';

export interface Workspace {
  org: Membership['organization'];
  role: Membership['role'];
  can: (permission: Permission) => boolean;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: unknown;
  /** Selected project and environment, or null when the organization has no projects yet. */
  project: Project | null;
  environment: Environment | null;
  defaultLocale: string;
  /** API path prefixes. */
  orgBase: string;
  projectBase: string;
  envBase: string;
  /** Builds an in-app link inside the current project and environment. */
  href: (path?: string) => string;
  orgHref: (path?: string) => string;
  /** Link to the same kind of page in another project or environment. */
  hrefFor: (project: Pick<Project, 'slug'>, envKey: string, path?: string) => string;
}

const WorkspaceContext = createContext<Workspace | null>(null);

const lastKey = (orgId: string) => `meridian.last.${orgId}`;
const readLast = (orgId: string): { project?: string; env?: string } => {
  try {
    return JSON.parse(localStorage.getItem(lastKey(orgId)) ?? '{}');
  } catch {
    return {};
  }
};

const trim = (path?: string) => (path ? `/${path.replace(/^\/+/, '')}` : '');

/**
 * Resolves the organization, project and environment named in the URL
 * (/w/:orgSlug/p/:projectSlug/:envKey/…) and exposes them, with the caller's permissions,
 * to everything below. Pages outside a project URL fall back to the last project used.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { orgSlug, projectSlug, envKey } = useParams();
  const memberships = useAppSelector((s) => s.auth.memberships);
  const membership = memberships.find((m) => m.organization.slug === orgSlug);

  const projectsQuery = useQuery({
    queryKey: ['projects', membership?.organization.id],
    queryFn: () => api.get<{ items: Project[] }>(`/orgs/${membership?.organization.id}/projects`).then((r) => r.items),
    enabled: !!membership && membership.permissions.includes('project.read'),
  });

  const value = useMemo<Workspace | null>(() => {
    if (!membership) return null;
    const org = membership.organization;
    const permissions = new Set(membership.permissions);
    const projects = projectsQuery.data ?? [];
    const last = readLast(org.id);
    const project = projects.find((p) => p.slug === (projectSlug ?? last.project)) ?? (projectSlug ? null : (projects[0] ?? null));
    const environment =
      project?.environments.find((e) => e.key === (envKey ?? last.env)) ??
      (envKey ? null : (project?.environments.find((e) => e.key === 'production') ?? project?.environments[0] ?? null));
    const orgHref = (path?: string) => `/w/${org.slug}${trim(path)}`;
    const hrefFor: Workspace['hrefFor'] = (p, key, path) => `/w/${org.slug}/p/${p.slug}/${key}${trim(path)}`;
    return {
      org,
      role: membership.role,
      can: (permission) => permissions.has(permission),
      projects,
      projectsLoading: projectsQuery.isLoading,
      projectsError: projectsQuery.error,
      project,
      environment,
      defaultLocale: project?.locales.find((l) => l.isDefault)?.code ?? 'en',
      orgBase: `/orgs/${org.id}`,
      projectBase: project ? `/projects/${project.id}` : '',
      envBase: environment ? `/envs/${environment.id}` : '',
      href: (path) => (project && environment ? hrefFor(project, environment.key, path) : orgHref('projects')),
      orgHref,
      hrefFor,
    };
  }, [membership, projectsQuery.data, projectsQuery.isLoading, projectsQuery.error, projectSlug, envKey]);

  // Remember the selection so org-level pages keep their project context.
  useEffect(() => {
    if (value?.project && value.environment) persist(lastKey(value.org.id), { project: value.project.slug, env: value.environment.key });
  }, [value?.org.id, value?.project, value?.environment]);

  if (!membership) {
    // Unknown or inaccessible organization: go to one the user does belong to.
    return memberships[0] ? <Navigate to={`/w/${memberships[0].organization.slug}`} replace /> : <Navigate to="/no-organization" replace />;
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside the workspace layout');
  return ctx;
}

/** For pages that only exist inside a project: guarantees a project and environment. */
export function useProject(): Workspace & { project: Project; environment: Environment } {
  const ctx = useWorkspace();
  if (!ctx.project || !ctx.environment) throw new Error('This page needs a project');
  return ctx as Workspace & { project: Project; environment: Environment };
}

/** The current environment's content model. Cached and shared by every screen that needs it. */
export function useSchema() {
  const { environment, envBase } = useWorkspace();
  return useQuery({
    queryKey: ['schema', environment?.id],
    queryFn: () => api.get<SchemaResponse>(`${envBase}/schema`),
    enabled: !!environment,
    staleTime: 30_000,
  });
}

export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const { can } = useWorkspace();
  return <>{can(permission) ? children : fallback}</>;
}
