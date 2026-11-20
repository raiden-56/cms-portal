import type { Prisma } from '@prisma/client';
import { SYSTEM_ROLES, slugify } from '@meridian/shared';
import { prisma } from '../../lib/infra';

type Tx = Prisma.TransactionClient;

async function uniqueOrgSlug(tx: Tx, name: string): Promise<string> {
  const base = slugify(name, 48) || 'organization';
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const taken = await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Creates an organization with its system roles and makes `userId` its administrator. */
export async function createOrganization(tx: Tx, input: { name: string; userId: string }) {
  const organization = await tx.organization.create({
    data: { name: input.name.trim(), slug: await uniqueOrgSlug(tx, input.name) },
  });
  await tx.role.createMany({
    data: SYSTEM_ROLES.map((role) => ({
      organizationId: organization.id,
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      isSystem: true,
    })),
  });
  const adminRole = await tx.role.findUniqueOrThrow({
    where: { organizationId_key: { organizationId: organization.id, key: 'org_admin' } },
  });
  await tx.membership.create({
    data: { organizationId: organization.id, userId: input.userId, roleId: adminRole.id },
  });
  return organization;
}

export async function listMemberships(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE', organization: { deletedAt: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      organization: { select: { id: true, name: true, slug: true, settings: true } },
      role: { select: { id: true, key: true, name: true, permissions: true } },
    },
  });
  return memberships.map((m) => ({
    membershipId: m.id,
    organization: m.organization,
    role: { id: m.role.id, key: m.role.key, name: m.role.name },
    permissions: m.role.permissions,
  }));
}

/** Number of active administrators, used to stop an organization from locking itself out. */
export async function countOrgAdmins(organizationId: string): Promise<number> {
  return prisma.membership.count({
    where: { organizationId, status: 'ACTIVE', role: { permissions: { hasEvery: ['org.manage', 'org.members.manage'] } } },
  });
}
