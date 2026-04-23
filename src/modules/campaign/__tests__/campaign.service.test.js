/**
 * Campaign Service — Unit Tests
 * Tests createCampaign, getCampaigns, getCampaignStats, runCampaign, scheduleCampaign
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('sequelize', () => ({
    Op: { in: Symbol('in'), ne: Symbol('ne'), gte: Symbol('gte') }
}));

jest.mock('../../entities', () => ({
    Campaign: {
        create: jest.fn(),
        findOne: jest.fn(),
        findAll: jest.fn(),
        findByPk: jest.fn(),
        increment: jest.fn()
    },
    Customer: { findAll: jest.fn() },
    Order: {
        findAll: jest.fn(),
        sequelize: { fn: jest.fn((fn, col) => `${fn}(${col})`), col: jest.fn((c) => c) }
    },
    UserShop: { findOne: jest.fn() },
    Channel: { findOne: jest.fn() }
}));

jest.mock('../../../utils/AppError', () => ({
    AppError: class AppError extends Error {
        constructor(message, statusCode) {
            super(message);
            this.statusCode = statusCode;
            this.name = 'AppError';
        }
    }
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }))
}));

jest.mock('../../jobs/queue-manager', () => ({
    queues: {
        campaignSend: {
            add: jest.fn().mockResolvedValue({ id: 'job-trigger-1' }),
            addBulk: jest.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }])
        }
    }
}));

// ── Require after mocks ───────────────────────────────────────────────────────

const campaignService = require('../campaign.service');
const { Campaign, Customer, Order, Channel } = require('../../entities');
const { AppError } = require('../../../utils/AppError');
const queueManager = require('../../jobs/queue-manager');

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeCampaign = (overrides = {}) => ({
    id: 'camp-1',
    shop_id: 'shop-1',
    name: 'Test Campaign',
    message_template: 'Hello {{name}}, we miss you!',
    status: 'draft',
    segment_filter: { minOrders: 0, requireConsent: true, recipientCap: 500 },
    total_recipients: 0,
    sent_count: 0,
    failed_count: 0,
    scheduled_at: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    update: jest.fn(async (data) => Object.assign(mockCampaign, data)),
    ...overrides
});

let mockCampaign;

const makeCustomer = (consentMeta = { marketing_opt_in: true }) => ({
    id: `cust-${Math.random().toString(36).slice(2)}`,
    channel_type: 'messenger',
    channel_user_id: `psid-${Math.random().toString(36).slice(2)}`,
    metadata: consentMeta
});

const makeChannel = () => ({
    page_id: 'page-123',
    access_token: 'EAAtoken123'
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CampaignService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCampaign = makeCampaign();
    });

    // ── createCampaign ────────────────────────────────────────────────────────

    describe('createCampaign', () => {
        it('creates and returns a new draft campaign', async () => {
            Campaign.create.mockResolvedValue(mockCampaign);
            const result = await campaignService.createCampaign('shop-1', {
                name: 'Test Campaign',
                message_template: 'Hello!',
                segment_filter: { recipientCap: 100 }
            });
            expect(Campaign.create).toHaveBeenCalledWith(expect.objectContaining({
                shop_id: 'shop-1',
                name: 'Test Campaign',
                message_template: 'Hello!',
                status: 'draft'
            }));
            expect(result.id).toBe('camp-1');
        });

        it('throws 400 when name is missing', async () => {
            await expect(
                campaignService.createCampaign('shop-1', { message_template: 'Hello!' })
            ).rejects.toThrow(AppError);
            await expect(
                campaignService.createCampaign('shop-1', { message_template: 'Hello!' })
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('throws 400 when message_template is missing', async () => {
            await expect(
                campaignService.createCampaign('shop-1', { name: 'My Campaign' })
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('uses empty object for segment_filter if not provided', async () => {
            Campaign.create.mockResolvedValue(mockCampaign);
            await campaignService.createCampaign('shop-1', { name: 'X', message_template: 'Y' });
            expect(Campaign.create).toHaveBeenCalledWith(expect.objectContaining({
                segment_filter: {}
            }));
        });
    });

    // ── getCampaigns ──────────────────────────────────────────────────────────

    describe('getCampaigns', () => {
        it('returns campaigns ordered by created_at DESC', async () => {
            const campaigns = [mockCampaign, { ...mockCampaign, id: 'camp-2' }];
            Campaign.findAll.mockResolvedValue(campaigns);
            const result = await campaignService.getCampaigns('shop-1');
            expect(Campaign.findAll).toHaveBeenCalledWith({
                where: { shop_id: 'shop-1' },
                order: [['created_at', 'DESC']]
            });
            expect(result).toHaveLength(2);
        });

        it('returns empty array when no campaigns', async () => {
            Campaign.findAll.mockResolvedValue([]);
            const result = await campaignService.getCampaigns('shop-1');
            expect(result).toEqual([]);
        });
    });

    // ── getCampaignStats ──────────────────────────────────────────────────────

    describe('getCampaignStats', () => {
        it('returns stats object with all required fields', async () => {
            Campaign.findOne.mockResolvedValue({
                ...mockCampaign, sent_count: 45, failed_count: 5, total_recipients: 100
            });
            const stats = await campaignService.getCampaignStats('shop-1', 'camp-1');
            expect(stats).toMatchObject({
                id: 'camp-1',
                name: 'Test Campaign',
                status: 'draft',
                total_recipients: 100,
                sent_count: 45,
                failed_count: 5
            });
            expect(stats).toHaveProperty('created_at');
            expect(stats).toHaveProperty('updated_at');
        });

        it('throws 404 when campaign not found', async () => {
            Campaign.findOne.mockResolvedValue(null);
            await expect(
                campaignService.getCampaignStats('shop-1', 'nonexistent')
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('scopes query to shop_id', async () => {
            Campaign.findOne.mockResolvedValue(mockCampaign);
            await campaignService.getCampaignStats('shop-1', 'camp-1');
            expect(Campaign.findOne).toHaveBeenCalledWith({
                where: { id: 'camp-1', shop_id: 'shop-1' }
            });
        });
    });

    // ── runCampaign ───────────────────────────────────────────────────────────

    describe('runCampaign', () => {
        beforeEach(() => {
            mockCampaign = makeCampaign({ status: 'draft' });
            Campaign.findOne.mockResolvedValue(mockCampaign);
            Channel.findOne.mockResolvedValue(makeChannel());
        });

        it('enqueues one job per eligible customer and sets status running', async () => {
            const customers = [makeCustomer(), makeCustomer()];
            Customer.findAll.mockResolvedValue(customers);
            await campaignService.runCampaign('shop-1', 'camp-1');
            expect(mockCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', total_recipients: 2 }));
            expect(queueManager.queues.campaignSend.addBulk).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ data: expect.objectContaining({ shopId: 'shop-1', campaignId: 'camp-1' }) })
                ])
            );
        });

        it('filters out customers without consent when requireConsent is true', async () => {
            const consented = makeCustomer({ marketing_opt_in: true });
            const optedOut = makeCustomer({ marketing_opt_out: true });
            const noConsent = makeCustomer({});
            Customer.findAll.mockResolvedValue([consented, optedOut, noConsent]);
            await campaignService.runCampaign('shop-1', 'camp-1');
            expect(mockCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ total_recipients: 1 }));
        });

        it('includes all customers when requireConsent is false', async () => {
            mockCampaign = makeCampaign({ status: 'draft', segment_filter: { requireConsent: false, recipientCap: 500 } });
            Campaign.findOne.mockResolvedValue(mockCampaign);
            const customers = [makeCustomer({}), makeCustomer({ marketing_opt_out: true })];
            Customer.findAll.mockResolvedValue(customers);
            await campaignService.runCampaign('shop-1', 'camp-1');
            expect(mockCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ total_recipients: 2 }));
        });

        it('throws 400 when campaign status is running', async () => {
            Campaign.findOne.mockResolvedValue(makeCampaign({ status: 'running' }));
            await expect(
                campaignService.runCampaign('shop-1', 'camp-1')
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('throws 400 when campaign status is completed', async () => {
            Campaign.findOne.mockResolvedValue(makeCampaign({ status: 'completed' }));
            await expect(
                campaignService.runCampaign('shop-1', 'camp-1')
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('throws 404 when campaign not found', async () => {
            Campaign.findOne.mockResolvedValue(null);
            await expect(
                campaignService.runCampaign('shop-1', 'nonexistent')
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('throws 422 and marks failed when no channel found', async () => {
            Customer.findAll.mockResolvedValue([makeCustomer()]);
            Channel.findOne.mockResolvedValue(null);
            await expect(
                campaignService.runCampaign('shop-1', 'camp-1')
            ).rejects.toMatchObject({ statusCode: 422 });
            expect(mockCampaign.update).toHaveBeenCalledWith({ status: 'failed' });
        });

        it('throws 422 when channel has no page_id', async () => {
            Customer.findAll.mockResolvedValue([makeCustomer()]);
            Channel.findOne.mockResolvedValue({ page_id: null, access_token: 'token' });
            await expect(campaignService.runCampaign('shop-1', 'camp-1')).rejects.toMatchObject({ statusCode: 422 });
        });

        it('throws 429 when eligible customers exceed recipientCap', async () => {
            mockCampaign = makeCampaign({ status: 'draft', segment_filter: { requireConsent: false, recipientCap: 2 } });
            Campaign.findOne.mockResolvedValue(mockCampaign);
            const tooMany = Array.from({ length: 5 }, () => makeCustomer({}));
            Customer.findAll.mockResolvedValue(tooMany);
            await expect(
                campaignService.runCampaign('shop-1', 'camp-1')
            ).rejects.toMatchObject({ statusCode: 429 });
        });

        it('respects global CAMPAIGN_MAX_RECIPIENTS cap (500) regardless of recipientCap', async () => {
            mockCampaign = makeCampaign({ status: 'draft', segment_filter: { requireConsent: false, recipientCap: 9999 } });
            Campaign.findOne.mockResolvedValue(mockCampaign);
            // 600 customers > hard cap 500
            const tooMany = Array.from({ length: 600 }, () => makeCustomer({}));
            Customer.findAll.mockResolvedValue(tooMany);
            await expect(
                campaignService.runCampaign('shop-1', 'camp-1')
            ).rejects.toMatchObject({ statusCode: 429 });
        });

        it('can run a scheduled campaign', async () => {
            Campaign.findOne.mockResolvedValue(makeCampaign({ status: 'scheduled' }));
            Customer.findAll.mockResolvedValue([makeCustomer()]);
            await campaignService.runCampaign('shop-1', 'camp-1');
            expect(mockCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
        });
    });

    // ── scheduleCampaign ──────────────────────────────────────────────────────

    describe('scheduleCampaign', () => {
        const futureDate = new Date(Date.now() + 3600000).toISOString();

        beforeEach(() => {
            mockCampaign = makeCampaign({ status: 'draft' });
            Campaign.findOne.mockResolvedValue(mockCampaign);
        });

        it('sets status to scheduled and records scheduled_at', async () => {
            await campaignService.scheduleCampaign('shop-1', 'camp-1', futureDate);
            expect(mockCampaign.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'scheduled' }));
        });

        it('enqueues a delayed sentinel trigger job', async () => {
            await campaignService.scheduleCampaign('shop-1', 'camp-1', futureDate);
            expect(queueManager.queues.campaignSend.add).toHaveBeenCalledWith(
                expect.objectContaining({ _trigger: true, shopId: 'shop-1', campaignId: 'camp-1' }),
                expect.objectContaining({ delay: expect.any(Number), attempts: 1 })
            );
        });

        it('throws 400 when scheduledAt is missing', async () => {
            await expect(
                campaignService.scheduleCampaign('shop-1', 'camp-1', null)
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('throws 404 when campaign not found', async () => {
            Campaign.findOne.mockResolvedValue(null);
            await expect(
                campaignService.scheduleCampaign('shop-1', 'nonexistent', futureDate)
            ).rejects.toMatchObject({ statusCode: 404 });
        });

        it('throws 400 when campaign status is running', async () => {
            Campaign.findOne.mockResolvedValue(makeCampaign({ status: 'running' }));
            await expect(
                campaignService.scheduleCampaign('shop-1', 'camp-1', futureDate)
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('throws 400 when campaign status is completed', async () => {
            Campaign.findOne.mockResolvedValue(makeCampaign({ status: 'completed' }));
            await expect(
                campaignService.scheduleCampaign('shop-1', 'camp-1', futureDate)
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('allows rescheduling a scheduled campaign', async () => {
            Campaign.findOne.mockResolvedValue(makeCampaign({ status: 'scheduled' }));
            await expect(
                campaignService.scheduleCampaign('shop-1', 'camp-1', futureDate)
            ).resolves.not.toThrow();
        });
    });
});
