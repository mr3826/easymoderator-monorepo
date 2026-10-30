'use strict';

/**
 * Pilot+ P0-3 (part 2): disabling/deleting the self-mfs PaymentConfig must
 * keep shop.settings.bd payment truth consistent — no stale advance-payment
 * number may survive an explicit merchant disable/delete.
 */

process.env.NODE_ENV = 'test';

jest.mock('../../entities', () => ({
    Order: { findByPk: jest.fn() },
    PaymentConfig: { findOne: jest.fn(), create: jest.fn() },
    UserShop: { findOne: jest.fn().mockResolvedValue({ id: 'us-1' }) },
}));
jest.mock('../../shop/shop-bd-settings', () => ({
    getBdSettings: jest.fn().mockResolvedValue({}),
    updateBdSettings: jest.fn().mockResolvedValue({}),
    clearSelfMfs: jest.fn().mockResolvedValue(undefined),
    hasSelfMfs: jest.fn(() => false),
}));

const { PaymentConfig } = require('../../entities');
const { updateBdSettings, clearSelfMfs } = require('../../shop/shop-bd-settings');
const paymentService = require('../payment.service');

const SELF_MFS_CREDS = { mfs_type: 'bkash', mfs_mode: 'self', mfs_number: '01711111111' };
const existingEnabledSelfMfs = () => ({
    shop_id: 'shop-1',
    gateway: 'self-mfs',
    is_enabled: true,
    credentials: { ...SELF_MFS_CREDS },
    config: {},
    save: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
    jest.clearAllMocks();
    require('../../entities').UserShop.findOne.mockResolvedValue({ id: 'us-1' });
});

describe('self-mfs enable/disable config sync', () => {
    test('enabling self-mfs with credentials still syncs the number into shop.settings.bd', async () => {
        PaymentConfig.findOne.mockResolvedValue(existingEnabledSelfMfs());

        await paymentService.savePaymentConfig('shop-1', 'user-1', 'bkash', true, SELF_MFS_CREDS, {});

        expect(updateBdSettings).toHaveBeenCalledWith('shop-1', expect.objectContaining({
            mfs_number: '01711111111',
        }));
        expect(clearSelfMfs).not.toHaveBeenCalled();
    });

    test('DISABLING self-mfs clears settings.bd payment truth and does not re-sync the number', async () => {
        PaymentConfig.findOne.mockResolvedValue(existingEnabledSelfMfs());

        await paymentService.savePaymentConfig('shop-1', 'user-1', 'self-mfs', false, null, undefined);

        expect(clearSelfMfs).toHaveBeenCalledWith('shop-1');
        expect(updateBdSettings).not.toHaveBeenCalled();
    });

    test('deleting a self-mfs config clears settings.bd payment truth', async () => {
        PaymentConfig.findOne.mockResolvedValue(existingEnabledSelfMfs());

        await paymentService.deletePaymentConfig('shop-1', 'user-1', 'bkash');

        expect(clearSelfMfs).toHaveBeenCalledWith('shop-1');
    });

    test('deleting the COD config leaves bd settings untouched', async () => {
        PaymentConfig.findOne.mockResolvedValue({
            shop_id: 'shop-1', gateway: 'cod', is_enabled: true, credentials: null, config: {},
            destroy: jest.fn().mockResolvedValue(undefined),
        });

        await paymentService.deletePaymentConfig('shop-1', 'user-1', 'cod');

        expect(clearSelfMfs).not.toHaveBeenCalled();
    });

    test('clearSelfMfs failure never blocks a committed disable', async () => {
        PaymentConfig.findOne.mockResolvedValue(existingEnabledSelfMfs());
        clearSelfMfs.mockRejectedValueOnce(new Error('cache down'));

        await expect(
            paymentService.savePaymentConfig('shop-1', 'user-1', 'self-mfs', false, null, undefined),
        ).resolves.toBeDefined();
    });
});
