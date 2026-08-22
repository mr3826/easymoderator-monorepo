import { test, expect } from '@playwright/test';
import { fixtures, pageRequest, signIn } from './support';

test.describe('Growth OS permissions and response scoping', () => {
  test('merchant without a Growth role is denied and has no Growth navigation', async ({ page }) => {
    await signIn(page, fixtures.users.merchant, { assertAuthorized: false });
    await expect(page).toHaveURL(/\/access-denied$/);
    await expect(page.getByRole('navigation', { name: 'Growth OS navigation' })).toHaveCount(0);

    const response = await pageRequest(page, '/api/internal/growth-os/prospects?page=1&pageSize=20');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('GROWTH_OS_FORBIDDEN');
  });

  test('business executive can read assigned prospects but cannot open the create route', async ({ page }) => {
    await signIn(page, fixtures.users.executive);
    await expect(page.getByRole('link', { name: 'Prospects' })).toBeVisible();

    await page.goto('/prospects/new');
    await expect(page.getByText('Access denied', { exact: true })).toBeVisible();
    const response = await pageRequest(page, '/api/internal/growth-os/prospects', {
      method: 'POST',
      body: {
        businessName: 'Unauthorized browser create',
        contactEmail: 'unauthorized-browser-create@example.test',
        source: 'manual_entry',
      },
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('GROWTH_OS_FORBIDDEN');
  });

  test('marketer is source-scoped and receives redacted values in API responses', async ({ page }) => {
    await signIn(page, fixtures.users.marketer);

    const listResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/internal/growth-os/prospects?')
    ));
    await page.goto('/prospects');
    const listResponse = await listResponsePromise;
    const listText = await listResponse.text();
    const listBody = JSON.parse(listText) as { data: { items: Array<{ source: string }> } };
    const marketingSources = new Set(['self_signup', 'partner_form', 'referral_mention', 'inbound_message', 'event']);
    expect(listBody.data.items.length).toBeGreaterThan(0);
    expect(listBody.data.items.every((item) => marketingSources.has(item.source))).toBe(true);
    expect(listText).not.toContain(fixtures.privateMarker);
    expect(listText).not.toContain(fixtures.privateTimelineReason);
    expect(listText).not.toContain(fixtures.prospects.manualPrivate.businessName);

    const visibleProspect = fixtures.prospects.marketingRedacted;
    const detailResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().endsWith(`/api/internal/growth-os/prospects/${visibleProspect.id}`)
    ));
    await page.getByRole('link', { name: visibleProspect.businessName }).click();
    const detailResponse = await detailResponsePromise;
    const detailText = await detailResponse.text();
    expect(detailText).not.toContain(fixtures.privateMarker);
    expect(detailText).not.toContain(fixtures.privateTimelineReason);
    await expect(page.getByText('Hidden for your role')).toHaveCount(4);

    const response = await pageRequest(page, '/api/internal/growth-os/prospects', {
      method: 'POST',
      body: {
        businessName: 'Marketer cannot create',
        contactEmail: 'marketer-cannot-create@example.test',
        source: 'partner_form',
      },
    });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('GROWTH_OS_FORBIDDEN');
  });
});
