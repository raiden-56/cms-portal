import { type Page, expect, test } from '@playwright/test';

/**
 * Entering and leaving guest mode in a normal build (one that expects an API).
 * Runs against http://localhost:5191, whose API address has nothing listening: the sign-in
 * page still appears, and "Explore as guest" must work without any server.
 */
const OWN_ORIGIN = 'http://localhost:5191';
const DASHBOARD = /\/w\/acme-studio\/p\/acme-website\/production$/;

const banner = (page: Page) => page.getByRole('status', { name: 'Guest mode' });

test('Explore as guest opens the demo workspace, survives a reload, and exits back to sign-in', async ({ page }) => {
  const outside: string[] = [];
  let watching = false;
  page.on('request', (request) => {
    const url = request.url();
    if (watching && /^https?:/.test(url) && !url.startsWith(OWN_ORIGIN)) outside.push(`${request.method()} ${url}`);
  });

  // Before guest mode the app looks for a session on the (unreachable) API and falls back to sign-in.
  await page.goto('/');
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  // Let the sign-in page finish its own attempts to reach the API before watching for new ones.
  await page.waitForLoadState('networkidle');

  watching = true;
  await page.getByRole('button', { name: 'Explore as guest' }).click();
  await page.waitForURL(DASHBOARD);
  await expect(banner(page)).toContainText('Guest mode — demo data, saved only in this browser');
  await expect(banner(page).getByRole('button', { name: 'Exit guest mode' })).toBeVisible();
  await expect(page.locator('main').getByText('System health')).toBeVisible();

  // No credentials were involved: nothing that looks like a real token is kept anywhere.
  expect(await page.evaluate(() => localStorage.getItem('meridian.guest'))).toBe('1');
  expect(await page.evaluate(() => document.cookie)).toBe('');

  // A change, so that leaving and re-entering can prove the data stays in this browser.
  await page.goto('/w/acme-studio/account');
  await page.getByLabel('Name', { exact: true }).fill('Returning Guest');
  await page.getByRole('button', { name: /Save/ }).first().click();
  await expect(page.getByRole('status').filter({ hasText: /saved|updated/i }).first()).toBeVisible();

  // Guest mode is remembered across a reload, and the sign-in address leads back into the workspace.
  await page.reload();
  await expect(banner(page)).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Returning Guest');
  await page.goto('/login');
  await page.waitForURL(DASHBOARD);
  expect(outside, 'guest mode must not contact any other origin').toEqual([]);
  watching = false;

  // Signing out of a guest session is leaving guest mode.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Exit guest mode' }).click();
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Explore as guest' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('meridian.guest'))).toBeNull();
  await page.reload();
  await page.waitForURL(/\/login$/);
  await expect(banner(page)).toHaveCount(0);

  // The demo data was kept, so entering again continues where the guest left off.
  await page.getByRole('button', { name: 'Explore as guest' }).click();
  await page.waitForURL(DASHBOARD);
  await banner(page).getByRole('button', { name: 'Exit guest mode' }).waitFor();
  await page.goto('/w/acme-studio/account');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Returning Guest');
});
