import { type Page, test as base, expect } from '@playwright/test';

/**
 * Shared setup for the guest-mode specs.
 *
 * Every test is watched for three things that must never happen in guest mode: a request to
 * anything but the admin's own origin, an uncaught error, and an error in the console. The
 * check runs automatically after each test.
 */
const OWN_ORIGIN = 'http://localhost:5190';

export const ORG = '/w/acme-studio';
export const BASE = `${ORG}/p/acme-website/production`;

export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
      page.on('request', (request) => {
        const url = request.url();
        // data: and blob: addresses never leave the browser; everything else must stay on the admin's origin.
        if (/^(https?|wss?):/.test(url) && !url.startsWith(OWN_ORIGIN) && !url.startsWith(OWN_ORIGIN.replace('http', 'ws'))) problems.push(`request left the browser: ${request.method()} ${url}`);
      });
      await use(problems);
      expect(problems, 'guest mode must not log errors or contact any other origin').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Opens a workspace page and waits until the screen itself (not just the shell) has rendered. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Guest mode' })).toBeVisible();
}

/** Fails when the screen shows any of the app's error or not-found states. */
export async function expectNoErrorState(page: Page) {
  for (const text of ['This could not be loaded', 'Something went wrong on this page', 'Project not found', 'Page not found', 'A new version is available']) {
    await expect(page.getByText(text)).toHaveCount(0);
  }
  await expect(page.getByRole('progressbar', { name: 'Loading page' })).toHaveCount(0);
}

/** Waits for a toast (or any status message) containing the given text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
}

/** The href of the first link in `main` whose address matches, for screens that are addressed by id. */
export async function firstLink(page: Page, pattern: RegExp): Promise<string> {
  const hrefs = () => page.locator('main a[href]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href') ?? ''));
  await expect.poll(async () => (await hrefs()).some((href) => pattern.test(href))).toBe(true);
  return (await hrefs()).find((href) => pattern.test(href)) as string;
}

// ─── Looking behind the screens ──────────────────────────────────────────────

interface DemoModule {
  request(req: { method: string; path: string; query?: Record<string, string>; body?: unknown }): Promise<{ status: number; body: unknown }>;
  delivery(path: string, token: string): Promise<{ status: number; body: unknown }>;
}

/**
 * Calls the demo backend directly, to check what a screen really did. It uses the same module
 * instance as the app (the dev server serves `@/demo` at this address), so it sees the same
 * in-browser database. No server is involved.
 */
export function backend<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([m, p, b]) => {
      const demo = (await import(/* @vite-ignore */ `${location.origin}/src/demo/index.ts`)) as DemoModule;
      const res = await demo.request({ method: m as string, path: p as string, body: b });
      return { status: res.status, body: res.body as never };
    },
    [method, path, body] as const,
  );
}

/** What a connected website would get from the delivery API for a demo key. */
export function deliver<T = any>(page: Page, token: string, path: string): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([t, p]) => {
      const demo = (await import(/* @vite-ignore */ `${location.origin}/src/demo/index.ts`)) as DemoModule;
      const res = await demo.delivery(p, t);
      return { status: res.status, body: res.body as never };
    },
    [token, path] as const,
  );
}

export interface DemoWorkspace {
  orgApi: string;
  projectApi: string;
  envApi: string;
  envId: string;
}

/** Management API prefixes of the seeded organization, project and production environment. */
export async function workspace(page: Page): Promise<DemoWorkspace> {
  const me = await backend(page, 'GET', '/auth/me');
  const orgId = me.body.memberships[0].organization.id as string;
  const projects = await backend(page, 'GET', `/orgs/${orgId}/projects`);
  const project = projects.body.items.find((p: { slug: string }) => p.slug === 'acme-website');
  const production = project.environments.find((e: { key: string }) => e.key === 'production');
  return { orgApi: `/orgs/${orgId}`, projectApi: `/projects/${project.id}`, envApi: `/envs/${production.id}`, envId: production.id };
}

/** A read-only delivery key for production, created through the demo backend. */
export async function deliveryKey(page: Page, ws: DemoWorkspace): Promise<string> {
  const key = await backend(page, 'POST', `${ws.projectApi}/tokens`, { name: 'Test website', type: 'READ_ONLY', environmentId: ws.envId });
  return key.body.token as string;
}
