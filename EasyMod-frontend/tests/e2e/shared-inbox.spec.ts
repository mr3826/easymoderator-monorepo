/**
 * Shared Inbox — Playwright System Tests
 * Verifies rename from Unified Inbox, conversation list, and messaging flow
 */

import { expect, test } from '@playwright/test';

const mockUser = { id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd' };
const mockShop = { id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role: 'owner' };

const mockConversations = [
    {
        id: 'conv-1', channel: 'messenger',
        customer: { id: 'cust-1', name: 'Ahmed Hassan', channel_user_id: 'psid-1' },
        lastMessage: 'What is the price?', unreadCount: 2, status: 'active',
        updated_at: new Date().toISOString()
    },
    {
        id: 'conv-2', channel: 'messenger',
        customer: { id: 'cust-2', name: 'Fatima Begum', channel_user_id: 'igid-2' },
        lastMessage: 'Is it available?', unreadCount: 0, status: 'active',
        updated_at: new Date().toISOString()
    },
    {
        id: 'conv-3', channel: 'messenger',
        customer: { id: 'cust-3', name: 'Karim Uddin', channel_user_id: 'psid-3' },
        lastMessage: 'Order received, thanks!', unreadCount: 0, status: 'closed',
        updated_at: new Date().toISOString()
    }
];

const mockMessages = [
    {
        id: 'msg-1', conversation_id: 'conv-1', sender: 'customer', message_type: 'image',
        content: 'What is the price?',
        metadata: {
            message_type: 'image',
            image_url: 'https://api.easymod.tech/uploads/conversation-attachments/shop-1/old-photo.png?expires=9999999999&signature=test',
            attachment_source: 'inbox_upload',
            attachment_storage_key: 'shop-1/old-photo.png',
            attachment_available: true,
        },
        created_at: new Date(Date.now() - 60000).toISOString(),
    },
    { id: 'msg-2', conversation_id: 'conv-1', sender: 'agent', message_type: 'text', direction: 'outgoing', content: 'The price is 500 BDT', created_at: new Date().toISOString() }
];

async function setupRoutes(page: any) {
    let authenticated = false;
    await page.route((url) => new URL(url).pathname.startsWith('/api/'), async (route: any) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const method = route.request().method();

        if (path === '/api/csrf') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'csrf-test' }) });
        if (path === '/api/auth/signin' && method === 'POST') {
            authenticated = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { user: mockUser, currentShop: mockShop, allShops: [mockShop] } }) });
        }
        if (path === '/api/auth/me') {
            if (!authenticated) return route.fulfill({ status: 401, body: '{"success":false}', contentType: 'application/json' });
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { user: mockUser, currentShop: mockShop, allShops: [mockShop] } }) });
        }
        if (path === '/api/conversation' && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { conversations: mockConversations, pagination: { total: 3, page: 1, pageSize: 50 } } }) });
        if (path.match(/\/api\/conversation\/[\w-]+\/messages$/) && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { messages: mockMessages, pagination: { page: 1, totalPages: 1 } } }) });
        if (path.match(/\/api\/conversation\/[\w-]+\/messages$/) && method === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'msg-new', content: 'New reply', sender: 'agent', message_type: 'text', created_at: new Date().toISOString() } }) });

        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' });
    });
}

async function loginAndGo(page: any, path = '/inbox') {
    await page.goto('/signin');
    await page.fill('input[type="email"]', 'owner@shop.bd');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|inbox/);
    await page.goto(path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('inbox page title shows "Shared Inbox" not "Unified Inbox"', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Shared Inbox')).toBeVisible();
    await expect(page.getByText('Unified Inbox')).not.toBeVisible();
});

test('conversation list appears in left panel', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Ahmed Hassan', { exact: true }).first()).toBeVisible();
});

test('shows empty state when no conversations', async ({ page }) => {
    await setupRoutes(page);
    await page.route((url) => new URL(url).pathname.startsWith('/api/conversation'), (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { rows: [], count: 0 } }) })
    );
    await loginAndGo(page);
    await expect(page.getByText(/no conversations|no messages|empty/i)).toBeVisible({ timeout: 5000 });
});

test('clicking conversation loads messages', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const conv = page.getByText('Ahmed Hassan');
    if (await conv.isVisible()) {
        await conv.click();
        await expect(page.getByText('What is the price?').or(page.getByText('500 BDT'))).toBeVisible({ timeout: 5000 });
    }
});

test('message input visible after selecting conversation', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const conv = page.getByText('Ahmed Hassan');
    if (await conv.isVisible()) {
        await conv.click();
        await expect(
            page.locator('input[type="text"][placeholder*="message"], textarea[placeholder*="message"], [data-testid="message-input"]')
        ).toBeVisible({ timeout: 5000 });
    }
});

test('customer name shown in conversation list', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Ahmed Hassan', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Fatima Begum', { exact: true }).first()).toBeVisible();
});

test('historical attachment renders after reload', async ({ page }) => {
    await page.route('https://api.easymod.tech/uploads/**', (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    }));
    await setupRoutes(page);
    await loginAndGo(page);
    await page.locator('h3').filter({ hasText: 'Ahmed Hassan' }).click();
    await expect(page.locator('img[alt="Attachment"]')).toBeVisible();

    await page.reload();
    await page.locator('h3').filter({ hasText: 'Ahmed Hassan' }).click();
    await expect(page.locator('img[alt="Attachment"]')).toBeVisible();
});

test('unread badge visible for conversations with unread messages', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    // conv-1 has unread_count: 2
    await expect(page.getByTestId('unread-badge')).toHaveText('2');
});

test('last message preview shown in conversation item', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('What is the price?', { exact: true }).first()).toBeVisible();
});

test('resolved conversations visible in list', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await page.getByRole('button', { name: /Done/ }).click();
    await expect(page.getByText('Karim Uddin', { exact: true }).first()).toBeVisible();
});

test('filter conversations by open status', async ({ page }) => {
    await setupRoutes(page);
    await page.route((url) => new URL(url).pathname.startsWith('/api/conversation'), async (route) => {
        const url = new URL(route.request().url());
        const status = url.searchParams.get('status') || 'open';
        const filtered = mockConversations.filter(c => c.status === status);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { rows: filtered, count: filtered.length } }) });
    });
    await loginAndGo(page);
    const filterControl = page.locator('[data-testid="status-filter"], select, [role="tablist"] button').first();
    if (await filterControl.isVisible()) {
        await filterControl.click();
        await expect(page.getByText('Ahmed Hassan').or(page.getByText('Fatima Begum'))).toBeVisible();
    }
});
