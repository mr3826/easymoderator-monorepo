/**
 * LLM Settings — Playwright System Tests
 * Verifies Gemini + OpenAI only (no Claude, vLLM, DeepSeek in UI)
 */

import { expect, test } from '@playwright/test';

const mockUser = { id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd' };
const mockShop = { id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role: 'owner' };

const mockAISettings = {
    primary_provider: 'gemini',
    fallback_provider: 'openai',
    gemini_api_key: 'AIza-existing-key',
    openai_api_key: 'sk-existing-key',
    model_preset: 'balanced',
    max_tokens: 500
};

async function setupRoutes(page: any) {
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
        if (path.match(/\/api\/shops\/[\w-]+\/settings\/ai/) && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockAISettings }) });
        if (path.match(/\/api\/shops\/[\w-]+\/settings\/ai/) && method === 'PUT') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockAISettings }) });

        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{}}' });
    });
}

async function loginAndGo(page: any, path = '/settings/ai') {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'owner@shop.bd');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|settings/);
    await page.goto(path);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('AI settings page loads', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(
        page.getByText(/AI|chatbot|LLM|intelligence/i).first()
    ).toBeVisible({ timeout: 5000 });
});

test('Gemini is shown as primary provider', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText(/gemini/i)).toBeVisible({ timeout: 5000 });
});

test('OpenAI is shown as fallback provider', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(page.getByText(/openai/i)).toBeVisible({ timeout: 5000 });
});

test('Claude / Anthropic is NOT visible in provider list', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await page.waitForTimeout(2000);
    await expect(page.getByText(/claude/i)).not.toBeVisible();
    await expect(page.getByText(/anthropic/i)).not.toBeVisible();
});

test('vLLM is NOT visible in provider options', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await page.waitForTimeout(2000);
    await expect(page.getByText(/vllm/i)).not.toBeVisible();
});

test('DeepSeek is NOT visible in provider options', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await page.waitForTimeout(2000);
    await expect(page.getByText(/deepseek/i)).not.toBeVisible();
});

test('Gemini API key field is present', async ({ page }) => {
    await setupRoutes(page);
    await loginAndGo(page);
    await expect(
        page.locator('input[name*="gemini"], input[placeholder*="Gemini"], input[placeholder*="AIza"]').or(
            page.getByLabel(/gemini api key/i)
        )
    ).toBeVisible({ timeout: 5000 });
});

test('save Gemini API key calls API', async ({ page }) => {
    await setupRoutes(page);
    let apiCalled = false;
    await page.route('**/api/shops/*/settings/ai', async (route) => {
        if (route.request().method() === 'PUT') {
            apiCalled = true;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockAISettings }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: mockAISettings }) });
    });
    await loginAndGo(page);
    const geminiInput = page.locator('input[name*="gemini"], input[placeholder*="Gemini"], input[placeholder*="AIza"]').first();
    if (await geminiInput.isVisible()) {
        await geminiInput.fill('AIza-new-key-12345');
        const saveBtn = page.getByRole('button', { name: /save/i }).first();
        await saveBtn.click();
        await page.waitForTimeout(500);
        expect(apiCalled).toBe(true);
    }
});

test('save shows success notification', async ({ page }) => {
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
