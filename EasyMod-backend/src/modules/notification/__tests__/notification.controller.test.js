/**
 * Notification Controller — Unit Tests
 * Tests the sendPush endpoint: queues notification jobs, validates input
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../entities', () => ({
    Shop: { findOne: jest.fn() },
    User: { findOne: jest.fn() },
    PushSubscription: { findAll: jest.fn() }
}));

jest.mock('../../../jobs/queue-manager', () => ({
    queues: {
        notifications: {
            add: jest.fn().mockResolvedValue({ id: 'job-notif-1' })
        }
    }
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }))
}));

jest.mock('../../../utils/AppError', () => ({
    AppError: class AppError extends Error {
        constructor(msg, code) { super(msg); this.statusCode = code; }
    }
}));

// The controller resolves the shop through the service, not the entity, so
// mocking `entities` alone leaves it talking to a real database.
jest.mock('../../shop/shop.service', () => ({
    getShopById: jest.fn()
}));

// ── Require after mocks ───────────────────────────────────────────────────────

const notificationController = require('../notification.controller');
const { getShopById } = require('../../shop/shop.service');
const queueManager = require('../../../jobs/queue-manager');
const { AppError } = require('../../../utils/AppError');

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const mockReq = (body = {}) => ({
    body,
    user: { id: 'user-1', shopId: 'shop-1' }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationController.sendPush', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        getShopById.mockResolvedValue({ id: 'shop-1', shop_name: 'Test Shop' });
    });

    it('enqueues a notification job and returns 200 on valid request', async () => {
        const req = mockReq({ shop_id: 'shop-1', title: 'New Order', body: 'Order #42 arrived' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        // The job NAME is part of the contract: the worker routes on it, so a
        // payload queued without it is never delivered.
        expect(queueManager.queues.notifications.add).toHaveBeenCalledWith(
            'push-notification',
            {
                shopId: 'shop-1',
                payload: { title: 'New Order', body: 'Order #42 arrived', data: {} }
            }
        );
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('returns notification_id from the queued job', async () => {
        const req = mockReq({ shop_id: 'shop-1', title: 'Test', body: 'Body' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        const response = res.json.mock.calls[0][0];
        expect(response.notification_id).toBeDefined();
    });

    it('passes optional data field to job payload', async () => {
        const req = mockReq({
            shop_id: 'shop-1', title: 'T', body: 'B',
            data: { orderId: 'order-1', type: 'new_order' }
        });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(queueManager.queues.notifications.add).toHaveBeenCalledWith(
            'push-notification',
            expect.objectContaining({
                payload: expect.objectContaining({ data: { orderId: 'order-1', type: 'new_order' } })
            })
        );
    });

    // Missing title/body are rejected by the validator chain on the route
    // (notification.routes.js: validatePushNotification), not by the handler —
    // calling the handler directly never runs it, so the three tests that
    // asserted 400 here were asserting nothing the controller does. What the
    // handler itself owns is the tenant boundary below.

    it('refuses to notify a shop the caller does not belong to', async () => {
        const req = mockReq({ shop_id: 'someone-elses-shop', title: 'T', body: 'B' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(queueManager.queues.notifications.add).not.toHaveBeenCalled();
    });

    it('refuses when the caller has no shop at all', async () => {
        const req = { body: { title: 'T', body: 'B' }, user: {} };
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(queueManager.queues.notifications.add).not.toHaveBeenCalled();
    });

    it('returns 404 when the shop does not exist', async () => {
        getShopById.mockResolvedValue(null);
        const req = mockReq({ shop_id: 'shop-1', title: 'T', body: 'B' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 200 with fallback notification_id when queue is unavailable', async () => {
        // Simulate queue being offline
        const originalQueues = queueManager.queues;
        queueManager.queues = { notifications: null };

        const req = mockReq({ shop_id: 'shop-1', title: 'Test', body: 'Body' });
        const res = mockRes();
        await notificationController.sendPush(req, res);

        const response = res.json.mock.calls[0][0];
        expect(response.success).toBe(true);
        expect(response.notification_id).toBeDefined();

        queueManager.queues = originalQueues;
    });

    it('does not throw when queue.add rejects', async () => {
        queueManager.queues.notifications.add.mockRejectedValueOnce(new Error('Redis down'));
        const req = mockReq({ shop_id: 'shop-1', title: 'T', body: 'B' });
        const res = mockRes();
        await expect(notificationController.sendPush(req, res)).resolves.not.toThrow();
    });
});
