/**
 * Push Notification Service — Membership Targeting Tests
 *
 * Defect: sendPushToShop() sent to every push_subscriptions row for a shop_id
 * with no check that the row's user is still an active member of that shop.
 * Combined with removeUserFromShop() never touching push_subscriptions, a
 * fired or reassigned staff member kept receiving every order/customer push
 * notification for the shop indefinitely — a confidentiality defect.
 *
 * This covers the defense-in-depth layer: even if a subscription row were
 * ever left behind by some other code path, sendPushToShop() itself must not
 * deliver to a user without an active shop membership.
 */

'use strict';

// VAPID keys must be present BEFORE push-notification.service is required —
// webPushReady is computed once at module load time.
process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key';
process.env.VAPID_PRIVATE_KEY = 'test-vapid-private-key';

jest.mock('web-push', () => ({
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    })
}));

const mockFindAllSubs = jest.fn();
const mockDestroySubs = jest.fn();
const mockFindAllMemberships = jest.fn();

jest.mock('../../entities', () => ({
    PushSubscription: {
        findAll: (...args) => mockFindAllSubs(...args),
        destroy: (...args) => mockDestroySubs(...args),
    },
    UserShop: {
        findAll: (...args) => mockFindAllMemberships(...args),
    }
}));

const webpush = require('web-push');
const { sendPushToShop } = require('../push-notification.service');

describe('push-notification.service — sendPushToShop membership targeting', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        webpush.sendNotification.mockResolvedValue({});
        mockDestroySubs.mockResolvedValue(0);
    });

    it("does not deliver to a subscription whose user no longer has an active shop membership (removed staff member)", async () => {
        const activeSub = {
            id: 'sub-active', shop_id: 'shop-1', user_id: 'user-1',
            type: 'web', subscription_json: { endpoint: 'https://push.example/active' }
        };
        const removedSub = {
            id: 'sub-removed', shop_id: 'shop-1', user_id: 'user-2',
            type: 'web', subscription_json: { endpoint: 'https://push.example/removed' }
        };
        mockFindAllSubs.mockResolvedValue([activeSub, removedSub]);
        // Only user-1 has an active membership — user-2 was removed from the shop.
        mockFindAllMemberships.mockResolvedValue([{ user_id: 'user-1' }]);

        const result = await sendPushToShop('shop-1', { title: 'New order', body: 'Order #123' });

        expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
        expect(webpush.sendNotification.mock.calls[0][0]).toEqual({ endpoint: 'https://push.example/active' });
        expect(result.web).toBe(1);
    });

    it('still delivers to a subscription with no user_id (legacy/shop-level row)', async () => {
        const legacySub = {
            id: 'sub-legacy', shop_id: 'shop-1', user_id: null,
            type: 'web', subscription_json: { endpoint: 'https://push.example/legacy' }
        };
        mockFindAllSubs.mockResolvedValue([legacySub]);
        mockFindAllMemberships.mockResolvedValue([]);

        const result = await sendPushToShop('shop-1', { title: 'New order', body: 'Order #123' });

        expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
        expect(result.web).toBe(1);
    });

    it('delivers normally to every subscription when all users are active members', async () => {
        const subA = {
            id: 'sub-a', shop_id: 'shop-1', user_id: 'user-1',
            type: 'web', subscription_json: { endpoint: 'https://push.example/a' }
        };
        const subB = {
            id: 'sub-b', shop_id: 'shop-1', user_id: 'user-2',
            type: 'web', subscription_json: { endpoint: 'https://push.example/b' }
        };
        mockFindAllSubs.mockResolvedValue([subA, subB]);
        mockFindAllMemberships.mockResolvedValue([{ user_id: 'user-1' }, { user_id: 'user-2' }]);

        const result = await sendPushToShop('shop-1', { title: 'New order', body: 'Order #123' });

        expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
        expect(result.web).toBe(2);
    });

    it('returns zero counts and skips membership lookup cost paths gracefully when the shop has no subscriptions', async () => {
        mockFindAllSubs.mockResolvedValue([]);
        mockFindAllMemberships.mockResolvedValue([]);

        const result = await sendPushToShop('shop-1', { title: 'New order', body: 'Order #123' });

        expect(result).toEqual({ web: 0, fcm: 0, expired: 0 });
        expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
});
