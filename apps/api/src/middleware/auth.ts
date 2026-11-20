import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import type { Permission } from '@meridian/shared';
import { env } from '../config/env';
import { forbidden, notFound, unauthorized } from '../lib/errors';
import { prisma } from '../lib/infra';
import { param } from '../lib/http';
import type { TenantContext } from '../types/express';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'meridian';

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience('admin')
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export interface PreviewClaims {
  environmentId: string;
  entryId: string;
}

/** Short-lived token that unlocks the draft of exactly one entry through the delivery API. */
export async function signPreviewToken(claims: PreviewClaims, ttlSeconds = 3600): Promise<string> {
  return new SignJWT({ env: claims.environmentId, entry: claims.entryId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('preview')
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret);
}

export async function verifyPreviewToken(token: string): Promise<PreviewClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: 'preview' });
    if (typeof payload.env !== 'string' || typeof payload.entry !== 'string') return null;
    return { environmentId: payload.env, entryId: payload.entry };
  } catch {
    return null;
  }
}

/** Authenticates a management API request from its bearer access token. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let userId: string;
  let sessionId: string;
  try {
    const { payload } = await jwtVerify(header.slice(7), secret, { issuer: ISSUER, audience: 'admin' });
    userId = String(payload.sub);
    sessionId = String(payload.sid);
  } catch {
    throw unauthorized('Access token is invalid or expired');
  }
  // The session row is the source of truth, so revoking a session cuts access immediately.
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, user: { select: { id: true, email: true, name: true, isActive: true, isSuperAdmin: true } } },
  });
  if (!session || !session.user.isActive) throw unauthorized('Session is no longer valid');
  req.user = { ...session.user, sessionId: session.id };
  next();
}

async function membershipContext(req: Request, organizationId: string): Promise<TenantContext> {
  const user = req.user;
  if (!user) throw unauthorized();
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { id: true, slug: true },
  });
  // Not-found (rather than forbidden) so callers cannot probe which organizations exist.
  if (!org) throw notFound('Organization');
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId: user.id } },
    select: { status: true, role: { select: { key: true, permissions: true } } },
  });
  if (!membership || membership.status !== 'ACTIVE') throw notFound('Organization');
  return {
    organizationId: org.id,
    organizationSlug: org.slug,
    roleKey: membership.role.key,
    permissions: new Set(membership.role.permissions),
  };
}

function assertPermissions(tenant: TenantContext, required: Permission[]) {
  for (const permission of required) {
    if (!tenant.permissions.has(permission)) {
      throw forbidden(`Missing permission: ${permission}`);
    }
  }
}

/**
 * Tenant guards. Each one resolves the resource named in the URL, proves the caller is an
 * active member of the organization that owns it, checks the required permissions, and
 * attaches the resolved scope to `req.tenant`. Handlers then query strictly inside that scope.
 */
export const orgScope =
  (...required: Permission[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const tenant = await membershipContext(req, param(req, 'orgId'));
    assertPermissions(tenant, required);
    req.tenant = tenant;
    next();
  };

export const projectScope =
  (...required: Permission[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const project = await prisma.project.findFirst({
      where: { id: param(req, 'projectId'), deletedAt: null },
      select: { id: true, slug: true, name: true, organizationId: true, settings: true },
    });
    if (!project) throw notFound('Project');
    const tenant = await membershipContext(req, project.organizationId).catch(() => {
      throw notFound('Project');
    });
    assertPermissions(tenant, required);
    tenant.project = { id: project.id, slug: project.slug, name: project.name, settings: (project.settings ?? {}) as Record<string, unknown> };
    req.tenant = tenant;
    next();
  };

export const envScope =
  (...required: Permission[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    const environment = await prisma.environment.findFirst({
      where: { id: param(req, 'envId'), project: { deletedAt: null } },
      select: {
        id: true,
        key: true,
        name: true,
        projectId: true,
        project: { select: { id: true, slug: true, name: true, organizationId: true, settings: true } },
      },
    });
    if (!environment) throw notFound('Environment');
    const tenant = await membershipContext(req, environment.project.organizationId).catch(() => {
      throw notFound('Environment');
    });
    assertPermissions(tenant, required);
    const { project } = environment;
    tenant.project = { id: project.id, slug: project.slug, name: project.name, settings: (project.settings ?? {}) as Record<string, unknown> };
    tenant.environment = { id: environment.id, key: environment.key, name: environment.name, projectId: environment.projectId };
    req.tenant = tenant;
    next();
  };

export function can(req: Request, permission: Permission): boolean {
  return !!req.tenant?.permissions.has(permission);
}

export function requirePermission(req: Request, permission: Permission) {
  if (!can(req, permission)) throw forbidden(`Missing permission: ${permission}`);
}

/** Convenience accessors that fail loudly if a route forgot its guard. */
export function tenantOf(req: Request): TenantContext {
  if (!req.tenant) throw new Error('Route is missing a tenant guard');
  return req.tenant;
}
export function envOf(req: Request) {
  const tenant = tenantOf(req);
  if (!tenant.environment || !tenant.project) throw new Error('Route is missing an environment guard');
  return { tenant, environment: tenant.environment, project: tenant.project };
}
export function userOf(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}
