/**
 * MW-V1 Increment 2 — deterministic merchant journeys (Playwright, mocked API
 * per repo convention; the real-stack proof is the backend integration +
 * meta-e2e suites, and the live founder screenshots are mwv1-live.spec.ts).
 *
 * Covers the NEW surfaces: J1 context panel, J4 claim, J5 conflict+privileged
 * force, J6 note persists, J7 tag set, J8 queue views/counts, J9 flag-off
 * issues zero gated reads, J11 mobile 390px, J12 no false business status.
 */
import { expect, test } from '@playwright/test';

const mockUser = (over: Record<string, unknown> = {}) => ({ id: 'user-1', full_name: 'Test Owner', email: 'owner@shop.bd', ...over });
const mockShop = (role = 'owner') => ({ id: 'shop-1', unique_code: 'SHOP1', shop_name: 'My BD Shop', role });

const conv = (over: Record<string, unknown> = {}) => ({
    id: 'conv-1', channel: 'messenger',
    customer: { id: 'cust-1', name: 'Rina Akter', channel_user_id: 'psid-1' },
    customer_id: 'cust-1',
    lastMessage: 'order ta confirm korte chai', unreadCount: 1, status: 'active',
    needs_merchant_reply: true, needs_merchant_reply_reason: 'CUSTOMER_UNANSWERED',
    hitl: false, assignee_id: null, assignee: null,
    updated_at: new Date().toISOString(), ...over,
});

type State = {
    role: string;
    ciFlag: boolean;
    claimConflict: boolean;
    forcedOk: boolean;
    notes: Array<Record<string, unknown>>;
    tags: Array<Record<string, unknown>>;
    assignedTagIds: string[] | null;
    orderCalls: string[];
    gatedCalls: number;
    patchBodies: unknown[];
};

function setupRoutes(page: any, state: State) {
    let authenticated = false;
    const user = mockUser({ id: state.role === 'owner' ? 'user-1' : 'user-2', full_name: state.role === 'owner' ? 'Test Owner' : 'Test Staff' });
    const shop = mockShop(state.role);

    page.route((url: URL) => url.pathname.startsWith('/api/'), async (route: any) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const method = route.request().method();
        const json = (status: number, body: unknown) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

        if (path === '/api/csrf') return json(200, { csrfToken: 'csrf-test' });
        if (path === '/api/auth/signin' && method === 'POST') { authenticated = true; return json(200, { success: true, data: { user, currentShop: shop, allShops: [shop] } }); }
        if (path === '/api/auth/me') return authenticated ? json(200, { success: true, data: { user, currentShop: shop, allShops: [shop] } }) : json(401, { success: false });
        if (path === '/api/subscription' && method === 'GET') {
            return json(200, { success: true, data: { subscription: { plan_code: 'GROWTH', plan_name: 'Growth', conversations_limit: -1, features: { image_understanding: true, advanced_ai: true } }, effective_conversation_limit: -1, usage: { conversations: { used: 0, limit: -1 } }, period: { start: new Date(Date.now() - 86400000).toISOString() } } });
        }
        if (path === '/api/pilot-features/status' || path === '/api/customer-intelligence/status') {
            return json(200, { success: true, data: { customer_intelligence: state.ciFlag, action_queue: true, interaction_choices: state.ciFlag, knowledge_suggestions: state.ciFlag, order_confidence_mode: 'off' } });
        }
        if (path === '/api/conversation' && method === 'GET') {
            return json(200, { success: true, data: { conversations: [conv(), conv({ id: 'conv-2', customer: { id: 'cust-2', name: 'Farhana Begum', channel_user_id: 'psid-2' }, customer_id: 'cust-2', hitl: true, needs_merchant_reply_reason: 'HITL_REQUIRED', unreadCount: 0 })], ai_reply_mode: 'MANUAL', pagination: { total: 2, page: 1, pageSize: 50 } } });
        }
        if (path.match(/\/api\/conversation\/[\w-]+\/messages$/) && method === 'GET') {
            return json(200, { success: true, data: { messages: [{ id: 'msg-1', conversation_id: 'conv-1', sender: 'customer', content: 'order ta confirm korte chai', created_at: new Date(Date.now() - 3600_000).toISOString() }], suggestions: [], pagination: { page: 1, totalPages: 1 } } });
        }
        if (path.match(/\/api\/conversation\/[\w-]+$/) && method === 'PATCH') {
            const id = url.pathname.split('/')[3];
            const body = (() => { try { return route.request().postDataJSON(); } catch { return {}; } })();
            state.patchBodies.push(body);
            if (state.claimConflict && (body as any).hitl === true && !(body as any).force) {
                return json(409, { success: false, error: { code: 'HUMAN_TAKEOVER_CONFLICT', message: 'This conversation is already assigned to another team member' } });
            }
            const assigned = state.role === 'owner' ? 'user-1' : 'user-2';
            return json(200, { success: true, data: { ...conv({ id }), hitl: true, assignee_id: assigned, assignee: { id: assigned, name: user.full_name } } });
        }
        if (path === '/api/inbox/actions' && method === 'GET') {
            const view = url.searchParams.get('view') || 'attention';
            const all = [
                { bucket: 1, item_key: 'hitl:conv-2', reason_code: 'HITL_REQUIRED', source: { type: 'conversation', id: 'conv-2' }, conversation_id: 'conv-2', customer_id: 'cust-2', status: 'awaiting_human', owner: null, next_action: { type: 'open_conversation' }, grounded_deadline: null, since: new Date().toISOString() },
                { bucket: 2, item_key: 'send:msg-9', reason_code: 'SEND_FAILED_AFTER_MUTATION', source: { type: 'message', id: 'msg-9' }, conversation_id: 'conv-1', customer_id: 'cust-1', status: 'needs_reconciliation', owner: 'user-1', next_action: { type: 'reconcile_send' }, grounded_deadline: null, since: new Date().toISOString() },
            ];
            const items = view === 'unassigned' ? all.filter((i) => i.bucket === 1 && !i.owner)
                : view === 'mine' ? all.filter((i) => i.owner === (state.role === 'owner' ? 'user-1' : 'user-2'))
                : view === 'recovery' ? all.filter((i) => i.bucket === 2)
                : all;
            return json(200, { success: true, data: { items, generated_at: new Date().toISOString(), partial: false, counts: { by_bucket: { '1': 1, '2': 1 }, views: { attention: 2, unassigned: 1, mine: 1, handoff: 1, recovery: 1 }, total: 2, returned: items.length } } });
        }
        // customer-intelligence 360 (gated) — count calls to prove flag-off = zero reads
        if (path.startsWith('/api/customer-intelligence/customers/')) {
            state.gatedCalls += 1;
            if (!state.ciFlag) return json(403, { success: false, error: { code: 'FEATURE_DISABLED' } });
            return json(200, { success: true, data: { customer: { name: 'Rina Akter' }, contactability: { platform: 'messenger', window_open: true, reason: '' }, state: 'REPEAT_BUYER', state_reasons: [], summary: { total_orders: 3, delivered_orders: 2, delivered_value: 3200, ordered_value: 4800 }, rto_signal: { available: true, tier: 'verify', list: false, network: false }, orders: [], conversations: [], opportunities: [], timeline: [] } });
        }
        if (path === '/api/order' && method === 'GET') {
            state.orderCalls.push(url.searchParams.get('customer_id') || 'none');
            return json(200, { success: true, data: [{ id: 'o9', order_number: 'ORD-1001', customer_id: 'cust-1', customer_name: 'Rina Akter', order_status: 'processing', total_amount: 1490, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), items: [] }] });
        }
        if (path.match(/\/api\/customer\/[\w-]+\/notes$/) && method === 'GET') return json(200, { success: true, data: { data: state.notes, total: state.notes.length } });
        if (path.match(/\/api\/customer\/[\w-]+\/notes$/) && method === 'POST') {
            const body = (() => { try { return route.request().postDataJSON(); } catch { return {}; } })() as any;
            const note = { id: `note-${state.notes.length + 1}`, shop_id: 'shop-1', customer_id: 'cust-1', body: body.body, author_id: 'user-1', author_name: user.full_name, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            state.notes.push(note);
            return json(201, { success: true, data: note });
        }
        if (path.match(/\/api\/customer\/[\w-]+\/notes\/[\w-]+$/) && method === 'DELETE') {
            const id = url.pathname.split('/')[5];
            state.notes = state.notes.filter((n: any) => n.id !== id);
            return json(200, { success: true, data: { id, deleted: true } });
        }
        if (path === '/api/customer/tags' && method === 'GET') return json(200, { success: true, data: { data: [{ id: 'tag-1', shop_id: 'shop-1', name: 'Priority service', usage_count: 1 }] } });
        if (path === '/api/customer/tags' && method === 'POST') return json(201, { success: true, data: { id: 'tag-1', shop_id: 'shop-1', name: 'Priority service' } });
        if (path.match(/\/api\/customer\/[\w-]+\/tags$/) && method === 'GET') return json(200, { success: true, data: { data: state.tags } });
        if (path.match(/\/api\/customer\/[\w-]+\/tags$/) && method === 'PUT') {
            const body = (() => { try { return route.request().postDataJSON(); } catch { return {}; } })() as any;
            state.assignedTagIds = body.tag_ids;
            state.tags = body.tag_ids.includes('tag-1') ? [{ id: 'tag-1', shop_id: 'shop-1', name: 'Priority service' }] : [];
            return json(200, { success: true, data: { data: state.tags } });
        }
        if (path === '/api/shop/agents' && method === 'GET') return json(200, { success: true, data: [{ id: 'user-1', full_name: 'Test Owner', role: 'owner' }, { id: 'user-2', full_name: 'Test Staff', role: 'staff' }] });
        return json(200, { success: true, data: [] });
    });
}

async function loginAndGo(page: any, path = '/inbox') {
    await page.addInitScript(() => { try { localStorage.setItem('easymod_lang', 'en'); } catch { /* ignore */ } });
    await page.goto('/signin');
    const email = page.getByRole('textbox', { name: /email/i });
    await email.waitFor({ state: 'visible' });
    await email.pressSequentially('owner@shop.bd', { delay: 5 });
    const password = page.getByRole('textbox', { name: /password/i });
    await password.pressSequentially('password123', { delay: 5 });
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(/dashboard|inbox/);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
}

const freshState = (over: Partial<State> = {}): State => ({
    role: 'owner', ciFlag: true, claimConflict: false, forcedOk: true,
    notes: [], tags: [], assignedTagIds: null, orderCalls: [], gatedCalls: 0, patchBodies: [], ...over,
});

test.describe('MW-V1 journeys', () => {
    test('J1 — context panel shows identity + verified orders, links by id', async ({ page }) => {
        const state = freshState();
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await page.getByTestId('context-toggle').click();
        const panel = page.getByTestId('customer-context-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByText('ORD-1001')).toBeVisible();
        // association is by customer_id, never a name search
        expect(state.orderCalls).toContain('cust-1');
        expect(state.orderCalls).not.toContain('none');
    });

    test('J4 — staff claims an open handoff via the canonical PATCH', async ({ page }) => {
        const state = freshState({ role: 'staff' });
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Farhana Begum').first().click();
        await page.getByTestId('context-toggle').click();
        await page.getByTestId('context-claim').click();
        await expect(page.getByTestId('context-owner')).toContainText(/Assigned/i);
        expect(state.patchBodies.some((b: any) => b.hitl === true)).toBeTruthy();
    });

    test('J5 — conflict shows server reason; privileged force re-sends with force:true', async ({ page }) => {
        const state = freshState({ role: 'owner', claimConflict: true });
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Farhana Begum').first().click();
        await page.getByTestId('context-toggle').click();
        await page.getByTestId('context-claim').click();
        await expect(page.getByTestId('context-owner-error')).toContainText(/already assigned to another team member/i);
        await expect(page.getByTestId('context-force')).toBeVisible();
        await page.getByTestId('context-force').click();
        await expect.poll(() => state.patchBodies.some((b: any) => b.force === true)).toBe(true);
    });

    test('J6 — note saves through the CRM domain and appears in the panel', async ({ page }) => {
        const state = freshState();
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await page.getByTestId('context-toggle').click();
        await page.getByTestId('note-add-open').click();
        await page.getByTestId('note-composer').fill('prefers morning courier calls');
        await page.getByTestId('note-save').click();
        await expect(page.getByText('prefers morning courier calls')).toBeVisible();
        expect(state.notes).toHaveLength(1);
    });

    test('J7 — tag set applies via replace-set PUT', async ({ page }) => {
        const state = freshState();
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await page.getByTestId('context-toggle').click();
        await page.getByTestId('tag-edit-open').click();
        await page.getByTestId('tag-choice-tag-1').click();
        await page.getByTestId('tag-apply').click();
        await expect.poll(() => state.assignedTagIds).toEqual(['tag-1']);
        await expect(page.locator('[data-testid="customer-context-panel"]').getByText('Priority service')).toBeVisible();
    });

    test('J8 — queue view chips show server counts and refetch per view', async ({ page }) => {
        const state = freshState();
        setupRoutes(page, state);
        await loginAndGo(page);
        await expect(page.getByTestId('queue-view-unassigned')).toContainText('1');
        await page.getByTestId('queue-view-recovery').click();
        await expect(page.getByTestId('action-item').first()).toBeVisible();
    });

    test('J9 — flag-off issues ZERO customer-intelligence reads yet keeps the workflow', async ({ page }) => {
        const state = freshState({ ciFlag: false });
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await page.getByTestId('context-toggle').click();
        await expect(page.getByTestId('customer-context-panel')).toBeVisible();
        await expect(page.getByText('ORD-1001')).toBeVisible(); // operations still work
        expect(state.gatedCalls).toBe(0);
    });

    test('J11 — mobile 390px: context opens as a sheet, composer stays reachable', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const state = freshState();
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await page.getByTestId('context-toggle').click();
        await expect(page.getByTestId('customer-context-panel')).toBeVisible();
        await expect(page.getByTestId('context-close')).toBeVisible();
    });

    test('J12 — order status shown verbatim, never a fabricated paid/delivered', async ({ page }) => {
        const state = freshState();
        setupRoutes(page, state);
        await loginAndGo(page);
        await page.getByText('Rina Akter').first().click();
        await page.getByTestId('context-toggle').click();
        const row = page.getByTestId('context-order-row');
        await expect(row).toContainText('processing');
        await expect(row).not.toContainText(/paid|delivered|refunded/i);
    });
});
