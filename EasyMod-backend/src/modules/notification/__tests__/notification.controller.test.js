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

jest.mock('../../jobs/queue-manager', () => ({
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

// ── Require after mocks ───────────────────────────────────────────────────────

const notificationController = require('../notification.controller');
const queueManager = require('../../jobs/queue-manager');
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
    beforeEach(() => jest.clearAllMocks());

    it('enqueues a notification job and returns 200 on valid request', async () => {
        const req = mockReq({ shop_id: 'shop-1', title: 'New Order', body: 'Order #42 arrived' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(queueManager.queues.notifications.add).toHaveBeenCalledWith({
            shopId: 'shop-1',
            payload: { title: 'New Order', body: 'Order #42 arrived', data: undefined }
        });
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
        expect(queueManager.queues.notifications.add).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({ data: { orderId: 'order-1', type: 'new_order' } })
        }));
    });

    it('returns 400 when shop_id is missing', async () => {
        const req = mockReq({ title: 'Test', body: 'Body' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when title is missing', async () => {
        const req = mockReq({ shop_id: 'shop-1', body: 'Body' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when body is missing', async () => {
        const req = mockReq({ shop_id: 'shop-1', title: 'Test' });
        const res = mockRes();
        await notificationController.sendPush(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
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
