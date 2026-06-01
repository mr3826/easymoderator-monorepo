/**
 * TrialExpiryJob — run() logic tests (DB + notifier mocked).
 */

jest.mock('../../modules/entities', () => ({
    Subscription: { findAll: jest.fn() },
    AuditLog: { create: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../modules/notification/conversation-limit-notifier.service', () => ({
    sendConvLimitNotification: jest.fn().mockResolvedValue(undefined),
}));

const { Subscription } = require('../../modules/entities');
const notifier = require('../../modules/notification/conversation-limit-notifier.service');
const TrialExpiryJob = require('../trial-expiry.job');

const makeSub = (overrides) => ({
    shop_id: overrides.shop_id || 'shop-x',
    status: 'trialing',
    trial_ends_at: overrides.trial_ends_at,
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const days = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

beforeEach(() => {
    jest.clearAllMocks();
});

describe('TrialExpiryJob.run', () => {
    it('expires trials whose trial_ends_at has passed and notifies once', async () => {
        const expired = makeSub({ shop_id: 'shop-expired', trial_ends_at: days(-1) });
        Subscription.findAll.mockResolvedValueOnce([expired]);

        const job = new TrialExpiryJob();
        const res = await job.run({ dryRun: false, runDate: new Date() });

        expect(expired.update).toHaveBeenCalledWith({ status: 'trial_expired' });
        expect(notifier.sendConvLimitNotification).toHaveBeenCalledWith('shop-expired', 'TRIAL_EXPIRED', {});
        expect(res.expired).toBe(1);
        expect(res.nudged).toBe(0);
    });

    it('sends a TRIAL_ENDING nudge at 3 and 1 days left, not at 7', async () => {
        const threeLeft = makeSub({ shop_id: 'shop-3', trial_ends_at: days(3) });
        const sevenLeft = makeSub({ shop_id: 'shop-7', trial_ends_at: days(7) });
        Subscription.findAll.mockResolvedValueOnce([threeLeft, sevenLeft]);

        const job = new TrialExpiryJob();
        const res = await job.run({ dryRun: false, runDate: new Date() });

        expect(notifier.sendConvLimitNotification).toHaveBeenCalledWith('shop-3', 'TRIAL_ENDING', { daysLeft: 3 });
        expect(notifier.sendConvLimitNotification).not.toHaveBeenCalledWith('shop-7', 'TRIAL_ENDING', expect.anything());
        expect(threeLeft.update).not.toHaveBeenCalled();
        expect(res.nudged).toBe(1);
        expect(res.expired).toBe(0);
    });

    it('dry-run makes no writes or notifications', async () => {
        const expired = makeSub({ shop_id: 'shop-dry', trial_ends_at: days(-2) });
        Subscription.findAll.mockResolvedValueOnce([expired]);

        const job = new TrialExpiryJob();
        const res = await job.run({ dryRun: true, runDate: new Date() });

        expect(expired.update).not.toHaveBeenCalled();
        expect(notifier.sendConvLimitNotification).not.toHaveBeenCalled();
        expect(res.expired).toBe(1); // counted, not applied
    });

    it('skips trialing rows with no trial_ends_at', async () => {
        const noEnd = makeSub({ shop_id: 'shop-none', trial_ends_at: null });
        Subscription.findAll.mockResolvedValueOnce([noEnd]);

        const job = new TrialExpiryJob();
        const res = await job.run({ dryRun: false, runDate: new Date() });

        expect(noEnd.update).not.toHaveBeenCalled();
        expect(res.expired).toBe(0);
        expect(res.nudged).toBe(0);
    });
});
