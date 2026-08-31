import { test, expect } from '@playwright/test';

test.describe('public pricing', () => {
  test('shows the three current commercial plans', async ({ page }) => {
    await page.goto('/pricing');

    await expect(page.getByText('Shuru', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Growth', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Partner', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/(?:100|১০০).*conversation/i).first()).toBeVisible();
    await expect(page.getByText(/(?:500|৫০০).*conversation/i).first()).toBeVisible();
    await expect(page.getByText(/delivered.*order/i).first()).toBeVisible();
    await expect(page.getByText(/14-day|trial/i)).toHaveCount(0);
  });
});
