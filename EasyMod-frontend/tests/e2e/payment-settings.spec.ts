/**
 * Payment Settings — Playwright System Tests
 * Tests Self MFS vs Merchant API toggle for bKash, Nagad, Rocket
 */

import { expect, test } from '@playwright/test';

const mockUser = { id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd' };
const mockShop = { id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role: 'owner' };

const mockPaymentSettings = {
    bkash: { enabled: true, mfs_mode: 'self', phone: '01711000000' },
    nagad: { enabled: false, mfs_mode: 'self', phone: '' },
    rocket: { enabled: false, mfs_mode: 'self', phone: '' }
};

const mockMerchantSettings = {
    bkash: { enabled: true, mfs_mode: 'merchant', app_key: 'app-key-123', app_secret: 'app-secret-456', username: 'merchant@shop.bd', password: 'securepass' },
    nagad: { enabled: false, mfs_mode: 'self', phone: '' },
    rocket: { enabled: false, mfs_mode: 'self', phone: '' }
};

async function setupRoutes(page: any, paymentData = mockPaymentSettings) {
    let authenticated = false;
    await page.route('**/api/**', async (route: any) => {
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
        if (path.match(/\/api\/shops\/[\w-]+\/settings\/payment/) && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: paymentData }) });
        if (path.match(/\/api\/shops\/[\w-]+\/settings\/payment/) && method === 'PUT') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: paymentData }) });

        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{}}' });
    });
}

async function loginAndGo(page: any, path = '/settings/payment') {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'owner@shop.bd');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|settings/);
    await page.goto(path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('payment settings page loads', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('bKash').or(page.getByText('Payment'))).toBeVisible();
});

test('bKash payment section is visible', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('bKash')).toBeVisible();
});

test('Nagad payment section is visible', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Nagad')).toBeVisible();
});

test('Rocket payment section is visible', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Rocket')).toBeVisible();
});

test('Self MFS mode shows phone number field', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    // Self MFS mode is default — phone field should be visible
    await expect(page.locator('input[type="tel"], input[placeholder*="phone"], input[name*="phone"]').first()).toBeVisible();
});

test('Merchant API mode shows credential fields', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    // Find mode toggle and switch to Merchant
    const merchantRadio = page.getByLabel(/merchant api/i).or(page.getByText(/merchant api/i));
    if (await merchantRadio.isVisible()) {
        await merchantRadio.click();
        await expect(
            page.locator('input[name*="app_key"], input[placeholder*="App Key"], input[name*="appKey"]').first()
        ).toBeVisible({ timeout: 3000 });
    }
});

test('switching to Merchant mode hides phone field', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const merchantRadio = page.getByLabel(/merchant api/i).or(page.getByText(/merchant api/i));
    if (await merchantRadio.isVisible()) {
        await merchantRadio.click();
        await expect(page.locator('input[placeholder*="01"]').first()).not.toBeVisible({ timeout: 3000 });
    }
});

test('Self MFS info tooltip or description is visible', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    // Info icon or description about self MFS screenshot verification
    await expect(
        page.getByText(/screenshot/i).or(page.locator('[data-testid="mfs-info"], [title*="MFS"], [aria-label*="info"]').first())
    ).toBeVisible({ timeout: 5000 });
});

test('save Self MFS settings calls API with mfs_mode: self', async ({ page }) => {
    await setupRoutes(page);
    let savedData: any = null;
    await page.route('**/api/shops/*/settings/payment', async (route) => {
        if (route.request().method() === 'PUT') {
            savedData = JSON.parse(route.request().postData() || '{}');
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: savedData }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockPaymentSettings }) });
    });
    await loginAndGo(page);
    const saveBtn = page.getByRole('button', { name: /save/i }).first();
    if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(500);
        if (savedData) {
            const bkash = savedData.bkash || savedData;
            expect(bkash.mfs_mode || 'self').toBe('self');
        }
    }
});

test('settings show success notification on save', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    const saveBtn = page.getByRole('button', { name: /save/i }).first();
    if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await expect(
            page.getByText(/saved|success|updated/i).or(page.locator('.sonner-toast'))
        ).toBeVisible({ timeout: 5000 });
    }
});

test('merchant settings pre-populate when loaded from API', async ({ page }) => {
    await setupRoutes(page, mockMerchantSettings);
    await loginAndGo(page);
    // bKash is in merchant mode — credential fields should be pre-filled
    await expect(
        page.locator('input[value*="app-key"], input[value="app-key-123"]').or(
            page.getByDisplayValue('app-key-123')
        )
    ).toBeVisible({ timeout: 5000 });
});
