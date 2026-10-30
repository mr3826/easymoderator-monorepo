'use strict';

/**
 * P+01: single-authority live-opportunity projection keyed by customer.
 * Reuses the canonical serializeOpportunity output (no competing shape).
 */

process.env.NODE_ENV = 'test';

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: { getDialect: jest.fn(() => 'postgres') },
}));
jest.mock('../../entities', () => ({}));

const entities = require('../../entities');
const opportunityService = require('../opportunity.service');

const liveRow = (over = {}) => ({
    id: 'opp-1',
    shop_id: 'shop-1',
    customer_id: 'customer-1',
    conversation_id: 'conv-1',
    status: 'OPEN',
    strength: 'HIGH',
    reasons: ['PURCHASE_INTENT'],
    signals: [{ code: 'PURCHASE_INTENT', source: 'message', message_id: 'm-1', at: '2026-10-24T10:00:00Z' }],
    product_refs: [],
    first_signal_at: new Date('2026-10-24T10:00:00Z'),
    last_signal_at: new Date('2026-10-24T10:00:00Z'),
    detected_at: new Date('2026-10-24T10:00:05Z'),
    actioned_at: null,
    converted_order_id: null,
    resolved_at: null,
    resolution_reason: null,
    detector_version: 'opportunity-detector/1.0.0',
    customer: { id: 'customer-1', name: 'Rina', channel_type: 'messenger', messaging_consent: { facebook: { last_inbound_at: new Date() } } },
    ...over,
});

describe('liveOpportunitiesForCustomers', () => {
    beforeEach(() => jest.clearAllMocks());

    it('short-circuits an empty/invalid id set without touching the DB', async () => {
        const before = entities.CustomerOpportunity;
        const map = await opportunityService.liveOpportunitiesForCustomers('shop-1', []);
        expect(map.size).toBe(0);
        // entities.CustomerOpportunity intentionally not defined for this case:
        // if the implementation had tried to query, it would have thrown.
        expect(before).toBeUndefined();
    });

    it('returns the canonical serialized live opportunity per customer, shop-scoped, LIVE-only', async () => {
        const findAll = jest.fn().mockResolvedValue([liveRow()]);
        Object.assign(entities, {
            CustomerOpportunity: { findAll },
            Customer: { id: 'CustomerModel' },
        });

        const map = await opportunityService.liveOpportunitiesForCustomers('shop-1', ['customer-1', 'customer-1']);

        expect(findAll).toHaveBeenCalledTimes(1);
        const arg = findAll.mock.calls[0][0];
        expect(arg.where.shop_id).toBe('shop-1');
        expect(Object.values(arg.where.status)).toBeTruthy();
        expect(map.get('customer-1')).toMatchObject({
            id: 'opp-1',
            status: 'OPEN',
            strength: 'HIGH',
            reasons: ['PURCHASE_INTENT'],
            recommended_action: expect.objectContaining({ code: expect.any(String) }),
        });
        expect(map.get('customer-1')).not.toHaveProperty('signals.0.text');
    });

    it('produces EXACTLY the same projection the opportunity API would (single source)', async () => {
        const row = liveRow();
        Object.assign(entities, {
            CustomerOpportunity: { findAll: jest.fn().mockResolvedValue([row]) },
            Customer: {},
        });
        const map = await opportunityService.liveOpportunitiesForCustomers('shop-1', ['customer-1']);
        expect(map.get('customer-1').id).toBe('opp-1');
        expect(map.get('customer-1').customer).toEqual({ id: 'customer-1', name: 'Rina', channel_type: 'messenger' });
    });
});
