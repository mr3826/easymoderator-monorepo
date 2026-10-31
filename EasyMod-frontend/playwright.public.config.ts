import { defineConfig } from '@playwright/test';

const host = '127.0.0.1';
const appHost = '127.0.0.1';
const port = 4275;
const baseURL = `http://${host}:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/public-funnel-v7.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/public-v7' }]],
  outputDir: 'test-results/public-v7',
  use: {
    baseURL,
    locale: 'en',
    storageState: {
      cookies: [],
      origins: [{ origin: baseURL, localStorage: [{ name: 'easymod_lang', value: 'en' }] }],
    },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_BASE_URL: '/api',
      VITE_APP_URL: `http://${appHost}:${port}`,
      VITE_MARKETING_URL: baseURL,
      VITE_META_APP_ID: '2040799330176198',
      VITE_BKASH_ENABLED: 'false',
      VITE_ENV: 'development',
    },
  },
});
