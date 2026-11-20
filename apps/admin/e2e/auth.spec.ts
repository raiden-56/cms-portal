import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';
import { API_URL, PASSWORD, type Api, type Workspace, apiFor, createDeliveryKey, createWorkspace, delivery, expectToast, open } from './helpers';

/**
 * Signing in and out, invitations, and what a restricted role can do.
 *
 * Three people take part, each in their own browser context: the administrator who creates the
 * organization, a new person who joins from an invitation link, and someone who already has an
 * account in another organization. Whatever the UI hides from a role is also attempted directly
 * against the management API, because hiding a button is not access control.
 *
 * Invitation tokens and passwords are never passed to `expect`, so a failure cannot print one.
 */
test.describe.configure({ mode: 'serial', timeout: 150_000 });

/** The dev server compiles each screen on first visit, so the first assertion after a navigation waits longer. */
const FIRST = { timeout: 30_000 };
const MEMBER_NAME = 'Morgan Writer';
const MEMBER_PASSWORD = 'member-password-2026';

let browser: Browser;
let adminContext: BrowserContext;
let admin: Page;
let ws: Workspace;
let api: Api;
let orgName = '';
let deliveryKey = '';

let memberContext: BrowserContext;
let member: Page;
let memberApi: Api;
let memberEmail = '';
let memberToken = '';
let memberEntryId = '';

test.beforeAll(async ({ browser: b }) => {
  test.setTimeout(180_000);
  browser = b;
  adminContext = await browser.newContext();
  admin = await adminContext.newPage();
  ws = await createWorkspace(admin, 'Auth');
  api = apiFor(admin);
  orgName = (await api.get('/auth/me')).memberships[0].organization.name;
  await api.post(`${ws.envApi}/content-types`, {
    apiId: 'articles',
    displayName: 'Articles',
    singularName: 'Article',
    pluralName: 'Articles',
    options: { titleField: 'title' },
    fields: [{ apiId: 'title', label: 'Title', type: 'text', required: true, config: {} }],
  });
  deliveryKey = await createDeliveryKey(admin, ws);
  memberEmail = `member-${ws.orgSlug}@example.test`.toLowerCase();
});

test.afterAll(async () => {
  await memberContext?.close();
  await adminContext?.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** HTTP status of a management API call made by a given person (200 when it succeeds). */
async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    await call;
    return 200;
  } catch (err) {
    const match = /→ (\d{3})/.exec((err as Error).message);
    if (!match) throw err;
    return Number(match[1]);
  }
}

/** Creates an invitation through the Users screen and returns the token from the link it shows. */
async function inviteThroughUi(email: string, roleName: string): Promise<string> {
  await open(admin, `${ws.orgBase}/admin/users`);
  await expect(admin.getByRole('button', { name: 'Invite member' }).first()).toBeEnabled(FIRST);
  await admin.getByRole('button', { name: 'Invite member' }).first().click();
  const form = admin.getByRole('dialog', { name: /Invite a member/ });
  await form.getByLabel('Email address').fill(email);
  await form.getByRole('combobox', { name: /Role/ }).click();
  await admin.getByRole('option', { name: roleName, exact: true }).click();
  await form.getByRole('button', { name: 'Create invitation' }).click();

  const ready = admin.getByRole('dialog', { name: 'Invitation ready' });
  await expect(ready).toBeVisible();
  await expect(ready.getByText(`They will join as ${roleName}`, { exact: false })).toBeVisible();
  const token = /\/accept-invite\?token=([A-Za-z0-9_-]+)/.exec(await ready.innerText())?.[1] ?? '';
  expect(token.length > 20, 'the dialog shows an invitation link').toBe(true);
  await ready.getByRole('button', { name: 'Done' }).click();
  await expect(ready).toBeHidden();
  return token;
}

const memberRow = () => admin.getByRole('table', { name: 'Members' }).getByRole('row', { name: new RegExp(MEMBER_NAME) });
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const title = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/);
}

// ─── 1. Sign out ─────────────────────────────────────────────────────────────

test('signing out ends the session, and protected pages lead to sign-in', async () => {
  await open(admin, `${ws.base}/content/articles`);
  await expect(admin.getByRole('heading', { name: 'Articles' })).toBeVisible(FIRST);

  // An access token issued before signing out must stop working too, not only the cookie.
  const refreshed = await admin.request.post(`${API_URL}/admin/api/auth/refresh`, { headers: { 'X-Meridian-Client': 'admin' } });
  const oldToken = (await refreshed.json()).accessToken as string;
  const before = await admin.request.get(`${API_URL}/admin/api/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } });
  expect(before.status()).toBe(200);

  await signOut(admin);
  await expect(admin.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  const after = await admin.request.get(`${API_URL}/admin/api/auth/me`, { headers: { Authorization: `Bearer ${oldToken}` } });
  expect(after.status()).toBe(401);
  const refreshAgain = await admin.request.post(`${API_URL}/admin/api/auth/refresh`, { headers: { 'X-Meridian-Client': 'admin' } });
  expect(refreshAgain.status()).toBe(401);

  await admin.goto(`${ws.base}/content/articles`);
  await admin.waitForURL(/\/login$/);
  await expect(admin.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(admin.getByRole('heading', { name: 'Articles' })).toHaveCount(0);
});

// ─── 2. Sign in ──────────────────────────────────────────────────────────────

test('sign-in validates its fields, rejects a wrong password and returns to the page asked for', async () => {
  // Still on the sign-in page that the protected content list redirected to.
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByText('Enter your email address')).toBeVisible();
  await expect(admin.getByText('Enter your password')).toBeVisible();

  await admin.getByLabel('Email').fill(ws.email);
  await admin.getByLabel('Password', { exact: true }).fill('not-the-password-1');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByRole('alert').filter({ hasText: 'Incorrect email or password' })).toBeVisible();
  expect(new URL(admin.url()).pathname).toBe('/login');

  // The password field can be revealed and hidden again.
  await admin.getByRole('button', { name: 'Show password' }).click();
  await expect(admin.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await admin.getByRole('button', { name: 'Hide password' }).click();
  await expect(admin.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');

  await admin.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.waitForURL((url) => url.pathname === `${ws.base}/content/articles`);
  await expect(admin.getByRole('heading', { name: 'Articles' })).toBeVisible(FIRST);

  // Both attempts are in the sign-in history, most recent first.
  const history = (await api.get('/auth/me/login-history')).items as { success: boolean; reason: string | null }[];
  expect(history[0].success).toBe(true);
  expect(history[1].success).toBe(false);
  expect(history[1].reason).toBe('invalid_credentials');

  // Someone who is signed in is sent past the sign-in page.
  await admin.goto('/login');
  await admin.waitForURL(/\/w\//);
});

// ─── 3. Accept an invitation ─────────────────────────────────────────────────

test('an invited person sets up an account from the link and joins with the invited role', async () => {
  memberToken = await inviteThroughUi(memberEmail, 'Author');

  memberContext = await browser.newContext();
  member = await memberContext.newPage();
  await member.goto(`/accept-invite?token=${memberToken}`);
  await expect(member.getByRole('heading', { name: `Join ${orgName}` })).toBeVisible(FIRST);
  await expect(member.getByText(memberEmail)).toBeVisible();
  await expect(member.getByText('Set up your account to accept.')).toBeVisible();

  await member.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(member.getByText('Enter your name')).toBeVisible();
  await member.getByLabel('Your name').fill(MEMBER_NAME);
  await member.getByLabel('Choose a password').fill('short1');
  await member.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(member.getByText('Use at least 10 characters')).toBeVisible();

  await member.getByLabel('Choose a password').fill(MEMBER_PASSWORD);
  await member.getByRole('button', { name: 'Accept invitation' }).click();
  await member.waitForURL(new RegExp(`/w/${ws.orgSlug}(/|$)`));
  await expect(mainNav(member)).toBeVisible(FIRST);
  memberApi = apiFor(member);

  const members = (await api.get(`${ws.orgApi}/members`)).items as any[];
  const joined = members.find((m) => m.user.email === memberEmail);
  expect(joined.user.name).toBe(MEMBER_NAME);
  expect(joined.role.key).toBe('author');
  expect(joined.status).toBe('ACTIVE');
  expect((await api.get(`${ws.orgApi}/invitations`)).items).toHaveLength(0);

  await admin.reload();
  await expect(memberRow()).toBeVisible(FIRST);
  await expect(memberRow()).toContainText('Active');
  await expect(admin.getByRole('combobox', { name: `Role of ${MEMBER_NAME}` })).toHaveText('Author');
  await expect(admin.getByText('No pending invitations')).toBeVisible();
});

test('an invitation link works once, and a revoked or made-up link is refused', async () => {
  const stranger = await browser.newContext();
  try {
    const page = await stranger.newPage();
    const invalid = page.getByRole('heading', { name: 'This invitation is no longer valid' });

    // The link that was just used.
    await page.goto(`/accept-invite?token=${memberToken}`);
    await expect(invalid).toBeVisible(FIRST);
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);

    // A link that was revoked before anyone used it.
    const viewer = (await api.get(`${ws.orgApi}/roles`)).items.find((r: { key: string }) => r.key === 'viewer');
    const invitation = await api.post(`${ws.orgApi}/invitations`, { email: `revoked-${ws.orgSlug}@example.test`, roleId: viewer.id });
    const revokedToken = new URL(invitation.inviteUrl).searchParams.get('token') ?? '';
    await page.goto(`/accept-invite?token=${revokedToken}`);
    await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
    await api.delete(`${ws.orgApi}/invitations/${invitation.id}`);
    await page.reload();
    await expect(invalid).toBeVisible();
    const accept = await page.request.post(`${API_URL}/admin/api/auth/invitations/${revokedToken}/accept`, { data: { name: 'Nobody', password: MEMBER_PASSWORD } });
    expect(accept.status()).toBe(404);

    // A made-up link, and no token at all.
    await page.goto('/accept-invite?token=not-a-real-invitation-token');
    await expect(invalid).toBeVisible();
    await page.goto('/accept-invite');
    await expect(invalid).toBeVisible();
    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await page.waitForURL(/\/login$/);
  } finally {
    await stranger.close();
  }
});

// ─── 4. Restricted roles ─────────────────────────────────────────────────────

test('an author can write and submit for review but cannot publish or reach admin areas', async () => {
  // Navigation only offers what the role allows.
  await open(member, ws.base);
  const nav = mainNav(member);
  await expect(nav.getByRole('link', { name: 'Content', exact: true })).toBeVisible(FIRST);
  await expect(nav.getByRole('link', { name: 'Media Library' })).toBeVisible();
  for (const hidden of ['API Keys', 'Integrations', 'Webhooks', 'Analytics', 'Audit Logs']) {
    await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
  }

  // Typing the address of a hidden screen does not get around it.
  await open(member, `${ws.base}/dev/keys`);
  await expect(member.getByText('You don’t have access to API keys')).toBeVisible(FIRST);
  await open(member, `${ws.orgBase}/admin/users`);
  await expect(member.getByText('Only organization administrators can invite people or change roles.')).toBeVisible(FIRST);
  await expect(member.getByRole('button', { name: 'Invite member' })).toHaveCount(0);
  await expect(member.getByRole('table', { name: 'Pending invitations' })).toHaveCount(0);

  // Writing is allowed.
  await open(member, `${ws.base}/content/articles`);
  await member.getByRole('link', { name: 'New article' }).first().click(FIRST);
  await expect(title(member)).toBeVisible(FIRST);
  await title(member).fill('Written by an author');
  await member.getByRole('button', { name: 'Create article' }).click();
  await expectToast(member, 'Article created');
  await member.waitForURL(/\/content\/articles\/(?!new$)[^/?#]+$/);
  memberEntryId = new URL(member.url()).pathname.split('/').pop() as string;

  // Publishing is not offered…
  await expect(member.getByRole('button', { name: 'Submit for review' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);

  // …and the server refuses it, along with everything else the role lacks.
  expect(await statusOf(memberApi.post(`${ws.envApi}/entry/${memberEntryId}/publish`))).toBe(403);
  expect(await statusOf(memberApi.post(`${ws.envApi}/entry/${memberEntryId}/schedule`, { publishAt: new Date(Date.now() + 3_600_000).toISOString() }))).toBe(403);
  expect(await statusOf(memberApi.delete(`${ws.envApi}/entry/${memberEntryId}`))).toBe(403);
  expect(await statusOf(memberApi.get(`${ws.projectApi}/tokens`))).toBe(403);
  expect(await statusOf(memberApi.get(`${ws.orgApi}/invitations`))).toBe(403);
  const adminRole = (await api.get(`${ws.orgApi}/roles`)).items.find((r: { key: string }) => r.key === 'org_admin');
  const self = (await api.get(`${ws.orgApi}/members`)).items.find((m: any) => m.user.email === memberEmail);
  expect(await statusOf(memberApi.patch(`${ws.orgApi}/members/${self.id}`, { roleId: adminRole.id })), 'a member cannot promote themselves').toBe(403);

  await member.getByRole('button', { name: 'Submit for review' }).click();
  await expectToast(member, 'Submitted for review');
  const entry = await api.get(`${ws.envApi}/entry/${memberEntryId}`);
  expect(entry.status).toBe('IN_REVIEW');
  expect(entry.isPublished).toBe(false);

  // Nothing reached the public API.
  const live = await delivery(admin, deliveryKey, '/articles');
  expect(live.status).toBe(200);
  expect(live.body.data).toHaveLength(0);
});

test('changing a member to Viewer makes their editor read-only', async () => {
  await open(admin, `${ws.orgBase}/admin/users`);
  await admin.getByRole('combobox', { name: `Role of ${MEMBER_NAME}` }).click(FIRST);
  await admin.getByRole('option', { name: 'Viewer', exact: true }).click();
  await expectToast(admin, `${MEMBER_NAME} is now Viewer`);

  // The server applies the new role to the member's very next request, before they reload anything.
  expect(await statusOf(memberApi.put(`${ws.envApi}/entry/${memberEntryId}`, { data: { title: 'Changed by a viewer' } }))).toBe(403);
  expect(await statusOf(memberApi.post(`${ws.envApi}/entries/articles`, { data: { title: 'Created by a viewer' } }))).toBe(403);
  expect(await statusOf(memberApi.get(`${ws.envApi}/entry/${memberEntryId}`))).toBe(200);

  await member.reload();
  await expect(member.getByText('You can view this article but your role does not allow editing it.')).toBeVisible(FIRST);
  await expect(title(member)).toHaveValue('Written by an author');
  await expect(title(member)).not.toBeEditable();
  await expect(member.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  await open(member, `${ws.base}/content/articles`);
  await expect(member.getByRole('link', { name: 'Written by an author' })).toBeVisible(FIRST);
  await expect(member.getByRole('link', { name: 'New article' })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'Import' })).toHaveCount(0);

  expect((await api.get(`${ws.envApi}/entry/${memberEntryId}`)).data.title).toBe('Written by an author');
});

// ─── 5. Suspending and removing ──────────────────────────────────────────────

test('a suspended member is locked out at once, and a removed member can only sign out', async () => {
  await open(admin, `${ws.orgBase}/admin/users`);
  await admin.getByRole('button', { name: `Actions for ${MEMBER_NAME}` }).click(FIRST);
  await admin.getByRole('menuitem', { name: 'Suspend access' }).click();
  await expectToast(admin, `${MEMBER_NAME} was suspended`);
  await expect(memberRow()).toContainText('Suspended');

  // Their open session stops working immediately; the organization simply no longer exists for them.
  expect([403, 404]).toContain(await statusOf(memberApi.get(`${ws.envApi}/entries/articles`)));
  expect([403, 404]).toContain(await statusOf(memberApi.get(`${ws.orgApi}/members`)));
  await member.goto(`${ws.base}/content/articles`);
  await member.waitForURL(/\/no-organization$/);
  await expect(member.getByText('You are not a member of any organization')).toBeVisible();
  await expect(member.getByText('Written by an author')).toHaveCount(0);

  // Reactivating restores access with the same role.
  await admin.getByRole('button', { name: `Actions for ${MEMBER_NAME}` }).click();
  await admin.getByRole('menuitem', { name: 'Reactivate' }).click();
  await expectToast(admin, `${MEMBER_NAME} was reactivated`);
  await member.goto('/');
  await member.waitForURL(new RegExp(`/w/${ws.orgSlug}(/|$)`));
  expect(await statusOf(memberApi.get(`${ws.envApi}/entries/articles`))).toBe(200);

  // Removing is permanent until they are invited again.
  await admin.getByRole('button', { name: `Actions for ${MEMBER_NAME}` }).click();
  await admin.getByRole('menuitem', { name: 'Remove from organization' }).click();
  await admin.getByRole('dialog', { name: `Remove ${MEMBER_NAME}?` }).getByRole('button', { name: 'Remove member' }).click();
  await expectToast(admin, `${MEMBER_NAME} was removed`);
  await expect(memberRow()).toHaveCount(0);
  expect((await api.get(`${ws.orgApi}/members`)).items.some((m: any) => m.user.email === memberEmail)).toBe(false);

  await member.goto(`${ws.base}/content/articles`);
  await member.waitForURL(/\/no-organization$/);
  await expect(member.getByText('You are not a member of any organization')).toBeVisible();
  expect([403, 404]).toContain(await statusOf(memberApi.get(`${ws.envApi}/entries/articles`)));

  // They are not stranded there: the page says who is signed in and lets them sign out.
  await expect(member.getByText(memberEmail)).toBeVisible();
  await member.getByRole('button', { name: 'Sign out' }).click();
  await member.waitForURL(/\/login$/);
  const refresh = await member.request.post(`${API_URL}/admin/api/auth/refresh`, { headers: { 'X-Meridian-Client': 'admin' } });
  expect(refresh.status()).toBe(401);
});

// ─── 6. Someone who already has an account ───────────────────────────────────

test('an existing account accepts with its own password and can switch between organizations', async () => {
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const own = await createWorkspace(guest, 'Guest');
    const guestApi = apiFor(guest);

    // Before joining, the other organization is invisible to them — in the UI and through the API.
    await guest.goto(`${ws.base}/content/articles`);
    await guest.waitForURL(new RegExp(`/w/${own.orgSlug}(/|$)`));
    expect(await statusOf(guestApi.get(`${ws.envApi}/entries/articles`))).toBe(404);
    expect(await statusOf(guestApi.get(`${ws.orgApi}/members`))).toBe(404);

    const token = await inviteThroughUi(own.email, 'Editor');
    await guest.goto(`/accept-invite?token=${token}`);
    await expect(guest.getByRole('heading', { name: `Join ${orgName}` })).toBeVisible(FIRST);
    await expect(guest.getByText('Enter your existing password to accept.')).toBeVisible();
    await expect(guest.getByLabel('Your name')).toHaveCount(0);

    // Holding the link is not enough: the account's own password is required.
    await guest.getByLabel('Password', { exact: true }).fill('not-the-password-1');
    await guest.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(guest.getByRole('alert').filter({ hasText: 'Incorrect password' })).toBeVisible();
    expect((await api.get(`${ws.orgApi}/members`)).items.some((m: any) => m.user.email === own.email)).toBe(false);

    await guest.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await guest.getByRole('button', { name: 'Accept invitation' }).click();
    await guest.waitForURL(/\/w\//);

    // Both organizations are in the account menu; switching shows the other one's content.
    await guest.getByRole('button', { name: 'Account menu' }).click(FIRST);
    const menu = guest.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: orgName })).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveCount(4); // two organizations, Account & security, Sign out
    await menu.getByRole('menuitem', { name: orgName }).click();
    await guest.waitForURL(new RegExp(`/w/${ws.orgSlug}(/|$)`));
    await open(guest, `${ws.base}/content/articles`);
    await expect(guest.getByRole('heading', { name: 'Articles' })).toBeVisible(FIRST);
    await expect(guest.getByRole('link', { name: 'Written by an author' })).toBeVisible();

    // The role is per organization: Editor here (no publishing), administrator at home.
    await guest.getByRole('button', { name: 'Account menu' }).click();
    await expect(guest.getByRole('menu')).toContainText(`${own.email} · Editor`);
    await guest.keyboard.press('Escape');
    expect(await statusOf(guestApi.post(`${ws.envApi}/entry/${memberEntryId}/publish`))).toBe(403);
    expect(await statusOf(guestApi.get(`${ws.orgApi}/invitations`))).toBe(403);
    expect(await statusOf(guestApi.get(`${own.orgApi}/invitations`))).toBe(200);
  } finally {
    await guestContext.close();
  }
});
