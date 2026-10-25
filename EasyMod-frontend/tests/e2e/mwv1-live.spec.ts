/**
 * MW-V1 Increment 2 — live founder walkthrough. Requires the real stack
 * (this worktree's backend :3000 + frontend :5173 + seeded lab DB).
 * Not part of CI: run explicitly with
 *   MWV1_LIVE=1 npx playwright test mwv1-live --workers=1
 * Output: docs/merchant-workspace-v1/increment-2/walkthrough/*.png
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'fs';

test.skip(() => !process.env.MWV1_LIVE, 'live walkthrough: set MWV1_LIVE=1');

const OUT = new URL('../../../docs/merchant-workspace-v1/increment-2/walkthrough/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

test.setTimeout(150_000);
test.use({ viewport: { width: 1366, height: 950 } }); // xl breakpoint → inline panel column

const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

async function labSignIn(page: Page, email: string, password = 'PilotLab@2026!') {
    await page.goto('/signin');
    const emailBox = page.getByRole('textbox', { name: /email/i });
    await emailBox.waitFor({ state: 'visible' });
    await emailBox.pressSequentially(email, { delay: 5 });
    const pass = page.getByRole('textbox', { name: /password/i });
    await pass.pressSequentially(password, { delay: 5 });
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|inbox/, { timeout: 30_000 });
}

// Live pages keep SSE open — NEVER waitForLoadState('networkidle') here.

test.describe('MW-V1 live journeys', () => {
    test('J1 — customer context panel with real data + ownership section', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await expect(page.getByText('Rima (serious buyer)').first()).toBeVisible({ timeout: 30_000 });
        await page.getByText('Rima (serious buyer)').first().click();

        await page.getByTestId('context-toggle').click();
        const panel = page.getByTestId('customer-context-panel');
        await expect(panel).toBeVisible({ timeout: 15_000 });
        await expect(panel.getByRole('heading', { name: 'Ownership', exact: false }).first()).toBeVisible();
        await expect(panel.getByRole('heading', { name: 'Private notes', exact: false }).first()).toBeVisible();
        // flag-ON shop A may show relationship — either content or honest unavailable, never a crash
        await shot(page, '01-context-panel-live');
    });

    test('J4+J5 — staff claim → owner conflict 409 → privileged force converges live', async ({ browser }) => {
        const staffCtx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 950 } });
        const ownerCtx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 950 } });
        const staff = await staffCtx.newPage();
        const owner = await ownerCtx.newPage();
        await labSignIn(staff, 'pilot.a.staff@lab.easymod.local');
        await labSignIn(owner, 'pilot.a.owner@lab.easymod.local');

        await staff.goto('/inbox');
        await staff.getByText('Farhana (needs human)').first().click({ timeout: 30_000 });
        await staff.getByTestId('context-toggle').click();
        await staff.getByTestId('context-claim').click();
        await expect(staff.getByTestId('context-owner')).toContainText(/Assigned/i, { timeout: 15_000 });
        await expect(staff.getByTestId('context-claim')).toHaveCount(0); // now mine → claim gone
        await shot(staff, '02-claimed-by-staff');

        await owner.goto('/inbox');
        await owner.getByText('Farhana (needs human)').first().click({ timeout: 30_000 });
        await owner.getByTestId('context-toggle').click();
        // owner sees it is owned by staff; claiming yields the server's 409 reason
        await owner.getByTestId('context-claim').click();
        await expect(owner.getByTestId('context-owner-error')).toBeVisible({ timeout: 15_000 });
        await expect(owner.getByTestId('context-force')).toBeVisible(); // privileged offer only
        await owner.getByTestId('context-force').click();
        await expect(owner.getByTestId('context-claim')).toHaveCount(0); // force succeeded: owner is the assignee
        await shot(owner, '03-owner-forced-takeover');
        await staffCtx.close();
        await ownerCtx.close();
    });

    test('J6 — note persists across reload and never enters the thread', async ({ page }) => {
        const marker = `lab-note-${Date.now()}`;
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        await page.getByText('Rima (serious buyer)').first().click({ timeout: 30_000 });
        await page.getByTestId('context-toggle').click();
        await page.getByTestId('note-add-open').click();
        await page.getByTestId('note-composer').fill(marker);
        await page.getByTestId('note-save').click();
        await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 });

        await page.reload();
        await page.getByText('Rima (serious buyer)').first().click({ timeout: 30_000 });
        await page.getByTestId('context-toggle').click();
        await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 });
        // private: the note text must not exist anywhere in the message timeline
        expect(await page.locator('[data-testid="customer-context-panel"]').count()).toBe(1);
        const threadText = await page.evaluate(() => document.body.innerText);
        const occurrences = threadText.split(marker).length - 1;
        expect(occurrences).toBe(1); // only in the panel, never duplicated into messages
        await shot(page, '04-note-persists-reload');
    });

    test('J7 — tag vocabulary + assignment keeps panel consistent', async ({ page }) => {
        await labSignIn(page, 'pilot.a.owner@lab.easymod.local');
        await page.goto('/inbox');
        // create (or reuse) a vocabulary tag through the real authenticated API
        const created = await page.evaluate(async () => {
            const r = await fetch('/api/customer/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ name: 'Priority service' }),
            });
            return r.json();
        });
        expect(created.success).toBeTruthy();

        await page.getByText('Rima (serious buyer)').first().click({ timeout: 30_000 });
        await page.getByTestId('context-toggle').click();
        await page.getByTestId('tag-edit-open').click();
        await page.getByTestId('tag-editor').getByRole('button', { name: /Priority service/i }).click();
        await page.getByTestId('tag-apply').click();
        await expect(page.locator('[data-testid="customer-context-panel"]').getByText('Priority service')).toBeVisible({ timeout: 15_000 });
        await shot(page, '05-tag-assigned');
    });

    test('J9 — shop B (all flags off): panel issues ZERO customer-intelligence requests', async ({ page, context }) => {
        let gatedCalls = 0;
        context.on('request', (req) => {
            if (req.url().includes('/api/customer-intelligence/')) gatedCalls += 1;
        });
        await labSignIn(page, 'pilot.b.owner@lab.easymod.local');
        await page.goto('/inbox');
        // pick the first thread in the control shop
        await page.locator('button, [role="button"]').filter({ hasText: /\(/ }).first().click({ timeout: 30_000 });
        const toggle = page.getByTestId('context-toggle');
        await toggle.click();
        await expect(page.getByTestId('customer-context-panel')).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(2500);
        expect(gatedCalls).toBe(0);
        await shot(page, '06-shopb-flag-off-no-gated-reads');
    });
});
