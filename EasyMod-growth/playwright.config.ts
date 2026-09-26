import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const port = 5175;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // The disposable browser-E2E database is shared by every worker, including
  // the seeded rows, the role-revocation paths, and the per-IP auth rate
  // limiters. Keep files serial until each spec owns isolated fixtures.
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Growth business-day semantics are Asia/Dhaka; the canonical browser
    // clock must match the server, not the CI host.
    timezoneId: 'Asia/Dhaka',
  },
  projects: [
    {
      name: 'auth-setup',
      testDir: './tests/e2e-setup',
      testMatch: '**/*.setup.ts',
    },
    {
      name: 'chromium',
      dependencies: ['auth-setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Proves follow-up dates survive a non-business browser zone: the same
      // wall-clock selection must store, bucket, and render identically in
      // UTC, so USER_SELECTED_BUSINESS_DATE === SERVER_BUCKET_DATE ===
      // DISPLAYED_DATE is enforced end to end, not just by unit contract.
      name: 'chromium-utc-browser',
      dependencies: ['auth-setup'],
      testMatch: /timezone\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], timezoneId: 'UTC' },
    },
  ],
  webServer: {
    command: `npm run dev -- --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
