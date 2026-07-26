'use strict';

const express = require('express');
const request = require('supertest');

const SHOP_ONE = '11111111-1111-4111-8111-111111111111';
const SHOP_TWO = '22222222-2222-4222-8222-222222222222';
const mockGapCreate = jest.fn();
const mockAuditCreate = jest.fn();
const mockTransaction = { id: 'security-test-transaction' };
const mockSequelize = {
    query: jest.fn(),
    transaction: jest.fn(async (callback) => callback(mockTransaction)),
};

jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: (req, res, next) => {
        if (req.get('authorization') !== 'Bearer merchant-shop-one') {
            return res.status(401).json({ error: 'Authentication required' });
        }
        req.user = { userId: 'user-1', shopId: SHOP_ONE };
        return next();
    },
}));
jest.mock('../knowledge-gap.entity', () => ({ create: mockGapCreate }));
jest.mock('../../entities', () => ({ AuditLog: { create: mockAuditCreate } }));
jest.mock('../../../utils/database/database-setup', () => ({ sequelize: mockSequelize }));
jest.mock('../analytics-enhanced.service', () => ({
    getTopUnansweredQuestions: jest.fn(),
    getPeakHours: jest.fn(),
    getIntentBreakdown: jest.fn(),
    getConfidenceDistribution: jest.fn(),
}));
jest.mock('../growth-metrics.service', () => ({ getGrowthMetrics: jest.fn() }));
jest.mock('../funnel-events.service', () => ({
    ALLOWED_FUNNEL_EVENTS: new Set(),
    recordFunnelEvent: jest.fn(),
}));

const router = require('../analytics.routes');

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use('/api/analytics', router);
    return instance;
}

describe('knowledge-gap route tenant perimeter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGapCreate.mockResolvedValue({ id: 'gap-1' });
        mockAuditCreate.mockResolvedValue({});
    });

    test('rejects anonymous and cross-shop writes before persistence', async () => {
        await request(app())
            .post('/api/analytics/knowledge-gap')
            .send({ question: 'Unknown item?', platform: 'messenger' })
            .expect(401);

        await request(app())
            .post('/api/analytics/knowledge-gap')
            .set('authorization', 'Bearer merchant-shop-one')
            .send({
                question: 'Cross-shop question',
                platform: 'messenger',
                shop_id: SHOP_TWO,
            })
            .expect(403);

        expect(mockGapCreate).not.toHaveBeenCalled();
        expect(mockAuditCreate).not.toHaveBeenCalled();
    });

    test('writes the token shop and audit event in one transaction', async () => {
        await request(app())
            .post('/api/analytics/knowledge-gap')
            .set('authorization', 'Bearer merchant-shop-one')
            .send({ question: 'Do you stock this?', platform: 'messenger' })
            .expect(200);

        expect(mockGapCreate).toHaveBeenCalledWith(
            expect.objectContaining({ shop_id: SHOP_ONE }),
            { transaction: mockTransaction },
        );
        expect(mockAuditCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                shop_id: SHOP_ONE,
                action: 'knowledge_gap_created',
            }),
            { transaction: mockTransaction },
        );
    });
});
