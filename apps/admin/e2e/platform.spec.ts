import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { type Api, type Workspace, apiFor, createDeliveryKey, createWorkspace, delivery, expectToast, open } from './helpers';

/**
 * Platform screens: API keys, releases, webhooks, users, roles, settings, account, audit log,
 * API explorer and scheduled content. Everything is driven through the UI of one fresh
 * organization; only supporting data is created through the management API.
 *
 * Secrets (API keys, signing secrets, invitation tokens) are only ever compared as booleans so
 * that a failing assertion never prints one.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

/** The dev server compiles each screen on first visit, so the first assertion after a navigation waits longer. */
const FIRST = { timeout: 30_000 };

let context: BrowserContext;
let page: Page;
let ws: Workspace;
let api: Api;
const seeded: { id: string; documentId: string }[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  context = await browser.newContext();
  page = await context.newPage();
  ws = await createWorkspace(page, 'Platform');
  api = apiFor(page);
  await api.post(`${ws.envApi}/content-types`, {
    apiId: 'articles',
    displayName: 'Articles',
    singularName: 'Article',
    pluralName: 'Articles',
    options: { titleField: 'title' },
    fields: [{ apiId: 'title', label: 'Title', type: 'text', required: true, config: {} }],
  });
  for (const title of ['First', 'Second']) seeded.push(await api.post(`${ws.envApi}/entries/articles`, { data: { title } }));
});

test.afterAll(async () => {
  await context?.close();
});

/** Opens the "…" menu of a table row and chooses one of its items. */
async function rowAction(name: string, item: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

/** Reads a secret out of the "shown only once" dialog without ever printing it. */
async function readSecret(dialogTitle: string, label: string): Promise<string> {
  const dialog = page.getByRole('dialog', { name: dialogTitle });
  await expect(dialog).toBeVisible();
  const secret = (await dialog.getByLabel(label, { exact: true }).innerText()).trim();
  await dialog.getByRole('button', { name: 'I have saved it' }).click();
  await expect(dialog).toBeHidden();
  return secret;
}

test('API keys: the secret is shown once, and rotating or revoking cuts off access', async () => {
  await open(page, `${ws.base}/dev/keys`);
  await expect(page.getByRole('button', { name: 'Create API key' }).first()).toBeVisible(FIRST);

  await page.getByRole('button', { name: 'Create API key' }).first().click();
  const form = page.getByRole('dialog', { name: 'Create API key' });
  await form.getByLabel('Name', { exact: true }).fill('Website key');
  await expect(form.getByRole('radio', { name: /Read-only/ })).toBeChecked();
  await form.getByRole('button', { name: 'Create key' }).click();

  // The secret is displayed in the dialog and works against the delivery API.
  const created = page.getByRole('dialog', { name: 'API key created' });
  await expect(created).toBeVisible();
  const first = (await created.getByLabel('API key', { exact: true }).innerText()).trim();
  expect(first.startsWith('mrd_ro_')).toBe(true);
  expect(first.length).toBeGreaterThan(20);
  expect((await delivery(page, first, '/articles')).status).toBe(200);
  await created.getByRole('button', { name: 'I have saved it' }).click();
  await expect(created).toBeHidden();

  // The list shows the key, but only its prefix.
  const row = page.getByRole('row', { name: /Website key/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('mrd_ro_');
  await expect(row).toContainText('Active');
  expect((await page.content()).includes(first)).toBe(false);
  expect((await page.locator('body').innerText()).includes(first)).toBe(false);

  // Rotating issues a new secret and the old one stops working.
  await rowAction('Website key', 'Rotate secret');
  await page.getByRole('dialog', { name: /Rotate “Website key”/ }).getByRole('button', { name: 'Rotate key' }).click();
  const second = await readSecret('New secret issued', 'API key');
  expect(second.startsWith('mrd_ro_')).toBe(true);
  expect(second === first).toBe(false);
  expect((await delivery(page, first, '/articles')).status).toBe(401);
  expect((await delivery(page, second, '/articles')).status).toBe(200);

  // Revoking cuts off the new secret too.
  await rowAction('Website key', 'Revoke');
  await page.getByRole('dialog', { name: /Revoke “Website key”/ }).getByRole('button', { name: 'Revoke key' }).click();
  await expectToast(page, 'API key revoked');
  await expect(row).toContainText('Revoked');
  expect((await delivery(page, second, '/articles')).status).toBe(401);
});

test('Releases: entries added to a release are validated and published together', async () => {
  await open(page, `${ws.base}/publishing/releases`);
  await expect(page.getByRole('button', { name: 'New release' }).first()).toBeVisible(FIRST);

  await page.getByRole('button', { name: 'New release' }).first().click();
  const form = page.getByRole('dialog', { name: 'New release' });
  await form.getByRole('textbox', { name: /Name/ }).fill('Spring launch');
  await form.getByRole('button', { name: 'Create release' }).click();
  await expectToast(page, 'Created “Spring launch”');

  // Creating a release opens it.
  await page.waitForURL(/\/publishing\/releases\/[^/]+$/);
  const releaseId = new URL(page.url()).pathname.split('/').pop() as string;
  await expect(page.getByRole('button', { name: 'Add entries' }).first()).toBeVisible(FIRST);
  await expect(page.getByText('This release is empty')).toBeVisible();

  await page.getByRole('button', { name: 'Add entries' }).first().click();
  const picker = page.getByRole('dialog', { name: /Add entries to/ });
  await picker.getByRole('checkbox', { name: 'First', exact: true }).check();
  await picker.getByRole('checkbox', { name: 'Second', exact: true }).check();
  await picker.getByRole('button', { name: 'Add 2 entries' }).click();
  await expectToast(page, 'Added 2 entries to the release');

  const entries = page.getByRole('table', { name: 'Entries in this release' });
  await expect(entries.getByRole('link', { name: 'First', exact: true })).toBeVisible();
  await expect(entries.getByRole('link', { name: 'Second', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText(/All 2 entries passed validation/)).toBeVisible();
  await expect(entries.getByText('Ready', { exact: true })).toHaveCount(2);

  await page.getByRole('button', { name: 'Publish release' }).click();
  await page.getByRole('dialog', { name: /Publish “Spring launch”/ }).getByRole('button', { name: 'Publish release' }).click();
  await expectToast(page, 'Published “Spring launch”');
  await expect(page.getByText(/This release is now a record of what went live/)).toBeVisible();
  await expect(page.locator('main').getByText('Published', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate' })).toHaveCount(0);
  expect((await api.get(`${ws.envApi}/releases/${releaseId}`)).status).toBe('PUBLISHED');

  // Both articles are now served by the public API.
  const key = await createDeliveryKey(page, ws);
  const live = await delivery(page, key, '/articles');
  expect(live.status).toBe(200);
  const body = JSON.stringify(live.body);
  expect(body).toContain('"First"');
  expect(body).toContain('"Second"');
});

test('Webhooks: create, send a test event, read the delivery log, pause and delete', async () => {
  await open(page, `${ws.base}/dev/webhooks`);
  await expect(page.getByText('No webhooks in this environment')).toBeVisible(FIRST);

  await page.getByRole('button', { name: 'Create webhook' }).first().click();
  const form = page.getByRole('dialog', { name: 'Create webhook' });
  await form.getByLabel('Name', { exact: true }).fill('Site hook');
  await form.getByLabel('Endpoint URL').fill('http://127.0.0.1:9/hook');
  await form.getByRole('checkbox', { name: /^content\.published/ }).check();
  await form.getByRole('button', { name: 'Create webhook' }).click();

  const secret = await readSecret('Webhook created', 'signing secret');
  expect(secret.startsWith('whsec_')).toBe(true);
  expect((await page.content()).includes(secret)).toBe(false);

  const row = page.getByRole('row', { name: /Site hook/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText('http://127.0.0.1:9/hook');
  await expect(row).toContainText('content.published');

  const [queued] = await Promise.all([
    page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname.endsWith('/test')),
    rowAction('Site hook', 'Send test event'),
  ]);
  expect(queued.status(), await queued.text()).toBe(202);
  await expectToast(page, 'Test event queued');

  // Nothing listens on that port, so the delivery cannot succeed. The confirmation links to the log.
  await page.getByRole('status').filter({ hasText: 'Test event queued' }).getByRole('link', { name: 'View deliveries' }).click();
  await page.waitForURL(/\/dev\/webhooks\/[^/]+$/);
  await expect(page.getByText('Delivery log')).toBeVisible(FIRST);
  const ping = page.getByRole('row').filter({ hasText: /ping/ }).first();
  await expect(ping).toBeVisible({ timeout: 15_000 });
  await expect(ping).toContainText(/Failed|Retrying/, { timeout: 60_000 });

  await page.getByRole('link', { name: 'All webhooks' }).click();
  await expect(row).toBeVisible();
  await page.getByLabel('Pause Site hook').click();
  await expectToast(page, 'Webhook paused');
  await expect(page.getByLabel('Activate Site hook')).not.toBeChecked();
  expect((await api.get(`${ws.envApi}/webhooks`)).items[0].isActive).toBe(false);

  await rowAction('Site hook', 'Delete');
  await page.getByRole('dialog', { name: /Delete “Site hook”/ }).getByRole('button', { name: 'Delete webhook' }).click();
  await expectToast(page, 'Webhook deleted');
  await expect(page.getByText('No webhooks in this environment')).toBeVisible();
});

test('Users: an invitation produces a link, is listed as pending and can be revoked', async () => {
  await open(page, `${ws.orgBase}/admin/users`);
  await expect(page.getByRole('button', { name: 'Invite member' }).first()).toBeEnabled(FIRST);

  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const form = page.getByRole('dialog', { name: /Invite a member/ });
  await form.getByLabel('Email address').fill('invitee@example.test');
  await form.getByRole('combobox', { name: /Role/ }).click();
  await page.getByRole('option', { name: 'Viewer', exact: true }).click();
  await form.getByRole('button', { name: 'Create invitation' }).click();

  const ready = page.getByRole('dialog', { name: 'Invitation ready' });
  await expect(ready).toBeVisible();
  expect((await ready.innerText()).includes('/accept-invite?token=')).toBe(true);
  await expect(ready.getByText(/They will join as Viewer/)).toBeVisible();
  await ready.getByRole('button', { name: 'Done' }).click();
  await expect(ready).toBeHidden();

  const pending = page.getByRole('table', { name: 'Pending invitations' });
  const invitation = pending.getByRole('row', { name: /invitee@example\.test/ });
  await expect(invitation).toBeVisible();
  await expect(invitation).toContainText('Viewer');

  await invitation.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('dialog', { name: 'Revoke this invitation?' }).getByRole('button', { name: 'Revoke' }).click();
  await expectToast(page, 'Invitation revoked');
  await expect(page.getByText('No pending invitations')).toBeVisible();
  await expect(pending).toHaveCount(0);
});

test('Roles: a custom role keeps the permissions it was created with and can be deleted', async () => {
  await open(page, `${ws.orgBase}/admin/roles`);
  await expect(page.getByRole('button', { name: 'New role' })).toBeVisible(FIRST);

  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Role name').fill('Translator');
  await page.getByRole('checkbox', { name: /content\.read/ }).check();
  await page.getByRole('checkbox', { name: /content\.update/ }).check();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expectToast(page, 'Role “Translator” created');

  const roles = page.getByRole('navigation', { name: 'Roles' });
  const translator = roles.getByRole('button', { name: /Translator/ });
  await expect(translator).toBeVisible();
  await expect(translator).toContainText('2 permissions');
  await expect(translator).toHaveAttribute('aria-current', 'true');
  await expect(page.getByLabel('Role name')).toHaveValue('Translator');
  await expect(page.getByRole('checkbox', { name: /content\.read/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /content\.update/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /content\.delete/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /content\.publish/ })).not.toBeChecked();
  const saved = (await api.get(`${ws.orgApi}/roles`)).items.find((r: { name: string }) => r.name === 'Translator');
  expect([...saved.permissions].sort()).toEqual(['content.read', 'content.update']);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: /Delete the role “Translator”/ }).getByRole('button', { name: 'Delete role' }).click();
  await expectToast(page, 'Role deleted');
  await expect(roles.getByRole('button', { name: /Translator/ })).toHaveCount(0);
});

test('Settings: a locale can be added and the project renamed', async () => {
  await open(page, `${ws.orgBase}/admin/settings`);
  await expect(page.getByRole('tab', { name: 'Locales' })).toBeVisible(FIRST);

  await page.getByRole('tab', { name: 'Locales' }).click();
  await page.getByRole('button', { name: 'Add locale' }).click();
  const form = page.getByRole('dialog', { name: 'Add a locale' });
  await form.getByLabel('Code', { exact: true }).fill('fr');
  await form.getByLabel('Name', { exact: true }).fill('French');
  await form.getByRole('button', { name: 'Add locale' }).click();
  await expectToast(page, 'Locale “fr” added');

  const french = page.getByRole('table', { name: 'Locales' }).getByRole('row', { name: /French/ });
  await expect(french).toBeVisible();
  await expect(french.getByText('fr', { exact: true })).toBeVisible();
  const locales = await api.get(`${ws.projectApi}/locales`);
  expect(locales.items.map((l: { code: string }) => l.code)).toContain('fr');
  expect(locales.items.find((l: { code: string }) => l.code === 'fr').name).toBe('French');

  await page.getByRole('tab', { name: 'Project', exact: true }).click();
  const renamed = 'Platform Site Renamed';
  await page.getByLabel('Project name').fill(renamed);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expectToast(page, 'Project settings saved');
  await expect(page.getByLabel('Project name')).toHaveValue(renamed);

  // The sidebar project switcher picks up the new name without a reload.
  await page.getByRole('button', { name: 'Switch project' }).click();
  await expect(page.getByRole('menuitem', { name: renamed })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: renamed })).toBeHidden();
});

test('Account: a changed display name is saved', async () => {
  await open(page, `${ws.orgBase}/account`);
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Platform Tester', FIRST);

  await name.fill('Platform Renamed');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expectToast(page, 'Profile updated');
  expect((await api.get('/auth/me')).user.name).toBe('Platform Renamed');

  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Platform Renamed', FIRST);
});

test('Audit log: lists the actions above, filters by area and exports CSV', async () => {
  await open(page, `${ws.orgBase}/admin/audit`);
  const table = page.getByRole('table', { name: 'Audit log' });
  await expect(table).toBeVisible(FIRST);
  const rows = table.locator('tbody tr');
  await expect(rows.filter({ hasText: 'release.' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'token.' }).first()).toBeVisible();
  const all = await rows.count();

  await page.getByRole('combobox', { name: 'Area' }).click();
  await page.getByRole('option', { name: 'Releases', exact: true }).click();
  await expect(page).toHaveURL(/action=release/);
  await expect(rows.filter({ hasNotText: 'release.' })).toHaveCount(0);
  await expect(rows.first()).toBeVisible();
  const releasesOnly = await rows.count();
  expect(releasesOnly).toBeGreaterThan(0);
  expect(releasesOnly).toBeLessThan(all);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await expectToast(page, 'Audit log exported');
});

test('API explorer: a temporary key sends a real request and shows the JSON response', async () => {
  // What the delivery API answers for the same request, to compare the displayed response against.
  const direct = await delivery(page, await createDeliveryKey(page, ws), '/articles');
  expect(direct.status).toBe(200);
  const fields = Object.keys(direct.body);
  expect(fields.length).toBeGreaterThan(0);

  await open(page, `${ws.base}/dev/explorer`);
  await expect(page.getByRole('button', { name: 'Create a temporary key' })).toBeVisible(FIRST);
  await page.getByRole('button', { name: 'Create a temporary key' }).click();
  await expectToast(page, /Temporary read-only key created/);

  const endpoints = page.getByRole('navigation', { name: 'Endpoints' });
  await endpoints.getByRole('button').filter({ hasText: 'GET' }).filter({ hasText: /\/articles(?!\/)/ }).first().click();
  await expect(page.getByLabel('Request URL')).toContainText(/\/articles(?!\/)/);

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('HTTP 200')).toBeVisible({ timeout: 15_000 });
  for (const field of fields) await expect(page.locator('main')).toContainText(`"${field}"`);
});

test('Scheduled content: a scheduled entry is listed and its schedule can be cancelled', async () => {
  const entry = await api.post(`${ws.envApi}/entries/articles`, { data: { title: 'Scheduled piece' } });
  const publishAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await api.post(`${ws.envApi}/entry/${entry.id}/schedule`, { publishAt });

  await open(page, `${ws.base}/publishing/scheduled`);
  const slot = page.getByRole('listitem').filter({ hasText: 'Scheduled piece' });
  await expect(slot).toBeVisible(FIRST);
  await expect(slot).toContainText('Publish');
  await expect(page.getByText('1 upcoming')).toBeVisible();

  await slot.getByRole('button', { name: 'Cancel the scheduled publish of Scheduled piece' }).click();
  await page.getByRole('dialog', { name: 'Cancel this scheduled publish?' }).getByRole('button', { name: 'Cancel schedule' }).click();
  await expectToast(page, /Cancelled the scheduled publish/);
  await expect(page.getByText('Nothing is scheduled')).toBeVisible();
  await expect(slot).toHaveCount(0);
  expect((await api.get(`${ws.envApi}/scheduled`)).items).toHaveLength(0);
});
