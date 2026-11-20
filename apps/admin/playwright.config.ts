import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real admin against the real API.
 *
 *   npm run test:e2e
 *
 * Both servers are started automatically (or reused if already running). The tests create
 * their own organization through the sign-up form, so they never depend on seed data.
 * Set PLAYWRIGHT_CHANNEL=msedge or =chrome to use an installed browser instead of
 * downloading Playwright's bundled Chromium.
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:5180';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: ADMIN_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined } }],
  webServer: [
    { command: 'npm run dev -w @meridian/api', cwd: '../..', url: `${API_URL}/health`, reuseExistingServer: true, timeout: 120_000 },
    { command: 'npm run dev -w @meridian/admin', cwd: '../..', url: ADMIN_URL, reuseExistingServer: true, timeout: 120_000 },
  ],
});
