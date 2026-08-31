'use strict';

const mockClaimForShop = jest.fn();

jest.mock('../../entities', () => ({
    OwnerNotification: {
        create: jest.fn()
    }
}));

jest.mock('../../../utils/cache.service', () => ({
    claimForShop: mockClaimForShop,
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
        mockClaimForShop.mockResolvedValue(true);
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

    it('queues courier setup blockers with the supplied shop-scoped dedupe key', async () => {
        const result = await merchantNotificationService.notifyShop(
            'shop-1',
            NOTIFICATION_EVENTS.COURIER_SETUP_REQUIRED,
            { orderId: 'order-1', missing: ['pickup_location'] },
            { dedupeKey: 'order-1:courier_setup', dedupeTtlSeconds: 24 * 60 * 60 }
        );

        expect(cacheService.claimForShop).toHaveBeenCalledWith(
            'shop-1',
            'notification:dedupe:courier_setup_required:order-1:courier_setup',
            24 * 60 * 60
        );
        expect(queueManager.queues.notifications.add).toHaveBeenCalledWith(
            'merchant-notification',
            expect.objectContaining({
                shopId: 'shop-1',
                eventType: NOTIFICATION_EVENTS.COURIER_SETUP_REQUIRED,
                payload: { orderId: 'order-1', missing: ['pickup_location'] },
                dedupeKey: 'order-1:courier_setup'
            }),
            expect.objectContaining({ jobId: 'shop-1:courier_setup_required:order-1:courier_setup' })
        );
        expect(result.inAppNotificationId).toBe('notif-1');
    });

    it('skips duplicate notifications inside the dedupe window', async () => {
        mockClaimForShop.mockResolvedValueOnce(false);

        const result = await merchantNotificationService.notifyShop(
            'shop-1',
            NOTIFICATION_EVENTS.NEW_ORDER,
            { orderId: 'order-1' },
            { dedupeKey: 'order-1' }
        );

        expect(result).toEqual({ queued: false, skipped: true, reason: 'duplicate' });
        expect(OwnerNotification.create).not.toHaveBeenCalled();
    });

    it('suppresses a second conversation during a configured shop cooldown', async () => {
        await merchantNotificationService.notifyShop(
            'shop-1', NOTIFICATION_EVENTS.AI_HITL,
            { conversationId: 'conversation-1' },
            { dedupeKey: 'shop:shop-1:ai_handoff', dedupeTtlSeconds: 45 * 60 },
        );

        mockClaimForShop.mockResolvedValue(false);
        const second = await merchantNotificationService.notifyShop(
            'shop-1', NOTIFICATION_EVENTS.AI_HITL,
            { conversationId: 'conversation-2' },
            { dedupeKey: 'shop:shop-1:ai_handoff', dedupeTtlSeconds: 45 * 60 },
        );

        expect(second).toEqual({ queued: false, skipped: true, reason: 'duplicate' });
        expect(mockClaimForShop).toHaveBeenCalledWith(
            'shop-1',
            'notification:dedupe:ai_hitl:shop:shop-1:ai_handoff',
            45 * 60,
        );
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
