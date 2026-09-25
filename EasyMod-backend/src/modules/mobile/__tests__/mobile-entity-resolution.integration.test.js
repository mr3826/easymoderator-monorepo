'use strict';

/**
 * Lane C: real shop-scoped entity resolution against the disposable PostgreSQL/Redis stack.
 *
 * The mobile resolver deliberately reuses the existing order and conversation detail routes. This
 * suite proves those routes remain the authorization boundary instead of testing a client-side
 * shop check or a mocked model.
 */
process.env.MOBILE_API_ENABLED = 'true';

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const {
    User, Tenant, Shop, UserShop, Order, Conversation,
} = require('../../entities');
const { generateAccessToken } = require('../../../utils/jwt.util');
const app = require('../../../app');

async function makeShopFixture(label) {
    const suffix = uuidv4();
    const tenant = await Tenant.create({ name: `Mobile Entity ${label} Tenant ${suffix}` });
    const shop = await Shop.create({
        unique_code: `ME-${suffix}`.slice(0, 20),
        tenant_id: tenant.id,
        shop_name: `Mobile Entity Shop ${label}`,
        name: `Mobile Entity Shop ${label}`,
    });
    const user = await User.create({
        email: `mobile-entity-${label}-${suffix}@example.test`,
        password: 'integration-only',
        full_name: `Mobile Entity Merchant ${label}`,
        settings: {},
    });
    await UserShop.create({ user_id: user.id, shop_id: shop.id, role: 'owner', is_active: true });
    return { tenant, shop, user };
}

const tokenFor = (user, shopId) => generateAccessToken({
    userId: user.id,
    email: user.email,
    shopId,
    tokenVersion: user.token_version,
    mfaVerified: false,
});

describe('mobile deep-link entity resolution on real PostgreSQL and Redis', () => {
    let shopA;
    let shopB;
    const orderIds = [];
    const conversationIds = [];

    beforeAll(async () => {
        shopA = await makeShopFixture('A');
        shopB = await makeShopFixture('B');
    });

    afterAll(async () => {
        if (conversationIds.length > 0) {
            await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } } });
        }
        if (orderIds.length > 0) {
            await Order.destroy({ where: { id: { [Op.in]: orderIds } } });
        }
        const userIds = [shopA?.user.id, shopB?.user.id].filter(Boolean);
        const shopIds = [shopA?.shop.id, shopB?.shop.id].filter(Boolean);
        const tenantIds = [shopA?.tenant.id, shopB?.tenant.id].filter(Boolean);
        if (userIds.length > 0) await UserShop.destroy({ where: { user_id: { [Op.in]: userIds } } });
        if (userIds.length > 0) await User.destroy({ where: { id: { [Op.in]: userIds } } });
        if (shopIds.length > 0) await Shop.destroy({ where: { id: { [Op.in]: shopIds } } });
        if (tenantIds.length > 0) await Tenant.destroy({ where: { id: { [Op.in]: tenantIds } } });
    });

    test('allows own order/conversation resolution and denies manipulated cross-shop IDs', async () => {
        const orderA = await Order.create({
            shop_id: shopA.shop.id,
            order_number: `ME-A-${uuidv4()}`,
            order_status: 'confirmed',
            total: 125,
            customer_name: 'Shop A customer',
        });
        const orderB = await Order.create({
            shop_id: shopB.shop.id,
            order_number: `ME-B-${uuidv4()}`,
            order_status: 'confirmed',
            total: 225,
            customer_name: 'Shop B customer',
        });
        orderIds.push(orderA.id, orderB.id);

        const conversationA = await Conversation.create({
            shop_id: shopA.shop.id,
            channel: 'messenger',
            role: 'user',
            message: 'Shop A message',
            status: 'active',
        });
        const conversationB = await Conversation.create({
            shop_id: shopB.shop.id,
            channel: 'messenger',
            role: 'user',
            message: 'Shop B message',
            status: 'active',
        });
        conversationIds.push(conversationA.id, conversationB.id);

        const tokenA = tokenFor(shopA.user, shopA.shop.id);
        const ownOrder = await request(app)
            .get(`/api/order/${orderA.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        const ownConversation = await request(app)
            .get(`/api/conversation/${conversationA.id}`)
            .set('Authorization', `Bearer ${tokenA}`);

        expect(ownOrder.status).toBe(200);
        expect(ownOrder.body.data.id).toBe(orderA.id);
        expect(ownConversation.status).toBe(200);
        expect(ownConversation.body.data.id).toBe(conversationA.id);

        // The only changed input is the entity id from a different shop. The server's scoped
        // lookup must collapse this to the same not-found result as a missing id.
        const crossShopOrder = await request(app)
            .get(`/api/order/${orderB.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        const crossShopConversation = await request(app)
            .get(`/api/conversation/${conversationB.id}`)
            .set('Authorization', `Bearer ${tokenA}`);

        expect(crossShopOrder.status).toBe(404);
        expect(crossShopOrder.body.data).toBeUndefined();
        expect(crossShopOrder.body.message).toBe('Order not found');
        expect(crossShopConversation.status).toBe(404);
        expect(crossShopConversation.body.data).toBeUndefined();
        expect(crossShopConversation.body.message).toBe('Conversation not found');
        expect(JSON.stringify(crossShopOrder.body)).not.toContain(orderB.order_number);
        expect(JSON.stringify(crossShopConversation.body)).not.toContain('Shop B message');
    }, 30000);

    test('rejects a forged shop claim before resolving any entity', async () => {
        const orderB = await Order.create({
            shop_id: shopB.shop.id,
            order_number: `ME-FORGED-${uuidv4()}`,
            order_status: 'confirmed',
            total: 325,
        });
        orderIds.push(orderB.id);

        const forgedToken = tokenFor(shopA.user, shopB.shop.id);
        const response = await request(app)
            .get(`/api/order/${orderB.id}`)
            .set('Authorization', `Bearer ${forgedToken}`);

        expect(response.status).toBe(403);
        expect(response.body.data).toBeUndefined();
    }, 30000);

    test('returns fresh changed state and then the same safe not-found result after deletion', async () => {
        const order = await Order.create({
            shop_id: shopA.shop.id,
            order_number: `ME-STALE-${uuidv4()}`,
            order_status: 'confirmed',
            total: 425,
        });
        orderIds.push(order.id);

        const tokenA = tokenFor(shopA.user, shopA.shop.id);
        const first = await request(app)
            .get(`/api/order/${order.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(first.status).toBe(200);
        expect(first.body.data.order_status).toBe('confirmed');

        await order.update({ order_status: 'cancelled' });
        const refreshed = await request(app)
            .get(`/api/order/${order.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(refreshed.status).toBe(200);
        expect(refreshed.body.data.order_status).toBe('cancelled');

        await order.destroy();
        const deleted = await request(app)
            .get(`/api/order/${order.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(deleted.status).toBe(404);
        expect(deleted.body.message).toBe('Order not found');
        expect(deleted.body.data).toBeUndefined();
    }, 30000);

    test('returns not-found safely when a conversation is deleted after an attention-style reference', async () => {
        const conversation = await Conversation.create({
            shop_id: shopA.shop.id,
            channel: 'messenger',
            role: 'user',
            message: 'Stale attention reference',
            status: 'active',
        });
        conversationIds.push(conversation.id);

        const tokenA = tokenFor(shopA.user, shopA.shop.id);
        const first = await request(app)
            .get(`/api/conversation/${conversation.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(first.status).toBe(200);
        expect(first.body.data.id).toBe(conversation.id);

        await conversation.destroy();
        const deleted = await request(app)
            .get(`/api/conversation/${conversation.id}`)
            .set('Authorization', `Bearer ${tokenA}`);
        expect(deleted.status).toBe(404);
        expect(deleted.body.message).toBe('Conversation not found');
        expect(deleted.body.data).toBeUndefined();
    }, 30000);
});
