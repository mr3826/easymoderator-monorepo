import { test, expect } from '@playwright/test';
import { fixtures, signIn } from './support';

test.describe('Growth OS prospect workflows', () => {
  test('covers search, duplicate review, edits, lifecycle, ownership, linkage, and merge tombstones', async ({ page }) => {
    await signIn(page, fixtures.users.founder);
    await page.getByRole('link', { name: 'Prospects' }).click();

    await expect(page.getByRole('heading', { name: 'Prospects', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: fixtures.prospects.northStar.businessName })).toBeVisible();

    await page.getByLabel('Search').fill(fixtures.prospects.northStar.businessName);
    await page.getByLabel('Lifecycle status').selectOption('new');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByRole('heading', { name: '1 prospect' })).toBeVisible();
    await expect(page.getByRole('link', { name: fixtures.prospects.northStar.businessName })).toBeVisible();

    await page.getByRole('link', { name: 'New prospect' }).click();
    const createdName = `Browser Created Prospect ${Date.now()}`;
    await page.getByLabel(/Business name/).fill(createdName);
    await page.getByLabel('Contact name').fill('Browser Contact');
    await page.getByLabel('Contact phone').fill('01800000301');
    await page.getByLabel('Contact email').fill('growth-e2e-browser-create@example.test');
    await page.getByLabel('Page URL').fill('https://facebook.com/growth-e2e-browser-create');
    await page.getByLabel('Source *').selectOption('manual_entry');
    await page.getByLabel('Prospect notes').fill('Browser notes before the explicit null edit.');

    await page.getByLabel('Contact phone').fill('01700000105');
    await page.getByLabel('Contact email').fill(fixtures.users.merchant.email);
    await page.getByLabel('Page URL').fill('https://facebook.com/growth-e2e-north-star');
    await page.getByRole('button', { name: 'Create prospect' }).click();
    await expect(page.getByText('Possible duplicate prospect', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: fixtures.prospects.northStar.businessName })).toBeVisible();

    await page.getByRole('button', { name: 'Review form' }).click();
    await page.locator('#contactPhone').fill('01800000301');
    await page.locator('#contactEmail').fill('growth-e2e-browser-create@example.test');
    await page.locator('#pageUrl').fill('https://facebook.com/growth-e2e-browser-create');
    const createResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/internal/growth-os/prospects')
      && response.status() === 201
    ));
    await page.getByRole('button', { name: 'Create prospect' }).click();
    const createResponse = await createResponsePromise;
    const createdId = (await createResponse.json()).data.id as string;
    await expect(page).toHaveURL(new RegExp(`/prospects/${createdId}$`));
    await expect(page.getByRole('heading', { name: createdName })).toBeVisible();
    await expect(page.getByText('created', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Edit prospect' }).click();
    await expect(page.getByRole('heading', { name: 'Edit prospect' })).toBeVisible();
    await page.getByLabel('Niche').fill('updated retail');
    await page.getByLabel('Prospect notes').fill('');
    const patchRequestPromise = page.waitForRequest((request) => (
      request.method() === 'PATCH'
      && request.url().includes(`/api/internal/growth-os/prospects/${createdId}`)
    ));
    await page.getByRole('button', { name: 'Save changes' }).click();
    const patchRequest = await patchRequestPromise;
    expect(patchRequest.postDataJSON()).toMatchObject({
      niche: 'updated retail',
      notes: null,
    });
    await expect(page).toHaveURL(new RegExp(`/prospects/${createdId}$`));

    const statusOptions = await page.getByLabel('Move to status').locator('option').allTextContents();
    expect(statusOptions).not.toContain('qualified');
    expect(statusOptions).not.toContain('converted');
    await page.getByLabel('Move to status').selectOption('contacted');
    const statusResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().endsWith(`/api/internal/growth-os/prospects/${createdId}/status`)
      && response.status() === 200
    ));
    await page.getByRole('button', { name: 'Update lifecycle' }).click();
    await statusResponsePromise;
    const statusReloadPromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().endsWith(`/api/internal/growth-os/prospects/${createdId}`)
      && response.status() === 200
    ));
    await statusReloadPromise;
    await expect(page.getByLabel('Move to status')).toHaveValue('contacted');

    await page.locator('#owner-user-id').fill(fixtures.users.executive.id);
    await page.locator('#assignment-reason').fill('Assigned during browser E2E.');
    const assignmentResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().endsWith(`/api/internal/growth-os/prospects/${createdId}/assign`)
      && response.status() === 200
    ));
    await page.getByRole('button', { name: 'Save owner' }).click();
    const assignmentResponse = await assignmentResponsePromise;
    const assignmentReloadPromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().endsWith(`/api/internal/growth-os/prospects/${createdId}`)
      && response.status() === 200
    ));
    expect((await assignmentResponse.json()).data.ownerUserId).toBe(fixtures.users.executive.id);
    await assignmentReloadPromise;
    await expect(page.getByLabel('Owner user ID')).toHaveValue(fixtures.users.executive.id);

    await page.goto(`/prospects/${fixtures.prospects.northStar.id}`);
    await expect(page.getByRole('heading', { name: 'Linkage suggestions' })).toBeVisible();
    await expect(page.getByText(fixtures.shop.shopName, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link shop' })).toBeVisible();

    await page.goto(`/prospects/${fixtures.prospects.mergeSource.id}`);
    await page.getByLabel('Target prospect ID').fill(fixtures.prospects.mergeTarget.id);
    await page.locator('#merge-reason').fill('Duplicate source record verified in browser E2E.');
    await page.getByRole('button', { name: 'Merge record' }).click();
    await expect(page).toHaveURL(new RegExp(`/prospects/${fixtures.prospects.mergeTarget.id}$`));
    await expect(page.getByRole('heading', { name: fixtures.prospects.mergeTarget.businessName })).toBeVisible();

    await page.goto(`/prospects/${fixtures.prospects.mergeSource.id}`);
    await expect(page.getByRole('heading', { name: 'Merged record' })).toBeVisible();
    await expect(page.getByRole('link', { name: fixtures.prospects.mergeTarget.id, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit prospect' })).toHaveCount(0);
  });
});
