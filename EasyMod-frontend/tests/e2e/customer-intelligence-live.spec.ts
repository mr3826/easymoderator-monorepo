import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Pilot intelligence browser journeys — LIVE tier (Component 3).
 *
 * Unlike customer-intelligence.spec.ts (mock route tier), this spec runs
 * against the real stack booted by scripts/run-pilot-e2e.js: disposable
 * postgres + redis, the real migration chain, fixtures from
 * EasyMod-backend/src/scripts/seed-pilot-e2e.js, the real backend on :3000,
 * and the vite dev server (playwright webServer) proxying /api to it.
 * Selectors/texts are reused from the mock tier wherever they match the
 * real DOM. It skips entirely unless the runner sets PILOT_E2E_LIVE=true,
 * so the mock-tier CI lane (no backend) is unaffected.
 */

test.skip(process.env.PILOT_E2E_LIVE !== 'true', 'live stack only: run scripts/run-pilot-e2e.js');
// The vite dev server needs a cold first compile; give journeys headroom.
test.setTimeout(120_000);

// The shared disposable database is mutated by these journeys (opportunity
// marked contacted, orders verified/approved), so tests run serially.
test.describe.configure({ mode: 'serial' });

interface PilotFixtures {
  password: string;
  shop: { id: string; name: string; uniqueCode: string };
  users: {
    owner: { id: string; email: string; role: string };
    staff: { id: string; email: string; role: string };
  };
  customers: {
    repeatBuyer: { id: string; name: string; phone: string; state: string };
    interested: { id: string; name: string; state: string };
    newcomer: { id: string; name: string; state: string };
    repeatReturner: { id: string; name: string; phone: string; state: string };
  };
  orders: {
    ready: { id: string; number: string };
    verify: { id: string; number: string };
    manualReview: { id: string; number: string };
  };
  opportunity: { id: string; status: string; conversation_id: string; productName: string };
  conversation: { id: string };
}

let fixtures: PilotFixtures;

function loadFixtures(): PilotFixtures {
  if (!fixtures) {
    // Playwright bundles specs as ESM; resolve the fixture beside this file.
    const fixturePath = fileURLToPath(new URL('.pilot-fixtures.json', import.meta.url));
    if (!fs.existsSync(fixturePath)) {
      throw new Error('Pilot E2E fixtures missing — run node scripts/run-pilot-e2e.js (which seeds first).');
    }
    fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as PilotFixtures;
  }
  return fixtures;
}

async function signInAndOpen(page: Page, email: string, targetPath: string) {
  const fx = loadFixtures();
  await page.addInitScript((shopId) => {
    window.localStorage.setItem(`easymod:business-setup:${shopId}:complete-dismissed`, '1');
    window.localStorage.setItem('easymod:business-setup:default:complete-dismissed', '1');
  }, fx.shop.id);
  await page.goto('/signin');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(fx.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(targetPath);
}

async function openOrder(page: Page, orderNumber: string) {
  const card = page.locator('article').filter({ hasText: `#${orderNumber}` });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'View Details' }).click();
  await expect(page.getByTestId('order-confidence-panel')).toBeVisible();
  return page.getByTestId('order-confidence-panel');
}

test.describe('Customer 360 and Sales Opportunities (live)', () => {
  test('journeys 1-3: customers list states, detail, search by phone, opportunities filter', async ({ page }) => {
    const fx = loadFixtures();
    await signInAndOpen(page, fx.users.owner.email, '/customers');

    // Journey 1: seeded customers with computed states.
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
    const repeatRow = page.getByTestId(`customer-row-${fx.customers.repeatBuyer.id}`);
    await expect(repeatRow).toContainText('Rahim Uddin');
    await expect(repeatRow).toContainText('Repeat buyer');
    await expect(repeatRow).toContainText('2 delivered of 3');
    const interestedRow = page.getByTestId(`customer-row-${fx.customers.interested.id}`);
    await expect(interestedRow).toContainText('Karim Hasan');
    await expect(interestedRow).toContainText('Interested');
    await expect(page.getByTestId(`customer-row-${fx.customers.newcomer.id}`)).toContainText('New');

    // Journey 2: customer detail — commerce metrics, timeline, order history.
    await repeatRow.click();
    await expect(page).toHaveURL(new RegExp(`/customers/${fx.customers.repeatBuyer.id}$`));
    await expect(page.getByTestId('customer-state')).toHaveText('Repeat buyer');
    await expect(page.getByTestId('commerce-summary')).toContainText('3,000');
    await expect(page.getByTestId('customer-orders')).toContainText('#ORD-101');
    await expect(page.getByTestId('customer-orders')).toContainText('Matched by phone');
    await expect(page.getByTestId('customer-timeline')).toContainText('Order #ORD-101 delivered');
    await expect(page.getByTestId('reply-window')).toContainText('Reply window open until');

    // Journey 3: search by phone, then the "opportunities" state filter tab.
    await page.goto('/customers');
    await page.getByLabel(/search by name or phone/i).fill('01711111111');
    await expect(page.getByTestId(`customer-row-${fx.customers.repeatBuyer.id}`)).toBeVisible();
    await expect(page.getByTestId(`customer-row-${fx.customers.interested.id}`)).toHaveCount(0);
    await page.getByLabel(/search by name or phone/i).clear();
    await page.getByTestId('customers-tab-opportunities').click();
    const interestedCard = page.getByTestId(`opportunity-${fx.opportunity.id}`);
    await expect(interestedCard).toBeVisible();
    await expect(interestedCard).toContainText('Karim Hasan');
  });

  test('journeys 4-5: open opportunity shows products + conversation link; mark contacted; open in inbox', async ({ page }) => {
    const fx = loadFixtures();
    await signInAndOpen(page, fx.users.owner.email, '/customers?tab=opportunities');

    // Journey 4: product references and the conversation link.
    const card = page.getByTestId(`opportunity-${fx.opportunity.id}`);
    await expect(card).toContainText('Karim Hasan');
    await expect(card).toContainText('Strong interest');
    await expect(card).toContainText('Said they want to order');
    await expect(card).toContainText('Asked about delivery charge');
    await expect(card).toContainText('Black Panjabi');
    await expect(card.getByRole('button', { name: /Open conversation/ })).toBeVisible();
    await expect(page.getByTestId('customers-tab-opportunities')).toContainText('1');

    // Journey 5: record the contact, then follow up in the inbox.
    await card.getByRole('button', { name: /Mark contacted/ }).click();
    await expect(card).toContainText('Contacted');
    await card.getByRole('button', { name: /Open conversation/ }).click();
    await expect(page).toHaveURL(new RegExp(`/inbox\\?conversation=${fx.conversation.id}`));
  });
});

test.describe('RTO Shield v2 / Order Confidence (live)', () => {
  test('journeys 6-8: confidence decisions per order, VERIFY hold blocks booking, mark verified clears it', async ({ page }) => {
    const fx = loadFixtures();
    // Any shop role may verify a VERIFY order; use the staff member here.
    await signInAndOpen(page, fx.users.staff.email, '/orders');

    // Journey 6: the three seeded orders resolve to READY / VERIFY /
    // MANUAL_REVIEW on the real rules engine (the Orders list itself has no
    // badge column; the confidence badge lives in the order detail panel).
    const readyPanel = await openOrder(page, 'ORD-300');
    await expect(readyPanel.getByTestId('order-confidence-decision')).toHaveText('Ready to ship');
    await page.getByRole('button', { name: /^close$/i }).last().click();

    const reviewPanel = await openOrder(page, 'ORD-302');
    await expect(reviewPanel.getByTestId('order-confidence-decision')).toHaveText('Needs owner review');
    await page.getByRole('button', { name: /^close$/i }).last().click();

    // Journey 7: VERIFY order shows the ADDRESS_TOO_SHORT hold reason and a
    // booking attempt is refused with the hold message (the gate runs before
    // any courier API, so nothing external is called).
    const verifyPanel = await openOrder(page, 'ORD-301');
    await expect(verifyPanel.getByTestId('order-confidence-decision')).toHaveText('Needs verification');
    await expect(verifyPanel).toContainText('Address looks incomplete (9 characters)');
    await page.getByRole('button', { name: 'Book Courier' }).first().click();
    // The courier modal (provider choices) — the order detail modal shares the
    // same overlay classes, so scope by the provider label.
    await page.locator('.fixed.inset-0').filter({ hasText: 'steadfast' })
      .getByRole('button', { name: 'Book Courier' }).click();
    await expect(page.getByText('This order needs checking before a courier can be booked.')).toBeVisible();

    // Journey 8: marking verified transitions to READY and unblocks booking
    // (asserted as the UI gate state — no real courier call is made).
    const panelAfterHold = page.getByTestId('order-confidence-panel');
    await expect(panelAfterHold.getByTestId('order-confidence-decision')).toHaveText('Needs verification');
    await panelAfterHold.getByTestId('order-confidence-submit').click();
    await expect(panelAfterHold.getByTestId('order-confidence-decision')).toHaveText('Cleared for booking');
    await expect(page.getByRole('button', { name: 'Book Courier' }).first()).toBeEnabled();
  });

  test('journeys 9-10: MANUAL_REVIEW needs the owner (staff see guidance); owner approval is audited and releases the hold', async ({ page }) => {
    const fx = loadFixtures();
    // Journey 9 (staff): guidance instead of an approve button.
    await signInAndOpen(page, fx.users.staff.email, '/orders');
    const staffPanel = await openOrder(page, 'ORD-302');
    await expect(staffPanel.getByTestId('order-confidence-decision')).toHaveText('Needs owner review');
    await expect(staffPanel).toContainText(/returned vs .* delivered before/);
    await expect(staffPanel.getByTestId('order-confidence-approve-help')).toBeVisible();
    await expect(staffPanel.getByTestId('order-confidence-submit')).toHaveCount(0);

    // Journey 10 (owner): approval requires a note, records an audit/history
    // entry, and releases the booking hold (decision cleared). Sign the staff
    // member out first — an authenticated user visiting /signin is redirected
    // straight to /dashboard by publicLoader.
    await page.evaluate(async () => {
      try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); } catch { /* best effort */ }
      window.localStorage.clear();
      window.sessionStorage.clear();
      // localStorage.clear() also drops the language hint; without it the
      // sign-in form renders in Bangla and the English labels below miss.
      window.localStorage.setItem('easymod_lang', 'en');
    });
    await page.context().clearCookies();
    await signInAndOpen(page, fx.users.owner.email, '/orders');
    const ownerPanel = await openOrder(page, 'ORD-302');
    const submit = ownerPanel.getByTestId('order-confidence-submit');
    await expect(submit).toBeDisabled();
    await ownerPanel.getByRole('textbox').fill('Called the customer, address confirmed');
    await submit.click();
    await expect(ownerPanel.getByTestId('order-confidence-decision')).toHaveText('Cleared for booking');
    await expect(ownerPanel).toContainText('Called the customer, address confirmed');
    await ownerPanel.getByRole('button', { name: /History/ }).click();
    await expect(ownerPanel).toContainText('Approved');
  });
});
