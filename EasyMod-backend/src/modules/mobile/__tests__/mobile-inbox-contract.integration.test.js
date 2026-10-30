'use strict';

process.env.MOBILE_API_ENABLED = 'true';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { User, Tenant, Shop, UserShop, Conversation, Message, AuditLog } = require('../../entities');
const { cacheRedis } = require('../../../config/redis');
const { generateAccessToken } = require('../../../utils/jwt.util');
const app = require('../../../app');

async function makeShopFixture(label) {
    const suffix = uuidv4();
    const tenant = await Tenant.create({ name: `Mobile Inbox ${label} Tenant ${suffix}` });
    const shop = await Shop.create({
        unique_code: `MI-${suffix}`.slice(0, 20),
        tenant_id: tenant.id,
        shop_name: `Mobile Inbox Shop ${label}`,
        name: `Mobile Inbox Shop ${label}`,
    });
    const user = await User.create({
        email: `mobile-inbox-${label}-${suffix}@example.test`,
        password: 'integration-only',
        full_name: `Mobile Inbox Merchant ${label}`,
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

describe('mobile Inbox HTTP contracts on real PostgreSQL and Redis', () => {
    let shopA;
    let shopB;
    let conversationA;
    let conversationB;
    let expiredConversation;
    const conversationIds = [];
    let replyIdempotencyKey;

    beforeAll(async () => {
        shopA = await makeShopFixture('A');
        shopB = await makeShopFixture('B');
        conversationA = await Conversation.create({
            shop_id: shopA.shop.id,
            channel: 'webchat',
            role: 'user',
            message: 'Synthetic mobile inbox inbound message',
            status: 'active',
            last_customer_message_at: new Date(),
        });
        conversationB = await Conversation.create({
            shop_id: shopB.shop.id,
            channel: 'webchat',
            role: 'user',
            message: 'Other shop private message',
            status: 'active',
            last_customer_message_at: new Date(),
        });
        expiredConversation = await Conversation.create({
            shop_id: shopA.shop.id,
            channel: 'messenger',
            role: 'user',
            message: 'Synthetic expired Messenger conversation',
            status: 'active',
            last_customer_message_at: new Date(Date.now() - 30 * 60 * 60 * 1000),
        });
        conversationIds.push(conversationA.id, conversationB.id, expiredConversation.id);
        await Message.create({
            conversation_id: expiredConversation.id,
            sender: 'customer',
            content: 'Old inbound message',
            message_type: 'text',
            created_at: new Date(Date.now() - 30 * 60 * 60 * 1000),
        });
        replyIdempotencyKey = `mobile-reply-${uuidv4()}`;
    }, 30000);

    afterAll(async () => {
        if (conversationIds.length > 0) {
            await Message.destroy({ where: { conversation_id: { [Op.in]: conversationIds } }, force: true });
            await Conversation.destroy({ where: { id: { [Op.in]: conversationIds } }, force: true });
        }
        for (const shop of [shopA, shopB]) {
            if (!shop?.shop?.id) continue;
            await AuditLog.destroy({
                where: {
                    shop_id: shop.shop.id,
                    action: { [Op.in]: [
                        'INBOX_MESSAGE_SENT',
                        'INBOX_MESSAGE_QUEUED',
                        'INBOX_MESSAGE_HELD',
                        'INBOX_MESSAGE_DELIVERY_FAILED',
                    ] },
                },
            });
            await UserShop.destroy({ where: { shop_id: shop.shop.id } });
            await Shop.destroy({ where: { id: shop.shop.id }, force: true });
            await User.destroy({ where: { id: shop.user.id }, force: true });
            await Tenant.destroy({ where: { id: shop.tenant.id }, force: true });
        }
        if (conversationA?.id) await cacheRedis.del(`ai:pause:${conversationA.id}`);
    }, 30000);

    test('lists and reads only the current shop Inbox contract', async () => {
        const token = tokenFor(shopA.user, shopA.shop.id);
        const list = await request(app)
            .get('/api/mobile/inbox/conversations?page=1&limit=10')
            .set('Authorization', `Bearer ${token}`);

        expect(list.status).toBe(200);
        expect(list.body.data.conversations.map((conversation) => conversation.id)).toContain(conversationA.id);
        expect(list.body.data.conversations.map((conversation) => conversation.id)).not.toContain(conversationB.id);

        const own = await request(app)
            .get(`/api/mobile/inbox/conversations/${conversationA.id}`)
            .set('Authorization', `Bearer ${token}`);
        const foreign = await request(app)
            .get(`/api/mobile/inbox/conversations/${conversationB.id}`)
            .set('Authorization', `Bearer ${token}`);

        expect(own.status).toBe(200);
        expect(own.body.data.id).toBe(conversationA.id);
        expect(foreign.status).toBe(404);
        expect(foreign.body.data).toBeUndefined();
    }, 30000);

    test('returns mobile reply delivery state and replays one message for the same key', async () => {
        const token = tokenFor(shopA.user, shopA.shop.id);
        const reply = () => request(app)
            .post(`/api/mobile/inbox/conversations/${conversationA.id}/reply`)
            .set('Authorization', `Bearer ${token}`)
            .set('X-Idempotency-Key', replyIdempotencyKey)
            .send({ message: 'Synthetic webchat reply' });

        const first = await reply();
        const replay = await reply();
        expect(first.status).toBe(201);
        expect(replay.status).toBe(201);
        expect(first.body.data.message.id).toBe(replay.body.data.message.id);
        expect(first.body.data.message.delivery_state).toBe('HELD');
        expect(first.body.data.message.provider_message_id).toBeFalsy();
        const stored = await Message.findAll({
            where: { conversation_id: conversationA.id, send_idempotency_key: replyIdempotencyKey },
        });
        expect(stored).toHaveLength(1);
    }, 30000);

    test('enforces Meta reply eligibility at the HTTP boundary', async () => {
        const token = tokenFor(shopA.user, shopA.shop.id);
        const response = await request(app)
            .post(`/api/mobile/inbox/conversations/${expiredConversation.id}/reply`)
            .set('Authorization', `Bearer ${token}`)
            .send({ message: 'This must not be sent outside the reply window' });

        expect(response.status).toBe(422);
        expect(response.body.code).toBe('OUTSIDE_24H_WINDOW');
        expect(await Message.count({ where: { conversation_id: expiredConversation.id, sender: 'business' } })).toBe(0);
    }, 30000);
});
