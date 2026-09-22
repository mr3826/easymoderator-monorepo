import { test, expect } from '@playwright/test';
import { authStatePath, pageRequest } from './support';

test.describe('permission enforcement', () => {
  test.describe('growth user: workspace allowed, admin denied, admin nav absent', () => {
    test.use({ storageState: authStatePath('growth') });

    test('reads its own workspace surface but not the admin surface', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Merchants', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Operations', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Growth Users', exact: true })).toHaveCount(0);

      const analytics = await pageRequest(page, '/api/internal/growth-os/analytics/growth?window=90');
      expect(analytics.status).toBe(200);
      expect(typeof analytics.body?.data?.funnel?.created).toBe('number');

      const home = await pageRequest(page, '/api/internal/growth-os/home');
      expect(home.status).toBe(200);

      const adminUsers = await pageRequest(page, '/api/internal/growth-os/admin/users');
      expect(adminUsers.status).toBe(403);
      expect(adminUsers.body?.code).toBe('GROWTH_OS_FORBIDDEN');
    });
  });

  test.describe('merchant without a growth role: every growth surface is denied', () => {
    test.use({ storageState: authStatePath('merchant') });

    test('has no session, no create access, and no Growth navigation', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/access-denied$/);
      await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Growth OS navigation' })).toHaveCount(0);

      const session = await pageRequest(page, '/api/internal/growth-os/session');
      expect(session.status).toBe(403);
      expect(session.body?.code).toBe('GROWTH_OS_FORBIDDEN');

      const create = await pageRequest(page, '/api/internal/growth-os/prospects', {
        method: 'POST',
        body: {
          businessName: 'Merchant cannot create prospects',
          contactEmail: 'merchant-cannot-create@example.test',
          source: 'manual_entry',
        },
      });
      expect(create.status).toBe(403);
      expect(create.body?.code).toBe('GROWTH_OS_FORBIDDEN');
    });
  });
});
