'use strict';

jest.mock('../../entities', () => ({
    OwnerNotification: {
        create: jest.fn()
    }
}));

jest.mock('../../../utils/cache.service', () => ({
    getForShop: jest.fn(),
    setForShop: jest.fn()
}));

jest.mock('../../../jobs/queue-manager', () => ({
    queues: {
        notifications: {
            add: jest.fn().mockResolvedValue({ id: 'job-1' })
        }
    }
}));

jest.mock('../push-notification.service', () => ({
    sendPushToShop: jest.fn().mockResolvedValue({ web: 1, fcm: 0, expired: 0 })
}));

jest.mock('../telegram-notification.service', () => ({
    sendEvent: jest.fn().mockResolvedValue({ sent: true })
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })
}));

const { OwnerNotification } = require('../../entities');
const cacheService = require('../../../utils/cache.service');
const queueManager = require('../../../jobs/queue-manager');
const { sendPushToShop } = require('../push-notification.service');
const telegramNotificationService = require('../telegram-notification.service');
const merchantNotificationService = require('../merchant-notification.service');
const { NOTIFICATION_EVENTS } = require('../notification-events');

describe('merchant-notification.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cacheService.getForShop.mockResolvedValue(null);
        cacheService.setForShop.mockResolvedValue(true);
        OwnerNotification.create.mockResolvedValue({ id: 'notif-1' });
    });

    it('creates an in-app notification and queues channel fan-out', async () => {
        const result = await merchantNotificationService.notifyShop(
            'shop-1',
            NOTIFICATION_EVENTS.NEW_ORDER,
            { orderId: 'order-1', orderNumber: 'EM-1' },
            { dedupeKey: 'order-1' }
        );

        expect(OwnerNotification.create).toHaveBeenCalledWith(expect.objectContaining({
            shop_id: 'shop-1',
            type: NOTIFICATION_EVENTS.NEW_ORDER,
            status: 'pending'
        }));
        expect(queueManager.queues.notifications.add).toHaveBeenCalledWith(
            'merchant-notification',
            expect.objectContaining({ shopId: 'shop-1', eventType: NOTIFICATION_EVENTS.NEW_ORDER }),
            expect.objectContaining({ jobId: 'shop-1:new_order:order-1' })
        );
        expect(result.inAppNotificationId).toBe('notif-1');
    });

    it('skips duplicate notifications inside the dedupe window', async () => {
        cacheService.getForShop.mockResolvedValueOnce(true);

        const result = await merchantNotificationService.notifyShop(
            'shop-1',
            NOTIFICATION_EVENTS.NEW_ORDER,
            { orderId: 'order-1' },
            { dedupeKey: 'order-1' }
        );

        expect(result).toEqual({ queued: false, skipped: true, reason: 'duplicate' });
        expect(OwnerNotification.create).not.toHaveBeenCalled();
    });

    it('dispatches queued notifications to browser push and Telegram', async () => {
        const result = await merchantNotificationService.dispatchQueuedNotification({
            shopId: 'shop-1',
            eventType: NOTIFICATION_EVENTS.AI_HITL,
            payload: { conversationId: 'conv-1' }
        });

        expect(sendPushToShop).toHaveBeenCalledWith('shop-1', expect.objectContaining({
            title: 'AI needs human help'
        }));
        expect(telegramNotificationService.sendEvent).toHaveBeenCalledWith(
            'shop-1',
            NOTIFICATION_EVENTS.AI_HITL,
            { conversationId: 'conv-1' }
        );
        expect(result.telegram.sent).toBe(true);
    });
});
