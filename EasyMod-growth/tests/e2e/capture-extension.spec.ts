import * as fs from 'node:fs/promises';
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, test, expect, type Page } from '@playwright/test';
import { authStatePath, fixtures, runStamp, signIn, uniquePhone } from './support';

const CAPTURE_STORAGE_KEY = 'growth-os.capture-payload.v1';

test.use({ storageState: authStatePath('growth') });

async function seedCapturePayload(page: Page, payload: Record<string, string>) {
  await page.addInitScript(({ key, value }) => {
    window.sessionStorage.setItem(key, value);
  }, { key: CAPTURE_STORAGE_KEY, value: JSON.stringify(payload) });
}

test.describe('browser extension capture hand-off', () => {
  test('reviews the hand-off payload, creates the prospect, and the record becomes searchable', async ({ page }) => {
    const stamp = runStamp();
    const phone = uniquePhone(Number(stamp));
    const email = `captured-salon-${stamp}@example.test`;
    await seedCapturePayload(page, {
      businessName: 'Captured Salon',
      pageUrl: `https://example-social.test/captured-salon-${stamp}`,
      sourceWebsite: 'https://example-social.test',
      selectedText: `E2E selected listing text ${stamp}`,
      contactPhone: phone,
      contactEmail: email,
      note: 'Captured during browser E2E',
    });

    await page.goto('/capture');
    await expect(page.getByRole('heading', { name: 'Review captured prospect' })).toBeVisible();
    await expect(page.locator('#capture-business-name')).toHaveValue('Captured Salon');
    await expect(page.locator('#capture-contact-phone')).toHaveValue(phone);
    await expect(page.locator('#capture-contact-email')).toHaveValue(email);
    await expect(page.locator('section[aria-labelledby="capture-source-title"]').getByText('browser extension', { exact: true })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="capture-source-title"]').getByText('https://example-social.test', { exact: true })).toBeVisible();
    await expect(page.getByText(`E2E selected listing text ${stamp}`, { exact: false })).toBeVisible();

    const createResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/internal/growth-os/prospects')
      && response.status() === 201
    ));
    await page.getByRole('button', { name: 'Create prospect' }).click();
    await createResponse;
    await expect(page.getByRole('heading', { name: 'Captured prospect saved' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Captured Salon', exact: true })).toBeVisible();

    await page.goto('/search?q=Captured+Salon');
    const prospectResults = page.locator('section[aria-label="Prospect results"]');
    await expect(prospectResults.getByRole('link', { name: 'Captured Salon' }).first()).toBeVisible();
  });

  test('blocks the hand-off in the preflight when the payload reuses a seeded identity', async ({ page }) => {
    const stamp = runStamp();
    await seedCapturePayload(page, {
      businessName: `Captured Copy ${stamp}`,
      pageUrl: 'https://facebook.com/growth-e2e-north-star',
      sourceWebsite: 'https://example-social.test',
      contactPhone: fixtures.users.merchant.phone ?? '01700000105',
    });
    await page.goto('/capture');
    await expect(page.getByRole('heading', { name: 'Review captured prospect' })).toBeVisible();

    const createRequests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/internal/growth-os/prospects')) {
        createRequests.push(request.url());
      }
    });

    // Submitting with a duplicated identity must only run the preflight API
    // and reveal the panel — no ledger create happens.
    await page.getByRole('button', { name: 'Create prospect' }).click();
    const panel = page.locator('section.duplicate-warning');
    await expect(panel.getByText('Possible duplicate prospect', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: fixtures.prospects.northStar.businessName })).toBeVisible();
    await expect(panel.getByText('contactPhone', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Captured prospect saved' })).toHaveCount(0);
    expect(createRequests).toHaveLength(0);
  });

  test('loads in headed Chromium and relays a manually confirmed capture', async () => {
    test.skip(!process.env.GROWTH_E2E_REAL_EXTENSION, 'real extension check is opt-in for a headed local browser');

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const extensionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easymod-growth-extension-'));
    const profileRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'easymod-growth-profile-'));
    const fixtureServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Public listing</title><h1>Manual salon listing</h1><a href="mailto:salon@example.test">Email us</a>');
    });

    await fs.cp(path.join(repoRoot, 'EasyMod-extension'), extensionRoot, { recursive: true });
    const manifestPath = path.join(extensionRoot, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(path.join(extensionRoot, 'manifest.dev.json'), 'utf8')) as {
      host_permissions: string[];
    };
    await new Promise<void>((resolve, reject) => {
      fixtureServer.once('error', reject);
      fixtureServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = fixtureServer.address();
    if (!address || typeof address === 'string') throw new Error('fixture server did not expose a port');
    const fixtureOrigin = `http://127.0.0.1:${address.port}`;
    manifest.host_permissions = [...manifest.host_permissions, `${fixtureOrigin}/*`];
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    const context = await chromium.launchPersistentContext(profileRoot, {
      headless: false,
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const extensionId = new URL(worker.url()).host;
      const authPage = await context.newPage();
      await signIn(authPage, {
        id: fixtures.users.growth.id,
        email: fixtures.users.growth.email,
        password: fixtures.password,
        role: 'GROWTH_USER',
      });

      const publicPage = await context.newPage();
      await publicPage.goto(`${fixtureOrigin}/listing`);
      expect(await publicPage.evaluate((key) => window.sessionStorage.getItem(key), CAPTURE_STORAGE_KEY)).toBeNull();

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      await publicPage.bringToFront();
      await popup.reload();
      await expect(popup.locator('#field-businessName')).toHaveValue('Public listing');
      await expect(popup.locator('#field-contactEmail')).toHaveValue('salon@example.test');

      const targetPagePromise = context.waitForEvent('page');
      await popup.getByRole('button', { name: 'Continue in Growth OS' }).click();
      const targetPage = await targetPagePromise;
      await targetPage.waitForURL(/\/capture\?captureNonce=/);
      await targetPage.waitForLoadState('domcontentloaded');
      await expect.poll(async () => targetPage.evaluate((key) => window.sessionStorage.getItem(key), CAPTURE_STORAGE_KEY)).toContain('Public listing');
      const relayed = await targetPage.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) ?? 'null'), CAPTURE_STORAGE_KEY) as Record<string, string>;
      expect(relayed.contactEmail).toBe('salon@example.test');
      expect(relayed.pageUrl).toBe(`${fixtureOrigin}/listing`);
    } finally {
      await context.close();
      await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
      await fs.rm(extensionRoot, { recursive: true, force: true });
      await fs.rm(profileRoot, { recursive: true, force: true });
    }
  });
});
