/**
 * Scheduled merchant notification jobs.
 */

jest.mock('../../config/redis.js', () => ({ cacheRedis: null }));
jest.mock('../../modules/entities', () => ({
    AuditLog: { create: jest.fn(), findOne: jest.fn() },
    Order: { findAll: jest.fn() },
    Conversation: {},
    Message: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../modules/notification/merchant-notification.service', () => ({
    notifyShop: jest.fn().mockResolvedValue({ queued: true }),
}));

const { Order, Message } = require('../../modules/entities');
const merchantNotificationService = require('../../modules/notification/merchant-notification.service');
const { NOTIFICATION_EVENTS } = require('../../modules/notification/notification-events');
const DailySalesSummaryNotifier = require('../daily-sales-summary-notifier');
const CustomerWaitingNotifier = require('../customer-waiting-notifier');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('DailySalesSummaryNotifier.run', () => {
    it('queues one daily sales summary alert per shop with orders', async () => {
        Order.findAll.mockResolvedValueOnce([
            { shop_id: 'shop-1', orderCount: '3', salesTotal: '2450.50' }
        ]);

        const runDate = new Date('2026-07-04T18:05:00.000Z');
        const result = await new DailySalesSummaryNotifier().run({ dryRun: false, runDate });

        expect(result.alertsQueued).toBe(1);
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            'shop-1',
            NOTIFICATION_EVENTS.DAILY_SALES_SUMMARY,
            expect.objectContaining({
                date: '2026-07-03',
                orderCount: 3,
                salesTotal: 2450.5
            }),
            expect.objectContaining({ dedupeKey: '2026-07-03' })
        );
    });

    it('does not queue alerts during dry-run', async () => {
        Order.findAll.mockResolvedValueOnce([
            { shop_id: 'shop-1', orderCount: '1', salesTotal: '100' }
        ]);

        const result = await new DailySalesSummaryNotifier().run({
            dryRun: true,
            runDate: new Date('2026-07-04T18:05:00.000Z')
        });

        expect(result.shopsProcessed).toBe(1);
        expect(merchantNotificationService.notifyShop).not.toHaveBeenCalled();
    });
});

describe('CustomerWaitingNotifier.run', () => {
    it('queues a waiting customer alert when latest HITL message is old customer message', async () => {
        const message = {
            id: 'msg-1',
            content: 'Need help with my order',
            created_at: new Date('2026-07-04T10:00:00.000Z'),
            conversation: {
                id: 'conv-1',
                shop_id: 'shop-1',
                title: 'Customer One'
            }
        };
        Message.findAll.mockResolvedValueOnce([message]);
        Message.findOne.mockResolvedValueOnce({ ...message, sender: 'customer' });

        const result = await new CustomerWaitingNotifier().run({
            dryRun: false,
            runDate: new Date('2026-07-04T10:45:00.000Z')
        });

        expect(result.alertsQueued).toBe(1);
        expect(merchantNotificationService.notifyShop).toHaveBeenCalledWith(
            'shop-1',
            NOTIFICATION_EVENTS.CUSTOMER_WAITING_TOO_LONG,
            expect.objectContaining({
                conversationId: 'conv-1',
                customerName: 'Customer One',
                waitMinutes: 45
            }),
            expect.objectContaining({ dedupeTtlSeconds: 6 * 60 * 60 })
        );
    });

    it('skips when a newer business or AI message exists', async () => {
        const message = {
            id: 'msg-1',
            content: 'Need help',
            created_at: new Date('2026-07-04T10:00:00.000Z'),
            conversation: { id: 'conv-1', shop_id: 'shop-1', title: 'Customer One' }
        };
        Message.findAll.mockResolvedValueOnce([message]);
        Message.findOne.mockResolvedValueOnce({ id: 'msg-2', sender: 'business' });

        const result = await new CustomerWaitingNotifier().run({
            dryRun: false,
            runDate: new Date('2026-07-04T10:45:00.000Z')
        });

        expect(result.alertsQueued).toBe(0);
        expect(merchantNotificationService.notifyShop).not.toHaveBeenCalled();
    });
});
