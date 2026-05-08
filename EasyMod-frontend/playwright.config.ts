import { defineConfig } from '@playwright/test';

const PW_HOST = process.env.PLAYWRIGHT_HOST || 'localhost';
const PW_PORT = Number(process.env.PLAYWRIGHT_PORT || '4273');
const PW_BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://${PW_HOST}:${PW_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: PW_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host ${PW_HOST} --port ${PW_PORT}`,
    url: PW_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
