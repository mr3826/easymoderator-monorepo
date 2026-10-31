import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshots = resolve(process.cwd(), 'test-results', 'v7-public-funnel');
mkdirSync(screenshots, { recursive: true });

const features = { image_understanding: true, advanced_ai: true, priority_support: true, custom_branding: false };
const publicPlans = [
  { code: 'SHURU', name: 'Shuru', description: 'Start with Messenger', billing_model: 'flat_monthly', price_bdt_monthly: 0, price_bdt_yearly: 0, conversations_limit: 100, orders_limit: -1, products_limit: -1, can_purchase_topups: false, per_order_charge_bdt: null, features },
  { code: 'GROWTH', name: 'Growth', description: 'More Messenger conversations', billing_model: 'flat_monthly', price_bdt_monthly: 999, price_bdt_yearly: 9990, conversations_limit: 500, orders_limit: -1, products_limit: -1, can_purchase_topups: true, per_order_charge_bdt: null, features, topup_packs: [{ code: 'PACK_100', conversations: 100, priceBdt: 250 }], partner_order_tiers: [] },
  { code: 'PARTNER', name: 'Partner', description: 'Delivered-order billing', billing_model: 'per_order', price_bdt_monthly: 0, price_bdt_yearly: 0, conversations_limit: -1, orders_limit: -1, products_limit: -1, can_purchase_topups: false, per_order_charge_bdt: 15, features, partner_order_tiers: [{ minOrders: 300, maxOrders: 999, rateBdt: 15 }, { minOrders: 1000, maxOrders: 2999, rateBdt: 12 }, { minOrders: 3000, maxOrders: null, rateBdt: 10 }] },
];

async function mockPublicApi(page: import('@playwright/test').Page) {
  let authenticated = false;
  const user = { id: 'v7-preview-user', email: 'v7-preview@example.invalid', full_name: 'V7 Preview Merchant', role: 'MERCHANT', shop_id: 'v7-preview-shop' };
  const shop = { id: 'v7-preview-shop', code: 'V7TEST', shop_name: 'V7 Preview Shop' };
  await page.route((url) => new URL(url).pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': request.headers().origin ?? url.origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'Content-Type,Authorization,X-CSRF-Token,Idempotency-Key',
    };
    const json = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/api/csrf') return json(200, { csrfToken: 'v7-preview-csrf' });
    if (url.pathname === '/api/auth/me') {
      return authenticated
        ? json(200, { success: true, data: { user, shop, currentShop: shop, allShops: [shop] } })
        : json(401, { success: false, error: { code: 'UNAUTHORIZED' } });
    }
    if (url.pathname === '/api/subscription/plans') return json(200, { success: true, data: publicPlans });
    if (url.pathname === '/api/analytics/funnel') return json(200, { success: true, data: {} });
    if (url.pathname === '/api/partner/apply' && request.method() === 'POST') {
      return json(200, { success: true, application_id: 'v7-preview-application', eligibility: { delivered_orders_30d: 0, minimum_delivered_orders: 300, eligible: false, available: true } });
    }
    if (url.pathname === '/api/auth/signup' && request.method() === 'POST') {
      authenticated = true;
      return json(201, { success: true, data: { user, shop, currentShop: shop, allShops: [shop] } }, { 'set-cookie': 'v7-preview-session=1; Path=/; SameSite=Lax' });
    }
    if (url.pathname === '/api/auth/signin' && request.method() === 'POST') {
      authenticated = true;
      return json(200, { success: true, data: { user, shop, currentShop: shop, allShops: [shop] } }, { 'set-cookie': 'v7-preview-session=1; Path=/; SameSite=Lax' });
    }
    if (url.pathname === '/api/subscription' && request.method() === 'GET') return json(200, { success: true, data: {
      subscription: { id: 'v7-subscription', shop_id: shop.id, plan_code: 'SHURU', plan_name: 'Shuru', plan_price: 0, billing_cycle: 'monthly', billing_model: 'flat_monthly', status: 'active', conversations_limit: 100, conversations_used: 0, orders_limit: -1, orders_used: 0, products_limit: -1, products_used: 0, topup_balance: 0, current_period_start: '2026-10-01T00:00:00.000Z', current_period_end: '2026-11-01T00:00:00.000Z', next_billing_date: '2026-11-01T00:00:00.000Z', features },
      usage: { conversations: { used: 0, limit: 100, percentage: 0, status: 'safe' }, orders: { used: 0, limit: -1, percentage: 0, status: 'safe' }, products: { used: 0, limit: -1, percentage: 0, status: 'safe' } },
      effective_conversation_limit: 100, conversation_quota_exhausted: false, period: { start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' }, partner_eligibility: { delivered_orders_30d: 0, minimum_delivered_orders: 300, eligible: false, available: true }, extra_usage: { conversations: 0, charge: 0 },
    } });
    if (url.pathname === '/api/subscription/invoices' || /\/topup.*packs$/.test(url.pathname)) return json(200, { success: true, data: [] });
    return json(200, { success: true, data: {} });
  });
  await page.route('https://api.easymod.tech/**', (route) => route.abort('blockedbyclient'));
  await page.route('https://app.easymod.tech/**', (route) => route.abort('blockedbyclient'));
}

test.describe('EasyModerator public funnel V7 (mocked API only)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPublicApi(page);
  });
  test('explains the connected workflow and captures the responsive landing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const width of [1440, 1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?lang=en');
      const heroHeading = page.getByRole('heading', { level: 1, name: /focus on selling/i });
      await expect(heroHeading).toBeVisible();
      await expect(heroHeading).toContainText(/Moderator help with customer questions/i);
      const skip = page.getByRole('link', { name: /skip to content/i });
      await skip.focus();
      await page.keyboard.press('Enter');
      const main = page.locator('#public-funnel-main');
      await expect(main).toBeFocused();
      const [mainTop, stickyHeaderHeight] = await Promise.all([
        main.evaluate((element) => element.getBoundingClientRect().top),
        page.locator('header.funnel-header').evaluate((element) => element.getBoundingClientRect().height),
      ]);
      expect(mainTop).toBeGreaterThanOrEqual(stickyHeaderHeight - 1);
      const workflowFigure = page.getByRole('figure', { name: /illustrative Messenger reply and order review workflow/i });
      await expect(workflowFigure).toContainText('AI-assisted reply');
      await expect(workflowFigure).toContainText(/draft.*not sent/i);
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
      }));
      expect(dimensions.page, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
      const path = resolve(screenshots, `landing-en-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      await page.getByRole('link', { name: /see how it works/i }).click();
      await expect(page).toHaveURL(/#workflow$/);
      await page.goto('/?lang=en');
      await page.getByRole('link', { name: /create a Shuru account/i }).first().click();
      await expect(page).toHaveURL(/\/signup\?lang=en/);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?lang=en');
    await page.getByRole('link', { name: /create a Shuru account/i }).first().click();
    await expect(page).toHaveURL(/\/signup\?lang=en/);
    await expect(page.getByRole('heading', { name: /create your EasyModerator account/i })).toBeVisible();

    await page.goto('/?lang=en');
    await page.getByRole('link', { name: /see how it works/i }).click();
    await expect(page).toHaveURL(/#workflow$/);
    await page.getByRole('navigation', { name: /primary navigation/i }).getByRole('link', { name: /^plans$/i }).click();
    await expect(page).toHaveURL(/#plans$/);

    await page.goto('/?lang=en');
    const planFaq = page.locator('details').filter({ hasText: /Which plan does a new account get/i });
    await planFaq.locator('summary').click();
    await expect(planFaq).toContainText(/new accounts start on Shuru/i);
    await page.getByRole('link', { name: /sign in/i }).first().click();
    await expect(page).toHaveURL(/\/signin\?lang=en/);
    await expect(page.getByRole('heading', { name: /sign in to EasyModerator/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('switches languages and keeps the mobile menu usable at 390px and 320px', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?lang=en');
      const menuToggle = page.locator('button[aria-controls="public-funnel-navigation"]');
      const controlledMenu = page.locator('#public-funnel-navigation');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(controlledMenu).toHaveCount(1);
      await expect(controlledMenu).toBeHidden();
      await page.getByRole('button', { name: /open navigation/i }).click();
      await expect(page.getByRole('button', { name: /close navigation/i })).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: /switch to bengali/i }).click();
      await expect(page.getByRole('heading', { level: 1, name: /আপনি বিক্রিতে মন দিন/i })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
      await menuToggle.click();
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      await expect(controlledMenu).toBeHidden();
      const path = resolve(screenshots, `landing-bn-${width}.png`);
      await page.screenshot({ path, fullPage: true });
      const dimensions = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
      }));
      expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
    }
  });

  test('loads published plans, explains quota and validates Partner phone locally', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    let partnerPostCount = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.includes('partner')) partnerPostCount += 1;
    });
    const planResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/subscription/plans');
    await page.goto('/pricing?lang=en');
    const planResponse = await planResponsePromise;
    expect(planResponse.status(), await planResponse.text()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: /plans for your connected workflow/i })).toBeVisible();
    await expect(page.getByRole('article').filter({ hasText: 'Growth' })).toContainText('৳999');
    const activeConversationUnit = page.getByText(/one active Messenger thread for the same shop/i);
    await expect(activeConversationUnit).toBeVisible();
    await expect(activeConversationUnit).toContainText(/until 24 hours pass with no thread activity/i);
    await page.screenshot({ path: resolve(screenshots, 'pricing-en-1280.png'), fullPage: true });

    await page.getByRole('button', { name: /request Partner review/i }).click();
    await expect(page.getByRole('dialog', { name: /Partner application/i })).toBeVisible();
    await page.getByLabel(/business name/i).fill('Sample shop');
    await page.getByLabel(/phone/i).fill('12345');
    await page.getByLabel(/Facebook Page/i).fill('https://facebook.com/sample-shop');
    await page.getByRole('button', { name: /send application for review/i }).click();
    await expect(page.getByText(/enter a valid Bangladesh mobile number/i)).toBeVisible();
    expect(partnerPostCount).toBe(0);
  });

  test('records a local Partner review request without changing a subscription', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/pricing?lang=en');
    await page.getByRole('button', { name: /request Partner review/i }).click();
    await page.getByLabel(/business name/i).fill(`Local preview partner ${Date.now()}`);
    await page.getByLabel(/phone/i).fill('+880 1712-345678');
    await page.getByLabel(/Facebook Page/i).fill('https://facebook.com/local-preview-only');

    const applicationResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/partner/apply',
    );
    await page.getByRole('button', { name: /send application for review/i }).click();
    const response = await applicationResponse;
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      eligibility: { delivered_orders_30d: 0, minimum_delivered_orders: 300, eligible: false },
    });
    expect(body.application_id).toBeTruthy();
    await expect(page.getByRole('heading', { name: /application received/i })).toBeVisible();
    await expect(page.getByText(/your current plan has not changed/i)).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, 'partner-application-received-en.png'), fullPage: true });
  });

  test('carries a Growth review request through local signup and keeps payment gated', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/pricing?lang=en');
    const growthCard = page.locator('article').filter({ hasText: 'Growth' });
    const growthLink = growthCard.getByRole('link', { name: /review Growth options/i });
    await expect(growthLink).toHaveAttribute('href', /intent=growth-upgrade/);
    await growthLink.click();
    await expect(page).toHaveURL(/\/signup\?lang=en&intent=growth-upgrade$/);

    await page.getByLabel('Your name').fill('Local Preview Merchant');
    await page.getByLabel('Email').fill(`local-preview-${Date.now()}@example.invalid`);
    await page.getByLabel('Mobile number').fill('01712345678');
    await page.locator('input[name="password"]').fill('LocalPreview123!');
    await page.getByRole('checkbox').click();
    const signupResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/auth/signup',
    );
    await page.getByRole('button', { name: /create a Shuru account/i }).click();
    const response = await signupResponse;
    expect(response.status(), await response.text()).toBe(201);
    await expect(page).toHaveURL(/\/subscription\?intent=growth-upgrade&lang=en$/);
    await expect(page.getByRole('status')).toContainText(/new accounts start on Shuru/i);
    await expect(page.locator('#growth-plan').getByRole('button')).toBeDisabled();
    await expect(page.locator('#growth-plan').getByRole('button')).toContainText(/bKash payment is not available/i);
    await page.screenshot({ path: resolve(screenshots, 'growth-review-after-signup-en.png'), fullPage: true });
  });

  test('shows an error and never substitutes pinned plan values when the catalog is unavailable', async ({ page }) => {
    await page.route('**/subscription/plans', (route) => route.abort());
    await page.goto('/pricing?lang=en');
    await expect(page.getByRole('alert')).toContainText(/current plan details are unavailable/i);
    await expect(page.getByText('৳999')).toHaveCount(0);
    await page.getByRole('button', { name: /retry/i }).click();
    await expect(page.getByRole('alert')).toContainText(/current plan details are unavailable/i);
  });

  test('linked legal pages do not assert an unverified Meta review status', async ({ page }) => {
    await page.goto('/privacy-policy?lang=en');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByText(/Facebook Messenger features are available only when/i)).toBeVisible();
    await expect(page.getByText(/Meta App Review is being completed/i)).toHaveCount(0);
    await expect(page.getByText(/Google and OpenAI in the United States/i)).toHaveCount(0);
    await expect(page.getByText(/Messages sent and received through connected Facebook Messenger Pages/i)).toBeVisible();
    await expect(page.getByText(/or web chat/i)).toHaveCount(0);
    const geminiRow = page.locator('tr').filter({ hasText: 'Google (Gemini)' });
    await expect(geminiRow).toContainText(/payment screenshots for OCR if Gemini is configured and reached/i);
    await expect(geminiRow).toContainText(/only if configured and used/i);
    const openAiRow = page.locator('tr').filter({ hasText: 'OpenAI' });
    await expect(openAiRow).toContainText(/payment screenshots if OCR fallback reaches OpenAI/i);
    await expect(openAiRow).toContainText(/only if configured and used/i);
    const bkashBillingRow = page.locator('tr').filter({ hasText: 'bKash subscription billing' });
    await expect(bkashBillingRow).toContainText(/EasyModerator subscription invoices and conversation top-ups/i);
    await expect(bkashBillingRow).toContainText(/only if platform billing is enabled/i);
    await expect(page.getByText(/Not enabled: the bKash and Nagad online payment gateways/i)).toHaveCount(0);
    await expect(page.getByText(/Online bKash processing depends on platform controls and per-shop configuration/i)).toHaveCount(0);
    await expect(page.getByText(/not a per-shop gateway for customer orders/i)).toBeVisible();
    await expect(page.getByText(/Direct bKash or Nagad transfers are verified by the merchant/i)).toBeVisible();
    const operationsAlertRow = page.locator('tr').filter({ hasText: 'Configured operations-alert webhook' });
    await expect(operationsAlertRow).toHaveCount(1);
    await expect(operationsAlertRow).toContainText(/guardrail escalations/i);
    await expect(operationsAlertRow).toContainText(/only if configured/i);
    const generalAlertsRow = page.locator('tr').filter({ hasText: 'Configured Slack webhook / Sentry' });
    await expect(generalAlertsRow).toHaveCount(1);
    await expect(generalAlertsRow).toContainText(/error text/i);
    await expect(generalAlertsRow).toContainText(/only where configured/i);

    await page.goto('/?lang=bn');
    const connectionFaq = page.locator('details').filter({ hasText: /Facebook Page যুক্ত করলে কী হয়/ });
    await connectionFaq.locator('summary').click();
    await expect(connectionFaq).toContainText(/আপনার অ্যাকাউন্ট ও Page অনুযায়ী কোন Page-এ প্রবেশাধিকার পাবেন/);

    await page.goto('/terms?lang=en');
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByText(/Facebook Messenger features are available only when/i)).toBeVisible();
    await expect(page.getByText(/Meta App Review is being completed/i)).toHaveCount(0);
    const termsPayments = page.locator('li').filter({ hasText: 'Optional platform-level bKash processing' });
    await expect(termsPayments).toHaveCount(1);
    await expect(termsPayments).toContainText(/subscription invoices and conversation top-ups/i);
    await expect(termsPayments).toContainText(/not a per-shop gateway for customer orders/i);
    await expect(termsPayments).toContainText(/Direct bKash or Nagad transfers are merchant-verified/i);
    await expect(page.getByText(/Online payment gateways are not currently enabled/i)).toHaveCount(0);
    const termsCrossBorder = page.locator('p').filter({ hasText: 'AI request content may be sent to Google or OpenAI' });
    await expect(termsCrossBorder).toHaveCount(1);
    await expect(termsCrossBorder).toContainText(/only when the provider is configured and a request reaches it/i);
  });

  test('landing and pricing screens have no WCAG 2.1 A/AA violations in English or Bengali', async ({ page }) => {
    for (const path of ['/?lang=en', '/pricing?lang=en', '/?lang=bn', '/pricing?lang=bn']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const violations = results.violations.map(({ id, impact, description, nodes }) => ({
        id,
        impact,
        description,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
      }));
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    }
  });
});
