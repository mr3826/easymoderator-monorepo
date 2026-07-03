/**
 * consent.service.test.js
 *
 * Unit tests for ConsentService. The Customer entity findByPk is mocked so
 * the tests don't need a real database; the MetaChannelConsentEvent.create
 * call is mocked to verify the audit row write.
 */

'use strict';

process.env.NODE_ENV = 'test';

jest.mock('src/modules/customer/customer.entity', () => ({
    findByPk: jest.fn(),
}));

jest.mock('src/modules/channel-providers/meta-channel-consent-event.entity', () => ({
    create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
}));

const Customer = require('src/modules/customer/customer.entity');
const MetaChannelConsentEvent = require('src/modules/channel-providers/meta-channel-consent-event.entity');
const consentService = require('src/modules/consent/consent.service');

function makeCustomer(overrides = {}) {
    return {
        id: 'cust-1',
        shop_id: 'shop-1',
        messaging_consent: {},
        changed: jest.fn(),
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

beforeEach(() => jest.clearAllMocks());

describe('isStopKeyword', () => {
    test.each([
        'stop', 'STOP', '  Stop  ', 'বন্ধ', 'unsubscribe', 'বন্ধ করো',
        'আর না', 'থামুন', 'bondo koro', 'ar na', 'stop koro', 'band koro',
    ])(
        'matches "%s"',
        (text) => expect(consentService.isStopKeyword(text)).toBe(true)
    );
    test.each(['hello', 'stop sending later', 'বন্ধ করেন না', ''])(
        'does NOT match "%s"',
        (text) => expect(consentService.isStopKeyword(text)).toBe(false)
    );
});

describe('hasConsent', () => {
    test('false when per-channel opted_out_at is set (Phase 5 sole source)', () => {
        const customer = makeCustomer({
            messaging_consent: { facebook: { opted_out_at: '2026-01-01T00:00:00Z', opted_in: true } },
        });
        expect(consentService.hasConsent({ customer, platform: 'facebook' })).toBe(false);
    });
    test('false when per-channel opted_out_at is set', () => {
        const customer = makeCustomer({
            messaging_consent: { facebook: { opted_out_at: '2026-05-19T10:00:00Z' } },
        });
        expect(consentService.hasConsent({ customer, platform: 'facebook' })).toBe(false);
    });
    test('true by default (no record, no global flag)', () => {
        const customer = makeCustomer();
        expect(consentService.hasConsent({ customer, platform: 'facebook' })).toBe(true);
    });
    test('false when customer is missing', () => {
        expect(consentService.hasConsent({ customer: null, platform: 'facebook' })).toBe(false);
    });
});

describe('getLastInboundAt', () => {
    test('returns Date when set', () => {
        const customer = makeCustomer({
            messaging_consent: { facebook: { last_inbound_at: '2026-05-19T10:00:00Z' } },
        });
        const d = consentService.getLastInboundAt({ customer, platform: 'facebook' });
        expect(d).toBeInstanceOf(Date);
    });
    test('null when missing', () => {
        expect(consentService.getLastInboundAt({ customer: makeCustomer(), platform: 'facebook' })).toBeNull();
    });
});

describe('recordOptOut', () => {
    test('sets opted_out_at in messaging_consent and writes audit row', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);

        await consentService.recordOptOut({
            shopId: 'shop-1', channelId: 'ch-1', customerId: 'cust-1', platform: 'facebook',
            source: 'keyword_stop', metadata: { keyword: 'stop' },
        });

        expect(customer.messaging_consent.facebook.opted_out_at).toBeTruthy();
        expect(customer.messaging_consent.facebook.opted_in).toBe(false);
        expect(customer.save).toHaveBeenCalled();
        expect(MetaChannelConsentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            event: 'OPT_OUT', source: 'keyword_stop', customer_id: 'cust-1',
        }));
    });

    test('idempotent — preserves earlier opted_out_at on second call', async () => {
        const earlier = '2026-05-01T00:00:00.000Z';
        const customer = makeCustomer({
            messaging_consent: { facebook: { opted_out_at: earlier, opted_in: false } },
        });
        Customer.findByPk.mockResolvedValue(customer);

        await consentService.recordOptOut({
            shopId: 'shop-1', channelId: 'ch-1', customerId: 'cust-1', platform: 'facebook',
        });

        expect(customer.messaging_consent.facebook.opted_out_at).toBe(earlier);
    });

    test('no-op when customer missing', async () => {
        Customer.findByPk.mockResolvedValue(null);
        const result = await consentService.recordOptOut({
            shopId: 'shop-1', customerId: 'cust-1', platform: 'facebook',
        });
        expect(result).toBeNull();
        expect(MetaChannelConsentEvent.create).not.toHaveBeenCalled();
    });
});

describe('recordInbound', () => {
    test('bumps last_inbound_at + writes first-inbound audit', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);

        await consentService.recordInbound({
            shopId: 'shop-1', channelId: 'ch-1', customerId: 'cust-1', platform: 'facebook',
        });

        expect(customer.messaging_consent.facebook.last_inbound_at).toBeTruthy();
        expect(customer.messaging_consent.facebook.opted_in).toBe(true);
        expect(MetaChannelConsentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            event: 'OPT_IN_IMPLICIT', source: 'message',
        }));
    });

    test('does NOT re-grant consent after opt-out', async () => {
        const customer = makeCustomer({
            messaging_consent: { facebook: { opted_in: false, opted_out_at: '2026-05-19T10:00:00Z' } },
        });
        Customer.findByPk.mockResolvedValue(customer);

        await consentService.recordInbound({
            shopId: 'shop-1', customerId: 'cust-1', platform: 'facebook',
        });

        expect(customer.messaging_consent.facebook.opted_in).toBe(false);
        expect(customer.messaging_consent.facebook.opted_out_at).toBe('2026-05-19T10:00:00Z');
        // No audit row on subsequent inbounds.
        expect(MetaChannelConsentEvent.create).not.toHaveBeenCalled();
    });
});

describe('recordOptIn', () => {
    test('webhook_messaging_optins source writes EXPLICIT event', async () => {
        const customer = makeCustomer();
        Customer.findByPk.mockResolvedValue(customer);

        await consentService.recordOptIn({
            shopId: 'shop-1', channelId: 'ch-1', customerId: 'cust-1', platform: 'facebook',
            source: 'webhook_messaging_optins',
        });

        expect(customer.messaging_consent.facebook.opted_in).toBe(true);
        expect(MetaChannelConsentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            event: 'OPT_IN_EXPLICIT', source: 'webhook_messaging_optins',
        }));
    });

    test('admin source can lift a prior opt-out', async () => {
        const customer = makeCustomer({
            messaging_consent: { facebook: { opted_in: false, opted_out_at: '2026-01-01T00:00:00Z' } },
        });
        Customer.findByPk.mockResolvedValue(customer);

        await consentService.recordOptIn({
            shopId: 'shop-1', customerId: 'cust-1', platform: 'facebook', source: 'admin',
        });

        expect(customer.messaging_consent.facebook.opted_in).toBe(true);
        expect(customer.messaging_consent.facebook.opted_out_at).toBeNull();
    });
});
