import { BASE, ORG, expect, expectNoErrorState, firstLink, open, test } from './helpers';

/**
 * Every route in app/router.tsx, opened directly by address in guest mode with no API.
 * Each one must render its real content: a heading and something from the demo data.
 */
const STATIC_ROUTES: { name: string; path: string; heading: string | RegExp; shows: string | RegExp }[] = [
  { name: 'dashboard', path: BASE, heading: /Good (morning|afternoon|evening)|Dashboard|Acme Website/, shows: 'System health' },
  { name: 'projects', path: `${ORG}/projects`, heading: 'Projects', shows: 'Acme Website' },
  { name: 'account', path: `${ORG}/account`, heading: /Account/, shows: 'Active sessions' },
  { name: 'users', path: `${ORG}/admin/users`, heading: /Users|Members/, shows: 'Maya Okafor' },
  { name: 'roles', path: `${ORG}/admin/roles`, heading: /Roles/, shows: 'Content Manager' },
  { name: 'audit log', path: `${ORG}/admin/audit`, heading: /Audit/, shows: 'Spring launch' },
  { name: 'settings', path: `${ORG}/admin/settings`, heading: /Settings/, shows: /Acme/ },
  { name: 'content index', path: `${BASE}/content`, heading: /Content/, shows: 'Articles' },
  { name: 'entries', path: `${BASE}/content/articles`, heading: 'Articles', shows: 'Going headless without losing your editors' },
  { name: 'new entry', path: `${BASE}/content/articles/new`, heading: /New|Article/, shows: 'Title' },
  { name: 'single type', path: `${BASE}/content/site-settings`, heading: 'Acme', shows: 'Site name' },
  { name: 'pages', path: `${BASE}/pages`, heading: 'Pages', shows: 'Careers' },
  { name: 'media', path: `${BASE}/media`, heading: /Media/, shows: 'hero-workspace.svg' },
  { name: 'content types', path: `${BASE}/model/types`, heading: /Content types/, shows: 'Products' },
  { name: 'components', path: `${BASE}/model/components`, heading: /Components/, shows: 'Promo banner' },
  { name: 'dynamic zones', path: `${BASE}/model/zones`, heading: /Dynamic zones/, shows: 'Highlights' },
  { name: 'workflows', path: `${BASE}/publishing/workflows`, heading: /Workflows/, shows: 'Our approach to accessible color' },
  { name: 'releases', path: `${BASE}/publishing/releases`, heading: /Releases/, shows: 'Spring launch' },
  { name: 'scheduled', path: `${BASE}/publishing/scheduled`, heading: /Scheduled/, shows: 'A first look at the spring collection' },
  { name: 'version history', path: `${BASE}/publishing/history`, heading: /Version history|History/, shows: 'Tightened the headline' },
  { name: 'API explorer', path: `${BASE}/dev/explorer`, heading: /API explorer/i, shows: /List Articles/ },
  { name: 'API keys', path: `${BASE}/dev/keys`, heading: /API keys/i, shows: 'Website (production)' },
  { name: 'integrations', path: `${BASE}/dev/integrations`, heading: /Integrations|Connect/, shows: /Next\.js|React/ },
  { name: 'webhooks', path: `${BASE}/dev/webhooks`, heading: /Webhooks/, shows: 'Rebuild website' },
  { name: 'SDK docs', path: `${BASE}/dev/sdk`, heading: /SDK/, shows: /@meridian\/sdk/ },
  { name: 'analytics', path: `${BASE}/analytics`, heading: /Analytics/, shows: 'Website (production)' },
  { name: 'staging environment', path: `${ORG}/p/acme-website/staging/content/articles`, heading: 'Articles', shows: 'Staging: draft of the spring announcement' },
];

for (const route of STATIC_ROUTES) {
  test(`route: ${route.name}`, async ({ page }) => {
    await open(page, route.path);
    await expect(page.locator('main').getByRole('heading', { level: 1 }).first()).toContainText(route.heading);
    await expect(page.locator('main').getByText(route.shows).first()).toBeVisible();
    await expectNoErrorState(page);
  });
}

/** Screens addressed by id: reached through the list that links to them, then reloaded by address. */
const DETAIL_ROUTES: { name: string; from: string; link: RegExp; shows: string | RegExp }[] = [
  { name: 'entry editor', from: `${BASE}/content/articles`, link: /\/content\/articles\/[0-9a-f-]{36}$/, shows: /Title/ },
  { name: 'page builder', from: `${BASE}/pages`, link: /\/pages\/[0-9a-f-]{36}$/, shows: /Blocks|Outline|Add block/i },
  { name: 'content type editor', from: `${BASE}/model/types`, link: /\/model\/types\/[0-9a-z-]+$/, shows: /Fields|Add field/i },
  { name: 'component editor', from: `${BASE}/model/components`, link: /\/model\/components\/[0-9a-z-]+$/, shows: /Fields|Add field/i },
  { name: 'release detail', from: `${BASE}/publishing/releases`, link: /\/publishing\/releases\/[0-9a-f-]{36}$/, shows: /Pricing|Winter refresh|Spring launch/ },
  { name: 'webhook detail', from: `${BASE}/dev/webhooks`, link: /\/dev\/webhooks\/[0-9a-f-]{36}$/, shows: /Deliveries|deliveries/ },
];

for (const route of DETAIL_ROUTES) {
  test(`route: ${route.name}`, async ({ page }) => {
    await open(page, route.from);
    const href = await firstLink(page, route.link);
    // Opened by address, as a bookmark or a reload would: the route must not depend on in-app navigation.
    await open(page, href);
    await expect(page.locator('main').getByText(route.shows).first()).toBeVisible();
    await expectNoErrorState(page);
  });
}

test('the sign-in, sign-up and invitation addresses lead into the guest workspace', async ({ page }) => {
  for (const path of ['/login', '/register', '/accept-invite?token=anything', '/']) {
    await page.goto(path);
    await page.waitForURL(new RegExp(`${BASE}$`));
    await expect(page.getByRole('status', { name: 'Guest mode' })).toContainText('Guest mode — demo data, saved only in this browser');
  }
  // No sign-in form exists in a demo-only build, and there is nothing to sign out to.
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menuitem', { name: /Account & security/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Sign out|Exit guest mode/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exit guest mode' })).toHaveCount(0);
});

test('an unknown address shows the not-found page inside the app', async ({ page }) => {
  await page.goto(`${ORG}/nothing-here`);
  await expect(page.getByText('Page not found')).toBeVisible();
  await page.getByRole('link', { name: 'Back to Meridian' }).click();
  await page.waitForURL(new RegExp(`${BASE}$`));
});
