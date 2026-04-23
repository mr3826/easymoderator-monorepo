/**
 * Campaign Sender Job — Unit Tests
 * Tests processCampaignSend: Meta DM sending, retry logic, completion detection
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRunCampaign = jest.fn().mockResolvedValue({ id: 'camp-1', status: 'running' });
jest.mock('../../modules/campaign/campaign.service', () => ({
    runCampaign: mockRunCampaign
}));

const mockCampaignRecord = {
    id: 'camp-1',
    sent_count: 0,
    failed_count: 0,
    total_recipients: 3,
    update: jest.fn().mockResolvedValue(true)
};

jest.mock('../../modules/entities', () => ({
    Campaign: {
        increment: jest.fn().mockResolvedValue([1, [{ id: 'camp-1' }]]),
        findByPk: jest.fn()
    }
}));

jest.mock('../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }))
}));

// ── Setup ─────────────────────────────────────────────────────────────────────

const { processCampaignSend } = require('../campaign-sender.job');
const { Campaign } = require('../../modules/entities');

const makeJob = (dataOverrides = {}, optsOverrides = {}) => ({
    data: {
        shopId: 'shop-1',
        campaignId: 'camp-1',
        customerId: 'cust-1',
        channelType: 'messenger',
        channelUserId: 'psid-abc123',
        pageId: 'page-999',
        accessToken: 'EAAtoken',
        message: 'Hi! We miss you.',
        ...dataOverrides
    },
    opts: { attempts: 3, ...optsOverrides },
    attemptsMade: 0
});

beforeEach(() => {
    jest.clearAllMocks();

    // Default: successful fresh campaign record
    mockCampaignRecord.sent_count = 0;
    mockCampaignRecord.failed_count = 0;
    mockCampaignRecord.total_recipients = 3;
    mockCampaignRecord.update.mockResolvedValue(true);
    Campaign.findByPk.mockResolvedValue({ ...mockCampaignRecord, update: mockCampaignRecord.update });

    // Default: successful Meta API response
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ message_id: 'mid.1234567890' })
    });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processCampaignSend', () => {

    // ── Sentinel trigger ──────────────────────────────────────────────────────

    describe('trigger job (_trigger: true)', () => {
        it('delegates to runCampaign and returns { triggered: true }', async () => {
            const job = { data: { _trigger: true, shopId: 'shop-1', campaignId: 'camp-1' } };
            const result = await processCampaignSend(job);
            expect(mockRunCampaign).toHaveBeenCalledWith('shop-1', 'camp-1');
            expect(result).toEqual({ triggered: true });
        });

        it('does NOT call fetch for trigger jobs', async () => {
            const job = { data: { _trigger: true, shopId: 'shop-1', campaignId: 'camp-1' } };
            await processCampaignSend(job);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    // ── Meta API call ─────────────────────────────────────────────────────────

    describe('Meta Send API call', () => {
        it('calls the correct Meta Graph API endpoint', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            await processCampaignSend(makeJob());
            expect(global.fetch).toHaveBeenCalledWith(
                'https://graph.facebook.com/v21.0/page-999/messages',
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('sends correct Authorization Bearer token', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            await processCampaignSend(makeJob());
            const [, options] = global.fetch.mock.calls[0];
            expect(options.headers['Authorization']).toBe('Bearer EAAtoken');
        });

        it('sends correct recipient PSID in body', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            await processCampaignSend(makeJob());
            const [, options] = global.fetch.mock.calls[0];
            const body = JSON.parse(options.body);
            expect(body.recipient.id).toBe('psid-abc123');
        });

        it('uses POST_PURCHASE_UPDATE message tag', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            await processCampaignSend(makeJob());
            const [, options] = global.fetch.mock.calls[0];
            const body = JSON.parse(options.body);
            expect(body.tag).toBe('POST_PURCHASE_UPDATE');
            expect(body.messaging_type).toBe('MESSAGE_TAG');
        });

        it('sends the campaign message text', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            await processCampaignSend(makeJob({ message: 'Custom message text' }));
            const [, options] = global.fetch.mock.calls[0];
            const body = JSON.parse(options.body);
            expect(body.message.text).toBe('Custom message text');
        });
    });

    // ── Success path ──────────────────────────────────────────────────────────

    describe('successful send', () => {
        it('increments sent_count on success', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            await processCampaignSend(makeJob());
            expect(Campaign.increment).toHaveBeenCalledWith(
                'sent_count',
                expect.objectContaining({ by: 1, where: { id: 'camp-1', shop_id: 'shop-1' } })
            );
        });

        it('marks campaign completed when sent + failed >= total', async () => {
            const updFn = jest.fn();
            Campaign.findByPk.mockResolvedValue({ sent_count: 3, failed_count: 0, total_recipients: 3, update: updFn });
            await processCampaignSend(makeJob());
            expect(updFn).toHaveBeenCalledWith({ status: 'completed' });
        });

        it('does NOT mark completed when sent + failed < total', async () => {
            const updFn = jest.fn();
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: updFn });
            await processCampaignSend(makeJob());
            expect(updFn).not.toHaveBeenCalled();
        });

        it('returns { sent: true } on success', async () => {
            Campaign.findByPk.mockResolvedValue({ sent_count: 1, failed_count: 0, total_recipients: 3, update: jest.fn() });
            const result = await processCampaignSend(makeJob());
            expect(result).toEqual({ sent: true });
        });
    });

    // ── Failure path ──────────────────────────────────────────────────────────

    describe('failed send', () => {
        beforeEach(() => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: jest.fn().mockResolvedValue({ error: { message: 'Invalid OAuth token', code: 190 } })
            });
        });

        it('does NOT increment failed_count on intermediate retry attempts', async () => {
            const job = { ...makeJob(), attemptsMade: 1 }; // not the final attempt (opts.attempts=3)
            await expect(processCampaignSend(job)).rejects.toThrow();
            expect(Campaign.increment).not.toHaveBeenCalledWith('failed_count', expect.anything());
        });

        it('increments failed_count on the final attempt', async () => {
            const job = { ...makeJob(), attemptsMade: 3, opts: { attempts: 3 } };
            Campaign.findByPk.mockResolvedValue({ sent_count: 0, failed_count: 3, total_recipients: 3, update: jest.fn() });
            await expect(processCampaignSend(job)).rejects.toThrow();
            expect(Campaign.increment).toHaveBeenCalledWith(
                'failed_count',
                expect.objectContaining({ by: 1 })
            );
        });

        it('marks campaign completed on final failure when all processed', async () => {
            const updFn = jest.fn();
            const job = { ...makeJob(), attemptsMade: 3, opts: { attempts: 3 } };
            Campaign.findByPk.mockResolvedValue({ sent_count: 2, failed_count: 1, total_recipients: 3, update: updFn });
            await expect(processCampaignSend(job)).rejects.toThrow();
            expect(updFn).toHaveBeenCalledWith({ status: 'completed' });
        });

        it('re-throws error so Bull can apply retry backoff', async () => {
            const job = makeJob();
            await expect(processCampaignSend(job)).rejects.toThrow('Invalid OAuth token');
        });

        it('attaches metaCode to the thrown error', async () => {
            const job = makeJob();
            let caughtError;
            try { await processCampaignSend(job); } catch (e) { caughtError = e; }
            expect(caughtError.metaCode).toBe(190);
        });

        it('handles non-JSON Meta error responses gracefully', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: jest.fn().mockRejectedValue(new Error('not json')),
                status: 500
            });
            await expect(processCampaignSend(makeJob())).rejects.toThrow();
        });
    });
});
