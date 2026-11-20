import { type APIRequestContext, type Page, expect } from '@playwright/test';

/**
 * Shared helpers for the end-to-end specs.
 *
 * Every spec file creates its own organization through the real sign-up form, so specs
 * never depend on seed data or on each other. Supporting data (a project, a content type,
 * a few entries) may be created through the management API to keep tests fast — the
 * behaviour under test is always driven through the UI.
 */

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
export const PASSWORD = 'e2e-password-2026';

export interface Api {
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  put<T = any>(path: string, body?: unknown): Promise<T>;
  patch<T = any>(path: string, body?: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export interface Workspace {
  email: string;
  orgId: string;
  orgSlug: string;
  projectId: string;
  projectSlug: string;
  /** Production environment id. */
  envId: string;
  /** UI path prefix of the production environment, e.g. /w/acme/p/site/production */
  base: string;
  /** UI path prefix of organization-level pages, e.g. /w/acme */
  orgBase: string;
  /** Management API path prefixes (relative to /admin/api). */
  envApi: string;
  projectApi: string;
  orgApi: string;
}

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter += 1)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Management API client that authenticates with the browser context's session cookie.
 * It fetches a fresh access token for every call, so long specs never hit token expiry.
 */
export function apiFor(page: Page): Api {
  const request: APIRequestContext = page.request;
  const token = async () => {
    const res = await request.post(`${API_URL}/admin/api/auth/refresh`, { headers: { 'X-Meridian-Client': 'admin' } });
    if (!res.ok()) throw new Error(`Could not refresh the session (${res.status()})`);
    return (await res.json()).accessToken as string;
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await request.fetch(`${API_URL}/admin/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      data: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
    put: (path, body) => call('PUT', path, body ?? {}),
    patch: (path, body) => call('PATCH', path, body ?? {}),
    delete: async (path) => {
      await call('DELETE', path);
    },
  };
}

/** Signs up a new organization through the UI and creates a project for it through the API. */
export async function createWorkspace(page: Page, label = 'E2E'): Promise<Workspace> {
  const id = unique();
  const email = `e2e-${id}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill(`${label} Tester`);
  await page.getByLabel('Organization name').fill(`${label} Org ${id}`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.waitForURL(/\/w\/[^/]+\/projects/);

  const api = apiFor(page);
  const me = await api.get('/auth/me');
  const org = me.memberships[0].organization as { id: string; slug: string };
  const project = await api.post(`/orgs/${org.id}/projects`, { name: `${label} Site`, description: 'Created by an end-to-end test' });
  const envId = project.environments.find((e: { key: string }) => e.key === 'production').id as string;
  return {
    email,
    orgId: org.id,
    orgSlug: org.slug,
    projectId: project.id,
    projectSlug: project.slug,
    envId,
    base: `/w/${org.slug}/p/${project.slug}/production`,
    orgBase: `/w/${org.slug}`,
    envApi: `/envs/${envId}`,
    projectApi: `/projects/${project.id}`,
    orgApi: `/orgs/${org.id}`,
  };
}

/** Creates a read-only (or other) delivery API key through the management API and returns the secret. */
export async function createDeliveryKey(page: Page, ws: Workspace, type: 'READ_ONLY' | 'READ_WRITE' | 'PREVIEW' = 'READ_ONLY'): Promise<string> {
  const key = await apiFor(page).post(`${ws.projectApi}/tokens`, { name: `E2E ${type}`, type, environmentId: ws.envId });
  return key.token as string;
}

/** Calls the public delivery API the way a connected website would. */
export async function delivery(page: Page, key: string, path: string): Promise<{ status: number; body: any }> {
  const res = await page.request.get(`${API_URL}/api/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  return { status: res.status(), body: text ? JSON.parse(text) : null };
}

/** Waits for a success toast (or any status message) containing the given text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
}

/** Opens a workspace page and waits until the app shell has rendered it. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main')).toBeVisible();
}
