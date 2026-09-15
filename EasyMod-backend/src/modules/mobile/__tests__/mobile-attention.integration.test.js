'use strict';

/**
 * ADR M-008, against REAL PostgreSQL (see tests/integration/env.js and
 * docker-compose.test.yml). Exercises the actual Express app and the actual
 * collectors' composition of existing services — not mocks.
 *
 * MOBILE_API_ENABLED is turned on for this file only, before `app` (and
 * therefore config.js) is first required in this file's own module
 * registry — see mobile-disabled.integration.test.js for the flag-off / 404
 * companion, which needs the opposite value and therefore lives in its own
 * file.
 */
process.env.MOBILE_API_ENABLED = 'true';

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
    User, Tenant, Shop, UserShop, Order, Product, Conversation, Message, Customer, CourierDispatch,
} = require('../../entities');
const RtoBlacklist = require('../../rto-shield/rto-blacklist.entity');
const { generateAccessToken } = require('../../../utils/jwt.util');
const { sequelize } = require('../../../utils/database/database-setup');

const app = require('../../../app');

async function makeUserWithShop(label, shopOverrides = {}) {
    const suffix = uuidv4();
    const tenant = await Tenant.create({ name: `Mobile Attention ${label} ${suffix}` });
    const shop = await Shop.create({
        unique_code: `MA-${suffix}`.slice(0, 20),
        tenant_id: tenant.id,
        shop_name: `Mobile Attention Shop ${label}`,
        name: `Mobile Attention Shop ${label}`,
        ...shopOverrides,
    });
    const user = await User.create({
        email: `mobile-attn-${label}-${suffix}@example.test`,
        password: 'unused-test-hash',
        full_name: `Mobile Attention ${label}`,
        settings: {},
    });
    await UserShop.create({ user_id: user.id, shop_id: shop.id, role: 'owner', is_active: true });
    return { user, shop, tenant };
}

const tokenFor = (user, shopId) => generateAccessToken({
    userId: user.id,
    email: user.email,
    shopId,
    tokenVersion: user.token_version,
    mfaVerified: false,
});

/** Backdate a row's created_at via raw SQL — Order/Product have no explicit
 * createdAt-attribute override, so setting the attribute through Sequelize's
 * update() would go through the `createdAt` accessor, not the column name;
 * raw SQL sidesteps that entirely and is unambiguous either way. */
async function backdate(table, id, hoursAgo) {
    const ts = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    await sequelize.query(`UPDATE ${table} SET created_at = :ts WHERE id = :id`, {
        replacements: { ts, id },
    });
    return ts;
}

describe('mobile attention/today (ADR M-008) on PostgreSQL and Redis', () => {
    const userIds = [];
    const shopIds = [];
    const tenantIds = [];
    const conversationIds = [];

    const track = ({ user, shop, tenant }) => {
        userIds.push(user.id);
        shopIds.push(shop.id);
        tenantIds.push(tenant.id);
    };

    afterAll(async () => {
        await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } } });
        await Conversation.destroy({ where: { shop_id: { [Op.in]: shopIds } } });
        await Customer.destroy({ where: { shop_id: { [Op.in]: shopIds } } });
        await CourierDispatch.destroy({ where: { shop_id: { [Op.in]: shopIds } } });
        await Order.destroy({ where: { shop_id: { [Op.in]: shopIds } } });
        await Product.destroy({ where: { shop_id: { [Op.in]: shopIds } }, force: true });
        await RtoBlacklist.destroy({ where: { shop_id: { [Op.in]: shopIds } } });
        await UserShop.destroy({ where: { user_id: { [Op.in]: userIds } } });
        await User.destroy({ where: { id: { [Op.in]: userIds } } });
        await Shop.destroy({ where: { id: { [Op.in]: shopIds } } });
        await Tenant.destroy({ where: { id: { [Op.in]: tenantIds } } });
        // Do not close shared Sequelize/Redis clients — other real-stack
        // suites may still run in this worker process.
    });

    test('GET /api/mobile/attention ranks one correctly-scored item per tier (spec §2.1) and hides an untracked low-stock product (D1)', async () => {
        const fixture = await makeUserWithShop('ranking');
        track(fixture);
        const { user, shop } = fixture;

        // Tier 1a: a FAILED courier dispatch, 5 hours old.
        const order1 = await Order.create({
            shop_id: shop.id, order_number: 'MA-ORDER-1', order_status: 'confirmed',
            total: 100, customer_name: 'Courier Failed Customer',
        });
        const dispatch1 = await CourierDispatch.create({
            shop_id: shop.id, order_id: order1.id, provider: 'pathao',
            idempotency_key: `idem-${uuidv4()}`, status: 'FAILED',
        });
        await backdate('courier_dispatch', dispatch1.id, 5);

        // Tier 1b: courier setup incomplete (no DeliveryIntegration exists for
        // this shop at all) blocking a ready-to-ship order — the OLDEST
        // blocked order (20h old) should be the one referenced.
        const order2 = await Order.create({
            shop_id: shop.id, order_number: 'MA-ORDER-2', order_status: 'confirmed',
            total: 200, customer_name: 'Courier Setup Customer',
        });
        await backdate('orders', order2.id, 20);

        // Tier 2: an unanswered customer message, 3 hours old.
        const customer = await Customer.create({
            shop_id: shop.id, channel_type: 'messenger', channel_user_id: `cust-${uuidv4()}`,
            name: 'Inbox Customer',
        });
        const conversation = await Conversation.create({
            shop_id: shop.id, customer_id: customer.id, channel: 'messenger',
            role: 'user', message: 'Is this still available?', status: 'active', hitl: false,
        });
        conversationIds.push(conversation.id);
        const message = await Message.create({
            conversation_id: conversation.id, sender: 'customer', content: 'Is this still available?',
        });
        await backdate('messages', message.id, 3);

        // Tier 3: a draft order, 10 hours old — score = total x hours = 5000.
        const order3 = await Order.create({
            shop_id: shop.id, order_number: 'MA-ORDER-3', order_status: 'draft',
            total: 500, customer_name: 'Draft Customer',
        });
        await backdate('orders', order3.id, 10);

        // Tier 4: an RTO-VERIFY-tier customer on a pending (confirmed, not
        // yet delivered) order, 2 hours old.
        const rtoPhone = '01711111111';
        await RtoBlacklist.create({
            id: uuidv4(), phone: rtoPhone, reason: 'test seed', risk_score: 60,
            is_global: false, shop_id: shop.id,
        });
        const order4 = await Order.create({
            shop_id: shop.id, order_number: 'MA-ORDER-4', order_status: 'confirmed',
            total: 150, customer_phone: rtoPhone, customer_name: 'RTO Customer',
        });
        await backdate('orders', order4.id, 2);

        // Tier 5: one tracked, active, below-threshold product (D1: qualifies)...
        const lowStockProduct = await Product.create({
            shop_id: shop.id, name: 'Low Stock Widget', price: 10,
            quantity: 2, low_stock_threshold: 10, track_quantity: true, is_active: true,
        });
        // ...and one UNTRACKED product at quantity 0, which D1 must exclude
        // (untracked products default to quantity 0 and would otherwise
        // always look "low stock").
        await Product.create({
            shop_id: shop.id, name: 'Untracked Product', price: 20,
            quantity: 0, low_stock_threshold: 5, track_quantity: false, is_active: true,
        });

        const token = tokenFor(user, shop.id);
        const res = await request(app)
            .get('/api/mobile/attention')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const { items, truncated_count: truncatedCount, conversation_scan_truncated: scanTruncated, generated_at: generatedAt } = res.body.data;

        expect(Array.isArray(items)).toBe(true);
        expect(truncatedCount).toBe(0);
        expect(scanTruncated).toBe(false);
        expect(new Date(generatedAt).toString()).not.toBe('Invalid Date');

        const byType = (type) => items.find((item) => item.signal_type === type);

        const courierFailed = byType('COURIER_FAILED');
        expect(courierFailed).toBeTruthy();
        expect(courierFailed.tier).toBe(1);
        expect(courierFailed.entity).toEqual({ type: 'order', id: order1.id });
        expect(courierFailed.urgency_score).toBeGreaterThan(4.9);
        expect(courierFailed.urgency_score).toBeLessThan(5.5);

        const courierSetup = byType('COURIER_SETUP_REQUIRED');
        expect(courierSetup).toBeTruthy();
        expect(courierSetup.tier).toBe(1);
        // order2 is the oldest ready-to-ship order still lacking a COMMITTED
        // dispatch, so it — not order1 or order4 — is the referenced entity.
        expect(courierSetup.entity).toEqual({ type: 'order', id: order2.id });
        expect(courierSetup.reason).toContain('MA-ORDER-2');
        expect(courierSetup.urgency_score).toBeGreaterThan(19.9);
        expect(courierSetup.urgency_score).toBeLessThan(20.5);

        const needsReply = byType('INBOX_NEEDS_REPLY');
        expect(needsReply).toBeTruthy();
        expect(needsReply.tier).toBe(2);
        expect(needsReply.entity).toEqual({ type: 'conversation', id: conversation.id });
        expect(needsReply.urgency_score).toBeGreaterThan(2.9);
        expect(needsReply.urgency_score).toBeLessThan(3.5);

        const draftOrder = byType('DRAFT_ORDER');
        expect(draftOrder).toBeTruthy();
        expect(draftOrder.tier).toBe(3);
        expect(draftOrder.entity).toEqual({ type: 'order', id: order3.id });
        // total(500) x hours(~10) = ~5000; allow generous drift for test runtime.
        expect(draftOrder.urgency_score).toBeGreaterThan(4900);
        expect(draftOrder.urgency_score).toBeLessThan(5100);

        const rtoVerify = byType('RTO_VERIFY');
        expect(rtoVerify).toBeTruthy();
        expect(rtoVerify.tier).toBe(4);
        expect(rtoVerify.entity).toEqual({ type: 'order', id: order4.id });
        expect(rtoVerify.urgency_score).toBeGreaterThan(1.9);
        expect(rtoVerify.urgency_score).toBeLessThan(2.5);

        const lowStock = byType('LOW_STOCK');
        expect(lowStock).toBeTruthy();
        expect(lowStock.tier).toBe(5);
        expect(lowStock.entity).toEqual({ type: 'product', id: lowStockProduct.id });
        expect(lowStock.urgency_score).toBeCloseTo(0.8, 5); // 1 - (2/10)

        // D1: the untracked product never appears as a low-stock signal.
        const productItems = items.filter((item) => item.entity.type === 'product');
        expect(productItems).toHaveLength(1);

        // Whole-list ordering: tier ascending is a hard invariant.
        for (let i = 1; i < items.length; i += 1) {
            expect(items[i].tier).toBeGreaterThanOrEqual(items[i - 1].tier);
        }
        // Within tier 1, higher urgency_score (courierSetup, ~20h) ranks
        // above lower urgency_score (courierFailed, ~5h).
        expect(items.indexOf(courierSetup)).toBeLessThan(items.indexOf(courierFailed));
    }, 30000);

    test('GET /api/mobile/today aggregates order count/revenue (excluding drafts, D3), delivered count, and pending-action counts for the Dhaka window (D4)', async () => {
        const fixture = await makeUserWithShop('today');
        track(fixture);
        const { user, shop } = fixture;

        // A real (non-draft) order created "now" — counts toward order_count/revenue.
        const confirmedOrder = await Order.create({
            shop_id: shop.id, order_number: 'MA-TODAY-1', order_status: 'confirmed', total: 300,
        });
        // A draft order — must be excluded from order_count/revenue (D3), but
        // still shows up as a DRAFT_ORDER pending action.
        await Order.create({
            shop_id: shop.id, order_number: 'MA-TODAY-2', order_status: 'draft', total: 999,
        });
        // A delivered-today order — counts toward delivered_count AND (since
        // it is also created "now" and non-draft) order_count/revenue.
        const deliveredOrder = await Order.create({
            shop_id: shop.id, order_number: 'MA-TODAY-3', order_status: 'confirmed', total: 250,
            delivered_at: new Date(),
        });
        // A low-stock product for the pending_actions count.
        await Product.create({
            shop_id: shop.id, name: 'Today Low Stock Item', price: 5,
            quantity: 1, low_stock_threshold: 5, track_quantity: true, is_active: true,
        });

        const token = tokenFor(user, shop.id);
        const res = await request(app)
            .get('/api/mobile/today')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const data = res.body.data;

        expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(data.timezone_used).toBe('Asia/Dhaka');
        expect(data.timezone_note).toBeNull();
        expect(data.order_count).toBe(2); // confirmedOrder + deliveredOrder, draft excluded
        expect(data.revenue).toBeCloseTo(300 + 250, 5);
        expect(data.delivered_count).toBe(1);
        expect(data.pending_actions.draft_orders).toBe(1);
        expect(data.pending_actions.low_stock).toBe(1);
        expect(data.pending_actions.needs_reply).toBe(0);
        expect(data.pending_actions.rto_verify).toBe(0);
        // Shop has zero DeliveryIntegration rows and two ready-to-ship
        // orders (confirmedOrder, deliveredOrder) with no COMMITTED
        // dispatch, so exactly one COURIER_SETUP_REQUIRED pending action.
        expect(data.pending_actions.courier_problems).toBe(1);

        expect(confirmedOrder.id).toBeTruthy();
        expect(deliveredOrder.id).toBeTruthy();
    }, 30000);

    test('GET /api/mobile/today falls back to UTC day boundaries for a non-Dhaka shop timezone and says so explicitly (D4)', async () => {
        const fixture = await makeUserWithShop('tz-fallback', { timezone: 'America/New_York' });
        track(fixture);
        const { user, shop } = fixture;

        const token = tokenFor(user, shop.id);
        const res = await request(app)
            .get('/api/mobile/today')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.timezone_used).toBe('UTC');
        expect(res.body.data.timezone_note).toMatch(/America\/New_York/);
        expect(res.body.data.timezone_note).toMatch(/UTC/);
    }, 30000);

    test('a user with no membership on the requested shop is refused with 403 on both routes (IDOR / cross-tenant denial)', async () => {
        const owner = await makeUserWithShop('idor-owner');
        const outsider = await makeUserWithShop('idor-outsider');
        track(owner);
        track(outsider);

        // outsider's token claims owner's shop — but has no UserShop row there.
        const forgedToken = tokenFor(outsider.user, owner.shop.id);

        const attentionRes = await request(app)
            .get('/api/mobile/attention')
            .set('Authorization', `Bearer ${forgedToken}`);
        expect(attentionRes.status).toBe(403);

        const todayRes = await request(app)
            .get('/api/mobile/today')
            .set('Authorization', `Bearer ${forgedToken}`);
        expect(todayRes.status).toBe(403);
    }, 30000);

    test('D6: when the conversation scan hits its 200-row bound, the response says so via conversation_scan_truncated', async () => {
        const fixture = await makeUserWithShop('scan-bound');
        track(fixture);
        const { user, shop } = fixture;

        // 201 closed conversations — none of them are candidates for
        // needs-reply (closed is never "open"), but their sheer count pushes
        // the shop's total conversation count past the 200-row scan bound.
        const filler = Array.from({ length: 201 }, () => ({
            id: uuidv4(),
            shop_id: shop.id,
            channel: 'messenger',
            role: 'user',
            message: 'filler',
            status: 'closed',
        }));
        const createdFiller = await Conversation.bulkCreate(filler);
        createdFiller.forEach((c) => conversationIds.push(c.id));

        const token = tokenFor(user, shop.id);
        const res = await request(app)
            .get('/api/mobile/attention')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.data.conversation_scan_truncated).toBe(true);
    }, 30000);
});
