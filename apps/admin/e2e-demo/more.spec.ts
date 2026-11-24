import type { Page } from '@playwright/test';
import { BASE, ORG, backend, expect, expectToast, open, test, workspace } from './helpers';

/** More of the everyday actions, each checked against what the demo backend really stored. */

const statusRow = (page: Page) => page.getByRole('heading', { name: 'Status', exact: true }).locator('xpath=..');
const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

test('content list: filter by status, unpublish in bulk, trash and restore', async ({ page }) => {
  const ws = await (async () => {
    await open(page, `${BASE}/content/faqs`);
    return workspace(page);
  })();
  const table = page.getByRole('table', { name: 'FAQs' });
  const shipping = table.getByRole('link', { name: 'Do you ship internationally?', exact: true });
  const returns = table.getByRole('link', { name: 'Can I return an order?', exact: true });
  await expect(shipping).toBeVisible();
  const rowOf = (title: string) => table.getByRole('row').filter({ has: page.getByRole('link', { name: title, exact: true }) });

  await page.getByRole('checkbox', { name: 'Select Do you ship internationally?', exact: true }).check();
  await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Unpublish' }).click();
  await page.getByRole('dialog', { name: 'Unpublish 1 entry?' }).getByRole('button', { name: 'Unpublish' }).click();
  await expectToast(page, '1 entry unpublished');
  await expect(rowOf('Do you ship internationally?')).toContainText('Draft');

  const status = page.getByRole('combobox', { name: 'Filter by status' });
  await status.click();
  await page.getByRole('option', { name: 'Draft', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(returns).toBeHidden();
  await expect(shipping).toBeVisible();
  await open(page, `${BASE}/content/faqs`);

  await page.getByRole('button', { name: 'Actions for Can I return an order?' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click();
  await expectToast(page, 'Moved to trash');
  await expect(returns).toBeHidden();
  const listed = async () => ((await backend(page, 'GET', `${ws.envApi}/entries/faqs`)).body.items as { title: string }[]).map((e) => e.title).sort();
  expect(await listed()).toEqual(['Do you ship internationally?', 'How do I contact support?']);

  await page.getByRole('tab', { name: 'Trash' }).click();
  await page.getByRole('button', { name: 'Actions for Can I return an order?' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expectToast(page, /Restored “Can I return an order\?”/);
  await expect(page.getByText('The trash is empty')).toBeVisible();
  expect(await listed()).toHaveLength(3);
});

test('content model: removing a field that holds data needs explicit confirmation', async ({ page }) => {
  await open(page, `${BASE}/model/types/faqs`);
  await page.getByRole('button', { name: 'Remove Order', exact: true }).click();
  await page.getByRole('button', { name: 'Review and save' }).click();
  const review = page.getByRole('dialog', { name: /Review changes to FAQs/ });
  await expect(review.getByText('This discards stored values')).toBeVisible();
  const confirm = review.getByRole('button', { name: 'Discard values and save' });
  await expect(confirm).toBeDisabled();

  // Nothing is stored by opening the review.
  const ws = await workspace(page);
  const fields = async () => ((await backend(page, 'GET', `${ws.envApi}/content-types/faqs`)).body.fields as { apiId: string }[]).map((f) => f.apiId);
  expect(await fields()).toContain('order');

  await review.getByRole('checkbox', { name: /I understand/ }).check();
  await confirm.click();
  await expectToast(page, 'FAQs schema saved');
  expect(await fields()).toEqual(['question', 'answer']);
  const [faq] = (await backend(page, 'GET', `${ws.envApi}/entries/faqs`)).body.items as { data: Record<string, unknown> }[];
  expect(faq.data).not.toHaveProperty('order');
});

test('entry editor: schedule a publish, see it in Scheduled, and discuss it in comments', async ({ page }) => {
  await open(page, `${BASE}/content/products`);
  await page.getByRole('link', { name: 'Field Tote', exact: true }).click();
  await page.waitForURL(/\/content\/products\/[0-9a-f-]{36}$/);
  await expect(statusRow(page)).toHaveText(/Draft$/);

  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Schedule “Field Tote”/ });
  const publishAt = dialog.getByLabel('Publish at', { exact: true });
  await publishAt.fill('2020-01-01T09:00');
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expect(dialog.getByText('Choose a time in the future')).toBeVisible();

  const when = new Date(Date.now() + 26 * 3600 * 1000);
  when.setSeconds(0, 0);
  await publishAt.fill(localInput(when));
  await dialog.getByRole('button', { name: 'Save schedule' }).click();
  await expectToast(page, 'Schedule saved');
  await expect(statusRow(page)).toHaveText(/Scheduled$/);

  await page.getByRole('tab', { name: 'Comments' }).click();
  await page.getByRole('textbox', { name: 'New comment' }).fill('Photos arrive on Thursday.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  const comment = page.getByRole('tabpanel').getByRole('listitem').filter({ hasText: 'Photos arrive on Thursday.' });
  await expect(comment).toContainText('Guest');
  await comment.getByRole('button', { name: 'Mark comment as resolved' }).click();
  await expect(comment).toContainText('Resolved');

  await open(page, `${BASE}/publishing/scheduled`);
  await expect(page.getByRole('listitem').filter({ hasText: 'Field Tote' })).toContainText('Publish');
  // The two schedules from the demo data are listed with it.
  await expect(page.getByRole('listitem').filter({ hasText: 'Careers' })).toBeVisible();
  await expect(page.getByText('3 upcoming')).toBeVisible();
});

test('settings: add a locale and rename the project', async ({ page }) => {
  await open(page, `${ORG}/admin/settings`);
  await page.getByRole('tab', { name: 'Locales' }).click();
  await expect(page.getByRole('table', { name: 'Locales' }).getByRole('row', { name: /French/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add locale' }).click();
  const form = page.getByRole('dialog', { name: 'Add a locale' });
  await form.getByLabel('Code', { exact: true }).fill('de');
  await form.getByLabel('Name', { exact: true }).fill('German');
  await form.getByRole('button', { name: 'Add locale' }).click();
  await expectToast(page, 'Locale “de” added');
  await expect(page.getByRole('table', { name: 'Locales' }).getByRole('row', { name: /German/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Project', exact: true }).click();
  await page.getByLabel('Project name').fill('Acme Website 2026');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expectToast(page, 'Project settings saved');
  await page.getByRole('button', { name: 'Switch project' }).click();
  await expect(page.getByRole('menuitem', { name: 'Acme Website 2026' })).toBeVisible();
});

test('media: folders, search, the trash, and image variants rendered in the browser', async ({ page }) => {
  await open(page, `${BASE}/media`);
  const folders = page.getByRole('navigation', { name: 'Folders' });
  await expect(folders.getByRole('button', { name: /^Brand/ })).toBeVisible();
  await folders.getByRole('button', { name: 'New folder' }).click();
  const dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Folder name').fill('Press kit');
  await dialog.getByRole('button', { name: 'Create folder' }).click();
  await expectToast(page, /Folder “Press kit” created/);

  const search = page.getByPlaceholder('Search name, alt text or tag…');
  await search.fill('notebook');
  await expect(page.getByRole('button', { name: 'Open details of product-notebook.svg' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open details of hero-workspace.svg' })).toHaveCount(0);
  await search.fill('');

  // The demo data leaves one file in the trash.
  await folders.getByRole('button', { name: /^Trash/ }).click();
  const banner = page.getByRole('button', { name: 'Open details of old-banner.png' });
  await banner.click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expectToast(page, 'File restored');
  await page.getByRole('button', { name: 'Close file details' }).click();
  await folders.getByRole('button', { name: /^All files/ }).click();
  await expect(banner).toBeVisible();

  // Thumbnails ask the media service for a resized copy; in guest mode the same address must still show the file.
  for (const name of ['texture-paper.png', 'hero-workspace.svg']) {
    const thumbnail = page.getByRole('button', { name: `Open details of ${name}` }).locator('img');
    await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }

  // A real variant, drawn by the browser because guest mode has no media service.
  await page.getByRole('button', { name: 'Open details of texture-paper.png' }).click();
  await page.getByText('Thumbnail', { exact: true }).click();
  await expect(page.getByText(/renders this variant in your browser/)).toBeVisible();
  const preview = page.getByRole('img', { name: /Preview of texture-paper\.png with the chosen transformation/ });
  await expect(preview).toBeVisible();
  await expect(page.getByText(/^200 × 200 px · /)).toBeVisible();
  expect(await preview.getAttribute('src')).toMatch(/^blob:http:\/\/localhost:5190\//);
});
