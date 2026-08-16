'use strict';

const { EventEmitter } = require('events');

const mockSseManager = {
    attachToRequest: jest.fn().mockResolvedValue(undefined),
    unregister: jest.fn(),
};

jest.mock('../../../utils/sse-manager', () => mockSseManager);
jest.mock('../../../config/redis', () => ({ cacheRedis: null }));
jest.mock('../../../utils/cache.service', () => ({}));
jest.mock('../conversation.service', () => ({}));
jest.mock('../escalation-auto-reply.service', () => ({ sendEscalationAutoReply: jest.fn() }));
jest.mock('../../entities', () => ({
    Conversation: {},
    Customer: {},
    Message: {},
}));
jest.mock('../../channel-providers/meta-channel.service', () => ({}));
jest.mock('../../channel-providers/meta-channel.entity', () => ({}));
jest.mock('../../channel-providers/provider.registry', () => ({ getProvider: jest.fn() }));
jest.mock('../../policy/policy.engine', () => ({}));

const controller = require('../conversation.controller');

function request(overrides = {}) {
    return Object.assign(new EventEmitter(), {
        headers: {},
        query: {},
        user: { userId: 'user-1', shopId: 'shop-1' },
        ...overrides,
    });
}

function response() {
    const res = {
        status: jest.fn(),
        json: jest.fn(),
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

describe('conversation SSE tenant binding', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test.each([
        ['forged x-shop-id', { headers: { 'x-shop-id': 'shop-2' } }],
        ['forged query shop_id', { query: { shop_id: 'shop-2' } }],
    ])('rejects %s', async (_label, overrides) => {
        const res = response();
        await controller.getEventStream(request(overrides), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.objectContaining({ code: 'UNTRUSTED_SHOP_OVERRIDE' }),
        }));
        expect(mockSseManager.attachToRequest).not.toHaveBeenCalled();
    });

    test('requires an explicit authenticated shop even for an admin-shaped token', async () => {
        const res = response();
        await controller.getEventStream(request({
            user: { userId: 'admin-1', role: 'admin', shopId: null },
        }), res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockSseManager.attachToRequest).not.toHaveBeenCalled();
    });

    test('rejects unsigned conversation attachment requests', async () => {
        const res = response();
        await controller.serveConversationAttachment({
            params: { shopId: 'shop-1', fileName: 'attachment.pdf' },
            query: {},
        }, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.end).toHaveBeenCalled();
    });

    test.each(['shop-1', 'shop-2'])(
        'binds a multi-shop user to the active token shop %s',
        async (shopId) => {
            const req = request({
                user: { userId: 'user-1', shopId },
            });
            const res = response();

            await controller.getEventStream(req, res);

            expect(mockSseManager.attachToRequest).toHaveBeenCalledWith(req, res, shopId);
            req.emit('close');
            expect(mockSseManager.unregister).toHaveBeenCalledWith(shopId, res);
        },
    );
});
