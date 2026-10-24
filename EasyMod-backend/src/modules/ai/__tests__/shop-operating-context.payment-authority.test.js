'use strict';

/**
 * Pilot+ P0-3: ONE enabled-payment authority.
 *
 * The AI operating context must derive "advance payment is accepted" from the
 * SAME PaymentConfig.is_enabled truth the checkout step machine gates on —
 * never from shop.settings.bd alone — and must fail CLOSED (COD-only wording,
 * no advance claims) when the enabled-state lookup fails.
 */

jest.mock('../../shop/shop-bd-settings', () => ({
    getBdSettings: jest.fn(),
    hasSelfMfs: jest.fn((bd) => bd && bd.mfs_mode === 'self' && Boolean(bd.mfs_number) && Boolean(bd.mfs_type)),
}));
jest.mock('../../payment/payment-config.entity', () => ({ findOne: jest.fn() }));
jest.mock('../../delivery/delivery-integration.entity', () => ({ findOne: jest.fn() }));

const { getOperatingContext } = require('../shop-operating-context.service');
const { getBdSettings } = require('../../shop/shop-bd-settings');
const PaymentConfigEntity = require('../../payment/payment-config.entity');
const DeliveryIntegration = require('../../delivery/delivery-integration.entity');

const BD_SELF_MFS = { mfs_mode: 'self', mfs_type: 'bkash', mfs_number: '01712345678' };

beforeEach(() => {
    jest.clearAllMocks();
    DeliveryIntegration.findOne.mockResolvedValue(null);
});

describe('payment authority in operating context', () => {
    test('self-MFS is advertised ONLY when a self-mfs PaymentConfig row is enabled', async () => {
        getBdSettings.mockResolvedValue(BD_SELF_MFS);
        PaymentConfigEntity.findOne.mockResolvedValue({ gateway: 'self-mfs', is_enabled: true });

        const ctx = await getOperatingContext('shop-1');

        expect(PaymentConfigEntity.findOne).toHaveBeenCalledWith({
            where: { shop_id: 'shop-1', gateway: 'self-mfs', is_enabled: true },
        });
        expect(ctx).toContain('01712345678');
        expect(ctx).toContain('bKash');
    });

    test('a stale settings.bd number with a DISABLED config must not be advertised (COD-only)', async () => {
        getBdSettings.mockResolvedValue(BD_SELF_MFS);
        PaymentConfigEntity.findOne.mockResolvedValue(null); // no enabled row

        const ctx = await getOperatingContext('shop-1');

        expect(ctx).toContain('Cash on Delivery (COD) ONLY');
        expect(ctx).not.toContain('01712345678');
        expect(ctx).not.toMatch(/advance payment via/i);
    });

    test('enabled config without a configured number also stays COD-only', async () => {
        getBdSettings.mockResolvedValue({ mfs_mode: null, mfs_type: null, mfs_number: null });
        PaymentConfigEntity.findOne.mockResolvedValue({ gateway: 'self-mfs', is_enabled: true });

        const ctx = await getOperatingContext('shop-1');

        expect(ctx).toContain('Cash on Delivery (COD) ONLY');
        expect(ctx).not.toMatch(/advance payment via/i);
    });

    test('enabled-config lookup failure fails CLOSED: COD wording, no claims, no throw', async () => {
        getBdSettings.mockResolvedValue(BD_SELF_MFS);
        PaymentConfigEntity.findOne.mockRejectedValue(new Error('db down'));

        const ctx = await getOperatingContext('shop-1');

        expect(ctx).toContain('Cash on Delivery (COD) ONLY');
        expect(ctx).not.toContain('01712345678');
        expect(ctx).not.toMatch(/advance payment via/i);
    });

    test('strict mode propagates an enabled-config lookup failure', async () => {
        getBdSettings.mockResolvedValue(BD_SELF_MFS);
        PaymentConfigEntity.findOne.mockRejectedValue(new Error('db down'));

        await expect(getOperatingContext('shop-1', { strict: true })).rejects.toThrow('db down');
    });

    test('COD-only guidance still forbids screenshot/TrxID confirmation claims', async () => {
        getBdSettings.mockResolvedValue({ mfs_mode: null, mfs_type: null, mfs_number: null });
        PaymentConfigEntity.findOne.mockResolvedValue(null);

        const ctx = await getOperatingContext('shop-1');

        expect(ctx).toMatch(/do NOT confirm or claim a payment was received/i);
    });
});
