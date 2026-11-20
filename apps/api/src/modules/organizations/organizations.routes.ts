import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ALL_PERMISSIONS, isPermission, slugify } from '@meridian/shared';
import { env } from '../../config/env';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { param, parse, toPage } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { orgScope, tenantOf, userOf } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { countOrgAdmins, createOrganization, listMemberships } from './organizations.service';

export const organizationsRouter = Router();

organizationsRouter.get('/', async (req, res) => {
  res.json({ items: await listMemberships(userOf(req).id) });
});

organizationsRouter.post('/', async (req, res) => {
  const input = parse(z.object({ name: z.string().trim().min(2).max(120) }), req.body);
  const user = userOf(req);
  const organization = await prisma.$transaction((tx) => createOrganization(tx, { name: input.name, userId: user.id }));
  await audit(req, {
    organizationId: organization.id,
    action: 'organization.created',
    resourceType: 'organization',
    resourceId: organization.id,
    resourceLabel: organization.name,
  });
  res.status(201).json(organization);
});

organizationsRouter.get('/:orgId', orgScope(), async (req, res) => {
  const { organizationId } = tenantOf(req);
  const [organization, members, projects, entries, storage] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
    prisma.project.count({ where: { organizationId, deletedAt: null } }),
    prisma.entry.count({ where: { deletedAt: null, environment: { project: { organizationId, deletedAt: null } } } }),
    prisma.mediaAsset.aggregate({ where: { deletedAt: null, project: { organizationId, deletedAt: null } }, _sum: { size: true }, _count: true }),
  ]);
  res.json({
    ...organization,
    usage: { members, projects, entries, mediaAssets: storage._count, storageBytes: storage._sum.size ?? 0 },
  });
});

const orgSettings = z
  .object({
    dateFormat: z.string().max(40).optional(),
    timeFormat: z.enum(['12h', '24h']).optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    maxProjects: z.number().int().min(1).max(10000).optional(),
  })
  .strict();

organizationsRouter.patch('/:orgId', orgScope('org.manage'), async (req, res) => {
  const input = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      slug: z.string().trim().min(2).max(48).optional(),
      settings: orgSettings.optional(),
    }),
    req.body,
  );
  const { organizationId } = tenantOf(req);
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const data: Prisma.OrganizationUpdateInput = {};
  if (input.name) data.name = input.name;
  if (input.slug) {
    const slug = slugify(input.slug, 48);
    if (!slug) throw badRequest('Slug must contain letters or numbers');
    const taken = await prisma.organization.findFirst({ where: { slug, id: { not: organizationId } }, select: { id: true } });
    if (taken) throw conflict('That organization URL is already taken');
    data.slug = slug;
  }
  if (input.settings) data.settings = { ...(before.settings as object), ...input.settings };
  const organization = await prisma.organization.update({ where: { id: organizationId }, data });
  await audit(req, {
    action: 'organization.updated',
    resourceType: 'organization',
    resourceId: organizationId,
    resourceLabel: organization.name,
    before: { name: before.name, slug: before.slug, settings: before.settings },
    after: { name: organization.name, slug: organization.slug, settings: organization.settings },
  });
  res.json(organization);
});

// ─── Members ─────────────────────────────────────────────────────────────────

organizationsRouter.get('/:orgId/members', orgScope(), async (req, res) => {
  const members = await prisma.membership.findMany({
    where: { organizationId: tenantOf(req).organizationId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } },
      role: { select: { id: true, key: true, name: true } },
    },
  });
  res.json({ items: members });
});

organizationsRouter.patch('/:orgId/members/:memberId', orgScope('org.members.manage'), async (req, res) => {
  const input = parse(
    z.object({ roleId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }),
    req.body,
  );
  const { organizationId } = tenantOf(req);
  const member = await prisma.membership.findFirst({
    where: { id: param(req, 'memberId'), organizationId },
    include: { role: true, user: { select: { email: true } } },
  });
  if (!member) throw notFound('Member');

  let nextRole = member.role;
  if (input.roleId && input.roleId !== member.roleId) {
    const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId } });
    if (!role) throw badRequest('Role does not belong to this organization');
    nextRole = role;
  }
  const wasAdmin = member.status === 'ACTIVE' && member.role.permissions.includes('org.manage') && member.role.permissions.includes('org.members.manage');
  const staysAdmin =
    (input.status ?? member.status) === 'ACTIVE' && nextRole.permissions.includes('org.manage') && nextRole.permissions.includes('org.members.manage');
  if (wasAdmin && !staysAdmin && (await countOrgAdmins(organizationId)) <= 1) {
    throw conflict('An organization must keep at least one active administrator');
  }
  const updated = await prisma.membership.update({
    where: { id: member.id },
    data: { roleId: nextRole.id, status: input.status ?? member.status },
    select: { id: true, status: true, role: { select: { id: true, key: true, name: true } } },
  });
  if (updated.status === 'SUSPENDED') {
    // Suspension takes effect immediately on the next request; no token needs to expire first.
  }
  await audit(req, {
    action: 'member.updated',
    resourceType: 'member',
    resourceId: member.userId,
    resourceLabel: member.user.email,
    before: { role: member.role.key, status: member.status },
    after: { role: updated.role.key, status: updated.status },
  });
  res.json(updated);
});

organizationsRouter.delete('/:orgId/members/:memberId', orgScope('org.members.manage'), async (req, res) => {
  const { organizationId } = tenantOf(req);
  const member = await prisma.membership.findFirst({
    where: { id: param(req, 'memberId'), organizationId },
    include: { role: true, user: { select: { email: true } } },
  });
  if (!member) throw notFound('Member');
  const isAdmin = member.status === 'ACTIVE' && member.role.permissions.includes('org.manage') && member.role.permissions.includes('org.members.manage');
  if (isAdmin && (await countOrgAdmins(organizationId)) <= 1) {
    throw conflict('An organization must keep at least one active administrator');
  }
  await prisma.membership.delete({ where: { id: member.id } });
  await audit(req, {
    action: 'member.removed',
    resourceType: 'member',
    resourceId: member.userId,
    resourceLabel: member.user.email,
    before: { role: member.role.key },
  });
  res.status(204).end();
});

// ─── Invitations ─────────────────────────────────────────────────────────────

organizationsRouter.get('/:orgId/invitations', orgScope('org.members.manage'), async (req, res) => {
  const items = await prisma.invitation.findMany({
    where: { organizationId: tenantOf(req).organizationId, acceptedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, expiresAt: true, createdAt: true, role: { select: { id: true, name: true } } },
  });
  res.json({ items: items.map((i) => ({ ...i, expired: i.expiresAt < new Date() })) });
});

organizationsRouter.post('/:orgId/invitations', orgScope('org.members.manage'), async (req, res) => {
  const input = parse(
    z.object({ email: z.string().trim().toLowerCase().email().max(254), roleId: z.string().uuid() }),
    req.body,
  );
  const { organizationId } = tenantOf(req);
  const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId } });
  if (!role) throw badRequest('Role does not belong to this organization');
  const already = await prisma.membership.findFirst({ where: { organizationId, user: { email: input.email } }, select: { id: true } });
  if (already) throw conflict('That person is already a member of this organization');

  const token = randomToken(32);
  await prisma.invitation.deleteMany({ where: { organizationId, email: input.email, acceptedAt: null } });
  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email: input.email,
      roleId: role.id,
      tokenHash: sha256(token),
      invitedById: userOf(req).id,
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    },
    select: { id: true, email: true, expiresAt: true, createdAt: true, role: { select: { id: true, name: true } } },
  });
  await audit(req, {
    action: 'member.invited',
    resourceType: 'invitation',
    resourceId: invitation.id,
    resourceLabel: input.email,
    after: { role: role.key },
  });
  // The link is returned once so the inviter can share it; only its hash is stored.
  const origin = env.ADMIN_ORIGIN.split(',')[0].trim();
  res.status(201).json({ ...invitation, expired: false, inviteUrl: `${origin}/accept-invite?token=${token}` });
});

organizationsRouter.delete('/:orgId/invitations/:invitationId', orgScope('org.members.manage'), async (req, res) => {
  const result = await prisma.invitation.deleteMany({
    where: { id: param(req, 'invitationId'), organizationId: tenantOf(req).organizationId },
  });
  if (result.count === 0) throw notFound('Invitation');
  res.status(204).end();
});

// ─── Roles ───────────────────────────────────────────────────────────────────

const roleInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length),
});

function cleanPermissions(permissions: string[]): string[] {
  const unknown = permissions.filter((p) => !isPermission(p));
  if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);
  return [...new Set(permissions)];
}

organizationsRouter.get('/:orgId/roles', orgScope(), async (req, res) => {
  const roles = await prisma.role.findMany({
    where: { organizationId: tenantOf(req).organizationId },
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { memberships: true } } },
  });
  res.json({
    items: roles.map(({ _count, ...role }) => ({ ...role, memberCount: _count.memberships })),
  });
});

organizationsRouter.post('/:orgId/roles', orgScope('org.roles.manage'), async (req, res) => {
  const input = parse(roleInput, req.body);
  const { organizationId, permissions: own } = tenantOf(req);
  const permissions = cleanPermissions(input.permissions);
  // Nobody can mint a role more powerful than the one they hold.
  const escalation = permissions.filter((p) => !own.has(p));
  if (escalation.length) throw forbidden(`You cannot grant permissions you do not have: ${escalation.join(', ')}`);
  const base = slugify(input.name, 40).replace(/-/g, '_') || 'role';
  let key = `custom_${base}`;
  for (let i = 2; await prisma.role.findUnique({ where: { organizationId_key: { organizationId, key } }, select: { id: true } }); i += 1) {
    key = `custom_${base}_${i}`;
  }
  const role = await prisma.role.create({
    data: { organizationId, key, name: input.name, description: input.description, permissions, isSystem: false },
  });
  await audit(req, { action: 'role.created', resourceType: 'role', resourceId: role.id, resourceLabel: role.name, after: { permissions } });
  res.status(201).json({ ...role, memberCount: 0 });
});

organizationsRouter.patch('/:orgId/roles/:roleId', orgScope('org.roles.manage'), async (req, res) => {
  const input = parse(roleInput.partial(), req.body);
  const { organizationId, permissions: own } = tenantOf(req);
  const role = await prisma.role.findFirst({ where: { id: param(req, 'roleId'), organizationId } });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw forbidden('System roles cannot be changed. Create a custom role instead.');
  const permissions = input.permissions ? cleanPermissions(input.permissions) : role.permissions;
  const escalation = permissions.filter((p) => !own.has(p) && !role.permissions.includes(p));
  if (escalation.length) throw forbidden(`You cannot grant permissions you do not have: ${escalation.join(', ')}`);
  const updated = await prisma.role.update({
    where: { id: role.id },
    data: { name: input.name ?? role.name, description: input.description ?? role.description, permissions },
  });
  await audit(req, {
    action: 'role.updated',
    resourceType: 'role',
    resourceId: role.id,
    resourceLabel: updated.name,
    before: { name: role.name, permissions: role.permissions },
    after: { name: updated.name, permissions },
  });
  res.json(updated);
});

organizationsRouter.delete('/:orgId/roles/:roleId', orgScope('org.roles.manage'), async (req, res) => {
  const role = await prisma.role.findFirst({
    where: { id: param(req, 'roleId'), organizationId: tenantOf(req).organizationId },
    include: { _count: { select: { memberships: true } } },
  });
  if (!role) throw notFound('Role');
  if (role.isSystem) throw forbidden('System roles cannot be deleted');
  if (role._count.memberships > 0) throw conflict('Reassign the members of this role before deleting it');
  await prisma.role.delete({ where: { id: role.id } });
  await audit(req, { action: 'role.deleted', resourceType: 'role', resourceId: role.id, resourceLabel: role.name, before: { permissions: role.permissions } });
  res.status(204).end();
});

// ─── Audit log ───────────────────────────────────────────────────────────────

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  resourceType: z.string().trim().max(60).optional(),
  actorId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  environmentId: z.string().uuid().optional(),
  resourceId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

organizationsRouter.get('/:orgId/audit-logs', orgScope('org.audit.read'), async (req, res) => {
  const q = parse(auditQuery, req.query);
  const where: Prisma.AuditLogWhereInput = {
    organizationId: tenantOf(req).organizationId,
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.resourceType ? { resourceType: q.resourceType } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.environmentId ? { environmentId: q.environmentId } : {}),
    ...(q.resourceId ? { resourceId: q.resourceId } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.search
      ? {
          OR: [
            { resourceLabel: { contains: q.search, mode: 'insensitive' } },
            { actorLabel: { contains: q.search, mode: 'insensitive' } },
            { action: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  if (q.format === 'csv') {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 10000 });
    const header = ['timestamp', 'actor', 'actorType', 'action', 'resourceType', 'resourceId', 'resource', 'projectId', 'environmentId', 'ip', 'before', 'after'];
    const lines = rows.map((r) =>
      [r.createdAt.toISOString(), r.actorLabel, r.actorType, r.action, r.resourceType, r.resourceId, r.resourceLabel, r.projectId, r.environmentId, r.ip, r.before, r.after]
        .map(csvCell)
        .join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header.join(','), ...lines].join('\r\n'));
    return;
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(toPage(items, total, q.page, q.pageSize));
});
