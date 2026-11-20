import { type BrowserContext, type Locator, type Page, expect, test } from '@playwright/test';
import { type Api, type Workspace, apiFor, createWorkspace, expectToast, open } from './helpers';

/**
 * Drag and drop, driven with a real mouse (press, move, release) rather than the toolbar buttons
 * the other specs use: reordering fields in the content type builder, dragging blocks from the
 * palette, on the canvas and in the outline of the page builder, and dropping files on the media
 * library.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

/** The dev server compiles a screen on its first visit. */
const FIRST = { timeout: 30_000 };
const PAGE_URL = /\/pages\/[0-9a-f-]{36}$/;
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let context: BrowserContext;
let page: Page;
let ws: Workspace;
let api: Api;
let pageId = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage();
  ws = await createWorkspace(page, 'Drag');
  api = apiFor(page);
  await api.post(`${ws.envApi}/content-types`, {
    apiId: 'articles',
    displayName: 'Articles',
    singularName: 'Article',
    pluralName: 'Articles',
    options: { titleField: 'title' },
    fields: [
      { apiId: 'title', label: 'Title', type: 'text', required: true, config: {} },
      { apiId: 'summary', label: 'Summary', type: 'text', config: {} },
      { apiId: 'views', label: 'Views', type: 'integer', config: {} },
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Spot = 'top' | 'middle' | 'bottom';

/** Lets the app handle the pointer events it has received, including work it defers to the next frame. */
const settle = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

async function centreOf(target: Locator, spot: Spot = 'middle') {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('The element to drag from or to is not on screen');
  const share = spot === 'top' ? 0.2 : spot === 'bottom' ? 0.8 : 0.5;
  return { x: box.x + box.width / 2, y: box.y + box.height * share };
}

/** Presses on `from`, moves to the chosen part of `to` and stops there with the button still down. */
async function pickUpAndCarry(from: Locator, to: Locator, spot: Spot) {
  const start = await centreOf(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // A drag only starts once the pointer has travelled a few pixels, so a click is never mistaken for one.
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
  const end = await centreOf(to, spot);
  await page.mouse.move(end.x, end.y, { steps: 14 });
  await page.mouse.move(end.x + 1, end.y + 1);
  await settle();
}

async function drag(from: Locator, to: Locator, spot: Spot) {
  await pickUpAndCarry(from, to, spot);
  await page.mouse.up();
  await settle();
}

// Content type builder
const fieldList = () => page.getByRole('list', { name: 'Fields' });
const fieldOrder = () => fieldList().getByRole('button', { name: /^Edit field / }).evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? '').replace('Edit field ', '')));
const fieldHandle = (label: string) => page.getByRole('button', { name: `Reorder ${label}`, exact: true });
const fieldRow = (label: string) => page.getByRole('button', { name: `Edit field ${label}`, exact: true });

// Page builder
const toolbar = () => page.getByRole('toolbar', { name: 'Page editor' });
const leftPanel = () => page.getByRole('complementary', { name: 'Blocks and outline' });
const canvas = () => page.getByLabel(/^Page canvas/);
const blocks = () => canvas().getByRole('group', { name: / block$/ });
const block = (label: string) => canvas().getByRole('group', { name: `${label} block`, exact: true });
const blockOrder = () => blocks().evaluateAll((els) => els.map((el) => (el.getAttribute('aria-label') ?? '').replace(/ block$/, '')));
const paletteItem = (label: string) => leftPanel().getByRole('button', { name: `Add ${label} block`, exact: true });
const outlineRows = () => leftPanel().getByRole('list', { name: 'Page outline' }).getByRole('listitem');
/** The part of an outline row that is dragged: the button showing the block's name. */
const outlineRow = (label: string) => leftPanel().getByRole('list', { name: 'Page outline' }).getByRole('button', { name: new RegExp(`^${label}`) }).first();

async function selectBlock(label: string): Promise<Locator> {
  const target = block(label).first();
  await target.click({ position: { x: 400, y: 5 } });
  await expect(target.getByRole('button', { name: /^Delete/ })).toBeVisible();
  return target;
}

/** Block types of the saved page, top level only, with the children of containers in brackets. */
async function savedBlocks(): Promise<string[]> {
  const entry = await api.get(`${ws.envApi}/entry/${pageId}`);
  return (entry.data.blocks as { type: string; children?: { type: string }[] }[]).map((b) => (b.children?.length ? `${b.type}[${b.children.map((c) => c.type).join(',')}]` : b.type));
}

// ─── 1. Content type builder ─────────────────────────────────────────────────

test('content type builder: fields are reordered by dragging and with the keyboard, and the order is saved', async () => {
  await open(page, `${ws.base}/model/types/articles`);
  await expect(fieldRow('Title')).toBeVisible(FIRST);
  expect(await fieldOrder()).toEqual(['Title', 'Summary', 'Views']);

  // Mouse: carry Views to the top.
  await drag(fieldHandle('Views'), fieldRow('Title'), 'top');
  await expect.poll(fieldOrder).toEqual(['Views', 'Title', 'Summary']);

  // Keyboard: pick Summary up with Space, move it up one place, drop it with Space.
  await fieldHandle('Summary').focus();
  await page.keyboard.press('Space');
  await expect(fieldHandle('Summary')).toHaveAttribute('aria-pressed', 'true');
  await settle();
  await page.keyboard.press('ArrowUp');
  await settle();
  await page.keyboard.press('Space');
  await expect(fieldHandle('Summary')).not.toHaveAttribute('aria-pressed', 'true');
  await expect.poll(fieldOrder).toEqual(['Views', 'Summary', 'Title']);

  // Escape abandons a drag and leaves the order alone.
  await pickUpAndCarry(fieldHandle('Title'), fieldRow('Views'), 'top');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  expect(await fieldOrder()).toEqual(['Views', 'Summary', 'Title']);

  await page.getByRole('button', { name: 'Review and save' }).click();
  const review = page.getByRole('dialog', { name: /Review changes to Articles/ });
  await review.getByRole('button', { name: 'Save schema' }).click();
  await expectToast(page, 'Articles schema saved');

  const type = (await api.get(`${ws.envApi}/schema`)).types.find((t: { apiId: string }) => t.apiId === 'articles');
  const saved = [...type.fields].sort((a: { position: number }, b: { position: number }) => a.position - b.position).map((f: { apiId: string }) => f.apiId);
  expect(saved).toEqual(['views', 'summary', 'title']);

  await page.reload();
  await expect(fieldRow('Title')).toBeVisible(FIRST);
  expect(await fieldOrder()).toEqual(['Views', 'Summary', 'Title']);
});

// ─── 2. Page builder ─────────────────────────────────────────────────────────

test('page builder: a block dragged from the palette lands where it is dropped', async () => {
  await open(page, `${ws.base}/pages`);
  const newPage = page.getByRole('button', { name: 'New page' }).first();
  await expect(newPage).toBeVisible(FIRST);
  await newPage.click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Title', { exact: true }).fill('Dragged');
  await dialog.getByRole('button', { name: 'Create and open editor' }).click();
  await page.waitForURL(PAGE_URL, FIRST);
  await expect(toolbar().getByLabel('Page title')).toHaveValue('Dragged', FIRST);
  pageId = new URL(page.url()).pathname.split('/').pop() as string;

  // Onto the empty canvas.
  await drag(paletteItem('Hero'), canvas(), 'middle');
  await expect.poll(blockOrder).toEqual(['Hero']);

  // Below the hero, then between the two.
  await drag(paletteItem('Text'), block('Hero'), 'bottom');
  await expect.poll(blockOrder).toEqual(['Hero', 'Text']);
  await drag(paletteItem('FAQ accordion'), block('Text'), 'top');
  await expect.poll(blockOrder).toEqual(['Hero', 'FAQ accordion', 'Text']);

  // Dragging does not also "click": exactly one block was added each time.
  await expect(blocks()).toHaveCount(3);

  // Letting go outside the page adds nothing.
  await drag(paletteItem('Image'), toolbar(), 'middle');
  await expect(blocks()).toHaveCount(3);
});

test('page builder: blocks move by their drag handle and in the outline, and Escape cancels', async () => {
  // Canvas: carry the text block above the hero by its handle.
  const text = await selectBlock('Text');
  await drag(text.getByRole('button', { name: /^Drag Text to move it/ }), block('Hero'), 'top');
  await expect.poll(blockOrder).toEqual(['Text', 'Hero', 'FAQ accordion']);

  // Escape while carrying puts the block back.
  const hero = await selectBlock('Hero');
  await pickUpAndCarry(hero.getByRole('button', { name: /^Drag Hero to move it/ }), block('FAQ accordion'), 'bottom');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await settle();
  expect(await blockOrder()).toEqual(['Text', 'Hero', 'FAQ accordion']);

  // Outline: the same page as a list, reordered the same way.
  await leftPanel().getByRole('tab', { name: /^Outline/ }).click();
  await expect(outlineRows()).toHaveText([/Text/, /Hero/, /FAQ accordion/]);
  await drag(outlineRow('Text'), outlineRow('FAQ accordion'), 'bottom');
  await expect.poll(blockOrder).toEqual(['Hero', 'FAQ accordion', 'Text']);
  await expect(outlineRows()).toHaveText([/Hero/, /FAQ accordion/, /Text/]);

  // One undo step per drag.
  await toolbar().getByRole('button', { name: /^Undo/ }).click();
  await expect.poll(blockOrder).toEqual(['Text', 'Hero', 'FAQ accordion']);
  await toolbar().getByRole('button', { name: /^Redo/ }).click();
  await expect.poll(blockOrder).toEqual(['Hero', 'FAQ accordion', 'Text']);
});

test('page builder: a block dropped on a section becomes its child, and the result is saved', async () => {
  await leftPanel().getByRole('tab', { name: 'Blocks' }).click();
  // A new section at the very top of the page, then the text block carried into it.
  await drag(paletteItem('Section'), block('Hero'), 'top');
  await expect.poll(async () => (await blockOrder())[0]).toBe('Section');

  const text = await selectBlock('Text');
  await drag(text.getByRole('button', { name: /^Drag Text to move it/ }), block('Section'), 'middle');
  await expect(block('Section').getByRole('group', { name: 'Text block', exact: true })).toBeVisible();
  await expect(blocks()).toHaveCount(4);

  // A container cannot be dropped into itself.
  await leftPanel().getByRole('tab', { name: /^Outline/ }).click();
  await expect(outlineRows()).toHaveText([/Section/, /Text/, /Hero/, /FAQ accordion/]);
  await drag(outlineRow('Section'), outlineRow('Text'), 'bottom');
  await expect(outlineRows()).toHaveText([/Section/, /Text/, /Hero/, /FAQ accordion/]);

  await page.keyboard.press('Control+s');
  await expect.poll(savedBlocks, { timeout: 15_000 }).toEqual(['section[text]', 'hero', 'faq']);

  await page.reload();
  await expect(toolbar().getByLabel('Page title')).toHaveValue('Dragged', FIRST);
  await expect(block('Section').getByRole('group', { name: 'Text block', exact: true })).toBeVisible();
  expect(await blockOrder()).toEqual(['Section', 'Text', 'Hero', 'FAQ accordion']);
});

// ─── 3. Media library ────────────────────────────────────────────────────────

test('media library: files dropped on the page are uploaded, and a dragged link is ignored', async () => {
  await open(page, `${ws.base}/media`);
  const emptyState = page.getByText('Upload your first files');
  await expect(emptyState).toBeVisible(FIRST);

  // Something that is not a file (a dragged link or piece of text) must not start an upload.
  const textOnly = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'https://example.test/picture.png');
    return transfer;
  });
  await emptyState.dispatchEvent('dragenter', { dataTransfer: textOnly });
  await expect(page.getByText('Drop to upload')).toHaveCount(0);
  await emptyState.dispatchEvent('drop', { dataTransfer: textOnly });

  const files = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    return transfer;
  }, PIXEL_PNG);
  await emptyState.dispatchEvent('dragenter', { dataTransfer: files });
  await expect(page.getByText('Drop to upload')).toBeVisible();
  await emptyState.dispatchEvent('drop', { dataTransfer: files });
  await expectToast(page, /1 file uploaded/);
  await expect(page.getByText('Drop to upload')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open details of dropped.png' })).toBeVisible();

  const listed = await api.get(`${ws.projectApi}/media`);
  expect(listed.meta.total).toBe(1);
  expect(listed.items[0].filename).toBe('dropped.png');
  expect(listed.items[0].mimeType).toBe('image/png');
});
