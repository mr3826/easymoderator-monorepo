import { test, expect } from '@playwright/test';
import {
  authStatePath,
  dateTimeLocalPlus,
  fixtures,
  runStamp,
  uniquePhone,
} from './support';

test.use({ storageState: authStatePath('growth') });

test.describe('Growth user journey', () => {
  test('lands on real home metrics, quick-adds through duplicate preflight, schedules and completes follow-ups, and sees masked merchants', async ({ page }) => {
    test.setTimeout(150_000);
    const stamp = runStamp();
    const businessName = `E2E Journey Prospect ${stamp}`;
    const seededPhone = fixtures.users.merchant.phone ?? '01700000105';

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
    await expect(page.getByText('overdue follow-ups assigned to you', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Growth attention' })).toBeVisible();

    await page.goto('/quick-add');
    await expect(page.getByRole('heading', { name: 'Quick add' })).toBeVisible();
    await page.locator('#quick-business-name').fill(businessName);
    await page.locator('#quick-contact-phone').fill(seededPhone);
    await page.getByRole('button', { name: 'Create prospect' }).click();

    // Duplicate preflight matches the seeded North Star phone and blocks the
    // submit until the identity is changed.
    const duplicatePanel = page.locator('section.duplicate-warning');
    await expect(duplicatePanel.getByText('Possible duplicate prospect', { exact: true })).toBeVisible();
    await expect(duplicatePanel.getByRole('link', { name: fixtures.prospects.northStar.businessName })).toBeVisible();
    await expect(duplicatePanel.getByText('contactPhone', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prospect created' })).toHaveCount(0);
    await expect(duplicatePanel.getByText('Creation is blocked while the identity matches an existing record.', { exact: false })).toBeVisible();
    await duplicatePanel.getByRole('button', { name: 'Update details' }).click();

    await page.locator('#quick-contact-phone').fill(uniquePhone(Number(stamp)));
    const createResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/internal/growth-os/prospects')
      && response.status() === 201
    ));
    await page.getByRole('button', { name: 'Create prospect' }).click();
    await createResponse;
    await expect(page.getByRole('heading', { name: 'Prospect created' })).toBeVisible();
    await expect(page.getByRole('heading', { name: businessName })).toBeVisible();

    await page.getByRole('link', { name: 'Open prospect record' }).click();
    await expect(page.getByRole('heading', { name: businessName, exact: true })).toBeVisible();

    const followupAction = `E2E journey follow-up ${stamp}`;
    await page.locator('#panel-followup-due').fill(dateTimeLocalPlus(24 * 60 * 60 * 1000));
    await page.locator('#panel-followup-action').fill(followupAction);
    const followupCreated = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().endsWith('/api/internal/growth-os/followups')
      && response.status() === 201
    ));
    await page.getByRole('button', { name: 'Schedule follow-up' }).click();
    await followupCreated;
    await expect(page.locator('#followups-panel-title')).toBeVisible();
    await expect(page.getByText(followupAction, { exact: true })).toBeVisible();

    // An unlinked new prospect offers only non shop-gated transitions and the
    // current UI shows the link hint instead of hiding qualified/converted.
    const statusOptions = await page.getByLabel('Move to status').locator('option').allTextContents();
    expect(statusOptions).toContain('contacted');
    expect(statusOptions).toContain('disqualified');
    expect(statusOptions).not.toContain('onboarding');
    expect(statusOptions).not.toContain('converted');
    await expect(page.getByText('Link a Shop before onboarding/activation.', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'My Work' }).click();
    await expect(page.getByRole('heading', { name: 'My Work', exact: true })).toBeVisible();
    const seededOverdue = page.locator('tr', { hasText: 'E2E seeded overdue follow-up' });
    await expect(seededOverdue).toBeVisible();
    await expect(seededOverdue.getByText('overdue', { exact: true })).toBeVisible();
    const ownFollowup = page.locator('tr', { hasText: followupAction });
    await expect(ownFollowup).toBeVisible();

    const seededProspectCell = page.locator('td', { has: page.getByText('Follow-up Studio') }).first();
    await expect(seededProspectCell).toBeVisible();
    const completedTransition = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/internal/growth-os/followups/')
      && response.url().endsWith('/status')
      && response.status() === 200
    ));
    await seededOverdue.getByRole('button', { name: 'Complete' }).click();
    await completedTransition;
    await expect(page.locator('tr', { hasText: 'E2E seeded overdue follow-up' })).toHaveCount(0);
    await page.getByRole('group', { name: 'Follow-up state filters' }).getByRole('button', { name: 'Completed', exact: true }).click();
    await expect(page.locator('tr', { hasText: 'E2E seeded overdue follow-up' })).toBeVisible();

    await page.getByRole('link', { name: 'Merchants' }).click();
    await expect(page.getByRole('heading', { name: 'Merchants', exact: true })).toBeVisible();
    await expect(page.getByText('Limited, masked merchant context for growth work.')).toBeVisible();
    const merchantRow = page.locator('tr', { hasText: fixtures.shop.shopName });
    await expect(merchantRow).toBeVisible();
    const maskedListText = await page.locator('main').innerText();
    expect(maskedListText).not.toContain(fixtures.users.super.email);
    expect(maskedListText).not.toContain(fixtures.shop.uniqueCode);

    // Nav for a GROWTH_USER never shows the admin-only groups.
    await expect(page.getByRole('link', { name: 'Operations', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Growth Users', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Access Control', exact: true })).toHaveCount(0);

    await merchantRow.getByRole('link', { name: fixtures.shop.shopName }).click();
    await expect(page.getByText('Masked merchant insight', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: fixtures.shop.shopName })).toBeVisible();
    await expect(page.getByText('Admin identifiers, owner contact', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: fixtures.prospects.converted.businessName })).toBeVisible();
    const maskedDetailText = await page.locator('main').innerText();
    expect(maskedDetailText).not.toContain('Suspend');
    expect(maskedDetailText).not.toContain('Grant credits');
    expect(maskedDetailText).not.toContain(fixtures.users.super.email);
  });
});
