import { test, expect } from '@playwright/test';
import { fixtures, signIn } from './support';

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

for (const viewport of viewports) {
  test.describe(`responsive Growth OS at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('keeps prospect navigation, content, sidebar, and primary hit targets usable', async ({ page }) => {
      await signIn(page, fixtures.users.executive);
      await page.getByRole('link', { name: 'Prospects' }).click();
      await expect(page.getByRole('heading', { name: 'Prospects', exact: true })).toBeVisible();

      const prospectLink = page.getByRole('link', { name: fixtures.prospects.executiveAssigned.businessName });
      await prospectLink.scrollIntoViewIfNeeded();
      await expect(prospectLink).toBeVisible();

      const layout = await page.locator('.app-frame').evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(layout.columns).toBe(viewport.width <= 780 ? 1 : 2);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

      const table = await page.locator('.table-scroll').boundingBox();
      expect(table).not.toBeNull();
      expect(table!.width).toBeLessThanOrEqual(viewport.width);

      const primaryAction = await page.getByRole('button', { name: 'Apply filters' }).boundingBox();
      expect(primaryAction).not.toBeNull();
      expect(primaryAction!.height).toBeGreaterThanOrEqual(44);
    });
  });
}
