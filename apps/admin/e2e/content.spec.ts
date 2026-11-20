import { type BrowserContext, type Locator, type Page, expect, test } from '@playwright/test';
import { type Workspace, apiFor, createDeliveryKey, createWorkspace, delivery, expectToast, open } from './helpers';

/**
 * Content modelling and editing, end to end: build a content type in the visual builder,
 * create / publish / edit / restore entries in the editor, work the list screen, and
 * change the schema of a type that already holds content.
 */
test.describe.configure({ mode: 'serial', timeout: 150_000 });

/** The dev server compiles each screen on first visit. */
const FIRST = 30_000;

let context: BrowserContext;
let page: Page;
let ws: Workspace;
let deliveryKey = '';
let articleId = '';
let untitledId = '';

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  ws = await createWorkspace(page, 'Content');
});

test.afterAll(async () => {
  await context?.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const titleInput = () => page.getByRole('textbox', { name: 'Title', exact: true });
/** The "Status" heading and the status chip next to it in the editor's side rail. */
const statusRow = () => page.getByRole('heading', { name: 'Status', exact: true }).locator('xpath=..');
const savedIndicator = () => page.getByRole('status').filter({ hasText: /All changes saved|Saved at \d\d:\d\d/ }).first();
const entryIdFromUrl = () => new URL(page.url()).pathname.split('/').pop() as string;
const ENTRY_URL = /\/content\/articles\/(?!new$)[^/?#]+$/;

/** What a connected website sees. */
async function liveArticles(): Promise<any[]> {
  const res = await delivery(page, deliveryKey, '/articles');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.data)).toBe(true);
  return res.body.data;
}

async function schemaOf(kind: 'types' | 'components', apiId: string) {
  const schema = await apiFor(page).get(`${ws.envApi}/schema`);
  return (schema[kind] as any[]).find((t) => t.apiId === apiId);
}

/** Adds one field in the schema builder: type picker → settings panel → "Add field". */
async function addField(typeName: RegExp, label: string, configure?: (drawer: Locator) => Promise<void>) {
  await page.getByRole('button', { name: 'Add field', exact: true }).first().click();
  await page.getByRole('dialog', { name: /Add a field/ }).getByRole('button', { name: typeName }).click();
  const drawer = page.locator('form').filter({ has: page.getByRole('heading', { name: /^New .+ field$/ }) });
  await drawer.getByRole('textbox', { name: 'Label', exact: true }).fill(label);
  if (configure) await configure(drawer);
  await drawer.getByRole('button', { name: 'Add field', exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: `Edit field ${label}`, exact: true })).toBeVisible();
}

/** Saves the draft schema through the review dialog (non-destructive changes). */
async function reviewAndSave(ownerName: string) {
  await page.getByRole('button', { name: 'Review and save' }).click();
  const review = page.getByRole('dialog', { name: new RegExp(`Review changes to ${ownerName}`) });
  await review.getByRole('button', { name: 'Save schema' }).click();
  await expectToast(page, `${ownerName} schema saved`);
  await expect(review).toBeHidden();
}

// ─── 1. Content type builder ─────────────────────────────────────────────────

test('creates the Articles content type with five fields in the builder', async () => {
  await open(page, `${ws.base}/model/types`);
  await page.getByRole('button', { name: 'New content type' }).first().click({ timeout: FIRST });

  const dialog = page.getByRole('dialog', { name: 'New content type' });
  await dialog.getByRole('textbox', { name: 'Display name' }).fill('Articles');
  await expect(dialog.getByRole('textbox', { name: 'API identifier' })).toHaveValue('articles');
  await expect(dialog.getByRole('textbox', { name: 'Singular name' })).toHaveValue('Article');
  await dialog.getByRole('button', { name: 'Create and add fields' }).click();

  await page.waitForURL(/\/model\/types\/articles$/);
  await expect(page.getByRole('button', { name: 'Add field', exact: true }).first()).toBeVisible({ timeout: FIRST });

  await addField(/^Short text/, 'Title', async (drawer) => {
    await drawer.getByLabel('Required', { exact: true }).check();
  });
  await addField(/^Slug/, 'Slug', async (drawer) => {
    await drawer.getByRole('tab', { name: 'Structure' }).click();
    await drawer.getByRole('combobox', { name: /Generate from/ }).click();
    await page.getByRole('option', { name: 'Title', exact: true }).click();
  });
  await addField(/^Rich text/, 'Body');
  await addField(/^Single select/, 'Category', async (drawer) => {
    await drawer.getByRole('tab', { name: 'Validation' }).click();
    await drawer.getByRole('button', { name: 'Add option' }).click();
    await drawer.getByRole('textbox', { name: 'Option 1 label' }).fill('News');
    await drawer.getByRole('button', { name: 'Add option' }).click();
    await drawer.getByRole('textbox', { name: 'Option 2 label' }).fill('Guides');
  });
  await addField(/^Number/, 'Views');

  await expect(page.getByRole('list', { name: 'Fields' }).getByRole('listitem')).toHaveCount(5);
  await reviewAndSave('Articles');

  const type = await schemaOf('types', 'articles');
  expect(type, 'the articles type exists in the schema').toBeTruthy();
  const fields = [...type.fields].sort((a: any, b: any) => a.position - b.position);
  expect(fields.map((f: any) => f.apiId)).toEqual(['title', 'slug', 'body', 'category', 'views']);
  expect(fields.map((f: any) => f.type)).toEqual(['text', 'slug', 'richtext', 'select', 'integer']);
  expect(fields[0].required).toBe(true);
  expect(fields[1].config.sourceField).toBe('title');
  expect(fields[3].config.options.map((o: any) => o.label)).toEqual(['News', 'Guides']);
});

// ─── 2. Create an entry ──────────────────────────────────────────────────────

test('creates an article in the entry editor', async () => {
  await open(page, `${ws.base}/content/articles`);
  await page.getByRole('link', { name: 'New article' }).first().click({ timeout: FIRST });
  await expect(titleInput()).toBeVisible({ timeout: FIRST });

  await titleInput().fill('First article');
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: 'News', exact: true }).click();
  await page.getByRole('textbox', { name: 'Body', exact: true }).click();
  await page.keyboard.type('Hello from the body');
  await page.getByRole('spinbutton', { name: 'Views' }).fill('42');

  await page.getByRole('button', { name: 'Create article' }).click();
  await expectToast(page, 'Article created');
  await page.waitForURL(ENTRY_URL);
  articleId = entryIdFromUrl();
  await expect(savedIndicator()).toBeVisible({ timeout: FIRST });
  await expect(titleInput()).toHaveValue('First article');

  const list = await apiFor(page).get(`${ws.envApi}/entries/articles`);
  expect(list.items.map((e: any) => e.id)).toEqual([articleId]);
  expect(list.items[0].title).toBe('First article');
  const detail = await apiFor(page).get(`${ws.envApi}/entry/${articleId}`);
  expect(detail.data.title).toBe('First article');
  expect(detail.data.category).toBe('news');
  expect(detail.data.views).toBe(42);
  expect(JSON.stringify(detail.data.body)).toContain('Hello from the body');
});

// ─── 3. Publish ──────────────────────────────────────────────────────────────

test('publishes the article and serves it through the delivery API', async () => {
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expectToast(page, 'Published');
  await expect(statusRow()).toHaveText(/Published$/);

  deliveryKey = await createDeliveryKey(page, ws);
  const live = await liveArticles();
  expect(live).toHaveLength(1);
  expect(live[0].title).toBe('First article');
  expect(live[0].slug).toBe('first-article');
});

// ─── 4. Edit a published entry ───────────────────────────────────────────────

test('keeps the old title live until edited content is published again', async () => {
  await titleInput().fill('Second title');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Saved at \d\d:\d\d/ }).first()).toBeVisible();
  await expect(statusRow()).toHaveText(/Modified$/);

  const draft = await apiFor(page).get(`${ws.envApi}/entry/${articleId}`);
  expect(draft.data.title).toBe('Second title');
  expect((await liveArticles()).map((a) => a.title)).toEqual(['First article']);

  await page.getByRole('button', { name: 'Publish changes', exact: true }).click();
  await expectToast(page, 'Changes published');
  await expect(statusRow()).toHaveText(/Published$/);
  expect((await liveArticles()).map((a) => a.title)).toEqual(['Second title']);
});

// ─── 5. Validation ───────────────────────────────────────────────────────────

test('refuses to publish an article without its required title', async () => {
  await open(page, `${ws.base}/content/articles/new`);
  await expect(titleInput()).toBeVisible({ timeout: FIRST });
  await page.getByRole('spinbutton', { name: 'Views' }).fill('7');
  await page.getByRole('button', { name: 'Create article' }).click();
  await page.waitForURL(ENTRY_URL);
  untitledId = entryIdFromUrl();
  expect(untitledId).not.toBe(articleId);

  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(publish).toBeEnabled({ timeout: FIRST });
  await publish.click();

  // The message is attached to the Title input itself.
  await expect(titleInput()).toHaveAttribute('aria-invalid', 'true');
  const describedBy = await titleInput().getAttribute('aria-describedby');
  expect(describedBy, 'the Title input points at its error message').toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(/required/i);

  await expect(statusRow()).toHaveText(/Draft$/);
  const detail = await apiFor(page).get(`${ws.envApi}/entry/${untitledId}`);
  expect(detail.isPublished).toBe(false);
  expect((await liveArticles()).map((a) => a.title)).toEqual(['Second title']);
});

// ─── 6. Versions ─────────────────────────────────────────────────────────────

test('restores the first version from the version history', async () => {
  await open(page, `${ws.base}/content/articles/${articleId}`);
  await expect(titleInput()).toHaveValue('Second title', { timeout: FIRST });

  const versions = page.getByRole('tabpanel').getByText(/^Version \d+$/);
  await expect(versions.first()).toBeVisible();
  expect(await versions.count()).toBeGreaterThanOrEqual(2);

  await page.getByRole('checkbox', { name: 'Select version 1', exact: true }).check();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('dialog', { name: 'Restore version 1?' }).getByRole('button', { name: 'Restore version' }).click();
  await expectToast(page, 'Restored version 1');

  await expect(titleInput()).toHaveValue('First article');
  const detail = await apiFor(page).get(`${ws.envApi}/entry/${articleId}`);
  expect(detail.data.title).toBe('First article');
  // Restoring only touches the working copy.
  expect((await liveArticles()).map((a) => a.title)).toEqual(['Second title']);
});

// ─── 7. List screen ──────────────────────────────────────────────────────────

test('searches, filters, bulk-unpublishes, trashes and restores from the list', async () => {
  const listUrl = `${ws.base}/content/articles`;
  await open(page, listUrl);
  const table = page.getByRole('table', { name: 'Articles' });
  const first = table.getByRole('link', { name: 'First article', exact: true });
  const untitled = table.getByRole('link', { name: 'Untitled article', exact: true });
  await expect(first).toBeVisible({ timeout: FIRST });
  await expect(untitled).toBeVisible();

  // Row action: publish the restored content, so the two entries differ in status.
  await page.getByRole('button', { name: 'Actions for First article' }).click();
  await page.getByRole('menuitem', { name: 'Publish changes' }).click();
  await expectToast(page, /Published “First article”/);
  await expect(table.getByRole('row').filter({ has: page.getByRole('link', { name: 'First article', exact: true }) })).toContainText('Published');
  expect((await liveArticles()).map((a) => a.title)).toEqual(['First article']);

  // Search
  const search = page.getByPlaceholder('Search articles…');
  await search.fill('First');
  await expect(untitled).toBeHidden();
  await expect(first).toBeVisible();
  await search.fill('no-such-article-zzz');
  await expect(page.getByText('No articles match')).toBeVisible();
  await search.fill('');
  await expect(untitled).toBeVisible();

  // Status filter
  const status = page.getByRole('combobox', { name: 'Filter by status' });
  await status.click();
  await page.getByRole('option', { name: 'Published', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(untitled).toBeHidden();
  await expect(first).toBeVisible();
  await status.click();
  await page.getByRole('option', { name: 'Published', exact: true }).click();
  await page.getByRole('option', { name: 'Draft', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(first).toBeHidden();
  await expect(untitled).toBeVisible();
  await open(page, listUrl);
  await expect(first).toBeVisible({ timeout: FIRST });

  // Bulk unpublish
  await page.getByRole('checkbox', { name: 'Select First article', exact: true }).check();
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Unpublish' }).click();
  await page.getByRole('dialog', { name: 'Unpublish 1 entry?' }).getByRole('button', { name: 'Unpublish' }).click();
  await expectToast(page, '1 entry unpublished');
  expect(await liveArticles()).toEqual([]);
  await expect(table.getByRole('row').filter({ has: page.getByRole('link', { name: 'First article', exact: true }) })).toContainText('Draft');

  // Trash and restore
  await page.getByRole('button', { name: 'Actions for First article' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await expectToast(page, 'Moved to trash');
  await expect(first).toBeHidden();
  await expect(untitled).toBeVisible();

  await page.getByRole('tab', { name: 'Trash' }).click();
  await expect(first).toBeVisible();
  await expect(untitled).toBeHidden();
  await page.getByRole('button', { name: 'Actions for First article' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expectToast(page, /Restored “First article”/);
  await expect(page.getByText('The trash is empty')).toBeVisible();

  await page.getByRole('tab', { name: 'All articles' }).click();
  await expect(first).toBeVisible();
  const list = await apiFor(page).get(`${ws.envApi}/entries/articles`);
  expect(list.items.map((e: any) => e.id).sort()).toEqual([articleId, untitledId].sort());
});

// ─── 8. Schema safety ────────────────────────────────────────────────────────

test('demands explicit confirmation before removing a field that holds data', async () => {
  await open(page, `${ws.base}/model/types/articles`);
  await expect(page.getByRole('button', { name: 'Edit field Views', exact: true })).toBeVisible({ timeout: FIRST });
  await page.getByRole('button', { name: 'Remove Views', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit field Views', exact: true })).toBeHidden();

  await page.getByRole('button', { name: 'Review and save' }).click();
  const review = page.getByRole('dialog', { name: /Review changes to Articles/ });
  await expect(review.getByText('This discards stored values')).toBeVisible();
  const confirm = review.getByRole('button', { name: 'Discard values and save' });
  await expect(confirm).toBeDisabled();
  // Nothing was stored by merely opening the review.
  expect((await schemaOf('types', 'articles')).fields.map((f: any) => f.apiId)).toContain('views');

  await review.getByRole('checkbox', { name: /I understand/ }).check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expectToast(page, 'Articles schema saved');
  await expect(review).toBeHidden();

  const type = await schemaOf('types', 'articles');
  expect(type.fields.map((f: any) => f.apiId).sort()).toEqual(['body', 'category', 'slug', 'title']);
});

// ─── 9. Components ───────────────────────────────────────────────────────────

test('creates a component and uses it as a field of Articles', async () => {
  await open(page, `${ws.base}/model/components`);
  await page.getByRole('button', { name: 'New component' }).first().click({ timeout: FIRST });
  const dialog = page.getByRole('dialog', { name: 'New component' });
  await dialog.getByRole('textbox', { name: 'Display name' }).fill('Seo meta');
  await expect(dialog.getByRole('textbox', { name: 'API identifier' })).toHaveValue('seo-meta');
  await dialog.getByRole('button', { name: 'Create and add fields' }).click();

  await page.waitForURL(/\/model\/components\/seo-meta$/);
  await expect(page.getByRole('button', { name: 'Add field', exact: true }).first()).toBeVisible({ timeout: FIRST });
  await addField(/^Short text/, 'Meta title');
  await addField(/^Long text/, 'Meta description');
  await reviewAndSave('Seo meta');

  const component = await schemaOf('components', 'seo-meta');
  expect(component, 'the component exists in the schema').toBeTruthy();
  expect(component.fields.map((f: any) => f.apiId).sort()).toEqual(['metaDescription', 'metaTitle']);

  await open(page, `${ws.base}/model/types/articles`);
  await expect(page.getByRole('button', { name: 'Edit field Title', exact: true })).toBeVisible({ timeout: FIRST });
  await addField(/^Component/, 'Seo', async (drawer) => {
    await drawer.getByRole('tab', { name: 'Structure' }).click();
    await drawer.getByRole('combobox', { name: /^Component/ }).click();
    await page.getByRole('option', { name: /Seo meta/ }).click();
  });
  await reviewAndSave('Articles');

  const type = await schemaOf('types', 'articles');
  const seo = type.fields.find((f: any) => f.apiId === 'seo');
  expect(seo, 'Articles has the component field').toBeTruthy();
  expect(seo.type).toBe('component');
  expect(seo.config.component).toBe('seo-meta');
});
