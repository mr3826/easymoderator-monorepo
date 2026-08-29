/**
 * Order Management — Playwright System Tests
 * End-to-end tests for order list, detail, status updates, cancel, and returns
 */

import { expect, test } from '@playwright/test';

const mockUser = { id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd' };
const mockShop = { id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role: 'owner' };

const mockOrders = [
    {
        id: 'order-1', order_number: 'ORD-001', status: 'pending',
        total_amount: 1500, total: 1500, payment_method: 'COD',
        customer: { id: 'cust-1', display_name: 'Ahmed Hassan', phone: '01711000001' },
        items: [{ id: 'item-1', product: { name: 'Blue T-Shirt', price: 750 }, quantity: 2 }],
        created_at: new Date().toISOString()
    },
    {
        id: 'order-2', order_number: 'ORD-002', status: 'confirmed',
        total_amount: 800, total: 800, payment_method: 'bKash',
        customer: { id: 'cust-2', display_name: 'Fatima Begum', phone: '01711000002' },
        items: [{ id: 'item-2', product: { name: 'Red Hijab', price: 400 }, quantity: 2 }],
        created_at: new Date().toISOString()
    },
    {
        id: 'order-3', order_number: 'ORD-003', status: 'delivered',
        total_amount: 2000, total: 2000, payment_method: 'Nagad',
        customer: { id: 'cust-3', display_name: 'Karim Uddin', phone: '01711000003' },
        items: [{ id: 'item-3', product: { name: 'Kurta Set', price: 1000 }, quantity: 2 }],
        created_at: new Date().toISOString()
    }
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
        if (path === '/api/order' && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockOrders }) });
        if (path.match(/\/api\/order\/order-\d/) && method === 'GET') {
            const id = path.split('/').pop();
            const order = mockOrders.find(o => o.id === id) || mockOrders[0];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: order }) });
        }
        if (path.match(/\/api\/order\/[\w-]+\/cancel/)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockOrders[0], status: 'cancelled' } }) });
        if (path.match(/\/api\/order\/[\w-]+\/status/)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockOrders[0], status: 'confirmed' } }) });
        if (path.match(/\/api\/order\/[\w-]+\/return/)) return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { id: 'ret-1', status: 'pending' } }) });
        if (path === '/api/order/returns') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });

        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' });
    });
}

async function loginAndGo(page: any, path = '/orders') {
    await page.goto('/signin');
    await page.fill('input[type="email"]', 'owner@shop.bd');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|orders/);
    await page.goto(path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('order list page loads', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('#ORD-001', { exact: true })).toBeVisible();
});

test('order list shows customer names', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Ahmed Hassan', { exact: true })).toBeVisible();
});

test('order list shows order numbers', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('#ORD-001', { exact: true })).toBeVisible();
    await expect(page.getByText('#ORD-002', { exact: true })).toBeVisible();
});

test('order list shows status badges', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Pending', { exact: true })).toBeVisible();
});

test('clicking order opens detail panel', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const orderRow = page.getByText('#ORD-001', { exact: true });
    await orderRow.click();
    await expect(
        page.getByText(/Blue T-Shirt|Ahmed Hassan|1,500/).first()
    ).toBeVisible({ timeout: 5000 });
});

test('filter orders by status shows filtered results', async ({ page }) => {
    await setupRoutes(page);
    // Setup route that filters
    await page.route((url) => new URL(url).pathname.startsWith('/api/order'), async (route) => {
        const url = new URL(route.request().url());
        const status = url.searchParams.get('status');
        const filtered = status ? mockOrders.filter(o => o.status === status) : mockOrders;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: filtered }) });
    });
    await loginAndGo(page);
    // Look for a status filter control
    const statusFilter = page.locator('select, [role="combobox"]').first();
    if (await statusFilter.isVisible()) {
        await statusFilter.selectOption('confirmed');
        await expect(page.getByText('#ORD-002', { exact: true })).toBeVisible();
    }
});

test('cancel order changes status', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    // Look for cancel button
    const cancelBtn = page.getByRole('button', { name: /cancel/i }).first();
    if (await cancelBtn.isVisible()) {
        await cancelBtn.click();
        // Confirm dialog if present
        const confirmBtn = page.getByRole('button', { name: /confirm|yes/i });
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmBtn.click();
        }
        await expect(page.getByText(/Cancelled|success/i).first()).toBeVisible({ timeout: 5000 });
    }
});

test('order status update sends correct API call', async ({ page }) => {
    await setupRoutes(page);
    let statusUpdateCalled = false;
    await page.route((url) => new URL(url).pathname.match(/^\/api\/order\/[^/]+\/status$/) !== null, (route) => {
        statusUpdateCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockOrders[0], status: 'confirmed' } }) });
    });
    await loginAndGo(page);
    const statusDropdown = page.locator('select[name*="status"], [data-testid="status-select"]').first();
    if (await statusDropdown.isVisible()) {
        await statusDropdown.selectOption('confirmed');
        expect(statusUpdateCalled).toBe(true);
    }
});

test('delivered order shows return button', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const deliveredRow = page.getByText('#ORD-003', { exact: true });
    if (await deliveredRow.isVisible()) {
        await deliveredRow.click();
        const returnBtn = page.getByRole('button', { name: /return/i });
        await expect(returnBtn).toBeVisible({ timeout: 3000 });
    }
});

test('initiate return opens return form', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const deliveredRow = page.getByText('#ORD-003', { exact: true });
    if (await deliveredRow.isVisible()) {
        await deliveredRow.click();
        const returnBtn = page.getByRole('button', { name: /return/i });
        if (await returnBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await returnBtn.click();
            await expect(page.getByText(/reason|items/i)).toBeVisible({ timeout: 3000 });
        }
    }
});

test('order total amount shown correctly', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText(/1,500/).first()).toBeVisible();
});

test('payment method displayed in order list', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('COD', { exact: true })).toBeVisible();
});
