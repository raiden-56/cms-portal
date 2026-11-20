import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ENVIRONMENT_KEYS, slugify } from '@meridian/shared';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { param, parse } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { orgScope, projectScope, tenantOf, userOf } from '../../middleware/auth';
import { audit } from '../audit/audit.service';
import { ensurePageType } from '../schema/schema.service';

export const projectsRouter = Router();

const ENVIRONMENT_NAMES: Record<string, string> = { development: 'Development', staging: 'Staging', production: 'Production' };

const projectInput = z.object({
  name: z.string().trim().min(2, 'Project name is required').max(80),
  description: z.string().trim().max(400).default(''),
  icon: z.string().max(40).default('layers'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color such as #1F6F5C').default('#1F6F5C'),
});

const projectSettings = z
  .object({
    previewUrl: z.string().max(500),
    siteUrl: z.string().max(500),
    corsOrigins: z.array(z.string().max(200)).max(50),
  })
  .partial()
  .strict();

async function projectSummary(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      environments: { orderBy: { position: 'asc' }, select: { id: true, key: true, name: true, position: true } },
      locales: { orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] },
    },
  });
  const counts = await prisma.entry.groupBy({
    by: ['environmentId'],
    where: { environmentId: { in: project.environments.map((e) => e.id) }, deletedAt: null },
    _count: true,
  });
  const byEnv = new Map(counts.map((c) => [c.environmentId, c._count]));
  return {
    ...project,
    environments: project.environments.map((e) => ({ ...e, entryCount: byEnv.get(e.id) ?? 0 })),
  };
}

projectsRouter.get('/orgs/:orgId/projects', orgScope('project.read'), async (req, res) => {
  const { organizationId } = tenantOf(req);
  const projects = await prisma.project.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  res.json({ items: await Promise.all(projects.map((p) => projectSummary(p.id))) });
});

projectsRouter.post('/orgs/:orgId/projects', orgScope('project.create'), async (req, res) => {
  const input = parse(projectInput, req.body);
  const { organizationId } = tenantOf(req);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  const maxProjects = Number((org.settings as { maxProjects?: number })?.maxProjects ?? 0);
  if (maxProjects > 0 && (await prisma.project.count({ where: { organizationId, deletedAt: null } })) >= maxProjects) {
    throw conflict(`This organization is limited to ${maxProjects} projects`);
  }
  const base = slugify(input.name, 48) || 'project';
  const project = await prisma.$transaction(async (tx) => {
    let slug = base;
    for (let i = 2; await tx.project.findUnique({ where: { organizationId_slug: { organizationId, slug } }, select: { id: true } }); i += 1) {
      slug = `${base}-${i}`;
    }
    const created = await tx.project.create({
      data: { organizationId, name: input.name, slug, description: input.description, icon: input.icon, color: input.color, createdById: userOf(req).id },
    });
    // Every project starts with the three standard environments, each with its own schema and content.
    for (const [position, key] of ENVIRONMENT_KEYS.entries()) {
      const environment = await tx.environment.create({ data: { projectId: created.id, key, name: ENVIRONMENT_NAMES[key], position } });
      await ensurePageType(tx, environment.id);
    }
    await tx.locale.create({ data: { projectId: created.id, code: 'en', name: 'English', isDefault: true } });
    return created;
  });
  await audit(req, {
    projectId: project.id,
    action: 'project.created',
    resourceType: 'project',
    resourceId: project.id,
    resourceLabel: project.name,
    after: { name: project.name, slug: project.slug },
  });
  res.status(201).json(await projectSummary(project.id));
});

projectsRouter.get('/projects/:projectId', projectScope('project.read'), async (req, res) => {
  res.json(await projectSummary(param(req, 'projectId')));
});

projectsRouter.patch('/projects/:projectId', projectScope('project.update'), async (req, res) => {
  const input = parse(projectInput.partial().extend({ settings: projectSettings.optional() }), req.body);
  const before = await prisma.project.findUniqueOrThrow({ where: { id: param(req, 'projectId') } });
  const data: Prisma.ProjectUpdateInput = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.settings ? { settings: { ...(before.settings as object), ...input.settings } } : {}),
  };
  const project = await prisma.project.update({ where: { id: before.id }, data });
  await audit(req, {
    action: 'project.updated',
    resourceType: 'project',
    resourceId: project.id,
    resourceLabel: project.name,
    before: { name: before.name, description: before.description, color: before.color, settings: before.settings },
    after: { name: project.name, description: project.description, color: project.color, settings: project.settings },
  });
  res.json(await projectSummary(project.id));
});

projectsRouter.delete('/projects/:projectId', projectScope('project.delete'), async (req, res) => {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: param(req, 'projectId') } });
  if (req.query.confirm !== project.slug) {
    throw conflict('Confirm deletion by passing the project slug', { confirmWith: project.slug });
  }
  // Soft delete: the project disappears everywhere and its tokens stop working, but data stays recoverable.
  await prisma.$transaction([
    prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date(), slug: `${project.slug}--deleted-${Date.now().toString(36)}` } }),
    prisma.apiToken.updateMany({ where: { projectId: project.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, { action: 'project.deleted', resourceType: 'project', resourceId: project.id, resourceLabel: project.name, before: { slug: project.slug } });
  res.status(204).end();
});

// ─── Locales ─────────────────────────────────────────────────────────────────

const localeCode = z.string().regex(/^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,3})?$/, 'Use a code such as "en", "fr" or "pt-BR"');

projectsRouter.get('/projects/:projectId/locales', projectScope('project.read'), async (req, res) => {
  const locales = await prisma.locale.findMany({ where: { projectId: param(req, 'projectId') }, orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] });
  res.json({ items: locales });
});

projectsRouter.post('/projects/:projectId/locales', projectScope('project.update'), async (req, res) => {
  const input = parse(z.object({ code: localeCode, name: z.string().trim().min(1).max(60), fallbackCode: localeCode.nullable().optional() }), req.body);
  const projectId = param(req, 'projectId');
  if (await prisma.locale.findUnique({ where: { projectId_code: { projectId, code: input.code } }, select: { id: true } })) {
    throw conflict(`Locale "${input.code}" already exists`);
  }
  if (input.fallbackCode && !(await prisma.locale.findUnique({ where: { projectId_code: { projectId, code: input.fallbackCode } } }))) {
    throw badRequest(`Fallback locale "${input.fallbackCode}" does not exist`);
  }
  const locale = await prisma.locale.create({ data: { projectId, code: input.code, name: input.name, fallbackCode: input.fallbackCode ?? null } });
  await audit(req, { action: 'locale.created', resourceType: 'locale', resourceId: locale.id, resourceLabel: locale.code });
  res.status(201).json(locale);
});

projectsRouter.patch('/projects/:projectId/locales/:localeId', projectScope('project.update'), async (req, res) => {
  const input = parse(
    z.object({ name: z.string().trim().min(1).max(60).optional(), fallbackCode: localeCode.nullable().optional(), isDefault: z.literal(true).optional() }),
    req.body,
  );
  const projectId = param(req, 'projectId');
  const locale = await prisma.locale.findFirst({ where: { id: param(req, 'localeId'), projectId } });
  if (!locale) throw notFound('Locale');
  if (input.fallbackCode === locale.code) throw badRequest('A locale cannot fall back to itself');
  if (input.fallbackCode && !(await prisma.locale.findUnique({ where: { projectId_code: { projectId, code: input.fallbackCode } } }))) {
    throw badRequest(`Fallback locale "${input.fallbackCode}" does not exist`);
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.locale.updateMany({ where: { projectId, isDefault: true }, data: { isDefault: false } });
    return tx.locale.update({
      where: { id: locale.id },
      data: {
        name: input.name ?? locale.name,
        ...(input.fallbackCode !== undefined ? { fallbackCode: input.fallbackCode } : {}),
        ...(input.isDefault ? { isDefault: true, fallbackCode: null } : {}),
      },
    });
  });
  await audit(req, { action: 'locale.updated', resourceType: 'locale', resourceId: locale.id, resourceLabel: locale.code });
  res.json(updated);
});

projectsRouter.delete('/projects/:projectId/locales/:localeId', projectScope('project.update'), async (req, res) => {
  const projectId = param(req, 'projectId');
  const locale = await prisma.locale.findFirst({ where: { id: param(req, 'localeId'), projectId } });
  if (!locale) throw notFound('Locale');
  if (locale.isDefault) throw conflict('The default locale cannot be deleted. Make another locale the default first.');
  const used = await prisma.entry.count({ where: { locale: locale.code, environment: { projectId }, deletedAt: null } });
  if (used > 0) throw conflict(`${used} entr${used === 1 ? 'y uses' : 'ies use'} this locale. Delete those translations first.`);
  await prisma.$transaction([
    prisma.locale.updateMany({ where: { projectId, fallbackCode: locale.code }, data: { fallbackCode: null } }),
    prisma.locale.delete({ where: { id: locale.id } }),
  ]);
  await audit(req, { action: 'locale.deleted', resourceType: 'locale', resourceId: locale.id, resourceLabel: locale.code });
  res.status(204).end();
});
