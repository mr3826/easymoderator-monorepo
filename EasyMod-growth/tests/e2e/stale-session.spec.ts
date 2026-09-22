import { test, expect } from '@playwright/test';
import { bumpTokenVersion, fixtures, signIn } from './support';

test.describe('token-version revocation', () => {
  test('honors a real token-version revocation without response mocking', async ({ page }) => {
    await signIn(page, fixtures.users.staleSession);
    await page.getByRole('link', { name: 'Prospects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Prospects', exact: true })).toBeVisible();

    await bumpTokenVersion(fixtures.users.staleSession.id);

    await page.getByRole('link', { name: 'Merchants', exact: true }).click();
    await expect(page).toHaveURL(/\/session-expired$/);
    await expect(page.getByRole('heading', { name: 'Session expired' })).toBeVisible();
  });
});
