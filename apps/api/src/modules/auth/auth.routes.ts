import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env, isProd } from '../../config/env';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors';
import { clientIp, param, parse } from '../../lib/http';
import { prisma } from '../../lib/infra';
import { requireAuth, signAccessToken, userOf } from '../../middleware/auth';
import { ipKey, rateLimit } from '../../middleware/common';
import { writeAudit } from '../audit/audit.service';
import { createOrganization, listMemberships } from '../organizations/organizations.service';

const REFRESH_COOKIE = 'mrd_refresh';
const COOKIE_PATH = '/admin/api/auth';

const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Password must contain letters and numbers');
const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const name = z.string().trim().min(1, 'Name is required').max(120);

const registerSchema = z.object({
  name,
  email,
  password,
  organizationName: z.string().trim().min(2, 'Organization name is required').max(120),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: isProd, sameSite: 'strict', path: COOKIE_PATH });
}

/**
 * Cookie-authenticated endpoints require a custom header. Browsers will not attach it to a
 * cross-site form post, and CORS only lets the configured admin origin send it from script.
 */
function requireClientHeader(req: Request) {
  if (req.headers['x-meridian-client'] !== 'admin') throw forbidden('Missing client header');
}

async function startSession(req: Request, res: Response, userId: string) {
  const refreshToken = randomToken(48);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(refreshToken),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
      ip: clientIp(req) ?? null,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000),
    },
  });
  setRefreshCookie(res, refreshToken);
  return { accessToken: await signAccessToken(userId, session.id), expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
}

async function profile(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, isSuperAdmin: true, createdAt: true, lastLoginAt: true },
  });
  return { user, memberships: await listMemberships(userId) };
}

// A real hash to compare against when the account does not exist, so response time does not reveal it.
const DUMMY_HASH = hashPassword('meridian-timing-equaliser');

const authLimiter = rateLimit({
  name: 'auth',
  limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
  windowSeconds: 60,
  key: ipKey,
});

export const authRouter = Router();

authRouter.get('/config', (_req, res) => {
  res.json({ allowRegistration: env.ALLOW_REGISTRATION });
});

authRouter.post('/register', authLimiter, async (req, res) => {
  if (!env.ALLOW_REGISTRATION) throw forbidden('Self-service registration is disabled');
  const input = parse(registerSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw conflict('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);
  const { user, organization } = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash, lastLoginAt: new Date() } });
    const org = await createOrganization(tx, { name: input.organizationName, userId: created.id });
    return { user: created, organization: org };
  });
  await writeAudit({
    organizationId: organization.id,
    actorId: user.id,
    actorLabel: user.name,
    action: 'organization.created',
    resourceType: 'organization',
    resourceId: organization.id,
    resourceLabel: organization.name,
    ip: clientIp(req),
  });
  const tokens = await startSession(req, res, user.id);
  res.status(201).json({ ...tokens, ...(await profile(user.id)) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
  const meta = { email: input.email, ip: clientIp(req) ?? null, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null };

  if (!user || !ok) {
    await prisma.loginEvent.create({ data: { ...meta, userId: user?.id, success: false, reason: 'invalid_credentials' } });
    throw unauthorized('Incorrect email or password');
  }
  if (!user.isActive) {
    await prisma.loginEvent.create({ data: { ...meta, userId: user.id, success: false, reason: 'deactivated' } });
    throw forbidden('This account has been deactivated');
  }
  await prisma.$transaction([
    prisma.loginEvent.create({ data: { ...meta, userId: user.id, success: true } }),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);
  const tokens = await startSession(req, res, user.id);
  res.json({ ...tokens, ...(await profile(user.id)) });
});

authRouter.post('/refresh', async (req, res) => {
  requireClientHeader(req);
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string' || !token) throw unauthorized('No active session');
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) {
    clearRefreshCookie(res);
    throw unauthorized('Session expired. Sign in again.');
  }
  // Sliding expiry: an active session stays alive, an idle one lapses.
  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400 * 1000) },
  });
  setRefreshCookie(res, token);
  res.json({
    accessToken: await signAccessToken(session.userId, session.id),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    ...(await profile(session.userId)),
  });
});

authRouter.post('/logout', async (req, res) => {
  requireClientHeader(req);
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token === 'string' && token) {
    await prisma.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await profile(userOf(req).id));
});

authRouter.patch('/me', requireAuth, async (req, res) => {
  const input = parse(z.object({ name }), req.body);
  await prisma.user.update({ where: { id: userOf(req).id }, data: { name: input.name } });
  res.json(await profile(userOf(req).id));
});

authRouter.post('/me/password', requireAuth, authLimiter, async (req, res) => {
  const input = parse(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userOf(req).id } });
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }),
    // Changing the password signs out every other device.
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: userOf(req).sessionId } }, data: { revokedAt: new Date() } }),
  ]);
  res.status(204).end();
});

authRouter.get('/me/sessions', requireAuth, async (req, res) => {
  const current = userOf(req);
  const sessions = await prisma.session.findMany({
    where: { userId: current.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  });
  res.json({ items: sessions.map((s) => ({ ...s, current: s.id === current.sessionId })) });
});

authRouter.delete('/me/sessions/:sessionId', requireAuth, async (req, res) => {
  const result = await prisma.session.updateMany({
    where: { id: param(req, 'sessionId'), userId: userOf(req).id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw notFound('Session');
  res.status(204).end();
});

authRouter.get('/me/login-history', requireAuth, async (req, res) => {
  const items = await prisma.loginEvent.findMany({
    where: { userId: userOf(req).id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, success: true, reason: true, ip: true, userAgent: true, createdAt: true },
  });
  res.json({ items });
});

const prefKey = z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/, 'Invalid preference key');

authRouter.get('/me/preferences/:key', requireAuth, async (req, res) => {
  const key = parse(prefKey, param(req, 'key'));
  const pref = await prisma.userPreference.findUnique({ where: { userId_key: { userId: userOf(req).id, key } } });
  res.json({ key, value: pref?.value ?? null });
});

authRouter.put('/me/preferences/:key', requireAuth, async (req, res) => {
  const key = parse(prefKey, param(req, 'key'));
  const body = parse(z.object({ value: z.unknown() }), req.body);
  if (JSON.stringify(body.value ?? null).length > 50_000) throw badRequest('Preference value is too large');
  const userId = userOf(req).id;
  const value = (body.value ?? null) as object;
  const pref = await prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value },
    update: { value },
  });
  res.json({ key, value: pref.value });
});

// ─── Invitations (public side) ───────────────────────────────────────────────

async function findInvitation(token: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { organization: { select: { id: true, name: true, deletedAt: true } }, role: { select: { id: true, name: true } } },
  });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date() || invitation.organization.deletedAt) {
    throw notFound('Invitation');
  }
  return invitation;
}

authRouter.get('/invitations/:token', authLimiter, async (req, res) => {
  const invitation = await findInvitation(param(req, 'token'));
  const existing = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
  res.json({
    email: invitation.email,
    organization: invitation.organization.name,
    role: invitation.role.name,
    accountExists: !!existing,
  });
});

authRouter.post('/invitations/:token/accept', authLimiter, async (req, res) => {
  const invitation = await findInvitation(param(req, 'token'));
  const input = parse(z.object({ name: name.optional(), password: z.string().min(1).max(200) }), req.body);
  let user = await prisma.user.findUnique({ where: { email: invitation.email } });

  if (user) {
    // Existing accounts must prove ownership before joining another organization.
    if (!(await verifyPassword(input.password, user.passwordHash))) throw unauthorized('Incorrect password');
    if (!user.isActive) throw forbidden('This account has been deactivated');
  } else {
    if (!input.name) throw badRequest('Name is required');
    parse(password, input.password);
    user = await prisma.user.create({
      data: { email: invitation.email, name: input.name, passwordHash: await hashPassword(input.password), lastLoginAt: new Date() },
    });
  }
  const userId = user.id;
  await prisma.$transaction([
    prisma.membership.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
      create: { organizationId: invitation.organizationId, userId, roleId: invitation.roleId },
      update: { roleId: invitation.roleId, status: 'ACTIVE' },
    }),
    prisma.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
  ]);
  await writeAudit({
    organizationId: invitation.organizationId,
    actorId: userId,
    actorLabel: user.name,
    action: 'member.joined',
    resourceType: 'member',
    resourceId: userId,
    resourceLabel: user.email,
    ip: clientIp(req),
  });
  const tokens = await startSession(req, res, userId);
  res.json({ ...tokens, ...(await profile(userId)) });
});
