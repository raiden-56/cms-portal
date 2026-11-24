import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of guest mode, with no API reachable at all.
 *
 *   npx playwright test -c playwright.demo.config.ts
 *
 * The admin is pointed at an API address where nothing listens, so any screen that still
 * tried to reach a server would fail. Two builds are exercised:
 *
 *  - `demo-only` (port 5190, VITE_DEMO_ONLY=true): the static-hosting build that opens
 *    straight in guest mode. Almost every spec runs here.
 *  - `guest-entry` (port 5191, a normal build): entering guest mode from the sign-in page
 *    and leaving it again.
 *
 * Every test runs in a fresh browser context, and therefore starts from freshly seeded demo data.
 */
const DEMO_URL = 'http://localhost:5190';
const ENTRY_URL = 'http://localhost:5191';
const NO_API = 'http://127.0.0.1:9';

// The viewport is set per project because the device preset carries its own, smaller one.
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel: process.env.PLAYWRIGHT_CHANNEL || undefined };

export default defineConfig({
  testDir: './e2e-demo',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'light',
  },
  projects: [
    { name: 'demo-only', testIgnore: /entry\.spec\.ts$/, use: { ...desktop, baseURL: DEMO_URL } },
    { name: 'guest-entry', testMatch: /entry\.spec\.ts$/, use: { ...desktop, baseURL: ENTRY_URL } },
  ],
  webServer: [
    { command: 'npx vite --port 5190 --strictPort', url: DEMO_URL, reuseExistingServer: true, timeout: 120_000, env: { VITE_DEMO_ONLY: 'true', VITE_API_URL: NO_API } },
    { command: 'npx vite --port 5191 --strictPort', url: ENTRY_URL, reuseExistingServer: true, timeout: 120_000, env: { VITE_DEMO_ONLY: 'false', VITE_API_URL: NO_API } },
  ],
});
