import { test, expect, type Page } from '@playwright/test';
import {
  authStatePath,
  fixtures,
  pageRequest,
  runStamp,
  uniquePhone,
} from './support';

test.describe.configure({ mode: 'serial' });
test.use({ storageState: authStatePath('super') });

async function moveLifecycle(page: Page, prospectId: string, status: string) {
  await page.getByLabel('Move to status').selectOption(status);
  const statusResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/internal/growth-os/prospects/${prospectId}/status`)
    && response.status() === 200
  ));
  await page.getByRole('button', { name: 'Update lifecycle' }).click();
  await statusResponse;
  await expect(page.getByLabel('Move to status')).toHaveValue(status, { timeout: 15_000 });
}

function columnLocator(page: Page, status: string) {
  return page.locator(`section[aria-labelledby="column-${status}-title"]`);
}

let cafeId = '';

test('walks a new prospect through contacted, qualifying, qualified, the unlinked-shop gate, linkage, onboarding, and conversion', async ({ page }) => {
  test.setTimeout(150_000);
  const stamp = runStamp();
  const businessName = `Onboarding Cafe ${stamp}`;

  await page.goto('/quick-add');
  expect(page.url()).toContain('/quick-add');
  await page.locator('#quick-business-name').fill(businessName);
  await page.locator('#quick-contact-phone').fill(fixtures.users.merchant.phone ?? '01700000105');
  await page.locator('#quick-contact-email').fill(fixtures.users.merchant.email);
  await page.getByRole('button', { name: 'Create prospect' }).click();

  // Duplicate preflight surfaces the seeded identity and blocks creation.
  const duplicatePanel = page.locator('section.duplicate-warning');
  await expect(duplicatePanel.getByText('Possible duplicate prospect', { exact: true })).toBeVisible();
  await expect(duplicatePanel.getByRole('link', { name: fixtures.prospects.northStar.businessName })).toBeVisible();
  await duplicatePanel.getByRole('button', { name: 'Update details' }).click();

  await page.locator('#quick-contact-phone').fill(uniquePhone(Number(stamp) + 1));
  await page.locator('#quick-contact-email').fill(`e2e-cafe-${stamp}@example.test`);
  const createResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().includes('/api/internal/growth-os/prospects')
    && response.status() === 201
  ));
  await page.getByRole('button', { name: 'Create prospect' }).click();
  const created = await createResponse;
  cafeId = (await created.json()).data.id as string;
  await expect(page.getByRole('heading', { name: 'Prospect created' })).toBeVisible();
  await page.getByRole('link', { name: 'Open prospect record' }).click();
  await expect(page.getByRole('heading', { name: businessName, exact: true })).toBeVisible();

  await moveLifecycle(page, cafeId, 'contacted');
  await moveLifecycle(page, cafeId, 'qualifying');
  await moveLifecycle(page, cafeId, 'qualified');

  // The qualified state hides the shop-gated transitions and shows the hint.
  await expect(page.getByLabel('Move to status').locator('option')).toHaveCount(3);
  let statusOptions = await page.getByLabel('Move to status').locator('option').allTextContents();
  expect(statusOptions).toContain('qualified (current)');
  expect(statusOptions).toContain('disqualified');
  expect(statusOptions).not.toContain('onboarding');
  expect(statusOptions).not.toContain('converted');
  await expect(page.getByText('Link a Shop before onboarding/activation.', { exact: true })).toBeVisible();

  // Server truth: the transition API rejects without a linked shop (400 from
  // growth-os.prospect.service.js transition() -> invalidInput()).
  const unlinkedAttempt = await pageRequest(page, `/api/internal/growth-os/prospects/${cafeId}/status`, {
    method: 'POST',
    body: { status: 'onboarding', reason: 'direct API probe pre-link' },
  });
  expect(unlinkedAttempt.status).toBe(400);
  expect(unlinkedAttempt.body?.code).toBe('GROWTH_OS_PROSPECT_INVALID_INPUT');
  expect(unlinkedAttempt.body?.message).toContain('linked shop');

  // Link the seeded GROWTH-E2E-01 shop through the prospect record UI.
  await page.locator('#shop-link-id').fill(fixtures.shop.id);
  await page.locator('#link-reason').fill('Linked the E2E shop during the onboarding lifecycle run.');
  const linkResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/internal/growth-os/prospects/${cafeId}/link`)
    && response.status() === 200
  ));
  await page.getByRole('button', { name: 'Save linkage' }).click();
  await linkResponse;
  await expect(page.getByText(fixtures.shop.id, { exact: true }).first()).toBeVisible();

  statusOptions = await page.getByLabel('Move to status').locator('option').allTextContents();
  expect(statusOptions).toContain('onboarding');
  expect(statusOptions).not.toContain('converted');

  await moveLifecycle(page, cafeId, 'onboarding');
  // Shop activation is unset in the seed, so onboarding must WAIT here —
  // moveLifecycle already proved the record is still open in 'onboarding'
  // rather than having auto-converted.
  await expect(page.getByText('onboarding', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Pipeline' }).click();
  await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();
  await expect(columnLocator(page, 'onboarding').getByRole('link', { name: businessName })).toBeVisible();
  await expect(columnLocator(page, 'converted').getByRole('link', { name: businessName })).toHaveCount(0);

  await columnLocator(page, 'onboarding').getByRole('link', { name: businessName }).click();
  await expect(page.getByLabel('Move to status')).toHaveValue('onboarding');
  await moveLifecycle(page, cafeId, 'converted');

  await page.goto('/pipeline');
  await expect(columnLocator(page, 'converted').getByRole('link', { name: businessName })).toBeVisible();
  await expect(columnLocator(page, 'onboarding').getByRole('link', { name: businessName })).toHaveCount(0);
});

test('creates a prospect through the full form', async ({ page }) => {
  const businessName = `E2E Full Form Prospect ${runStamp()}`;
  await page.goto('/prospects/new');
  await expect(page.getByRole('heading', { name: 'Capture a prospect', exact: true })).toBeVisible();
  await page.getByLabel('Business name').fill(businessName);
  await page.getByLabel('Contact name').fill('Full Form Contact');
  await page.getByLabel('Contact email').fill(`full-form-${Date.now()}@example.test`);

  const createResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().endsWith('/api/internal/growth-os/prospects')
    && response.status() === 201
  ));
  await page.getByRole('button', { name: 'Create prospect', exact: true }).click();
  await createResponse;
  await expect(page).toHaveURL(/\/prospects\/[^/]+$/);
  await expect(page.getByText(businessName, { exact: true })).toBeVisible();
});

test('edits through the full form, reassigns ownership, shows linkage suggestions, and merges with tombstones', async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = runStamp();
  const businessName = `E2E Edited Prospect ${stamp}`;
  await page.goto('/');
  const created = await pageRequest(page, '/api/internal/growth-os/prospects', {
    method: 'POST',
    body: {
      businessName,
      contactPhone: uniquePhone(Number(stamp) + 2),
      contactEmail: `e2e-edited-${stamp}@example.test`,
      source: 'manual_entry',
      notes: 'Notes captured before the explicit null edit.',
    },
  });
  expect(created.status).toBe(201);
  const prospectId = created.body?.data?.id as string;
  expect(prospectId).toBeTruthy();

  await page.goto(`/prospects/${prospectId}/edit`);
  await expect(page.getByRole('heading', { name: 'Edit prospect' })).toBeVisible();
  await page.getByLabel('Niche').fill('updated retail');
  await page.getByLabel('Prospect notes').fill('');
  const patchRequestPromise = page.waitForRequest((request) => (
    request.method() === 'PATCH'
    && request.url().includes(`/api/internal/growth-os/prospects/${prospectId}`)
  ));
  await page.getByRole('button', { name: 'Save changes' }).click();
  const patchRequest = await patchRequestPromise;
  expect(patchRequest.postDataJSON()).toMatchObject({ niche: 'updated retail', notes: null });
  await expect(page).toHaveURL(new RegExp(`/prospects/${prospectId}$`));
  await expect(page.getByText('updated retail', { exact: true })).toBeVisible();

  await page.locator('#owner-user-id').fill(fixtures.users.growth.id);
  await page.locator('#assignment-reason').fill('Assigned during browser E2E.');
  const assignmentResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && response.url().endsWith(`/api/internal/growth-os/prospects/${prospectId}/assign`)
    && response.status() === 200
  ));
  await page.getByRole('button', { name: 'Save owner' }).click();
  const assignment = await assignmentResponse;
  expect((await assignment.json()).data.ownerUserId).toBe(fixtures.users.growth.id);
  await expect(page.getByText(fixtures.users.growth.id, { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await page.goto(`/prospects/${fixtures.prospects.northStar.id}`);
  await expect(page.getByRole('heading', { name: 'Linkage suggestions' })).toBeVisible();
  await expect(page.getByText(fixtures.shop.shopName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Link shop' }).first()).toBeVisible();

  await page.goto(`/prospects/${fixtures.prospects.mergeSource.id}`);
  await page.locator('#merge-target-id').fill(fixtures.prospects.mergeTarget.id);
  await page.locator('#merge-reason').fill('Duplicate source record verified in browser E2E.');
  await page.getByRole('button', { name: 'Merge record' }).click();
  await expect(page).toHaveURL(new RegExp(`/prospects/${fixtures.prospects.mergeTarget.id}$`));
  await expect(page.getByRole('heading', { name: fixtures.prospects.mergeTarget.businessName })).toBeVisible();

  await page.goto(`/prospects/${fixtures.prospects.mergeSource.id}`);
  await expect(page.getByRole('heading', { name: 'Merged record' })).toBeVisible();
  await expect(page.getByRole('link', { name: fixtures.prospects.mergeTarget.id, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit prospect' })).toHaveCount(0);
});

test('filters the prospect list by search, lifecycle, source, and linkage', async ({ page }) => {
  await page.goto('/prospects');
  await expect(page.getByRole('heading', { name: 'Prospects', exact: true })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill(fixtures.prospects.converted.businessName);
  await page.getByLabel('Lifecycle status').selectOption(fixtures.prospects.converted.status);
  await page.getByLabel('Source').selectOption(fixtures.prospects.converted.source);
  await page.getByLabel('Linkage').selectOption('true');
  await page.getByRole('button', { name: 'Apply filters' }).click();

  await expect(page.getByRole('heading', { name: '1 prospect', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: fixtures.prospects.converted.businessName, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: fixtures.prospects.northStar.businessName, exact: true })).toHaveCount(0);
});
