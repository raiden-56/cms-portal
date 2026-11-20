import { readFile } from 'node:fs/promises';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { type Api, type Workspace, apiFor, createDeliveryKey, createWorkspace, delivery, expectToast, open } from './helpers';

/**
 * Editorial work beyond create-and-publish: the review and approval workflow, scheduling,
 * comments, locale variants, dynamic zones, and the list tools (saved views, columns,
 * export and import).
 *
 * The content model is created through the management API so each test can concentrate on
 * one editor feature. Every behaviour under test is driven through the UI, then checked
 * against the management API and — where it matters — against what the delivery API serves.
 */
test.describe.configure({ mode: 'serial', timeout: 150_000 });

/** The dev server compiles each screen on first visit, so the first assertion after a navigation waits longer. */
const FIRST = { timeout: 30_000 };

let context: BrowserContext;
let page: Page;
let ws: Workspace;
let api: Api;
let deliveryKey = '';
/** The file produced by the export test, re-used by the import test. */
let exported: { contentType: string; items: { documentId: string; locale: string; status: string; isPublished: boolean; data: Record<string, unknown> }[] } | null = null;

const text = (apiId: string, label: string, extra: Record<string, unknown> = {}) => ({ apiId, label, type: 'text', config: {}, ...extra });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  context = await browser.newContext();
  page = await context.newPage();
  ws = await createWorkspace(page, 'Editorial');
  api = apiFor(page);

  await api.post(`${ws.projectApi}/locales`, { code: 'fr', name: 'French' });

  const components = [
    { apiId: 'quote', displayName: 'Quote', fields: [text('quoteText', 'Quote text'), text('author', 'Author')] },
    { apiId: 'callout', displayName: 'Callout', fields: [text('heading', 'Heading'), { apiId: 'body', label: 'Body', type: 'textarea', config: {} }] },
    { apiId: 'banner', displayName: 'Banner', fields: [text('message', 'Message')] },
  ];
  for (const component of components) await api.post(`${ws.envApi}/components`, component);

  const title = text('title', 'Title', { required: true });
  const summary = { apiId: 'summary', label: 'Summary', type: 'textarea', config: {} };
  const types = [
    // Approval is switched on through the Workflows screen in the first test.
    { apiId: 'stories', displayName: 'Stories', singularName: 'Story', pluralName: 'Stories', options: { titleField: 'title' }, fields: [title, summary] },
    { apiId: 'posts', displayName: 'Posts', singularName: 'Post', pluralName: 'Posts', options: { titleField: 'title', localized: true }, fields: [title, summary] },
    { apiId: 'landings', displayName: 'Landings', singularName: 'Landing', pluralName: 'Landings', options: { titleField: 'title' }, fields: [title, { apiId: 'sections', label: 'Sections', type: 'dynamiczone', config: {} }] },
    {
      apiId: 'notes',
      displayName: 'Notes',
      singularName: 'Note',
      pluralName: 'Notes',
      options: { titleField: 'title' },
      fields: [
        title,
        { apiId: 'category', label: 'Category', type: 'select', config: { options: [{ value: 'news', label: 'News' }, { value: 'guides', label: 'Guides' }] } },
        { apiId: 'priority', label: 'Priority', type: 'integer', config: {} },
      ],
    },
  ];
  for (const type of types) await api.post(`${ws.envApi}/content-types`, type);

  const notes = [
    { title: 'Alpha note', category: 'news', priority: 1 },
    { title: 'Beta note', category: 'guides', priority: 2 },
    { title: 'Gamma note', category: 'guides', priority: 3 },
  ];
  for (const [index, data] of notes.entries()) {
    const note = await api.post(`${ws.envApi}/entries/notes`, { data });
    if (index === 0) await api.post(`${ws.envApi}/entry/${note.id}/publish`);
  }

  deliveryKey = await createDeliveryKey(page, ws);
});

test.afterAll(async () => {
  await context?.close();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const titleInput = () => page.getByRole('textbox', { name: 'Title', exact: true });
/** The "Status" heading and the status chip next to it in the editor's side rail. */
const statusRow = () => page.getByRole('heading', { name: 'Status', exact: true }).locator('xpath=..');
const publishButton = () => page.getByRole('button', { name: 'Publish', exact: true });
const submitButton = () => page.getByRole('button', { name: 'Submit for review', exact: true });
/** Items of the Comments tab in the editor's side rail. */
const comments = () => page.getByRole('tabpanel').getByRole('listitem');
const idFromUrl = () => new URL(page.url()).pathname.split('/').pop() as string;
const entryUrl = (type: string) => new RegExp(`/content/${type}/(?!new$)[^/?#]+$`);

const getEntry = (id: string) => api.get(`${ws.envApi}/entry/${id}`);
const createDraft = (type: string, data: Record<string, unknown>) => api.post(`${ws.envApi}/entries/${type}`, { data });
const preference = async (key: string) => (await api.get(`/auth/me/preferences/${key}`)).value;

/** What a connected website sees for a collection. */
async function live(type: string, query = ''): Promise<any[]> {
  const res = await delivery(page, deliveryKey, `/${type}${query}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.data)).toBe(true);
  return res.body.data;
}

async function openEntry(type: string, id: string, title: string) {
  await open(page, `${ws.base}/content/${type}/${id}`);
  await expect(titleInput()).toHaveValue(title, FIRST);
}

/** Saves through the "Save draft" button and waits until the editor reports the save. */
async function saveDraft() {
  const button = page.getByRole('button', { name: 'Save draft' });
  await button.click();
  await expect(page.getByRole('status').filter({ hasText: /Saved at \d\d:\d\d/ }).first()).toBeVisible();
  await expect(button).toBeDisabled();
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Value of an <input type="datetime-local"> in the machine's timezone (the browser uses the same one). */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** How the admin prints a date and time. */
const shownTime = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ─── 1–3. Review and approval ────────────────────────────────────────────────

test('approval: content that needs approval cannot go live until a reviewer approves it', async () => {
  // The rule itself is switched on from the Workflows screen.
  await open(page, `${ws.base}/publishing/workflows`);
  const rule = page.getByLabel('Require approval for Stories', { exact: true });
  await expect(rule).not.toBeChecked(FIRST);
  // The switch shows the stored rule, so it only flips once the server has accepted the change.
  await rule.click();
  await expectToast(page, 'Stories now need approval before publishing');
  await expect(rule).toBeChecked();
  const schema = await api.get(`${ws.envApi}/schema`);
  expect((schema.types as any[]).find((t) => t.apiId === 'stories').options.requireApproval).toBe(true);

  await open(page, `${ws.base}/content/stories/new`);
  await expect(titleInput()).toBeVisible(FIRST);
  await titleInput().fill('Quarterly results');
  await page.getByRole('button', { name: 'Create story' }).click();
  await page.waitForURL(entryUrl('stories'));
  const id = idFromUrl();
  await expect(statusRow()).toHaveText(/Draft$/, FIRST);

  // Publishing is closed in the UI and refused by the server.
  await expect(publishButton()).toBeDisabled();
  await expect(page.getByText('Stories need approval before they can be published.')).toBeVisible();
  await expect(api.post(`${ws.envApi}/entry/${id}/publish`)).rejects.toThrow(/→ 409/);

  await submitButton().click();
  await expect(statusRow()).toHaveText(/In review$/);
  await expect(page.getByText('Waiting for a reviewer to approve or request changes.')).toBeVisible();
  expect((await getEntry(id)).status).toBe('IN_REVIEW');
  await expect(publishButton()).toBeDisabled();
  await expect(api.post(`${ws.envApi}/entry/${id}/publish`)).rejects.toThrow(/→ 409/);
  expect(await live('stories')).toEqual([]);

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const approve = page.getByRole('dialog', { name: 'Approve' });
  await approve.getByRole('textbox', { name: 'Note for the author (optional)' }).fill('Numbers checked against the ledger');
  await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(approve).toBeHidden();
  await expect(statusRow()).toHaveText(/Approved$/);
  expect((await getEntry(id)).status).toBe('APPROVED');
  // Approved is still not published.
  expect(await live('stories')).toEqual([]);

  await expect(publishButton()).toBeEnabled();
  await publishButton().click();
  await expect(statusRow()).toHaveText(/Published$/);
  expect((await live('stories')).map((s) => s.title)).toEqual(['Quarterly results']);

  // The reviewer's note is kept with the entry.
  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(comments().filter({ hasText: 'Numbers checked against the ledger' })).toContainText('Approval');
});

test('approval: requested changes return an entry to its author, and editing approved content needs a new approval', async () => {
  const story = await createDraft('stories', { title: 'Needs work' });
  await openEntry('stories', story.id, 'Needs work');
  await submitButton().click();
  await expect(statusRow()).toHaveText(/In review$/);

  // A reviewer has to say what is wrong.
  await page.getByRole('button', { name: 'Request changes', exact: true }).click();
  const request = page.getByRole('dialog', { name: 'Request changes' });
  await request.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(request.getByText('This is required')).toBeVisible();
  expect((await getEntry(story.id)).status).toBe('IN_REVIEW');
  await request.getByRole('textbox', { name: 'What needs to change?' }).fill('Add a summary before this goes out');
  await request.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expect(request).toBeHidden();
  await expect(statusRow()).toHaveText(/Changes requested$/);

  // The editor switches to the comments, where the note is shown.
  await expect(page.getByRole('tab', { name: 'Comments' })).toHaveAttribute('aria-selected', 'true');
  await expect(comments().filter({ hasText: 'Add a summary before this goes out' })).toContainText('Changes requested');
  expect((await getEntry(story.id)).status).toBe('CHANGES_REQUESTED');
  const stored = (await api.get(`${ws.envApi}/entry/${story.id}/comments`)).items;
  expect(stored.map((c: any) => [c.kind, c.body])).toEqual([['changes_requested', 'Add a summary before this goes out']]);

  // The author fixes it and resubmits; a submission can also be withdrawn.
  await page.getByRole('textbox', { name: 'Summary', exact: true }).fill('A short summary of the story');
  await saveDraft();
  await expect(statusRow()).toHaveText(/Changes requested$/);
  await submitButton().click();
  await expect(statusRow()).toHaveText(/In review$/);
  await page.getByRole('button', { name: 'Withdraw from review' }).click();
  await expect(statusRow()).toHaveText(/Draft$/);
  expect((await getEntry(story.id)).status).toBe('DRAFT');

  await submitButton().click();
  await expect(statusRow()).toHaveText(/In review$/);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const approve = page.getByRole('dialog', { name: 'Approve' });
  await approve.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(approve).toBeHidden();
  await expect(statusRow()).toHaveText(/Approved$/);
  await expect(publishButton()).toBeEnabled();

  // Approval covers the exact content: an edit sends the entry back to draft.
  await titleInput().fill('Needs work, revised');
  await saveDraft();
  await expect(statusRow()).toHaveText(/Draft$/);
  await expect(publishButton()).toBeDisabled();
  const after = await getEntry(story.id);
  expect(after.status).toBe('DRAFT');
  expect(after.isPublished).toBe(false);
  await expect(api.post(`${ws.envApi}/entry/${story.id}/publish`)).rejects.toThrow(/→ 409/);
  expect((await live('stories')).map((s) => s.title)).toEqual(['Quarterly results']);
});

test('approval: the review queue requests changes, resubmits, approves and publishes', async () => {
  const story = await createDraft('stories', { title: 'Queue story' });
  await api.post(`${ws.envApi}/entry/${story.id}/transition`, { action: 'submit' });

  await open(page, `${ws.base}/publishing/workflows`);
  const queue = page.getByRole('tablist', { name: 'Review queue' });
  const row = (status: string) => page.getByRole('table', { name: `${status} entries` }).getByRole('row').filter({ hasText: 'Queue story' });
  await expect(row('In review')).toBeVisible(FIRST);

  await row('In review').getByRole('button', { name: 'Request changes' }).click();
  const request = page.getByRole('dialog', { name: /Request changes on “Queue story”/ });
  await request.getByRole('textbox', { name: 'What needs to change?' }).fill('Tighten the introduction');
  await request.getByRole('button', { name: 'Request changes', exact: true }).click();
  await expectToast(page, 'Changes requested');
  await expect(page.getByText('Nothing is waiting for review')).toBeVisible();
  expect((await getEntry(story.id)).status).toBe('CHANGES_REQUESTED');

  await queue.getByRole('tab', { name: /^Changes requested/ }).click();
  await row('Changes requested').getByRole('button', { name: 'Resubmit' }).click();
  await expectToast(page, 'Resubmitted “Queue story”');
  await expect(page.getByText('No changes have been requested')).toBeVisible();
  expect((await getEntry(story.id)).status).toBe('IN_REVIEW');

  await queue.getByRole('tab', { name: /^In review/ }).click();
  await row('In review').getByRole('button', { name: 'Approve' }).click();
  await expectToast(page, 'Approved “Queue story”');
  await expect(page.getByText('Nothing is waiting for review')).toBeVisible();
  expect((await getEntry(story.id)).status).toBe('APPROVED');
  expect((await live('stories')).map((s) => s.title)).not.toContain('Queue story');

  await queue.getByRole('tab', { name: /^Approved/ }).click();
  await row('Approved').getByRole('button', { name: 'Publish' }).click();
  await expectToast(page, 'Published “Queue story”');
  await expect(page.getByText('Nothing is approved and waiting')).toBeVisible();
  expect((await live('stories')).map((s) => s.title).sort()).toEqual(['Quarterly results', 'Queue story']);

  const stored = (await api.get(`${ws.envApi}/entry/${story.id}/comments`)).items;
  expect(stored.map((c: any) => [c.kind, c.body])).toEqual([['changes_requested', 'Tighten the introduction']]);
});

// ─── 4. Scheduling ───────────────────────────────────────────────────────────

test('schedule dialog: schedules a publish, lists it as upcoming and clears it again', async () => {
  const post = await createDraft('posts', { title: 'Launch post' });
  await openEntry('posts', post.id, 'Launch post');

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Schedule “Launch post”/ });
  const publishAt = dialog.getByLabel('Publish at', { exact: true });

  // A time in the past is refused before anything is sent.
  await publishAt.fill('2020-01-01T09:00');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog.getByText('Choose a time in the future')).toBeVisible();
  expect((await getEntry(post.id)).scheduledPublishAt).toBeNull();

  const when = new Date(Date.now() + 26 * 3600 * 1000);
  when.setSeconds(0, 0);
  await publishAt.fill(localInput(when));
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expectToast(page, 'Schedule saved');
  await expect(dialog).toBeHidden();
  await expect(statusRow()).toHaveText(/Scheduled$/);
  await expect(page.getByText(`Publishes ${shownTime(when)}`)).toBeVisible();

  const scheduled = await getEntry(post.id);
  expect(scheduled.status).toBe('SCHEDULED');
  expect(new Date(scheduled.scheduledPublishAt).getTime()).toBe(when.getTime());
  // Scheduled is not live.
  expect(scheduled.isPublished).toBe(false);
  expect((await live('posts')).filter((p) => p.id === post.documentId)).toEqual([]);

  await open(page, `${ws.base}/publishing/scheduled`);
  const slot = page.getByRole('listitem').filter({ hasText: 'Launch post' });
  await expect(slot).toBeVisible(FIRST);
  await expect(slot).toContainText('Publish');
  await expect(page.getByText('1 upcoming')).toBeVisible();

  // Back in the editor, the dialog shows the stored time and can clear it.
  await openEntry('posts', post.id, 'Launch post');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(publishAt).toHaveValue(localInput(when));
  await dialog.getByRole('button', { name: 'Clear schedule' }).click();
  await expectToast(page, 'Schedule cleared');
  await expect(dialog).toBeHidden();
  await expect(statusRow()).toHaveText(/Draft$/);
  await expect(page.getByText(/^Publishes /)).toHaveCount(0);

  const cleared = await getEntry(post.id);
  expect(cleared.status).toBe('DRAFT');
  expect(cleared.scheduledPublishAt).toBeNull();
  expect((await api.get(`${ws.envApi}/scheduled`)).items).toEqual([]);
});

// ─── 5. Comments ─────────────────────────────────────────────────────────────

test('comments: adds, resolves, reopens and deletes comments on an entry', async () => {
  const post = await createDraft('posts', { title: 'Discussed post' });
  await openEntry('posts', post.id, 'Discussed post');
  const stored = async () => (await api.get(`${ws.envApi}/entry/${post.id}/comments`)).items as any[];

  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(page.getByText('No comments yet.')).toBeVisible();

  const box = page.getByRole('textbox', { name: 'New comment' });
  const send = page.getByRole('button', { name: 'Comment', exact: true });
  await expect(send).toBeDisabled();
  await box.fill('Is the headline final?');
  await send.click();
  const first = comments().filter({ hasText: 'Is the headline final?' });
  await expect(first).toBeVisible();
  await expect(first).toContainText('Editorial Tester');
  await expect(box).toHaveValue('');

  // Ctrl+Enter sends the comment — and must not trigger the editor's own Ctrl+Enter (publish).
  await box.fill('Sent from the keyboard');
  await box.press('Control+Enter');
  const second = comments().filter({ hasText: 'Sent from the keyboard' });
  await expect(second).toBeVisible();
  expect((await stored()).map((c) => c.body)).toEqual(['Is the headline final?', 'Sent from the keyboard']);
  const untouched = await getEntry(post.id);
  expect(untouched.isPublished).toBe(false);
  expect(untouched.openComments).toBe(2);
  await expect(statusRow()).toHaveText(/Draft$/);

  await first.getByRole('button', { name: 'Mark comment as resolved' }).click();
  await expect(first.getByRole('button', { name: 'Reopen comment' })).toHaveAttribute('aria-pressed', 'true');
  await expect(first).toContainText('Resolved');
  await expect(second).not.toContainText('Resolved');
  expect((await stored()).map((c) => !!c.resolvedAt)).toEqual([true, false]);
  expect((await getEntry(post.id)).openComments).toBe(1);

  await first.getByRole('button', { name: 'Reopen comment' }).click();
  await expect(first.getByRole('button', { name: 'Mark comment as resolved' })).toBeVisible();
  expect((await stored()).map((c) => !!c.resolvedAt)).toEqual([false, false]);

  await first.getByRole('button', { name: 'Delete comment' }).click();
  await page.getByRole('dialog', { name: 'Delete this comment?' }).getByRole('button', { name: 'Delete' }).click();
  await expect(first).toHaveCount(0);
  await expect(second).toBeVisible();
  expect((await stored()).map((c) => c.body)).toEqual(['Sent from the keyboard']);
});

// ─── 6. Locales ──────────────────────────────────────────────────────────────

test('locales: a translation is edited and published on its own, and delivered per locale', async () => {
  const en = await createDraft('posts', { title: 'Hello world', summary: 'English summary' });
  const byId = (query = '') => delivery(page, deliveryKey, `/posts/${en.documentId}${query}`);
  const ofDocument = async (query = '') => (await live('posts', query)).filter((p) => p.id === en.documentId).map((p) => [p.locale, p.title]);

  await openEntry('posts', en.id, 'Hello world');
  const locale = page.getByRole('combobox', { name: /^Locale/ });
  await expect(locale).toContainText('English (en)');

  // Choosing a locale without a translation creates one from the current content.
  await locale.click();
  await page.getByRole('option', { name: /French \(fr\)/ }).click();
  await expectToast(page, 'fr translation created from this version');
  await page.waitForURL((url) => entryUrl('posts').test(url.pathname) && !url.pathname.endsWith(en.id));
  const frId = idFromUrl();
  await expect(locale).toContainText('French (fr)');
  await expect(titleInput()).toHaveValue('Hello world');

  await titleInput().fill('Bonjour le monde');
  await saveDraft();
  await publishButton().click();
  await expect(statusRow()).toHaveText(/Published$/);

  const fr = await getEntry(frId);
  expect(fr.locale).toBe('fr');
  expect(fr.documentId).toBe(en.documentId);
  expect(fr.data.title).toBe('Bonjour le monde');
  expect(fr.variants.map((v: any) => v.locale).sort()).toEqual(['en', 'fr']);
  // The English draft was not touched by editing the translation.
  expect((await getEntry(en.id)).data.title).toBe('Hello world');

  // Only the French version is live so far.
  expect(await ofDocument('?locale=fr')).toEqual([['fr', 'Bonjour le monde']]);
  expect(await ofDocument()).toEqual([]);
  expect((await byId()).status).toBe(404);
  expect((await byId('?locale=fr')).body.data.title).toBe('Bonjour le monde');

  // Switch back to English through the same control and publish it too.
  await locale.click();
  await page.getByRole('option', { name: /English \(en\)/ }).click();
  await page.waitForURL((url) => url.pathname.endsWith(en.id));
  await expect(titleInput()).toHaveValue('Hello world');
  await expect(locale).toContainText('English (en)');
  await expect(statusRow()).toHaveText(/Draft$/);
  await publishButton().click();
  await expect(statusRow()).toHaveText(/Published$/);

  expect(await ofDocument()).toEqual([['en', 'Hello world']]);
  expect(await ofDocument('?locale=fr')).toEqual([['fr', 'Bonjour le monde']]);
  const english = await byId();
  expect([english.status, english.body.data.locale, english.body.data.title]).toEqual([200, 'en', 'Hello world']);
  const french = await byId('?locale=fr');
  expect([french.status, french.body.data.locale, french.body.data.title]).toEqual([200, 'fr', 'Bonjour le monde']);

  // The list shows every locale and can be narrowed to one.
  await open(page, `${ws.base}/content/posts`);
  const table = page.getByRole('table', { name: 'Posts' });
  const englishRow = table.getByRole('link', { name: 'Hello world', exact: true });
  const frenchRow = table.getByRole('link', { name: 'Bonjour le monde', exact: true });
  await expect(frenchRow).toBeVisible(FIRST);
  await expect(englishRow).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by locale' }).click();
  await page.getByRole('option', { name: 'French (fr)', exact: true }).click();
  await expect(englishRow).toBeHidden();
  await expect(frenchRow).toBeVisible();
});

// ─── 7–8. Dynamic zones ──────────────────────────────────────────────────────

test('dynamic zones: limits a zone to chosen components from the Dynamic zones screen', async () => {
  await open(page, `${ws.base}/model/zones`);
  const row = page.getByRole('table', { name: 'Dynamic zones' }).getByRole('row').filter({ hasText: 'Sections' });
  await expect(row).toContainText('Landings', FIRST);
  await expect(row).toContainText('Any component');
  await expect(row).toContainText('No limit');

  await page.getByRole('button', { name: 'Edit Sections in Landings' }).click();
  const dialog = page.getByRole('dialog', { name: /Sections/ });
  const allowed = dialog.getByRole('combobox', { name: 'Allowed components' });
  await allowed.click();
  await page.getByRole('option', { name: 'Quote', exact: true }).click();
  await page.getByRole('option', { name: 'Callout', exact: true }).click();
  // Closes the option list only; the dialog stays open.
  await allowed.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  // The limits are checked against each other before saving.
  await dialog.getByLabel('At least', { exact: true }).fill('5');
  await dialog.getByLabel('At most', { exact: true }).fill('3');
  await expect(dialog.getByRole('alert')).toHaveText('Maximum must not be less than the minimum');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await dialog.getByLabel('At least', { exact: true }).fill('');

  await dialog.getByRole('button', { name: 'Save' }).click();
  await expectToast(page, 'Sections updated');
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Quote');
  await expect(row).toContainText('Callout');
  await expect(row).not.toContainText('Banner');
  await expect(row).toContainText('0 – 3');

  const schema = await api.get(`${ws.envApi}/schema`);
  const zone = (schema.types as any[]).find((t) => t.apiId === 'landings').fields.find((f: any) => f.apiId === 'sections');
  expect(zone.config.allowedComponents).toEqual(['quote', 'callout']);
  expect(zone.config.maxItems).toBe(3);
  expect(zone.config.minItems).toBeUndefined();
});

test('dynamic zones: adds, fills, reorders and removes components in the entry editor', async () => {
  const sectionsOf = async (id: string) => (await getEntry(id)).data.sections as { type: string; props: Record<string, unknown> }[];
  const cardTitles = () => page.getByText(/^(Ship it|Read the guide)$/);

  await open(page, `${ws.base}/content/landings/new`);
  await expect(titleInput()).toBeVisible(FIRST);
  await titleInput().fill('Spring launch');

  // Only the components allowed in the previous test are offered.
  const add = page.getByRole('button', { name: 'Add component', exact: true });
  await add.click();
  await expect(page.getByRole('menuitem', { name: 'Quote', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Callout', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Banner', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Quote', exact: true }).click();
  await page.getByRole('button', { name: 'Expand item' }).click();
  await page.getByRole('textbox', { name: 'Quote text', exact: true }).fill('Ship it');
  await page.getByRole('textbox', { name: 'Author', exact: true }).fill('The team');

  await add.click();
  await page.getByRole('menuitem', { name: 'Callout', exact: true }).click();
  // The quote is already open, so the only collapsed item is the new one.
  await page.getByRole('button', { name: 'Expand item' }).click();
  await page.getByRole('textbox', { name: 'Heading', exact: true }).fill('Read the guide');

  await page.getByRole('button', { name: 'Create landing' }).click();
  await page.waitForURL(entryUrl('landings'));
  const id = idFromUrl();
  // The address changes a moment before the saved entry's editor replaces the "new" form.
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible(FIRST);
  await expect(titleInput()).toHaveValue('Spring launch');
  let sections = await sectionsOf(id);
  expect(sections.map((s) => s.type)).toEqual(['quote', 'callout']);
  expect(sections[0].props).toMatchObject({ quoteText: 'Ship it', author: 'The team' });
  expect(sections[1].props).toMatchObject({ heading: 'Read the guide' });
  await expect(cardTitles()).toHaveText(['Ship it', 'Read the guide']);

  // Reorder, and confirm the order survives a reload.
  await page.getByRole('button', { name: 'Move up' }).nth(1).click();
  await expect(cardTitles()).toHaveText(['Read the guide', 'Ship it']);
  await saveDraft();
  expect((await sectionsOf(id)).map((s) => s.type)).toEqual(['callout', 'quote']);
  await page.reload();
  await expect(titleInput()).toHaveValue('Spring launch', FIRST);
  await expect(cardTitles()).toHaveText(['Read the guide', 'Ship it']);

  // The zone accepts at most three items.
  await add.click();
  await page.getByRole('menuitem', { name: 'Quote', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove item' })).toHaveCount(3);
  await expect(add).toBeDisabled();
  await page.getByRole('button', { name: 'Remove item' }).nth(2).click();
  await expect(add).toBeEnabled();

  // Remove the quote, save and publish: the website receives the remaining component.
  await page.getByRole('button', { name: 'Remove item' }).nth(1).click();
  await expect(cardTitles()).toHaveText(['Read the guide']);
  await saveDraft();
  sections = await sectionsOf(id);
  expect(sections.map((s) => s.type)).toEqual(['callout']);

  await publishButton().click();
  await expect(statusRow()).toHaveText(/Published$/);
  const published = await live('landings');
  expect(published).toHaveLength(1);
  expect(published[0].title).toBe('Spring launch');
  expect(published[0].sections.map((s: any) => [s.type, s.props.heading])).toEqual([['callout', 'Read the guide']]);
});

// ─── 9–12. List tools ────────────────────────────────────────────────────────

const notesUrl = () => `${ws.base}/content/notes`;
const notesTable = () => page.getByRole('table', { name: 'Notes' });
const noteLink = (title: string) => notesTable().getByRole('link', { name: title, exact: true });
const viewsButton = () => page.getByRole('button', { name: /^Views/ });

test('list: saves a filtered, sorted view, re-applies it after a reload and deletes it', async () => {
  await open(page, notesUrl());
  await expect(noteLink('Alpha note')).toBeVisible(FIRST);

  // Nothing to save while the list is in its default state.
  await viewsButton().click();
  await expect(page.getByRole('menuitem', { name: /Save current view/ })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('combobox', { name: /^Field/ }).click();
  await page.getByRole('option', { name: 'Category', exact: true }).click();
  await page.getByRole('combobox', { name: /^Value/ }).click();
  await page.getByRole('option', { name: 'Guides', exact: true }).click();
  await page.getByRole('button', { name: 'Apply filter' }).click();
  await expect(page.getByText('Category is Guides')).toBeVisible();
  await expect(noteLink('Alpha note')).toBeHidden();

  await notesTable().getByRole('columnheader', { name: 'Priority' }).getByRole('button').click();
  await expect(page).toHaveURL(/sort=priority/);
  await expect(notesTable().getByRole('link')).toHaveText(['Beta note', 'Gamma note']);

  await viewsButton().click();
  await page.getByRole('menuitem', { name: /Save current view/ }).click();
  const naming = page.getByRole('dialog', { name: 'Save view' });
  await naming.getByRole('textbox', { name: 'Name' }).fill('Guides by priority');
  await naming.getByRole('button', { name: 'Save view' }).click();
  await expectToast(page, 'View “Guides by priority” saved');
  await expect(viewsButton()).toHaveText('Views (1)');
  await expect
    .poll(async () => ((await preference('savedFilters.notes')) ?? []).map((v: any) => [v.name, v.params.sort, v.params.filters]))
    .toEqual([['Guides by priority', 'priority', [{ field: 'category', op: 'eq', value: 'guides' }]]]);

  // Back to the plain list, then reload: the view is stored for the user, not in the page.
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(noteLink('Alpha note')).toBeVisible();
  await open(page, notesUrl());
  await expect(noteLink('Alpha note')).toBeVisible(FIRST);
  await expect(viewsButton()).toHaveText('Views (1)');

  await viewsButton().click();
  await page.getByRole('menuitem', { name: /^Guides by priority/ }).click();
  await expect(page.getByText('Category is Guides')).toBeVisible();
  await expect(notesTable().getByRole('link')).toHaveText(['Beta note', 'Gamma note']);
  const url = new URL(page.url());
  expect(url.searchParams.getAll('f')).toEqual(['category~eq~guides']);
  expect(url.searchParams.get('sort')).toBe('priority');

  await viewsButton().click();
  await page.getByRole('button', { name: 'Delete view Guides by priority' }).click();
  await expect(page.getByRole('menuitem', { name: /^Guides by priority/ })).toHaveCount(0);
  // The deleted row held the focus, so the key is sent to the menu itself.
  await page.getByRole('menu').press('Escape');
  await expect(viewsButton()).toHaveText('Views');
  await expect.poll(() => preference('savedFilters.notes')).toEqual([]);
});

test('list: column choices are remembered for the user and can be reset', async () => {
  const header = (name: string) => notesTable().getByRole('columnheader', { name, exact: true });
  const chooseColumns = () => page.getByRole('button', { name: 'Choose columns' });

  await open(page, notesUrl());
  await expect(header('Category')).toBeVisible(FIRST);
  await expect(header('Priority')).toBeVisible();
  await expect(header('Created by')).toHaveCount(0);

  // The boxes show the stored choice, which updates a tick after the click — so click, then wait for the state.
  await chooseColumns().click();
  const category = page.getByRole('checkbox', { name: 'Category', exact: true });
  const createdBy = page.getByRole('checkbox', { name: 'Created by', exact: true });
  await expect(category).toBeChecked();
  await category.click();
  await expect(category).not.toBeChecked();
  await expect(createdBy).not.toBeChecked();
  await createdBy.click();
  await expect(createdBy).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(header('Category')).toHaveCount(0);
  await expect(header('Created by')).toBeVisible();
  await expect(notesTable().getByRole('row').filter({ hasText: 'Alpha note' })).toContainText('Editorial Tester');
  await expect.poll(() => preference('columns.notes')).toEqual(['f:priority', 'status', 'updatedAt', 'createdBy']);

  await page.reload();
  await expect(header('Created by')).toBeVisible(FIRST);
  await expect(header('Priority')).toBeVisible();
  await expect(header('Category')).toHaveCount(0);

  await chooseColumns().click();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.keyboard.press('Escape');
  await expect(header('Category')).toBeVisible();
  await expect(header('Created by')).toHaveCount(0);
  await expect.poll(() => preference('columns.notes')).toBeNull();
});

test('list: exports every entry of the type as a JSON file', async () => {
  await open(page, notesUrl());
  await expect(noteLink('Alpha note')).toBeVisible(FIRST);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  expect(download.suggestedFilename()).toBe('notes-export.json');
  const file = JSON.parse(await readFile(await download.path(), 'utf8'));

  expect(file.contentType).toBe('notes');
  expect(file.items.map((i: any) => [i.data.title, i.data.category, i.data.priority, i.isPublished, i.locale])).toEqual([
    ['Alpha note', 'news', 1, true, 'en'],
    ['Beta note', 'guides', 2, false, 'en'],
    ['Gamma note', 'guides', 3, false, 'en'],
  ]);
  exported = file;
});

test('list: imports entries from an export file and from pasted JSON, skipping invalid ones', async () => {
  expect(exported, 'the export test produced a file').toBeTruthy();
  const copies = { ...exported, items: exported!.items.map((item) => ({ ...item, data: { ...item.data, title: `${String(item.data.title)} (copy)` } })) };

  await open(page, notesUrl());
  await expect(noteLink('Alpha note')).toBeVisible(FIRST);
  const dialog = page.getByRole('dialog', { name: 'Import notes' });
  const json = dialog.getByRole('textbox', { name: 'JSON' });

  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await json.fill('{ "items": [');
  await expect(dialog.getByText(/This is not valid JSON/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Import/ })).toBeDisabled();

  // A Meridian export file is accepted as it is.
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'notes-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(copies)) });
  await expect(dialog.getByText('notes-export.json')).toBeVisible();
  await expect(dialog.getByText('3 entries ready to import')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 3', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('3 imported as drafts.');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  await expect(noteLink('Alpha note (copy)')).toBeVisible();
  await expect(noteLink('Gamma note (copy)')).toBeVisible();

  // Pasted JSON: valid entries are created, invalid ones are reported and left out.
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await json.fill(JSON.stringify({ items: [{ data: { title: 'Pasted note', category: 'news', priority: 9 } }, { data: { title: 'Broken note', category: 'nonsense' } }] }));
  await expect(dialog.getByText('2 entries ready to import')).toBeVisible();
  await dialog.getByRole('button', { name: 'Import 2', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('1 imported as drafts, 1 skipped.');
  await expect(dialog.getByText(/^Entry 2:/)).toBeVisible();
  await expect(dialog.getByText(/Category must be one of: News, Guides/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(noteLink('Pasted note')).toBeVisible();
  await expect(noteLink('Broken note')).toHaveCount(0);

  const all = (await api.get(`${ws.envApi}/entries/notes?pageSize=100`)).items as any[];
  expect(all.map((e) => e.title).sort()).toEqual(['Alpha note', 'Alpha note (copy)', 'Beta note', 'Beta note (copy)', 'Gamma note', 'Gamma note (copy)', 'Pasted note']);
  // Imported entries always start as drafts, whatever their state was in the source.
  const imported = all.filter((e) => /\(copy\)$|^Pasted/.test(e.title));
  expect(imported.every((e) => e.status === 'DRAFT' && !e.isPublished)).toBe(true);
  // Nothing new reached the website.
  expect((await live('notes')).map((n) => n.title)).toEqual(['Alpha note']);
});
