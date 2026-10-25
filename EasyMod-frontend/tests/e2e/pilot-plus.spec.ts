/**
 * Pilot+ V1 — merchant journeys (Playwright, mocked API per repo convention;
 * real-stack coverage lives in the backend integration + meta-e2e suites).
 *
 * Journeys: P+01 lead visible & actionable in Inbox; P+03 ranked queue +
 * handoff-conflict honesty; P+05 knowledge-gap authoring/publishing; mobile
 * 375px usability; axe-core a11y scan of the lead surfaces.
 */

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const mockUser = { id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd' };
const mockShop = { id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role: 'owner' };

const openOpportunity = {
    id: 'opp-1',
    shop_id: 'shop-1',
    customer_id: 'cust-1',
    conversation_id: 'conv-1',
    order_session_id: null,
    status: 'OPEN',
    strength: 'HIGH',
    reasons: ['PURCHASE_INTENT', 'CHECKOUT_STARTED'],
    signals: [],
    product_refs: [],
    first_signal_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    last_signal_at: new Date(Date.now() - 3600_000).toISOString(),
    detected_at: new Date().toISOString(),
    actioned_at: null,
    converted_order_id: null,
    resolved_at: null,
    resolution_reason: null,
    recommended_action: { code: 'REPLY_IN_INBOX' },
    customer: { id: 'cust-1', name: 'Rina Akter', channel_type: 'messenger' },
};

const conversation = (over: Record<string, unknown> = {}) => ({
    id: 'conv-1',
    channel: 'messenger',
    customer: { id: 'cust-1', name: 'Rina Akter', channel_user_id: 'psid-1' },
    lastMessage: 'order ta confirm korte chai',
    unreadCount: 1,
    status: 'active',
    needs_merchant_reply: true,
    needs_merchant_reply_reason: 'CUSTOMER_UNANSWERED',
    open_opportunity: openOpportunity,
    updated_at: new Date().toISOString(),
    ...over,
});

const actionItems = [
    {
        bucket: 1, item_key: 'hitl:conv-2', reason_code: 'HITL_REQUIRED',
        source: { type: 'conversation', id: 'conv-2' }, conversation_id: 'conv-2',
        customer_id: 'cust-2', status: 'awaiting_human', owner: 'user-2',
        next_action: { type: 'open_conversation' }, grounded_deadline: null,
        since: new Date(Date.now() - 40 * 60_000).toISOString(),
    },
    {
        bucket: 2, item_key: 'send:msg-9', reason_code: 'SEND_FAILED_AFTER_MUTATION',
        source: { type: 'message', id: 'msg-9' }, conversation_id: 'conv-1',
        customer_id: 'cust-1', status: 'needs_reconciliation', owner: null,
        next_action: { type: 'reconcile_send' }, grounded_deadline: null,
        since: new Date(Date.now() - 25 * 60_000).toISOString(),
    },
    {
        bucket: 3, item_key: 'session:sess-1', reason_code: 'CHECKOUT_WAITING_CUSTOMER',
        source: { type: 'order_session', id: 'sess-1' }, conversation_id: 'conv-1',
        customer_id: 'cust-1', status: 'suspended', owner: null,
        next_action: { type: 'resume_checkout', step: 'COLLECTING_ADDRESS' },
        grounded_deadline: new Date(Date.now() + 6 * 3600_000).toISOString(),
        since: new Date(Date.now() - 50 * 60_000).toISOString(),
    },
];

function setupRoutes(page: any, opts: { hitlConflict?: boolean } = {}) {
    let authenticated = false;
    let gaps = [
        {
            id: 'gap-pay-1', display_question: 'bkash advance dile pabo?', owner_domain: 'PAYMENT',
            status: 'OPEN', evidence_count: 6, first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(), resolved_faq_id: null, published_at: null,
            authoritative_action: 'open_payment_settings',
        },
        {
            id: 'gap-pol-1', display_question: 'exchange korte parbo?', owner_domain: 'POLICY',
            status: 'OPEN', evidence_count: 4, first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(), resolved_faq_id: null, published_at: null,
            authoritative_action: 'author_faq',
        },
    ];
    const captured = { contacted: 0, dismissed: 0, published: 0, actionsCalls: 0 };
    page._pilot = captured;

    page.route((url: URL) => url.pathname.startsWith('/api/'), async (route: any) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const method = route.request().method();
        const json = (status: number, body: unknown) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

        if (path === '/api/csrf') return json(200, { csrfToken: 'csrf-test' });
        if (path === '/api/auth/signin' && method === 'POST') {
            authenticated = true;
            return json(200, { success: true, data: { user: mockUser, currentShop: mockShop, allShops: [mockShop] } });
        }
        if (path === '/api/auth/me') {
            if (!authenticated) return json(401, { success: false });
            return json(200, { success: true, data: { user: mockUser, currentShop: mockShop, allShops: [mockShop] } });
        }
        if (path === '/api/subscription' && method === 'GET') {
            return json(200, { success: true, data: { subscription: { plan_code: 'GROWTH', plan_name: 'Growth', conversations_limit: -1, features: { image_understanding: true, advanced_ai: true } }, effective_conversation_limit: -1, usage: { conversations: { used: 0, limit: -1 } }, period: { start: new Date(Date.now() - 86400000).toISOString() } } });
        }
        if (path === '/api/conversation' && method === 'GET') {
            return json(200, {
                success: true,
                data: {
                    conversations: [
                        conversation(),
                        conversation({ id: 'conv-2', customer: { id: 'cust-2', name: 'Karim Uddin', channel_user_id: 'psid-2' }, open_opportunity: null, hitl: true, needs_merchant_reply_reason: 'HITL_REQUIRED', unreadCount: 0 }),
                        conversation({ id: 'conv-3', customer: { id: 'cust-3', name: 'Nasrin Sultana', channel_user_id: 'psid-3' }, open_opportunity: null, hitl: false, unreadCount: 0, needs_merchant_reply: false, needs_merchant_reply_reason: null }),
                    ],
                    ai_reply_mode: 'AUTO',
                    pagination: { total: 2, page: 1, pageSize: 50 },
                },
            });
        }
        if (path.match(/\/api\/conversation\/[\w-]+\/messages$/) && method === 'GET') {
            return json(200, {
                success: true,
                data: {
                    messages: [
                        { id: 'msg-1', conversation_id: 'conv-1', sender: 'customer', content: 'order ta confirm korte chai', created_at: new Date(Date.now() - 3600_000).toISOString() },
                        { id: 'msg-9', conversation_id: 'conv-1', sender: 'ai', content: 'Order #123 confirmed', delivery_state: 'FAILED', created_at: new Date(Date.now() - 25 * 60_000).toISOString() },
                    ],
                    suggestions: [],
                    pagination: { page: 1, totalPages: 1 },
                },
            });
        }
        if (path === '/api/inbox/actions' && method === 'GET') {
            captured.actionsCalls += 1;
            return json(200, { success: true, data: { items: actionItems, generated_at: new Date().toISOString(), partial: false } });
        }
        if (path.match(/\/api\/customer-intelligence\/opportunities\/[\w-]+\/contacted$/) && method === 'POST') {
            captured.contacted += 1;
            return json(200, { success: true, data: { status: 'ACTIONED', actioned_at: new Date().toISOString(), recommended_action: { code: 'WAIT_FOR_CUSTOMER_MESSAGE' } } });
        }
        if (path.match(/\/api\/customer-intelligence\/opportunities\/[\w-]+\/dismiss$/) && method === 'POST') {
            captured.dismissed += 1;
            return json(200, { success: true, data: { status: 'DISMISSED', resolution_reason: 'NOT_INTERESTED', resolved_at: new Date().toISOString() } });
        }
        if (path.match(/\/api\/conversation\/[\w-]+$/) && method === 'PATCH' && opts.hitlConflict) {
            const body = (() => { try { return route.request().postDataJSON(); } catch { return {}; } })();
            if (body && body.hitl === true) {
                return json(409, { success: false, error: { code: 'HUMAN_TAKEOVER_CONFLICT', message: 'This conversation is already assigned to another team member' } });
            }
        }
        if (path === '/api/knowledge/gap-suggestions' && method === 'GET') {
            return json(200, { success: true, data: gaps });
        }
        if (path.match(/\/api\/knowledge\/gap-suggestions\/[\w-]+\/dismiss$/) && method === 'POST') {
            const id = url.pathname.split('/')[4];
            gaps = gaps.filter((g) => g.id !== id);
            return json(200, { success: true, data: { status: 'DISMISSED' } });
        }
        if (path.match(/\/api\/knowledge\/gap-suggestions\/[\w-]+\/review$/) && method === 'POST') {
            return json(200, { success: true, data: { status: 'IN_REVIEW' } });
        }
        if (path.match(/\/api\/knowledge\/gap-suggestions\/[\w-]+\/publish$/) && method === 'POST') {
            const id = url.pathname.split('/')[4];
            captured.published += 1;
            gaps = gaps.filter((g) => g.id !== id);
            return json(201, { success: true, data: { faq_id: 91, status: 'PUBLISHED' } });
        }
        if (path === '/api/knowledge/faqs' && method === 'GET') {
            return json(200, { success: true, data: { faqs: [], total: 0 } });
        }
        return json(200, { success: true, data: [] });
    });
}

async function loginAndGo(page: any, path = '/inbox') {
    await page.addInitScript(() => { try { localStorage.setItem('easymod_lang', 'en'); } catch { /* ignore */ } });
    await page.goto('/signin');
    await page.fill('input[type="email"]', 'owner@shop.bd');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|inbox/);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
}

test.describe('P+01 inbox lead intelligence', () => {
    test('strength chip shows; strip explains reasons; contacted then dismiss clears it', async ({ page }) => {
        setupRoutes(page);
        await loginAndGo(page);

        await expect(page.getByTestId('lead-chip')).toBeVisible();

        await page.getByText('Rina Akter').first().click();
        const strip = page.getByTestId('inbox-lead-insight');
        await expect(strip).toBeVisible();

        await strip.getByRole('button', { name: /Mark contacted/i }).click();
        await expect.poll(() => (page as any)._pilot.contacted).toBe(1);
        await expect(strip).toBeVisible(); // ACTIONED is still a live opportunity

        await strip.getByRole('button', { name: /^Dismiss$/i }).first().click();
        await strip.getByRole('button', { name: /^Dismiss$/i }).last().click();
        await expect.poll(() => (page as any)._pilot.dismissed).toBe(1);
        await expect(strip).toBeHidden();
    });

    test('conversation without an opportunity shows no strip', async ({ page }) => {
        setupRoutes(page);
        await loginAndGo(page);
        await page.getByText('Karim Uddin').first().click();
        await expect(page.getByTestId('inbox-lead-insight')).toHaveCount(0);
    });
});

test.describe('P+03 merchant action queue', () => {
    test('ranked risk-ordered actions with grounded deadlines only where factual', async ({ page }) => {
        setupRoutes(page);
        await loginAndGo(page);

        const queue = page.getByTestId('action-queue');
        await expect(queue).toBeVisible();
        await expect.poll(() => (page as any)._pilot.actionsCalls).toBeGreaterThan(0);

        const items = queue.getByTestId('action-item');
        await expect(items).toHaveCount(3);
        await expect(items.nth(0).getByTestId('action-deadline')).toHaveCount(0);
        await expect(items.nth(2).getByTestId('action-deadline')).toBeVisible();
        await expect(items.nth(0)).toContainText(/assigned/i);
    });

    test('takeover conflict surfaces honestly, never as success', async ({ page }) => {
        setupRoutes(page, { hitlConflict: true });
        await loginAndGo(page);
        await page.getByText('Nasrin Sultana').first().click();
        await page.getByRole('button', { name: /take over/i }).first().click({ force: true });
        await expect(page.getByText(/already assigned|team member/i).first()).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('P+05 knowledge gap actions', () => {
    test('structured domain routes to settings; policy gap publishes through FAQ authority', async ({ page }) => {
        setupRoutes(page);
        await loginAndGo(page, '/manage-shop/faqs');

        await expect(page.getByTestId('gap-suggestion-gap-pay-1')).toBeVisible();
        const policyCard = page.getByTestId('gap-suggestion-gap-pol-1');
        await expect(policyCard).toBeVisible();
        await policyCard.getByRole('button', { name: /write answer|add answer|author/i }).click();
        const answerBox = page.locator('textarea').last();
        await answerBox.fill('7-day exchange on unused items with original packaging.');
        await policyCard.getByRole('button', { name: /publish|approve/i }).first().click();
        await expect.poll(() => (page as any)._pilot.published).toBe(1);
        await expect(policyCard).toBeHidden();
    });
});

test.describe('mobile + a11y', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('lead chip and queue fit 375px without horizontal overflow', async ({ page }) => {
        setupRoutes(page);
        await loginAndGo(page);
        await expect(page.getByTestId('lead-chip')).toBeVisible();
        await expect(page.getByTestId('action-queue')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(2);
    });

    test('Pilot+ lead surfaces have no critical/serious a11y violations', async ({ page }) => {
        setupRoutes(page);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await expect(page.getByTestId('inbox-lead-insight')).toBeVisible();
        // Scan the Pilot+ surfaces specifically. App-wide pre-existing issues
        // (e.g. the thread scroll container from ec382e31) are tracked
        // separately and not introduced by this feature set.
        const results = await new AxeBuilder({ page })
            .include('[data-testid="inbox-lead-insight"]')
            .include('[data-testid="action-queue"]')
            .include('[data-testid="lead-chip"]')
            .analyze();
        const blocking = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(blocking).toEqual([]);
    });
});
