'use strict';

/**
 * shop-operating-context.service — the AI's authoritative payment/delivery facts.
 *
 * Verifies the grounding that stops the bot from advertising payment rails the
 * shop hasn't connected:
 *   - Zero config  → "Cash on Delivery ONLY" + explicit no-advance-payment rules
 *   - Self-MFS set → lists the owner's personal bKash/Nagad number for advance
 *   - Courier set  → names the connected courier
 *
 * Collaborators are mocked so this is a fast, deterministic unit test.
 */

process.env.NODE_ENV = 'test';

jest.mock('src/modules/shop/shop-bd-settings', () => ({
    getBdSettings: jest.fn(),
    hasSelfMfs: jest.requireActual('src/modules/shop/shop-bd-settings').hasSelfMfs,
}));
jest.mock('src/modules/delivery/delivery-integration.entity', () => ({
    findOne: jest.fn(),
}));

const bd = require('src/modules/shop/shop-bd-settings');
const DeliveryIntegration = require('src/modules/delivery/delivery-integration.entity');
const { getOperatingContext } = require('src/modules/ai/shop-operating-context.service');

const COD_DEFAULTS = {
    mfs_mode: null, mfs_type: null, mfs_number: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    bd.getBdSettings.mockResolvedValue({ ...COD_DEFAULTS });
    DeliveryIntegration.findOne.mockResolvedValue(null);
});

test('zero config → COD-only with explicit no-advance-payment rules', async () => {
    const ctx = await getOperatingContext('shop-1');

    expect(ctx).toContain('Cash on Delivery (COD) ONLY');
    expect(ctx).toMatch(/Never ask the customer to pay first/i);
    expect(ctx).toMatch(/do NOT confirm or claim a payment was received/i);
    expect(ctx).toContain('no courier is connected yet');
    // Must not invent a payment rail the shop hasn't connected.
    expect(ctx).not.toMatch(/bKash|Nagad/);
});

test('self-MFS configured → lists the personal number for advance payment', async () => {
    bd.getBdSettings.mockResolvedValue({
        mfs_mode: 'self', mfs_type: 'bkash', mfs_number: '01711111111',
    });

    const ctx = await getOperatingContext('shop-1');

    expect(ctx).toContain('bKash');
    expect(ctx).toContain('01711111111');
    expect(ctx).toMatch(/advance payment/i);
    // The COD-only hard block must NOT appear when a method is connected.
    expect(ctx).not.toContain('Cash on Delivery (COD) ONLY');
});

test('connected courier is named', async () => {
    DeliveryIntegration.findOne.mockResolvedValue({ provider: 'steadfast' });

    const ctx = await getOperatingContext('shop-1');

    expect(ctx).toContain('Steadfast');
    expect(ctx).not.toContain('no courier is connected');
});

test('missing shopId returns empty string (graceful)', async () => {
    expect(await getOperatingContext(null)).toBe('');
});

test('DB failure degrades to the safe COD-only block, never throws', async () => {
    bd.getBdSettings.mockRejectedValue(new Error('db down'));
    DeliveryIntegration.findOne.mockRejectedValue(new Error('db down'));

    // When config is unreadable, fall back to the safest possible stance:
    // COD-only (never advertises a payment rail we can't confirm exists).
    const ctx = await getOperatingContext('shop-1');
    expect(ctx).toContain('Cash on Delivery (COD) ONLY');
    expect(ctx).not.toMatch(/bKash|Nagad/);
});
