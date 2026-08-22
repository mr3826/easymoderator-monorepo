'use strict';

process.env.NODE_ENV = 'test';

const mockCacheSetex = jest.fn();

jest.mock('src/config/memory-cache', () => ({
    MemoryCache: class {
        async get() { return null; }
        async setex(...args) { return mockCacheSetex(...args); }
    },
}));
jest.mock('src/modules/ai/llm.service', () => ({ chat: jest.fn() }));
jest.mock('src/modules/ai/bert-client.service', () => ({ classify: jest.fn(async () => null) }));
jest.mock('src/modules/ai/gemini-cache.service', () => ({ getOrCreate: jest.fn(async () => null) }));
jest.mock('src/modules/ai/prompt-sanitizer.service', () => ({ scrubPII: (value) => value }));
jest.mock('src/modules/knowledge/knowledge.service', () => ({ incrementFaqHit: jest.fn() }));
jest.mock('src/modules/product/product-search.service', () => ({
    searchByAttributes: jest.fn(),
    getProductsByIds: jest.fn(),
}));
jest.mock('src/modules/rag/rag.service', () => ({ queryData: jest.fn() }));
jest.mock('src/modules/entities', () => ({
    Conversation: { findOne: jest.fn() },
    Order: { findOne: jest.fn() },
    AuditLog: { create: jest.fn(async values => values) },
    FaqResponse: { findAll: jest.fn(async () => []) },
}));

const { route } = require('src/modules/ai/intent-router.service');
const { Conversation, Order } = require('src/modules/entities');
const llm = require('src/modules/ai/llm.service');

const SHOP = 'shop-1';
const CONVERSATION = 'conversation-1';

beforeEach(() => {
    jest.clearAllMocks();
    llm.chat.mockResolvedValue({ text: 'should not run', provider: 'gemini' });
});

describe('customer-bound order status lookup', () => {
    test('binds the order query to the conversation customer and returns status', async () => {
        Conversation.findOne.mockResolvedValue({ customer_id: 'customer-a' });
        Order.findOne.mockResolvedValue({
            order_number: '123456',
            order_status: 'placed',
            payment_status: 'unpaid',
            delivery_status: 'pending',
            delivery_tracking_code: 'TRACK-1',
        });

        const result = await route({
            shopId: SHOP,
            conversationId: CONVERSATION,
            message: 'where is order 123456?',
            language: 'en',
        });

        expect(Conversation.findOne).toHaveBeenCalledWith({
            where: { id: CONVERSATION, shop_id: SHOP },
            attributes: ['customer_id'],
        });
        expect(Order.findOne).toHaveBeenCalledWith({
            where: { shop_id: SHOP, order_number: '123456', customer_id: 'customer-a' },
            attributes: ['order_number', 'order_status', 'payment_status', 'delivery_status', 'delivery_tracking_code'],
        });
        expect(result.response).toContain('Order #123456');
        expect(result.response).toContain('TRACK-1');
        expect(result.humanRequired).toBeUndefined();
        expect(mockCacheSetex).not.toHaveBeenCalled();
        expect(llm.chat).not.toHaveBeenCalled();
    });

    test('refuses a cross-customer order number and returns the handoff response', async () => {
        Conversation.findOne.mockResolvedValue({ customer_id: 'customer-b' });
        Order.findOne.mockResolvedValue(null);

        const result = await route({
            shopId: SHOP,
            conversationId: CONVERSATION,
            message: 'amar order 123456 kothay?',
            language: 'en',
        });

        expect(Order.findOne).toHaveBeenCalledWith(expect.objectContaining({
            where: { shop_id: SHOP, order_number: '123456', customer_id: 'customer-b' },
        }));
        expect(result.source).toBe('order_status_handoff');
        expect(result.humanRequired).toBe(true);
        expect(result.response).toMatch(/team will check/i);
        expect(mockCacheSetex).not.toHaveBeenCalled();
        expect(llm.chat).not.toHaveBeenCalled();
    });

    test.each([
        { conversation: null, description: 'missing conversation context' },
        { conversation: { customer_id: null }, description: 'missing customer context' },
    ])('hands off when $description', async ({ conversation }) => {
        Conversation.findOne.mockResolvedValue(conversation);

        const result = await route({
            shopId: SHOP,
            conversationId: conversation ? CONVERSATION : undefined,
            message: 'order 123456 status?',
            language: 'bn',
        });

        expect(result.humanRequired).toBe(true);
        expect(result.source).toBe('order_status_handoff');
        expect(Order.findOne).not.toHaveBeenCalled();
        expect(llm.chat).not.toHaveBeenCalled();
    });
});
