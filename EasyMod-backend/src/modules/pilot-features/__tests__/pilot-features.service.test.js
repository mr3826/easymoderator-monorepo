'use strict';

const mockModel = { findByPk: jest.fn(), update: jest.fn(), create: jest.fn() };
const mockShop = { findByPk: jest.fn() };
jest.mock('../../entities', () => ({ ShopPilotFeatures: mockModel, Shop: mockShop }));

const service = require('../pilot-features.service');
const metrics = require('../pilot-metrics');

beforeEach(() => {
    jest.clearAllMocks();
    metrics.reset();
});

describe('getPilotFeatures', () => {
    test('a shop with no row has every feature off (pre-pilot behaviour)', async () => {
        mockModel.findByPk.mockResolvedValue(null);
        expect(await service.getPilotFeatures('shop-1')).toEqual({
            customerIntelligence: false,
            orderConfidenceMode: 'off',
            orderConfidenceConfig: { high_value_cod_threshold: 10000, address_min_length: 15 },
        });
    });

    test('reads the stored flags and sanitises config', async () => {
        mockModel.findByPk.mockResolvedValue({
            customer_intelligence: true,
            order_confidence_mode: 'enforce',
            order_confidence_config: { high_value_cod_threshold: 5000, address_min_length: 'x', extra: 1 },
        });
        expect(await service.getPilotFeatures('shop-1')).toEqual({
            customerIntelligence: true,
            orderConfidenceMode: 'enforce',
            orderConfidenceConfig: { high_value_cod_threshold: 5000, address_min_length: 15 },
        });
    });

    test('an unknown stored mode is treated as off', async () => {
        mockModel.findByPk.mockResolvedValue({ customer_intelligence: false, order_confidence_mode: 'yolo' });
        expect((await service.getPilotFeatures('shop-1')).orderConfidenceMode).toBe('off');
    });

    test('a lookup failure resolves to off and is counted — never blocks booking', async () => {
        mockModel.findByPk.mockRejectedValue(new Error('db down'));
        expect((await service.getPilotFeatures('shop-1')).orderConfidenceMode).toBe('off');
        expect(metrics.snapshot().counters['pilot_features.lookup_failed']).toBe(1);
    });
});

describe('setPilotFeatures', () => {
    test('404 for an unknown shop', async () => {
        mockShop.findByPk.mockResolvedValue(null);
        await expect(service.setPilotFeatures('shop-x', { customer_intelligence: true }, 'admin-1'))
            .rejects.toMatchObject({ status: 404 });
    });

    test('creates a row and returns previous/current for the audit record', async () => {
        mockShop.findByPk.mockResolvedValue({ id: 'shop-1' });
        mockModel.findByPk
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ customer_intelligence: true, order_confidence_mode: 'shadow', order_confidence_config: {}, updated_by: 'admin-1' });
        const result = await service.setPilotFeatures('shop-1', { customer_intelligence: true, order_confidence_mode: 'shadow' }, 'admin-1');
        expect(mockModel.create).toHaveBeenCalledWith(expect.objectContaining({
            shop_id: 'shop-1', customer_intelligence: true, order_confidence_mode: 'shadow', updated_by: 'admin-1',
        }), {});
        expect(result.previous.order_confidence_mode).toBe('off');
        expect(result.current.order_confidence_mode).toBe('shadow');
    });

    test('rejects an invalid mode', async () => {
        mockShop.findByPk.mockResolvedValue({ id: 'shop-1' });
        mockModel.findByPk.mockResolvedValue(null);
        await expect(service.setPilotFeatures('shop-1', { order_confidence_mode: 'maybe' }, 'a'))
            .rejects.toMatchObject({ status: 400 });
    });
});

describe('pilot metrics', () => {
    test('only known counter names are recorded (no dynamic, PII-bearing labels)', () => {
        metrics.increment('order_confidence.gate_held');
        metrics.increment('opportunity.created.shop-123');
        const { counters } = metrics.snapshot();
        expect(counters['order_confidence.gate_held']).toBe(1);
        expect(Object.keys(counters)).not.toContain('opportunity.created.shop-123');
    });
});
