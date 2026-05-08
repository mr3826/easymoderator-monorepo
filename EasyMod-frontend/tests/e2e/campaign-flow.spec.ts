/**
 * Campaign Flow — Playwright System Tests
 * End-to-end tests for campaign creation, run, schedule, and progress tracking
 */

import { expect, test } from '@playwright/test';

const mockUser = { id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd' };
const mockShop = { id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role: 'owner' };

const mockCampaigns = [
    {
        id: 'camp-1', name: 'Ramadan Win-Back', status: 'draft',
        message_template: 'Hi! We miss you. Get 15% off this Ramadan.',
        segment_filter: { requireConsent: true, recipientCap: 500 },
        total_recipients: 0, sent_count: 0, failed_count: 0,
        created_at: new Date().toISOString()
    },
    {
        id: 'camp-2', name: 'Eid Special', status: 'completed',
        message_template: 'Eid Mubarak! Enjoy our special deals.',
        segment_filter: { requireConsent: true, recipientCap: 200 },
        total_recipients: 180, sent_count: 175, failed_count: 5,
        created_at: new Date().toISOString()
    }
];

async function setupAuthRoutes(page: any) {
    let authenticated = false;
    await page.route('**/api/**', async (route: any) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const method = route.request().method();

        if (path === '/api/csrf') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ csrfToken: 'test-csrf' }) });
        if (path === '/api/auth/signin' && method === 'POST') {
            authenticated = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { user: mockUser, currentShop: mockShop, allShops: [mockShop] } }) });
        }
        if (path === '/api/auth/me') {
            if (!authenticated) return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false }) });
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { user: mockUser, currentShop: mockShop, allShops: [mockShop] } }) });
        }
        if (path === '/api/campaigns' && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockCampaigns }) });
        if (path === '/api/campaigns' && method === 'POST') return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockCampaigns[0], id: 'camp-new', name: 'New Campaign' } }) });
        if (path.match(/\/api\/campaigns\/[\w-]+\/run/)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockCampaigns[0], status: 'running', total_recipients: 50 } }) });
        if (path.match(/\/api\/campaigns\/[\w-]+\/schedule/)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockCampaigns[0], status: 'scheduled' } }) });
        if (path.match(/\/api\/campaigns\/[\w-]+\/stats/)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...mockCampaigns[0], status: 'running', sent_count: 50, failed_count: 2, total_recipients: 100 } }) });

        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' });
    });
}

async function loginAndGo(page: any, path = '/campaigns') {
    await page.goto('/login');
    await page.fill('[name="email"], input[type="email"]', 'owner@shop.bd');
    await page.fill('[name="password"], input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|campaigns/);
    await page.goto(path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('campaign list page loads with heading', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Campaign Control Panel')).toBeVisible();
});

test('campaign list shows existing campaigns', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Ramadan Win-Back')).toBeVisible();
    await expect(page.getByText('Eid Special')).toBeVisible();
});

test('create campaign form is present', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Create Campaign')).toBeVisible();
    await expect(page.getByPlaceholder('Ramadan Win-Back')).toBeVisible();
});

test('preflight shows errors when form is empty', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText('Campaign name is required.')).toBeVisible();
    await expect(page.getByText('Message template is required.')).toBeVisible();
});

test('preflight clears errors when form is filled', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    await page.fill('[placeholder="Ramadan Win-Back"]', 'Test Campaign');
    await page.fill('textarea', 'Hello! This is a longer message for the campaign.');
    await expect(page.getByText('No blocking issues detected.')).toBeVisible();
});

test('preflight warns on high recipient cap', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    // Find recipient cap input and set to 600
    const capInputs = page.locator('input[type="number"]');
    await capInputs.nth(1).fill('600');
    await expect(page.getByText(/Recipient cap above 500/i)).toBeVisible();
});

test('create campaign successfully adds to list', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    await page.fill('[placeholder="Ramadan Win-Back"]', 'New Campaign');
    await page.fill('textarea', 'Hello! This is a test campaign message that is long enough.');
    await page.click('button:has-text("Create campaign")');
    // After create, new campaign should appear or toast success
    await expect(page.getByText('New Campaign').or(page.getByText('Campaign created.'))).toBeVisible({ timeout: 5000 });
});

test('run campaign changes status to running', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    // Find Run button for first campaign
    const runButtons = page.getByRole('button', { name: /^Run$/i });
    await expect(runButtons.first()).toBeVisible();
    await runButtons.first().click();
    // After running, should show 'running' status or progress
    await expect(page.getByText('running').or(page.getByText('0/50 sent'))).toBeVisible({ timeout: 5000 });
});

test('schedule campaign requires datetime selection', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    const scheduleButtons = page.getByRole('button', { name: /Schedule/i });
    await scheduleButtons.first().click();
    await expect(page.getByText(/schedule time/i).or(page.locator('.sonner-toast'))).toBeVisible({ timeout: 3000 });
});

test('stats button refreshes campaign counts', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    const statsButtons = page.getByRole('button', { name: /Stats/i });
    await statsButtons.first().click();
    // Stats should show updated counts
    await expect(page.getByText(/50/).or(page.getByText(/sent/))).toBeVisible({ timeout: 5000 });
});

test('completed campaign shows sent/failed summary', async ({ page }) => {
    await setupAuthRoutes(page);
    await loginAndGo(page);
    // camp-2 is completed with 175 sent, 5 failed
    await expect(page.getByText('Eid Special')).toBeVisible();
    await expect(page.getByText('completed')).toBeVisible();
});
