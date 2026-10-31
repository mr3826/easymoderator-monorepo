import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const screenshots = resolve(process.cwd(), '..', 'docs', 'merchant-redesign', 'public-funnel-v4', 'screenshots', 'final-local');
mkdirSync(screenshots, { recursive: true });

test.describe('EasyModerator public funnel V4', () => {
  test('explains the connected workflow and captures the responsive landing', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    for (const width of [1440, 1280, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?lang=en');
      await expect(page.getByRole('heading', { level: 1, name: /bring customer replies and order work together/i })).toBeVisible();
      await expect(page.getByRole('figure', { name: /sample Messenger work journey/i })).toContainText('AI reply draft');
      await expect(page.getByRole('figure', { name: /sample Messenger work journey/i })).toContainText('Not sent');
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
      await page.getByRole('link', { name: /create account/i }).first().click();
      await expect(page).toHaveURL(/\/signup\?lang=en/);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?lang=en');
    await page.getByRole('link', { name: /create account/i }).first().click();
    await expect(page).toHaveURL(/\/signup\?lang=en/);
    await expect(page.getByRole('heading', { name: /create your merchant account/i })).toBeVisible();

    await page.goto('/?lang=en');
    await page.getByRole('link', { name: /see how it works/i }).click();
    await expect(page).toHaveURL(/#workflow$/);
    await page.getByRole('link', { name: /compare plans/i }).first().click();
    await expect(page).toHaveURL(/\/pricing\?lang=en/);

    await page.goto('/?lang=en');
    const quotaFaq = page.locator('details').filter({ hasText: /How is a conversation counted/i });
    await quotaFaq.locator('summary').click();
    await expect(quotaFaq).toContainText(/24 hours with no activity/i);
    await page.getByRole('link', { name: /sign in/i }).first().click();
    await expect(page).toHaveURL(/\/signin\?lang=en/);
    await expect(page.getByRole('heading', { name: /sign in to EasyModerator/i })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('switches languages and keeps the mobile menu usable at 390px and 320px', async ({ page }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/?lang=en');
      await page.getByRole('button', { name: /open navigation/i }).click();
      await expect(page.getByRole('button', { name: /close navigation/i })).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: /switch to bengali/i }).click();
      await expect(page.getByRole('heading', { level: 1, name: /কাস্টমারের রিপ্লাই ও অর্ডারের কাজ গুছিয়ে চালান/i })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
      const menuToggle = page.locator('button[aria-controls="public-funnel-navigation"]');
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
      await menuToggle.click();
      await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
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
    await expect(page.getByText(/one active Messenger thread for the same shop/i)).toBeVisible();
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
});
