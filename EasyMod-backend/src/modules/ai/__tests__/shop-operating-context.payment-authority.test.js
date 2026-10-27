'use strict';

/**
 * Pilot+ P0-3 (payment authority) — mechanism of record.
 *
 * Design decision (docs/pilot-plus-v1/06, adjusted after grounding-boundary
 * A/B evidence): the single enabled-payment authority is enforced at WRITE
 * time, not by an extra DB query on the hot AI reply path:
 *   - payment.service.savePaymentConfig syncs settings.bd on enable and
 *     CLEARS it on disable (clearSelfMfs);
 *   - payment.service.deletePaymentConfig clears settings.bd for self-mfs;
 *   - the AI operating context then truthfully derives from settings.bd
 *     (shop-bd-settings.hasSelfMfs) — one read path, baseline latency;
 *   - the checkout machine independently gates on PaymentConfig.is_enabled
 *     (getEnabledPaymentGateways) — mutation authority unchanged.
 * The hot-path read must stay PaymentConfig-free (asserted below): the V1.3
 * grounding suites mock the entity registry only; adding live queries to
 * every reply re-introduces DB timing into deterministic reply tests (this
 * regression was measured, not theorized).
 */

process.env.NODE_ENV = 'test';

jest.mock('src/config/memory-cache', () => ({
    MemoryCache: jest.requireActual('src/config/memory-cache').MemoryCache,
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
}));
jest.mock('src/modules/shop/shop-bd-settings', () => ({
    getBdSettings: jest.fn(),
    hasSelfMfs: jest.requireActual('src/modules/shop/shop-bd-settings').hasSelfMfs,
    clearSelfMfs: jest.fn(async () => null),
}));
jest.mock('src/modules/delivery/delivery-integration.entity', () => ({
    findOne: jest.fn(),
}));

const bd = require('src/modules/shop/shop-bd-settings');
const DeliveryIntegration = require('src/modules/delivery/delivery-integration.entity');
const { getOperatingContext } = require('src/modules/ai/shop-operating-context.service');

const COD_DEFAULTS = { mfs_mode: null, mfs_type: null, mfs_number: null };

beforeEach(() => {
    jest.clearAllMocks();
    bd.getBdSettings.mockResolvedValue({ ...COD_DEFAULTS });
    DeliveryIntegration.findOne.mockResolvedValue(null);
});

describe('operating context reads payment truth from settings.bd ONLY', () => {
    test('module source performs no PaymentConfig query on the reply hot path', () => {
        const fs = require('fs');
        const src = fs.readFileSync(require.resolve('src/modules/ai/shop-operating-context.service'), 'utf8');
        expect(src).not.toMatch(/payment-config\.entity/);
        expect(src).not.toMatch(/PaymentConfigEntity/);
    });

    test('COD-only wording when no self-MFS number is configured', async () => {
        const ctx = await getOperatingContext('shop-1');
        expect(ctx).toContain('Cash on Delivery (COD) ONLY');
        expect(ctx).not.toMatch(/advance payment via/i);
    });

    test('self-MFS advertised exactly when the authoritative sync left a number', async () => {
        bd.getBdSettings.mockResolvedValue({
            mfs_mode: 'self', mfs_type: 'nagad', mfs_number: '01799887766',
        });
        const ctx = await getOperatingContext('shop-1');
        expect(ctx).toContain('01799887766');
        expect(ctx).toMatch(/nagad|নগদ/i);
    });

    test('a disabled+cleared config yields COD-only (post-clearSelfMfs state)', async () => {
        // payment.service disables self-mfs -> clearSelfMfs nulls settings.bd ->
        // this is the ONLY read the AI path makes; nothing can re-advertise it.
        bd.getBdSettings.mockResolvedValue({ ...COD_DEFAULTS });
        const ctx = await getOperatingContext('shop-1');
        expect(ctx).toContain('Cash on Delivery (COD) ONLY');
        expect(ctx).not.toContain('01799887766');
    });

    test('DB failure degrades to the safe COD-only block, never throws', async () => {
        bd.getBdSettings.mockRejectedValue(new Error('db down'));
        DeliveryIntegration.findOne.mockRejectedValue(new Error('db down'));
        const ctx = await getOperatingContext('shop-1');
        expect(ctx).toContain('Cash on Delivery (COD) ONLY');
        expect(ctx).not.toMatch(/advance payment via/i);
    });

    test('strict send-time reads propagate setting store failures', async () => {
        bd.getBdSettings.mockRejectedValue(new Error('db down'));
        await expect(getOperatingContext('shop-1', { strict: true })).rejects.toThrow('db down');
    });
});
