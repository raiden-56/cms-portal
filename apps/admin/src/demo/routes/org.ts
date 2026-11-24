/** Session, organization, members, roles, invitations, audit log, projects and locales. */
import { z } from 'zod';
import { ALL_PERMISSIONS, ENVIRONMENT_KEYS, isPermission, newId, slugify } from '@meridian/shared';
import { appUrl } from '@/lib/guest';
import { type Ctx, audit, guest, orgScope, projectScope } from '../context';
import { type DbAudit, type DbMembership, type DbProject, type DbRole, db, now, nowIso } from '../db';
import { Reply, badRequest, conflict, created, forbidden, needsServer, noContent, notFound, paginate, parse } from '../http';
import type { Router } from '../router';
import { createPageType } from './schema';

// ─── Session ─────────────────────────────────────────────────────────────────

const roleOf = (membership: DbMembership): DbRole => db.roles.find((r) => r.id === membership.roleId) as DbRole;

/** The guest's profile in the shape of the API's sign-in response. */
export function profile() {
  const user = guest();
  const memberships = db.memberships
    .filter((m) => m.userId === user.id && m.status === 'ACTIVE')
    .map((m) => {
      const role = roleOf(m);
      const { id, name, slug, settings } = db.organization;
      return { membershipId: m.id, organization: { id, name, slug, settings }, role: { id: role.id, key: role.key, name: role.name }, permissions: role.permissions };
    });
  const { id, email, name, isSuperAdmin, createdAt, lastLoginAt } = user;
  return { user: { id, email, name, isSuperAdmin, createdAt, lastLoginAt }, memberships };
}

/** Not a credential: guest mode has no server to authenticate against. */
export const session = () => ({ accessToken: 'guest-mode', expiresIn: 86_400, ...profile() });

/**
 * A server lets an administrator step down once another one exists. A guest who did that would
 * be locked out of the demo with nobody to let them back in, so guest mode refuses it and says why.
 */
const GUEST_STAYS_ADMIN = 'In guest mode the guest stays an active administrator, so every screen remains reachable. Change another member instead.';

const isAdmin = (m: DbMembership) => m.status === 'ACTIVE' && roleOf(m).permissions.includes('org.manage') && roleOf(m).permissions.includes('org.members.manage');
const countOrgAdmins = () => db.memberships.filter(isAdmin).length;

function cleanPermissions(permissions: string[]): string[] {
  const unknown = permissions.filter((p) => !isPermission(p));
  if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);
  return [...new Set(permissions)];
}

const ownPermissions = () => new Set(profile().memberships[0]?.permissions ?? []);

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

// ─── Projects ────────────────────────────────────────────────────────────────

const ENVIRONMENT_NAMES: Record<string, string> = { development: 'Development', staging: 'Staging', production: 'Production' };

function projectSummary(project: DbProject) {
  const { deletedAt: _deleted, ...rest } = project;
  return {
    ...rest,
    deletedAt: null,
    environments: db.environments
      .filter((e) => e.projectId === project.id)
      .sort((a, b) => a.position - b.position)
      .map(({ projectId: _projectId, ...e }) => ({ ...e, entryCount: db.entries.filter((x) => x.environmentId === e.id && !x.deletedAt).length })),
    locales: db.locales.filter((l) => l.projectId === project.id).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code)),
  };
}

/** A project always starts with the three standard environments, each with its own schema and content. */
export function createProject(input: { name: string; description: string; icon: string; color: string }): DbProject {
  const base = slugify(input.name, 48) || 'project';
  let slug = base;
  for (let i = 2; db.projects.some((p) => p.slug === slug); i += 1) slug = `${base}-${i}`;
  const at = nowIso();
  const project: DbProject = { id: newId(), organizationId: db.organization.id, name: input.name, slug, description: input.description, icon: input.icon, color: input.color, settings: {}, createdAt: at, updatedAt: at, deletedAt: null };
  db.projects.push(project);
  ENVIRONMENT_KEYS.forEach((key, position) => {
    const environment = { id: newId(), projectId: project.id, key, name: ENVIRONMENT_NAMES[key], position };
    db.environments.push(environment);
    createPageType(environment.id);
  });
  db.locales.push({ id: newId(), projectId: project.id, code: 'en', name: 'English', isDefault: true, fallbackCode: null });
  return project;
}

const projectInput = z.object({
  name: z.string().trim().min(2, 'Project name is required').max(80),
  description: z.string().trim().max(400).default(''),
  icon: z.string().max(40).default('layers'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color such as #1F6F5C').default('#1F6F5C'),
});
const projectSettings = z.object({ previewUrl: z.string().max(500), siteUrl: z.string().max(500), corsOrigins: z.array(z.string().max(200)).max(50) }).partial().strict();
const localeCode = z.string().regex(/^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,3})?$/, 'Use a code such as "en", "fr" or "pt-BR"');
const orgSettings = z
  .object({ dateFormat: z.string().max(40).optional(), timeFormat: z.enum(['12h', '24h']).optional(), brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), maxProjects: z.number().int().min(1).max(10000).optional() })
  .strict();
const roleInput = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).default(''), permissions: z.array(z.string()).max(ALL_PERMISSIONS.length) });

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

export function orgRoutes(r: Router): void {
  // ─── Auth and account ──────────────────────────────────────────────────────

  r.get('/auth/config', () => ({ allowRegistration: false }));
  r.post('/auth/refresh', () => session());
  r.post('/auth/logout', () => noContent());
  r.get('/auth/me', () => profile());
  r.post('/auth/login', () => {
    throw needsServer('Signing in with an email and password');
  });
  r.post('/auth/register', () => {
    throw needsServer('Creating an account');
  });

  r.patch('/auth/me', (c) => {
    const input = parse(z.object({ name: z.string().trim().min(1, 'Enter your name').max(120) }), c.body);
    guest().name = input.name;
    return profile();
  });

  r.post('/auth/me/password', () => {
    throw needsServer('Changing the password');
  });

  // The guest session is this browser tab. There is nothing on a server to list or revoke.
  r.get('/auth/me/sessions', () => {
    const { createdAt } = guest();
    return {
      items: [{ id: 'guest-session', userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent, ip: null, createdAt: db.seededAt || createdAt, lastUsedAt: nowIso(), expiresAt: new Date(now().getTime() + 86_400_000).toISOString(), current: true }],
    };
  });
  r.delete('/auth/me/sessions/:sessionId', () => {
    throw needsServer('Revoking sessions');
  });
  r.get('/auth/me/login-history', () => ({ items: [] }));

  const prefKey = z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/, 'Invalid preference key');
  r.get('/auth/me/preferences/:key', (c) => {
    const key = parse(prefKey, c.params.key);
    return { key, value: db.preferences[key] ?? null };
  });
  r.put('/auth/me/preferences/:key', (c) => {
    const key = parse(prefKey, c.params.key);
    const body = parse(z.object({ value: z.unknown() }), c.body);
    if (JSON.stringify(body.value ?? null).length > 50_000) throw badRequest('Preference value is too large');
    db.preferences[key] = body.value ?? null;
    return { key, value: db.preferences[key] };
  });

  r.get('/auth/invitations/:token', (c) => {
    const invitation = db.invitations.find((i) => i.token === c.params.token && i.expiresAt > nowIso());
    if (!invitation) throw notFound('Invitation');
    return { email: invitation.email, organization: db.organization.name, role: db.roles.find((x) => x.id === invitation.roleId)?.name ?? '', accountExists: false };
  });
  r.post('/auth/invitations/:token/accept', () => {
    throw needsServer('Accepting an invitation');
  });

  // ─── Organization ──────────────────────────────────────────────────────────

  r.get('/orgs', () => ({ items: profile().memberships }));

  r.get('/orgs/:orgId', (c) => {
    orgScope(c);
    const projects = db.projects.filter((p) => !p.deletedAt);
    const environments = new Set(db.environments.filter((e) => projects.some((p) => p.id === e.projectId)).map((e) => e.id));
    const assets = db.assets.filter((a) => !a.deletedAt && projects.some((p) => p.id === a.projectId));
    return {
      ...db.organization,
      usage: {
        members: db.memberships.filter((m) => m.status === 'ACTIVE').length,
        projects: projects.length,
        entries: db.entries.filter((e) => !e.deletedAt && environments.has(e.environmentId)).length,
        mediaAssets: assets.length,
        storageBytes: assets.reduce((n, a) => n + a.size, 0),
      },
    };
  });

  r.patch('/orgs/:orgId', (c) => {
    orgScope(c);
    const input = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), slug: z.string().trim().min(2).max(48).optional(), settings: orgSettings.optional() }), c.body);
    const org = db.organization;
    const before = { name: org.name, slug: org.slug, settings: org.settings };
    if (input.name) org.name = input.name;
    if (input.slug) {
      const slug = slugify(input.slug, 48);
      if (!slug) throw badRequest('Slug must contain letters or numbers');
      org.slug = slug;
    }
    if (input.settings) org.settings = { ...org.settings, ...input.settings };
    org.updatedAt = nowIso();
    audit(c, { action: 'organization.updated', resourceType: 'organization', resourceId: org.id, resourceLabel: org.name, before, after: { name: org.name, slug: org.slug, settings: org.settings } });
    return org;
  });

  // ─── Members ───────────────────────────────────────────────────────────────

  const memberOut = (m: DbMembership) => {
    const user = db.users.find((u) => u.id === m.userId);
    const role = roleOf(m);
    return { id: m.id, status: m.status, createdAt: m.createdAt, user: { id: m.userId, name: user?.name ?? '', email: user?.email ?? '', isActive: user?.isActive ?? false, lastLoginAt: user?.lastLoginAt ?? null }, role: { id: role.id, key: role.key, name: role.name } };
  };
  const findMember = (c: Ctx) => {
    orgScope(c);
    const member = db.memberships.find((m) => m.id === c.params.memberId);
    if (!member) throw notFound('Member');
    return member;
  };

  r.get('/orgs/:orgId/members', (c) => {
    orgScope(c);
    return { items: [...db.memberships].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(memberOut) };
  });

  r.patch('/orgs/:orgId/members/:memberId', (c) => {
    const input = parse(z.object({ roleId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }), c.body);
    const member = findMember(c);
    const previousRole = roleOf(member);
    let nextRole = previousRole;
    if (input.roleId && input.roleId !== member.roleId) {
      const role = db.roles.find((x) => x.id === input.roleId);
      if (!role) throw badRequest('Role does not belong to this organization');
      nextRole = role;
    }
    const staysAdmin = (input.status ?? member.status) === 'ACTIVE' && nextRole.permissions.includes('org.manage') && nextRole.permissions.includes('org.members.manage');
    if (isAdmin(member) && !staysAdmin && countOrgAdmins() <= 1) throw conflict('An organization must keep at least one active administrator');
    if (member.userId === db.userId && !staysAdmin) throw conflict(GUEST_STAYS_ADMIN);
    const before = { role: previousRole.key, status: member.status };
    member.roleId = nextRole.id;
    member.status = input.status ?? member.status;
    audit(c, { action: 'member.updated', resourceType: 'member', resourceId: member.userId, resourceLabel: db.users.find((u) => u.id === member.userId)?.email, before, after: { role: nextRole.key, status: member.status } });
    return { id: member.id, status: member.status, role: { id: nextRole.id, key: nextRole.key, name: nextRole.name } };
  });

  r.delete('/orgs/:orgId/members/:memberId', (c) => {
    const member = findMember(c);
    if (isAdmin(member) && countOrgAdmins() <= 1) throw conflict('An organization must keep at least one active administrator');
    if (member.userId === db.userId) throw conflict(GUEST_STAYS_ADMIN);
    db.memberships = db.memberships.filter((m) => m.id !== member.id);
    audit(c, { action: 'member.removed', resourceType: 'member', resourceId: member.userId, resourceLabel: db.users.find((u) => u.id === member.userId)?.email, before: { role: roleOf(member).key } });
    return noContent();
  });

  // ─── Invitations ───────────────────────────────────────────────────────────

  const invitationOut = (i: (typeof db.invitations)[number]) => {
    const role = db.roles.find((x) => x.id === i.roleId);
    return { id: i.id, email: i.email, expiresAt: i.expiresAt, createdAt: i.createdAt, role: { id: i.roleId, name: role?.name ?? '' }, expired: i.expiresAt < nowIso() };
  };

  r.get('/orgs/:orgId/invitations', (c) => {
    orgScope(c);
    return { items: [...db.invitations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(invitationOut) };
  });

  r.post('/orgs/:orgId/invitations', (c) => {
    orgScope(c);
    const input = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), roleId: z.string().uuid() }), c.body);
    const role = db.roles.find((x) => x.id === input.roleId);
    if (!role) throw badRequest('Role does not belong to this organization');
    const existing = db.users.find((u) => u.email === input.email);
    if (existing && db.memberships.some((m) => m.userId === existing.id)) throw conflict('That person is already a member of this organization');
    db.invitations = db.invitations.filter((i) => i.email !== input.email);
    const invitation = { id: newId(), email: input.email, roleId: role.id, token: `demo-invite-${newId()}`, expiresAt: new Date(now().getTime() + 7 * 86_400_000).toISOString(), createdAt: nowIso() };
    db.invitations.push(invitation);
    audit(c, { action: 'member.invited', resourceType: 'invitation', resourceId: invitation.id, resourceLabel: input.email, after: { role: role.key } });
    // No server holds this invitation, so the link can only ever be opened in this browser.
    return created({ ...invitationOut(invitation), expired: false, inviteUrl: appUrl(`accept-invite?token=${invitation.token}`) });
  });

  r.delete('/orgs/:orgId/invitations/:invitationId', (c) => {
    orgScope(c);
    if (!db.invitations.some((i) => i.id === c.params.invitationId)) throw notFound('Invitation');
    db.invitations = db.invitations.filter((i) => i.id !== c.params.invitationId);
    return noContent();
  });

  // ─── Roles ─────────────────────────────────────────────────────────────────

  const findRole = (c: Ctx) => {
    orgScope(c);
    const role = db.roles.find((x) => x.id === c.params.roleId);
    if (!role) throw notFound('Role');
    return role;
  };
  const memberCount = (role: DbRole) => db.memberships.filter((m) => m.roleId === role.id).length;

  r.get('/orgs/:orgId/roles', (c) => {
    orgScope(c);
    return { items: [...db.roles].sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.createdAt.localeCompare(b.createdAt)).map((role) => ({ ...role, memberCount: memberCount(role) })) };
  });

  r.post('/orgs/:orgId/roles', (c) => {
    orgScope(c);
    const input = parse(roleInput, c.body);
    const permissions = cleanPermissions(input.permissions);
    // Nobody can mint a role more powerful than the one they hold.
    const own = ownPermissions();
    const escalation = permissions.filter((p) => !own.has(p));
    if (escalation.length) throw forbidden(`You cannot grant permissions you do not have: ${escalation.join(', ')}`);
    const base = slugify(input.name, 40).replace(/-/g, '_') || 'role';
    let key = `custom_${base}`;
    for (let i = 2; db.roles.some((x) => x.key === key); i += 1) key = `custom_${base}_${i}`;
    const role: DbRole = { id: newId(), organizationId: db.organization.id, key, name: input.name, description: input.description, permissions, isSystem: false, createdAt: nowIso() };
    db.roles.push(role);
    audit(c, { action: 'role.created', resourceType: 'role', resourceId: role.id, resourceLabel: role.name, after: { permissions } });
    return created({ ...role, memberCount: 0 });
  });

  r.patch('/orgs/:orgId/roles/:roleId', (c) => {
    const input = parse(roleInput.partial(), c.body);
    const role = findRole(c);
    if (role.isSystem) throw forbidden('System roles cannot be changed. Create a custom role instead.');
    const permissions = input.permissions ? cleanPermissions(input.permissions) : role.permissions;
    const own = ownPermissions();
    const escalation = permissions.filter((p) => !own.has(p) && !role.permissions.includes(p));
    if (escalation.length) throw forbidden(`You cannot grant permissions you do not have: ${escalation.join(', ')}`);
    const before = { name: role.name, permissions: role.permissions };
    role.name = input.name ?? role.name;
    role.description = input.description ?? role.description;
    role.permissions = permissions;
    audit(c, { action: 'role.updated', resourceType: 'role', resourceId: role.id, resourceLabel: role.name, before, after: { name: role.name, permissions } });
    return role;
  });

  r.delete('/orgs/:orgId/roles/:roleId', (c) => {
    const role = findRole(c);
    if (role.isSystem) throw forbidden('System roles cannot be deleted');
    if (memberCount(role) > 0) throw conflict('Reassign the members of this role before deleting it');
    db.roles = db.roles.filter((x) => x.id !== role.id);
    db.invitations = db.invitations.filter((i) => i.roleId !== role.id);
    audit(c, { action: 'role.deleted', resourceType: 'role', resourceId: role.id, resourceLabel: role.name, before: { permissions: role.permissions } });
    return noContent();
  });

  // ─── Audit log ─────────────────────────────────────────────────────────────

  r.get('/orgs/:orgId/audit-logs', (c) => {
    orgScope(c);
    const q = parse(auditQuery, c.query);
    const needle = q.search?.toLowerCase();
    const has = (v: string | null) => !!v && v.toLowerCase().includes(needle as string);
    const rows = db.audit
      .filter(
        (a: DbAudit) =>
          (!q.action || a.action.startsWith(q.action)) &&
          (!q.resourceType || a.resourceType === q.resourceType) &&
          (!q.actorId || a.actorId === q.actorId) &&
          (!q.projectId || a.projectId === q.projectId) &&
          (!q.environmentId || a.environmentId === q.environmentId) &&
          (!q.resourceId || a.resourceId === q.resourceId) &&
          (!q.from || a.createdAt >= q.from.toISOString()) &&
          (!q.to || a.createdAt <= q.to.toISOString()) &&
          (!needle || has(a.resourceLabel) || has(a.actorLabel) || has(a.action)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (q.format === 'csv') {
      const header = ['timestamp', 'actor', 'actorType', 'action', 'resourceType', 'resourceId', 'resource', 'projectId', 'environmentId', 'ip', 'before', 'after'];
      const lines = rows.slice(0, 10_000).map((a) => [a.createdAt, a.actorLabel, a.actorType, a.action, a.resourceType, a.resourceId, a.resourceLabel, a.projectId, a.environmentId, a.ip, a.before, a.after].map(csvCell).join(','));
      return new Reply(200, [header.join(','), ...lines].join('\r\n'), { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="audit-log-${nowIso().slice(0, 10)}.csv"` });
    }
    return paginate(rows, q.page, q.pageSize);
  });

  // ─── Projects ──────────────────────────────────────────────────────────────

  r.get('/orgs/:orgId/projects', (c) => {
    orgScope(c);
    return { items: db.projects.filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(projectSummary) };
  });

  r.post('/orgs/:orgId/projects', (c) => {
    orgScope(c);
    const input = parse(projectInput, c.body);
    const maxProjects = Number((db.organization.settings as { maxProjects?: number }).maxProjects ?? 0);
    if (maxProjects > 0 && db.projects.filter((p) => !p.deletedAt).length >= maxProjects) throw conflict(`This organization is limited to ${maxProjects} projects`);
    const project = createProject(input);
    audit(c, { projectId: project.id, action: 'project.created', resourceType: 'project', resourceId: project.id, resourceLabel: project.name, after: { name: project.name, slug: project.slug } });
    return created(projectSummary(project));
  });

  r.get('/projects/:projectId', (c) => projectSummary(projectScope(c)));

  r.patch('/projects/:projectId', (c) => {
    const input = parse(projectInput.partial().extend({ settings: projectSettings.optional() }), c.body);
    const project = projectScope(c);
    const before = { name: project.name, description: project.description, color: project.color, settings: project.settings };
    if (input.name) project.name = input.name;
    if (input.description !== undefined) project.description = input.description;
    if (input.icon) project.icon = input.icon;
    if (input.color) project.color = input.color;
    if (input.settings) project.settings = { ...project.settings, ...input.settings };
    project.updatedAt = nowIso();
    audit(c, { action: 'project.updated', resourceType: 'project', resourceId: project.id, resourceLabel: project.name, before, after: { name: project.name, description: project.description, color: project.color, settings: project.settings } });
    return projectSummary(project);
  });

  r.delete('/projects/:projectId', (c) => {
    const project = projectScope(c);
    if (c.query.confirm !== project.slug) throw conflict('Confirm deletion by passing the project slug', { confirmWith: project.slug });
    const slug = project.slug;
    // Soft delete, as on the server: the project disappears everywhere and its keys stop working.
    project.deletedAt = nowIso();
    project.slug = `${slug}--deleted-${now().getTime().toString(36)}`;
    for (const token of db.tokens) if (token.projectId === project.id && !token.revokedAt) token.revokedAt = nowIso();
    audit(c, { action: 'project.deleted', resourceType: 'project', resourceId: project.id, resourceLabel: project.name, before: { slug } });
    return noContent();
  });

  // ─── Locales ───────────────────────────────────────────────────────────────

  const localesOf = (projectId: string) => db.locales.filter((l) => l.projectId === projectId);
  const findLocale = (c: Ctx) => {
    const project = projectScope(c);
    const locale = localesOf(project.id).find((l) => l.id === c.params.localeId);
    if (!locale) throw notFound('Locale');
    return locale;
  };

  r.get('/projects/:projectId/locales', (c) => ({ items: projectSummary(projectScope(c)).locales }));

  r.post('/projects/:projectId/locales', (c) => {
    const input = parse(z.object({ code: localeCode, name: z.string().trim().min(1).max(60), fallbackCode: localeCode.nullable().optional() }), c.body);
    const project = projectScope(c);
    const existing = localesOf(project.id);
    if (existing.some((l) => l.code === input.code)) throw conflict(`Locale "${input.code}" already exists`);
    if (input.fallbackCode && !existing.some((l) => l.code === input.fallbackCode)) throw badRequest(`Fallback locale "${input.fallbackCode}" does not exist`);
    const locale = { id: newId(), projectId: project.id, code: input.code, name: input.name, isDefault: false, fallbackCode: input.fallbackCode ?? null };
    db.locales.push(locale);
    audit(c, { action: 'locale.created', resourceType: 'locale', resourceId: locale.id, resourceLabel: locale.code });
    return created(locale);
  });

  r.patch('/projects/:projectId/locales/:localeId', (c) => {
    const input = parse(z.object({ name: z.string().trim().min(1).max(60).optional(), fallbackCode: localeCode.nullable().optional(), isDefault: z.literal(true).optional() }), c.body);
    const locale = findLocale(c);
    const siblings = localesOf(locale.projectId);
    if (input.fallbackCode === locale.code) throw badRequest('A locale cannot fall back to itself');
    if (input.fallbackCode && !siblings.some((l) => l.code === input.fallbackCode)) throw badRequest(`Fallback locale "${input.fallbackCode}" does not exist`);
    locale.name = input.name ?? locale.name;
    if (input.fallbackCode !== undefined) locale.fallbackCode = input.fallbackCode;
    if (input.isDefault) {
      for (const other of siblings) other.isDefault = false;
      locale.isDefault = true;
      locale.fallbackCode = null;
    }
    audit(c, { action: 'locale.updated', resourceType: 'locale', resourceId: locale.id, resourceLabel: locale.code });
    return locale;
  });

  r.delete('/projects/:projectId/locales/:localeId', (c) => {
    const locale = findLocale(c);
    if (locale.isDefault) throw conflict('The default locale cannot be deleted. Make another locale the default first.');
    const environments = new Set(db.environments.filter((e) => e.projectId === locale.projectId).map((e) => e.id));
    const used = db.entries.filter((e) => e.locale === locale.code && environments.has(e.environmentId) && !e.deletedAt).length;
    if (used > 0) throw conflict(`${used} entr${used === 1 ? 'y uses' : 'ies use'} this locale. Delete those translations first.`);
    for (const other of localesOf(locale.projectId)) if (other.fallbackCode === locale.code) other.fallbackCode = null;
    db.locales = db.locales.filter((l) => l.id !== locale.id);
    audit(c, { action: 'locale.deleted', resourceType: 'locale', resourceId: locale.id, resourceLabel: locale.code });
    return noContent();
  });
}
