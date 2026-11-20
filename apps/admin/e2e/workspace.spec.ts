import { deflateSync } from 'node:zlib';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { API_URL, type Api, type Workspace, apiFor, createDeliveryKey, createWorkspace, delivery, expectToast, open } from './helpers';

/**
 * Screens around the content itself: release scheduling, the integration wizard, media
 * replace-in-place and bulk actions, dashboard layout, analytics, SDK documentation, the
 * command palette, the dark theme and small screens.
 *
 * Everything is driven through the UI of one fresh organization and checked against the API.
 * Secrets are only ever compared as booleans, so a failing assertion never prints one.
 */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

/** The dev server compiles each screen on first visit, so the first assertion after a navigation waits longer. */
const FIRST = { timeout: 30_000 };
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** A complete API key; documentation placeholders such as `mrd_ro_your_key` are too short to match. */
const REAL_KEY = /mrd_(ro|rw|pv)_[A-Za-z0-9_-]{16,}/;

let context: BrowserContext;
let page: Page;
let ws: Workspace;
let api: Api;
let launch: { id: string };
let roadmap: { id: string };
let changelog: { id: string };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  context = await browser.newContext({ viewport: DESKTOP });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  page = await context.newPage();
  ws = await createWorkspace(page, 'Workspace');
  api = apiFor(page);
  await api.post(`${ws.envApi}/content-types`, {
    apiId: 'articles',
    displayName: 'Articles',
    singularName: 'Article',
    pluralName: 'Articles',
    options: { titleField: 'title' },
    fields: [{ apiId: 'title', label: 'Title', type: 'text', required: true, config: {} }],
  });
  launch = await api.post(`${ws.envApi}/entries/articles`, { data: { title: 'Launch notes' } });
  roadmap = await api.post(`${ws.envApi}/entries/articles`, { data: { title: 'Roadmap' } });
  changelog = await api.post(`${ws.envApi}/entries/articles`, { data: { title: 'Changelog' } });
  await api.post(`${ws.envApi}/entry/${launch.id}/publish`);
});

test.afterAll(async () => {
  await context?.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const main = () => page.locator('main');
const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A whole-minute time a number of days from now, in the timezone the browser and this process share. */
function daysAhead(days: number, hour: number, minute: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}
/** The value a `datetime-local` input expects. */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** How the admin prints a date and time, e.g. "4 Dec 2026, 10:30". */
const shown = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// A tiny PNG encoder, so each uploaded file has different bytes (identical uploads are deduplicated).
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** A square PNG of one solid colour. */
function png(size: number, rgb: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const row = Buffer.from([0, ...Array.from({ length: size * 3 }, (_, i) => rgb[i % 3])]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}
const imageFile = (name: string, size: number, rgb: [number, number, number]) => ({ name, mimeType: 'image/png', buffer: png(size, rgb) });

interface Asset {
  id: string;
  filename: string;
  checksum: string;
  revision: number;
  url: string;
  width: number | null;
  height: number | null;
  size: number;
  folderId: string | null;
  tags: string[];
}
const listMedia = async (query = ''): Promise<Asset[]> => (await api.get(`${ws.projectApi}/media${query}`)).items;
const assetNamed = async (filename: string): Promise<Asset> => {
  const found = (await listMedia()).find((a) => a.filename === filename);
  expect(found, `${filename} in the media library`).toBeTruthy();
  return found as Asset;
};
const card = (filename: string) => page.getByRole('button', { name: `Open details of ${filename}` });
const selectFile = (filename: string) => page.getByRole('checkbox', { name: `Select ${filename}`, exact: true }).check();

/** Neither the page as a whole nor its scrolling content area may scroll sideways. */
async function expectNoSidewaysScroll(where: string) {
  const sizes = await page.evaluate(() => {
    const content = document.querySelector('main');
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      content: content ? content.scrollWidth - content.clientWidth : 0,
    };
  });
  expect(sizes.page, `${where}: the page is wider than the screen`).toBeLessThanOrEqual(0);
  expect(sizes.content, `${where}: the content area scrolls sideways`).toBeLessThanOrEqual(0);
}

const bodyBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT_BACKGROUND = 'rgb(247, 247, 245)';
const DARK_BACKGROUND = 'rgb(18, 18, 17)';

const palette = () => page.getByRole('dialog', { name: 'Search and commands' });
const paletteInput = () => page.getByRole('combobox', { name: 'Search content or jump to' });
/** Opens the palette with the keyboard shortcut. The search box must end up focused, so that typing just works. */
async function openPalette() {
  await page.keyboard.press('Control+k');
  await expect(palette()).toBeVisible();
  await expect(paletteInput()).toBeFocused();
}

// ─── Releases ────────────────────────────────────────────────────────────────

test('Release scheduling: schedule for a future time, reschedule, and unschedule', async () => {
  const release = await api.post(`${ws.envApi}/releases`, { name: 'Autumn launch' });
  await api.post(`${ws.envApi}/releases/${release.id}/items`, { entryIds: [roadmap.id, changelog.id] });
  const releaseApi = `${ws.envApi}/releases/${release.id}`;

  await open(page, `${ws.base}/publishing/releases/${release.id}`);
  await expect(page.getByRole('heading', { name: 'Autumn launch' })).toBeVisible(FIRST);
  await expect(main().getByText('Open', { exact: true })).toBeVisible();

  // A time in the past is refused before anything is sent.
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule release' });
  const publishAt = dialog.getByLabel('Publish at');
  await expect(publishAt).not.toHaveValue('');
  await publishAt.fill('2020-01-01T09:00');
  await dialog.getByRole('button', { name: 'Schedule release' }).click();
  await expect(dialog.getByText('Choose a time in the future')).toBeVisible();
  expect((await api.get(releaseApi)).status).toBe('OPEN');

  const first = daysAhead(3, 10, 30);
  await publishAt.fill(localInput(first));
  await dialog.getByRole('button', { name: 'Schedule release' }).click();
  await expectToast(page, `Scheduled for ${shown(first)}`);
  await expect(dialog).toBeHidden();

  await expect(main().getByText('Scheduled', { exact: true })).toBeVisible();
  await expect(main().getByText(/Scheduled to publish on/)).toContainText(shown(first));
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish now' })).toBeVisible();
  let saved = await api.get(releaseApi);
  expect(saved.status).toBe('SCHEDULED');
  expect(new Date(saved.scheduledAt).getTime()).toBe(first.getTime());

  // The scheduled-content screen lists it and links back to the release.
  await open(page, `${ws.base}/publishing/scheduled`);
  const upcoming = page.getByRole('list', { name: 'Scheduled releases' }).getByRole('listitem').filter({ hasText: 'Autumn launch' });
  await expect(upcoming).toBeVisible(FIRST);
  await expect(upcoming).toContainText('2 entries');
  await expect(upcoming).toContainText(shown(first));
  await upcoming.getByRole('link', { name: 'Autumn launch' }).click();
  await page.waitForURL(new RegExp(`/publishing/releases/${release.id}$`));

  // Rescheduling starts from the current time and replaces it.
  await page.getByRole('button', { name: 'Reschedule' }).click();
  const again = page.getByRole('dialog', { name: 'Reschedule release' });
  await expect(again.getByLabel('Publish at')).toHaveValue(localInput(first));
  const second = daysAhead(5, 14, 15);
  await again.getByLabel('Publish at').fill(localInput(second));
  await again.getByRole('button', { name: 'Save new time' }).click();
  await expectToast(page, `Scheduled for ${shown(second)}`);
  await expect(main().getByText(/Scheduled to publish on/)).toContainText(shown(second));
  saved = await api.get(releaseApi);
  expect(new Date(saved.scheduledAt).getTime()).toBe(second.getTime());

  await page.getByRole('button', { name: 'Unschedule' }).click();
  await page.getByRole('dialog', { name: 'Unschedule this release?' }).getByRole('button', { name: 'Unschedule' }).click();
  await expectToast(page, 'Release unscheduled');
  await expect(main().getByText('Open', { exact: true })).toBeVisible();
  await expect(main().getByText(/Scheduled to publish on/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible();
  saved = await api.get(releaseApi);
  expect(saved.status).toBe('OPEN');
  expect(saved.scheduledAt).toBeNull();

  await open(page, `${ws.base}/publishing/scheduled`);
  await expect(page.getByText('No releases are scheduled')).toBeVisible(FIRST);

  // Scheduling and unscheduling never published anything.
  const live = await delivery(page, await createDeliveryKey(page, ws), '/articles');
  expect(live.status).toBe(200);
  const body = JSON.stringify(live.body);
  expect(body).toContain('"Launch notes"');
  expect(body).not.toContain('"Roadmap"');
  expect(body).not.toContain('"Changelog"');
});

// ─── Integrations ────────────────────────────────────────────────────────────

test('Integration wizard: every step, a working key, and the secret is shown only inside the wizard', async () => {
  await open(page, `${ws.base}/dev/integrations`);
  const step = (title: string) => page.getByRole('heading', { name: title });
  const next = page.getByRole('button', { name: 'Continue' });
  await expect(step('1. Choose your framework')).toBeVisible(FIRST);
  // The key used by the release test has called the API, so it is listed; the wizard's key does not exist yet.
  await expect(page.getByRole('table').first().getByRole('row').filter({ hasText: 'E2E READ_ONLY' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'React app' })).toHaveCount(0);

  // 1. Framework: nothing is chosen, so the wizard cannot continue yet.
  await expect(next).toBeDisabled();
  const frameworks = page.getByRole('radiogroup', { name: 'Framework' });
  await frameworks.getByRole('radio', { name: 'React', exact: true }).click();
  await expect(frameworks.getByRole('radio', { name: 'React', exact: true })).toBeChecked();
  await next.click();

  // 2. Environment
  await expect(step('2. Choose the environment')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Environment' }).getByRole('radio', { name: 'Production' })).toBeChecked();
  await next.click();

  // 3. Access: read-only is the default, and the only kind meant for a browser app.
  await expect(step('3. Choose an access level')).toBeVisible();
  const access = page.getByRole('radiogroup', { name: 'Access level' });
  await expect(access.getByRole('radio', { name: 'Read-only' })).toBeChecked();
  await access.getByRole('radio', { name: 'Read/write' }).click();
  await expect(page.getByText(/React code runs in the browser, where a secret key can be extracted/)).toBeVisible();
  await access.getByRole('radio', { name: 'Read-only' }).click();
  await next.click();

  // 4. Credentials: no key exists until it is generated.
  await expect(step('4. Generate credentials')).toBeVisible();
  await expect(next).toBeDisabled();
  expect((await api.get(`${ws.projectApi}/tokens`)).items.some((t: { name: string }) => t.name === 'React app')).toBe(false);
  await page.getByRole('button', { name: 'Generate key' }).click();
  await expect(page.getByText(/shown only once/)).toBeVisible();
  const secret = (await main().getByLabel('API key', { exact: true }).innerText()).trim();
  expect(secret.startsWith('mrd_ro_')).toBe(true);
  expect(REAL_KEY.test(secret)).toBe(true);

  const tokens = (await api.get(`${ws.projectApi}/tokens`)).items as { id: string; name: string; type: string; environmentId: string; status: string }[];
  const created = tokens.find((t) => t.name === 'React app');
  expect(created, 'the key the wizard created').toBeTruthy();
  expect(created?.type).toBe('READ_ONLY');
  expect(created?.environmentId).toBe(ws.envId);
  expect(created?.status).toBe('active');
  expect(JSON.stringify(tokens).includes(secret)).toBe(false);
  expect((await delivery(page, secret, '/articles')).status).toBe(200);
  await next.click();

  // 5. Install: the environment file is filled in with the new key.
  await expect(step('5. Install and configure')).toBeVisible();
  await expect(main()).toContainText('npm install @meridian/sdk');
  await expect(main()).toContainText('VITE_MERIDIAN_API_KEY=');
  expect((await main().innerText()).includes(`VITE_MERIDIAN_API_KEY=${secret}`)).toBe(true);
  await next.click();

  // 6. Sample code uses this project's own content type.
  await expect(step('6. Sample code')).toBeVisible();
  await expect(main().getByText(/These examples use this project’s real content model/)).toContainText('articles');
  await next.click();

  // 7. Test connection: a real request from this browser with the new key.
  await expect(step('7. Test the connection')).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(main().getByText('Success', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(main().getByText('HTTP 200')).toBeVisible();
  await expect(main().getByText(/Connected to/)).toContainText(ws.projectSlug);
  await next.click();

  // 8. Verify content: the published article arrives, the drafts do not.
  await expect(step('8. Verify content retrieval')).toBeVisible();
  await expect(next).toHaveCount(0);
  const finish = page.getByRole('button', { name: 'Mark as connected' });
  await expect(finish).toBeDisabled();
  await page.getByRole('button', { name: 'Verify content retrieval' }).click();
  await expect(main().getByText(/Retrieved 1 published entry from/)).toBeVisible({ timeout: 15_000 });
  await expect(main().locator('pre').filter({ hasText: 'Launch notes' })).toBeVisible();
  await expect(main().locator('pre').filter({ hasText: 'Roadmap' })).toHaveCount(0);
  await finish.click();
  await expectToast(page, 'Application marked as connected');

  // 9. Connected: listed as a connected application, and the secret is gone from the screen.
  await expect(step('9. Connected')).toBeVisible();
  await expect(main().getByText('React app is connected')).toBeVisible();
  const application = page.getByRole('row').filter({ hasText: 'React app' });
  await expect(application).toBeVisible({ timeout: 15_000 });
  await expect(application).toContainText('Connected');
  await expect(application).toContainText('mrd_ro_');
  expect((await page.content()).includes(secret)).toBe(false);

  // Nothing shows it again: not the key list, and not the wizard when it is opened afresh.
  await page.getByRole('link', { name: 'Manage API keys' }).click();
  await page.waitForURL(/\/dev\/keys$/);
  await expect(page.getByRole('row', { name: /React app/ })).toBeVisible(FIRST);
  expect((await page.content()).includes(secret)).toBe(false);

  await open(page, `${ws.base}/dev/integrations`);
  await expect(step('1. Choose your framework')).toBeVisible(FIRST);
  await expect(page.getByRole('row').filter({ hasText: 'React app' })).toBeVisible();
  expect((await page.content()).includes(secret)).toBe(false);
  expect(REAL_KEY.test(await page.locator('body').innerText())).toBe(false);
});

// ─── Media ───────────────────────────────────────────────────────────────────

test('Media: replacing a file keeps its identity and serves the new content', async () => {
  await open(page, `${ws.base}/media`);
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible(FIRST);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles([imageFile('alpha.png', 4, [200, 30, 30]), imageFile('beta.png', 4, [30, 160, 60]), imageFile('gamma.png', 4, [30, 60, 200])]);
  await expectToast(page, /3 files uploaded/);
  for (const name of ['alpha.png', 'beta.png', 'gamma.png']) await expect(card(name)).toBeVisible();

  const before = await assetNamed('alpha.png');
  expect(before.revision).toBe(1);
  expect(before.width).toBe(4);

  await card('alpha.png').click();
  await expect(page.getByRole('button', { name: 'Replace file' })).toBeVisible();
  const replacement = imageFile('alpha.png', 8, [20, 110, 90]);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace file' }).click();
  await (await picker).setFiles(replacement);
  await expectToast(page, /File replaced/);

  // Same asset, new bytes: references to it keep working and pick up the new version.
  const assets = await listMedia();
  expect(assets).toHaveLength(3);
  const after = assets.find((a) => a.id === before.id) as Asset;
  expect(after, 'the replaced asset keeps its id').toBeTruthy();
  expect(after.filename).toBe('alpha.png');
  expect(after.revision).toBe(before.revision + 1);
  expect(after.checksum).not.toBe(before.checksum);
  expect(after.width).toBe(8);
  expect(after.height).toBe(8);
  expect(after.url).not.toBe(before.url);

  const current = await page.request.get(after.url);
  expect(current.status()).toBe(200);
  expect(Buffer.compare(await current.body(), replacement.buffer)).toBe(0);
  // The address of the old version leads to the new one instead of a missing file.
  const old = await page.request.get(before.url);
  expect(old.status()).toBe(200);
  expect(Buffer.compare(await old.body(), replacement.buffer)).toBe(0);

  // The open drawer shows the new version without a reload.
  const drawer = page.getByRole('dialog').filter({ hasText: 'alpha.png' });
  await expect(drawer.getByText('8 × 8').or(drawer.getByText('8×8')).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close file details' }).click();
  await expect(page.getByRole('button', { name: /^Open details of/ })).toHaveCount(3);
});

test('Media: bulk move, tag, trash and restore act on every selected file', async () => {
  const folder = await api.post(`${ws.projectApi}/media-folders`, { name: 'Campaign' });
  await open(page, `${ws.base}/media`);
  const folders = page.getByRole('navigation', { name: 'Folders' });
  await expect(folders.getByRole('button', { name: /^Campaign/ })).toBeVisible(FIRST);
  await expect(card('beta.png')).toBeVisible();
  const cards = page.getByRole('button', { name: /^Open details of/ });
  const everything = page.getByRole('checkbox', { name: 'Select every file on this page' });

  // Move two of the three files into a folder.
  await selectFile('beta.png');
  await selectFile('gamma.png');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Move to folder' }).click();
  await page.getByRole('menuitem', { name: 'Campaign' }).click();
  await expectToast(page, '2 files moved to “Campaign”');
  await expect(page.getByText('Select all on this page')).toBeVisible();
  expect((await assetNamed('beta.png')).folderId).toBe(folder.id);
  expect((await assetNamed('gamma.png')).folderId).toBe(folder.id);
  expect((await assetNamed('alpha.png')).folderId).toBeNull();

  await folders.getByRole('button', { name: /^Campaign/ }).click();
  await expect(cards).toHaveCount(2);
  await expect(card('alpha.png')).toHaveCount(0);

  // Tag everything in the folder with "select all".
  await everything.check();
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Add tag' }).click();
  const tagDialog = page.getByRole('dialog', { name: 'Add a tag to 2 files' });
  await tagDialog.getByLabel('Tag').fill('Launch 2026');
  await tagDialog.getByRole('button', { name: 'Add tag' }).click();
  await expectToast(page, 'Tag “launch 2026” added to 2 files');
  expect((await assetNamed('beta.png')).tags).toEqual(['launch 2026']);
  expect((await assetNamed('gamma.png')).tags).toEqual(['launch 2026']);
  expect((await assetNamed('alpha.png')).tags).toEqual([]);

  // The new tag becomes a filter across the whole library.
  await folders.getByRole('button', { name: /^All files/ }).click();
  await expect(cards).toHaveCount(3);
  await page.getByRole('combobox', { name: 'Tag' }).click();
  await page.getByRole('option', { name: /launch 2026/ }).click();
  await expect(cards).toHaveCount(2);
  await expect(card('alpha.png')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Tag' }).click();
  await page.getByRole('option', { name: 'All tags' }).click();
  await expect(cards).toHaveCount(3);

  // Trash two files at once; the third stays.
  await selectFile('beta.png');
  await selectFile('gamma.png');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Move 2 files to the trash?' }).getByRole('button', { name: 'Move to trash' }).click();
  await expectToast(page, '2 files moved to the trash');
  await expect(cards).toHaveCount(1);
  await expect(card('alpha.png')).toBeVisible();
  expect((await listMedia()).map((a) => a.filename)).toEqual(['alpha.png']);
  expect((await listMedia('?trash=true')).map((a) => a.filename).sort()).toEqual(['beta.png', 'gamma.png']);

  // Restore both from the trash.
  await folders.getByRole('button', { name: /^Trash/ }).click();
  await expect(cards).toHaveCount(2);
  await everything.check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expectToast(page, '2 files restored');
  await expect(page.getByText('The trash is empty')).toBeVisible();
  expect(await listMedia('?trash=true')).toHaveLength(0);
  const restored = await listMedia();
  expect(restored.map((a) => a.filename).sort()).toEqual(['alpha.png', 'beta.png', 'gamma.png']);
  // Restored files come back as they were: still in their folder, still tagged.
  expect(restored.filter((a) => a.folderId === folder.id).map((a) => a.filename).sort()).toEqual(['beta.png', 'gamma.png']);
  expect(restored.filter((a) => a.tags.includes('launch 2026'))).toHaveLength(2);
});

// ─── Dashboard ───────────────────────────────────────────────────────────────

test('Dashboard: a reordered and trimmed layout is saved for the user and survives a reload', async () => {
  const preference = async () => (await api.get('/auth/me/preferences/dashboard-layout')).value as { order: string[]; hidden: string[] } | null;
  const titles = () => main().getByRole('heading', { level: 2 }).allTextContents();
  const widget = (title: string) => main().getByRole('heading', { level: 2, name: title, exact: true });
  expect(await preference()).toBeNull();

  await open(page, ws.base);
  await expect(widget('Pending review')).toBeVisible(FIRST);
  await expect(widget('System health')).toBeVisible();
  let order = await titles();
  expect(order.indexOf('Pending review')).toBeLessThan(order.indexOf('Recent content updates'));

  await page.getByRole('button', { name: 'Customize' }).click();

  // Reorder with the keyboard: pick the widget up, move it one place to the right, drop it.
  const announcements = page.locator('[id^="DndLiveRegion"]');
  const handle = page.getByRole('button', { name: 'Reorder Pending review' });
  await handle.focus();
  await page.keyboard.press('Space');
  await expect(handle).toHaveAttribute('aria-pressed', 'true');
  await expect(announcements).toContainText('Draggable item reviews');
  await page.keyboard.press('ArrowRight');
  await expect(announcements).toContainText('was moved over droppable area updates');
  await page.keyboard.press('Space');
  await expect(announcements).toContainText('was dropped over droppable area updates');

  await page.getByRole('button', { name: 'Hide System health' }).click();
  await expect(widget('System health')).toHaveCount(0);
  await expect(page.getByText('Hidden widgets — select one to show it again')).toBeVisible();

  // Nothing is stored until the layout is saved.
  expect(await preference()).toBeNull();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expectToast(page, 'Dashboard layout saved');
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();

  let saved = await preference();
  expect(saved?.hidden).toEqual(['health']);
  expect(saved?.order.indexOf('updates')).toBeLessThan(saved?.order.indexOf('reviews') ?? -1);

  await page.reload();
  await expect(widget('Pending review')).toBeVisible(FIRST);
  await expect(widget('System health')).toHaveCount(0);
  order = await titles();
  expect(order.indexOf('Recent content updates')).toBeLessThan(order.indexOf('Pending review'));

  // A cancelled edit changes nothing.
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Hide Team activity' }).click();
  await expect(widget('Team activity')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(widget('Team activity')).toBeVisible();
  expect((await preference())?.hidden).toEqual(['health']);

  // A hidden widget can be brought back.
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'System health' }).click();
  await expect(widget('System health')).toBeVisible();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expectToast(page, 'Dashboard layout saved');
  saved = await preference();
  expect(saved?.hidden).toEqual([]);
  expect(saved?.order.indexOf('updates')).toBeLessThan(saved?.order.indexOf('reviews') ?? -1);
});

// ─── Analytics ───────────────────────────────────────────────────────────────

test('Analytics: real delivery requests are counted, and the time range changes what is loaded', async () => {
  const key = (await api.post(`${ws.projectApi}/tokens`, { name: 'Analytics probe', type: 'READ_ONLY', environmentId: ws.envId })).token as string;
  for (let i = 0; i < 5; i += 1) expect((await delivery(page, key, '/articles')).status).toBe(200);
  expect((await delivery(page, key, '/articles/no-such-article')).status).toBe(404);

  // Usage is written in batches a few seconds apart.
  const analytics = (days: number) => api.get(`${ws.envApi}/analytics?days=${days}`);
  const probe = (data: { byToken: { name: string; requests: number; errors: number }[] }) => data.byToken.find((t) => t.name === 'Analytics probe');
  await expect.poll(async () => probe(await analytics(30))?.requests ?? 0, { timeout: 30_000 }).toBe(6);
  const data = await analytics(30);
  expect(probe(data)?.errors).toBe(1);
  expect(data.totals.requests).toBeGreaterThanOrEqual(6);
  expect(data.totals.errors).toBeGreaterThanOrEqual(1);
  const articles = data.byResource.find((r: { resource: string }) => r.resource === 'articles');
  expect(articles.requests).toBeGreaterThanOrEqual(6);

  await open(page, `${ws.base}/analytics`);
  await expect(page.getByRole('heading', { name: 'Delivery API' })).toBeVisible(FIRST);
  await expect(page.getByText(/No API requests in the last/)).toHaveCount(0);

  // The numbers on screen are the recorded ones.
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  await expect(main().getByText(`${data.totals.errors} of ${data.totals.requests} requests`)).toBeVisible();
  await expect(main().getByText(new RegExp(`^${plural(data.totals.requests, 'request')} and ${plural(data.totals.errors, 'error')}`))).toBeVisible();
  const byKey = page.getByRole('listitem').filter({ hasText: 'Analytics probe' });
  await expect(byKey).toBeVisible();
  await expect(byKey).toContainText('6');
  const byType = page.getByRole('listitem').filter({ hasText: 'Articles' });
  await expect(byType).toContainText(String(articles.requests));
  await expect(page.getByRole('listitem').filter({ hasText: 'Workspace Tester' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Media by kind' }).getByRole('row', { name: /Images/ })).toContainText('3');

  // The chart's figures are also available as a table; the newest day is first.
  const range = page.getByRole('group', { name: 'Time range' });
  await expect(range.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(main().getByText(/· 30 days$/)).toBeVisible();
  await page.getByRole('button', { name: 'Show as table' }).first().click();
  const today = data.usage[data.usage.length - 1];
  const newest = main().getByRole('table').first().locator('tbody tr').first();
  await expect(newest.getByRole('cell').nth(1)).toHaveText(String(today.requests));
  await expect(newest.getByRole('cell').nth(2)).toHaveText(String(today.errors));
  await expect(main().getByRole('table').first().locator('tbody tr')).toHaveCount(30);

  // Each range is fetched from the server and replaces the figures.
  const loaded = (days: number) => page.waitForResponse((res) => res.url().includes('/analytics') && new URL(res.url()).searchParams.get('days') === String(days) && res.ok());
  await Promise.all([loaded(7), range.getByRole('button', { name: 'Last 7 days' }).click()]);
  await expect(range.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(range.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'false');
  await expect(main().getByText(/· 7 days$/)).toBeVisible();
  await expect(main().getByRole('table').first().locator('tbody tr')).toHaveCount(7);
  await expect(page.getByRole('img', { name: 'Average response time in milliseconds per day over the last 7 days' })).toBeVisible();
  await expect(byKey).toContainText('6');

  await Promise.all([loaded(90), range.getByRole('button', { name: 'Last 90 days' }).click()]);
  await expect(main().getByText(/· 90 days$/)).toBeVisible();
  await expect(main().getByRole('table').first().locator('tbody tr')).toHaveCount(90);

  // New traffic appears after a refresh.
  expect((await delivery(page, key, '/articles')).status).toBe(200);
  await expect.poll(async () => probe(await analytics(90))?.requests ?? 0, { timeout: 30_000 }).toBe(7);
  await Promise.all([loaded(90), page.getByRole('button', { name: 'Refresh analytics' }).click()]);
  await expect(byKey).toContainText('7');
});

// ─── SDK documentation ───────────────────────────────────────────────────────

test('SDK documentation: sections, sample tabs and copy buttons work, and no real key is printed', async () => {
  // The project has real keys by now; the documentation must only ever show placeholders.
  const secret = await createDeliveryKey(page, ws);

  await open(page, `${ws.base}/dev/sdk`);
  await expect(page.getByRole('heading', { level: 1, name: 'SDK documentation' })).toBeVisible(FIRST);
  const sections = page.getByRole('navigation', { name: 'Documentation sections' });
  const quick = page.getByRole('region', { name: 'Quick start' });
  await expect(quick).toBeVisible(FIRST);
  await expect(sections.getByRole('button')).toHaveCount(13);
  await expect(sections.getByRole('button', { name: 'Quick start' })).toHaveAttribute('aria-current', 'location');

  // Samples are written for this project's own content type and API address.
  await expect(main()).toContainText('/api/v1/articles');
  await expect(main().getByText(/samples use an example type/)).toHaveCount(0);

  // Jumping to a section scrolls to it and marks it as the current one.
  const webhooks = page.getByRole('heading', { level: 2, name: 'Webhooks and signature verification' });
  await expect(webhooks).not.toBeInViewport();
  await sections.getByRole('button', { name: 'Webhooks' }).click();
  await expect(webhooks).toBeInViewport();
  await expect(sections.getByRole('button', { name: 'Webhooks' })).toHaveAttribute('aria-current', 'location');
  await expect(sections.getByRole('button', { name: 'Quick start' })).not.toHaveAttribute('aria-current', 'location');
  await sections.getByRole('button', { name: 'Quick start' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Quick start' })).toBeInViewport();

  // Sample tabs switch the code that is shown.
  const curlSample = quick.locator('pre').filter({ hasText: 'curl ' });
  await expect(curlSample).toHaveCount(0);
  await quick.getByRole('tab', { name: 'cURL' }).click();
  await expect(quick.getByRole('tab', { name: 'cURL' })).toHaveAttribute('aria-selected', 'true');
  await expect(curlSample).toHaveCount(1);
  await expect(curlSample).toContainText(`${API_URL}/api/v1/articles`);
  await quick.getByRole('tab', { name: 'Response shape' }).click();
  await expect(curlSample).toHaveCount(0);
  await expect(quick.locator('pre').filter({ hasText: '"data"' })).toHaveCount(1);

  // Copy buttons put exactly what is shown on the clipboard.
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole('button', { name: 'Copy api url' }).click();
  await expect.poll(clipboard).toBe(API_URL);
  const install = (await quick.locator('pre').first().innerText()).trim();
  expect(install).toContain('@meridian/sdk');
  await quick.getByRole('button', { name: 'Copy', exact: true }).first().click();
  await expect.poll(async () => (await clipboard()).trim()).toBe(install);

  // Key samples use placeholders and environment variables, never a real key.
  const authentication = page.getByRole('region', { name: 'Authentication and key types' });
  const shownText = async () => `${await page.locator('body').innerText()}\n${await page.content()}`;
  expect(REAL_KEY.test(await shownText())).toBe(false);
  for (const tab of ['Browser client', 'Server client', 'Writing content']) {
    await authentication.getByRole('tab', { name: tab }).click();
    await expect(authentication.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    const text = await shownText();
    expect(REAL_KEY.test(text)).toBe(false);
    expect(text.includes(secret)).toBe(false);
  }
  await expect(quick).toContainText('MERIDIAN_API_KEY=mrd_ro_your_key');
});

// ─── Command palette ─────────────────────────────────────────────────────────

test('Command palette: opens from the keyboard, finds screens and content, and navigates with Enter', async () => {
  await open(page, ws.base);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible(FIRST);

  // Jump to a screen.
  await openPalette();
  // Typed on the keyboard, not filled in, so this fails if focus is anywhere but the search box.
  await page.keyboard.type('webh');
  await expect(paletteInput()).toHaveValue('webh');
  const webhooks = palette().getByRole('option', { name: /Webhooks/ });
  await expect(webhooks).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/dev\/webhooks$/);
  await expect(palette()).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible(FIRST);

  // Open an entry by its title.
  await openPalette();
  await paletteInput().fill('Launch');
  const hit = palette().getByRole('option', { name: /Launch notes/ });
  await expect(hit).toBeVisible();
  await expect(hit).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/content/articles/${launch.id}$`));
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Launch notes', FIRST);

  // Arrow keys move through the results; a "create" command starts a new entry.
  await openPalette();
  await paletteInput().fill('article');
  const options = palette().getByRole('option');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  const create = palette().getByRole('option', { name: 'New article' });
  await expect(create).toBeVisible();
  const position = await options.evaluateAll((els) => els.findIndex((el) => el.textContent?.includes('New article')));
  expect(position).toBeGreaterThan(0);
  for (let i = 0; i < position; i += 1) await page.keyboard.press('ArrowDown');
  await expect(create).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/content\/articles\/new$/);

  // Nothing found, and Escape closes without navigating. The search button opens it too.
  await page.getByRole('button', { name: 'Search and commands' }).click();
  await expect(palette()).toBeVisible();
  await expect(paletteInput()).toBeFocused();
  await page.keyboard.type('zzzz-nothing-here');
  await expect(palette().getByText('Nothing matches “zzzz-nothing-here”')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette()).toBeHidden();
  await expect(page).toHaveURL(/\/content\/articles\/new$/);
});

// ─── Theme ───────────────────────────────────────────────────────────────────

test('Dark theme: switching repaints the app and the choice survives a reload', async () => {
  await open(page, ws.base);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible(FIRST);
  expect(await bodyBackground()).toBe(LIGHT_BACKGROUND);
  const headerBackground = () => page.locator('header').evaluate((el) => getComputedStyle(el).backgroundColor);
  const lightHeader = await headerBackground();

  await page.getByRole('button', { name: 'Account menu' }).click();
  const themes = page.getByRole('radiogroup', { name: 'Theme' });
  await themes.getByRole('radio', { name: 'Dark' }).click();
  await expect(themes.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect.poll(bodyBackground).toBe(DARK_BACKGROUND);
  await page.keyboard.press('Escape');
  await expect(themes).toBeHidden();

  // Surfaces and text change with it, not only the page background.
  const darkHeader = await headerBackground();
  expect(darkHeader).not.toBe(lightHeader);
  const textColor = await page.getByRole('heading', { level: 1, name: 'Dashboard' }).evaluate((el) => getComputedStyle(el).color);
  const [r, g, b] = (textColor.match(/\d+/g) ?? []).map(Number);
  expect(r + g + b, `heading colour ${textColor} should be light on a dark background`).toBeGreaterThan(450);

  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible(FIRST);
  expect(await bodyBackground()).toBe(DARK_BACKGROUND);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(themes.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(themes).toBeHidden();

  // The command palette offers the way back.
  await openPalette();
  await paletteInput().fill('theme');
  await expect(palette().getByRole('option', { name: 'Switch to light theme' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(bodyBackground).toBe(LIGHT_BACKGROUND);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible(FIRST);
  expect(await bodyBackground()).toBe(LIGHT_BACKGROUND);
});

// ─── Small screens ───────────────────────────────────────────────────────────

test('Small screens: navigation moves into a drawer and the core screens fit a phone', async () => {
  await page.setViewportSize(PHONE);
  try {
    // Content list
    await open(page, `${ws.base}/content/articles`);
    await expect(main().getByText('Launch notes').first()).toBeVisible(FIRST);
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await expectNoSidewaysScroll('content list');

    // The navigation is one tap away and closes after choosing a screen.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Content', exact: true })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Media Library' }).click();
    await page.waitForURL(/\/media$/);
    await expect(nav).toBeHidden();

    // Media library: folders become a selector, files stay reachable.
    await expect(card('alpha.png')).toBeVisible(FIRST);
    await expect(page.getByRole('navigation', { name: 'Folders' })).toBeHidden();
    await expectNoSidewaysScroll('media library');
    await page.getByRole('combobox', { name: 'Folder' }).click();
    await page.getByRole('option', { name: 'Campaign' }).click();
    await expect(page.getByRole('button', { name: /^Open details of/ })).toHaveCount(2);
    await expect(card('alpha.png')).toHaveCount(0);

    // File details open full-width and can be edited and closed.
    await card('beta.png').click();
    const altText = page.getByRole('textbox', { name: 'Alt text', exact: true });
    await expect(altText).toBeVisible();
    await altText.fill('A green square');
    await page.getByRole('button', { name: 'Save details' }).click();
    await expectToast(page, 'File details saved');
    expect((await assetNamed('beta.png') as Asset & { alt?: string }).alt).toBe('A green square');
    await page.getByRole('button', { name: 'Close file details' }).click();
    await expect(altText).toBeHidden();
    await expectNoSidewaysScroll('media library after closing file details');

    // An entry can be opened and edited.
    await open(page, `${ws.base}/content/articles/${roadmap.id}`);
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Roadmap', FIRST);
    await expectNoSidewaysScroll('entry editor');

    // Dashboard
    await open(page, ws.base);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible(FIRST);
    await expect(main().getByRole('heading', { level: 2, name: 'Pending review' })).toBeVisible();
    await expectNoSidewaysScroll('dashboard');

    // The account menu still fits on the screen.
    await page.getByRole('button', { name: 'Account menu' }).click();
    const signOut = page.getByRole('menuitem', { name: 'Sign out' });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(signOut).toBeHidden();
  } finally {
    await page.setViewportSize(DESKTOP);
  }
});
