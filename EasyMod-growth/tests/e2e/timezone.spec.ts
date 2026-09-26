import { test, expect } from '@playwright/test';
import {
  authStatePath,
  businessDateTimeLocal,
  runStamp,
  uniquePhone,
} from './support';

test.use({ storageState: authStatePath('growth') });

// This spec runs in BOTH browser zones (Asia/Dhaka project and the UTC
// project from playwright.config.ts) and must pass identically: the date a
// business user selects is the date the server stores, buckets, and every
// operator later sees — regardless of the choosing browser's zone.
test.describe('follow-up date browser-independence contract', () => {
  test('quick-add scheduling stores the selected Asia/Dhaka business instant and renders that day', async ({ page }) => {
    test.setTimeout(150_000);
    const stamp = runStamp();
    const businessName = `E2E TZ Prospect ${stamp}`;
    const action = `E2E tz follow-up ${stamp}`;

    const selected = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const selectedDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(selected);
    const dueLocal = businessDateTimeLocal(selected, 23, 30);

    await page.goto('/quick-add');
    await expect(page.getByRole('heading', { name: 'Quick add' })).toBeVisible();
    await page.locator('#quick-business-name').fill(businessName);
    await page.locator('#quick-contact-phone').fill(uniquePhone(Number(stamp)));
    const createResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes('/api/internal/growth-os/prospects')
      && response.status() === 201
    ));
    await page.getByRole('button', { name: 'Create prospect' }).click();
    await createResponse;
    await expect(page.getByRole('heading', { name: 'Prospect created' })).toBeVisible();

    await page.locator('#quick-schedule-due').fill(dueLocal);
    await page.locator('#quick-schedule-action').fill(action);
    const followupResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().endsWith('/api/internal/growth-os/followups')
      && response.status() === 201
    ));
    await page.getByRole('button', { name: 'Schedule follow-up' }).click();
    const followupPayload = await (await followupResponse).json();

    // USER_SELECTED_BUSINESS_DATE === stored instant: 23:30 in Asia/Dhaka is
    // 17:30Z on the same calendar day. A browser-local misinterpretation by
    // this spec's UTC project would shift this instant by six hours.
    expect(followupPayload.data.dueAt).toBe(`${selectedDay}T17:30:00.000Z`);

    // DISPLAYED_DATE === the selected business day in every queue view.
    const expectedDueText = await page.evaluate((dueAt: string) => new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Dhaka',
      timeZoneName: 'short',
    }).format(new Date(dueAt)), followupPayload.data.dueAt);

    await page.goto('/follow-ups');
    const row = page.locator('tr', { hasText: action });
    await expect(row).toBeVisible();
    await expect(row.locator('time')).toHaveText(expectedDueText);

    // Completing must not change the due day; the row keeps one explicit
    // Due cell and one labeled Completed moment.
    await row.getByRole('button', { name: 'Complete' }).click();
    await expect(page.locator('tr', { hasText: action })).toHaveCount(0);
    await page.getByRole('group', { name: 'Follow-up state filters' })
      .getByRole('button', { name: 'Completed', exact: true })
      .click();
    const completedRow = page.locator('tr', { hasText: action });
    await expect(completedRow).toBeVisible();
    await expect(completedRow.locator('time')).toHaveText(expectedDueText);
    await expect(completedRow.getByRole('cell').last()).toContainText('Completed ');
  });
});
