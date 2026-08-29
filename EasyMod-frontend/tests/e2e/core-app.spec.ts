import { expect, test } from '@playwright/test';

const mockUser = {
  id: 'user-qa-1',
  full_name: 'QA User',
  email: 'qa@example.com',
};

const mockShop = {
  id: 'shop-qa-1',
  unique_code: 'QA123',
  shop_name: 'QA Shop',
  role: 'owner',
  settings: { onboarding_completed: true },
};

const dashboardMetrics = {
  metrics: {
    totalMessages: 12,
    activeProducts: 8,
    ordersToday: 3,
    weeklyChange: 10.5,
    conversionRate: 5.2,
  },
  channels: {
    active: 2,
    total: 3,
  },
  chartData: [
    { date: 'Mon', orders: 1 },
    { date: 'Tue', orders: 2 },
    { date: 'Wed', orders: 3 },
    { date: 'Thu', orders: 2 },
    { date: 'Fri', orders: 4 },
  ],
};

test('privacy policy includes Meta platform section', async ({ page }) => {
  await page.goto('/privacy-policy');

  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Meta Platform Data' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Send and receive Facebook Messenger messages/i })).toBeVisible();
});

test('sign in flow reaches dashboard with mocked backend', async ({ page }) => {
  let authenticated = false;

  await page.route((url) => new URL(url).pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/csrf' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'csrf-qa-token' }),
      });
    }

    if (path === '/api/auth/me' && method === 'GET') {
      if (authenticated) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: mockUser,
              currentShop: mockShop,
              allShops: [mockShop],
            },
          }),
        });
      }

      return route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Unauthorized' }),
      });
    }

    if (path === '/api/auth/signin' && method === 'POST') {
      authenticated = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: mockUser,
            currentShop: mockShop,
            allShops: [mockShop],
            tokens: {
              access_token: 'access-token',
              refresh_token: 'refresh-token',
            },
          },
        }),
      });
    }

    if (path === '/api/dashboard/metrics' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: dashboardMetrics }),
      });
    }

    if (path === '/api/setup/status' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { isComplete: true, completedCount: 4, totalCount: 4, progressPercent: 100, tasks: [] },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });

  await page.addInitScript(() => {
    window.localStorage.setItem('easymod:business-setup:default:complete-dismissed', '1');
    window.localStorage.setItem('easymod:business-setup:shop-qa-1:complete-dismissed', '1');
  });
  await page.goto('/signin');
  await page.fill('#email', 'qa@example.com');
  await page.fill('#password', 'strong-password');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Business Health' })).toBeVisible();
  await expect(page.getByText("Today's Sales")).toBeVisible();
});
