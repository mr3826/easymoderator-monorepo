import { test, expect, type Page } from '@playwright/test';
import { authStatePath } from './support';

test.use({ storageState: authStatePath('super') });

function interceptGrowthApi(page: Page, status: number, code: string) {
  return page.route('**/api/internal/growth-os/**', (route) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({
      success: false,
      code,
      message: `Growth E2E forced ${code}`,
    }),
  }));
}

test.describe('Growth OS failure states', () => {
  test('routes a mocked 401 after an established session to session expired', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await interceptGrowthApi(page, 401, 'AUTH_REQUIRED');
    await page.getByRole('link', { name: 'Prospects', exact: true }).click();
    await expect(page).toHaveURL(/\/session-expired$/);
    await expect(page.getByRole('heading', { name: 'Session expired' })).toBeVisible();
  });

  test('routes a mocked Growth authorization denial to access denied', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await interceptGrowthApi(page, 403, 'GROWTH_OS_FORBIDDEN');
    await page.getByRole('link', { name: 'Prospects', exact: true }).click();
    await expect(page).toHaveURL(/\/access-denied$/);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
  });

  test('renders the temporary unavailable state for a mocked disabled service', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await interceptGrowthApi(page, 503, 'GROWTH_OS_DISABLED');
    await page.getByRole('link', { name: 'Prospects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Growth OS is temporarily unavailable' })).toBeVisible();
  });

  test('renders an error state instead of a blank frame when the list network fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await page.route('**/api/internal/growth-os/prospects*', (route) => route.abort('failed'));
    await page.getByRole('link', { name: 'Prospects', exact: true }).click();
    await expect(page.getByText('Prospects could not be loaded.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
