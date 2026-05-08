import { expect, test, type Page } from '@playwright/test';

const mockUser = {
  id: 'user-meta-qa',
  full_name: 'Meta QA User',
  email: 'meta.qa@example.com',
};

const mockShop = {
  id: 'shop-meta-qa',
  unique_code: 'META123',
  shop_name: 'Meta QA Shop',
  role: 'owner',
  settings: {
    onboarding_completed: true,
  },
};

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function mockAuthenticatedMetaApi(
  page: Page,
  options?: { conversationChannel?: 'messenger' | 'instagram' | 'whatsapp'; hoursAgo?: number }
) {
  const conversationChannel = options?.conversationChannel ?? 'messenger';
  const hoursAgo = options?.hoursAgo ?? 25;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const normalizedPath = path.startsWith('/api/') ? path.slice(4) : path;
    const method = request.method();
    const isApiRequest = path.startsWith('/api/') || [
      '/csrf',
      '/auth',
      '/subscription',
      '/channel',
      '/conversation',
      '/templates',
    ].some((prefix) => normalizedPath.startsWith(prefix));

    if (!isApiRequest) {
      return route.continue();
    }

    if (normalizedPath === '/csrf' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'csrf-meta-token' }),
      });
    }

    if (normalizedPath === '/auth/me' && method === 'GET') {
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

    if (normalizedPath === '/subscription' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            subscription: {
              plan_name: 'Free',
              features: {
                image_understanding: false,
                advanced_ai: false,
                priority_support: false,
                custom_branding: false,
              },
            },
          },
        }),
      });
    }

    if (normalizedPath === '/channel' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    }

    if (normalizedPath === '/conversation' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            conversations: [
              {
                id: 'conv-meta-1',
                customer_id: 'cust-meta-1',
                customer: { id: 'cust-meta-1', name: 'Alice Rahman' },
                channel: conversationChannel,
                title: 'Meta Conversation',
                status: 'active',
                hitl: false,
                lastMessage: 'Hi, is this available?',
                unreadCount: 1,
                created_at: isoHoursAgo(hoursAgo + 2),
                updated_at: isoHoursAgo(hoursAgo),
              },
            ],
            pagination: {
              page: 1,
              totalPages: 1,
              total: 1,
              limit: 50,
            },
          },
        }),
      });
    }

    if (/^\/conversation\/[^/]+\/messages$/.test(normalizedPath) && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: 'msg-meta-1',
                conversation_id: 'conv-meta-1',
                content: 'Hello, I want to order this product.',
                sender: 'customer',
                message_type: 'text',
                created_at: isoHoursAgo(hoursAgo),
                updated_at: isoHoursAgo(hoursAgo),
              },
            ],
            pagination: {
              page: 1,
              totalPages: 1,
              total: 1,
              limit: 30,
            },
          },
        }),
      });
    }

    if (normalizedPath === '/templates' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    }

    if (normalizedPath === '/conversation/events' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 10000\n\n',
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });
}

test('channels modal keeps WhatsApp as disabled coming-soon option', async ({ page }) => {
  await mockAuthenticatedMetaApi(page);

  await page.goto('/app/channels');

  await expect(page).toHaveURL(/\/app\/channels$/);
  await page.getByRole('button', { name: /connect channel|চ্যানেল যোগ করুন/i }).first().click();

  await expect(page.getByText(/coming soon|শীঘ্রই/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /whatsapp business/i })).toBeDisabled();
});

test('inbox enforces Meta 24h lock for expired messenger conversation', async ({ page }) => {
  await mockAuthenticatedMetaApi(page, { conversationChannel: 'messenger', hoursAgo: 25 });

  await page.goto('/app/inbox');

  await expect(page).toHaveURL(/\/app\/inbox$/);
  await expect(page.getByText(/messaging window expired|মেসেজিং উইন্ডো শেষ হয়ে গেছে/i)).toBeVisible();

  const composerInput = page.locator('input[type="text"]').last();
  await expect(composerInput).toBeDisabled();

  await page.getByRole('combobox').first().selectOption('ACCOUNT_UPDATE');
  await expect(composerInput).toBeEnabled();
});
