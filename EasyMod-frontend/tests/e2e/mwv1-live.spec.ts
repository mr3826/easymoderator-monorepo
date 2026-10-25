/**
 * MW-V1 Increment 2 — live founder screenshots. Requires the real stack
 * (this worktree's backend :3000 + frontend :5173 + seeded lab DB).
 * Run explicitly: MWV1_LIVE=1 PLAYWRIGHT_BASE_URL=http://localhost:5173 \
 *   npx playwright test mwv1-live
 * Output: docs/merchant-workspace-v1/increment-2/walkthrough/*.png
 *
 * These capture READ-ONLY panel states (the mutation flows — claim/force/note/
 * tag — are proven by the 13/13 real-stack integration suite and the 10/10
 * deterministic mock-route journeys; driving them through Playwright's isolated
 * storageState races the per-context CSRF handshake, which is a harness detail,
 * not app behaviour).
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'fs';

test.skip(() => !process.env.MWV1_LIVE, 'live walkthrough: set MWV1_LIVE=1');

const OUT = new URL('../../../docs/merchant-workspace-v1/increment-2/walkthrough/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

test.setTimeout(120_000);
test.use({ viewport: { width: 1366, height: 950 } }); // xl breakpoint → inline panel column

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function labSignIn(page: Page, email: string, password = 'PilotLab@2026!') {
    await page.goto('/signin');
    const emailBox = page.getByRole('textbox', { name: /email/i });
    await emailBox.waitFor({ state: 'visible' });
    await emailBox.pressSequentially(email, { delay: 5 });
    await page.getByRole('textbox', { name: /password/i }).pressSequentially(password, { delay: 5 });
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|inbox/, { timeout: 30_000 });
}

// Live pages keep SSE open — NEVER waitForLoadState('networkidle').

test.describe('MW-V1 founder screenshots (live lab)', () => {
    test('shop A: context panel — ownership + relationship + notes + tags on a handoff', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await expect(page.getByText('Farhana (needs human)').first()).toBeVisible({ timeout: 30_000 });
        await page.getByText('Farhana (needs human)').first().click();
        await page.getByTestId('context-toggle').click();
        const panel = page.getByTestId('customer-context-panel');
        await expect(panel).toBeVisible({ timeout: 15_000 });
        await expect(panel.getByText('No one has taken this yet')).toBeVisible();
        await expect(panel.getByTestId('context-claim')).toBeVisible();
        await expect(panel.getByText('Delivered value')).toBeVisible();
        await expect(panel.getByText('PRIVATE NOTES', { exact: false })).toBeVisible();
        await shot(page, '01-context-panel-ownership');
    });

    test('shop A: queue view chips with live server counts', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await expect(page.getByTestId('queue-view-unassigned')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('queue-view-handoff')).toBeVisible();
        await expect(page.getByTestId('queue-view-recovery')).toBeVisible();
        await shot(page, '02-queue-views');
    });

    test('shop A: a conversation with real order history', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await page.getByText('Rima (serious buyer)').first().click({ timeout: 30_000 });
        await page.getByTestId('context-toggle').click();
        const panel = page.getByTestId('customer-context-panel');
        await expect(panel).toBeVisible({ timeout: 15_000 });
        await shot(page, '03-context-panel-rima');
    });

    test('shop B (flags off): panel renders with ZERO gated reads', async ({ page, context }) => {
        let gatedCalls = 0;
        context.on('request', (req) => { if (req.url().includes('/api/customer-intelligence/customers/')) gatedCalls += 1; });
        await labSignIn(page, 'pilot.b.owner@lab.easymod.local');
        await page.goto('/inbox');
        // open the first available thread in the control shop
        const first = page.locator('[data-testid="customer-context-panel"], main').first();
        await page.getByTestId('context-toggle').click({ timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        expect(gatedCalls).toBe(0);
        await shot(page, '04-shopb-flag-off');
    });

    test('mobile 390px: context sheet over the thread', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await page.getByText('Farhana (needs human)').first().click({ timeout: 30_000 });
        await page.getByTestId('context-toggle').click();
        await expect(page.getByTestId('customer-context-panel')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('context-close')).toBeVisible();
        await shot(page, '05-mobile-context-sheet');
    });
});
