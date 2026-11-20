import { type BrowserContext, type Locator, type Page, expect, test } from '@playwright/test';
import { type Workspace, apiFor, createDeliveryKey, createWorkspace, delivery, expectToast, open } from './helpers';

/**
 * Pages (list, page builder, publishing) and the media library.
 * The tests share one signed-in page and build on each other, so they run in order.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pixelFile = () => ({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL_PNG, 'base64') });

/** The dev server compiles a screen on its first visit. */
const FIRST = { timeout: 30_000 };
const PAGE_URL = /\/pages\/[0-9a-f-]{36}$/;

const HEADING = 'We build things';
const BODY = 'Made with care.';
const SEO_TITLE = 'About Meridian and the people behind it';
const SEO_DESCRIPTION = 'Meet the team behind Meridian and learn how we build things for editors.';
const ALT = 'A single transparent pixel';
const FINAL_ORDER = ['Hero block', 'FAQ accordion block', 'Text block'];

let context: BrowserContext;
let page: Page;
let ws: Workspace;
let aboutId = '';
let deliveryKey = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  ws = await createWorkspace(page, 'Pages');
});

test.afterAll(async () => {
  await context?.close();
});

// ─── Page editor locators ────────────────────────────────────────────────────

const toolbar = () => page.getByRole('toolbar', { name: 'Page editor' });
const leftPanel = () => page.getByRole('complementary', { name: 'Blocks and outline' });
const inspector = () => page.getByRole('complementary', { name: 'Inspector' });
const canvas = () => page.getByLabel(/^Page canvas/);
const blocks = () => canvas().getByRole('group', { name: / block$/ });
const block = (label: string) => canvas().getByRole('group', { name: `${label} block`, exact: true });
const blockOrder = () => blocks().evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const addBlock = (label: string) => leftPanel().getByRole('button', { name: `Add ${label} block`, exact: true }).click();

/** Clicks a block on the canvas (in its top padding, clear of its content) and waits for its toolbar. */
async function selectBlock(label: string, nth = 0): Promise<Locator> {
  const target = block(label).nth(nth);
  await target.click({ position: { x: 400, y: 5 } });
  await expect(target.getByRole('button', { name: /^Delete/ })).toBeVisible();
  return target;
}

async function createPage(title: string, slug: string): Promise<string> {
  const newPage = page.getByRole('button', { name: 'New page' }).first();
  await expect(newPage).toBeVisible(FIRST);
  await newPage.click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title', { exact: true }).fill(title);
  await expect(dialog.getByLabel('Slug', { exact: true })).toHaveValue(slug);
  await expect(dialog.getByText(new RegExp(`/${slug}$`))).toBeVisible();
  await dialog.getByRole('button', { name: 'Create and open editor' }).click();
  await page.waitForURL(PAGE_URL, FIRST);
  await expect(toolbar().getByLabel('Page title')).toHaveValue(title, FIRST);
  return new URL(page.url()).pathname.split('/').pop() as string;
}

/** The delivery API wraps a page in `data`; tolerate the fields sitting one level deeper. */
function deliveredPage(body: any): { blocks: { type: string; props: Record<string, unknown>; style?: { align?: string } }[] } {
  const data = body?.data ?? body;
  if (Array.isArray(data?.blocks)) return data;
  return data?.data ?? data?.attributes ?? data?.fields ?? data;
}

// ─── Pages ───────────────────────────────────────────────────────────────────

test('pages: create a page from the list and land in the editor', async () => {
  await open(page, `${ws.base}/pages`);
  aboutId = await createPage('About', 'about');
  await expectToast(page, /Created “About”/);
  await expect(canvas().getByText('This page is empty')).toBeVisible();
});

test('pages: add, edit, move, duplicate and delete blocks, then undo and redo', async () => {
  // Hero, selected on the canvas and edited in the inspector.
  await addBlock('Hero');
  await expect(block('Hero')).toBeVisible();
  await selectBlock('Hero');
  await inspector().getByLabel(/^Heading/).fill(HEADING);
  await expect(block('Hero').getByText(HEADING)).toBeVisible();

  // Text (its content is required for publishing) and FAQ, each added after the selected block.
  await addBlock('Text');
  await expect(block('Text')).toBeVisible();
  await inspector().getByRole('textbox', { name: /Content|Rich text/ }).click();
  await page.keyboard.type(BODY);
  await expect(block('Text').getByText(BODY)).toBeVisible();
  await addBlock('FAQ accordion');
  await expect(blocks()).toHaveCount(3);
  await expect.poll(blockOrder).toEqual(['Hero block', 'Text block', 'FAQ accordion block']);

  // The outline lists the same three blocks in the same order.
  await leftPanel().getByRole('tab', { name: /^Outline/ }).click();
  await expect(leftPanel().getByRole('tab', { name: 'Outline · 3' })).toBeVisible();
  await expect(leftPanel().getByRole('list', { name: 'Page outline' }).getByRole('listitem')).toHaveText([/Hero/, /Text/, /FAQ accordion/]);
  await leftPanel().getByRole('tab', { name: 'Blocks' }).click();

  // Move the FAQ above the text with the block toolbar.
  const faq = await selectBlock('FAQ accordion');
  await faq.getByRole('button', { name: /^Move up/ }).click();
  await expect.poll(blockOrder).toEqual(FINAL_ORDER);

  // Duplicate the text block, then delete the copy.
  const text = await selectBlock('Text');
  await text.getByRole('button', { name: /^Duplicate/ }).click();
  await expect(blocks()).toHaveCount(4);
  await expect.poll(blockOrder).toEqual([...FINAL_ORDER, 'Text block']);
  const copy = await selectBlock('Text', 1);
  await copy.getByRole('button', { name: /^Delete/ }).click();
  await expect(blocks()).toHaveCount(3);

  // Undo brings the deleted copy back, redo removes it again.
  await toolbar().getByRole('button', { name: /^Undo/ }).click();
  await expect(blocks()).toHaveCount(4);
  await toolbar().getByRole('button', { name: /^Redo/ }).click();
  await expect(blocks()).toHaveCount(3);
  await expect.poll(blockOrder).toEqual(FINAL_ORDER);
  await expect(leftPanel().getByRole('tab', { name: 'Outline · 3' })).toBeVisible();
});

test('pages: block style and SEO settings', async () => {
  await selectBlock('Hero');
  await inspector().getByRole('tab', { name: 'Style' }).click();
  // A hero is centred by default; choosing another alignment replaces it.
  const center = inspector().getByRole('button', { name: 'Align center' });
  const left = inspector().getByRole('button', { name: 'Align left' });
  await expect(center).toHaveAttribute('aria-pressed', 'true');
  await left.click();
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await expect(center).toHaveAttribute('aria-pressed', 'false');

  // With nothing selected the inspector shows the page's own settings.
  await page.keyboard.press('Escape');
  await expect(inspector().getByRole('tab', { name: 'SEO' })).toBeVisible();
  await inspector().getByRole('tab', { name: 'SEO' }).click();
  await inspector().getByLabel(/^SEO title/).fill(SEO_TITLE);
  await inspector().getByLabel(/^Meta description/).fill(SEO_DESCRIPTION);
  await expect(inspector().getByLabel(/^SEO title/)).toHaveValue(SEO_TITLE);
  await expect(inspector().getByLabel(/^Meta description/)).toHaveValue(SEO_DESCRIPTION);
});

test('pages: save, reload, publish and deliver', async () => {
  const api = apiFor(page);

  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await api.get(`${ws.envApi}/entry/${aboutId}`)).data?.seo?.description ?? null, { timeout: 15_000 }).toBe(SEO_DESCRIPTION);
  await expect(toolbar().getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

  await page.reload();
  await expect(toolbar().getByLabel('Page title')).toHaveValue('About', FIRST);
  await expect.poll(blockOrder).toEqual(FINAL_ORDER);
  await expect(block('Hero').getByText(HEADING)).toBeVisible();
  await expect(block('Text').getByText(BODY)).toBeVisible();
  await inspector().getByRole('tab', { name: 'SEO' }).click();
  await expect(inspector().getByLabel(/^SEO title/)).toHaveValue(SEO_TITLE);
  await expect(inspector().getByLabel(/^Meta description/)).toHaveValue(SEO_DESCRIPTION);
  await selectBlock('Hero');
  await expect(inspector().getByLabel(/^Heading/)).toHaveValue(HEADING);
  await inspector().getByRole('tab', { name: 'Style' }).click();
  await expect(inspector().getByRole('button', { name: 'Align left' })).toHaveAttribute('aria-pressed', 'true');

  await toolbar().getByRole('button', { name: 'Publish', exact: true }).click();
  await expectToast(page, /is live at \/about/);

  deliveryKey = await createDeliveryKey(page, ws);
  const res = await delivery(page, deliveryKey, '/pages?path=/about');
  expect(res.status).toBe(200);
  const published = deliveredPage(res.body);
  expect(published.blocks.map((b) => b.type)).toEqual(['hero', 'faq', 'text']);
  expect(published.blocks[0].props.heading).toBe(HEADING);
  expect(published.blocks[0].style?.align).toBe('left');
});

test('pages: nested page, publish from the list, duplicate and delete', async () => {
  deliveryKey ||= await createDeliveryKey(page, ws);
  await open(page, `${ws.base}/pages`);
  const table = page.getByRole('table', { name: 'Pages' });
  await expect(table.getByRole('link', { name: 'About', exact: true })).toBeVisible(FIRST);

  // A child of About gets a URL underneath it.
  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title', { exact: true }).fill('Team');
  await expect(dialog.getByLabel('Slug', { exact: true })).toHaveValue('team');
  await dialog.getByRole('combobox', { name: /Parent page/ }).click();
  await page.getByRole('option', { name: /About/ }).click();
  await expect(dialog.getByText(/\/about\/team$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create and open editor' }).click();
  await page.waitForURL(PAGE_URL, FIRST);
  await expect(toolbar().getByLabel('Page title')).toHaveValue('Team', FIRST);

  await open(page, `${ws.base}/pages`);
  const teamRow = table.getByRole('row').filter({ has: page.getByRole('link', { name: 'Team', exact: true }) });
  await expect(teamRow).toContainText('/about/team', FIRST);

  // Publish from the row menu.
  await table.getByRole('button', { name: 'Actions for Team', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish', exact: true }).click();
  await expectToast(page, /Published “Team”/);
  await expect(teamRow).toContainText('Published');
  expect((await delivery(page, deliveryKey, '/pages?path=/about/team')).status).toBe(200);

  // Duplicate About.
  await expect(table.getByRole('link', { name: /About/ })).toHaveCount(1);
  await table.getByRole('button', { name: 'Actions for About', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expectToast(page, /Duplicated “About”/);
  await expect(table.getByRole('link', { name: /About/ })).toHaveCount(2);

  // Delete the child page.
  await table.getByRole('button', { name: 'Actions for Team', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete page' }).click();
  await expectToast(page, /Deleted “Team”/);
  await expect(table.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
  expect((await delivery(page, deliveryKey, '/pages?path=/about/team')).status).toBe(404);
});

// ─── Media ───────────────────────────────────────────────────────────────────

const pixelCard = () => page.getByRole('button', { name: 'Open details of pixel.png' });
/** Exact, because the library's search box is labelled "Search name, alt text or tag…". */
const altText = () => page.getByRole('textbox', { name: 'Alt text', exact: true });

async function uploadPixel() {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles(pixelFile());
}

test('media: upload an image, edit its alt text and detect a duplicate upload', async () => {
  const api = apiFor(page);
  await open(page, `${ws.base}/media`);
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible(FIRST);

  await uploadPixel();
  await expectToast(page, /1 file uploaded/);
  await expect(pixelCard()).toBeVisible();

  await pixelCard().click();
  await expect(altText()).toBeVisible();
  await altText().fill(ALT);
  await page.getByRole('button', { name: 'Save details' }).click();
  await expectToast(page, 'File details saved');

  // The drawer is addressed by the URL, so it reopens after a reload.
  await page.reload();
  await expect(altText()).toHaveValue(ALT, FIRST);
  const listed = await api.get(`${ws.projectApi}/media`);
  expect(listed.meta.total).toBe(1);
  expect(listed.items[0].alt).toBe(ALT);
  await page.getByRole('button', { name: 'Close file details' }).click();

  // The same bytes again are recognised instead of stored twice.
  await uploadPixel();
  await expectToast(page, /already in the library/);
  await expect(page.getByRole('button', { name: /^Open details of/ })).toHaveCount(1);
  expect((await api.get(`${ws.projectApi}/media`)).meta.total).toBe(1);
});

test('media: folders, search, trash and restore', async () => {
  const api = apiFor(page);
  await open(page, `${ws.base}/media`);
  const folders = page.getByRole('navigation', { name: 'Folders' });
  await expect(folders).toBeVisible(FIRST);
  await expect(pixelCard()).toBeVisible();

  await folders.getByRole('button', { name: 'New folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Folder name').fill('Brand');
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  await expectToast(page, /Folder “Brand” created/);
  await expect(folders.getByRole('button', { name: /^Brand/ })).toBeVisible();

  const search = page.getByPlaceholder('Search name, alt text or tag…');
  await search.fill('no-such-file');
  await expect(page.getByText('No files match these filters')).toBeVisible();
  await expect(pixelCard()).toHaveCount(0);
  await search.fill('pixel');
  await expect(pixelCard()).toBeVisible();
  await search.fill('');
  await expect(pixelCard()).toBeVisible();

  // Unused, so it goes to the trash after one confirmation.
  await pixelCard().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await expectToast(page, 'File moved to the trash');
  await expect(pixelCard()).toHaveCount(0);
  expect((await api.get(`${ws.projectApi}/media`)).meta.total).toBe(0);

  await folders.getByRole('button', { name: /^Trash/ }).click();
  await expect(pixelCard()).toBeVisible();
  await pixelCard().click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expectToast(page, 'File restored');
  await page.getByRole('button', { name: 'Close file details' }).click();
  await expect(pixelCard()).toHaveCount(0);

  await folders.getByRole('button', { name: /^All files/ }).click();
  await expect(pixelCard()).toBeVisible();
  expect((await api.get(`${ws.projectApi}/media`)).meta.total).toBe(1);
});

test('media: pick an uploaded image in the page builder', async () => {
  const api = apiFor(page);
  const asset = (await api.get(`${ws.projectApi}/media`)).items.find((a: { filename: string }) => a.filename === 'pixel.png');
  expect(asset, 'the image uploaded by the media test').toBeTruthy();

  await open(page, `${ws.base}/pages`);
  const galleryId = await createPage('Gallery', 'gallery');

  await addBlock('Image');
  await expect(block('Image')).toBeVisible();
  await inspector().getByRole('button', { name: 'Choose an image' }).click();
  const picker = page.getByRole('dialog', { name: /Choose a file/ });
  await picker.getByRole('option', { name: /pixel\.png/ }).click();
  await expect(picker).toBeHidden();
  await expect(inspector().getByRole('button', { name: 'Replace file' })).toBeVisible();

  await page.keyboard.press('Control+s');
  await expect
    .poll(
      async () => {
        const entry = await api.get(`${ws.envApi}/entry/${galleryId}`);
        return entry.data?.blocks?.find((b: { type: string }) => b.type === 'image')?.props?.image ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe(asset.id);
  await expect(toolbar().getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});
