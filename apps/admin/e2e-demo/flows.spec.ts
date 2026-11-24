import type { Locator, Page } from '@playwright/test';
import { BASE, ORG, backend, deliver, deliveryKey, expect, expectNoErrorState, expectToast, open, test, workspace } from './helpers';

/**
 * The core flows, end to end, in guest mode with no API: everything a visitor of the
 * static demo can do must really work against the in-browser backend.
 */

const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ENTRY_URL = (type: string) => new RegExp(`/content/${type}/(?!new$)[0-9a-f-]{36}$`);

const titleInput = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
const statusRow = (page: Page) => page.getByRole('heading', { name: 'Status', exact: true }).locator('xpath=..');
const rowAction = async (page: Page, name: string, item: string) => {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
};

/** Adds one field in the schema builder: type picker → settings panel → "Add field". */
async function addField(page: Page, typeName: RegExp, label: string, configure?: (drawer: Locator) => Promise<void>) {
  await page.getByRole('button', { name: 'Add field', exact: true }).first().click();
  await page.getByRole('dialog', { name: /Add a field/ }).getByRole('button', { name: typeName }).click();
  const drawer = page.locator('form').filter({ has: page.getByRole('heading', { name: /^New .+ field$/ }) });
  await drawer.getByRole('textbox', { name: 'Label', exact: true }).fill(label);
  if (configure) await configure(drawer);
  await drawer.getByRole('button', { name: 'Add field', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: `Edit field ${label}`, exact: true })).toBeVisible();
}

test('content: model a type, then create, publish, edit and restore an entry', async ({ page }) => {
  await open(page, `${BASE}/model/types`);
  await page.getByRole('button', { name: 'New content type' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New content type' });
  await dialog.getByRole('textbox', { name: 'Display name' }).fill('Recipes');
  await expect(dialog.getByRole('textbox', { name: 'API identifier' })).toHaveValue('recipes');
  await dialog.getByRole('button', { name: 'Create and add fields' }).click();
  await page.waitForURL(/\/model\/types\/recipes$/);

  await addField(page, /^Short text/, 'Title', async (drawer) => {
    await drawer.getByLabel('Required', { exact: true }).check();
  });
  await addField(page, /^Number/, 'Servings');
  await page.getByRole('button', { name: 'Review and save' }).click();
  const review = page.getByRole('dialog', { name: /Review changes to Recipes/ });
  await review.getByRole('button', { name: 'Save schema' }).click();
  await expectToast(page, 'Recipes schema saved');

  // A draft without its required title cannot be published: the error lands on the field.
  await open(page, `${BASE}/content/recipes/new`);
  await page.getByRole('spinbutton', { name: 'Servings' }).fill('4');
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await page.waitForURL(ENTRY_URL('recipes'));
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(titleInput(page)).toHaveAttribute('aria-invalid', 'true');

  await titleInput(page).fill('Lemon tart');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved at \d\d:\d\d/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expectToast(page, 'Published');
  await expect(statusRow(page)).toHaveText(/Published$/);

  const ws = await workspace(page);
  const key = await deliveryKey(page, ws);
  const live = async () => ((await deliver(page, key, '/recipes')).body.data as { title: string }[]).map((r) => r.title);
  expect(await live()).toEqual(['Lemon tart']);

  // Edits stay a draft until they are published again.
  await titleInput(page).fill('Lemon tart with thyme');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(statusRow(page)).toHaveText(/Modified$/);
  expect(await live()).toEqual(['Lemon tart']);
  await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  await expectToast(page, 'Changes published');
  expect(await live()).toEqual(['Lemon tart with thyme']);

  // Version history survives a reload, and an earlier version can be restored as the working copy.
  await page.reload();
  await expect(titleInput(page)).toHaveValue('Lemon tart with thyme');
  await expect(page.getByRole('tabpanel').getByText(/^Version \d+$/).first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select version 2', exact: true }).check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restore version 2?' }).getByRole('button', { name: 'Restore version' }).click();
  await expectToast(page, 'Restored version 2');
  await expect(titleInput(page)).toHaveValue('Lemon tart');
  expect(await live()).toEqual(['Lemon tart with thyme']);
});

test('approval: an article cannot go live until it is submitted and approved', async ({ page }) => {
  await open(page, `${BASE}/content/articles`);
  await page.getByRole('link', { name: 'Notes on the next release' }).click();
  await page.waitForURL(ENTRY_URL('articles'));
  await expect(statusRow(page)).toHaveText(/Draft$/);
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publish).toBeDisabled();
  await expect(page.getByText('Articles need approval before they can be published.')).toBeVisible();

  await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
  await expect(statusRow(page)).toHaveText(/In review$/);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const approve = page.getByRole('dialog', { name: 'Approve' });
  await approve.getByRole('textbox', { name: 'Note for the author (optional)' }).fill('Checked the dates');
  await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(statusRow(page)).toHaveText(/Approved$/);

  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(statusRow(page)).toHaveText(/Published$/);

  const ws = await workspace(page);
  const titles = ((await deliver(page, await deliveryKey(page, ws), '/articles?limit=50')).body.data as { title: string }[]).map((a) => a.title);
  expect(titles).toContain('Notes on the next release');

  // The review queue lists what is still waiting.
  await open(page, `${BASE}/publishing/workflows`);
  await expect(page.locator('main').getByText('Our approach to accessible color').first()).toBeVisible();
  await expectNoErrorState(page);
});

test('pages: build a page from blocks, publish it and deliver it by path', async ({ page }) => {
  const toolbar = page.getByRole('toolbar', { name: 'Page editor' });
  const leftPanel = page.getByRole('complementary', { name: 'Blocks and outline' });
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const canvas = page.getByLabel(/^Page canvas/);

  await open(page, `${BASE}/pages`);
  await page.getByRole('button', { name: 'New page' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title', { exact: true }).fill('Workshops');
  await expect(dialog.getByLabel('Slug', { exact: true })).toHaveValue('workshops');
  await dialog.getByRole('button', { name: 'Create and open editor' }).click();
  await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/);
  await expect(toolbar.getByLabel('Page title')).toHaveValue('Workshops');

  await leftPanel.getByRole('button', { name: 'Add Hero block', exact: true }).click();
  const hero = canvas.getByRole('group', { name: 'Hero block', exact: true });
  // A block is selected as soon as it is added, so the inspector already shows its fields.
  await inspector.getByLabel(/^Heading/).fill('Learn to bind your own notebook');
  await expect(hero.getByText('Learn to bind your own notebook')).toBeVisible();
  await leftPanel.getByRole('button', { name: 'Add Call to action block', exact: true }).click();
  await expect(canvas.getByRole('group', { name: / block$/ })).toHaveCount(2);

  await page.keyboard.press('Control+s');
  await expect(toolbar.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await toolbar.getByRole('button', { name: 'Publish', exact: true }).click();
  await expectToast(page, /is live at \/workshops/);

  const ws = await workspace(page);
  const delivered = await deliver(page, await deliveryKey(page, ws), '/pages?path=/workshops');
  expect(delivered.status).toBe(200);
  expect(delivered.body.data.blocks.map((b: { type: string }) => b.type)).toEqual(['hero', 'cta']);
  expect(delivered.body.data.blocks[0].props.heading).toBe('Learn to bind your own notebook');

  // The seeded home page opens with its nested block tree, and the page tree lists the new page.
  await open(page, `${BASE}/pages`);
  await expect(page.locator('main').getByText('Workshops').first()).toBeVisible();
  await page.locator('main').getByRole('link', { name: 'Home', exact: true }).first().click();
  await page.waitForURL(/\/pages\/[0-9a-f-]{36}$/);
  await expect(canvas.getByRole('group', { name: 'Section block', exact: true })).toBeVisible();
  await expect(canvas.getByRole('group', { name: 'Columns block', exact: true })).toBeVisible();
  await expect(canvas.getByText('Every Acme product starts with a year of daily use')).toBeVisible();
});

test('media: upload a file, describe it, reuse identical bytes and reject an oversized file', async ({ page }) => {
  const upload = async (file: { name: string; mimeType: string; buffer: Buffer }) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await (await chooser).setFiles(file);
  };
  const pixel = { name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL_PNG, 'base64') };

  await open(page, `${BASE}/media`);
  await expect(page.locator('main').getByText('hero-workspace.svg').first()).toBeVisible();
  await upload(pixel);
  await expectToast(page, /1 file uploaded/);
  const card = page.getByRole('button', { name: 'Open details of pixel.png' });
  await expect(card).toBeVisible();

  await card.click();
  const alt = page.getByRole('textbox', { name: 'Alt text', exact: true });
  await alt.fill('A single transparent pixel');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expectToast(page, 'File details saved');

  // Stored in the browser: after a reload the file and its details are still there.
  await page.reload();
  await expect(alt).toHaveValue('A single transparent pixel');
  await page.getByRole('button', { name: 'Close file details' }).click();

  await upload(pixel);
  await expectToast(page, /already in the library/);
  await expect(page.getByRole('button', { name: 'Open details of pixel.png' })).toHaveCount(1);

  // Larger than the guest-mode limit: refused with the API's own error.
  await upload({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.concat([pixel.buffer, Buffer.alloc(5 * 1024 * 1024 + 1)]) });
  await expect(page.getByText('File exceeds the maximum upload size').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open details of huge.png' })).toHaveCount(0);
});

test('releases: the seeded release validates and publishes its entries together', async ({ page }) => {
  await open(page, `${BASE}/publishing/releases`);
  await page.locator('main').getByRole('link', { name: /Spring launch/ }).first().click();
  await page.waitForURL(/\/publishing\/releases\/[0-9a-f-]{36}$/);
  const entries = page.getByRole('table', { name: 'Entries in this release' });
  await expect(entries.getByRole('link', { name: 'Pricing', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByText(/All 2 entries passed validation/)).toBeVisible();
  await page.getByRole('button', { name: 'Publish release' }).click();
  await page.getByRole('dialog', { name: /Publish “Spring launch”/ }).getByRole('button', { name: 'Publish release' }).click();
  await expectToast(page, 'Published “Spring launch”');

  const ws = await workspace(page);
  const key = await deliveryKey(page, ws);
  expect((await deliver(page, key, '/pages?path=/pricing')).status).toBe(200);
  expect(JSON.stringify((await deliver(page, key, '/articles?limit=50')).body)).toContain('Acme is hiring across design and engineering');
});

test('developers: a key is shown once, the explorer answers in the browser, GraphQL says it needs a server', async ({ page }) => {
  await open(page, `${BASE}/dev/keys`);
  await page.getByRole('button', { name: 'Create API key' }).first().click();
  const form = page.getByRole('dialog', { name: 'Create API key' });
  await form.getByLabel('Name', { exact: true }).fill('Kiosk display');
  await form.getByRole('button', { name: 'Create key' }).click();
  const created = page.getByRole('dialog', { name: 'API key created' });
  const secret = (await created.getByLabel('API key', { exact: true }).innerText()).trim();
  expect(secret.startsWith('mrd_ro_')).toBe(true);
  await expect(created.getByText(/generated in your browser and works only inside it/)).toBeVisible();
  await created.getByRole('button', { name: 'I have saved it' }).click();
  expect((await page.locator('body').innerText()).includes(secret)).toBe(false);
  expect((await deliver(page, secret, '/articles')).status).toBe(200);

  await rowAction(page, 'Kiosk display', 'Revoke');
  await page.getByRole('dialog', { name: /Revoke “Kiosk display”/ }).getByRole('button', { name: 'Revoke key' }).click();
  await expectToast(page, 'API key revoked');
  expect((await deliver(page, secret, '/articles')).status).toBe(401);

  await open(page, `${BASE}/dev/explorer`);
  await expect(page.getByText(/requests are answered inside your browser/)).toBeVisible();
  await page.getByRole('button', { name: 'Create a temporary key' }).click();
  await expectToast(page, /Temporary read-only key created/);
  const endpoints = page.getByRole('navigation', { name: 'Endpoints' });
  await endpoints.getByRole('button').filter({ hasText: 'GET' }).filter({ hasText: /\/articles(?!\/)/ }).first().click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('HTTP 200')).toBeVisible();
  await expect(page.locator('main')).toContainText('Design systems that survive contact with reality');
  // Private fields never appear in delivery output.
  await expect(page.locator('main')).not.toContainText('editorNotes');

  await page.getByRole('tab', { name: 'GraphQL' }).click();
  await page.getByRole('button', { name: /^Run/ }).click();
  await expect(page.locator('main')).toContainText('GraphQL is not available in guest mode');
});

test('webhooks: a test event is recorded as simulated, never as delivered', async ({ page }) => {
  await open(page, `${BASE}/dev/webhooks`);
  await expect(page.getByText(/Guest mode cannot call your endpoint/)).toBeVisible();
  await rowAction(page, 'Rebuild website', 'Send test event');
  await expectToast(page, 'Simulated test delivery recorded — nothing was sent');
  await page.getByRole('status').filter({ hasText: 'Simulated test delivery' }).getByRole('link', { name: 'View deliveries' }).click();
  await page.waitForURL(/\/dev\/webhooks\/[0-9a-f-]{36}$/);

  const ping = page.getByRole('row').filter({ hasText: /ping/ }).first();
  await expect(ping).toContainText('Simulated');
  await expect(ping).not.toContainText('Delivered');
  await ping.click();
  await expect(page.getByText(/no HTTP request left this browser/)).toBeVisible();
});

test('administration: roles, members, invitations, account and the audit log', async ({ page }) => {
  await open(page, `${ORG}/admin/users`);
  await page.getByRole('combobox', { name: 'Role of Tomás Silva' }).click();
  await page.getByRole('option', { name: 'Editor', exact: true }).click();
  await expectToast(page, 'Tomás Silva is now Editor');
  await rowAction(page, 'Hannah Weiss', 'Suspend access');
  await expectToast(page, 'Hannah Weiss was suspended');

  await page.getByRole('button', { name: /Invite/ }).first().click();
  const invite = page.getByRole('dialog');
  await invite.getByLabel(/Email/).fill('new.colleague@acme.example');
  await invite.getByRole('button', { name: /invit/i }).last().click();
  await expect(invite.getByText(/this invitation exists only in your browser/)).toBeVisible();
  await expect(invite.getByText(/http:\/\/localhost:5190\/accept-invite\?token=/)).toBeVisible();
  await invite.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('main').getByText('new.colleague@acme.example')).toBeVisible();

  await open(page, `${ORG}/admin/roles`);
  await page.getByRole('button', { name: 'New role' }).click();
  await page.getByLabel('Role name').fill('Translator');
  await page.getByRole('checkbox', { name: /content\.read/ }).check();
  await page.getByRole('checkbox', { name: /content\.update/ }).check();
  await page.getByRole('button', { name: 'Create role' }).click();
  await expectToast(page, 'Role “Translator” created');

  await open(page, `${ORG}/account`);
  await expect(page.getByText(/there is no account on a server behind it/)).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Curious Guest');
  await page.getByRole('button', { name: /Save/ }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /saved|updated/i }).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Current password' }).fill('whatever-it-was-1');
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('a-new-password-2026');
  await page.getByRole('textbox', { name: 'Confirm new password' }).fill('a-new-password-2026');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Changing the password is not available in guest mode/)).toBeVisible();

  // Everything above was recorded, attributed to the guest.
  await open(page, `${ORG}/admin/audit`);
  for (const text of ['Translator', 'new.colleague@acme.example', 'tomas@acme.example']) await expect(page.locator('main').getByText(text).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export/ }).first().click();
  expect((await download).suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('guest data survives a reload, and resetting restores the seed', async ({ page }) => {
  await open(page, `${ORG}/projects`);
  await page.getByRole('button', { name: /New project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/name/i).first().fill('Campaign microsite');
  await dialog.getByRole('button', { name: /Create project/ }).click();
  await expect(page.getByText('Campaign microsite').first()).toBeVisible();

  const ws = await workspace(page);
  expect((await backend(page, 'GET', `${ws.orgApi}/projects`)).body.items.length).toBe(2);

  await page.reload();
  await open(page, `${ORG}/projects`);
  await expect(page.locator('main').getByText('Campaign microsite').first()).toBeVisible();
  expect((await backend(page, 'GET', `${ws.orgApi}/projects`)).body.items.length).toBe(2);

  await page.getByRole('status', { name: 'Guest mode' }).getByRole('button', { name: 'Reset demo data' }).click();
  const confirm = page.getByRole('dialog', { name: 'Reset demo data?' });
  await expect(confirm).toContainText('cannot be undone');
  await confirm.getByRole('button', { name: 'Reset demo data' }).click();
  await expectToast(page, 'Demo data restored');
  await page.waitForURL(new RegExp(`${BASE}$`));

  await open(page, `${ORG}/projects`);
  await expect(page.locator('main').getByText('Acme Website').first()).toBeVisible();
  await expect(page.getByText('Campaign microsite')).toHaveCount(0);
  const fresh = await workspace(page);
  expect((await backend(page, 'GET', `${fresh.orgApi}/projects`)).body.items.length).toBe(1);
});

test('lists and tools: search, export, command palette, analytics and the integration wizard', async ({ page }) => {
  await open(page, `${BASE}/content/articles`);
  await page.getByRole('textbox', { name: /Search/ }).first().fill('headless');
  await expect(page.locator('main').getByRole('link', { name: 'Going headless without losing your editors' })).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: 'Our approach to accessible color' })).toHaveCount(0);
  await page.getByRole('textbox', { name: /Search/ }).first().fill('');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  expect((await download).suggestedFilename()).toBe('articles-export.json');

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog');
  await palette.getByRole('combobox').or(palette.getByRole('textbox')).first().fill('Graphite');
  await expect(palette.getByText('Graphite Notebook').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await open(page, `${BASE}/analytics`);
  await expect(page.locator('main').getByText('Website (production)').first()).toBeVisible();
  await expectNoErrorState(page);

  await open(page, `${BASE}/dev/integrations`);
  await expect(page.getByText(/a key made here works only inside this browser/)).toBeVisible();
  await expectNoErrorState(page);
});
