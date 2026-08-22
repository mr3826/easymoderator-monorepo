'use strict';

const { randomUUID } = require('crypto');

const mockSendMessage = jest.fn(async () => ({ providerMessageId: `meta-${randomUUID()}` }));
const mockCreateDeliveryOrder = jest.fn(async () => ({
    provider: 'steadfast',
    consignment_id: `CN-${randomUUID()}`,
    tracking_code: `TRK-${randomUUID()}`,
    status: 'pending',
}));
const mockLookupCourierOrder = jest.fn();

jest.mock('../message-queue', () => ({ connection: {} }));
jest.mock('../../config/redis', () => ({
    cacheRedis: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => 'OK'),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
        incr: jest.fn(async () => 1),
        expire: jest.fn(async () => 1),
    },
}));
jest.mock('../../modules/channel-providers/provider.registry', () => ({
    getProvider: jest.fn(() => ({ sendMessage: mockSendMessage })),
}));
jest.mock('../../modules/delivery/delivery.service', () => ({
    getActiveProvider: jest.fn(async () => ({
        provider: 'steadfast',
        instance: { getOrderStatusByInvoice: mockLookupCourierOrder },
    })),
    createDeliveryOrder: mockCreateDeliveryOrder,
}));
jest.mock('../../modules/policy/policy.engine', () => ({
    evaluateOutbound: jest.fn(async () => ({
        allow: true,
        decisionId: 'integration-policy',
        reason: null,
        transform: null,
    })),
}));
jest.mock('../../modules/shop/shop.service', () => ({
    getShopAiSettings: jest.fn(async () => ({
        ai_auto_reply: true,
        automation_mode: 'AI_ACTIVE',
        allow_order_creation: true,
        confidence_threshold: 0.75,
    })),
}));
jest.mock('../../modules/ai/sentiment.service', () => ({
    analyzeSentiment: jest.fn(async () => ({ sentiment: 'positive', score: 1, method: 'integration-fixture' })),
    shouldAutoEscalate: jest.fn(() => false),
}));
jest.mock('../../utils/sse-manager', () => ({ broadcast: jest.fn(), emit: jest.fn() }));
jest.mock('../../utils/ops-alert', () => ({ opsAlert: jest.fn(async () => {}) }));

const {
    IDS,
    CUSTOMER_PSID,
    syncSchema,
    truncateAll,
    seed,
} = require('../../../tests/meta-e2e/fixtures');
const {
    AuditLog,
    Conversation,
    CourierDispatch,
    Customer,
    Message,
    Order,
    Product,
    Subscription,
} = require('../../modules/entities');
const MetaChannelSettings = require('../../modules/channel-providers/meta-channel-settings.entity');
const OrderSession = require('../../modules/order/order-session.entity');
const OrderSessionService = require('../../modules/order/order-session-standalone.service');
const { processMessageJob } = require('../message-worker');
const { sequelize } = require('../../utils/database/database-setup');

const CONVERSATION_ID = 'aaaaaaaa-2222-4222-8222-22222222222a';
const CUSTOMER_ID = 'aaaaaaaa-3333-4333-8333-33333333333a';
const ACTION_GATE_SECRET = 'integration-action-gate-secret-at-least-32-chars';

let conversation;
let customer;
let messageSequence = 0;

const sleep = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

const getActiveSession = () => OrderSessionService.getActiveSession(IDS.shopA, CUSTOMER_PSID);

const runInbound = async (text) => {
    messageSequence += 1;
    const externalId = `integration-${messageSequence}-${randomUUID()}`;
    const inbound = await Message.create({
        conversation_id: CONVERSATION_ID,
        content: text,
        sender: 'customer',
        external_id: externalId,
    });
    return processMessageJob({
        id: `integration-job-${messageSequence}`,
        attemptsMade: 0,
        data: {
            shopId: IDS.shopA,
            conversationId: CONVERSATION_ID,
            messageId: inbound.id,
            externalId,
            message: text,
            platform: 'facebook',
            recipientId: CUSTOMER_PSID,
            metaChannelId: IDS.channelA,
            senderInfo: { name: 'Integration Customer' },
        },
    });
};

const driveToSummary = async () => {
    await runInbound('I want to order black panjabi');

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const session = await getActiveSession();
        if (!session) throw new Error('order session was not created');
        if (session.current_step === 'ORDER_SUMMARY') return session;

        const answerByStep = {
            SELECTING_PRODUCT: 'black panjabi',
            PRODUCT_CONFIRMATION: 'yes',
            COLLECTING_QUANTITY: '1',
            ADD_MORE: 'done',
            COLLECTING_NAME: 'Integration Customer',
            COLLECTING_PHONE: '01711111111',
            COLLECTING_ADDRESS: 'Mirpur 10, Dhaka',
            COLLECTING_ZONE: '1',
            COLLECTING_PAYMENT: 'cod',
            COLLECTING_NOTES: 'no',
        };
        const answer = answerByStep[session.current_step];
        if (!answer) throw new Error(`unexpected order step: ${session.current_step}`);
        await runInbound(answer);
    }

    throw new Error('order session did not reach ORDER_SUMMARY');
};

const reopenSummary = async (session) => {
    await OrderSession.update(
        {
            status: 'ACTIVE',
            current_step: 'ORDER_SUMMARY',
            created_order_id: null,
        },
        { where: { id: session.id } },
    );
    return OrderSession.findByPk(session.id);
};

const gateAudits = async (actionType, decision = 'authorized') => {
    const rows = await AuditLog.findAll({
        where: { shop_id: IDS.shopA, action: `ai.action_gate.${decision}` },
    });
    return rows.filter(row => row.metadata?.actionType === actionType);
};

beforeAll(async () => {
    await syncSchema();
    await seed();
    customer = await Customer.create({
        id: CUSTOMER_ID,
        shop_id: IDS.shopA,
        name: 'Integration Customer',
        channel_type: 'messenger',
        channel_user_id: CUSTOMER_PSID,
        phone: '01711111111',
        messaging_consent: { facebook: { opted_in: true } },
    });
    conversation = await Conversation.create({
        id: CONVERSATION_ID,
        shop_id: IDS.shopA,
        customer_id: customer.id,
        channel: 'messenger',
        meta_channel_id: IDS.channelA,
        role: 'user',
        message: 'integration fixture',
        status: 'active',
        hitl: false,
    });
    const [settings] = await MetaChannelSettings.findOrCreate({ where: { channel_id: IDS.channelA } });
    await settings.update({ ai_auto_reply: true, automation_mode: 'AI_ACTIVE', allow_order_creation: true });
    process.env.AI_ACTION_GATE_SECRET = ACTION_GATE_SECRET;
});

beforeEach(async () => {
    messageSequence = 0;
    mockSendMessage.mockClear();
    mockCreateDeliveryOrder.mockClear();
    mockLookupCourierOrder.mockReset();
    process.env.NODE_ENV = 'test';
    process.env.AI_ACTION_GATE_SECRET = ACTION_GATE_SECRET;
    await CourierDispatch.destroy({ where: { shop_id: IDS.shopA } });
    await AuditLog.destroy({ where: { shop_id: IDS.shopA } });
    await Message.destroy({ where: { conversation_id: CONVERSATION_ID } });
    await OrderSession.destroy({ where: { shop_id: IDS.shopA } });
    await Order.destroy({ where: { shop_id: IDS.shopA } });
    await Product.update(
        { price: 1847, quantity: 10, in_stock: true, is_active: true },
        { where: { id: 'cccccccc-0000-4000-8000-00000000000c', shop_id: IDS.shopA } },
    );
    await Subscription.update(
        { orders_used: 0, conversations_used: 0 },
        { where: { shop_id: IDS.shopA } },
    );
    await conversation.update({ hitl: false, status: 'active', message: 'integration fixture' });
});

afterAll(async () => {
    await truncateAll();
    await sequelize.close();
});

describe('real message-worker Action Gate traversal', () => {
    test('creates one order and one courier dispatch claim with matching authorized audits', async () => {
        const summary = await driveToSummary();
        await runInbound('YES');
        await sleep(50);

        const orders = await Order.findAll({ where: { shop_id: IDS.shopA } });
        expect(orders).toHaveLength(1);
        const orderAudit = await gateAudits('CREATE_ORDER');
        expect(orderAudit).toHaveLength(1);
        expect(orderAudit[0].idempotency_key).toBe(orders[0].idempotency_key);
        expect(orderAudit[0].shop_id).toBe(IDS.shopA);
        expect(orderAudit[0].metadata.traceId).toBeTruthy();
        expect(summary.id).toBeTruthy();

        const dispatch = await CourierDispatch.findOne({ where: { shop_id: IDS.shopA, order_id: orders[0].id } });
        expect(dispatch).toBeTruthy();
        expect(dispatch.status).toBe('COMMITTED');
        expect(dispatch.tracking_code).toBeTruthy();
        expect(await gateAudits('BOOK_COURIER')).toHaveLength(1);
        expect(mockCreateDeliveryOrder).toHaveBeenCalledTimes(1);
    });

    test('missing production secret denies before order creation with a named audit reason', async () => {
        await driveToSummary();
        const previousNodeEnv = process.env.NODE_ENV;
        const previousSecret = process.env.AI_ACTION_GATE_SECRET;
        try {
            process.env.NODE_ENV = 'production';
            delete process.env.AI_ACTION_GATE_SECRET;
            await runInbound('YES');
        } finally {
            process.env.NODE_ENV = previousNodeEnv;
            process.env.AI_ACTION_GATE_SECRET = previousSecret;
        }

        expect(await Order.count({ where: { shop_id: IDS.shopA } })).toBe(0);
        const denied = await gateAudits('CREATE_ORDER', 'denied');
        expect(denied).toHaveLength(1);
        expect(denied[0].metadata.reasonCode).toBe('authorization_ttl_available');
    });

    test('replaying the confirmed turn denies on committed order idempotency', async () => {
        const summary = await driveToSummary();
        await runInbound('YES');
        await sleep(50);
        const reopened = await reopenSummary(summary);
        expect(reopened?.current_step).toBe('ORDER_SUMMARY');
        expect(reopened?.status).toBe('ACTIVE');

        await runInbound('YES');

        expect(await Order.count({ where: { shop_id: IDS.shopA } })).toBe(1);
        const denied = await gateAudits('CREATE_ORDER', 'denied');
        expect(denied.some(row => row.metadata.reasonCode === 'idempotency_not_committed')).toBe(true);
        expect(await CourierDispatch.count({ where: { shop_id: IDS.shopA } })).toBe(1);
        expect(mockCreateDeliveryOrder).toHaveBeenCalledTimes(1);
    });

    test('price change between summary and gate denies on material revalidation', async () => {
        await driveToSummary();
        await Product.update(
            { price: 1999 },
            { where: { id: 'cccccccc-0000-4000-8000-00000000000c', shop_id: IDS.shopA } },
        );

        await runInbound('YES');

        expect(await Order.count({ where: { shop_id: IDS.shopA } })).toBe(0);
        const denied = await gateAudits('CREATE_ORDER', 'denied');
        expect(denied).toHaveLength(1);
        expect(denied[0].metadata.reasonCode).toBe('material_state_revalidated');
    });
});
