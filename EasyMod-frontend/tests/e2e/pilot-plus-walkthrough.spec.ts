/**
 * Pilot+ founder walkthrough — captures real UI evidence against the live lab
 * stack (npm scripts/pilotplus-lab.ps1 must be running). Not part of CI; run
 * explicitly: PW_WALKTHROUGH=1 npx playwright test pilot-plus-walkthrough
 * Output: docs/pilot-plus-v1/walkthrough/*.png
 */

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';

const OUT = new URL('../../../docs/pilot-plus-v1/walkthrough/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

test.setTimeout(120_000);
test.use({ viewport: { width: 1280, height: 900 } });

const shot = (page: any, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function labSignIn(page: any, email: string, password = 'PilotLab@2026!') {
    await page.goto('/signin');
    const emailBox = page.getByRole('textbox', { name: /email/i });
    await emailBox.waitFor({ state: 'visible' });
    await emailBox.pressSequentially(email, { delay: 5 });
    const pass = page.getByRole('textbox', { name: /password/i });
    await pass.pressSequentially(password, { delay: 5 });
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|inbox/, { timeout: 30_000 });
}

// NOTE: never waitForLoadState('networkidle') on live pages — the inbox SSE
// EventSource keeps a connection open forever.

test.describe('founder walkthrough (live lab)', () => {
    test('shop A: inbox queue + lead strip + handoff thread', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await expect(page.getByText('Rima (serious buyer)').first()).toBeVisible({ timeout: 30_000 });
        await shot(page, '01-inbox-queue-and-chips');

        await page.getByText('Rima (serious buyer)').first().click();
        await expect(page.getByTestId('inbox-lead-insight')).toBeVisible({ timeout: 20_000 });
        await page.waitForTimeout(800);
        await shot(page, '02-lead-strip-draft');

        await page.getByText('Farhana (needs human)').first().click();
        await page.waitForTimeout(1200);
        await shot(page, '03-human-handoff-thread');
    });

    test('shop A: customers 360 + orders + faq gaps', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/customers');
        // Customers table cells can render hidden behind tab state; witness by text presence.
        await expect.poll(async () => page.evaluate(() => document.body.innerText.includes('Sadia (browser)')), { timeout: 30_000 }).toBe(true);
        await page.waitForTimeout(1500);
        await shot(page, '04-customers-opportunities');

        await page.goto('/orders');
        await page.waitForTimeout(1500);
        await shot(page, '05-orders');

        await page.goto('/manage-shop/faqs');
        await expect(page.getByTestId('gap-suggestions')).toBeVisible({ timeout: 20_000 });
        await shot(page, '06-faq-gap-suggestions');
    });

    test('shop B control + mobile view', async ({ page }) => {
        await labSignIn(page, 'pilot.b.owner@lab.easymod.local');
        await page.goto('/inbox');
        await page.waitForTimeout(2500);
        await shot(page, '07-shop-b-flagged-off');
        // Control shop must show NO queue panel and NO lead chips:
        await expect(page.getByTestId('action-queue')).toHaveCount(0);
        await expect(page.getByTestId('lead-chip')).toHaveCount(0);

        await page.setViewportSize({ width: 375, height: 780 });
        await page.goto('/inbox');
        await page.waitForTimeout(2500);
        await shot(page, '08-mobile-375');
    });
});
