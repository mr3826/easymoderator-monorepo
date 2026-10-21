import { defineConfig, chromium, firefox, webkit } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const artifactBase = process.env.LAB_ARTIFACT_ROOT
  ? resolve(process.env.LAB_ARTIFACT_ROOT)
  : resolve(process.cwd(), '../docs/ai/product-experience-v1-2/artifacts');
const artifactRoot = resolve(artifactBase, 'playwright');
const installed = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
].filter(([, browser]) => existsSync(browser.executablePath()));
const projects = (installed.length ? installed : [['chromium', chromium]]).map(([name]) => ({
  name,
  use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
}));

export default defineConfig({
  testDir: './tests/product-engine-lab',
  fullyParallel: false,
  workers: 1,
  timeout: 12 * 60 * 1000,
  expect: { timeout: 30_000 },
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: resolve(artifactRoot, 'html-report'), open: 'never' }],
  ],
  outputDir: resolve(artifactRoot, 'test-results'),
  projects,
  use: {
    baseURL: process.env.LAB_BASE_URL,
    locale: 'en-US',
    timezoneId: 'Asia/Dhaka',
    viewport: { width: 1440, height: 1000 },
    trace: 'on',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
  },
});
