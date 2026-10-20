import { test, expect } from '@playwright/test';
import {
  authStatePath,
  dateTimeLocalPlus,
  fixtures,
  runStamp,
} from './support';

test.describe('action-first sales journeys', () => {
  test.use({ storageState: authStatePath('growth') });

  test('growth user lands on the ordered Today queue and can act from it', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    const queue = page.getByRole('region', { name: 'Action queue' });
    await expect(queue.getByRole('heading', { name: 'Overdue follow-ups' })).toBeVisible();
    await expect(queue.getByRole('heading', { name: 'Due today' })).toBeVisible();
    await expect(queue.getByRole('heading', { name: 'Qualified leads without an owner' })).toBeVisible();
    await expect(queue.getByRole('heading', { name: 'Onboarding stalled 15+ days' })).toBeVisible();

    // Every queue row explains itself and links to the canonical record.
    const firstRow = queue.getByRole('listitem').first();
    await expect(firstRow.getByText(/Overdue by \d+ days?/)).toBeVisible();
    await expect(firstRow.getByRole('link', { name: 'Follow-up Studio' }))
      .toHaveAttribute('href', `/prospects/${fixtures.prospects.followUpStudio.id}`);

    // GROWTH_USER never sees the Admin Control context toggle (boundary B1).
    await expect(page.getByRole('group', { name: 'Workspace context' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Growth Users' })).toHaveCount(0);
    await expect(page.getByRole('banner').getByRole('link', { name: 'Add prospect' }))
      .toHaveAttribute('href', '/prospects/new');
  });

  test('sales operator records a typed outcome on completion and history shows it (S1)', async ({ page }) => {
    const stamp = runStamp();
    const action = `E2E action-first follow-up ${stamp}`;
    const reason = `E2E action-first outcome ${stamp}`;

    await page.goto(`/prospects/${fixtures.prospects.followUpStudio.id}`);
    const panel = page.locator('section[aria-labelledby="followups-panel-title"]');
    await expect(panel).toBeVisible();

    // Schedule a fresh follow-up for this run so shared fixtures never race.
    await panel.locator('#panel-followup-due').fill(dateTimeLocalPlus(60 * 60 * 1000));
    await panel.locator('#panel-followup-action').fill(action);
    const created = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().endsWith('/api/internal/growth-os/followups')
      && response.status() === 201
    ));
    await panel.getByRole('button', { name: 'Schedule follow-up' }).click();
    await created;
    const row = panel.locator('li', { hasText: action });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Complete' }).click();
    await row.getByLabel('Outcome (required)').selectOption('reached');
    await row.getByLabel('Reason (optional, max 200 chars)').fill(reason);
    const completed = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().endsWith('/status')
      && response.status() === 200
    ));
    await row.getByRole('button', { name: 'Record and complete' }).click();
    const body = await (await completed).json();
    expect(body.data.status).toBe('completed');

    // The audited timeline keeps the reason visible; history is never silent.
    await page.reload();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(panel.locator('li', { hasText: action })).toHaveCount(0);
  });

  test('legacy report routes stay deep-linkable while Growth Performance consolidates tabs', async ({ page }) => {
    await page.goto('/sources');
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();

    await page.goto('/performance');
    await expect(page.getByRole('heading', { name: 'Growth Performance', exact: true })).toBeVisible();
    const tabs = page.getByRole('group', { name: 'Performance views' });
    await expect(tabs.getByRole('button', { name: /Source attribution/ })).toBeVisible();
    await tabs.getByRole('button', { name: /Source attribution/ }).click();
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quick Add' })).toHaveCount(0);
  });

  test('growth user is denied the Admin Control surface by the backend', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();

    const homeStatus = await page.evaluate(async () => (
      (await fetch('/api/internal/growth-os/home', { credentials: 'include' })).status
    ));
    expect(homeStatus).toBe(200); // /home itself is a workspace surface.
    const adminStatus = await page.evaluate(async () => (
      (await fetch('/api/internal/growth-os/admin/operations', { credentials: 'include' })).status
    ));
    expect(adminStatus).toBe(403);
  });
});

test.describe('action-first mobile queue', () => {
  test.use({ storageState: authStatePath('growth'), viewport: { width: 320, height: 640 } });

  test('narrow mobile keeps the queue usable without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Overdue follow-ups' })).toBeVisible();
    const overflow = await page.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ));
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('action-first admin journeys', () => {
  test.use({ storageState: authStatePath('super') });

  test('super admin defaults to Admin Control, switches contexts, and aggregates stay honest (A1)', async ({ page }) => {
    await page.goto('/');
    const switcher = page.getByRole('group', { name: 'Workspace context' });
    await expect(switcher).toBeVisible();
    await expect(switcher.getByRole('button', { name: 'Admin Control' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: 'Attention' })).toHaveAttribute('href', '/admin');

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Attention', exact: true })).toBeVisible();
    const signals = page.getByRole('region', { name: 'Operational attention' });
    await expect(signals.getByText(/No record-level merchant identification is available/)).toBeVisible();
    await expect(signals.getByRole('link', { name: 'Open Operations' })).toHaveAttribute('href', '/operations');
    await expect(
      page.getByRole('region', { name: 'Team & access' })
        .getByRole('link', { name: /Manage growth staff/ }),
    ).toHaveAttribute('href', '/growth-users');

    // Supported drilldowns navigate to cohort-bearing views.
    const stuck = page.getByRole('region', { name: 'Merchants needing support investigation' });
    await stuck.getByRole('link', { name: 'View stalled cohort' }).first().click();
    await expect(page).toHaveURL(/\/prospects\?status=onboarding&stalledBefore=/);

    // Switching context changes navigation and home, not authority.
    await switcher.getByRole('button', { name: 'Sales & Growth' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'My Work' })).toBeVisible();
    await switcher.getByRole('button', { name: 'Admin Control' }).click();
    await expect(page).toHaveURL(/\/admin$/);
  });
});
