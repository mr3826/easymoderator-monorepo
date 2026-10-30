import { devices, defineConfig } from '@playwright/test';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const frontendPort = Number(process.env.OPS_E2E_FRONTEND_PORT || '54680');
const baseURL = process.env.OPS_E2E_BASE_URL || `https://127.0.0.1:${frontendPort}`;
if (!process.env.OPS_E2E_PASSWORD || process.env.OPS_E2E_PASSWORD.length < 14) {
  throw new Error('Set OPS_E2E_PASSWORD to the synthetic seed password (14+ characters) before running this config.');
}

let frontendUrl: URL;
try {
  frontendUrl = new URL(baseURL);
} catch {
  throw new Error('OPS_E2E_BASE_URL must be an absolute loopback HTTPS URL');
}

if (frontendUrl.protocol !== 'https:'
  || !LOOPBACK_HOSTS.has(frontendUrl.hostname.toLowerCase())
  || frontendUrl.username
  || frontendUrl.password
  || (frontendUrl.pathname !== '' && frontendUrl.pathname !== '/')
  || frontendUrl.search
  || frontendUrl.hash) {
  throw new Error('OPS_E2E_BASE_URL must use HTTPS and a loopback host with no credentials or URL path');
}

const expectedPort = frontendUrl.port ? Number(frontendUrl.port) : 443;
if (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535
  || expectedPort !== frontendPort) {
  throw new Error('OPS_E2E_FRONTEND_PORT must match the port in OPS_E2E_BASE_URL');
}

const manageFrontend = process.env.OPS_E2E_SKIP_VITE !== '1';

export default defineConfig({
  testDir: './tests/operational-gate-closure-v1',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  outputDir: './test-results/operational-gate-closure-v1',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: {
      cookies: [],
      origins: [{
        origin: frontendUrl.origin,
        localStorage: [{ name: 'easymod_lang', value: 'en' }],
      }],
    },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  ...(manageFrontend ? {
    webServer: {
      command: `npm run dev -- --config vite.operational-gate-closure.config.ts --host 127.0.0.1 --port ${frontendPort} --strictPort`,
      port: frontendPort,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  } : {}),
});
