import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PASSWORD, app, as, createArticleType, createProject, createToken, register, richText, unique } from './helpers';

describe('authentication', () => {
  it('registers a user with an organization, then signs in and reads the profile', async () => {
    const session = await register('Grace Hopper');
    const me = await as(session).get('/admin/api/auth/me').expect(200);
    expect(me.body.user.email).toBe(session.email);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].role.key).toBe('org_admin');
    expect(me.body.user).not.toHaveProperty('passwordHash');

    const login = await request(app).post('/admin/api/auth/login').send({ email: session.email, password: PASSWORD }).expect(200);
    expect(login.body.accessToken).toBeTruthy();
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('rejects wrong credentials without revealing whether the account exists', async () => {
    const session = await register();
    const wrong = await request(app).post('/admin/api/auth/login').send({ email: session.email, password: 'not-the-password-1' }).expect(401);
    const unknown = await request(app).post('/admin/api/auth/login').send({ email: 'nobody@example.test', password: 'not-the-password-1' }).expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('enforces the password policy and unique emails', async () => {
    const weak = await request(app)
      .post('/admin/api/auth/register')
      .send({ name: 'A', email: `${unique('weak')}@example.test`, password: 'short', organizationName: 'Org' })
      .expect(422);
    expect(weak.body.error.details.some((d: { path: string }) => d.path === 'password')).toBe(true);
    const session = await register();
    await request(app).post('/admin/api/auth/register').send({ name: 'Dup', email: session.email, password: PASSWORD, organizationName: 'Other' }).expect(409);
  });

  it('refreshes with the httpOnly cookie only when the client header is present', async () => {
    const session = await register();
    await request(app).post('/admin/api/auth/refresh').set('Cookie', session.cookie).expect(403);
    const refreshed = await request(app).post('/admin/api/auth/refresh').set('Cookie', session.cookie).set('X-Meridian-Client', 'admin').expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    await as(refreshed.body.accessToken).get('/admin/api/auth/me').expect(200);
  });

  it('cuts access immediately when a session is revoked', async () => {
    const session = await register();
    await request(app).post('/admin/api/auth/logout').set('Cookie', session.cookie).set('X-Meridian-Client', 'admin').expect(204);
    // The access token has not expired, but its session is gone.
    await as(session).get('/admin/api/auth/me').expect(401);
    await request(app).post('/admin/api/auth/refresh').set('Cookie', session.cookie).set('X-Meridian-Client', 'admin').expect(401);
  });

  it('requires authentication on the management API', async () => {
    await request(app).get('/admin/api/orgs').expect(401);
    await request(app).get('/admin/api/orgs').set('Authorization', 'Bearer not-a-jwt').expect(401);
  });
});

describe('tenant isolation', () => {
  it('never lets one organization see or change another organization’s data', async () => {
    const alice = await register('Alice');
    const mallory = await register('Mallory');
    const project = await createProject(alice, 'Alice Site');
    await createArticleType(alice, project);
    const entry = await as(alice).post(`${project.base}/entries/articles`, { data: { title: 'Private draft', body: richText('secret') } }).expect(201);
    const aliceToken = await createToken(alice, project);

    // Every route addressed by another tenant's ids answers "not found", never "forbidden" and never data.
    await as(mallory).get(`/admin/api/orgs/${alice.orgId}`).expect(404);
    await as(mallory).get(`/admin/api/orgs/${alice.orgId}/projects`).expect(404);
    await as(mallory).get(`/admin/api/orgs/${alice.orgId}/members`).expect(404);
    await as(mallory).get(`/admin/api/orgs/${alice.orgId}/audit-logs`).expect(404);
    await as(mallory).get(`/admin/api/projects/${project.projectId}`).expect(404);
    await as(mallory).get(`/admin/api/projects/${project.projectId}/tokens`).expect(404);
    await as(mallory).get(`/admin/api/projects/${project.projectId}/media`).expect(404);
    await as(mallory).get(`${project.base}/schema`).expect(404);
    await as(mallory).get(`${project.base}/entries/articles`).expect(404);
    await as(mallory).get(`${project.base}/entry/${entry.body.id}`).expect(404);
    await as(mallory).put(`${project.base}/entry/${entry.body.id}`, { data: { title: 'pwned' } }).expect(404);
    await as(mallory).post(`${project.base}/entry/${entry.body.id}/publish`, {}).expect(404);
    await as(mallory).delete(`${project.base}/entry/${entry.body.id}`).expect(404);
    await as(mallory).post(`${project.base}/content-types`, { apiId: 'x', displayName: 'X', singularName: 'X', pluralName: 'Xs' }).expect(404);
    await as(mallory).get(`${project.base}/webhooks`).expect(404);
    await as(mallory).get(`${project.base}/dashboard`).expect(404);

    // An entry id from another tenant cannot be reached through one's own environment either.
    const malloryProject = await createProject(mallory, 'Mallory Site');
    await createArticleType(mallory, malloryProject);
    await as(mallory).get(`${malloryProject.base}/entry/${entry.body.id}`).expect(404);
    await as(mallory).post(`${malloryProject.base}/entry/${entry.body.id}/publish`, {}).expect(404);

    // Delivery tokens are bound to their own project: Alice's token sees nothing of Mallory's content.
    const theirs = await as(mallory).post(`${malloryProject.base}/entries/articles`, { data: { title: 'Mallory public' } }).expect(201);
    await as(mallory).post(`${malloryProject.base}/entry/${theirs.body.id}/publish`, {}).expect(200);
    const seen = await request(app).get('/api/v1/articles').set('Authorization', `Bearer ${aliceToken}`).expect(200);
    expect(seen.body.data).toHaveLength(0);
    await request(app).get(`/api/v1/articles/${theirs.body.documentId}`).set('Authorization', `Bearer ${aliceToken}`).expect(404);

    // Alice's data is untouched.
    const still = await as(alice).get(`${project.base}/entry/${entry.body.id}`).expect(200);
    expect(still.body.data.title).toBe('Private draft');
  });
});

describe('roles and permissions', () => {
  it('enforces permissions on the server for each role', async () => {
    const admin = await register('Admin');
    const project = await createProject(admin);
    await createArticleType(admin, project);
    const roles = (await as(admin).get(`/admin/api/orgs/${admin.orgId}/roles`).expect(200)).body.items as { id: string; key: string }[];
    const roleId = (key: string) => roles.find((r) => r.key === key)?.id as string;
    expect(roles.map((r) => r.key)).toEqual(expect.arrayContaining(['org_admin', 'project_admin', 'developer', 'content_manager', 'editor', 'author', 'reviewer', 'publisher', 'viewer']));

    const join = async (roleKey: string) => {
      const email = `${unique(roleKey)}@example.test`;
      const invite = await as(admin).post(`/admin/api/orgs/${admin.orgId}/invitations`, { email, roleId: roleId(roleKey) }).expect(201);
      const token = new URL(invite.body.inviteUrl).searchParams.get('token') as string;
      const accepted = await request(app).post(`/admin/api/auth/invitations/${token}/accept`).send({ name: roleKey, password: PASSWORD }).expect(200);
      return accepted.body.accessToken as string;
    };
    const author = await join('author');
    const reviewer = await join('reviewer');
    const viewer = await join('viewer');

    // Viewer: read only.
    await as(viewer).get(`${project.base}/entries/articles`).expect(200);
    await as(viewer).post(`${project.base}/entries/articles`, { data: { title: 'Nope' } }).expect(403);

    // Author: can write and submit, cannot publish, approve, change the schema or manage people.
    const draft = await as(author).post(`${project.base}/entries/articles`, { data: { title: 'From the author' } }).expect(201);
    await as(author).post(`${project.base}/entry/${draft.body.id}/publish`, {}).expect(403);
    await as(author).post(`${project.base}/content-types`, { apiId: 'hack', displayName: 'Hack', singularName: 'Hack', pluralName: 'Hacks' }).expect(403);
    await as(author).get(`/admin/api/projects/${project.projectId}/tokens`).expect(403);
    await as(author).post(`/admin/api/orgs/${admin.orgId}/invitations`, { email: 'x@example.test', roleId: roleId('org_admin') }).expect(403);
    await as(author).post(`${project.base}/entry/${draft.body.id}/transition`, { action: 'submit' }).expect(200);
    await as(author).post(`${project.base}/entry/${draft.body.id}/transition`, { action: 'approve' }).expect(403);

    // Reviewer: can approve, cannot edit or publish.
    await as(reviewer).put(`${project.base}/entry/${draft.body.id}`, { data: { title: 'Edited by reviewer' } }).expect(403);
    const approved = await as(reviewer).post(`${project.base}/entry/${draft.body.id}/transition`, { action: 'approve', comment: 'Looks good' }).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    await as(reviewer).post(`${project.base}/entry/${draft.body.id}/publish`, {}).expect(403);

    // Admin publishes; the audit trail attributes each step to the right person.
    await as(admin).post(`${project.base}/entry/${draft.body.id}/publish`, {}).expect(200);
    const activity = await as(admin).get(`${project.base}/entry/${draft.body.id}/activity`).expect(200);
    const actions = activity.body.items.map((i: { action: string; actorLabel: string }) => `${i.actorLabel}:${i.action}`);
    expect(actions).toEqual(expect.arrayContaining(['author:entry.created', 'author:entry.submit', 'reviewer:entry.approve', 'Admin:entry.published']));
  });

  it('prevents privilege escalation and keeps one administrator', async () => {
    const admin = await register('Owner');
    const members = (await as(admin).get(`/admin/api/orgs/${admin.orgId}/members`).expect(200)).body.items;
    const roles = (await as(admin).get(`/admin/api/orgs/${admin.orgId}/roles`).expect(200)).body.items as { id: string; key: string; isSystem: boolean }[];
    const viewer = roles.find((r) => r.key === 'viewer') as { id: string };

    // The last administrator cannot demote or remove themselves.
    await as(admin).patch(`/admin/api/orgs/${admin.orgId}/members/${members[0].id}`, { roleId: viewer.id }).expect(409);
    await as(admin).delete(`/admin/api/orgs/${admin.orgId}/members/${members[0].id}`).expect(409);

    // System roles are immutable; custom roles work and unknown permissions are refused.
    await as(admin).patch(`/admin/api/orgs/${admin.orgId}/roles/${viewer.id}`, { permissions: ['content.publish'] }).expect(403);
    await as(admin).post(`/admin/api/orgs/${admin.orgId}/roles`, { name: 'Bad', permissions: ['root.everything'] }).expect(400);
    const custom = await as(admin).post(`/admin/api/orgs/${admin.orgId}/roles`, { name: 'Translator', permissions: ['project.read', 'content.read', 'content.update'] }).expect(201);
    expect(custom.body.isSystem).toBe(false);
    expect(custom.body.key).toBe('custom_translator');
  });
});
